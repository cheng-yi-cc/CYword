# CYword 项目约定

- 仓库包含 Windows Electron 桌面应用与 `website/` 独立官网，前端使用 React、TypeScript 与 Vite。
- 正式词书数据放在 `books/<book-code>/`；`data/` 是构建生成物，不得手工修改或提交。
- 默认词书是 `cet6`。新增四级、考研等词书时使用独立稳定代码，如 `cet4`、`kaoyan`，不要覆盖六级数据。
- 元数据标称 5169 词，两个可枚举接口一致为 5166 词，差异 3 已在词书清单中保留，禁止擅自补造。
- 每本词书必须包含 `book.json` 和 `csv/` 下的完整规范表；先运行 `npm run data:verify`，再构建应用。
- `books/cet6/csv/table_catalog.csv` 记录表及行数，`field_dictionary.csv` 记录字段含义，它们是数据结构的权威索引。
- 第一版只按 `root_type=root` 排课；前缀、后缀、词基只展示在单词详情中。无真正词根的单词作为独立组。
- 同一真正词根组必须在同一天学完；多词根单词在各相关组重复学习，复习日按唯一单词去重。
- 计划节奏固定为学习 3 天、累计复习 1 天；六级编译为 30 个学习日和 10 个复习日。
- 熟练度只有 `unmastered`、`unclear`、`mastered` 三档；复习日默认跳过 `mastered`。
- 桌面端学习进度写入 Electron `userData/progress.json`，用户会话写入 `userData/session.json`；浏览器预览使用 localStorage。

## 官网与发布边界

- 官网不打包完整词书、不读取学习进度，不把助记拆词宣传成词源分析；官网输出 `dist-site/`，与桌面端 `dist/` 分离。
- 部署使用 `website/wrangler.jsonc` 和 Wrangler；禁止用纯静态 ZIP 代替含函数的部署。Pages 生产项目为 `cyword`、分支为 `main`；普通 Git 推送不自动部署官网函数和静态页面。
- `DOWNLOADS` 与 `BOOKS` 绑定专用私有 R2 桶，`DB` 绑定 D1 数据库 `cyword-db`；认证接口使用 Web Crypto JWT 与 Resend。`RESEND_API_KEY` 与至少 32 字符的 `JWT_SECRET` 必须作为 Pages Production 加密 Secret 配置，缺失时认证接口关闭，禁止生产回显验证码或降级模拟发信。只公开受控下载入口、词书分片与认证路由。
- 新标签工作流先创建 GitHub Release，再把安装器、blockmap 和版本化 `latest.yml` 上传到 R2，最后原子更新 `releases/current.json`。不得覆盖旧版本内容或提前写入指针。
- 桌面自动更新使用官网 generic 源 `/downloads/`，不得恢复为 GitHub provider。`website/src/release.ts` 只保留动态指针不可用时的已核验回退版本。
- GitHub Actions 只使用限定到 `cyword-downloads` 的 R2 Object Read & Write S3 凭据。`chengyi.me` 的权威 DNS 为 Cloudflare；只维护 `cyword` Pages CNAME 与 `auth.cyword` 的 Resend 验证记录，不修改根域、`www` 或其他项目记录。
- R2 已获用户授权开通和超额计费；不要自行升级 Workers 付费套餐。凭据、`.dev.vars*`、`.wrangler/`、生成类型及 `.work/` 过程文件不得提交。

## 常用命令

- 本地预览：`npm run dev`
- 数据校验：`npm run data:verify`
- 自动测试：`npm test`
- 生成安装包：`npm run dist`
- 官网预览：`npm run dev:site`（`http://127.0.0.1:5174/`）
- 官网下载测试：`npm run test:site:download`（仅本地 R2）
- 官网发布：`npm run deploy:site`

## 深入文档

- [变更记录](docs/CHANGES.md)
- [架构与数据流](docs/ARCHITECTURE.md)
- [运行、发布与排障](docs/RUNBOOK.md)
- [词书来源、表结构与扩充](docs/DATASETS.md)
- [官网交互、下载协议与验证](docs/WEBSITE.md)
