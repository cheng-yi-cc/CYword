# 官网说明

官网与函数已于 2026-09-25 更新部署；当前客户端为 Windows 0.4.8、Android 0.1.5。发布与下载核验记录统一见 [运行手册](RUNBOOK.md)。

## 用途与入口

官网面向普通用户介绍 CYword，提供功能体验、Windows 和安卓安装包与安装指南，不是应用的在线完整版。官网示例独立维护，客户端的搜索、布局和记忆增强不会自动进入示例。

- 官网：<https://cyword.chengyi.me/>；Pages 备用域名：<https://cyword.pages.dev/>。
- Windows 下载：<https://cyword.chengyi.me/downloads/latest>；Android 下载：<https://cyword.chengyi.me/downloads/android/latest>。两者从私有 R2 桶的独立原子版本指针跳转到安装包，支持断点续传，下载无需登录。
- GitHub 仓库 `https://github.com/cheng-yi-cc/CYword` 已于 2026-09-21 改为公开，官网源码在页脚提供开源入口；现有下载安装与自动更新仍使用官网源。公开版本记录放在 `/#release-notes`，只记录已发布改动；离线模式从 Windows 0.4.6 / Android 0.1.3 起提供。
- Windows 版本和校验值以 `/downloads/latest.json` 为准，Android 以 `/downloads/android/latest.json` 为准；`website/src/release.ts` 只保留动态指针不可用时已核验的 Windows 0.4.8 回退信息，并在页面明确提示。Android 读取失败显示未知状态与重试入口，不填造版本或哈希。
- 两个平台分别显示版本、文件大小、校验值及安装步骤，锚点为 `/#guide-windows`、`/#guide-android`。
- 首屏为不保存记录的交互示例。桌面长难句沿用应用右侧竖排入口，默认收起为 52px；展开时三栏同步调整宽度，内容延迟淡入，收起时先淡出内容，动画时长与应用一致。手机标签按“单词、词根、长难句”切换。各栏独立滚动且隐藏滚动条，采用 `overscroll-behavior: contain` 阻断外层滚动穿透，单词默认完整显示，点击切换分块；点击音标或发音按钮临时分块，结束、停止、失败后恢复。portable 使用已审核的 por·ta·ble，不按词根切分；发音支持停止与失败重试。

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

输出为 `dist-site/`，预览地址为 `http://127.0.0.1:4174/`，与桌面端 `dist/` 和端口 5173 分离。Vite 不模拟 R2，通过 `/downloads/` 代理读取正式域名的发布信息和安装包；本地预览不会发布页面或切换版本。

`npm run build:site` 会生成函数类型并检查 TypeScript。`npm run test:site:download` 会构建官网，以确定性文件在本地 R2 模拟器运行集成检查，覆盖旧 v1 与新 v2 发布指针、Windows 和安卓下载、公开响应不含私有仓库链接、electron-updater 清单、blockmap、字节完整性、HEAD、Range、续传拼接、条件请求、错误码及静态首页；不读取或写入远端桶。生成类型和测试状态不提交。`npm run test:site:ui` 验证桌面/手机示例的分块切换及发音恢复。客户端的加载、保存与退出交互回归使用 `npm run test:ui`，运行条件见 [运行手册](RUNBOOK.md)。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| `website/index.html` | 页面标题、描述和无脚本下载入口 |
| `website/src/Website.tsx` | 官网内容、交互示例、双平台下载、站内版本记录与隐私说明 |
| `website/src/styles.css` | 独立视觉样式、响应式布局、键盘焦点及减少动态效果 |
| `website/src/release.ts` | 读取并校验动态最新版信息，保留不可用时的已核验回退版本 |
| `website/public/` | 图标、抓取规则、站点地图、`_headers` 和 `_routes.json` |
| `website/functions/downloads/[[path]].ts` | 只读 R2 下载接口 |
| `website/server/release-manifest.ts` | v1/v2 指针校验与公开字段归一化 |
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
| `scripts/release-preflight.mjs` | 上传前确认生产下载函数支持 v2 发布指针 |
| `scripts/verify-blockmap.mjs` | 逐块验证 blockmap 与安装器一致 |
| `scripts/build-book-api-data.mjs` | 生成内容寻址的目录、清单和学习日分片 |
| `scripts/upload-book-data.mjs` | 先上传不可变词书版本，最后发布当前版本指针 |

## 下载 HTTP 协议

Windows 公开入口包括 `/downloads/latest`、`/downloads/latest.json`、`/downloads/latest.yml`、内容寻址的 `/downloads/releases/<version>/<sha256>/...`，以及迁移前的版本化安装包路径。只读函数不列目录，不接受上传、删除、任意 URL 或用户指定桶名。官网页面启动时读取 `latest.json`，软件读取 `latest.yml`；两者由同一个 `releases/current.json` 决定。Android 使用独立的 `/downloads/android/latest`、`/downloads/android/latest.json` 与 `releases/android/current.json`，不会改写 Windows 自动更新清单。

生产函数兼容已经发布的 schema v1 和新生成的 schema v2 私有指针，两个版本均校验平台、版本、文件名与路径中的 SHA-256。v2 不再需要 GitHub 字段，并记录 Windows blockmap、更新清单各自的长度和 SHA-256。公开 `latest.json` 统一返回版本、日期、文件名、长度、安装包 SHA-256、下载路径及 `notesUrl: "/#release-notes"`，不透传旧 v1 中的私有 GitHub 链接。

首次启用新发布脚本前，必须先部署兼容 v1/v2 的下载函数，再发布 v2 指针；原有 v1 指针无需改写。函数响应头 `X-CYword-Release-Schemas: 1,2` 用于发布前检查。脚本在任何 R2 写入前向对应平台的生产 `latest.json` 发 HEAD，无法确认支持 `2` 就中止；尚无指针的错误响应也可以携带此能力头。顺序与回滚限制见 [运行手册](RUNBOOK.md)。

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

接口先读取版本清单，把 ID 按学习日分片分组，再顺序读取 R2 并流式返回一个 `words` 对象。该接口供旧客户端和显式开启旧下载流程的开发预览使用：旧流程首次分批下载，旧客户端也可按当前词及后续少量词请求；复习词序由本机进度决定。Windows 0.4.7 / Android 0.1.4 起的安装版改为读取包内资源，不调用此接口。响应和错误都不缓存。请求不存在的版本返回 409，参数或非本词书 ID 返回 400，R2 故障返回 503。当前阶段接口公开可读，没有账号登录或授权防复制。

单词详情可选携带 `pronunciationGuide` 和 `meaningBridges`，格式以 `src/types.ts` 为准。旧数据缺少字段时客户端隐藏增强入口；旧客户端忽略额外字段。上传增强词书会生成新的内容版本，不覆盖旧分片；只有客户端代码合并或安装包升级不会更新 R2 词书。增强源数据和审核规则见[数据说明](../books/cet6/enhancements/README.md)。

## 用户认证 HTTP 协议

- `POST /api/auth/send-code`：提交 `{ email }`。服务端校验邮箱格式，用一条条件 UPSERT 在 D1 中原子检查 60 秒重发冷却并写入 6 位 OTP（有效期 5 分钟），只有写入成功的请求才通过 `login@auth.cyword.chengyi.me` 调用 Resend 发信。生产环境缺少密钥时返回 503；发信失败按邮箱和本次验证码条件清理，不回显验证码。
- `POST /api/auth/verify-code`：提交 `{ email, code }`。D1 用带有效期与次数条件的 `DELETE ... RETURNING` 原子匹配并消费验证码，同一码不能被并发成功使用两次。错误尝试由数据库累加，累计 5 次作废；成功后用邮箱唯一约束的 UPSERT 建号或更新登录时间与次数，再签发 HMAC-SHA256 JWT Token。原子操作已随 2026-09-20 官网函数部署生效。
- `GET /api/auth/me`：携带 `Authorization: Bearer <token>` 请求头。服务端校验 JWT 有效性并返回用户 ID、邮箱与活跃信息。

## 进度同步 HTTP 协议

2026-09-20 已完成授权、建表与同步函数部署，官网提供词汇掌握演示和安卓下载入口。0.4.4 新增 `GET /api/progress` 与 `PUT /api/progress`，均需同样的 Bearer 登录令牌。GET 返回 `{ revision, progress }`，PUT 提交对应结构；修订号不一致返回 409 和最新记录，客户端合并后重试。D1 表 `learning_progress` 必须在发布函数前创建。身份隔离、限额、合并规则和部署步骤见 [安卓与同步说明](ANDROID.md)。官网展示页面不会调用该接口。

HEAD 示例：

```powershell
curl.exe --fail --head 'https://cyword.chengyi.me/downloads/latest'
```

实际续传、上传新版本、部署与回滚、R2 和 Workers 额度见 [运行手册](RUNBOOK.md)。实现数据流见 [架构](ARCHITECTURE.md)。

## 内容与隐私边界

官网沿用暖纸色、陶土橙和橄榄绿，品牌只显示 CYword，中文使用系统无衬线字体，英文单词和品牌使用 Georgia。字体、图标、样式不依赖外部 CDN。主线是“逐词巧记 → 构词成组 → 熟练度与累计复习”。

- Windows 0.4.8 / Android 0.1.5 预装完整六级词书、全部发音和原配图；网站本身仅包含独立示例。没有 Mac 版、四级或考研词书。官网正式下载以已经核验的发布指针为准。
- 计划包含 30 个学习日和 10 个累计复习日，不保证在 40 个自然日内记住全部单词。每天曝光次数以对应版本的编译排课为准，多词根组可重复出现同一词，曝光次数不等于唯一新词数，也不保证记忆效果。
- 当前安装版首次联网登录后直接离线学习，无需二次下载；0.4.6 / 0.1.3 保留首次下载流程。进度默认保存在本机，旧云端记录导入一次；云端模式及旧版同步服务保留。正常覆盖升级保留进度，旧文件按已登录账号归属迁移。
- Windows 安装包未签名，安卓 APK 使用项目私有密钥签名；页面应提示核对来源与哈希，不引导用户关闭系统防护，也不把校验一致等同于安全认证。
- `/#privacy` 说明账号、学习记录、官网示例与服务提供方：认证接口在 D1 保存邮箱、账号标识、登录时间和短期验证码，新版学习记录按账号保存在设备，旧 D1 记录只读导入一次，旧客户端或显式云端模式仍可同步；两个私有 R2 桶分别保存公开安装包和服务端词书分片。官网没有统计脚本或公开表单，交互示例只保留 React 内存状态，刷新即重置，不访问客户端会话、学习进度或 localStorage。发音播放会请求 `cdn.aimwords.com`；下载、账号与同步使用 Cloudflare，验证码邮件使用 Resend。
- `/#feedback` 提供反馈与删除说明，维护者确认的公开邮箱为 `cyi907369@gmail.com`，通过 `mailto:` 链接打开邮件客户端。删除申请提示使用登录邮箱发送；这是人工申请入口，没有自助删除接口，实际收件及处理流程仍需维护者验证。退出登录、清理本机数据与删除云端数据是不同操作。
- 官网固定示例混合使用原词书节选与页面编写内容；portable、transport、porter 及部分例句、长难句来自规范词书。逐项来源见 [内容来源台账](CONTENT-SOURCES.md)，不将上游“原创”标注等同于本项目原创或授权证明。不打包完整词书或词书远程图片。
- 2026-08-31 核对：5166 词均有 `memory_markup`，4877 词有 `etymology_markup`；12813 条构词关联中 6390 条有独立 `memory_method`。不能宣传每个构词元素都有独立巧记，也不能把所有词都说成有真正词根。
- 谐音与画面联想属于助记，不得当作词源分析。

## 交互检查清单

1. 学习视窗明确标注交互示例、不保存记录；评级显示当前示例状态，可重新体验，刷新重置。长难句默认折叠，展开、手机标签及音频控制真实有效，不显示无法操作的上一词/下一词。词汇掌握说明必须明确只收录已学且未掌握/不清楚的词。
2. 四天日程支持点击、左右方向键及 Home/End，焦点与选中状态一致。
3. 手机导航选择锚点后收起；品牌和“回到顶部”指向页面顶部，页面无水平溢出。
4. Windows 与 Android 下载均指向已发布 R2 文件，分别显示对应版本、校验值与安装说明；版本记录链接留在站内。模拟 Android 读取失败，确认错误、重试及恢复状态；Windows 失败时明确提示已核验回退版本。复制失败时显示可手选地址，FAQ 和校验信息可键盘展开。
5. 复习示例默认 2 词，全部掌握后列表为空，取消跳过后显示 3 词。
6. 桌面、平板、手机布局、按钮对比度和系统“减少动态效果”设置正常；横纵滚动条统一隐藏，滚轮、触控和键盘仍可滚动。页脚隐私与反馈锚点可达，反馈邮件链接指向维护者确认的邮箱。

## 生产验证基线（2026-09-02，北京时间）

- 正式域名与 Pages 备用域名首页均返回 200；未携带 Token 请求 `/api/auth/me` 返回 401。
- Production 已配置加密的 `RESEND_API_KEY` 与 `JWT_SECRET`。真实邮箱收到了 Resend 验证码，生产响应未包含 `debugCode` 或 `simulated`，验证码校验及登录成功。
- 邮件正文只显示 `CYword` 品牌名，验证码卡片和强调色使用与软件按钮一致的品牌橙，不再使用绿色或“词根记忆”字样。
- 下载、Range、续传和完整哈希应在每次标签发布后按运行手册重新验证；不把临时部署 ID、旧安装包长度或历史哈希作为长期基线。

## 词书接口验证记录

2026-09-20：线上词书更新为 `90284475439a197b`，目录完整哈希与本地发布产物一致；30 个分片各抽取一个词，经生产接口返回的完整详情均与上传源一致。5166 词的两项增强审计通过，原巧记未改动。旧版本对象保留，供旧客户端继续读取。

2026-09-19（历史记录）：线上目录版本为 `4a1f385d3c008d32`；新版内置顺序仍使用该版本取词，第一天 180 个唯一词批量返回成功，巧记与规范源数据一致。本地生成的新分片未上传，线上词书指针未改变。

2026-09-01（历史基线）：

生产环境已绑定私有桶 `cyword-book-data`，该次验证数据版本为 `353a5bffec631ba5`。目录接口返回 5166 词；普通学习日以一次 POST 返回 179 个唯一单词、JSON 正文 2899177 字节。最坏累计复习测试以一次 POST 返回全部 5166 个单词、JSON 正文 79332804 字节，用时约 12.7 秒，证明分片读取和流式响应没有触发 Worker 内存失败。无 `Content-Length` 的超限请求返回 413。

## 安卓下载

`GET/HEAD /downloads/android/latest.json` 返回安卓独立版本信息；`/downloads/android/latest` 跳转当前 APK。资产采用 `releases/android/<version>/<sha256>/CYword-Android-<version>.apk` 路径，响应类型为 `application/vnd.android.package-archive`，支持 HEAD、Range 和条件缓存。其私有指针 `releases/android/current.json` 不对外暴露。公开仓库的 `android-v<version>` Release 作为内部原件来源，独立 GitHub Actions 上传原始签名 APK 并校验后切换指针，不影响 Windows 的 `latest.yml`。

## 差量下载协议

- Windows 安装器 URL 带内容哈希，electron-updater 推导旧 `.exe.blockmap` 时仅替换版本号，可能保留新哈希。精确对象不存在时，函数只在该旧版本前缀查找唯一合法 blockmap，返回不缓存的 302；多候选或列表截断均拒绝。正常安装包与内容寻址对象仍严格匹配，不覆盖已有资源。
- 安卓 schema v2 增加可选 `differential: { path, sha256, sizeBytes }`，`path` 必须严格等于 APK 下载路径加 `.blocks.json`，清单限制 16 MiB。旧指针和旧客户端仍兼容；Windows 清单不接受此字段。
- 分块清单 schema 1 / `zip-sha256-1m` 覆盖 APK 每一字节。ZIP32 压缩数据边界单独切分，最长块 1 MiB，每块记录长度和 SHA-256；不超过 512 字节的块可内嵌 Base64 数据。APK 整包哈希、大小也写入清单。支持最大 2 GiB 的非分卷 ZIP32；ZIP64 或超限包拒绝发布，不能静默产生无效更新。
- APK 继续使用已有单 Range 流式响应。客户端拒绝不符合请求的 Content-Range、200 整包回退、重定向、截断和校验不符；不会因此暗中下载整个包。
- `/downloads/android/latest.json` 声明 `X-CYword-Android-Differential: zip-sha256-1m`。发布脚本先检查该能力，APK 与清单先上传核验、独立 `current.json` 最后切换。先部署兼容函数，再发布新增差量字段的版本。
