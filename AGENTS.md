# CYword 项目约定

- 仓库包含 Windows Electron、`android/` Capacitor 安卓应用与 `website/` 独立官网；两端共用 React、TypeScript 和排课逻辑。
- 正式词书数据放在 `books/<book-code>/`；`data/` 是构建生成物，不得手工修改或提交。
- 原巧记内容严禁修改：不得改写、删减、替换或通过运行时覆盖改变单词的 `memory_markup` / `memoryMarkup`、词根等条目的 `memory_method` / `memoryMethod` 正文及其引用。排序冲突只能通过排课顺序、依赖识别和原有悬浮窗补充处理，不得为了消除依赖冲突修改原巧记。
- 默认词书是 `cet6`。新增四级、考研等词书时使用独立稳定代码，如 `cet4`、`kaoyan`，不要覆盖六级数据。
- 元数据标称 5169 词，两个可枚举接口一致为 5166 词，差异 3 已在词书清单中保留，禁止擅自补造。
- 每本词书必须包含 `book.json` 和 `csv/` 下的完整规范表；先运行 `npm run data:verify`，再构建应用。
- `books/cet6/csv/table_catalog.csv` 记录表及行数，`field_dictionary.csv` 记录字段含义，它们是数据结构的权威索引。
- 第一版只按 `root_type=root` 排课；前缀、后缀、词基只展示在单词详情中。无真正词根的单词作为独立组。
- 同一真正词根组必须在同一天学完；多词根单词在各相关组重复学习，复习日按唯一单词去重。
- 排课在满足熟词依赖后穿插单词与多词组；已解释词根含义的回指保留为悬浮窗引用。互相依赖的词根组同日学习，按 `exposureOrder` 先学基础词再继续组内词，禁止拓扑排序卡住时静默跳过依赖。两端应用同一份编译顺序，重排进度按“组 × 单词”迁移，保留熟练度与复习记录。
- 计划节奏固定为学习 3 天、累计复习 1 天；六级编译为 30 个学习日和 10 个复习日。
- 熟练度只有 `unmastered`、`unclear`、`mastered` 三档；学习会话未评级词必须强制判断熟练度后自动跳入下一词（禁止无评级跳过），回看已评级词时提供前进入口与重新评级推进支持；复习日默认跳过 `mastered`。
- 桌面进度按账号写入 `userData/accounts/<账号哈希>/progress.json`，会话写入 `userData/session.json`；安卓使用 Preferences，浏览器使用 localStorage。旧 `progress.json` 仅迁移到升级启动时已登录的账号，原件保留。
- “词汇掌握”统计全书四类状态；待巩固列表只从已学词的 `unmastered`、`unclear` 评级派生，禁止把未学词或旧收藏加入列表。改为已掌握后移出列表但保留学习记录；页面重新评级不推进计划。
- 词汇列表仅保留“未掌握”“不清楚”两个分类，默认“未掌握”。词书计划固定标题及双栏进度卡，仅日期卡片区域滚动；总进度显示当前计划天数/总天数，当日进度显示已完成数/当天安排数，复习日按实际复习范围计算。
- “词汇掌握”导航不显示数字角标；点击单词全屏展开详情，按打开时的分类、搜索结果和完整列表顺序跨页浏览。每次打开需重新评级后才能推进，评级自动进入下一词，本轮已评级词回看后可直接前进；返回保留分类、搜索和列表位置，不推进日计划。
- 同步通过认证后的 `/api/progress` 和 D1 `learning_progress` 表；写入必须检查修订号，遇到 409 合并后重试。旧版收藏删除标记作为兼容数据保留，禁止用整份旧进度覆盖另一端更新。

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
- 手机预览：`npm run dev:mobile`（5173 端口，默认模拟登录和同步）；真实账号使用 `CYWORD_REAL_AUTH=1`
- 安卓安装包：`npm run android:release`；签名密钥不得提交，见安卓说明
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
- [安卓构建与进度同步](docs/ANDROID.md)
