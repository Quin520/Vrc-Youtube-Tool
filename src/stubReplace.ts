import * as path from "node:path";
import * as fs from "fs";
import * as fsP from "fs/promises";
import _ from "lodash";
import { createLogg } from "@guiiai/logg";
import { createHash } from 'node:crypto';
import config from './config.ts';

const toolsPath = path.resolve(path.join(Bun.env.APPDATA!, '..\\LocalLow\\VRChat\\VRChat\\Tools'));
const ytdlpPath = path.join(toolsPath, 'yt-dlp.exe');
const log = createLogg('yt-dlp 替换').useGlobalConfig()
let stubHash = '';
const hashFile = async (file: string) => createHash('sha256').update(await fsP.readFile(file)).digest('hex');

export default async () => {
  stubHash = await hashFile('stub.exe');
  if (!await fsP.exists(toolsPath)) {
    await fsP.mkdir(toolsPath, { recursive: true });
  }
  // Preserve normal handling of Vimeo, direct files and other non-YouTube URLs.
  const original = path.join(toolsPath, 'yt-dlp-original.exe');
  const realYtdlp = Bun.which(config.ytdlp) ?? path.resolve(config.ytdlp);
  if (!await fsP.exists(original) || await hashFile(original) !== await hashFile(realYtdlp)) {
    await fsP.copyFile(realYtdlp, original);
  }
  await replaceYtdlp();
  const watcher = fs.watch(toolsPath, (event, filename) => {
    log.debug(`[${event}] ${filename}`);
    if (filename === 'yt-dlp.exe') {
      debouncedReplaceYtdlp()
    }
  });
  setInterval(replaceYtdlp, 5000)
}

let inProcess = false;
const replaceYtdlp = async () => {
  if (inProcess) return;
  inProcess = true;
  try {
    if (await fsP.exists(ytdlpPath)) {
      if (await hashFile(ytdlpPath) === stubHash) {
        log.debug(`yt-dlp.exe 没有变化，跳过替换`);
        return;
      }
    }
    const staged = path.join(toolsPath, 'yt-dlp-vrc-next.exe');
    await fsP.copyFile('stub.exe', staged);
    await fsP.rename(staged, ytdlpPath);
    log.log(`已将 stub.exe 替换到 ${ytdlpPath}`);
  } catch (e) {
    log.warn(`yt-dlp.exe 替换失败`);
  } finally {
    inProcess = false;
  }
}

const debouncedReplaceYtdlp = _.debounce(replaceYtdlp, 2000);
