# 正式版与 Beta

## 产品边界

正式版移除账号与同步，首次启动即可读取包内完整词书，进度只在当前设备可靠保存。Beta 保留登录、云端同步和已有账号数据。两者都继续迭代；此轮正式版以已发布代码为基础，原工作区的同步协议 3 改动仍保留，未随本次部署上线。

| 项目 | 正式版 | Beta |
| --- | --- | --- |
| Windows 当前版本 | 0.1.0 | 0.4.13 |
| Android 当前版本 | 0.1.0，versionCode 513 | 0.1.11，versionCode 512 |
| Windows 应用标识 | com.cyword.desktop.stable | com.cyword.desktop |
| Windows 安装名 / userData 子目录 | CYword Stable | CYword |
| Android 包名 | me.chengyi.cyword.stable | me.chengyi.cyword |
| GitHub 标记 | 普通 Release | Pre-release，不能标为 Latest |
| Windows 更新元数据 | /downloads/latest-stable.yml | /downloads/latest.yml |
| Android 更新指针 | /downloads/stable/android/latest.json | /downloads/android/latest.json |
| R2 发布前缀 | releases/stable/ | releases/ |
| 学习进度 | 独立空白本机记录 | 原账号记录 |

Windows appId、NSIS 安装身份、安装目录、快捷方式和 userData 均隔离；进程单实例锁在各自 userData 下。Android 由包名和动态 FileProvider authority 隔离。应用内仍只显示 CYword，系统安装列表和快捷方式用 CYword Stable 区分正式版。

## 源码维护

正式版在 codex/stable-release 分支维护。main 当前保留 Beta 开发及尚未发布的同步改动；发布 Beta 前仍须完成该版本自己的验收。通用学习功能修复可按提交选择移植，禁止把认证门禁、同步启动或旧安装身份带回正式版，也不能把本地匿名进度模式替换到 Beta。

正式版 Windows 标签为 v0.1.0，Android 为 android-stable-v0.1.0。历史 android-v0.1.0 已存在，必须保留。今后发布 Beta 应在 GitHub 勾选 Pre-release，或使用 gh release create --prerelease --latest=false；Beta 不作为官网下载区的回退版本。

## 发布次序

1. 在保留生产认证和同步实现的基础上部署兼容独立渠道的 Pages 下载函数，不上线尚未验收的同步协议。
2. 完成数据检查、本机持久化与渠道隔离测试，冻结 dist/、electron/ 和版本元数据，再顺序打包 Windows 与 Android。
3. 创建并核验 GitHub Release 原件；正式版不是 Pre-release，Windows 正式版显式设为 Latest。
4. 工作流从对应正式版标签读取源码和原资产，上传 releases/stable/ 下所有不可变对象，最后更新各平台正式版 current.json。任何错误不得触碰 Beta 指针。
5. 更新官网已核验回退元数据与正式版说明，部署 Pages。官网仅显示正式版；旧下载地址和账号服务保留给 Beta。

发布脚本会核验元数据、整包哈希及 blockmap，并检查服务端渠道能力。Android 工作流支持通过 workflow_dispatch 指定 android-stable-v 标签；Windows 标签工作流会复用已有 Release 安装包，拒绝 Pre-release 或不完整资产。

## 本地预览

在 codex/stable-release 分支工作区运行 npm run dev 可预览独立正式版桌面窗口；npm run dev:web 在 http://127.0.0.1:5173/ 打开无登录浏览器预览，npm run dev:mobile 支持局域网手机。npm run dev:site 在 http://127.0.0.1:5174/ 预览官网。

浏览器进度使用 cyword-stable:progress:cet6，与 Beta 的 cyword-progress:<账号> 键隔离；不扫描旧目录、不复制数据。开发预览按需读取本机资源，发布安装包包含全部资源。

## 本轮证据

2026-09-28 已发布。两端安装包来自提交 347374b8f4f218388207d868b030f40b77b2a474，发布后没有重建或覆盖资产。

- [Windows 0.1.0](https://github.com/cheng-yi-cc/CYword/releases/tag/v0.1.0) 为 Latest；[Android 0.1.0](https://github.com/cheng-yi-cc/CYword/releases/tag/android-stable-v0.1.0) 为独立正式 Release。既有 Windows 0.4.13 / Android 0.1.11 均已改为 Pre-release，保留原件。
- [Windows 发布工作流](https://github.com/cheng-yi-cc/CYword/actions/runs/36379609765)和 [Android 发布工作流](https://github.com/cheng-yi-cc/CYword/actions/runs/36380176120)成功；完整 GitHub 与 R2 对象摘要通过，公网验证指针、HEAD、首尾范围、差量清单和跳转，两份 Beta 指针前后完全一致。
- [官网](https://cyword.chengyi.me)已部署，桌面 1280px、手机 390px 及禁用 JavaScript 的备用入口均只提供正式版。生产部署为 https://1231be40.cyword.pages.dev；认证与同步仍使用既有生产实现。
- Windows 已在 D:/CYword Stable 安装，并与 D:/CYword 的 Beta 0.4.13 同时启动验证：用户目录独立，初始进度为空，桥接 API 不提供登录或同步。安卓包名、版本码、签名及 11,356 个 APK 文件通过校验；未连接安卓设备，未做真机安装验收。
- 自动化检查通过：162 项单元/服务测试、16 项学习界面、9 项完整资源界面、2 项官网界面、25 项本地 R2 下载测试。词书校验 5166 词，原文及媒体保留。

产物字节数、SHA-256、签名、公网地址及页面结果见[机器可读证据](verification/2026-09-28-stable-release.json)。
