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

if (Bun.argv.includes('--set-hosts')) {
  await addHosts();
  process.exit(0);
}

const log = createLogg('主模块').useGlobalConfig()

setGlobalLogLevel(LogLevel.Log)
setGlobalFormat(Format.Pretty)
setGlobalTimeFormatter(date => format(date, "yyyy-MM-dd HH:mm:ss"))

if (!await loadConfig()) {
  await initWizard()
}

await checkModifyHosts()

if (config.exitWithVrc) {
  watchProcess()
}

server.listen(config.port);
await stubReplace()

log.log(`启动完成！`);
await menu()
