import * as path from "node:path";
import * as fs from "fs";
import * as fsP from "fs/promises";
import _ from "lodash";
import { createLogg } from "@guiiai/logg";

const toolsPath = path.resolve(path.join(Bun.env.APPDATA!, '..\\LocalLow\\VRChat\\VRChat\\Tools'));
const ytdlpPath = path.join(toolsPath, 'yt-dlp.exe');
const log = createLogg('yt-dlp 替换').useGlobalConfig()
const stubStat = fs.statSync('stub.exe');

export default async () => {
  if (!await fsP.exists(toolsPath)) {
    await fsP.mkdir(toolsPath);
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
      const stat = await fsP.stat(ytdlpPath);
      if (stat.size === stubStat.size && stat.mtimeMs === stubStat.mtimeMs) {
        log.debug(`yt-dlp.exe 没有变化，跳过替换`);
        return;
      }
      await fsP.unlink(ytdlpPath);
    }
    await fsP.copyFile('stub.exe', ytdlpPath);
    log.log(`已将 stub.exe 替换到 ${ytdlpPath}`);
  } catch (e) {
    log.warn(`yt-dlp.exe 替换失败`);
  } finally {
    inProcess = false;
  }
}

const debouncedReplaceYtdlp = _.debounce(replaceYtdlp, 2000);
