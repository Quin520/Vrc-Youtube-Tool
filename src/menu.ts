import prompts from "prompts";
import { initWizard, testParse } from "./wizard.ts";
import { saveConfig } from "./configFunctions.ts";
import { createLogg } from "@guiiai/logg";
import { $ } from "bun";
import config from "./config.ts";
import { cancelAllJobs } from './lossless.ts';

const log = createLogg('菜单').useGlobalConfig()

export default async () => {
  while (true) {
    const answ = await prompts({
      type: 'select',
      name: 'value',
      message: '我是菜单',
      choices: [
        { title: '打开任务面板（进度 / 取消 / 重试）', value: 'dashboard' },
        { title: '测试解析视频', value: 'test' },
        { title: '重新走一遍设置向导', value: 'wizard' },
        { title: '重新保存配置文件（恢复注释）', value: 'saveConfig' },
        { title: '打开配置文件编辑', value: 'openConfig' },
        { title: '退出', value: 'exit' }
      ],
      initial: 0
    })

    switch (answ.value) {
      case 'dashboard': {
        await $`cmd /c start ${`http://127.0.0.1:${config.port}/`}`;
        break;
      }
      case 'test': {
        const res = await testParse();
        if (res.code === 0) {
          log.log("解析成功，你可以试试以下地址在浏览器 / VLC 里能不能播放: " + res.text);
        } else {
          log.error("解析失败");
        }
        break
      }
      case 'wizard': {
        await initWizard();
        break
      }
      case 'saveConfig': {
        await saveConfig();
        log.log("保存成功！")
        break
      }
      case 'openConfig': {
        log.log("修改完成后记得保存，重启本工具生效");
        await $`cmd /c start ${config.configPath}`;
        break
      }
      case 'exit': {
        await cancelAllJobs();
        process.exit();
      }
    }
  }
}
