import { afterAll, beforeAll, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import config, { getFormatSelector } from '../src/config.ts';
import { artifactFor, artifactBytes, trimCache } from '../src/cache.ts';
import { createLosslessJob, cancelAllJobs, cacheStatus } from '../src/lossless.ts';
import { progressReader } from '../src/ffmpeg.ts';
import { relayResource, serveFile } from '../src/relay.ts';
import app from '../src/server.ts';
import { runProcess } from '../src/process.ts';
import type { MediaInfo } from '../src/media.ts';
import type { Resource } from '../src/resolveService.ts';

const ffmpeg = process.env.TEST_FFMPEG;
const ffprobe = process.env.TEST_FFPROBE;
const work = path.resolve('.local', 'tasks-' + Date.now());
const original = { ...config };
let source: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  await fs.mkdir(work, { recursive: true });
  config.proxy = ''; config.ffmpeg = ffmpeg || '';
  config.cacheDir = path.join(work, 'cache'); config.cacheMaxBytes = 64 * 1024 ** 2;
  config.streamMode = 'lossless'; config.prepareTimeoutMs = 30_000;
  if (!ffmpeg || !ffprobe) return;
  await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
    '-t', '16', '-c:v', 'mpeg4', '-q:v', '4', '-g', '24', '-movflags', '+faststart', path.join(work, 'video.mp4')]);
  await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '16', '-c:a', 'aac', '-movflags', '+faststart', path.join(work, 'audio.m4a')]);
  await fs.writeFile(path.join(work, 'truncated.mp4'), (await fs.readFile(path.join(work, 'video.mp4'))).subarray(0, 1_048_576));
  // Keep Content-Length on the throttled origin, as a real CDN does. Bun's
  // ReadableStream response replaces it with chunked framing, which FFmpeg's
  // bounded HTTP reader cannot reliably resume across ranges.
  source = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url!, 'http://127.0.0.1');
      if (!['/video.mp4', '/audio.m4a', '/truncated.mp4'].includes(url.pathname)) { outgoing.writeHead(404).end(); return; }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(key, value);
      const request = new Request(url.href, { method: incoming.method, headers });
      const response = await serveFile(path.join(work, url.pathname.slice(1)), request, 'source');
      const bytes = new Uint8Array(await response.arrayBuffer());
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!url.searchParams.has('slow')) { outgoing.end(bytes); return; }
      for (let position = 0; position < bytes.length; position += 4096) {
        await Bun.sleep(20);
        if (outgoing.destroyed) return;
        outgoing.write(bytes.subarray(position, position + 4096));
      }
      outgoing.end();
    } catch { outgoing.destroy(); }
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + (source.address() as AddressInfo).port;
});
afterAll(async () => { await cancelAllJobs(); source?.closeAllConnections(); source?.close(); Object.assign(config, original); });

function fixture(id: string, slow = false): MediaInfo {
  return { id, title: 'Local integration fixture', duration: 16, format_id: 'video+audio', url: '',
    requested_formats: [
      { format_id: 'video', url: base + '/video.mp4' + (slow ? '?slow=1' : ''), vcodec: 'mpeg4', acodec: 'none', width: 320, height: 180, fps: 24 },
      { format_id: 'audio', url: base + '/audio.m4a' + (slow ? '?slow=1' : ''), vcodec: 'none', acodec: 'aac' },
    ],
  };
}
const resource = (job: Awaited<ReturnType<typeof createLosslessJob>>): Resource => ({ kind: 'file', job, key: job.id, expires: Date.now() + 60_000 });
const control = async (url: string, token?: string) => app.handle(new Request('http://127.0.0.1' + url, {
  method: 'POST', headers: token ? { 'X-Control-Token': token } : {},
}));

test('HLS modes retain the same quality selectors and progress handles split records', () => {
  expect(getFormatSelector('lossless-hls')).toBe(getFormatSelector('lossless'));
  expect(getFormatSelector('lossless-hls-compatible')).toBe(getFormatSelector('lossless-compatible'));
  const updates: unknown[] = [];
  const read = progressReader((seconds, speed) => updates.push([seconds, speed]));
  read('out_time_us=450'); read('0000\nspeed=2.5x\nprogress=cont'); read('inue\nout_time_us=8000000\nspeed=N/A\nprogress=end\n');
  expect(updates).toEqual([[4.5, 2.5], [8, undefined]]);
});

test('dashboard controls require a local token and reject unrelated browser origins', async () => {
  const page = await app.handle(new Request('http://127.0.0.1/'));
  expect(page.headers.get('Content-Type')).toContain('text/html');
  expect(await page.text()).toContain('YouTube 播放任务');
  const status = await (await app.handle(new Request('http://127.0.0.1/status'))).json() as { version: string; controlToken: string };
  expect(status.version).toBe('1.3.0');
  expect((await control('/jobs/missing/cancel')).status).toBe(403);
  expect((await control('/jobs/missing/cancel', status.controlToken)).status).toBe(404);
  expect((await control('/jobs/missing/retry', status.controlToken)).status).toBe(404);
  expect((await app.handle(new Request('http://127.0.0.1/status', { headers: { Origin: 'https://unrelated.example' } }))).status).toBe(403);
  const badMode = await app.handle(new Request('http://127.0.0.1/fetch-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://youtu.be/-PTe8zkYt9A', mode: 'invalid' }),
  }));
  expect(badMode.status).toBe(422);
});

test.skipIf(!ffmpeg || !ffprobe)('HLS starts before download completes, preserves packets and supports seeking after completion', async () => {
  const [job, same] = await Promise.all([createLosslessJob(fixture('hls-copy', true), 'lossless-hls'), createLosslessJob(fixture('hls-copy', true), 'lossless-hls')]);
  expect(job).toBe(same);
  await job.playable;
  expect(job.state).toBe('preparing');
  const current = cacheStatus().find(item => item.id === job.id)!;
  expect(current.availableSeconds).toBeGreaterThan(0);
  expect(current.availableSeconds).toBeLessThan(16);
  const req = (name: string, init?: RequestInit) => new Request('http://127.0.0.1/video/fixture/' + name, init);
  const early = await relayResource(resource(job), req('media.m3u8'));
  expect(early.headers.get('Cache-Control')).toBe('no-store');
  const playlist = await early.text();
  expect(playlist).toContain('init.mp4');
  expect(playlist).not.toContain('#EXT-X-ENDLIST');
  const segment = playlist.split(/\r?\n/).find(line => line.startsWith('segment'))!;
  const ranged = await relayResource(resource(job), req(segment, { headers: { Range: 'bytes=5-99' } }));
  expect(ranged.status).toBe(206);
  expect(Buffer.from(await ranged.arrayBuffer()).equals((await fs.readFile(path.join(path.dirname(job.file), segment))).subarray(5, 100))).toBe(true);
  expect((await relayResource(resource(job), req('index.m3u8.tmp'))).status).toBe(404);
  const head = await relayResource(resource(job), req('media.m3u8', { method: 'HEAD' }));
  expect((await head.arrayBuffer()).byteLength).toBe(0);
  await job.ready;
  expect(await (await relayResource(resource(job), req('media.m3u8'))).text()).toContain('#EXT-X-ENDLIST');
  const packets = async (input: string, stream: string) => {
    const json = JSON.parse(await runProcess(ffprobe!, ['-v', 'error', '-select_streams', stream,
      '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', input]));
    return json.packets.map((packet: { data_hash: string }) => packet.data_hash);
  };
  expect(await packets(job.file, 'v:0')).toEqual(await packets(path.join(work, 'video.mp4'), 'v:0'));
  expect(await packets(job.file, 'a:0')).toEqual(await packets(path.join(work, 'audio.m4a'), 'a:0'));
  const relay = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => relayResource(resource(job), request) });
  try {
    await runProcess(ffmpeg!, ['-v', 'error', '-ss', '11', '-i', 'http://127.0.0.1:' + relay.port + '/media.m3u8', '-t', '1', '-f', 'null', '-']);
    const metadata = JSON.parse(await runProcess(ffprobe!, ['-v', 'error', '-show_streams', '-of', 'json', job.file]));
    expect(metadata.streams.find((s: any) => s.codec_type === 'video').r_frame_rate).toBe('24/1');
    const video = metadata.streams.find((s: any) => s.codec_type === 'video');
    const audio = metadata.streams.find((s: any) => s.codec_type === 'audio');
    expect(Math.abs(Number(video.start_time) - Number(audio.start_time))).toBeLessThan(0.05);
  } finally { relay.stop(true); }
}, 30_000);

test.skipIf(!ffmpeg || !ffprobe)('cancellation removes partial HLS, unblocks the queue and preserves queued settings', async () => {
  const first = await createLosslessJob(fixture('cancel-active', true), 'lossless-hls');
  await first.playable;
  const queued = await createLosslessJob(fixture('cancel-queued'), 'lossless');
  const next = await createLosslessJob(fixture('after-cancel'), 'lossless');
  expect(queued.state).toBe('queued');
  const status = await (await app.handle(new Request('http://127.0.0.1/status'))).json() as { controlToken: string };
  expect(JSON.stringify(status)).not.toContain(base);
  expect(JSON.stringify(status)).not.toContain('http_headers');
  expect((await control('/jobs/' + queued.id + '/cancel', status.controlToken)).status).toBe(202);
  await expect(queued.ready).rejects.toThrow('取消');
  expect((await control('/jobs/' + queued.id + '/cancel', status.controlToken)).status).toBe(409);
  const disconnect = new AbortController();
  const request = relayResource(resource(next), new Request('http://127.0.0.1/video/media.mp4', { signal: disconnect.signal }));
  disconnect.abort();
  await expect(request).rejects.toThrow('断开');
  expect(next.state).toBe('queued');
  const settings = { ffmpeg: config.ffmpeg, proxy: config.proxy, cacheDir: config.cacheDir };
  Object.assign(config, { ffmpeg: 'deliberately-missing-ffmpeg', proxy: '127.0.0.1:1', cacheDir: path.join(work, 'wrong-cache') });
  try {
    expect((await control('/jobs/' + first.id + '/cancel', status.controlToken)).status).toBe(202);
    await expect(first.ready).rejects.toThrow('取消');
    expect(first.state).toBe('cancelled');
    expect(await artifactBytes(first.artifact)).toBe(0);
    expect(await Bun.file(first.file).exists()).toBe(false);
    await next.ready;
    expect(next.state).toBe('ready');
    expect(next.file.startsWith(settings.cacheDir)).toBe(true);
    expect((await control('/jobs/' + next.id + '/retry', status.controlToken)).status).toBe(409);
  } finally { Object.assign(config, settings); }
  const old = new Date(Date.now() - 600_000);
  next.lastUsed = old.getTime();
  await fs.utimes(next.file, old, old);
  const cleaned = await control('/cache/clear', status.controlToken);
  expect(cleaned.status).toBe(200);
  expect(next.state).toBe('evicted');
  expect(next.isPlayable).toBe(false);
}, 30_000);

test.skipIf(!ffmpeg || !ffprobe)('truncated input is a failed task, never a successful partial movie', async () => {
  for (const mode of ['lossless', 'lossless-hls'] as const) {
    const info = fixture('truncated-' + mode);
    info.requested_formats![0]!.url = base + '/truncated.mp4';
    const job = await createLosslessJob(info, mode);
    await expect(job.ready).rejects.toThrow();
    expect(job.state).toBe('failed');
    expect(await Bun.file(job.file).exists()).toBe(false);
    expect(await artifactBytes(job.artifact)).toBe(0);
  }
}, 20_000);

test('cache quota counts MP4 and HLS together and cleanup preserves unknown or protected files', async () => {
  const root = path.join(work, 'quota');
  const mp4 = artifactFor(root, 'a'.repeat(64), false);
  const hls = artifactFor(root, 'b'.repeat(64), true);
  await fs.mkdir(path.dirname(mp4.file), { recursive: true });
  await fs.mkdir(path.dirname(hls.file), { recursive: true });
  await fs.writeFile(mp4.file, Buffer.alloc(100));
  await fs.writeFile(hls.file, '#EXTM3U\n');
  await fs.writeFile(path.join(path.dirname(hls.file), 'segment000000.m4s'), Buffer.alloc(100));
  const unknown = path.join(path.dirname(hls.file), 'keep-this.dat');
  await fs.writeFile(unknown, 'user data');
  const old = new Date(Date.now() - 600_000);
  await fs.utimes(mp4.file, old, old); await fs.utimes(hls.file, old, old);
  await expect(trimCache(root, 100, 0, new Set([mp4.file, hls.file]))).rejects.toThrow('缓存空间不足');
  const result = await trimCache(root, 100, 0, new Set([mp4.file]), true);
  expect(result.usedBytes).toBe(100);
  expect(result.freedBytes).toBe(108);
  expect(await Bun.file(mp4.file).exists()).toBe(true);
  expect(await Bun.file(hls.file).exists()).toBe(false);
  expect(await fs.readFile(unknown, 'utf8')).toBe('user data');
});
