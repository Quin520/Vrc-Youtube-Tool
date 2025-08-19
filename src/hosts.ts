import { createLogg } from "@guiiai/logg";
import { $ } from "bun";
import config from "./config.ts";

const log = createLogg('Hosts 设置').useGlobalConfig()

const checkHosts = async () => {
  const file = Bun.file('C:\\Windows\\System32\\drivers\\etc\\hosts');
  if (!await file.exists()) {
    console.error("找不到 hosts 文件，请检查路径是否正确");
    return false;
  }
  const content = await file.text();
  const lines = content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const hosts = lines.map(line => {
    const [ip, ...domains] = line.split(/\s+/);
    return { ip, domains };
  });
  const exist = hosts.find(it => it.domains.includes('localhost.youtube.com'))
  if (!exist) return false;
  if (exist.ip !== '127.0.0.1') {
    log.warn("hosts 文件中已经存在 localhost.youtube.com 的条目，但 IP 地址不是 127.0.0.1。请手动修改 hosts 文件");
    return true;
  }
  config.hostsOk = true;
  return true;
}

export const checkModifyHosts = async () => {
  if (await checkHosts()) return
  log.log("现在需要请求管理员权限，因为需要设置一条 Hosts 规则，以便在公开房里也能正常工作")
  try {
    await $`powershell -Command "Start-Process '${import.meta.file}' -ArgumentList '--set-hosts' -Verb RunAs"`
    log.log("设置成功")
  } catch (e) {
    log.errorWithError("设置 Hosts 失败，请手动添加一条规则: 127.0.0.1 localhost.youtube.com，否则公开房里大概会用不了", e);
  }
}

export const addHosts = async () => {
  const file = Bun.file('C:\\Windows\\System32\\drivers\\etc\\hosts');
  let content = '';
  if (await file.exists()) {
    content = await file.text();
  }

  content += '\n# Added by yt-dlp-vrc\n127.0.0.1 localhost.youtube.com\n';
  await file.write(content);
}