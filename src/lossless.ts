import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createLogg } from '@guiiai/logg';
import config, { isHlsMode, proxyUrl, type StreamMode } from './config.ts';
import { qualitySummary, compatibilityNotes, selectedFormats, type MediaInfo } from './media.ts';
import { runProcess, safeError } from './process.ts';
import { buildRemuxArgs, checkFfmpeg, progressReader } from './ffmpeg.ts';
import { artifactFor, artifactBytes, discardPartial, isComplete, playlistReady, trimCache, type Artifact } from './cache.ts';

const log = createLogg('无损播放任务').useGlobalConfig();
type State = 'queued' | 'preparing' | 'cancelling' | 'cancelled' | 'ready' | 'failed' | 'evicted';
export interface LosslessJob {
  id: string;
  key: string;
  file: string;
  artifact: Artifact;
  mode: StreamMode;
  info: MediaInfo;
  state: State;
  bytes: number;
  mediaSeconds: number;
  availableSeconds: number;
  speed?: number;
  error?: string;
  lastUsed: number;
  isPlayable: boolean;
  ready: Promise<string>;
  playable: Promise<string>;
}
function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
interface ManagedJob extends LosslessJob {
  abort: AbortController;
  done: ReturnType<typeof deferred>;
  first: ReturnType<typeof deferred>;
  settings: { ffmpeg: string; proxy?: string; timeoutMs: number; maxBytes: number; boundedRequests: boolean };
}
const jobs = new Map<string, ManagedJob>();
const latest = new Map<string, string>();
const creating = new Map<string, Promise<LosslessJob>>();
let queue: Promise<unknown> = Promise.resolve();
const active = (job: LosslessJob) => ['queued', 'preparing', 'cancelling'].includes(job.state);
const protectedFiles = () => new Set([...jobs.values()].filter(job => active(job) || Date.now() - job.lastUsed < 120_000).map(job => job.file));

async function maintainCache(root: string, maxBytes: number, reserve = 0, clear = false) {
  const result = await trimCache(root, maxBytes, reserve, protectedFiles(), clear);
  if (result.freedBytes) {
    for (const job of jobs.values()) {
      if (job.state === 'ready' && job.artifact.root === root && !await isComplete(job.artifact)) {
        job.state = 'evicted'; job.isPlayable = false; job.availableSeconds = 0; job.bytes = 0;
        job.error = '缓存已清理，可以重新解析';
      }
    }
  }
  return result;
}

function markPlayable(job: ManagedJob) {
  if (job.isPlayable || job.abort.signal.aborted) return;
  job.isPlayable = true;
  job.first.resolve(job.file);
}

async function prepare(job: ManagedJob) {
  const { artifact, settings } = job;
  let touched = false;
  let monitor: ReturnType<typeof setInterval> | undefined;
  let monitoring: Promise<void> | undefined;
  let failure: string | undefined;
  try {
    if (job.abort.signal.aborted) throw new Error('处理已取消');
    await fs.mkdir(path.dirname(artifact.file), { recursive: true });
    if (await isComplete(artifact)) {
      job.bytes = artifact.hls ? await artifactBytes(artifact) : (await fs.stat(artifact.file)).size;
    } else {
      const estimate = selectedFormats(job.info).reduce((sum, f) => sum + (f.filesize ?? f.filesize_approx ?? 0), 0);
      const reserve = Math.ceil(estimate * 1.1) || Math.max(1, Math.min(512 * 1024 ** 2, Math.floor(settings.maxBytes / 4)));
      if (reserve > settings.maxBytes) throw new Error('视频超过缓存上限，请增大 cache-max-gb；不会自动降低画质');
      await discardPartial(artifact);
      await fs.mkdir(path.dirname(artifact.work), { recursive: true });
      touched = true;
      await maintainCache(artifact.root, settings.maxBytes, reserve);
      const disk = await fs.statfs(artifact.root);
      if (disk.bavail * disk.bsize < reserve + 200 * 1024 ** 2) throw new Error('磁盘空间不足，无法缓存原始画质');
      if (job.abort.signal.aborted) throw new Error('处理已取消');
      job.state = 'preparing';
      log.withFields({ ...qualitySummary(job.info), delivery: artifact.hls ? 'hls' : 'mp4' }).log('开始复制源音视频');
      const poll = async () => {
        job.bytes = await artifactBytes(artifact);
        await maintainCache(artifact.root, settings.maxBytes);
        const disk = await fs.statfs(artifact.root);
        if (disk.bavail * disk.bsize < 100 * 1024 ** 2) throw new Error('磁盘剩余空间不足，已停止缓存');
        if (artifact.hls) {
          const text = await fs.readFile(artifact.file, 'utf8').catch(() => '');
          job.availableSeconds = [...text.matchAll(/^#EXTINF:([\d.]+)/gm)].reduce((sum, match) => sum + Number(match[1]), 0);
          if (!job.isPlayable && await playlistReady(artifact)) markPlayable(job);
        }
      };
      monitor = setInterval(() => {
        if (monitoring || job.abort.signal.aborted) return;
        monitoring = poll().catch(error => { failure = safeError(error); job.abort.abort(); }).finally(() => { monitoring = undefined; });
      }, 500);
      await runProcess(settings.ffmpeg, buildRemuxArgs(job.info, artifact.work, {
        proxy: settings.proxy, boundedRequests: settings.boundedRequests, hls: artifact.hls,
      }), {
        timeoutMs: settings.timeoutMs, signal: job.abort.signal, captureOutput: false,
        onStdout: progressReader((seconds, speed) => { job.mediaSeconds = seconds; job.speed = speed; }),
      });
      clearInterval(monitor);
      await monitoring;
      if (job.abort.signal.aborted) throw new Error(failure || '处理已取消');
      job.bytes = await artifactBytes(artifact);
      if (!job.bytes) throw new Error('封装没有生成视频数据');
      await maintainCache(artifact.root, settings.maxBytes);
      if (artifact.hls) {
        if (!await playlistReady(artifact, true)) throw new Error('HLS 分片尚未完整生成');
      } else await fs.rename(artifact.work, artifact.file);
    }
    if (job.abort.signal.aborted) throw new Error('处理已取消');
    job.state = 'ready';
    job.mediaSeconds = job.info.duration ?? job.mediaSeconds;
    job.availableSeconds = job.mediaSeconds;
    markPlayable(job);
    job.done.resolve(job.file);
    log.withFields({ videoId: job.info.id, bytes: job.bytes }).log('无损播放资源已准备完成');
  } catch (error) {
    if (monitor) clearInterval(monitor);
    await monitoring;
    if (touched) {
      await discardPartial(artifact).catch(() => {});
      job.bytes = await artifactBytes(artifact).catch(() => job.bytes);
    }
    job.state = job.abort.signal.aborted && !failure ? 'cancelled' : 'failed';
    job.error = failure || safeError(error);
    job.isPlayable = false;
    job.availableSeconds = 0;
    job.first.reject(new Error(job.error));
    job.done.reject(new Error(job.error));
    if (job.state === 'failed') log.withFields({ videoId: job.info.id, error: job.error }).error('准备失败；可以重新解析后重试');
  } finally { if (monitor) clearInterval(monitor); }
}

export function createLosslessJob(info: MediaInfo, mode: StreamMode = config.streamMode): Promise<LosslessJob> {
  const hls = isHlsMode(mode);
  const key = createHash('sha256').update(JSON.stringify([hls ? 'hls-copy-v1' : 'mp4-copy-v1', info.id,
    (info.requested_formats?.length ? info.requested_formats : [info]).map(f => f.format_id), info.duration])).digest('hex');
  const artifact = artifactFor(config.cacheDir, key, hls);
  const fingerprint = `${artifact.file}|${mode}`;
  const inFlight = creating.get(fingerprint);
  if (inFlight) return inFlight;
  // Snapshot mutable configuration: changing the wizard must not alter an active task.
  const settings = { ffmpeg: config.ffmpeg, proxy: proxyUrl(), timeoutMs: config.prepareTimeoutMs, maxBytes: config.cacheMaxBytes };
  const result = (async (): Promise<LosslessJob> => {
    if (info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming') {
      throw new Error('原始画质准备模式用于点播视频；直播请手动选择 hls-direct 模式');
    }
    qualitySummary(info);
    const previousId = latest.get(fingerprint);
    const previous = previousId ? jobs.get(previousId) : undefined;
    if (previous && (['queued', 'preparing'].includes(previous.state) || (previous.state === 'ready' && await isComplete(artifact)))) {
      previous.lastUsed = Date.now();
      return previous;
    }
    const capability = await checkFfmpeg(settings.ffmpeg);
    if ([...jobs.values()].filter(active).length >= 4) throw new Error('已有多个视频等待准备，请取消不需要的任务或稍后重试');
    for (const [id, job] of jobs) {
      if (!active(job) && (jobs.size >= 128 || Date.now() - job.lastUsed > 6 * 3600_000)) jobs.delete(id);
    }
    for (const [key, id] of latest) if (!jobs.has(id)) latest.delete(key);
    const done = deferred();
    const first = deferred();
    const job: ManagedJob = {
      id: randomUUID(), key, file: artifact.file, artifact, mode, info, state: 'queued', bytes: 0,
      mediaSeconds: 0, availableSeconds: 0, lastUsed: Date.now(), isPlayable: false,
      done, first, ready: done.promise, playable: first.promise, abort: new AbortController(),
      settings: { ...settings, ...capability },
    };
    jobs.set(job.id, job);
    latest.set(fingerprint, job.id);
    queue = queue.then(async () => { if (job.state !== 'cancelled') await prepare(job); }).catch(() => {});
    return job;
  })();
  creating.set(fingerprint, result);
  void result.then(() => creating.delete(fingerprint), () => creating.delete(fingerprint));
  return result;
}

export const getLosslessJob = (id: string): LosslessJob | undefined => jobs.get(id);
export function cancelLosslessJob(id: string) {
  const job = jobs.get(id);
  if (!job || !['queued', 'preparing'].includes(job.state)) return false;
  job.abort.abort();
  job.isPlayable = false;
  if (job.state === 'queued') {
    job.state = 'cancelled'; job.error = '处理已取消';
    job.first.reject(new Error(job.error)); job.done.reject(new Error(job.error));
  } else job.state = 'cancelling';
  return true;
}

export async function cancelAllJobs() {
  for (const job of jobs.values()) cancelLosslessJob(job.id);
  await Promise.allSettled([...jobs.values()].map(job => job.ready));
}

export const clearUnusedCache = () => maintainCache(path.resolve(config.cacheDir), config.cacheMaxBytes, 0, true);

export function cacheStatus() {
  let position = 0;
  return [...jobs.values()].map(job => {
    const duration = job.info.duration;
    const progress = job.state === 'ready' ? 100 : duration ? Math.min(99.9, job.mediaSeconds / duration * 100) : undefined;
    return { id: job.id, ...qualitySummary(job.info), mode: job.mode, delivery: job.artifact.hls ? 'hls' : 'mp4',
      state: job.state, bytes: job.bytes, error: job.error, isPlayable: job.isPlayable,
      progressPercent: progress, mediaSeconds: job.mediaSeconds, availableSeconds: job.availableSeconds, duration,
      queuePosition: job.state === 'queued' ? ++position : undefined,
      remainingSeconds: duration && job.speed && job.state === 'preparing' ? Math.max(0, (duration - job.mediaSeconds) / job.speed) : undefined,
      warnings: compatibilityNotes(job.info, job.artifact.hls),
    };
  });
}
