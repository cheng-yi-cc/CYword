# 安卓与进度同步

安卓 0.1.2 提供 Android 7.0（API 24）及以上安装包。界面与排课逻辑复用 `src/`，通过 Capacitor 打包成本机应用。首版需联网获取词书、登录和同步；没有完整词书离线下载功能。2026-09-20 已完成生产 D1 授权、`learning_progress` 建表和官网同步函数部署，未认证请求返回 401；真实账号跨设备读写尚未验证。2026-09-20 已发布 0.1.1（versionCode 502）及配套官网函数，包含单词搜索、已学词进度、缓存、凭据保护和同步修复。

## 使用与预览

1. 安装 `release/CYword-Android-0.1.2.apk`；电脑端安装同目录的 0.4.5 Windows 安装器。
2. 两端使用同一邮箱登录。手机右上角“我的”显示同步状态，可点“立即同步”；电脑侧栏也显示同步状态。
3. 学习评级后在约 800 毫秒无新操作时同步；切回应用、恢复网络或前台 15 秒轮询时拉取另一端记录。换设备前确认“已与云端同步”。
4. 每个未评级词必须先选熟练度；本机写入成功后才前进，写入失败留在当前词并可重试。回看已评级词可直接前进。`segmentEnds` 只标记当天的休息点，不拆开同日互依单元，不改变曝光顺序、词根分组或三学一复习规则。
5. 底部“单词搜索”按前缀筛选全书：输入展开候选，提交后搜索框收至顶部并显示完整结果，点击可打开强制评级详情。任一评级算已学，计入相关学习日；搜索不伪造计划曝光或复习记录。

`npm run dev:mobile` 启动 `http://127.0.0.1:5173/`。手机与电脑在同一网络时访问电脑局域网 IP 的 5173 端口。默认读取本地编译词书，开发验证码自动填入，模拟同步进度只存于开发服务器内存，与线上账号隔离；浏览器的账号进度仍保存在 localStorage。重启开发服务后重新登录。联调生产服务时，在 PowerShell 中设置 `$env:CYWORD_REAL_AUTH='1'` 后再启动；认证、同步和词书接口均切换到线上，生产需要实际邮箱验证码。

以音记形与以熟带生复用同一套组件和审核数据，手机上点按参照词打开底部悬浮卡。0.1.1 与线上增强词书 `90284475439a197b` 已发布；默认本地预览可检查尚未发布的数据修改。当前只完成浏览器窄屏验证，未做增强功能的安卓真机验收。

## 应用内检查更新（0.1.2 起）

启动和回到前台时自动读取官网 `/downloads/android/latest.json`，自动检查之间至少间隔 6 小时；“我的 → 检查更新”可立即检查。当前版本来自原生 `App.getInfo()` 的已安装 `versionName`，不使用 Windows 的 `package.json`。仅当官网版本更高时显示下载入口，同版或回退指针不会提示降级。断网、服务异常或无效清单显示可重试状态，不影响登录、保存和学习。

新版本提示可选“稍后”，学习会话中隐藏；手动入口仍在“我的”。点击下载后通过原生 `AppUpdates` 插件打开系统浏览器，下载完成后点击 APK 并由系统确认覆盖安装。前端校验安卓版本、文件名、哈希和内容寻址路径，原生插件再次限制为官网版本化 APK 地址。不会后台下载或静默安装，也不新增应用内安装权限。

0.1.0 / 0.1.1 尚无检测功能，需从官网手动覆盖安装一次 0.1.2，之后才能在应用内检测后续版本。浏览器预览与 Windows 不启用安卓更新器。

## 构建与签名

- Node.js 24、JDK 21、Android SDK Platform 36，以及 Gradle 自动选择的构建工具。
- `CYWORD_JAVA_HOME` 优先指定 JDK，其次为 `JAVA_HOME`。本机已在 `D:/tools/cyword-android/` 安装的 JDK 21 也会自动识别。
- `ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 指定 SDK，Windows 默认查找用户 `AppData/Local/Android/Sdk`。生成的 `android/local.properties` 不提交。
- `npm run android:debug` 生成调试 APK；`npm run android:release` 校验数据、构建前端、同步安卓工程、构建正式签名 APK。
- 正式 APK 输出 `release/CYword-Android-<版本>.apk`。首次构建在用户目录 `.cyword/` 生成 `android-release.p12` 与 `android-signing.json`。后续升级必须使用同一份密钥，丢失密钥后无法覆盖安装旧 App。
- 可用 `CYWORD_ANDROID_SIGNING_FILE` 指向已有的私有签名配置；格式与自动生成文件一致。签名文件、密码、构建输出不进入 Git。备份时将密钥和配置一起保存在安全位置，不放进公开下载包。
- 应用仅申请网络权限，关闭系统备份以避免会话令牌随设备备份迁移；系统返回键先关闭学习/全屏详情；没有活动详情时将应用切到后台。

## 存储与迁移

Windows 进度原子写入 `userData/accounts/<SHA-256 账号 ID>/progress.json`。`session.json` 中的令牌改由 Electron `safeStorage` 使用 Windows DPAPI 加密；读取旧明文会话时原子替换为密文，保留账号信息，不产生明文备份。系统加密不可用时返回错误，不降级明文。DPAPI 保护范围是 Windows 用户，不能隔离同一用户权限下的其他程序。

安卓通过自有 `DeviceStoragePlugin` 使用 Android Keystore 中的 AES 密钥，以 GCM 加密会话后存入 `CywordCredentials`。旧 `CapacitorStorage` 中的明文会话只有在密文提交成功后才移除；解密失败不会退回读取旧明文。账号进度仍使用 Preferences 的原键 `cyword-progress:<账号 ID>`，学习保存通过原生 `commit()` 确认落盘；失败时恢复内存缓存并向界面报错。浏览器预览继续使用 localStorage。

旧版桌面 `progress.json` 只在启动时已登录账号与目标账号相同且尚未迁移时导入，保留原文件和 `progress-owner.json` 归属标记。安卓/浏览器旧预览进度同样只向升级启动时的已登录账号迁移，并写入一次性归属标记。凭据加密迁移不改写学习进度。旧文件没有可验证归属时不会自动上传，需要先人工确认归属再导入，避免把他人记录混入账号。

进度仍为 `version: 2`，可选 `bookmarkChanges` 仅用于兼容旧收藏记录，无需破坏性迁移。新版“词汇掌握”直接依据已有评级整理，未学词不进入待巩固列表，已掌握词只移出列表、不删除进度。合并规则：

- 实际已评级的“组 × 单词”取并集，再依据目录和已有词汇状态重算分组及学习日完成情况；任何已有评级均算已学，不为搜索评级补造曝光。
- 熟练度沿用所有已发布客户端相同的 `lastSeenAt` 比较规则，首次学习时间取较早值；曝光和复习历史去重。保存时只对本次真正评级的词使用单调时间戳：取用户时间与该设备已观察到的该词时间加 1 毫秒中的较大值，避免看过快时钟设备的评级后无法重新评级。不增加协议字段；尚未见到远端记录的离线并发仍按既有时间及确定性平局规则合并，设备时钟仍应保持正确。
- 旧收藏按变更时间合并，取消收藏的标记保留；不用于新版词汇掌握列表。
- 同一复习会话合并完成集合并保留难度顺序；重新开始的会话按较新的开始时间选择。
- 保存与云端合并串行执行，写盘成功后才发布新的内存状态；失败评级不会混入后续上传。界面保存时传入原渲染快照，避免将其中未改动的旧词误判为重新评级。
- `flush()` 明确返回 `{ localSaved, cloudSynced, message }`。退出账号前本机保存失败则阻止退出；本机已保存但云端未完成时说明跨设备记录可能滞后，由用户选择继续退出或保留登录重试。
- 网络失败保留本机记录和登录态；401 清除会话并回到登录页，本机记录保留。账号切换后丢弃旧账号请求的延迟响应。

## 详情加载与会话

`useWordResources` 以词书代码和 `dataVersion` 隔离缓存，`WordResourceCache` 默认只保留最近使用的 256 个详情，并按单词合并正在进行的重复请求。学习、复习和列表详情先加载当前词，再小批预取后面最多 4 个词；不再启动整日或累计复习全量详情请求。失败显示当前详情内的重试入口，已加载内容和其他页面仍可使用。

学习与详情共用 `useSessionSave` 保存锁、`useSessionDialog` 和单通道 `PronunciationPlayer`。点击和键盘不能重复提交；Tab 焦点留在活动弹层内，Esc/安卓返回键优先关闭词汇悬浮卡，再关闭会话，关闭后恢复焦点和滚动。新发音停止旧发音，关闭会话也停止播放；播放失败就地提示重试。

## 云端开通

复用官网 Pages 的 `DB` 和 `JWT_SECRET`，不新增付费套餐或公开 R2 权限。先创建表，再发布函数：

```powershell
npx wrangler d1 execute cyword-db --cwd website --remote --file migrations/0001_progress.sql
npm run deploy:site
```

Wrangler 需要既有 Pages 权限及 D1 写入范围。认证错误 `10000` 或缺少 `d1:write` 时，应补充用户授权后重试，不可绕开权限限制。2026-09-20 经用户授权补充 `d1:write`，执行建表成功，并通过 `PRAGMA table_info(learning_progress)` 核对线上结构。

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

`npm test` 覆盖原有规则、缓存去重/版本/LRU、音频竞态、休息点、进度合并、修订冲突、写盘失败不上传、快慢设备的单调评级时间、新旧客户端相同合并赢家、上传期间继续评级和账号切换后的延迟响应。真实本地 Worker+D1 测试覆盖授权与隔离，以及验证码并发核销、发码冷却、错误次数限制和账号创建/登录计数。`npm run check:site` 验证函数类型。

2026-09-20 已在 Windows 实际运行 Electron safeStorage/DPAPI，验证旧明文会话转密文、回读及退出清除；安卓 Release 构建通过，0.1.2 APK 签名证书与 0.1.0 / 0.1.1 一致，最低 API 24、目标 API 36。ADB 未连接真机，不能将构建成功视为 Keystore 真机迁移或真实账号跨设备同步已验收。

浏览器移动尺寸检查应覆盖首页、计划、学习、词根/长难句、回看、词汇掌握（筛选/搜索/重新评级）、单词搜索（候选/提交/详情返回）和复习；0.1.2 正式 APK 已完成构建与签名校验。此前搜索改版通过 390×844 浏览器尺寸检查；仍须在真机安装后确认键盘、安全区域、音频、覆盖升级和凭据迁移。

## 独立版本与官网发布

安卓版本统一维护在 `android/version.json`；`versionName` 为公开版本号，`versionCode` 必须递增。首个公开版本为 0.1.0，内部序号为 501，以兼容此前序号 500 的本地测试包覆盖安装。当前公开版本为 0.1.2，内部序号 503。桌面版本继续由 `package.json` 维护。

正式签名构建后，创建 `android-v<versionName>` 标签及同名 GitHub Release，将对应 APK 上传并将该 Release 标为非最新（`--latest=false`），保留 Windows Release 的最新标识。`.github/workflows/publish-android.yml` 在 Android Release 发布后读取同一份 APK，上传到专用 R2 桶的 `releases/android/<版本>/<sha256>/`，校验长度与 SHA-256 后最后更新 `releases/android/current.json`，已有同路径资产必须字节相同才能复用，不能覆盖。已有 Release 可手动触发工作流并传入标签重试上传，无需重新生成 APK。

GitHub Release 是维护者发布与工作流取件的来源，普通用户从官网受控下载入口获取安装包，不将私有仓库页面作为备用下载。

官网读取 `/downloads/android/latest.json`，稳定下载入口为 `/downloads/android/latest`；Windows 自动更新继续使用独立的 `/downloads/latest.yml`。生产下载函数同时接受旧 v1 和新 v2 私有发布指针，公开 JSON 只提供官网路径、版本及校验信息。2026-09-20 已按先兼容函数、后安装包的顺序启用 v2；新环境仍须遵守此顺序。发布脚本在任何 R2 写入前，向固定官网域名的相应 `latest.json` 发起不跟随重定向的 HEAD 请求，只有响应头 `X-CYword-Release-Schemas` 确认支持 2 才继续；未发布 APK 的 404 响应也可声明此能力。普通 Git 推送不会部署官网函数。
