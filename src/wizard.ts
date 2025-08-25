import { createLogg } from "@guiiai/logg";
import config, { getYtdlpArgs } from "./config.ts";
import prompts from "prompts";
import { checkYtdlpVersion, saveConfig } from "./configFunctions.ts";
import { $ } from "bun";

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
      initial: '127.0.0.1:7890',
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
  }])

  switch (answ.cookiesWay) {
    case 'browser': {
      const answ = await prompts([{
        type: 'text',
        name: 'browser',
        message: `请输入浏览器名称，文档上说支持的浏览器有 brave, chrome, chromium, edge, firefox, opera, safari, vivaldi, whale`,
        initial: 'chrome',
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
          initial: './cookies.txt',
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

  const exitWithVrc = await prompts({
    type: 'toggle',
    name: 'value',
    message: '要在检测到 VRChat 结束之后自动退出本程序嘛？',
    initial: false,
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
    if (ok) {
      log.log("解析测试通过，配置完成");
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
  try {
    const stdout = await $`${config.ytdlp} ${getYtdlpArgs()} --no-cache-dir --rm-cache-dir -f '(mp4/best)[height<=?1080][height>=?64][width>=?64]' --get-url ${example}`.text()
    log.log('解析结果: ' + stdout)
    return stdout.startsWith('http');
  } catch (e: any) {
    log.withField('stdout', e.stdout).withField('stderr', e.stderr).errorWithError("解析失败", e);
    return false;
  }
}