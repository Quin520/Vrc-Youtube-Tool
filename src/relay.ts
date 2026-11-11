import * as fs from 'node:fs/promises';
import path from 'node:path';
import config, { proxyUrl } from './config.ts';
import { getProxyUrl, type Resource } from './resolveService.ts';
import { hlsAsset } from './cache.ts';

export function rewritePlaylist(text: string, base: string, headers: Record<string, string> = {}) {
  const rewrite = (uri: string) => {
    if (/^data:/i.test(uri)) return uri;
    return getProxyUrl(new URL(uri, base).href, headers);
  };
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/\bURI="([^"]+)"/g, (_match, uri: string) => `URI="${rewrite(uri)}"`);
    return rewrite(line.trim());
  }).join('\n');
}

export function parseRange(value: string, size: number): [number, number] | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return;
  const suffix = !match[1];
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || !match[2] ? size - 1 : Math.min(size - 1, Number(match[2]));
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (suffix && Number(match[2]) <= 0)) return;
  return [start, end];
}

export async function serveFile(file: string, request: Request, etag: string, contentType = 'video/mp4') {
  const stat = await fs.stat(file);
  // Touch access time, keeping modification time and validators stable.
  await fs.utimes(file, new Date(), stat.mtime).catch(() => {});
  const headers = new Headers({
    'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'ETag': `"${etag}"`,
    'Last-Modified': stat.mtime.toUTCString(), 'Cache-Control': 'private, max-age=3600',
  });
  // Advertise a closing connection explicitly so media clients reopen it for seeks.
  if (request.headers.get('Connection')?.toLowerCase() === 'close') headers.set('Connection', 'close');
  const rangeHeader = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  const useRange = rangeHeader && (!ifRange || ifRange === headers.get('ETag') || ifRange === headers.get('Last-Modified'));
  if (useRange) {
    const range = parseRange(rangeHeader, stat.size);
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    const [start, end] = range;
    headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(request.method === 'HEAD' ? null : Bun.file(file).slice(start, end + 1), { status: 206, headers });
  }
  headers.set('Content-Length', String(stat.size));
  return new Response(request.method === 'HEAD' ? null : Bun.file(file), { headers });
}

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('播放请求已断开'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('播放请求已断开'));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function relayResource(resource: Resource, request: Request): Promise<Response> {
  if (resource.kind === 'file') {
    const job = resource.job;
    job.lastUsed = Date.now();
    if (['failed', 'cancelled', 'cancelling', 'evicted'].includes(job.state)) throw new Error(job.error || '任务已取消');
    const file = await waitFor(job.artifact.hls ? job.playable : job.ready, request.signal);
    if (!job.isPlayable) throw new Error(job.error || '任务已取消');
    if (!await Bun.file(file).exists()) throw new Error('缓存已清理，请重新解析视频');
    if (!job.artifact.hls) return serveFile(file, request, job.key);
    const name = new URL(request.url).pathname.split('/').pop()!;
    if (name === 'media.m3u8') {
      const playlist = await fs.readFile(file, 'utf8');
      const stat = await fs.stat(file);
      await fs.utimes(file, new Date(), stat.mtime).catch(() => {});
      const headers = new Headers({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store',
        'Content-Length': String(Buffer.byteLength(playlist)) });
      if (request.headers.get('Connection')?.toLowerCase() === 'close') headers.set('Connection', 'close');
      return new Response(request.method === 'HEAD' ? null : playlist, { headers });
    }
    if (!hlsAsset.test(name)) return new Response('没有此分片', { status: 404 });
    const asset = path.join(path.dirname(file), name);
    if (!await Bun.file(asset).exists()) return new Response('分片尚未生成或已清理', { status: 404 });
    return serveFile(asset, request, `${job.key}-${name}`, name.endsWith('.m4s') ? 'video/iso.segment' : 'video/mp4');
  }
  const headers = new Headers(resource.headers);
  headers.set('Accept-Encoding', 'identity');
  for (const key of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  const response = await fetch(resource.url, {
    method: request.method, headers, proxy: proxyUrl(), verbose: config.debugFetch,
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
  });
  const contentType = response.headers.get('Content-Type') || '';
  const isPlaylist = /mpegurl/i.test(contentType) || /\.m3u8(?:\?|$)/i.test(resource.url);
  if (response.ok && isPlaylist && request.method !== 'HEAD') {
    const text = await response.text();
    return new Response(rewritePlaylist(text, response.url || resource.url, resource.headers), {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' },
    });
  }
  const outputHeaders = new Headers();
  for (const key of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
    const value = response.headers.get(key);
    if (value) outputHeaders.set(key, value);
  }
  if (response.headers.has('Content-Encoding') || isPlaylist) outputHeaders.delete('Content-Length');
  outputHeaders.set('Cache-Control', 'no-store');
  if (request.headers.get('Connection')?.toLowerCase() === 'close') outputHeaders.set('Connection', 'close');
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: outputHeaders });
}
