import { afterAll, beforeAll, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import config, { getFormatSelector } from '../src/config.ts';
import { normalizeYoutubeUrl } from '../src/youtube.ts';
import { getProxyUrl, getResource } from '../src/resolveService.ts';
import { relayResource, rewritePlaylist, serveFile } from '../src/relay.ts';
import app from '../src/server.ts';
import { createLosslessJob } from '../src/lossless.ts';
import { runProcess } from '../src/process.ts';
import type { MediaInfo } from '../src/media.ts';

const work = path.resolve('.local', `tests-${Date.now()}`);
let upstream: ReturnType<typeof Bun.serve>;
let upstreamBase: string;
const payload = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
const originalConfig = { ...config };

beforeAll(async () => {
  await fs.mkdir(work, { recursive: true });
  await fs.writeFile(path.join(work, 'bytes.mp4'), payload);
  config.proxy = '';
  config.cacheDir = path.join(work, 'cache');
  config.cacheMaxBytes = 32 * 1024 ** 2;
  upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const name = new URL(request.url).pathname.slice(1);
    if (!['bytes.mp4', 'video.mp4', 'audio.m4a'].includes(name)) return new Response(null, { status: 404 });
    return serveFile(path.join(work, name), request, 'fixture');
  } });
  upstreamBase = `http://127.0.0.1:${upstream.port}`;
});
afterAll(() => { upstream.stop(true); Object.assign(config, originalConfig); });

test('normalizes links shared by others and rejects misleading hosts', () => {
  for (const url of [
    'https://youtu.be/-PTe8zkYt9A?si=share',
    'https://m.youtube.com/shorts/-PTe8zkYt9A',
    'https://www.youtube.com/live/-PTe8zkYt9A',
    'https://www.youtube-nocookie.com/embed/-PTe8zkYt9A',
    'https://www.youtube.com/watch?v=-PTe8zkYt9A&list=ignored',
  ]) expect(normalizeYoutubeUrl(url)).toBe('https://www.youtube.com/watch?v=-PTe8zkYt9A');
  for (const url of ['https://youtube.com.bad.test/watch?v=-PTe8zkYt9A',
    'https://localhost.youtube.com/watch?v=-PTe8zkYt9A', 'https://www.youtube.com/playlist?list=abc',
    'file://youtube.com/watch?v=-PTe8zkYt9A']) expect(() => normalizeYoutubeUrl(url)).toThrow();
});

test('rewrites nested HLS playlists, keys, maps and relative segment URLs', () => {
  const text = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/list.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="../key"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nsegment.m4s?token=abc\n';
  const output = rewritePlaylist(text, 'https://video.example/path/master.m3u8?sig=private');
  const links = [...output.matchAll(/http:\/\/[^\s"]+/g)].map(match => match[0]);
  const targets = links.map(link => {
    const resource = getResource(new URL(link).pathname.split('/')[2]!)!;
    return resource.kind === 'remote' ? resource.url : '';
  });
  expect(targets).toEqual(['https://video.example/path/audio/list.m3u8', 'https://video.example/key',
    'https://video.example/path/init.mp4', 'https://video.example/path/segment.m4s?token=abc']);
  expect(output).toContain('#EXTINF:6,');
});

test('forwards Range and returns exact bytes, not the full video', async () => {
  const link = getProxyUrl(`${upstreamBase}/bytes.mp4`);
  const response = await app.handle(new Request(link, { headers: { Range: 'bytes=1024-2047' } }));
  expect(response.status).toBe(206);
  expect(response.headers.get('Content-Range')).toBe('bytes 1024-2047/4096');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(payload.subarray(1024, 2048));
});

test('cached responses support HEAD, suffix/open ranges, validators and 416', async () => {
  const file = path.join(work, 'bytes.mp4');
  const head = await serveFile(file, new Request('http://localhost/video', { method: 'HEAD' }), 'fixture');
  expect(head.headers.get('Content-Length')).toBe('4096');
  expect((await head.arrayBuffer()).byteLength).toBe(0);
  for (const [range, expected] of [['bytes=-32', payload.subarray(-32)], ['bytes=4000-', payload.subarray(4000)]] as const) {
    const response = await serveFile(file, new Request('http://localhost/video', { headers: { Range: range } }), 'fixture');
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
  }
  const invalid = await serveFile(file, new Request('http://localhost/video', { headers: { Range: 'bytes=5000-' } }), 'fixture');
  expect(invalid.status).toBe(416);
  const changed = await serveFile(file, new Request('http://localhost/video', { headers: { Range: 'bytes=1-2', 'If-Range': '"old"' } }), 'fixture');
  expect(changed.status).toBe(200);
  expect((await changed.arrayBuffer()).byteLength).toBe(4096);
});

test('unknown resources are 404 and unrelated browser origins cannot use the relay', async () => {
  expect((await app.handle(new Request('http://127.0.0.1/video/missing/media.mp4'))).status).toBe(404);
  expect((await app.handle(new Request('http://127.0.0.1/fetch-link', {
    method: 'POST', headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://youtu.be/-PTe8zkYt9A' }),
  }))).status).toBe(403);
});

const ffmpeg = process.env.TEST_FFMPEG;
const ffprobe = process.env.TEST_FFPROBE;
test.skipIf(!ffmpeg || !ffprobe)('real FFmpeg preserves every compressed video/audio packet and supports seeking', async () => {
  config.ffmpeg = ffmpeg!;
  await runProcess(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=320x180:rate=24', '-t', '2', '-c:v', 'mpeg4', '-q:v', '4', '-an', path.join(work, 'video.mp4')]);
  await runProcess(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:a', 'aac', path.join(work, 'audio.m4a')]);
  const info: MediaInfo = {
    id: 'fixture-copy', duration: 2, format_id: 'video+audio', url: '',
    requested_formats: [
      { format_id: 'video', url: `${upstreamBase}/video.mp4`, vcodec: 'mpeg4', acodec: 'none', width: 320, height: 180, fps: 24 },
      { format_id: 'audio', url: `${upstreamBase}/audio.m4a`, vcodec: 'none', acodec: 'aac' },
    ],
  };
  const job = await createLosslessJob(info);
  const same = await createLosslessJob(info);
  expect(same).toBe(job);
  const file = await job.ready;
  const packets = async (input: string, stream: string) => {
    const json = JSON.parse(await runProcess(ffprobe!, ['-v', 'error', '-select_streams', stream,
      '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', input]));
    return json.packets.map((packet: { data_hash: string }) => packet.data_hash);
  };
  expect(await packets(file, 'v:0')).toEqual(await packets(path.join(work, 'video.mp4'), 'v:0'));
  expect(await packets(file, 'a:0')).toEqual(await packets(path.join(work, 'audio.m4a'), 'a:0'));
  const infoOut = JSON.parse(await runProcess(ffprobe!, ['-v', 'error', '-show_streams', '-of', 'json', file]));
  expect(infoOut.streams[0].width).toBe(320);
  expect(infoOut.streams[0].height).toBe(180);
  expect(infoOut.streams[0].r_frame_rate).toBe('24/1');
  const seek = await relayResource({ kind: 'file', job, key: job.key, expires: Date.now() + 60_000 },
    new Request('http://localhost/video', { headers: { Range: 'bytes=100-499' } }));
  expect(seek.status).toBe(206);
  expect(Buffer.from(await seek.arrayBuffer()).equals((await fs.readFile(file)).subarray(100, 500))).toBe(true);
  await expect(createLosslessJob({ ...info, is_live: true })).rejects.toThrow('直播');
  const oldLimit = config.cacheMaxBytes;
  config.cacheMaxBytes = 1;
  const tooLarge = await createLosslessJob({ ...info, id: 'exceeds-cache', requested_formats: info.requested_formats!.map(f => ({ ...f, filesize: 1000 })) });
  await expect(tooLarge.ready).rejects.toThrow('缓存上限');
  expect(tooLarge.state).toBe('failed');
  config.cacheMaxBytes = oldLimit;
}, 30_000);

test.skipIf(!process.env.TEST_YTDLP)('yt-dlp selection chooses separate HD streams instead of the 360p combined stream', async () => {
  const input = path.join(work, 'formats.json');
  const formats = [
    { format_id: '18', url: `${upstreamBase}/bytes.mp4`, ext: 'mp4', protocol: 'https', height: 360, width: 640, fps: 24, vcodec: 'avc1.42001E', acodec: 'mp4a.40.2' },
    { format_id: '140', url: `${upstreamBase}/audio.m4a`, ext: 'm4a', protocol: 'https', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128 },
    { format_id: '251', url: `${upstreamBase}/audio.m4a`, ext: 'webm', protocol: 'https', vcodec: 'none', acodec: 'opus', abr: 160 },
    { format_id: '137', url: `${upstreamBase}/video.mp4`, ext: 'mp4', protocol: 'https', height: 1080, width: 1920, fps: 24, vcodec: 'avc1.640028', acodec: 'none' },
    { format_id: '399', url: `${upstreamBase}/video.mp4`, ext: 'mp4', protocol: 'https', height: 1080, width: 1920, fps: 24, vcodec: 'av01.0.08M.08', acodec: 'none' },
  ];
  await fs.writeFile(input, JSON.stringify({ id: 'fixture', title: 'selection fixture', extractor: 'youtube', extractor_key: 'Youtube', webpage_url: 'https://youtube.com/watch?v=-PTe8zkYt9A', formats }));
  for (const mode of ['mp4', 'lossless', 'lossless-compatible'] as const) {
    config.streamMode = mode;
    const info = JSON.parse(await runProcess(process.env.TEST_YTDLP!, ['--ignore-config', '--load-info-json', input,
      '--skip-download', '--dump-single-json', '-f', getFormatSelector()]));
    expect(info.height).toBe(mode === 'mp4' ? 360 : 1080);
    if (mode === 'lossless-compatible') expect(info.format_id).toBe('137+140');
    if (mode === 'lossless') expect(info.requested_formats.length).toBe(2);
  }
}, 20_000);
