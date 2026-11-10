import { randomUUID } from 'node:crypto';
import { createLogg } from '@guiiai/logg';
import config, { getYtdlpArgs, isLosslessMode } from './config.ts';
import { createLosslessJob, type LosslessJob } from './lossless.ts';
import { compactMediaInfo, qualitySummary, selectedFormats, type MediaInfo } from './media.ts';
import { runProcess, safeError } from './process.ts';
import { normalizeYoutubeUrl } from './youtube.ts';

const log = createLogg('解析服务').useGlobalConfig();
export type Resource = ({ kind: 'remote'; url: string; headers: Record<string, string> }
  | { kind: 'file'; job: LosslessJob }) & { expires: number; key: string };
const resources = new Map<string, Resource>();
const resourceKeys = new Map<string, string>();
const resolutions = new Map<string, { expires: number; result: Promise<ResolveResult> }>();
interface ResolveResult {
  text?: string;
  code: number;
  error?: string;
  quality?: ReturnType<typeof qualitySummary>;
}

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
  return `http://${config.hostsOk ? 'localhost.youtube.com' : '127.0.0.1'}:${config.port}/video/${id}/media.${extension}`;
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

async function extract(url: string): Promise<ResolveResult> {
  const stdout = await runProcess(config.ytdlp, [...getYtdlpArgs(), '--', url]);
  const info = compactMediaInfo(JSON.parse(stdout) as MediaInfo);
  const quality = qualitySummary(info);
  log.withFields(quality).log('选中的源格式');
  if (quality.height && quality.height < quality.highestAvailableHeight) {
    log.warn(`当前模式选择 ${quality.height}p，源视频最高提供 ${quality.highestAvailableHeight}p`);
  }
  if (isLosslessMode()) {
    const job = await createLosslessJob(info);
    const key = `file:${job.file}`;
    return { code: 0, quality, text: register(key, { kind: 'file', job, key, expires: Date.now() + 6 * 3600_000 }, 'mp4') };
  }
  const format = selectedFormats(info)[0]!;
  return { code: 0, quality, text: getProxyUrl(format.url, { ...info.http_headers, ...format.http_headers }) };
}

export async function resolveVideoLink(input: string): Promise<ResolveResult> {
  try {
    const url = normalizeYoutubeUrl(input);
    const key = JSON.stringify([url, config.streamMode, config.proxy, config.proxyYtdlp]);
    const previous = resolutions.get(key);
    if (previous && previous.expires > Date.now()) {
      const result = await previous.result;
      const id = result.text?.split('/video/')[1]?.split('/')[0];
      const resource = id ? getResource(id) : undefined;
      if (resource && (resource.kind !== 'file' || (resource.job.state !== 'failed'
        && (resource.job.state !== 'ready' || await Bun.file(resource.job.file).exists())))) return result;
    }
    for (const [id, value] of resolutions) if (value.expires < Date.now() || resolutions.size >= 128) resolutions.delete(id);
    const result = extract(url);
    resolutions.set(key, { expires: Date.now() + 10 * 60_000, result });
    try { return await result; }
    catch (error) { resolutions.delete(key); throw error; }
  } catch (error) {
    const message = safeError(error);
    log.withFields({ error: message }).error('视频解析失败');
    return { code: 1, error: message };
  }
}
