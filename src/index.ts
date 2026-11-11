import { createLogg, Format, LogLevel, setGlobalFormat, setGlobalLogLevel, setGlobalTimeFormatter } from "@guiiai/logg";
import { createServer } from "./server.ts";
import config from "./config.ts";
import stubReplace from "./stubReplace.ts";
import { format } from 'date-fns';
import { loadConfig } from "./configFunctions.ts";
import { initWizard } from "./wizard.ts";
import menu from "./menu.ts";
import watchProcess from "./watchProcess.ts";
import { addHosts, checkModifyHosts } from "./hosts.ts";
import { stopChildren } from './process.ts';
import { cancelAllJobs } from './lossless.ts';
import { version } from '../package.json';

if (Bun.argv.includes('--version')) { console.log(version); process.exit(0); }

const configArg = Bun.argv.indexOf('--config');
if (configArg !== -1 && Bun.argv[configArg + 1]) config.configPath = Bun.argv[configArg + 1]!;
const serveOnly = Bun.argv.includes('--serve-only');
const portArg = Bun.argv.indexOf('--port');
if (portArg !== -1) {
  const port = Number(Bun.argv[portArg + 1]);
  if (!serveOnly || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('--port 仅用于 --serve-only，且必须是 1–65535 的整数');
    process.exit(1);
  }
  config.port = port;
}

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

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  stopChildren();
  await cancelAllJobs();
  await server.stop(true);
  process.exit(0);
};
const server = createServer({ onShutdown: () => { void shutdown(); } });
server.listen({ hostname: '127.0.0.1', port: config.port, idleTimeout: 255 });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown(); });
if (!serveOnly) await stubReplace()

log.log(`启动完成，GitHub 地址: https://github.com/Quin520/Vrc-Youtube-Tool`);
log.log(`任务面板: http://127.0.0.1:${config.port}/`);
if (!serveOnly && !Bun.argv.includes('--no-menu')) await menu()
