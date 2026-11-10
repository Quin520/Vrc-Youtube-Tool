# 来源与许可证

- 本项目基于 [clansty/yt-dlp-VRC](https://github.com/clansty/yt-dlp-VRC)，保留原始提交历史、源码及根目录的 AGPL-3.0 `LICENSE`。
- 首个发行包中的 `main.exe` 与 `stub.exe` 来自上游 v1.1 官方发行包，保持原样；对应上游源码提交为 `0eb5ffde6904e35518fde4ffdd97773e9c68f86d`。本次修复调整了外部解析器和运行配置。
- 发行包内的 `yt-dlp.exe` 是 [yt-dlp 2026.10.26](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26) 的官方 Windows x64 二进制文件。其许可证及第三方声明分别见 `licenses/yt-dlp-LICENSE.txt` 与 `licenses/yt-dlp-THIRD_PARTY_LICENSES.txt`；源码由上述官方版本提供。
- Node.js 由使用者自行安装，不包含在发行包中。
- v1.2.0 的 `main.exe` 和 `stub.exe` 从本仓库对应版本源码重新构建，使用 Bun 1.4.4 和 Rust 1.99.1。Bun 的许可证见 `licenses/bun-LICENSE.md`。
- v1.2.0 原始画质功能调用独立 FFmpeg 程序。FFmpeg 不包含在此发行包中，请从其官方网站提供的构建来源单独获取；本地验证使用 FFmpeg n8.1.3-34-ga35157abb9 的 LGPL Windows 构建。
- `SHA256SUMS.txt` 记录发行包内其他文件的 SHA-256 校验值。
