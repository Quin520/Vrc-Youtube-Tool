import prompts from "prompts";
import { testParse } from "./wizard.ts";
import { saveConfig } from "./configFunctions.ts";
import { createLogg } from "@guiiai/logg";
import { $ } from "bun";
import config from "./config.ts";

const log = createLogg('菜单').useGlobalConfig()

export default async () => {
  while (true) {
    const answ = await prompts({
      type: 'select',
      name: 'value',
      message: '我是菜单',
      choices: [
        { title: '选我也没有用', value: 'placeholder' },
        { title: '测试解析视频', value: 'test' },
        { title: '重新保存配置文件（恢复注释）', value: 'saveConfig' },
        { title: '打开配置文件编辑', value: 'openConfig' },
        { title: '退出', value: 'exit' }
      ],
      initial: 0
    })

    switch (answ.value) {
      case 'test': {
        await testParse();
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
        process.exit();
      }
    }
  }
}