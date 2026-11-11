import { createLogg } from "@guiiai/logg";
import config from "./config.ts";
import prompts from "prompts";
import { checkYtdlpVersion, saveConfig } from "./configFunctions.ts";
import { resolveVideoLink } from "./resolveService.ts";

const log = createLogg('设置向导').useGlobalConfig()

export const initWizard = async () => {
  if (!config.ytdlp) {
    while (true) {
      const answ = await prompts([{
        type: 'text',
        name: 'path',
        message: `看起来当前目录下没有 yt-dlp.exe，请输入 yt-dlp.exe 的路径（如果在 PATH 中可以直接输入命令名）`,
        initial: 'yt-dlp.exe',
      }])
      const ok = await checkYtdlpVersion(answ.path);
      if (ok) {
        config.ytdlp = answ.path;
        break;
      }
    }
  }

  while (true) {
    const answ = await prompts([{
      type: 'text',
      name: 'addr',
      message: `请输入要使用的代理地址`,
      initial: config.proxy,
    }])
    const ok = answ.addr.includes(':');
    if (ok) {
      config.proxy = answ.addr;
      config.proxyYtdlp = answ.addr;
      break;
    }
    log.warn("代理服务器地址好像不太正确")
  }

  const answ = await prompts([{
    type: 'select',
    name: 'cookiesWay',
    message: '在大多数情况下需要有 Cookies 才能解析 YouTube 的视频链接，选择一个 Cookies 的获取方式\n  参考 https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp',
    choices: [
      { title: '导出的 TXT', value: 'txt' },
      { title: '从浏览器获取', value: 'browser' },
      { title: '摆烂', value: 'ignore' }
    ],
    initial: config.ytdlpCookiesBrowser ? 1 : 0
  }])

  switch (answ.cookiesWay) {
    case 'browser': {
      const answ = await prompts([{
        type: 'text',
        name: 'browser',
        message: `请输入浏览器名称，文档上说支持的浏览器有 brave, chrome, chromium, edge, firefox, opera, safari, vivaldi, whale`,
        initial: config.ytdlpCookiesBrowser || 'chrome',
      }])
      config.ytdlpCookiesBrowser = answ.browser
      break;
    }
    case 'txt': {
      while (true) {
        const answ = await prompts([{
          type: 'text',
          name: 'path',
          message: `请输入 Cookies.txt 的路径`,
          initial: config.ytdlpCookiesTxt || './cookies.txt',
        }])

        const text = await Bun.file(answ.path).text();
        if (!text.startsWith('# HTTP Cookie File') && !text.startsWith('# Netscape HTTP Cookie File')) {
          log.warn("文档上说这个文件应该以 '# HTTP Cookie File' 或 '# Netscape HTTP Cookie File' 开头，请检查路径是否正确");
          continue
        }

        config.ytdlpCookiesTxt = answ.path;
        break;
      }
      break
    }
  }

  const streamMode = await prompts([{
    type: 'select',
    name: 'streamMode',
    message: '选择画质与播放方式（均不重新编码；HLS 分片需要地图播放器支持）',
    choices: [
      { title: '原始画质：最高可用音视频，无损封装；需要 FFmpeg，播放器须支持源编码', value: 'lossless' },
      { title: '兼容无损：选择现有 H.264/AAC，适合更多地图；源站最高画质可能更高', value: 'lossless-compatible' },
      { title: '原始画质 HLS（实验）：边准备边播；暂时只能跳转到已生成的位置', value: 'lossless-hls' },
      { title: '兼容 HLS（实验）：现有 H.264/AAC 边准备边播；清晰度可能较低', value: 'lossless-hls-compatible' },
      { title: '旧版 MP4 单流直通：加载快，但清晰度可能较低', value: 'mp4' },
      { title: '单流 / HLS 直通：用于直播，需要地图播放器支持', value: 'hls-direct' }
    ],
    initial: Math.max(0, ['lossless', 'lossless-compatible', 'lossless-hls', 'lossless-hls-compatible', 'mp4', 'hls-direct'].indexOf(config.streamMode))
  }])
  config.streamMode = streamMode.streamMode;

  const exitWithVrc = await prompts({
    type: 'toggle',
    name: 'value',
    message: '要在检测到 VRChat 结束之后自动退出本程序嘛？',
    initial: config.exitWithVrc,
    active: '好',
    inactive: '不要'
  });
  config.exitWithVrc = exitWithVrc.value;


  await saveConfig()
  log.log("配置已保存到 config.ini，可以直接打开修改（记得保存，改完要重启）")

  const isCheck = await prompts({
    type: 'toggle',
    name: 'value',
    message: '要不要检查一下是否能正确解析视频呢？',
    initial: true,
    active: '要的',
    inactive: '不要'
  });

  if (isCheck.value) {
    const ok = await testParse();
    if (ok.code === 0) {
      log.log("格式解析通过。无损模式正在准备缓存，可在 VLC 或地图播放器测试: " + ok.text);
    } else {
      log.error("解析测试失败，请检查配置是否正确，看你了");
    }
  } else {
    log.log("配置完成！有需要的话可以自行修改 config.ini 文件");
  }
}

export const testParse = async () => {
  const example = 'https://www.youtube.com/watch?v=-PTe8zkYt9A';
  log.log('正在解析，请稍候…')
  return await resolveVideoLink(example);
}
