import * as fsP from "fs/promises";
import { $ } from "bun";
import { createLogg } from "@guiiai/logg";
import { parse } from "@std/ini/parse";
import config from "./config.ts";

const log = createLogg('配置').useGlobalConfig()

export const loadConfig = async () => {
  if (await fsP.exists('./yt-dlp.exe')) {
    const res = await checkYtdlpVersion('./yt-dlp.exe');
    if (res) {
      config.ytdlp = './yt-dlp.exe';
    }
  }
  if (!await fsP.exists(config.configPath)) return false;
  const iniContent = await fsP.readFile(config.configPath, 'utf-8');
  try {
    const ini = parse(iniContent) as any;
    if (!ini.general?.proxy) {
      log.warn("配置文件中未设置代理地址，请检查 config.ini 的设置，实在不行就删了重建吧。按回车退出");
      for await (const chunk of Bun.stdin.stream()) {
        process.exit(1);
      }
    }
    config.proxy = ini.general?.proxy
    config.proxyYtdlp = ini.general?.proxy

    if (ini.general?.['exit-with-vrchat']) {
      config.exitWithVrc = ['true', '1', 'yes', 'on'].includes(ini.general['exit-with-vrchat'].toLowerCase());
    }
    if (ini.general?.['debug-fetch']) {
      config.debugFetch = ['true', '1', 'yes', 'on'].includes(ini.general['debug-fetch'].toLowerCase());
    }

    if (ini.ytdlp?.path) {
      config.ytdlp = ini.ytdlp.path;
    }
    if (ini.ytdlp?.proxy) {
      config.proxyYtdlp = ini.ytdlp.proxy;
    }
    if (ini.ytdlp?.['cookies-from-browser']) {
      config.ytdlpCookiesBrowser = ini.ytdlp['cookies-from-browser'];
    }
    if (ini.ytdlp?.['cookies-txt']) {
      config.ytdlpCookiesTxt = ini.ytdlp['cookies-txt'];
    }
    if (ini.ytdlp?.['cookies-from-browser'] && ini.ytdlp?.['cookies-txt']) {
      log.warn("cookies-from-browser 和 cookies-txt 同时设置了，出问题不负责");
    }
    if (ini.ytdlp?.['keep-config']) {
      config.ytdlpKeepConfig = ['true', '1', 'yes', 'on'].includes(ini.ytdlp['keep-config'].toLowerCase());
    }
    if (ini.ytdlp?.['stream-mode'] && ['lossless', 'lossless-compatible', 'mp4', 'hls-direct', 'hls-mux'].includes(ini.ytdlp['stream-mode'])) {
      config.streamMode = ini.ytdlp['stream-mode'].toLowerCase();
    }
    if (ini.ytdlp?.['ffmpeg-path']) config.ffmpeg = ini.ytdlp['ffmpeg-path'];
    if (ini.ytdlp?.['cache-dir']) config.cacheDir = ini.ytdlp['cache-dir'];
    if (ini.ytdlp?.['cache-max-gb']) {
      const gb = Number(ini.ytdlp['cache-max-gb']);
      if (!Number.isFinite(gb) || gb <= 0) throw new Error('cache-max-gb 必须大于 0');
      config.cacheMaxBytes = Math.floor(gb * 1024 ** 3);
    }
    if (ini.ytdlp?.['prepare-timeout-minutes']) {
      const minutes = Number(ini.ytdlp['prepare-timeout-minutes']);
      if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('prepare-timeout-minutes 必须大于 0');
      config.prepareTimeoutMs = minutes * 60_000;
    }
    return true
  } catch (e) {
    log.errorWithError("解析配置文件失败，考虑删除重建一个？", e);
    for await (const chunk of Bun.stdin.stream()) {
      process.exit(1);
    }
    return false;
  }
}

export const saveConfig = async () => {
  const lines: string[] = [];
  lines.push("[general]");
  lines.push(`; 想要本程序在 VRChat 退出时自动退出吗`);
  lines.push(`exit-with-vrchat = ${config.exitWithVrc ? 'true' : 'false'}`);
  lines.push('')
  lines.push(`; 代理服务器的地址，格式为 host:port`);
  lines.push(`proxy = ${config.proxy}`);
  lines.push('')
  lines.push(`; 调试代理 YouTube 链接的相关问题`);
  lines.push(`debug-fetch = ${config.debugFetch ? 'true' : 'false'}`);
  lines.push('')
  lines.push("[ytdlp]");
  if (config.ytdlp != './yt-dlp.exe') {
    lines.push(`; 如果软件相同目录下找不到 yt-dlp.exe，这里设置 yt-dlp 的路径`);
    lines.push(`path = ${config.ytdlp}`);
    lines.push('')
  }

  lines.push(`; 接下来是关于 Cookies 的设置，请参考 https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp`);
  lines.push(`; 如果已经把 Cookies 导出成文件了，设置 Cookies.txt 的路径`);
  lines.push(`cookies-txt = ${config.ytdlpCookiesTxt || ''}`);
  lines.push('')
  lines.push(`; yt-dlp 也可以自动从浏览器里读取 Cookies，但是这需要浏览器的 Cookies 为未加密状态。所以一些浏览器可能需要自行进行一些复杂的设置。如果要使用的话，这里可以设置浏览器的类型`);
  lines.push(`cookies-from-browser = ${config.ytdlpCookiesBrowser || ''}`);
  lines.push('')
  lines.push(`; lossless: 最高可用源画质，无损封装为可拖动进度的 MP4；首次需要下载缓存，编码兼容性取决于播放器`);
  lines.push(`; lossless-compatible: 选择源站现有的 H.264/AAC，再无损封装；清晰度可能低于源站最高格式`);
  lines.push(`; mp4 / hls-direct: 旧版单流直通模式，可能只有低分辨率；hls-direct 也用于直播`);
  lines.push(`; 旧版 hls-mux 现在等同 lossless；所有模式均不进行重新编码`);
  lines.push(`stream-mode = ${config.streamMode || 'lossless'}`);
  lines.push(`ffmpeg-path = ${config.ffmpeg}`);
  lines.push(`cache-dir = ${config.cacheDir}`);
  lines.push(`cache-max-gb = ${config.cacheMaxBytes / 1024 ** 3}`);
  lines.push(`prepare-timeout-minutes = ${config.prepareTimeoutMs / 60_000}`);
  lines.push('')
  lines.push(`; keep-config=true 时使用 yt-dlp 配置中的 Cookies 和解析代理；格式选择和 JSON 输出仍由工具管理`);
  lines.push(`; 就算这里设置了 false，config 文件里的其他设置还是有效的`);
  lines.push(`keep-config = ${config.ytdlpKeepConfig ? 'true' : 'false'}`);
  lines.push('')

  await fsP.writeFile(config.configPath, lines.join('\n'));
}

export const checkYtdlpVersion = async (executable: string) => {
  try {
    const out = await $`${executable} --version`.text();
    const version = out.trim();
    log.withFields({ version }).log(`yt-dlp 版本`);
    return true
  } catch (e) {
    log.errorWithError("检查 yt-dlp 版本失败", e);
    return false;
  }
}
