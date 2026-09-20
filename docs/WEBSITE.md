# 官网说明

## 用途与入口

官网面向普通用户介绍 CYword，提供功能体验、Windows 安装包与安装指南，不是桌面应用的在线完整版。

- 官网：<https://cyword.chengyi.me/>；Pages 备用域名：<https://cyword.pages.dev/>。
- 主下载：<https://cyword.chengyi.me/downloads/latest>，从私有 R2 桶的原子版本指针跳转到当前内容寻址安装包，支持断点续传，无需访问 GitHub。
- 备用下载：`latest.json.githubDownloadUrl` 指向当前 GitHub Release 的同一份正式安装包；官网页面不得硬编码历史版本链接。
- 版本和校验值以 `/downloads/latest.json` 为准；`website/src/release.ts` 只保留动态指针不可用时的 v0.2.1 回退信息。
- 首屏搭载 1:1 动态还原的沉浸式记忆视窗，呈现词根词缀、核心巧记与真题例句、长难句精读三栏独立分开上下滑动交互，采用 `overscroll-behavior: contain` 阻断外层滚动穿透，并集成发音声波可视化与长难句语法高光流光联动。

网站使用境外 Cloudflare 服务。国内线路受地区、运营商和跨境网络影响，不能承诺全国永久可达；境外托管适用的备案说明见[阿里云文档](https://help.aliyun.com/en/icp-filing/basic-icp-service/support/for-the-record-process-faq)。迁移后的桌面版本通过同域 `/downloads/latest.yml` 检查更新，并从 R2 下载更新资产，不再向 GitHub 查询更新。

## 本地预览与检查

使用 Node.js 24 LTS，在仓库根目录执行：

```powershell
npm ci
npm run dev:site
```

打开 `http://127.0.0.1:5174/`，只监听本机，不启动 Electron、不读取 `data/`。构建与产物预览：

```powershell
npm run build:site
npm run preview:site
```

输出为 `dist-site/`，预览地址为 `http://127.0.0.1:4174/`，与桌面端 `dist/` 和端口 5173 分离。Vite 只预览页面，下载按钮仍访问正式域名。

`npm run build:site` 会生成函数类型并检查 TypeScript。`npm run test:site:download` 会构建官网，以 256 KiB 确定性文件在本地 R2 模拟器运行 19 项集成检查，覆盖原子最新版指针、electron-updater 清单、blockmap、字节完整性、HEAD、Range、续传拼接、条件请求、错误码及静态首页；不读取或写入远端桶。生成类型和测试状态不提交。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| `website/index.html` | 页面标题、描述和无脚本下载入口 |
| `website/src/Website.tsx` | 官网内容、交互示例、复制下载地址及备用入口 |
| `website/src/styles.css` | 独立视觉样式、响应式布局、键盘焦点及减少动态效果 |
| `website/src/release.ts` | 读取并校验动态最新版信息，保留不可用时的已核验回退版本 |
| `website/public/` | 图标、抓取规则、站点地图、`_headers` 和 `_routes.json` |
| `website/functions/downloads/[[path]].ts` | 只读 R2 下载接口 |
| `website/functions/api/books/[book]/catalog.ts` | 当前词书目录接口 |
| `website/functions/api/books/[book]/words.ts` | 每日词汇批量流式接口 |
| `website/functions/api/auth/send-code.ts` | 发送邮箱 6 位 OTP 验证码接口 |
| `website/functions/api/auth/verify-code.ts` | 校验验证码、自动建号并签发 JWT 接口 |
| `website/functions/api/auth/me.ts` | 校验 Bearer Token 并返回当前用户数据接口 |
| `website/server/book-api.ts` | 词书 R2 结构、参数校验和错误响应共用逻辑 |
| `website/functions/api/progress.ts` | 认证后的进度读取、修订号检查与原子写入 |
| `website/server/progress-sync.ts` | 进度校验和压缩快照编解码 |
| `website/server/auth.ts` | JWT 签发/验签、OTP 生成与 D1/Resend 交互逻辑 |
| `website/wrangler.jsonc` | Pages 项目、构建目录、R2 绑定与 D1 数据库配置 |
| `website/vite.config.ts` | 页面开发服务与构建输出 |
| `scripts/test-site-download.mjs` | 本地 R2 集成测试，显式传入同一配置中的绑定 |
| `scripts/publish-site-release.mjs` | 校验构建资产，按内容寻址上传并最后切换最新版指针 |
| `scripts/build-book-api-data.mjs` | 生成内容寻址的目录、清单和学习日分片 |
| `scripts/upload-book-data.mjs` | 先上传不可变词书版本，最后发布当前版本指针 |

## 下载 HTTP 协议

公开入口包括 `/downloads/latest`、`/downloads/latest.json`、`/downloads/latest.yml`、内容寻址的 `/downloads/releases/<version>/<sha256>/...`，以及迁移前的版本化安装包路径。只读函数不列目录，不接受上传、删除、任意 URL 或用户指定桶名。官网页面启动时读取 `latest.json`，软件读取 `latest.yml`；两者由同一个 `releases/current.json` 决定。

| 请求 / 条件 | 响应 |
| --- | --- |
| GET，文件存在 | 200，流式传输完整安装包 |
| GET `/downloads/latest` | 302 到当前内容寻址安装包，响应不缓存 |
| GET `/downloads/latest.json` | 200，当前版本、长度、SHA-256 和公开路径，响应不缓存 |
| GET `/downloads/latest.yml` | 200，electron-updater 当前清单，响应不缓存 |
| HEAD，文件存在 | 200，仅元数据，不读取文件正文，忽略 Range |
| GET，合法单段 Range | 206，支持闭区间、开放结尾和尾部字节范围 |
| If-Range 不匹配 | 忽略 Range，返回完整 200 响应 |
| If-None-Match 或 If-Modified-Since 命中 | 304，无正文；ETag 条件优先 |
| If-Match 或 If-Unmodified-Since 不满足 | 412 |
| 文件不存在或路径格式不匹配 | 404 |
| 非 GET/HEAD 方法 | 405，`Allow: GET, HEAD` |
| 范围超出文件、逆序或零长度尾部范围 | 416，`Content-Range: bytes */<文件长度>` |
| 多段 Range 或不支持的 Range 格式 | 忽略 Range，返回完整 200 响应 |
| R2 异常或读取期间对象改变 | 503，`Retry-After: 60` |

安装包成功响应包含 `Content-Type: application/octet-stream`、附件文件名、Content-Length、Accept-Ranges、ETag、Last-Modified 和 `X-Content-Type-Options: nosniff`；单段响应另有 Content-Range。内容寻址安装包和 blockmap 可缓存一年，最新版指针与更新清单不缓存；没有额外的边缘 Cache API 层。错误响应不缓存。

## 词书 HTTP 协议

`GET /api/books/cet6/catalog` 返回当前内容版本、词书摘要、词根组和排课索引，使用 `Cache-Control: no-store`。`POST /api/books/cet6/words` 接受以下字段：

- `dataVersion`：目录返回的 16 位十六进制内容版本。
- `planDay`：1–40 的计划日。
- `kind`：`study`、`review` 或 `bookmarks`。
- `wordIds`：去重前不超过 5166 个规范 UUID。

接口先读取版本清单，把 ID 按学习日分片分组，再顺序读取 R2 并流式返回一个 `words` 对象。学习日请求当天全部唯一单词；复习日由本机进度决定 ID。响应和错误都不缓存。请求不存在的版本返回 409，参数或非本词书 ID 返回 400，R2 故障返回 503。当前阶段接口公开可读，没有账号登录或授权防复制。

## 用户认证 HTTP 协议

- `POST /api/auth/send-code`：提交 `{ email }`。服务端校验邮箱格式，生成 6 位数字 OTP 存入 D1（有效期 5 分钟），执行 60 秒重发冷却，并通过 `login@auth.cyword.chengyi.me` 调用 Resend 发送邮件。生产环境缺少 Key 时返回 503，发送失败时删除刚写入的验证码，不回显验证码。
- `POST /api/auth/verify-code`：提交 `{ email, code }`。核对 D1 验证码，输错累计 5 次作废，匹配成功后核销验证码，自动建号或更新登录时间，并签发 HMAC-SHA256 JWT Token。
- `GET /api/auth/me`：携带 `Authorization: Bearer <token>` 请求头。服务端校验 JWT 有效性并返回用户 ID、邮箱与活跃信息。

## 进度同步 HTTP 协议

截至 2026-09-20，该接口尚待生产授权、建表与部署；官网词汇掌握演示的本地修改也尚未部署。0.4.4 新增 `GET /api/progress` 与 `PUT /api/progress`，均需同样的 Bearer 登录令牌。GET 返回 `{ revision, progress }`，PUT 提交对应结构；修订号不一致返回 409 和最新记录，客户端合并后重试。D1 表 `learning_progress` 必须在发布函数前创建。身份隔离、限额、合并规则和部署步骤见 [安卓与同步说明](ANDROID.md)。官网展示页面不会调用该接口。

HEAD 示例：

```powershell
curl.exe --fail --head 'https://cyword.chengyi.me/downloads/latest'
```

实际续传、上传新版本、部署与回滚、R2 和 Workers 额度见 [运行手册](RUNBOOK.md)。实现数据流见 [架构](ARCHITECTURE.md)。

## 内容与隐私边界

官网沿用暖纸色、陶土橙、橄榄绿和 Cy 标记，中文使用系统无衬线字体，英文单词和品牌使用 Georgia。字体、图标、样式不依赖外部 CDN。主线是“逐词巧记 → 构词成组 → 熟练度与累计复习”。

- 自 0.3.0 起，安装包不内置六级详情，运行时通过词书接口加载 5166 个唯一单词。0.4.4 新增安卓客户端；没有 Mac 版、四级或考研词书。官网正式下载仍以已经核验的发布指针为准。
- 计划包含 30 个学习日和 10 个累计复习日，不保证在 40 个自然日内记住全部单词。0.4.4 重排后的学习日为 174–185 次曝光，多词根组可重复出现同一词，不能写成 200 个唯一新词或保证记忆效果。
- 0.2.1 可离线学习；0.3.0 起启动和每天学习需联网。0.4.4 的进度同步依赖新接口部署，两端须使用同一邮箱。正常覆盖升级保留进度，旧文件按已登录账号归属迁移。
- Windows 安装包未签名，安卓 APK 使用项目私有密钥签名；页面应提示核对来源与哈希，不引导用户关闭系统防护，也不把校验一致等同于安全认证。
- 官网没有统计脚本或公开表单；认证接口在 D1 中保存用户邮箱、登录时间和短期验证码，两个私有 R2 桶分别保存公开安装包和服务端词书分片。官网交互示例仍只保留 React 内存状态，刷新即重置，不访问桌面软件的会话、学习进度或 localStorage。
- 示例 portable、transport、porter 来自规范词书，巧记按 CSV 节选，例句为官网编写；不打包完整词书或词书远程图片。
- 2026-08-31 核对：5166 词均有 `memory_markup`，4877 词有 `etymology_markup`；12813 条构词关联中 6390 条有独立 `memory_method`。不能宣传每个构词元素都有独立巧记，也不能把所有词都说成有真正词根。
- 谐音与画面联想属于助记，不得当作词源分析。

## 交互检查清单

1. 学习视窗评级后显示自动收录/移出待巩固列表的反馈；没有手动收藏按钮。熟练度示例保留独立状态，刷新重置。词汇掌握说明必须明确只收录已学且未掌握/不清楚的词。
2. 四天日程支持点击、左右方向键及 Home/End，焦点与选中状态一致。
3. 手机导航选择锚点后收起；品牌和“回到顶部”指向页面顶部，页面无水平溢出。
4. 主下载与备用地址指向已发布文件；复制失败时显示可手选地址；FAQ 和校验信息可键盘展开。
5. 复习示例默认 2 词，全部掌握后列表为空，取消跳过后显示 3 词。
6. 桌面、平板、手机布局和系统“减少动态效果”设置正常。

## 生产验证基线（2026-09-02，北京时间）

- 正式域名与 Pages 备用域名首页均返回 200；未携带 Token 请求 `/api/auth/me` 返回 401。
- Production 已配置加密的 `RESEND_API_KEY` 与 `JWT_SECRET`。真实邮箱收到了 Resend 验证码，生产响应未包含 `debugCode` 或 `simulated`，验证码校验及登录成功。
- 邮件正文只显示 `CYword` 品牌名，验证码卡片和强调色使用与软件按钮一致的品牌橙，不再使用绿色或“词根记忆”字样。
- 下载、Range、续传和完整哈希应在每次标签发布后按运行手册重新验证；不把临时部署 ID、旧安装包长度或历史哈希作为长期基线。

## 词书接口验证记录

2026-09-19：线上目录版本为 `4a1f385d3c008d32`；新版内置顺序仍使用该版本取词，第一天 180 个唯一词批量返回成功，巧记与规范源数据一致。本地生成的新分片未上传，线上词书指针未改变。

2026-09-01（历史基线）：

生产环境已绑定私有桶 `cyword-book-data`，该次验证数据版本为 `353a5bffec631ba5`。目录接口返回 5166 词；普通学习日以一次 POST 返回 179 个唯一单词、JSON 正文 2899177 字节。最坏累计复习测试以一次 POST 返回全部 5166 个单词、JSON 正文 79332804 字节，用时约 12.7 秒，证明分片读取和流式响应没有触发 Worker 内存失败。无 `Content-Length` 的超限请求返回 413。
