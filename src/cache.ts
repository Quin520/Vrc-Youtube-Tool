import * as fs from 'node:fs/promises';
import path from 'node:path';

export interface Artifact {
  root: string;
  key: string;
  hls: boolean;
  file: string;
  work: string;
}
const ownedHlsFile = /^(index\.m3u8|init\.mp4|segment\d{6,}\.m4s)(\.tmp)?$/;
export const hlsAsset = /^(init\.mp4|segment\d{6,}\.m4s)$/;

export function artifactFor(root: string, key: string, hls: boolean): Artifact {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cache key');
  root = path.resolve(root);
  const file = hls ? path.join(root, 'hls-v1', key, 'index.m3u8') : path.join(root, 'lossless-v1', `${key}.mp4`);
  return { root, key, hls, file, work: hls ? file : file.replace(/\.mp4$/, '.partial.mp4') };
}

async function ownedFiles(directory: string) {
  const stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat) return [];
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('缓存目录不是普通文件夹');
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && ownedHlsFile.test(entry.name)).map(entry => path.join(directory, entry.name));
}

export async function artifactBytes(artifact: Artifact) {
  if (!artifact.hls) return (await fs.stat(artifact.work).catch(() => undefined))?.size ?? 0;
  const files = await ownedFiles(path.dirname(artifact.file));
  const sizes = await Promise.all(files.map(async file => (await fs.stat(file).catch(() => undefined))?.size ?? 0));
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function playlistReady(artifact: Artifact, complete = false) {
  const text = await fs.readFile(artifact.file, 'utf8').catch(() => '');
  if (!text.startsWith('#EXTM3U') || !text.includes('#EXTINF:') || (complete && !text.includes('#EXT-X-ENDLIST'))) return false;
  const names = ['init.mp4', ...text.split(/\r?\n/).filter(line => line && !line.startsWith('#'))];
  if (!names.every(name => hlsAsset.test(name))) return false;
  return (await Promise.all(names.map(async name => (await fs.stat(path.join(path.dirname(artifact.file), name)).catch(() => undefined))?.size ?? 0))).every(size => size > 0);
}

export async function isComplete(artifact: Artifact) {
  return artifact.hls ? playlistReady(artifact, true) : ((await fs.stat(artifact.file).catch(() => undefined))?.size ?? 0) > 0;
}

export async function discardPartial(artifact: Artifact) {
  if (!artifact.hls) { await fs.unlink(artifact.work).catch(() => {}); return; }
  // No recursive deletion: only the known generated filenames in this exact job folder.
  for (const file of await ownedFiles(path.dirname(artifact.file))) await fs.unlink(file).catch(() => {});
  await fs.rmdir(path.dirname(artifact.file)).catch(() => {});
}

interface CacheEntry { artifact: Artifact; bytes: number; accessed: number }
async function entries(root: string): Promise<CacheEntry[]> {
  const result: CacheEntry[] = [];
  const mp4Root = path.join(root, 'lossless-v1');
  for (const item of await fs.readdir(mp4Root, { withFileTypes: true }).catch(() => [])) {
    const match = /^([a-f0-9]{64})(?:\.partial)?\.mp4$/.exec(item.name);
    if (!item.isFile() || !match) continue;
    const file = path.join(mp4Root, item.name);
    const stat = await fs.stat(file).catch(() => undefined);
    if (stat) result.push({ artifact: { ...artifactFor(root, match[1]!, false), file, work: file }, bytes: stat.size, accessed: stat.atimeMs });
  }
  const hlsRoot = path.join(root, 'hls-v1');
  for (const item of await fs.readdir(hlsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!item.isDirectory() || !/^[a-f0-9]{64}$/.test(item.name)) continue;
    const artifact = artifactFor(root, item.name, true);
    const stat = await fs.stat(artifact.file).catch(() => undefined);
    result.push({ artifact, bytes: await artifactBytes(artifact), accessed: stat?.atimeMs ?? 0 });
  }
  return result;
}

export async function trimCache(root: string, maxBytes: number, reserve: number, protectedFiles: Set<string>, clear = false) {
  const all = await entries(root);
  let total = all.reduce((sum, entry) => sum + entry.bytes, 0);
  let freed = 0;
  for (const entry of all.sort((a, b) => a.accessed - b.accessed)) {
    if (!clear && total + reserve <= maxBytes) break;
    const artifact = entry.artifact;
    const canonical = artifactFor(root, artifact.key, artifact.hls).file;
    if (protectedFiles.has(canonical) || Date.now() - entry.accessed < 120_000) continue;
    if (artifact.hls) await discardPartial(artifact);
    else await fs.unlink(artifact.file).catch(() => {});
    const removed = artifact.hls ? entry.bytes - await artifactBytes(artifact) : (await Bun.file(artifact.file).exists() ? 0 : entry.bytes);
    total -= removed; freed += removed;
  }
  if (!clear && total + reserve > maxBytes) throw new Error('缓存空间不足；等待当前视频播放完成，或增大 cache-max-gb');
  return { usedBytes: total, freedBytes: freed };
}
