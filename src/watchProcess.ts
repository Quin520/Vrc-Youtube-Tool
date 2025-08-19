import { createLogg } from "@guiiai/logg";
import { $ } from "bun";

const log = createLogg('VRChat 退出检测').useGlobalConfig()

export default async () => {
  let isRunning = false;
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Initial delay to avoid immediate checks
    const nowRun = await checkRunning("VRChat.exe");

    if (!isRunning && nowRun) {
      log.debug(`检测到 VRChat 开始运行`);
      isRunning = true;
      continue;
    }

    if (isRunning && !nowRun) {
      log.log(`VRChat 已退出，三秒后退出本程序`);
      isRunning = false;
      await new Promise(resolve => setTimeout(resolve, 3000));
      process.exit(0); // Exit the script when the process is no longer running
    }
  }
}

const checkRunning = async (processName: string) => {
  const res = await $`tasklist /FI "IMAGENAME eq ${processName}"`.text()
  return res.toLowerCase().includes(processName.toLowerCase())
}