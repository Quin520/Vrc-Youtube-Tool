# VRChat yt-dlp Fix

适合中国宝宝体质的 VRChat YouTube 视频修复

## 为什么需要这个

### VRChat 播放 YouTube 视频的流程

在遥远的西方，有个叫 yt-dlp 的视频下载界大手子。在 VRChat 里面，如果有人点了一个 YouTube 视频的链接（形如 `https://www.youtube.com/watch?v=XXXXXXXX`），VRChat 就会拿着视频链接去问 yt-dlp 要视频的直链，然后拿给播放器播放

像我们平时放 bilibili 的视频的时候，我们会先提前用一个工具解析好在填上去，而 YouTube 就不需要这个，因为官方内置了 yt-dlp 来自动解析 YouTube 的视频

### 这会遇到什么问题呢

总结来说是两个

1. YouTube 以及 YouTube 解析出来的视频直链在本机上必须是可达的
2. yt-dlp 必须能正常解析 YouTube 的链接，不会被五秒盾、验证码、跳登录、隔壁老王什么的拦下来

首先第一条大概率是做不到的，就算你说你有神奇小猫咪，一般在开了加速器的情况下也会冲突并且没法正常访问 YouTube

就算你说你能访问，在解析的时候，这样的自动化工具也可能面临跳登录之类的状态而无法正常解析

额外的一点就是，VRChat 内置的是一个很老而且裁剪过的 yt-dlp，导致它也没有解析 Cookies 之类的功能

## 这个项目又是怎么解决这些问题的呢

VRChat 在加入房间的时候，会把自己内置的一个 yt-dlp.exe 复制到 `C:\Users\用户名\AppData\LocalLow\VRChat\VRChat\Tools` 这个目录。我们把它原来那个换掉，换成我们自己的一个壳壳。同时监控这个目录，等什么时候被 VRChat 换回原来的了，我们就继续把它换掉

当 VRChat 调用 yt-dlp 解析视频直链的时候，就会调用我们的壳壳，然后我们的壳壳调用真的 yt-dlp 并且把预先配置好的代理啊、Cookies 啊啥的参数都给它加上，然后解析就能顺利进行了

拿到解析完的直链之后，我们不直接把它给 VRC，因为这个直链在当前状态下大概率也是没法直接访问的。我们在本机 localhost 上开一个服务器，拿到直链之后，先记录下来，再返回一个指向本机的网址给 VRC 放。VRC 的播放器从本机请求视频的时候，我们通过代理来访问到那个直链并且把内容给它

光有这些其实还不够，公开房的视频播放器能放的域名是有白名单的，我们返回个 localhost 啥的不在白名单里也会不给放。所以我们加一个 hosts，把 `localhost.youtube.com` 解析到本机，这样在公开房里也就可以用了

## 我该怎么用呢

### 初始化

首先你得有一个魔法小猫咪或类似物，但是系统代理和 Tun 都不要开，把它的代理地址和端口记下来

你还需要收集你在 YouTube 的 cookie。[yt-dlp 官方的方法](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp)是用[这个插件](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)，在 YouTube 的页面上打开它，然后点击保存就能得到一个 TXT 文件，把它放在一个你不会删掉的地方，接下来会用到（虽然说起来可以自动从浏览器获取，但是貌似会[更麻烦](https://github.com/yt-dlp/yt-dlp/issues/7271)（虽然我是这么用的）

懒得做这一步而且觉得自己的魔法质量很好不会跳登录什么的可以选择摆烂

然后下载本项目的主程序，启动之后会进入一个设置向导。它会提示你输入代理地址、刚才 TXT 路径什么的，顺便帮你测试一下你输入的配置能不能正确解析视频

除了下面所说让程序随 VRChat 启动以外，其他的设置包括配置 Hosts 啥的都是一键的，配置文件一般也不用自己写

### 让本程序随 VRChat 启动

假如你用 VRCX，你可以在 VRCX 的设置 → 高级里面看到一个叫做 应用启动器 的选项，把我的主程序创建一个快捷方式拖进去（注意必须是快捷方式，不能是直接放里面的）

你有别的办法启动的话也可以，或者你也可以在用的时候手动开

## 关于 YouTube 的视频码率

20250825 更新：

我发现如果要让 yt-dlp 直接解析出一个包含视频和音频的 MP4 地址的话，最高貌似只有 360P 或者 480P 的码率。而更高的码率要么就是 音频和视频分开的，要么就是 HLS（也就是 M3U8 播放列表，有一堆片段拼接而成的）

观察到这个情况，我们有三种解决方法：（首先 AVPro 播放器是支持 HLS 的，但是 Unity 内置播放器不支持）

1. 还是用 MP4，但是可能只有 480P 分辨率
2. 使用 HLS，直接返回 M3U8 给游戏。由于 M3U8 里面其实是很多个小的 .ts 分片文件的网址，所以我们需要在获取到 M3U8 的时候把里面的小网址也换成代理的地址
3. 本地混流 HLS 为 MP4 再返回给游戏（这个方法我在 VLC 里测试成功了，但是进游戏就不行了，也许是因为 yt-dlp 会为了防止请求频繁等待五秒，然后游戏超时了）

我感觉我的推荐选择是第二种，因为很多地图的播放器其实都是 AVPro

## 用这个有风险吗

没有来自 VRC 或者 EAC 的风险，但是可能有来自 Google 的风险，虽然但是 VRC 官方用 yt-dlp 解析 YouTube 本来已经违反 TOS 了

这不是我说的，这是[这里](https://github.com/EllyVR/VRCVideoCacher/tree/main?tab=readme-ov-file#are-there-any-risks-involved)还有[这里](https://github.com/ShizCalev/VRChat-YT-DLP-Fix#for-a-bit-more-in-depth-explanation-of-what-this-program-does)说的。同时这两个也都是给了我启发的项目

## Release 的主程序为什么这么大

这是我做之前没有想到的。我做之前想着在 Bun、Rust、和 dotnet 里面挑一个来做这个，最终是选了 bun 然后用 bun 打包单文件可执行程序，因为我能从头到尾想出完整的流程应该怎么写，然后花了一晚上做的。要是用 dotnet 的话估计是一整天，用 Rust 的话大概是两天或者三天。

结果做完之后发现一打包一百多 MB，完整的运行时毫无裁剪，也没有任何裁剪的选项

原本壳壳也是用 Bun 的，但是它足够简单就 RIIR（Rewrite it in Rust，那些人很喜欢用 Rust 重写已经有了的东西）了，只有 2.几 MB

主程序就不管了，又不是不能用。本地有 Bun 的也可以直接拿源码跑
