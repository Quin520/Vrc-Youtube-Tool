# VRC YouTube Tool

在 Windows 上通过本地代理解析和播放 VRChat 中的 YouTube 视频。支持最高可用源画质、无损封装和本机任务管理。

## 功能

- 自动处理自己或其他玩家分享的 YouTube 链接。
- 提供完整 MP4 缓存和实验性 HLS 边准备边播，均不重新编码。
- 在任务面板查看进度、取消、重试和清理缓存。

## 快速开始

需要 Windows、[Node.js 22+](https://nodejs.org/) 和 [FFmpeg](https://ffmpeg.org/download.html#build-windows)（建议 8.1+）。

1. 从 [Releases](https://github.com/Quin520/Vrc-Youtube-Tool/releases/latest) 下载 Windows ZIP，完整解压，将 `ffmpeg.exe` 放入工具目录。
2. 开启 Clash、Bitz Net 等代理客户端，记下本地 HTTP / 混合端口，例如 `127.0.0.1:7890`。
3. 双击 `Start.cmd`，按向导填写 `IP:端口`；需要登录时使用自己的 Cookies 文件。代理地址不要填订阅链接。
4. 打开任务面板 `http://127.0.0.1:7919/`，解析一个视频并检查结果。
5. 首次配置 Hosts 后重启工具，再启动 VRChat。播放时保持工具和代理客户端运行。

## 使用说明

在 `config.ini` 的 `[ytdlp]` 中设置 `stream-mode`，重启生效。面板中的模式选择只影响本次手动解析。

| 模式 | 用途 | 限制 |
| --- | --- | --- |
| `lossless`（默认） | 最高可用源格式，封装为完整 MP4 | 首次需完整缓存，播放器须支持源编码 |
| `lossless-compatible` | 选择现有 H.264/AAC，封装为 MP4 | 可能低于源站最高画质 |
| `lossless-hls`（实验） | 最高可用源格式，分片播放 | 只能跳转到已生成的位置 |
| `lossless-hls-compatible`（实验） | 现有 H.264/AAC，分片播放 | 同上，画质也可能受限 |
| `mp4` / `hls-direct` | 旧版单流直通；后者可用于直播 | 不保证最高画质 |

“无损”指不再有损编码，容器可能改变。HLS 需要地图播放器支持，地图内兼容性仍待实测；当前不支持跳转到尚未准备的位置，也不支持断点续传。

缓存默认上限 8 GiB、准备超时 15 分钟。完整 MP4 就绪前播放器可能超时，就绪后重新加载即可复用缓存。

工具只改变本机的播放路径，转发给其他玩家时仍使用原始 YouTube 链接。与游戏加速器并用时，让视频走本地代理；Clash 中将 `DOMAIN,localhost.youtube.com,DIRECT` 放在 YouTube 规则之前。系统代理例外和详细分流说明见[使用与配置](docs/usage.md#与迅游等游戏加速器一起使用)。

升级时保留自己的 `config.ini`。个人代理配置、订阅和 Cookies 不要提交到仓库。

## 开发

安装 Bun 和 Rust 后，在仓库根目录执行：

```text
bun install
bun run typecheck
bun test tests
bun run build:main
cargo test --manifest-path stub-rs/Cargo.toml
cargo build --release --manifest-path stub-rs/Cargo.toml
```

设置 `TEST_FFMPEG`、`TEST_FFPROBE`、`TEST_YTDLP` 后可运行完整测试；未设置时相关用例会跳过。

## 文档

- [使用与配置](docs/usage.md)：模式详解、代理分流、排障、测试记录和改进方向。
- [配置示例](config.example.ini)：缓存、超时与运行路径。
- [来源与第三方声明](NOTICE.md)：发行包依赖与构建来源。

基于 [clansty/yt-dlp-VRC](https://github.com/clansty/yt-dlp-VRC)，采用 [AGPL-3.0](LICENSE)。
