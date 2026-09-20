# 运行手册

## 环境与首次启动

推荐 Windows 10/11、Node.js 24 LTS 和 npm，与标签构建工作流一致。进入仓库后执行：

```powershell
npm ci
npm run dev
```

`npm run dev` 会先校验六级规范表并生成 `data/`，随后启动 Vite 和 Electron。修改 CSV 后重新启动即可重新编译；不要直接编辑 `data/`。

手机/浏览器预览运行 `npm run dev:mobile`（5173，默认模拟登录与同步）；`CYWORD_REAL_AUTH=1` 切换生产认证。桌面词书 API 可由 `CYWORD_BOOK_API_URL` 覆盖，安卓工具链及签名变量见 [ANDROID.md](ANDROID.md)。这些变量不改变正式云端的部署状态。

## 常用检查

```powershell
npm run data:verify
npm test
npm run build:web
```

预期结果：数据校验报告 19 张表、5166 个唯一单词、0 个孤儿外键；自动测试全部通过；网页构建成功生成 `dist/`。

## 生成 Windows 安装包

```powershell
npm run dist
```

主要安装文件是 `release/CYword-Setup-<version>.exe`。`data/` 不在 electron-builder 的 `files` 中，也不得通过 `extraResources` 整体打包；只有不含正文的 `curriculum.json` 排序元数据由前端编译引用，完整词书仍从 API 加载。`latest.yml` 和 `CYword-Setup-<version>.exe.blockmap` 是应用内更新元数据；三者来自同一次构建，必须一起发布到 GitHub Release 和官网 R2。当前版本未配置代码签名，首次下载或安装时 Windows 可能显示 SmartScreen；发布前如有证书，应在构建环境配置签名，不要把证书或密码写入仓库。

安装器为交互式 NSIS：首次安装可选择目录；手动运行新版安装包时会从注册表读取旧目录作为默认值，用户仍可修改。应用内更新使用同一个安装器静默覆盖旧版本，并保留 Electron `userData` 中的学习进度。

## 标签自动构建

推送形如 `v<package version>` 的标签会触发 `.github/workflows/build-tag.yml`。Windows runner 会检查标签与 `package.json` 版本一致，执行 `npm ci`、自动测试和 NSIS 打包，创建同名 GitHub Release，然后自动把同一构建的安装器、`.exe.blockmap` 和版本化 `latest.yml` 上传官网 R2。全部对象校验上传成功后，工作流最后更新 `releases/current.json`，官网和桌面更新源同时切换。

```powershell
$cyVersion = node -p "require('./package.json').version"
git tag -a "v$cyVersion" -m "CYword v$cyVersion"
git push origin "v$cyVersion"
```

工作流不额外上传 GitHub Actions artifact。R2 资产使用 `releases/<version>/<sha256>/` 内容寻址路径，旧版本不会被覆盖；但相同标签重跑仍会覆盖 GitHub Release 的同名资产，并可能让同一版本号对应不同二进制，因此已对外发布的版本不得重跑替换，应发布新版本号。标签示例中的版本发布后即不可重复使用；新发布须替换成未使用且与 `package.json` 一致的版本。

首次启用前，在 Cloudflare R2 创建 `Object Read & Write` S3 API Token，并把范围限制为 `cyword-downloads` 单桶；在 GitHub Actions Secrets 配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_R2_ACCESS_KEY_ID` 和 `CLOUDFLARE_R2_SECRET_ACCESS_KEY`。不要使用能管理其他桶、Workers 或账号设置的宽权限 Token。

已经安装的 0.2.1 内嵌 GitHub provider，无法远程改写。迁移后的第一个新版本必须同时保留 GitHub Release，使 0.2.1 用户完成一次过渡更新；从该新版本开始，检查和下载安装包都只访问官网。若要求连这一次 GitHub 请求也没有，用户只能手动从官网安装迁移后的版本。

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

桌面端启动时 GET `/api/books/cet6/catalog`；学习日、累计复习日和词汇掌握详情均向 `/api/books/cet6/words` 发 POST，提交当前数据版本、计划日、请求类型和唯一单词 ID。词汇掌握按选中词加载详情，为兼容线上接口继续使用 `bookmarks` 请求类型（不代表手动收藏）。接口当前公开可读且不含账号鉴权。旧版本对象应至少保留到使用该数据版本的桌面会话自然结束，不要只删分片而留下目录或清单。

## 启动故障

- 双击无窗口：优先使用 NSIS 安装包，不再发布旧 portable 版本；查看任务管理器中是否已有单实例正在运行。
- 开发模式不启动：先单独运行 `npm run data:verify`，再检查 Node.js 版本和 `npm ci` 是否成功。
- 界面加载失败：先确认网络和 `/api/books/cet6/catalog` 返回 200；开发模式再运行 `npm run build` 检查 TypeScript、Vite 和本地数据生成。
- 进度异常：先备份 Electron 用户数据目录中的 `accounts/<账号哈希>/progress.json` 和旧 `progress.json`，再检查其 `version` 是否为 2。除非用户明确要求，不要删除进度文件。同步检查、安卓构建和签名恢复见 [安卓与同步说明](ANDROID.md)。

## 发布前清单

1. `npm ci` 能在干净依赖环境完成。
2. `npm run data:verify`、`npm test`、`npm run build:web` 全部通过。
3. 解包目录不存在 `resources/data`，安装后联网启动并读取 5166 词目录；断网时明确提示词书加载失败，且不损坏本机进度。
4. 学习日首词可先显示，剩余词后台批量加载；累计复习返回本机提交的动态词表。
5. `release/` 中存在安装器、`latest.yml` 和对应 `.exe.blockmap`；`data/`、`dist/`、`release/` 和检查截图不提交。

## 官网运行与部署

官网和桌面端独立构建，不需要生成词书数据。`npm run dev:site` 监听 `http://127.0.0.1:5174/`；`npm run build:site` 后可用 `npm run preview:site` 在 `http://127.0.0.1:4174/` 查看产物。Vite 不模拟 R2，页面里的下载按钮仍访问正式域名。

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

仅向维护者的 Wrangler 提供登录授权；本机凭据保存在用户配置及 Windows 凭据管理器，不进入仓库。首次使用执行 `npx wrangler login`，之后：

```powershell
npx wrangler whoami
npm run test:site:download
npm run deploy:site
```

部署 0.4.4 前先按 [安卓与同步说明](ANDROID.md) 完成 D1 授权和 `learning_progress` 建表；截至 2026-09-20 该项尚未完成。

部署脚本显式指定 Pages 生产分支 `main`，与当前 Git 分支无关；会上传静态页面、下载函数、词书函数和路由配置。普通提交推送不会自动更新官网代码；版本标签工作流只更新 R2 发布资产和最新版指针。不要上传纯静态 ZIP，以免遗漏函数和 R2 绑定；词书只能上传到 `BOOKS` 对应的私有 R2 桶，不得放进 Pages 静态产物。

NSIS 安装包只收录 `dist/`、`electron/` 和发布用 `package.json`。邮箱和登录态位于 `userData/session.json`，0.4.4 学习进度位于 `userData/accounts/<账号哈希>/progress.json`，均不参与打包。旧 `progress.json` 保留，启动时已登录账号符合归属条件才迁移。覆盖安装继续使用原有 `userData`；验证“全新用户”体验使用临时 `--user-data-dir`。

需要线上预览时，先构建，再执行 `npx wrangler pages deploy --cwd website --project-name cyword --branch preview --commit-dirty=true`。`--branch` 是 Pages 环境标签，不会创建 Git 分支；预览函数只读同一发布桶。确认主下载可用后才更新生产。

## 发布官网新安装包

正常发布只需推送与 `package.json` 一致的新标签；标签工作流自动完成 GitHub Release 和 R2 发布，不需要修改 `website/src/release.ts`、重新部署官网或手工复制校验值。发布顺序固定为：GitHub Release → 内容寻址安装器 → blockmap → 版本化 `latest.yml` → `releases/current.json`。最后一步之前的任何失败都不会切换官网最新版。

本地应急发布要求已安装 AWS CLI，并通过环境变量提供同一组桶级 R2 S3 凭据：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '<account-id>'
$env:AWS_ACCESS_KEY_ID = '<r2-access-key-id>'
$env:AWS_SECRET_ACCESS_KEY = '<r2-secret-access-key>'
$env:AWS_DEFAULT_REGION = 'auto'
npm run publish:site:release -- release
```

脚本先检查版本、安装包长度、SHA-256、`latest.yml` 的 SHA-512 与文件长度，再执行同样的原子发布顺序。旧内容寻址资产保留；不要删除仍可能被旧客户端引用的版本。

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

预期 `latest.yml` 为 200 且引用 `latest.json.downloadPath` 对应的内容寻址安装包；HEAD 文件长度等于 `latest.json.sizeBytes`，Range 返回 206，续传后完整哈希等于 `latest.json.sha256`。另查首页版本、主下载、GitHub 备用地址、FAQ 和 HTTPS 跳转。测试文件放 `.work/`，用户确认任务结束时再清理；安装包哈希一致不代表已经完成安装运行测试。

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
| 下载 416 | Range 超过文件边界，核对长度及 ETag，删除失效断点或重新下载 |
| 达到免费函数额度 | 当日下载可能不可用，等额度重置或由用户明确决定是否升级；不要自动开付费套餐 |
| 本地测试缺少 R2 绑定 | 使用 `npm run test:site:download`；脚本从配置显式传入本地 `--r2`，只使用模拟存储，不加 `--remote` |
| 仅部分国内线路不可达 | 跨境连通性因地区和运营商而异，可尝试续传、稍后重试或 GitHub 备用地址；不承诺全网稳定 |
| 部署后页面或函数异常 | 在 Pages 项目回滚先前成功的生产部署；不要修改根域 DNS，不要删除安装包或重置用户进度 |
| 收不到验证码 | 先确认 Pages Production 同时存在 `RESEND_API_KEY` 与 `JWT_SECRET` 加密 Secret，再检查 Resend 日志及 `auth.cyword.chengyi.me` 的 DKIM、Return-Path 和发送 CNAME；生产响应不得包含 `debugCode` 或 `simulated` |
| 邮件验证码正确但校验失败 | 确认发送与校验请求命中同一 Production 环境和 D1 `cyword-db`，再核对验证码是否超过 5 分钟、是否因重发被新验证码替换；未登录访问 `/api/auth/me` 应返回 401 |

当前生产不使用 `r2.dev` 公开地址，也不依赖第三方 GitHub 代理。部署详情和已完成验证见 [官网说明](WEBSITE.md)。
