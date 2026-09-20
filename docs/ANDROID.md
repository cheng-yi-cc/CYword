# 安卓与进度同步

0.5.0 提供 Android 7.0（API 24）及以上安装包。界面与排课逻辑复用 `src/`，通过 Capacitor 打包成本机应用。首版需联网获取词书、登录和同步；没有完整词书离线下载功能。截至 2026-09-20，正式云同步尚未开通；以下跨设备使用流程须先完成“云端开通”步骤。本地模拟同步已验证，不等同于生产已上线。

## 使用与预览

1. 安装 `release/CYword-Android-0.5.0.apk`；电脑端安装同目录的 0.5.0 Windows 安装器。
2. 两端使用同一邮箱登录。手机右上角“我的”显示同步状态，可点“立即同步”；电脑侧栏也显示同步状态。
3. 学习评级后在约 800 毫秒无新操作时同步；切回应用、恢复网络或前台 15 秒轮询时拉取另一端记录。换设备前确认“已与云端同步”。
4. 每个未评级词必须先选熟练度；回看已评级词可直接前进。词根分组和三学一复习规则不变。

`npm run dev:mobile` 启动 `http://127.0.0.1:5173/`。手机与电脑在同一网络时访问电脑局域网 IP 的 5173 端口。默认开发验证码自动填入，模拟进度只存于开发服务器内存，与线上账号隔离。重启开发服务后重新登录。联调生产服务时，在 PowerShell 中设置 `$env:CYWORD_REAL_AUTH='1'` 后再启动；生产需要实际邮箱验证码。

## 构建与签名

- Node.js 24、JDK 21、Android SDK Platform 36，以及 Gradle 自动选择的构建工具。
- `CYWORD_JAVA_HOME` 优先指定 JDK，其次为 `JAVA_HOME`。本机已在 `D:/tools/cyword-android/` 安装的 JDK 21 也会自动识别。
- `ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 指定 SDK，Windows 默认查找用户 `AppData/Local/Android/Sdk`。生成的 `android/local.properties` 不提交。
- `npm run android:debug` 生成调试 APK；`npm run android:release` 校验数据、构建前端、同步安卓工程、构建正式签名 APK。
- 正式 APK 输出 `release/CYword-Android-<版本>.apk`。首次构建在用户目录 `.cyword/` 生成 `android-release.p12` 与 `android-signing.json`。后续升级必须使用同一份密钥，丢失密钥后无法覆盖安装旧 App。
- 可用 `CYWORD_ANDROID_SIGNING_FILE` 指向已有的私有签名配置；格式与自动生成文件一致。签名文件、密码、构建输出不进入 Git。备份时将密钥和配置一起保存在安全位置，不放进公开下载包。
- 应用仅申请网络权限，关闭系统备份以避免会话令牌随设备备份迁移；系统返回键先关闭学习/全屏详情；没有活动详情时将应用切到后台。

## 存储与迁移

Windows 进度：`userData/accounts/<SHA-256 账号 ID>/progress.json`，原子写入。安卓使用 Preferences 保存账号独立进度和会话；浏览器使用 `cyword-progress:<账号 ID>`。旧版桌面 `progress.json` 只在启动时已登录账号与目标账号相同且尚未迁移时导入，保留原文件和 `progress-owner.json` 归属标记。旧文件没有可验证归属时不会自动上传，需要先人工确认归属再导入，避免把他人记录混入账号。

进度仍为 `version: 2`，可选 `bookmarkChanges` 仅用于兼容旧收藏记录，无需破坏性迁移。新版“词汇掌握”直接依据已有评级整理，未学词不进入待巩固列表，已掌握词只移出列表、不删除进度。合并规则：

- 已评级的“组 × 单词”取并集，再依据目录重算分组和学习日完成状态。
- 熟练度取较新的 `lastSeenAt`，首次学习时间取较早值；曝光和复习历史去重。设备时间应保持正确。
- 旧收藏按变更时间合并，取消收藏的标记保留；不用于新版词汇掌握列表。
- 同一复习会话合并完成集合并保留难度顺序；重新开始的会话按较新的开始时间选择。
- 网络失败保留本机记录并显示失败状态；账号切换后丢弃旧账号请求的延迟响应。

## 云端开通

复用官网 Pages 的 `DB` 和 `JWT_SECRET`，不新增付费套餐或公开 R2 权限。先创建表，再发布函数：

```powershell
npx wrangler d1 execute cyword-db --cwd website --remote --file migrations/0001_progress.sql
npm run deploy:site
```

Wrangler 需要既有 Pages 权限及 D1 写入范围。认证错误 `10000` 或缺少 `d1:write` 时，应补充用户授权后重试，不可绕开权限限制。2026-09-17 初次执行建表被拒绝，未改变生产数据库；完成授权和实际部署验证前，不能宣称线上同步已启用。

`GET /api/progress` 返回 `{ revision, progress }`。`PUT` 请求携带同样结构，使用 `Authorization: Bearer <登录令牌>`。服务端只以令牌中的用户身份选择记录，客户端不能指定其他账号。

- `200`：成功，写入后的修订号增加 1。
- `409`：另一端已更新，返回最新快照；客户端合并后重试。
- `401`：令牌无效或过期，重新登录后同步。
- `400` / `413`：数据结构无效或超限；`503`：认证配置、数据库或网络异常。

D1 表 `learning_progress` 按 `(user_id, book_code)` 唯一，存储修订号、gzip 压缩快照与更新时间。请求最多 12 MB、压缩快照最多 1.8 MB。接口不缓存用户数据，不在错误响应中泄露数据库细节。`website/public/_routes.json` 包含精确路径 `/api/progress`。

PowerShell 调用示例（令牌仅放在进程变量中，不写入仓库）：

```powershell
$syncHeaders = @{ Authorization = "Bearer $env:CYWORD_USER_TOKEN" }
$syncState = Invoke-RestMethod -Uri "https://cyword.chengyi.me/api/progress" -Headers $syncHeaders
# 上传前将本地记录与 $syncState.progress 合并；不要直接覆盖另一端快照。
# PUT 请求正文结构为 @{ revision = $syncState.revision; progress = $mergedProgress }。
```

## 验证

`npm test` 覆盖原有规则、进度合并、修订冲突、上传期间继续评级、取消收藏、账号切换后的延迟响应，以及真实本地 Worker+D1 的授权与隔离。`npm run check:site` 验证函数类型。

浏览器移动尺寸检查应覆盖首页、计划、学习、词根/长难句、回看、词汇掌握（筛选/搜索/重新评级）和复习；正式交付还需 APK 签名校验。本机没有连接的安卓设备时，仅能报告已完成构建与浏览器触屏模拟，真机的键盘、安全区域和音频须安装后确认。
