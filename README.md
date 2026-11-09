# Vrc Youtube Tool

基于 [clansty/yt-dlp-VRC](https://github.com/clansty/yt-dlp-VRC) 的 Windows 修复包，让 VRChat 的 YouTube 视频解析和视频流量通过本地代理客户端转发。

本版将旧的 yt-dlp 更新为 **2026.10.26**，并启用 **Node.js** 处理 YouTube 的 JavaScript 验证，修复旧版解析器出现的 `nsig extraction failed` / `Requested format is not available` 问题。上游主程序和 stub 未改动。

## 使用

1. 在 [Releases](https://github.com/Quin520/Vrc-Youtube-Tool/releases/latest) 下载 Windows ZIP，完整解压。GitHub 的 Source code ZIP 不包含可执行文件。
2. 安装 [Node.js](https://nodejs.org/) **22 或更新版本**，确保加入 PATH；安装后重新打开启动器。
3. 开启 Bitz Net 或其他代理客户端，记下本地 **HTTP / 混合代理端口**。例如 `127.0.0.1:7897`，端口以自己的客户端为准。
4. 双击 `Start.cmd`，按向导填写代理地址：**只填 `IP:端口`，不加 `http://`，也不要填订阅链接**。如需 Cookies，请使用自己导出的文件。
5. 运行“测试解析视频”。首次配置 Hosts 后，退出并重新打开工具一次，再启动 VRChat；播放时保持工具和代理客户端运行。

默认使用 MP4。若某个视频没有可用的 MP4，可在向导中选择 HLS；HLS 需要地图播放器支持 AVPro。

## 与迅游等游戏加速器一起使用

- Bitz Net 保持连接，**关闭 TUN**；需要浏览器正常联网时，可以保留系统代理。
- 游戏加速器选择 VRChat 对应的加速项目；本工具通过配置的本地 HTTP 代理转发 YouTube 视频。
- 保留系统代理时，在 Windows「设置 → 网络和 Internet → 代理 → 使用代理服务器」的例外列表中**追加**以下地址，保留原有条目：

  ```text
  localhost.youtube.com;vrchat.com;*.vrchat.com;vrchat.cloud;*.vrchat.cloud
  ```

  这样，遵循 Windows 系统代理设置的程序会直接访问本地视频服务，VRChat 的上述域名也会绕过系统 HTTP 代理，交由游戏加速器处理。代理客户端重新连接后可能覆盖例外列表，需要检查。

已验证测试视频的解析和本地 MP4 数据转发；不同加速器、节点和地图播放器仍需实际测试，以上设置不保证所有组合都兼容。

## 更新与配置

在工具目录打开 PowerShell，更新 yt-dlp（端口按实际配置修改）：

```powershell
.\yt-dlp.exe --proxy http://127.0.0.1:7897 -U
```

`yt-dlp.conf` 中的 `--js-runtimes node` 用于启用 Node.js，请保留。`config.example.ini` 仅作参考，首次运行会生成自己的 `config.ini`。请勿上传 Cookies、订阅链接或账号配置。

## 源码与许可

保留上游完整源码和提交历史，采用 [AGPL-3.0](LICENSE)。二进制来源与第三方声明见 [NOTICE.md](NOTICE.md)。

需要自行构建时，安装 Bun 与 Rust，在仓库根目录运行：

```text
bun install
bun run build:main
cargo build --release --manifest-path stub-rs/Cargo.toml
```

将 `stub-rs/target/release/stub-rs.exe` 复制为工具目录中的 `stub.exe`，再放入官方 `yt-dlp.exe` 和本仓库的 `yt-dlp.conf`。