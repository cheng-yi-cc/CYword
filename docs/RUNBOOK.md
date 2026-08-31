# 运行手册

## 环境与首次启动

推荐 Windows 10/11、Node.js 24 LTS 和 npm，与标签构建工作流一致。进入仓库后执行：

```powershell
npm ci
npm run dev
```

`npm run dev` 会先校验六级规范表并生成 `data/`，随后启动 Vite 和 Electron。修改 CSV 后重新启动即可重新编译；不要直接编辑 `data/`。

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

主要安装文件是 `release/CYword-Setup-<version>.exe`。`latest.yml` 和 `CYword-Setup-<version>.exe.blockmap` 是应用内更新元数据，三者必须发布在同一个 GitHub Release。0.2.1 版未配置代码签名，首次下载或安装时 Windows 可能显示 SmartScreen；发布前如有证书，应在构建环境配置签名，不要把证书或密码写入仓库。

安装器为交互式 NSIS：首次安装可选择目录；手动运行新版安装包时会从注册表读取旧目录作为默认值，用户仍可修改。应用内更新使用同一个安装器静默覆盖旧版本，并保留 Electron `userData` 中的学习进度。

## 标签自动构建

推送形如 `v0.2.1` 的标签会触发 `.github/workflows/build-tag.yml`。Windows runner 会检查标签与 `package.json` 版本一致，执行 `npm ci`、自动测试和 NSIS 打包，然后创建同名 GitHub Release，并上传安装器、`latest.yml` 与 `.exe.blockmap`。

```powershell
git tag -a v0.2.1 -m "CYword v0.2.1"
git push origin v0.2.1
```

工作流不额外上传 GitHub Actions artifact。相同标签的任务重新运行会覆盖 Release 中的同名资产；官网 R2 不会跟随更新，会导致两处文件与公开校验值不一致。已对外发布的版本不要用重跑构建替换内容，应发布新版本号。标签示例中的 `v0.2.1` 已存在，新发布须替换成未使用且与 `package.json` 一致的版本。

## 选择另一本词书做数据验证

```powershell
$env:CYWORD_BOOK = "cet4"
npm run data:verify
npm run data:build
Remove-Item Env:CYWORD_BOOK
```

默认值始终是 `cet6`。0.2.1 版安装包只携带构建时选中的一本词书。

## 启动故障

- 双击无窗口：优先使用 NSIS 安装包，不再发布旧 portable 版本；查看任务管理器中是否已有单实例正在运行。
- 开发模式不启动：先单独运行 `npm run data:verify`，再检查 Node.js 版本和 `npm ci` 是否成功。
- 界面加载失败：桌面端会弹出错误框；重新运行 `npm run build` 可同时检查 TypeScript、Vite 和数据生成。
- 进度异常：先备份 Electron 用户数据目录中的 `progress.json`，再检查其 `version` 是否为 2。除非用户明确要求，不要删除进度文件。

## 发布前清单

1. `npm ci` 能在干净依赖环境完成。
2. `npm run data:verify`、`npm test`、`npm run build:web` 全部通过。
3. 安装包能安装、启动并读取 5166 词目录。
4. `release/` 中存在安装器、`latest.yml` 和对应 `.exe.blockmap`；`data/`、`dist/`、`release/` 和检查截图不提交。

## 官网运行与部署

官网和桌面端独立构建，不需要生成词书数据。`npm run dev:site` 监听 `http://127.0.0.1:5174/`；`npm run build:site` 后可用 `npm run preview:site` 在 `http://127.0.0.1:4174/` 查看产物。Vite 不模拟 R2，页面里的下载按钮仍访问正式域名。

| 配置 | 约定 |
| --- | --- |
| Pages 项目 / 生产分支 | `cyword` / `main` |
| 正式域名 / 备用域名 | `cyword.chengyi.me` / `cyword.pages.dev` |
| 权威 DNS | 阿里云 `dns27.hichina.com`、`dns28.hichina.com` |
| 子域记录 | `cyword` CNAME `cyword.pages.dev`，默认线路，TTL 600 秒 |
| 配置文件 | `website/wrangler.jsonc`，作为部署配置的唯一来源 |
| 函数绑定 | `DOWNLOADS` → 私有 R2 桶 `cyword-downloads`，Standard、APAC |
| 业务密钥 | 无；函数通过 R2 绑定访问，不使用前端 API 密钥 |

仅向维护者的 Wrangler 提供登录授权；本机凭据保存在用户配置及 Windows 凭据管理器，不进入仓库。首次使用执行 `npx wrangler login`，之后：

```powershell
npx wrangler whoami
npm run test:site:download
npm run deploy:site
```

部署脚本显式指定 Pages 生产分支 `main`，与当前 Git 分支无关；会上传静态页面、函数和路由配置。Git 提交或推送不会自动更新官网。不要上传纯静态 ZIP，以免遗漏函数和 R2 绑定；不要将词书、安装包、依赖目录或凭据上传到 Pages。

需要线上预览时，先构建，再执行 `npx wrangler pages deploy --cwd website --project-name cyword --branch preview --commit-dirty=true`。`--branch` 是 Pages 环境标签，不会创建 Git 分支；预览函数只读同一发布桶。确认主下载可用后才更新生产。

## 发布官网新安装包

1. 先完成 GitHub Release，下载其正式安装器作为镜像源，不在本机重新打包同版本来冒充相同文件。
2. 更新 `website/src/release.ts` 的版本、日期、文件名、精确字节数、SHA-256、主地址与备用地址，并同步 `website/index.html` 的无脚本下载入口。
3. 执行下列命令，路径替换为实际待发布文件。上传脚本会检查文件名、字节数及哈希，失败则不上传。

```powershell
npm run upload:site:installer -- 'release\CYword-Setup-0.2.1.exe'
```

4. 按 [下载冒烟检查](#下载冒烟检查) 验证新路径及文件，再执行 `npm run test:site:download` 和 `npm run deploy:site`。保持先上传、后公开链接的顺序。
5. R2 只镜像安装器，不镜像 `latest.yml` 和 `.exe.blockmap`；桌面应用内更新仍走 GitHub。新版本使用新文件名，不覆盖已发布内容；旧版本保留数量计入总存储。

## 下载冒烟检查

从项目根目录执行，版本路径应与 `website/src/release.ts` 一致：

```powershell
$cyUrl = 'https://cyword.chengyi.me/downloads/CYword-Setup-0.2.1.exe'
curl.exe --fail --head $cyUrl
New-Item -ItemType Directory -Force .work | Out-Null
curl.exe --fail --range 0-1048575 --output '.work\download-check.exe' $cyUrl
curl.exe --fail --continue-at - --output '.work\download-check.exe' $cyUrl
Get-FileHash -Algorithm SHA256 -LiteralPath '.work\download-check.exe'
```

预期 HEAD 为 200，文件长度与版本配置相符；Range 返回 206，续传后完整哈希等于 `release.sha256`。另查首页、JS/CSS、主下载、备用地址、FAQ 和 HTTPS 跳转。测试文件放 `.work/`，收尾时删除；安装包哈希一致不代表已经完成安装运行测试。

## 下载费用与限制

2026-08-31 核对：R2 Standard 每月免费包含 10 GB-month、100 万次 A 类操作、1000 万次 B 类操作，出口流量免费。超额存储为 $0.015/GB-month、A 类 $4.50/百万次、B 类 $0.36/百万次，按计费单位向上取整；免费额度在账号内共享，见 [R2 定价](https://developers.cloudflare.com/r2/pricing/)。134 MiB 安装包持续保存约 70 份就接近 10 GB；用户下载不会重复增加存储副本。

用户已授权 R2 激活及超额计费；Workers 保持免费套餐，未配置自动升级。Pages Functions 与账号内其他 Workers 每日共享 10 万次请求，UTC 0 点（北京时间 8 点）重置；静态资源请求免费且不限量，见 [Functions 定价](https://developers.cloudflare.com/pages/functions/pricing/)。一次 GET 通常消耗一次函数调用和两次 R2 B 类操作；HEAD、分段、续传、重试会增加请求，因此不能按人数估算额度。公开下载可能被大量访问，应检查 R2 用量和 Workers 请求面板的账号总用量。

## 官网故障处理

| 现象 | 检查与处理 |
| --- | --- |
| 首页正常，下载 404 | 文件名须符合 `CYword-Setup-x.y.z.exe`，核对 R2 对象键和 `release.ts`；无文件则先校验、上传，不把错误页当安装包 |
| 下载 503 | 查看 Pages Functions 日志的 `installer_download_failed`；核对 `DOWNLOADS` 绑定和桶名；按 `Retry-After` 稍后重试 |
| 下载 416 | Range 超过文件边界，核对长度及 ETag，删除失效断点或重新下载 |
| 达到免费函数额度 | 当日下载可能不可用，等额度重置或由用户明确决定是否升级；不要自动开付费套餐 |
| 本地测试缺少 R2 绑定 | 使用 `npm run test:site:download`；脚本从配置显式传入本地 `--r2`，只使用模拟存储，不加 `--remote` |
| 仅部分国内线路不可达 | 跨境连通性因地区和运营商而异，可尝试续传、稍后重试或 GitHub 备用地址；不承诺全网稳定 |
| 部署后页面或函数异常 | 在 Pages 项目回滚先前成功的生产部署；不要修改根域 DNS，不要删除安装包或重置用户进度 |

当前生产不使用 `r2.dev` 公开地址，也不依赖第三方 GitHub 代理。部署详情和已完成验证见 [官网说明](WEBSITE.md)。
