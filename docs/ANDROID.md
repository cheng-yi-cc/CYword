# 安卓与进度同步

> 2026-09-28 渠道拆分：当前分支为无账号、无同步的正式版 0.1.0；下文历史版本、账号与同步说明属于 Beta。当前安装身份、数据和发布入口见 [RELEASE-CHANNELS.md](RELEASE-CHANNELS.md)。

Android 0.1.11/code 512 与 Windows 0.4.13 共用增量同步。完整词书、发音、配图和字体随包离线可用；进度先可靠保存本机，再自动双向同步，同账号两端接续。计划按完成情况推进，不按自然日期推进。规则与恢复边界见 [OFFLINE.md](OFFLINE.md)，真机覆盖范围见 [验收记录](FIRST-RELEASE-ACCEPTANCE.md)。

## 使用与预览

首次联网登录后使用包内资源；新设备先恢复云端进度，已有有效本机记录可离线启动。三档有效评级均算学习覆盖，本机提交成功后才推进下一词。复习日须完成所有前置学习及复习，搜索评级不伪造复习历史。

`npm run dev:mobile` 使用 `http://127.0.0.1:5173/`，默认模拟账号和同步服务，与线上账号隔离；词书直读本机编译结果。`CYWORD_REAL_AUTH=1` 切换实际认证和双向进度读写，会更新登录账号，故障注入只用专用账号和环境。

正式安装包通过 `npm run android:release` 生成。隔离验收设置独立 HTTPS `CYWORD_ACCEPTANCE_ORIGIN` 后运行 `node scripts/build-acceptance.mjs all`；产物在 `release/acceptance/`，安卓包名 `me.chengyi.cyword.acceptance`、Windows 名称和数据目录 `CYword Acceptance`，不覆盖日常应用。仅隔离 APK 开启 ADB WebView 调试；正式构建不启用。

## 应用内检查更新（0.1.2 起）

启动和回到前台时自动读取官网 `/downloads/android/latest.json`，自动检查之间至少间隔 6 小时；“我的 → 检查更新”可立即检查。当前版本来自原生 `App.getInfo()` 的已安装 `versionName`，不使用 Windows 的 `package.json`。仅当官网版本更高时显示下载入口，同版或回退指针不会提示降级。断网、服务异常或无效清单显示可重试状态，不影响登录、保存和学习。

新版本提示可选“稍后”，学习会话中隐藏；手动入口仍在“我的”。0.1.5 起点击下载由原生插件执行下述差量流程；完整 APK 下载保留为明确的备用入口。前端和原生插件均限制官网内容寻址地址，不后台下载或静默安装。

0.1.0 / 0.1.1 尚无检测功能，需从官网手动覆盖安装一次 0.1.2，之后才能在应用内检测后续版本。浏览器预览与 Windows 不启用安卓更新器。

## 构建与签名

- Node.js 24、JDK 21、Android SDK Platform 36，以及 Gradle 自动选择的构建工具。
- `CYWORD_JAVA_HOME` 优先指定 JDK，其次为 `JAVA_HOME`。本机已在 `D:/tools/cyword-android/` 安装的 JDK 21 也会自动识别。
- `ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 指定 SDK，Windows 默认查找用户 `AppData/Local/Android/Sdk`。生成的 `android/local.properties` 不提交。
- `npm run android:debug` 生成调试 APK；`npm run android:release` 校验数据、构建前端、同步安卓工程、构建正式签名 APK。
- 正式 APK 输出 `release/CYword-Android-<版本>.apk`。首次构建在用户目录 `.cyword/` 生成 `android-release.p12` 与 `android-signing.json`。后续升级必须使用同一份密钥，丢失密钥后无法覆盖安装旧 App。
- 可用 `CYWORD_ANDROID_SIGNING_FILE` 指向已有的私有签名配置；格式与自动生成文件一致。签名文件、密码、构建输出不进入 Git。备份时将密钥和配置一起保存在安全位置，不放进公开下载包。
- 应用申请网络权限；差量更新使用 `REQUEST_INSTALL_PACKAGES`，首次点击安装时由系统确认安装来源权限，不申请存储访问权限。关闭系统备份以避免会话令牌随设备备份迁移；系统返回键先关闭学习/全屏详情；没有活动详情时将应用切到后台。

## 差量下载与系统安装（0.1.5 起）

保留启动/恢复前台的 6 小时检查和手动重试。点击下载后，原生插件校验官网提供的分块清单，直接从 `applicationInfo.sourceDir` 复用已安装 APK 的相同压缩数据，仅请求缺失范围；小文件头内嵌在清单中，避免数千次小请求。当前完整 APK 的清单约 4.1 MB。

临时文件写入应用缓存 `cyword-updates/<目标哈希>.apk`；中断或应用重启后再次下载会逐块复核并继续，不再下载已完成内容。需要容纳约一个完整 APK 的临时空间。整包 SHA-256、包名、版本名、递增 versionCode 和相同签名证书检查通过后显示“安装更新”；系统权限授权后返回再次点击即可安装。差量失败不会自动转为全量，账号菜单提供明确的完整 APK 浏览器下载入口。

Android 0.1.4 及以前仍只支持浏览器完整下载，需先覆盖安装带此能力的新版本；之后的版本才使用差量。首次下载仍为完整预装词书安装包。本地重建与失败恢复、隔离真机权限与系统覆盖安装已经验证；具体设备及版本见验收记录，正式发布核验见 [运行手册](RUNBOOK.md)。

## 存储与同步

Windows 进度写入 `userData/accounts/<SHA-256 账号 ID>/progress.json`，文件同步后原子替换，并保留有效副本；会话令牌由 DPAPI 加密。Android 使用 Keystore AES-GCM 保存会话，Preferences 原生同步提交主进度及备份，失败回滚内存缓存。损坏原件保留后尝试恢复，凭据异常不删除学习记录，也不降级保存明文。

学习数据版本为 2。所有新评级使用每词逻辑版本 `(counter, actor)`，已观察版本加一；离线并发相同计数按 actor 字典序收敛，允许降低熟练度。学习覆盖、曝光键和同轮复习记录合并保留，统计和完成状态从合法记录派生。本机保存、远端合并与同步确认串行执行；未上传的新评级不能被较早响应标记为已同步。

默认自动同步，前台每 5 秒检查，启动、回前台、联网和评级后立即或短延时触发。401 暂停请求但继续本机学习；重新登录后补同步。新设备首次云端读取失败不会初始化并上传空进度。账号切换丢弃旧请求结果，待同步记录独立保存。

`flush()` 返回本机保存与云端确认两种状态；关闭、退出、账号切换和安装更新都先等待本机保存。失败保留界面；仅云端未完成时可明确确认后离开。Android 进后台不要求上传完成，系统终止后依靠已提交记录恢复。

不自动迁移无归属旧进度，不删除维护者已有文件，不提供手动导入导出。完整冲突与恢复规则见 [离线与同步说明](OFFLINE.md)。

## 详情加载与会话

`useWordResources` 以词书代码和 `dataVersion` 隔离缓存，`WordResourceCache` 默认只保留按访问时间保留的 256 个详情，并按单词合并正在进行的重复请求。学习、复习和列表详情先加载当前词，再小批预取后面最多 4 个词；不再启动整日或累计复习全量详情请求。失败显示当前详情内的重试入口，已加载内容和其他页面仍可使用。

学习与详情共用 `useSessionSave` 保存锁、`useSessionDialog` 和单通道 `PronunciationPlayer`。点击和键盘不能重复提交；Tab 焦点留在活动弹层内，Esc/安卓返回键优先关闭词汇悬浮卡，再关闭会话，关闭后恢复焦点和滚动。新发音停止旧发音，关闭会话也停止播放；播放失败就地提示重试。

## 云端开通

复用官网 Pages 的 `DB` 和 `JWT_SECRET`，不新增付费套餐或公开 R2 权限。先创建表，再发布函数：

```powershell
npx wrangler d1 execute cyword-db --cwd website --remote --file migrations/0001_progress.sql
npx wrangler d1 execute cyword-db --cwd website --remote --file migrations/0002_progress_snapshots.sql
npx wrangler d1 execute cyword-db --cwd website --remote --file migrations/0003_auth_mail_budget.sql
npx wrangler d1 execute cyword-db --cwd website --remote --file migrations/0004_incremental_progress.sql
npm run deploy:site
```

Wrangler 需要既有 Pages 权限及 D1 写入范围。认证错误 `10000` 或缺少 `d1:write` 时，应补充用户授权后重试，不可绕开权限限制。2026-09-20 经用户授权补充 `d1:write`，执行建表成功，并通过 `PRAGMA table_info(learning_progress)` 核对线上结构。

生产迁移须先于客户端发布执行；验收使用独立数据库与 Pages 项目，配置文件不提交。当前客户端使用 `POST /api/progress-incremental`，正文包含协议 2、词书和课程版本，`action` 为 `read`、`stage` 或 `commit`。使用 `Authorization: Bearer <登录令牌>`，服务端只以认证身份选择记录，客户端不能指定其他账号。

- `200`：读取、暂存或提交成功，只有原子提交才使修订号增加 1；幂等重发不重复计数。读取返回空增量且修订号未变时，客户端内部视作 304，不重写本机。
- `409`：另一端已更新；客户端读取增量、合并后重试。
- `401`：令牌无效或过期，重新登录后同步。
- `400` / `413`：数据结构无效或超限；`503`：认证配置、数据库或网络异常。

D1 `progress_heads_v2` 保存账号/词书修订号，`progress_records_v2` 保存每词及日期记录，暂存与可见记录分离。每次读取最多 32 条，每次暂存最多 24 条，请求最多 96000 字节。完整传输与恢复规则见 [OFFLINE.md](OFFLINE.md)。接口不缓存用户数据，不在错误响应中泄露数据库细节。`website/public/_routes.json` 包含精确路径 `/api/progress-incremental`；旧 `/api/progress` 和 `learning_progress` 保留。

PowerShell 调用示例（令牌仅放在进程变量中，不写入仓库）：

```powershell
$syncHeaders = @{ Authorization = "Bearer $env:CYWORD_USER_TOKEN" }
$syncBody = @{ protocol = 2; bookCode = 'cet6'; curriculumVersion = '<当前编译版本>'; action = 'read'; after = 0; cursor = '' } | ConvertTo-Json
$syncState = Invoke-RestMethod -Method Post -Uri "https://cyword.chengyi.me/api/progress-incremental" -Headers $syncHeaders -ContentType 'application/json' -Body $syncBody
# 诊断单页读取；实际同步使用 src/incremental-client.ts，不能把单页当成完整进度。
```

## 验证

`npm test` 覆盖原有规则、缓存去重/版本/LRU、音频竞态、预装词书读取、进度合并、修订冲突、写盘失败不上传、快慢设备的逻辑版本、离线并发确定性合并、上传期间继续评级和账号切换后的延迟响应。`npm run test:ui` 覆盖取消分段后的连续评级和整日完成。真实本地 Worker+D1 测试覆盖授权与隔离，以及验证码并发核销、发码冷却、错误次数限制和账号创建/登录计数。`npm run check:site` 验证函数类型。

2026-09-20 的历史验证包括 Windows Electron safeStorage/DPAPI 的旧明文会话转密文、回读及退出清除，以及 Android 0.1.2 构建和旧版签名一致；当时未连接真机。2026-09-27 已在 Android 16 USB 真机安装隔离候选、真实登录、断网重启、与 Windows 双向接续及覆盖升级，完整版本与限制见 [验收记录](FIRST-RELEASE-ACCEPTANCE.md)。本次不声称验证过历史 Keystore 迁移矩阵。

浏览器移动尺寸检查覆盖首页、计划、学习、词根/长难句、回看、词汇掌握（筛选/搜索/重新评级）、单词搜索（候选/提交/详情返回）和复习。历史 0.1.5 已完成构建、预装资源及官网下载摘要校验；本次隔离候选进一步记录真机键盘、返回、发音、字体/横屏及覆盖升级结果，不以浏览器尺寸检查替代实机。

## 独立版本与官网发布

安卓版本统一维护在 `android/version.json`；`versionName` 为公开版本号，`versionCode` 必须递增。首个公开版本为 0.1.0，内部序号为 501，以兼容此前序号 500 的本地测试包覆盖安装。当前正式版本为 0.1.11 / 512，签名证书保留；同版本隔离验收包使用独立包名，不能替代正式包。桌面版本继续由 `package.json` 维护。

正式签名构建后，创建 `android-v<versionName>` 标签及同名 GitHub Release，将对应 APK 上传并将该 Release 标为非最新（`--latest=false`），保留 Windows Release 的最新标识。`.github/workflows/publish-android.yml` 在 Android Release 发布后读取同一份 APK，上传到专用 R2 桶的 `releases/android/<版本>/<sha256>/`，校验长度与 SHA-256 后最后更新 `releases/android/current.json`，已有同路径资产必须字节相同才能复用，不能覆盖。已有 Release 可手动触发工作流并传入标签重试上传，无需重新生成 APK。

GitHub Release 是维护者发布与工作流取件的来源，普通用户从官网受控下载入口获取安装包，源码及 Release 均公开，应用内更新仍使用官网源。

官网读取 `/downloads/android/latest.json`，稳定下载入口为 `/downloads/android/latest`；Windows 自动更新继续使用独立的 `/downloads/latest.yml`。生产下载函数同时接受旧 v1 和新 v2 私有发布指针，公开 JSON 只提供官网路径、版本及校验信息。2026-09-20 已按先兼容函数、后安装包的顺序启用 v2；新环境仍须遵守此顺序。发布脚本在任何 R2 写入前，向固定官网域名的相应 `latest.json` 发起不跟随重定向的 HEAD 请求，只有响应头 `X-CYword-Release-Schemas` 确认支持 2 且声明 `X-CYword-Android-Differential: zip-sha256-1m` 才继续；未发布 APK 的 404 响应也可声明此能力。普通 Git 推送不会部署官网函数。
