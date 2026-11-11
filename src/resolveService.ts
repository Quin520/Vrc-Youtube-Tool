import { randomUUID } from 'node:crypto';
import { createLogg } from '@guiiai/logg';
import config, { getYtdlpArgs, isLosslessMode, type StreamMode } from './config.ts';
import { createLosslessJob, getLosslessJob, type LosslessJob } from './lossless.ts';
import { compactMediaInfo, compatibilityNotes, qualitySummary, selectedFormats, type MediaInfo } from './media.ts';
import { runProcess, safeError } from './process.ts';
import { normalizeYoutubeUrl } from './youtube.ts';
import { isComplete } from './cache.ts';

const log = createLogg('解析服务').useGlobalConfig();
export type Resource = ({ kind: 'remote'; url: string; headers: Record<string, string> }
  | { kind: 'file'; job: LosslessJob }) & { expires: number; key: string };
const resources = new Map<string, Resource>();
const resourceKeys = new Map<string, string>();
const resolutions = new Map<string, { expires: number; pending: boolean; result: Promise<ResolveResult> }>();
interface ResolveResult {
  text?: string;
  code: number;
  error?: string;
  quality?: ReturnType<typeof qualitySummary>;
  jobId?: string;
  warnings?: string[];
}

const resourceUrl = (id: string, extension: string) =>
  `http://${config.hostsOk ? 'localhost.youtube.com' : '127.0.0.1'}:${config.port}/video/${id}/media.${extension}`;

function register(key: string, resource: Resource, extension: string) {
  let id = resourceKeys.get(key);
  if (!id || !resources.has(id)) {
    for (const [oldId, old] of resources) {
      if (old.expires < Date.now() || resources.size >= 2048) {
        resources.delete(oldId);
        resourceKeys.delete(old.key);
      }
    }
    id = randomUUID();
    resourceKeys.set(key, id);
  }
  resources.set(id, resource);
  return resourceUrl(id, extension);
}

export function getProxyUrl(url: string, headers: Record<string, string> = {}) {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('不支持的视频资源协议');
  const key = JSON.stringify([url, headers]);
  return register(key, { kind: 'remote', url, headers, key, expires: Date.now() + 6 * 3600_000 },
    /\.m3u8$/i.test(parsed.pathname) ? 'm3u8' : 'mp4');
}

export function getResource(id: string) {
  const resource = resources.get(id);
  if (!resource || resource.expires < Date.now()) return undefined;
  resource.expires = Date.now() + 6 * 3600_000;
  return resource;
}

export function jobPlaybackUrl(jobId: string) {
  const id = resourceKeys.get(`job:${jobId}`);
  const resource = id ? resources.get(id) : undefined;
  return id && resource?.kind === 'file' && resource.expires > Date.now()
    ? resourceUrl(id, resource.job.artifact.hls ? 'm3u8' : 'mp4') : undefined;
}

async function extract(url: string, mode: StreamMode): Promise<ResolveResult> {
  const stdout = await runProcess(config.ytdlp, [...getYtdlpArgs(mode), '--', url]);
  const info = compactMediaInfo(JSON.parse(stdout) as MediaInfo);
  const quality = qualitySummary(info);
  log.withFields(quality).log('选中的源格式');
  if (quality.height && quality.height < quality.highestAvailableHeight) {
    log.warn(`当前模式选择 ${quality.height}p，源视频最高提供 ${quality.highestAvailableHeight}p`);
  }
  if (isLosslessMode(mode)) {
    const job = await createLosslessJob(info, mode);
    const key = `job:${job.id}`;
    return { code: 0, quality, jobId: job.id, warnings: compatibilityNotes(info, job.artifact.hls),
      text: register(key, { kind: 'file', job, key, expires: Date.now() + 6 * 3600_000 }, job.artifact.hls ? 'm3u8' : 'mp4') };
  }
  const format = selectedFormats(info)[0]!;
  return { code: 0, quality, text: getProxyUrl(format.url, { ...info.http_headers, ...format.http_headers }) };
}

export async function resolveVideoLink(input: string, options: { mode?: StreamMode; force?: boolean } = {}): Promise<ResolveResult> {
  try {
    const url = normalizeYoutubeUrl(input);
    const mode = options.mode ?? config.streamMode;
    const key = JSON.stringify([url, mode, config.proxy, config.proxyYtdlp, config.ytdlp,
      config.ytdlpCookiesTxt, config.ytdlpCookiesBrowser, config.ytdlpKeepConfig, config.cacheDir]);
    const previous = resolutions.get(key);
    if (previous?.pending) return await previous.result;
    if (!options.force && previous && previous.expires > Date.now()) {
      const result = await previous.result;
      const id = result.text?.split('/video/')[1]?.split('/')[0];
      const resource = id ? getResource(id) : undefined;
      if (resource && (resource.kind !== 'file' || (['queued', 'preparing', 'ready'].includes(resource.job.state)
        && (resource.job.state !== 'ready' || await isComplete(resource.job.artifact))))) return result;
    }
    for (const [id, value] of resolutions) if (value.expires < Date.now() || resolutions.size >= 128) resolutions.delete(id);
    const result = extract(url, mode);
    const entry = { expires: Date.now() + 10 * 60_000, pending: true, result };
    resolutions.set(key, entry);
    try { return await result; }
    catch (error) { resolutions.delete(key); throw error; }
    finally { entry.pending = false; }
  } catch (error) {
    const message = safeError(error);
    log.withFields({ error: message }).error('视频解析失败');
    return { code: 1, error: message };
  }
}

export async function retryVideoJob(id: string) {
  const job = getLosslessJob(id);
  if (!job) throw new Error('任务不存在');
  if (!['failed', 'cancelled', 'evicted'].includes(job.state)) throw new Error('仅失败、已取消或缓存已清理的任务可以重试');
  // Refresh expired source URLs while retaining the original quality/delivery choice.
  return resolveVideoLink(`https://www.youtube.com/watch?v=${job.info.id}`, { mode: job.mode, force: true });
}
