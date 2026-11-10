import { createLogg, Format, LogLevel, setGlobalFormat, setGlobalLogLevel, setGlobalTimeFormatter } from "@guiiai/logg";
import server from "./server.ts";
import config from "./config.ts";
import stubReplace from "./stubReplace.ts";
import { format } from 'date-fns';
import { loadConfig } from "./configFunctions.ts";
import { initWizard } from "./wizard.ts";
import menu from "./menu.ts";
import watchProcess from "./watchProcess.ts";
import { addHosts, checkModifyHosts } from "./hosts.ts";
import { stopChildren } from './process.ts';

const configArg = Bun.argv.indexOf('--config');
if (configArg !== -1 && Bun.argv[configArg + 1]) config.configPath = Bun.argv[configArg + 1]!;
const serveOnly = Bun.argv.includes('--serve-only');

if (Bun.argv.includes('--set-hosts')) {
  await addHosts();
  process.exit(0);
}

const log = createLogg('主模块').useGlobalConfig()

setGlobalLogLevel(LogLevel.Log)
setGlobalFormat(Format.Pretty)
setGlobalTimeFormatter(date => format(date, "yyyy-MM-dd HH:mm:ss"))

process.title='VRChat yt-dlp 修复服务'

if (!await loadConfig()) {
  await initWizard()
}

if (!serveOnly) await checkModifyHosts()

if (!serveOnly && config.exitWithVrc) {
  watchProcess()
}

server.listen({ hostname: '127.0.0.1', port: config.port, idleTimeout: 255 });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopChildren(); process.exit(0); });
if (!serveOnly) await stubReplace()

log.log(`启动完成，GitHub 地址: https://github.com/Quin520/Vrc-Youtube-Tool`);
if (!serveOnly && !Bun.argv.includes('--no-menu')) await menu()
