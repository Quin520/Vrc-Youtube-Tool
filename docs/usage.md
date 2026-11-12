# VRC YouTube Tool 使用与配置

[返回首页](../README.md)

本页保留详细配置、兼容说明和验证记录；快速开始见首页。

基于 [clansty/yt-dlp-VRC](https://github.com/clansty/yt-dlp-VRC) 的 Windows 修复包，让 VRChat 的 YouTube 视频解析和视频流量通过本地代理客户端转发。

**v1.3.0 增加任务面板和可选的 HLS 边准备边播。** 默认选择最高可用音视频流，使用 FFmpeg `-c copy` 封装成可拖动进度的本地 MP4，不重新编码、不缩放、不限制为 1080p。新增 HLS 模式同样复制源编码，首个完整片段生成后即可播放；默认模式仍为完整 MP4。

保留 yt-dlp **2026.10.26** 和 Node.js 支持，处理 YouTube 的 JavaScript 验证。

## 使用

1. 在 [Releases](https://github.com/Quin520/Vrc-Youtube-Tool/releases/latest) 下载 Windows ZIP，完整解压。GitHub 的 Source code ZIP 不包含可执行文件。
2. 安装 [Node.js](https://nodejs.org/) **22 或更新版本**，确保加入 PATH；安装后重新打开启动器。
3. 从 [FFmpeg 官网指向的 Windows 构建](https://ffmpeg.org/download.html#build-windows)下载 FFmpeg，将 `ffmpeg.exe` 放在工具目录，建议 **8.1 或更新版本**。工具会检测 HTTP 分块请求能力，避免部分 YouTube 直链的大请求限速。发行包不包含这一依赖；可在配置中用 `ffmpeg-path` 指定其他位置。
4. 开启 Clash、Bitz Net 等客户端，记下本地 **HTTP / 混合代理端口**，例如 `127.0.0.1:7890`，以自己的客户端为准。
5. 双击 `Start.cmd`，按向导填写代理地址：**只填 `IP:端口`，不要填订阅链接**。需要登录时使用自己的 Cookies 文件。
6. 打开菜单中的“任务面板”或访问 `http://127.0.0.1:7919/`，解析视频并查看进度、分辨率、帧率和编码。首次配置 Hosts 后，退出并重新打开工具一次，再启动 VRChat；播放时保持工具和代理客户端运行。

升级用户保留自己的 `config.ini`。如需原始画质，将 `[ytdlp] stream-mode` 改为 `lossless`；想试用 HLS 可改为 `lossless-hls`，重启生效。旧配置不会被自动覆盖。任务面板中的模式选择仅影响本次手动解析。

## 画质与格式

| 模式 | 行为 | 限制 |
| --- | --- | --- |
| `lossless`（默认） | 选择 `bv*+ba/b`，复制源编码并封装为 MP4 | 首次需要缓存；源站提供的 AV1、VP9、Opus 等编码未必被地图播放器支持 |
| `lossless-compatible` | 选择源站现有的 H.264 视频和 AAC 音轨，无损封装 | 适合更多播放器，但清晰度、音质可能低于源站最高格式 |
| `lossless-hls`（实验） | 与 `lossless` 相同的格式选择，复制为 fMP4/HLS 分片，边准备边播 | 需要播放器支持 HLS 和源编码；准备期间只能跳转到已生成的位置 |
| `lossless-hls-compatible`（实验） | 源站现有的 H.264/AAC，复制为 HLS 分片 | 同样只可跳转到已生成的位置；不保证源站最高画质 |
| `mp4` | 旧版带音轨 MP4 直通 | 加载快，可能仅有 360p |
| `hls-direct` | 旧版单流/HLS 直通，也可用于直播 | 不保证最高画质；HLS 需要播放器支持 |

旧 `hls-mux` 配置等同于 `lossless`。所有模式都不会重新编码；原始画质模式失败时会报错，不会偷偷退回 360p。

这里的“无损”是**对 YouTube 提供的压缩音视频不再进行有损编码**，并非恢复上传前的素材。MP4 容器和传输封装可能变化；例如 AV1 的分隔符、AAC 的传输头可以在封装时调整，不改变画面或声音。不能保证所有编码在所有 VRChat 地图里播放。参见 [yt-dlp 格式选择](https://github.com/yt-dlp/yt-dlp#format-selection)、[FFmpeg streamcopy](https://ffmpeg.org/ffmpeg.html#Streamcopy)和 [AVPro 编码支持](https://www.renderheads.com/content/docs/AVProVideo/articles/supportedmedia.html)。

完整 MP4 模式先缓存、封装，再提供 HTTP Range 播放，适合需要任意拖动和加入房间后同步进度的情况。长视频可能等待较久，播放器也可能先超时；任务“已就绪”后重新加载即可复用缓存。

HLS 模式按顺序准备整段视频，约以 4 秒为目标、沿源关键帧切片，不重新编码。它**不是任意时间点按需下载**：未生成的位置无法跳转，准备完成后才可跳转整段。加入正在播放较后位置的房间时，可能仍要等待。HLS 及 AV1/VP9/Opus 支持取决于地图播放器，尚不能保证所有地图兼容。

## 任务面板

浏览器访问 `http://127.0.0.1:7919/`：

- 查看源画质、编码、处理时长、缓存大小、队列位置及估算剩余时间；HLS 显示已生成的可播放范围。
- 取消正在准备或排队的任务，清理未完成文件；单个播放器断开连接不会取消其他播放器共用的任务。
- 对失败、取消或缓存已清理的任务“重新解析并重试”，重新获取源链接，并保留该任务的画质模式。
- 清理未使用的 MP4/HLS 缓存；正在准备或最近 2 分钟内访问的文件会保留。不删除缓存目录中不属于工具的其他文件。
- 复制本机播放地址用于 VLC 等播放器测试。视频标题以普通文字显示，面板不返回 Cookies、源站签名直链和本地文件路径。

缓存默认合计上限 8 GiB，准备超时 15 分钟，见 `config.example.ini`。同一请求会共用任务；每次运行一个封装任务，最多容纳 4 个正在准备/排队任务。运行中的任务使用创建时的代理和缓存设置。遇到损坏或截断的输入会报错并清理残片，不将残缺电影标成完成，也不自动降低画质。进度与剩余时间是估算值。

`/status` 提供本机状态。取消、重试、清理及退出 API 需要该实例的控制令牌，并拒绝来自其他网站的跨域请求。开发调试可用 `main.exe --serve-only --port 17919 --config config.ini` 启动独立端口，此模式不安装 VRChat 解析器或修改 Hosts；`main.exe --version` 显示版本。

## 别人分享的链接

支持 `youtube.com/watch`、`youtu.be`、`shorts`、`live` 和 `embed` 链接。地图把视频链接同步给你的客户端后，本机的解析器会交给此工具处理，无需自己重新粘贴链接。不要把 `localhost.youtube.com` 地址发给别人；本机工具只改变自己的播放路径。

非 YouTube 链接会交回旁边的 `yt-dlp-original.exe`。登录、地区限制、源格式供应和地图播放器限制仍然适用。

## 与迅游等游戏加速器一起使用

- 本工具显式连接本地 HTTP 代理，不要求开启 TUN。若已使用 TUN 分流，应让 YouTube 规则先于兜底直连规则，同时保留游戏原有路由；具体设置取决于代理客户端和加速器。
- 游戏加速器选择 VRChat 对应的加速项目；本工具通过配置的本地 HTTP 代理转发 YouTube 视频。
- 使用 Clash 的 YouTube 域名规则时，把 `DOMAIN,localhost.youtube.com,DIRECT` 放在 YouTube 代理规则之前，以便访问本地服务。
- 保留系统代理时，在 Windows「设置 → 网络和 Internet → 代理 → 使用代理服务器」的例外列表中**追加**以下地址，保留原有条目：

  ```text
  localhost.youtube.com;vrchat.com;*.vrchat.com;vrchat.cloud;*.vrchat.cloud
  ```

  这样，遵循 Windows 系统代理设置的程序会直接访问本地视频服务，VRChat 的上述域名也会绕过系统 HTTP 代理，交由游戏加速器处理。代理客户端重新连接后可能覆盖例外列表，需要检查。

工具仅监听 `127.0.0.1`，不向局域网开放。仓库不包含个人 Clash 配置、订阅、节点和 Cookies。

## 更新与配置

在工具目录打开 PowerShell，更新 yt-dlp（端口按实际配置修改）：

```powershell
.\yt-dlp.exe --proxy http://127.0.0.1:7890 -U
```

`yt-dlp.conf` 中的 `--js-runtimes node` 用于启用 Node.js，请保留。`config.example.ini` 仅作参考，首次运行会生成自己的 `config.ini`。请勿上传 Cookies、订阅链接或账号配置。

## 源码与许可

保留上游完整源码和提交历史，采用 [AGPL-3.0](../LICENSE)。二进制来源与第三方声明见 [NOTICE.md](../NOTICE.md)。

需要自行构建时，安装 Bun 与 Rust，在仓库根目录运行：

```text
bun install
bun run typecheck
bun test tests
bun run build:main
cargo test --manifest-path stub-rs/Cargo.toml
cargo build --release --manifest-path stub-rs/Cargo.toml
```

将 `stub-rs/target/release/stub-rs.exe` 复制为工具目录中的 `stub.exe`，再放入官方 `yt-dlp.exe`、FFmpeg 和本仓库的 `yt-dlp.conf`。

## 测试与改进评估

自动化测试覆盖常见链接识别、HLS 相对地址/音轨/密钥/初始化片段改写、HTTP Range/HEAD/416、并发请求去重、真实 FFmpeg 无损封装、首片先于完整下载可播放、视频/音频包哈希一致、末段跳转、取消后清理及队列继续、配置快照、截断输入拒绝、MP4/HLS 共用缓存上限及控制接口。设置 `TEST_FFMPEG`、`TEST_FFPROBE`、`TEST_YTDLP` 为三个可执行文件的路径，可以运行完整测试；未设置时依赖外部程序的用例会明确跳过。

`scripts/verify-live.ts` 用于可选的真实 YouTube 测试：额外设置 `TEST_PROXY` 为本地代理，运行 `bun run scripts/verify-live.ts`。脚本核对分辨率、帧率、范围读取、末段跳转后解码及源/输出音视频包哈希；报告只写入忽略上传的 `.local`。`TEST_COMPATIBLE=1` 测试兼容模式，`TEST_HLS=1` 测试 HLS（两者可同时设置），`TEST_CACHE_DIR` 可指定独立缓存目录。HLS 还会记录首片可播放时间并测试准备期间的播放。部分封装会改写 AV1/ADTS 传输头，包哈希不同时会进一步对比解码后的画面和 PCM。

2026-11-10 实测：同一视频由旧模式的 360p 提升到 1080p/24 fps；VP9+Opus、H.264+AAC 两种模式的完整音视频包哈希均一致，HTTP 范围请求和跳转后解码通过。另对 4K/60 fps AV1+六声道 AAC 的 3 秒样本核对了解码后的画面/PCM SHA-256，一致。该样本测试不代表完整 4K 长视频或 VRChat 地图内播放已验证。

2026-11-11 HLS 实测：264 秒的 1080p/24 fps VP9+Opus 视频，解析开始后约 7.5 秒首片可播放、24.7 秒全部准备完成；6337 个视频包及 13203 个音频包 SHA-256 与源流全部一致，末段 261 秒处跳转解码通过。时间包含当次解析与下载，仅代表该视频和当时网络条件。

同一视频的 H.264+AAC HLS 模式约 5.1 秒可播放、14.7 秒全部完成，6337 个视频包和 11374 个音频包哈希全部一致，末段跳转通过。编译后的 Windows 程序在 Edge 中完成了解析、取消、重新解析重试、复制播放地址、保留近期缓存及窄屏布局检查，无浏览器脚本错误。VRChat 地图内播放尚未验证。

仍值得改进的项目：

1. **跳转到未下载位置**：当前 HLS 顺序准备；真正按时间点优先准备需要可靠的源分片索引与时间戳对齐。
2. **断点恢复与自动刷新**：当前手动重试重新解析并从头准备；尚未实现跨重启恢复、过期直链自动续传及节点切换恢复。
3. **直播的分离音视频支持**：原始画质缓存模式只用于点播，直播使用旧单流模式。
4. **VRChat 地图内的回归测试**：覆盖 AVPro/Unity、同步进度、加入房间和长视频超时。外部 FFmpeg 和浏览器测试不能替代这一层，HLS 暂不设为默认。
