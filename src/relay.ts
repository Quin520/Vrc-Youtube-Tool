import * as fs from 'node:fs/promises';
import config, { proxyUrl } from './config.ts';
import { getProxyUrl, type Resource } from './resolveService.ts';

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

export async function serveFile(file: string, request: Request, etag: string) {
  const stat = await fs.stat(file);
  // Touch access time, keeping modification time and validators stable.
  await fs.utimes(file, new Date(), stat.mtime).catch(() => {});
  const headers = new Headers({
    'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'ETag': `"${etag}"`,
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

export async function relayResource(resource: Resource, request: Request): Promise<Response> {
  if (resource.kind === 'file') {
    resource.job.lastUsed = Date.now();
    const file = await resource.job.ready;
    if (!await Bun.file(file).exists()) throw new Error('缓存已清理，请重新解析视频');
    return serveFile(file, request, resource.job.key);
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
