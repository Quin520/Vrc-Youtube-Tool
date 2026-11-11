// Optional network integration check. Does not read browser cookies or write credentials.
// TEST_YTDLP, TEST_FFMPEG and TEST_FFPROBE point to the three executables.
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import config from '../src/config.ts';
import app from '../src/server.ts';
import { getResource } from '../src/resolveService.ts';
import { runProcess } from '../src/process.ts';
import { selectedFormats } from '../src/media.ts';
import { cancelAllJobs } from '../src/lossless.ts';
import { checkFfmpeg } from '../src/ffmpeg.ts';

config.ytdlp = process.env.TEST_YTDLP!;
config.ffmpeg = process.env.TEST_FFMPEG!;
const ffprobe = process.env.TEST_FFPROBE!;
if (!config.ytdlp || !config.ffmpeg || !ffprobe) throw new Error('Set TEST_YTDLP, TEST_FFMPEG and TEST_FFPROBE');
config.proxy = process.env.TEST_PROXY || '127.0.0.1:7890';
config.proxyYtdlp = config.proxy;
config.streamMode = process.env.TEST_HLS
  ? process.env.TEST_COMPATIBLE ? 'lossless-hls-compatible' : 'lossless-hls'
  : process.env.TEST_COMPATIBLE ? 'lossless-compatible' : 'lossless';
config.cacheDir = path.resolve(process.env.TEST_CACHE_DIR || '.local/live-cache');
const { boundedRequests } = await checkFfmpeg(config.ffmpeg);
const networkArgs = (input: string, headers?: Record<string, string>) => {
  const args = ['-http_proxy', /^https?:/.test(config.proxy) ? config.proxy : `http://${config.proxy}`, '-rw_timeout', '30000000'];
  if (boundedRequests && !/\.m3u8(?:\?|$)|\/manifest\//.test(input)) {
    args.push('-request_size', '8388608', '-initial_request_size', '1048576', '-multiple_requests', '1');
  }
  if (headers && Object.keys(headers).length) args.push('-headers', Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join(''));
  return args;
};
const url = Bun.argv[2] || 'https://youtu.be/-PTe8zkYt9A';
app.listen({ hostname: '127.0.0.1', port: 0, idleTimeout: 255 });
config.port = app.server!.port!;

try {
  const started = performance.now();
  const parsed = await fetch(`http://127.0.0.1:${config.port}/fetch-link`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  }).then(response => response.json()) as { code: number; text?: string; quality?: object; error?: string };
  if (parsed.code !== 0 || !parsed.text) throw new Error(parsed.error || 'Resolution failed');
  const resolveMs = Math.round(performance.now() - started);
  console.log(JSON.stringify({ stage: 'resolved', resolveMs, ...parsed.quality }));
  const resource = getResource(new URL(parsed.text).pathname.split('/')[2]!)!;
  if (resource.kind !== 'file') throw new Error('Expected a lossless cache job');
  await resource.job.playable;
  const firstPlayableMs = Math.round(performance.now() - started);
  const playableBeforeComplete = resource.job.state !== 'ready';
  if (resource.job.artifact.hls) {
    const early = await fetch(parsed.text);
    if (!early.ok || !(await early.text()).includes('#EXTINF:')) throw new Error('Early HLS playlist failed');
    await runProcess(config.ffmpeg, ['-v', 'error', '-xerror', '-i', parsed.text, '-t', '1', '-f', 'null', '-'], { timeoutMs: 60_000 });
  }
  const file = await resource.job.ready;
  const prepareMs = Math.round(performance.now() - started);
  const probe = JSON.parse(await runProcess(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  const streams = probe.streams.map((s: any) => ({ codec: s.codec_name, width: s.width, height: s.height,
    fps: s.r_frame_rate, sampleRate: s.sample_rate, channels: s.channels }));
  const head = await fetch(parsed.text, { method: 'HEAD' });
  const bytes = await fs.readFile(file);
  const segment = resource.job.artifact.hls ? bytes.toString().split(/\r?\n/).find(line => /^segment/.test(line))! : undefined;
  const rangeUrl = segment ? new URL(segment, parsed.text).href : parsed.text;
  const expectedRange = segment ? await fs.readFile(path.join(path.dirname(file), segment)) : bytes;
  const ranged = await fetch(rangeUrl, { headers: { Range: 'bytes=1024-2047' } });
  const rangeBytes = Buffer.from(await ranged.arrayBuffer());
  if (head.status !== 200 || Number(head.headers.get('Content-Length')) !== bytes.length
    || ranged.status !== 206 || !rangeBytes.equals(expectedRange.subarray(1024, 2048))) throw new Error('HTTP range or HEAD failed');
  const seekSeconds = Math.max(0, (resource.job.info.duration ?? 8) - 3);
  await runProcess(config.ffmpeg, ['-v', 'error', '-xerror', '-ss', String(seekSeconds), '-i', parsed.text, '-t', '1', '-f', 'null', '-'], { timeoutMs: 60_000 });

  const packetHashes = async (input: string, selector: string, headers?: Record<string, string>) => {
    const args = ['-v', 'error'];
    if (/^https?:/.test(input)) {
      args.push(...networkArgs(input, headers));
    }
    args.push('-select_streams', selector, '-show_packets', '-show_data_hash', 'sha256',
      '-show_entries', 'packet=data_hash', '-of', 'json', input);
    const result = JSON.parse(await runProcess(ffprobe, args, { timeoutMs: 180_000 }));
    return result.packets.map((packet: { data_hash: string }) => packet.data_hash) as string[];
  };
  const formats = selectedFormats(resource.job.info);
  const video = formats.find(f => f.vcodec && f.vcodec !== 'none')!;
  const audio = formats.find(f => f.acodec && f.acodec !== 'none')!;
  const outputVideo = probe.streams.find((s: any) => s.codec_type === 'video');
  const [fpsNumerator, fpsDenominator] = outputVideo.r_frame_rate.split('/').map(Number);
  if (outputVideo.width !== video.width || outputVideo.height !== video.height
    || (video.fps && Math.abs(fpsNumerator / fpsDenominator - video.fps) > 0.01)) throw new Error('Resolution or frame rate changed');
  const comparisons = [];
  for (const [name, selected, selector] of [['video', video, 'v:0'], ['audio', audio, 'a:0']] as const) {
    const original = await packetHashes(selected.url, selector, { ...resource.job.info.http_headers, ...selected.http_headers });
    const copied = await packetHashes(file, selector);
    const identical = original.length === copied.length && original.every((hash, index) => hash === copied[index]);
    let decodedIdentical: boolean | undefined;
    if (!identical) {
      // MP4 removes AV1 temporal delimiters and ADTS transport headers. Compare content
      // after decoding in that case, rather than misreporting repackaging as quality loss.
      const hashes = [];
      for (const input of [selected.url, file]) {
        const args = ['-v', 'error'];
        if (/^https?:/.test(input)) {
          const headers = { ...resource.job.info.http_headers, ...selected.http_headers };
          args.push(...networkArgs(input, headers));
        }
        args.push('-i', input, '-map', `0:${selector}`);
        if (name === 'video') args.push('-fps_mode', 'passthrough');
        args.push('-f', 'hash', '-hash', 'sha256', '-');
        hashes.push((await runProcess(config.ffmpeg, args, { timeoutMs: 15 * 60_000 })).trim());
      }
      decodedIdentical = hashes[0] === hashes[1];
      if (!decodedIdentical) throw new Error(`${name} decoded content changed`);
    }
    comparisons.push({ stream: name, packets: original.length, sha256Identical: identical, decodedSha256Identical: decodedIdentical });
  }
  const report = { testedAt: new Date().toISOString(), mode: config.streamMode, quality: parsed.quality,
    resolveMs, firstPlayableMs, playableBeforeComplete, prepareMs, bytes: resource.job.bytes, streams, packetComparisons: comparisons,
    head: head.status, range: ranged.status, seekDecode: true, seekSeconds,
    outputFileSha256: createHash('sha256').update(bytes).digest('hex'), outputFileKind: resource.job.artifact.hls ? 'playlist' : 'mp4' };
  const reportPath = path.resolve('.local', `live-report-${config.streamMode}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await cancelAllJobs(); await app.stop(true); }
