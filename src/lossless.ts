import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createLogg } from '@guiiai/logg';
import config, { proxyUrl } from './config.ts';
import { qualitySummary, selectedFormats, type MediaInfo } from './media.ts';
import { runProcess, safeError } from './process.ts';

const log = createLogg('无损封装').useGlobalConfig();
export interface LosslessJob {
  key: string;
  file: string;
  info: MediaInfo;
  state: 'queued' | 'preparing' | 'ready' | 'failed';
  bytes: number;
  error?: string;
  lastUsed: number;
  ready: Promise<string>;
}
const jobs = new Map<string, LosslessJob>();
let queue: Promise<unknown> = Promise.resolve();
let ffmpegChecked = '';
let boundedRequests = false;

export async function checkFfmpeg() {
  if (ffmpegChecked === config.ffmpeg) return;
  try { await runProcess(config.ffmpeg, ['-version'], { timeoutMs: 5000 }); }
  catch { throw new Error('无损模式需要 ffmpeg.exe；请放在工具目录，或设置 [ytdlp] ffmpeg-path'); }
  const httpOptions = await runProcess(config.ffmpeg, ['-hide_banner', '-h', 'protocol=http'], { timeoutMs: 5000 }).catch(() => '');
  boundedRequests = /-request_size\s/.test(httpOptions) && /-initial_request_size\s/.test(httpOptions);
  ffmpegChecked = config.ffmpeg;
}

export function buildRemuxArgs(info: MediaInfo, output: string) {
  const formats = selectedFormats(info);
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
  for (const format of formats) {
    args.push('-rw_timeout', '15000000', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
    // YouTube may throttle an unbounded HTTP request. FFmpeg 8.1+ can read the same
    // bytes in bounded ranges; older builds retain their original download path.
    if (boundedRequests && ['http', 'https', undefined].includes(format.protocol)) {
      args.push('-request_size', '8388608', '-initial_request_size', '1048576', '-multiple_requests', '1');
    }
    const proxy = proxyUrl();
    if (proxy) args.push('-http_proxy', proxy);
    const headers = { ...info.http_headers, ...format.http_headers };
    const headerText = Object.entries(headers)
      .filter(([key, value]) => /^[\w-]+$/.test(key) && !/[\r\n]/.test(value) && !/^(host|range|content-length|accept-encoding)$/i.test(key))
      .map(([key, value]) => `${key}: ${value}\r\n`).join('');
    if (headerText) args.push('-headers', headerText);
    args.push('-i', format.url);
  }
  const videoIndex = formats.findIndex(f => f.vcodec && f.vcodec !== 'none');
  const audioIndex = formats.findIndex(f => f.acodec && f.acodec !== 'none');
  if (videoIndex < 0 || audioIndex < 0) throw new Error('视频或音轨缺失');
  // Copy the original compressed packets. No encoder, scaling or frame-rate conversion.
  args.push('-map', `${videoIndex}:v:0`, '-map', `${audioIndex}:a:0`,
    '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy',
    '-movflags', '+faststart', '-f', 'mp4', output);
  return args;
}

async function pruneCache(root: string, reserve: number, keep: string) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.filter(e => e.isFile() && /^[a-f0-9]{64}\.mp4$/.test(e.name)).map(async e => {
    const file = path.join(root, e.name);
    return { file, stat: await fs.stat(file) };
  }));
  let total = files.reduce((sum, file) => sum + file.stat.size, 0);
  for (const item of files.sort((a, b) => a.stat.atimeMs - b.stat.atimeMs)) {
    if (total + reserve <= config.cacheMaxBytes) break;
    if (item.file === keep || [...jobs.values()].some(j => j.file === item.file && Date.now() - j.lastUsed < 120_000)) continue;
    try { await fs.unlink(item.file); total -= item.stat.size; } catch { /* A player may still hold the file open. */ }
  }
  if (total + reserve > config.cacheMaxBytes) throw new Error('缓存空间不足；等待当前视频播放完成，或增大 cache-max-gb');
}

async function prepare(job: LosslessJob) {
  const root = path.dirname(job.file);
  await fs.mkdir(root, { recursive: true });
  const existing = await fs.stat(job.file).catch(() => undefined);
  if (existing?.size) {
    job.bytes = existing.size;
    job.state = 'ready';
    return job.file;
  }
  const formats = selectedFormats(job.info);
  const estimate = formats.reduce((sum, f) => sum + (f.filesize ?? f.filesize_approx ?? 0), 0);
  const reserve = Math.ceil(estimate * 1.1) || Math.min(512 * 1024 ** 2, config.cacheMaxBytes);
  if (reserve > config.cacheMaxBytes) throw new Error('视频超过缓存上限，请增大 cache-max-gb；不会自动降低画质');
  await pruneCache(root, reserve, job.file);
  const disk = await fs.statfs(root);
  if (disk.bavail * disk.bsize < reserve + 200 * 1024 ** 2) throw new Error('磁盘空间不足，无法保存原始画质的视频');
  const partial = job.file.replace(/\.mp4$/, '.partial.mp4');
  const abort = new AbortController();
  let limitError = '';
  job.state = 'preparing';
  log.withFields(qualitySummary(job.info)).log('下载并封装原始音视频，首次加载需要等待');
  const monitor = setInterval(async () => {
    job.bytes = (await fs.stat(partial).catch(() => undefined))?.size ?? 0;
    if (job.bytes > config.cacheMaxBytes) { limitError = '视频超过缓存上限；不会自动降低画质'; abort.abort(); }
    const disk = await fs.statfs(root).catch(() => undefined);
    if (disk && disk.bavail * disk.bsize < 100 * 1024 ** 2) { limitError = '磁盘剩余空间不足，已停止缓存'; abort.abort(); }
  }, 1000);
  try {
    await runProcess(config.ffmpeg, buildRemuxArgs(job.info, partial), {
      timeoutMs: config.prepareTimeoutMs, signal: abort.signal,
    });
    const stat = await fs.stat(partial);
    if (!stat.size) throw new Error('封装没有生成视频数据');
    if (stat.size > config.cacheMaxBytes) throw new Error('视频超过缓存上限；不会自动降低画质');
    await pruneCache(root, stat.size, job.file);
    await fs.rename(partial, job.file);
    job.bytes = stat.size;
    job.state = 'ready';
    log.withFields({ videoId: job.info.id, bytes: job.bytes }).log('无损封装完成，可以播放和拖动进度');
    return job.file;
  } catch (error) {
    await fs.unlink(partial).catch(() => {});
    if (limitError) throw new Error(limitError);
    throw error;
  } finally { clearInterval(monitor); }
}

export async function createLosslessJob(info: MediaInfo): Promise<LosslessJob> {
  if (info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming') {
    throw new Error('原始画质缓存模式用于点播视频；直播请手动选择 hls-direct 模式');
  }
  qualitySummary(info);
  await checkFfmpeg();
  const formats = selectedFormats(info);
  const key = createHash('sha256').update(JSON.stringify(['mp4-copy-v1', info.id, formats.map(f => f.format_id), info.duration])).digest('hex');
  const file = path.resolve(config.cacheDir, 'lossless-v1', `${key}.mp4`);
  const previous = jobs.get(file);
  if (previous && previous.state !== 'failed' && (previous.state !== 'ready' || await Bun.file(file).exists())) {
    previous.lastUsed = Date.now();
    return previous;
  }
  if ([...jobs.values()].filter(j => j.state === 'queued' || j.state === 'preparing').length >= 4) {
    throw new Error('已有多个视频等待准备，请稍后再试');
  }
  for (const [id, job] of jobs) {
    if (job.state !== 'preparing' && job.state !== 'queued' && Date.now() - job.lastUsed > 6 * 3600_000) jobs.delete(id);
  }
  const job: LosslessJob = { key, file, info, state: 'queued', bytes: 0, lastUsed: Date.now(), ready: Promise.resolve(file) };
  jobs.set(file, job);
  job.ready = queue.then(() => prepare(job)).catch(error => {
    job.state = 'failed';
    job.error = safeError(error);
    log.withFields({ videoId: info.id, error: job.error }).error('封装失败，没有自动改用低清版本');
    throw error;
  });
  // A single worker bounds CPU, bandwidth and temporary disk use. Rejections are observed
  // even when a player abandons the URL before requesting it.
  queue = job.ready.catch(() => {});
  return job;
}

export function cacheStatus() {
  return [...jobs.values()].map(job => ({ ...qualitySummary(job.info), state: job.state, bytes: job.bytes, error: job.error }));
}
