import { $ } from "bun";
import config, { getYtdlpArgs } from "./config.ts";
import { createLogg } from "@guiiai/logg";
import * as child_process from "node:child_process";

const videoLinks: string[] = []
const log = createLogg('解析服务').useGlobalConfig()

const getIndex = (url: string) => {
  const find = videoLinks.findIndex(v => v === url);
  if (find !== -1) {
    return find;
  }
  const index = videoLinks.length;
  videoLinks.push(url);
  return index;
}

export const getProxyUrl = (url: string) => {
  return `http://${config.hostsOk ? 'localhost.youtube.com' : 'localhost'}:${config.port}/video/${getIndex(url)}`
}

export const resolveVideoLink = async (url: string) => {
  if (config.streamMode === 'hls-mux') {
    return {
      text: getProxyUrl(url),
      code: 0,
    }
  }
  try {
    const stdout = (await $`${config.ytdlp} ${getYtdlpArgs()} ${url}`.text()).trim()
    log.log('解析结果: ' + stdout)
    if (stdout.startsWith('http')) {
      return {
        text: getProxyUrl(stdout),
        code: 0,
      };
    } else {
      return {
        text: stdout,
        code: 0,
      };
    }
  } catch (e: any) {
    log.withField('stdout', e.stdout).withField('stderr', e.stderr).errorWithError("视频解析失败", e);
    return {
      code: e.exitCode || 1,
    }
  }
}

export const getSavedUrlByIndex = (index: number) => {
  return videoLinks[index];
}

export const streamHls = (index: number) => {
  if (config.streamMode !== 'hls-mux') return;
  const subprocess = child_process.spawn(config.ytdlp, [...getYtdlpArgs(), getSavedUrlByIndex(index)!])
  return subprocess.stdout;
}
