# 运行手册

本次版本为 Windows 0.4.6、Android 0.1.3（versionCode 504）。正式下载状态及核验结果见发布记录，历史记录保留如下。

Windows 0.4.6 / Android 0.1.3 实现登录后下载完整文字及发音、离线学习、本地进度和一次性旧云端导入。预览时首次完整下载后从 IndexedDB 读取；`CYWORD_REAL_AUTH=1` 不会启用上传，只有 `VITE_CYWORD_PROGRESS_MODE=cloud` 显式恢复双向同步。词书重编译后的本地重下载步骤和验证边界见 [OFFLINE.md](OFFLINE.md)。源码与 Release 已公开；官网更新源及生产资源均保留。

## Android 0.1.2 发布记录（2026-09-20）

更新功能提交 `302dff5`，标签 `android-v0.1.2`，发布工作流 `35516762034` 成功。正式文件 `CYword-Android-0.1.2.apk` 为 20602203 字节，SHA-256 为 `f489133bdc9b1ec5024c145ae85635aae630ed839f1dc0ec5724193c2ab842c0`，签名证书沿用旧版。Windows 0.4.5 发布指针不变。

93 项自动化测试及新增的手机更新界面回归通过，Release 构建和签名校验通过；线上完整下载、HEAD、Range、文件长度与哈希一致，更新器对线上清单验证了旧版本可更新、同版本不更新。浏览器跳转和覆盖安装仍未做安卓真机验收。

0.1.1 及更早版本需要先手动覆盖安装 0.1.2。之后在“我的 → 检查更新”检查，或等待启动/返回前台的自动检查；点击下载后由浏览器下载 APK，再由系统确认安装。

## Windows 0.4.5 / Android 0.1.1 发布记录（2026-09-20）

源代码提交为 `64d2673`，对应标签 `v0.4.5`、`android-v0.1.1`。Windows 工作流 `35515474154`、Android 工作流 `35515481499` 均成功；官网生产部署为 `15746604.cyword.pages.dev`。

| 平台 | 正式文件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| Windows 0.4.5 | `CYword-Setup-0.4.5.exe` | 129160435 | `3663022f0c87080ffb5cb4e411b2af8791e58969a2218ecbbf3f5c39a6b02320` |
| Android 0.1.1 | `CYword-Android-0.1.1.apk` | 20599591 | `d60443b82e0207a424c642777dcbba4f508ac42fdef86c56942a11c2da556b70` |

两个平台的 GitHub Release 与独立 R2 指针已发布。正式域名完整下载的长度、SHA-256、HEAD、Range 和稳定入口重定向通过核对；Windows `latest.yml` 的 SHA-512 与安装器一致，blockmap 全部分块校验通过，GitHub 和官网资产一致。安卓 APK 的签名证书 SHA-256 为 `389ff03f29e59fcf25ad2c2969b132bff20e2635a0960f24afe176b1b9a578fa`，与 0.1.0 一致。

词书目录版本为 `90284475439a197b`，目录完整哈希与本地发布产物一致，30 个分片各抽样一词的完整详情一致，旧版本对象保留。88 项应用测试、14 项浏览器回归、22 项本地 R2 检查和两项全书增强审计通过。官网桌面/手机冒烟验证覆盖双平台新版本记录、联系入口、隐藏滚动条和长难句收展；未登录请求 `/api/auth/me`、`/api/progress` 返回 401。

验证边界：Windows DPAPI 会话迁移已实测，未运行正式 0.4.5 安装器安装验收；安卓完成 Release 构建和签名校验，未连接真机，覆盖升级、Keystore 迁移、真机音频及真实账号跨设备同步仍需设备验收。内容来源材料的待补事项保留在 [来源台账](CONTENT-SOURCES.md)。

## 环境与首次启动

推荐 Windows 10/11、Node.js 24 LTS 和 npm，与标签构建工作流一致。进入仓库后执行：

```powershell
npm ci
npm run dev
```

`npm run dev` 会先校验六级规范表并生成 `data/`，随后启动 Vite 和 Electron。修改 CSV 后重新启动即可重新编译；不要直接编辑 `data/`。

手机/浏览器预览运行 `npm run dev:mobile`（5173，默认模拟登录与旧进度导入）。开发服务默认读取本地编译的六级词书，Electron 开发窗口同样连接该服务，因此本地增强数据可直接预览。`CYWORD_REAL_AUTH=1` 切换生产认证、旧进度导入及词书代理。桌面词书 API 可由 `CYWORD_BOOK_API_URL` 覆盖，安卓工具链及签名变量见 [ANDROID.md](ANDROID.md)。这些变量不改变正式云端的部署状态。

以音记形：进入「今日学习」打开任意单词，标题默认完整显示，单击可切换分块与重音；点击音标发音时临时分块，结束、停止和失败后恢复原状态，切词重置。点击「展开音形对照」检查对应关系。`npm run data:audit:pronunciation` 输出 5166 词逐条结构检查报告到 `.work/pronunciation/acceptance.json`。修改增强 JSONL 后需重新编译并刷新预览。

以熟带生：在词根词缀分析下方查看近义参照或反义对照，悬停、聚焦或点按参照词可打开悬浮卡。只显示本书计划中较早出现或实际已有学习记录的参照；没有合格参照的词不出现该板块。`npm run data:audit:meaning-bridges` 输出全书审核统计和每词首次位置的显示/隐藏结果到 `.work/meaning-bridges/acceptance.json`。纯浏览器可运行 `npm run dev:web`，打开 `http://127.0.0.1:5173/`。

## 常用检查

```powershell
npm run data:verify
npm test
npm run test:ui
npm run build:web
```

预期结果：数据校验报告 19 张表、5166 个唯一单词、0 个孤儿外键；自动测试全部通过；网页构建成功生成 `dist/`。

`npm run test:ui` 先生成本地数据，再运行 `tests/ui/` 的 Playwright 回归，覆盖加载失败与旧请求、评级保存期间导航、保存失败、搜索返回、同步和退出异常。当前配置使用本机已安装的 Chrome，测试服务固定为 `http://127.0.0.1:5183/`，每次独立启动，避免复用开发服务的 HMR 模块而使故障注入命中不同实例。用例使用独立浏览器上下文和测试数据，不以真实账号进度验证；失败截图与 trace 保存到 `.work/ui-results/`，不要提交。官网另运行 `npm run test:site:ui` 与 `npm run test:site:download`（含构建）。

界面冒烟使用 `npm run dev:mobile`，分别检查桌面与手机宽度：

- 单词搜索输入 `S`、`SY` 时按词书顺序显示候选，回车或搜索按钮展示完整结果；候选支持方向键和 Esc，打开详情后未评级不能前进，返回保留查询和位置。
- 提前搜索评级后，相关学习日计入已学；学完剩余未学词即可完成当天，不增加虚构曝光或复习记录。
- 桌面长难句默认收起，展开动画同时调整三栏；手机可切换词根和长难句标签。
- 默认本地模式下旧进度导入 401 不清除离线会话；显式云端模式同步 401 才返回登录页，本机进度保留。网络失败均保留登录。相关自动测试位于 `tests/sync.test.ts`，不要用删除真实进度验证。

## 生成 Windows 安装包

```powershell
npm run dist
```

主要安装文件是 `release/CYword-Setup-<version>.exe`。`data/` 不在 electron-builder 的 `files` 中，也不得通过 `extraResources` 整体打包；只有不含正文的 `curriculum.json` 排序元数据由前端编译引用，完整词书仍从 API 加载。`latest.yml` 和 `CYword-Setup-<version>.exe.blockmap` 是应用内更新元数据；三者来自同一次构建，必须一起发布到 GitHub Release 和官网 R2。当前版本未配置代码签名，首次下载或安装时 Windows 可能显示 SmartScreen；发布前如有证书，应在构建环境配置签名，不要把证书或密码写入仓库。

安装器为交互式 NSIS：首次安装可选择目录；手动运行新版安装包时会从注册表读取旧目录作为默认值，用户仍可修改。应用内更新使用同一个安装器静默覆盖旧版本，并保留 Electron `userData` 中的学习进度。

Windows 0.4.5 起的更新流程：启动检测到新版本即自动下载，右上角显示下载进度；完成后点击一次立即安装并重启。下载失败可点击重试，关闭应用不会自动安装。0.4.4 用户需手动触发更新或从官网下载覆盖安装；升级到 0.4.5 后具备此自动下载流程。开发模式不实际检测或安装更新。

## 标签自动构建

推送形如 `v<package version>` 的标签会触发 `.github/workflows/build-tag.yml`。Windows runner 检查标签与 `package.json` 一致，执行 `npm ci`，再检查 GitHub Release：尚不存在时才运行测试、构建 NSIS、校验资产并创建 Release；已存在时下载原始安装器、`.exe.blockmap` 与 `latest.yml`，跳过重建并重新校验。随后把原安装器、blockmap 和改写为 R2 路径的版本化清单发布到官网 R2，全部不可变对象校验成功后才更新 `releases/current.json`，官网和桌面更新源同时切换。

```powershell
$cyVersion = node -p "require('./package.json').version"
git tag -a "v$cyVersion" -m "CYword v$cyVersion"
git push origin "v$cyVersion"
```

工作流不额外上传 GitHub Actions artifact，也不覆盖已有 GitHub Release 资产。同标签重跑只用于沿用原件恢复尚未完成的 R2 发布，避免重新构建改变安装包字节或 `releaseDate`；已有 Release 为草稿、缺少文件、文件未上传完整或查询失败时直接中止。R2 使用 `releases/<version>/<sha256>/` 内容寻址路径，已有对象只有长度和完整 SHA-256 相同才跳过，不同则拒绝覆盖。需要修改软件时必须使用新版本和新标签。

首次启用前，在 Cloudflare R2 创建 `Object Read & Write` S3 API Token，并把范围限制为 `cyword-downloads` 单桶；在 GitHub Actions Secrets 配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_R2_ACCESS_KEY_ID` 和 `CLOUDFLARE_R2_SECRET_ACCESS_KEY`。不要使用能管理其他桶、Workers 或账号设置的宽权限 Token。

已经安装的 0.2.1 内嵌 GitHub provider，无法远程改写。仓库现已公开，旧版用户仍应从官网下载新版并覆盖安装。0.3.0 起使用官网 `/downloads/` generic 源，禁止恢复为 GitHub provider。GitHub Release 提供公开版本记录和发布原件，源码使用 Apache-2.0；应用内自动更新继续使用官网源。

## 选择另一本词书做数据验证

```powershell
$env:CYWORD_BOOK = "cet4"
npm run data:verify
npm run data:build
Remove-Item Env:CYWORD_BOOK
```

默认值始终是 `cet6`。选择词书只影响本地校验和服务端数据生成，安装包不携带任何完整词书。

## 发布服务端词书

词书使用独立私有 R2 桶 `cyword-book-data`。首次环境中先创建 APAC、Standard 桶；常规数据发布不要重复创建：

```powershell
npx wrangler r2 bucket create cyword-book-data --location apac --storage-class Standard
npm run upload:book-data
```

`upload:book-data` 会重新校验并编译数据，在 `.work/book-api/cet6/` 生成基于内容哈希的版本、目录、清单和 30 个学习日分片。上传脚本先上传全部不可变版本对象，最后更新 `books/cet6/current.json`。上传成功后还必须执行 `npm run deploy:site`，使生产 Pages Functions 使用 `BOOKS` 绑定；只上传数据不会发布新接口代码。

首次完整下载时 GET `/api/books/cet6/catalog`，分批向 `/api/books/cet6/words` 发 POST，提交当前数据版本、计划日、请求类型和唯一单词 ID。两类列表详情按选中词加载，为兼容线上接口继续使用 `bookmarks` 请求类型（不代表手动收藏）。接口当前公开可读且不含账号鉴权。旧版本对象应至少保留到使用该数据版本的桌面会话自然结束，不要只删分片而留下目录或清单。

## 启动故障

- 双击无窗口：优先使用 NSIS 安装包，不再发布旧 portable 版本；查看任务管理器中是否已有单实例正在运行。
- 开发模式不启动：先单独运行 `npm run data:verify`，再检查 Node.js 版本和 `npm ci` 是否成功。
- 界面加载失败：首次下载失败时确认网络和 `/api/books/cet6/catalog` 返回 200；已下载后检查本机词库，勿删除账号进度；开发模式再运行 `npm run build` 检查 TypeScript、Vite 和本地数据生成。
- 进度异常：先备份 Electron 用户数据目录中的 `accounts/<账号哈希>/progress.json` 和旧 `progress.json`，再检查其 `version` 是否为 2。除非用户明确要求，不要删除进度文件。同步检查、安卓构建和签名恢复见 [安卓与同步说明](ANDROID.md)。

## 发布前清单

1. `npm ci` 能在干净依赖环境完成。
2. `npm run data:verify`、`npm test`、`npm run test:ui`、`npm run build:web` 全部通过；修改官网时另检查 `npm run build:site` 与 `npm run test:site:download`。
3. 解包目录不存在 `resources/data`，安装后联网登录并完整下载 5166 词与发音；下载后断网冷启动，学习、搜索和发音可用，评级重启后保留。
4. 本机词库按当前词加载，再预取后面最多 4 词；首次下载分批持久化完整词书，复习词序由本机进度决定，线上接口继续兼容旧客户端。
5. `release/` 中存在安装器、`latest.yml` 和对应 `.exe.blockmap`；`data/`、`dist/`、`release/` 和检查截图不提交。
6. 对外发布前检查站内版本记录与实际已发布版本一致，确认真实反馈/删除申请渠道及 [内容来源台账](CONTENT-SOURCES.md) 的未决项；不能将占位提示或来源记录当作渠道开通、版权授权完成的证明。

## 官网运行与部署

官网和桌面端独立构建，不需要生成词书数据。`npm run dev:site` 监听 `http://127.0.0.1:5174/`；`npm run build:site` 后可用 `npm run preview:site` 在 `http://127.0.0.1:4174/` 查看产物。Vite 不模拟 R2，通过 `/downloads/` 代理读取正式域名的发布信息和安装包。

| 配置 | 约定 |
| --- | --- |
| Pages 项目 / 生产分支 | `cyword` / `main` |
| 正式域名 / 备用域名 | `cyword.chengyi.me` / `cyword.pages.dev` |
| 权威 DNS | Cloudflare `aaden.ns.cloudflare.com`、`daniella.ns.cloudflare.com` |
| 子域记录 | `cyword` CNAME `cyword.pages.dev` 并启用代理；Resend 验证记录仅用于 `auth.cyword` |
| 配置文件 | `website/wrangler.jsonc`，作为部署配置的唯一来源 |
| 函数绑定 | `DOWNLOADS` → `cyword-downloads`；`BOOKS` → `cyword-book-data`；`DB` → `cyword-db`（D1 APAC） |
| 业务密钥 | `RESEND_API_KEY`（必需，仅限 `auth.cyword.chengyi.me` 发信）；`JWT_SECRET`（必需，至少 32 字符的强随机会话签名私钥） |

Resend 使用专用发信域 `auth.cyword.chengyi.me`，发件人为 `login@auth.cyword.chengyi.me`。`chengyi.me` 的权威 DNS 当前由 Cloudflare 管理；发信记录 `resend._domainkey.auth.cyword`、`rsend.auth.cyword` 和 `send.auth.cyword` 必须添加到 Cloudflare DNS，其中两个 CNAME 保持“仅 DNS”。官网 `cyword` CNAME 指向 `cyword.pages.dev` 并启用代理，不修改根域和 `www`。两个业务密钥必须存入 Pages Production 加密 Secret；不得写入 `wrangler.jsonc`、`.dev.vars*`、源码、构建目录或安装包。生产环境缺少任一密钥时认证接口返回 503，不允许回退到模拟发信或固定 JWT 密钥。

2026-09-20 部署的认证函数把 OTP 冷却与写入合为条件 UPSERT，校验以 `DELETE ... RETURNING` 原子消费，错误次数在 D1 原子累加，账号按唯一邮箱 UPSERT 更新。现有认证表结构不因此新增迁移。回归覆盖并发重发、同码只能成功一次及尝试次数上限，线上不要为测试重复消耗真实用户验证码。

官网提供 `/#release-notes`、`/#privacy` 与 `/#feedback`。公开记录仅写已发布的 Windows/Android 改动；隐私说明区分本机数据、云端记录和临时官网示例。维护者确认公开反馈与账号删除申请邮箱为 `cyi907369@gmail.com`，页面提供 `mailto:` 链接并提示删除申请使用登录邮箱发送，已部署生效。该入口用于人工收件，不是自助删除接口；实际收件及后续处理流程仍需维护者验证，不承诺未经确认的处理时限。验证码发件邮箱不作为客服渠道。

仅向维护者的 Wrangler 提供登录授权；本机凭据保存在用户配置及 Windows 凭据管理器，不进入仓库。首次使用执行 `npx wrangler login`，之后：

```powershell
npx wrangler whoami
npm run test:site:download
npm run deploy:site
```

2026-09-20 已完成 D1 授权、`learning_progress` 建表与同步及原子认证函数部署。后续新环境仍须按 [安卓与同步说明](ANDROID.md) 先建表再部署。

部署脚本显式指定 Pages 生产分支 `main`，与当前 Git 分支无关；会上传静态页面、下载函数、词书函数和路由配置。普通提交推送不会自动更新官网代码；版本标签工作流只更新 R2 发布资产和最新版指针。不要上传纯静态 ZIP，以免遗漏函数和 R2 绑定；词书只能上传到 `BOOKS` 对应的私有 R2 桶，不得放进 Pages 静态产物。

NSIS 安装包只收录 `dist/`、`electron/` 和发布用 `package.json`。邮箱和登录态位于 `userData/session.json`，0.4.4 学习进度位于 `userData/accounts/<账号哈希>/progress.json`，均不参与打包。Windows 0.4.5 通过 Electron safeStorage 加密会话令牌，升级后迁移旧会话。旧 `progress.json` 保留，启动时已登录账号符合归属条件才迁移。覆盖安装继续使用原有 `userData`；验证“全新用户”体验使用临时 `--user-data-dir`。

需要线上预览时，先构建，再执行 `npx wrangler pages deploy --cwd website --project-name cyword --branch preview --commit-dirty=true`。`--branch` 是 Pages 环境标签，不会创建 Git 分支；预览函数只读同一发布桶。确认主下载可用后才更新生产。

## 发布官网新安装包

2026-09-20 两个平台已启用 schema v2 发布清单。新环境首次从 v1 升级时，须按以下顺序：

1. 保留当前 v1 指针，先部署兼容 v1/v2 的官网与下载函数，并验证旧安装包、Range 和 Windows `latest.yml` 仍可读取。
2. 对 Windows `/downloads/latest.json`、Android `/downloads/android/latest.json` 发 HEAD，确认响应含 `X-CYword-Release-Schemas: 1,2`。新环境暂无指针时，错误响应同样应有此能力头。
3. 再发布新版本。`scripts/release-preflight.mjs` 在任何 R2 写入前检查对应生产入口是否声明支持 `2`，超时、重定向或缺少支持声明都中止，不绕过检查强写新指针。

兼容函数部署完成后，常规 Windows 安装包发布只需推送与 `package.json` 一致的新标签；不必为每个安装包改写 `website/src/release.ts` 或重新部署下载函数。官网 `/#release-notes` 的文字是静态内容，新增公开版本记录仍需更新页面并部署。Windows 发布顺序固定为：GitHub Release → 内容寻址安装器 → blockmap → 版本化 `latest.yml` → `releases/current.json`。最后一步之前的任何失败都不会切换最新版。Android 用独立 `android-v<version>` Release、APK 路径及 `releases/android/current.json`，不切换 Windows 指针。

先做只生成本地文件的资产检查：

```powershell
npm run publish:site:release -- release --prepare-only
# Android 原始签名 APK 的独立检查
node scripts/publish-site-release.mjs release --android --prepare-only
```

`--prepare-only` 不访问生产兼容性接口、不上传文件，结果写入 `.work/site-release/`。它不能证明生产函数已支持新格式。

本地应急发布要求已安装 AWS CLI，并通过环境变量提供同一组桶级 R2 S3 凭据：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '<account-id>'
$env:AWS_ACCESS_KEY_ID = '<r2-access-key-id>'
$env:AWS_SECRET_ACCESS_KEY = '<r2-secret-access-key>'
$env:AWS_DEFAULT_REGION = 'auto'
npm run publish:site:release -- release
```

脚本拒绝空文件、超大或重复键的 `latest.yml`，只接受与当前安装包一致的唯一文件项、版本、路径、SHA-512 和长度；还会解压 blockmap 并逐块核对安装器内容。生成的 v2 指针记录安装器、blockmap 与改写后的更新清单各自的校验信息。兼容性检查通过后，已有不可变对象必须长度与完整 SHA-256 相同才能复用，新增对象上传后也要重新下载流式核验，再写最后的指针。不要删除仍可能被旧客户端引用的版本。

回滚官网时保留 v1/v2 读取能力；一旦任一平台已使用 v2 指针，不能直接回滚到只读 v1 的旧函数。若必须回到旧函数，应先恢复经核验且资产仍完整的该平台 v1 指针，并验证下载，再回滚；同时检查另一平台是否仍依赖 v2。

## 下载冒烟检查

从项目根目录执行；`latest.json` 是官网当前公开版本的权威入口：

```powershell
$cyRelease = Invoke-RestMethod 'https://cyword.chengyi.me/downloads/latest.json'
$cyUrl = 'https://cyword.chengyi.me' + $cyRelease.downloadPath
curl.exe --fail 'https://cyword.chengyi.me/downloads/latest.yml'
curl.exe --fail --head $cyUrl
New-Item -ItemType Directory -Force .work | Out-Null
curl.exe --fail --range 0-1048575 --output '.work\download-check.exe' $cyUrl
curl.exe --fail --continue-at - --output '.work\download-check.exe' $cyUrl
Get-FileHash -Algorithm SHA256 -LiteralPath '.work\download-check.exe'
```

预期 `latest.yml` 为 200 且引用 `latest.json.downloadPath` 对应的内容寻址安装包；HEAD 文件长度等于 `latest.json.sizeBytes`，Range 返回 206，续传后完整哈希等于 `latest.json.sha256`。Android 另从 `/downloads/android/latest.json` 取独立版本和路径，以相同方式核验 APK 的长度、Range 与完整哈希；不要拿 Windows 版本或校验值代替。

两个公开 JSON 均应返回站内 `notesUrl`，不含 `githubDownloadUrl` 或 `repositoryUrl`。检查首页双平台版本、下载、各自安装说明、站内版本记录、隐私/反馈、FAQ 和 HTTPS 跳转；阻断 Android 版本请求时应显示失败和重试入口，不出现虚构哈希。测试文件放 `.work/`，用户确认任务结束或要求执行 neat-freak 时清理；安装包哈希一致不代表已经完成安装运行测试。

## 下载费用与限制

2026-08-31 核对：R2 Standard 每月免费包含 10 GB-month、100 万次 A 类操作、1000 万次 B 类操作，出口流量免费。超额存储为 $0.015/GB-month、A 类 $4.50/百万次、B 类 $0.36/百万次，按计费单位向上取整；免费额度在账号内共享，见 [R2 定价](https://developers.cloudflare.com/r2/pricing/)。134 MiB 安装包持续保存约 70 份就接近 10 GB；用户下载不会重复增加存储副本。

用户已授权 R2 激活及超额计费；Workers 保持免费套餐，未配置自动升级。Pages Functions 与账号内其他 Workers 每日共享 10 万次请求，UTC 0 点（北京时间 8 点）重置；静态资源请求免费且不限量，见 [Functions 定价](https://developers.cloudflare.com/pages/functions/pricing/)。安装包 GET 通常产生一次函数调用和两次 R2 B 类操作；一次学习请求产生一次函数调用、一次清单读取和若干分片读取，累计复习最多读取 30 个分片。HEAD、分段、续传、重试也会增加用量，因此不能只按人数估算额度。应同时检查 R2 用量和 Workers 请求面板的账号总用量。

## 官网故障处理

| 现象 | 检查与处理 |
| --- | --- |
| 首页正常，下载或更新 404 | 检查 `releases/current.json`、其中三个内容寻址对象及 `/downloads/latest.yml`；指针只能在全部资产上传后写入 |
| 应用启动时词书 404/503 | 核对 `BOOKS` 绑定、`books/cet6/current.json` 及其 `catalogKey`；重新上传时必须让版本指针最后写入 |
| 每日词汇返回 409 | 客户端目录版本对应的清单已被删除；恢复该不可变版本，或重启应用重新获取当前目录 |
| 每日词汇流中断 | 查找 `book_words_stream_failed` 日志，核对清单里的分片是否完整；不要在上传中途更新版本指针 |
| 下载 503 | 查看 Pages Functions 日志的 `release_download_failed`；核对 `DOWNLOADS` 绑定、指针格式和桶内对象；按 `Retry-After` 稍后重试 |
| 发布脚本提示尚不支持清单 v2 | 先部署兼容 v1/v2 的官网函数，确认生产响应能力头；脚本尚未写入 R2，不要绕过检查或先手改指针 |
| 同标签重跑报已有资产不完整/不一致 | 核对 GitHub Release 原件和 R2 对象；不得覆盖已发布字节。需要改动时发布新版本，恢复传输只能沿用已核验原件 |
| 下载 416 | Range 超过文件边界，核对长度及 ETag，删除失效断点或重新下载 |
| 达到免费函数额度 | 当日下载可能不可用，等额度重置或由用户明确决定是否升级；不要自动开付费套餐 |
| 本地测试缺少 R2 绑定 | 使用 `npm run test:site:download`；脚本从配置显式传入本地 `--r2`，只使用模拟存储，不加 `--remote` |
| 仅部分国内线路不可达 | 跨境连通性因地区和运营商而异，可尝试续传或稍后重试；可查看公开 GitHub Release，不更换应用更新源或承诺全网稳定 |
| 部署后页面或函数异常 | 优先回滚到仍兼容当前 v1/v2 指针的生产部署，格式降级顺序见上文；不要修改根域 DNS、删除安装包或重置用户进度 |
| 收不到验证码 | 先确认 Pages Production 同时存在 `RESEND_API_KEY` 与 `JWT_SECRET` 加密 Secret，再检查 Resend 日志及 `auth.cyword.chengyi.me` 的 DKIM、Return-Path 和发送 CNAME；生产响应不得包含 `debugCode` 或 `simulated` |
| 邮件验证码正确但校验失败 | 确认发送与校验请求命中同一 Production 环境和 D1 `cyword-db`，再核对验证码是否过期、已用、输错 5 次或因重发替换；函数原子消费后重复验证会失败，未登录访问 `/api/auth/me` 应返回 401 |

当前生产不使用 `r2.dev` 公开地址，也不依赖第三方 GitHub 代理。部署详情和已完成验证见 [官网说明](WEBSITE.md)。
