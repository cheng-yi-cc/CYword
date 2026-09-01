# 官网说明

## 用途与入口

官网面向普通用户介绍 CYword，提供功能体验、Windows 安装包与安装指南，不是桌面应用的在线完整版。

- 官网：<https://cyword.chengyi.me/>；Pages 备用域名：<https://cyword.pages.dev/>。
- 主下载：<https://cyword.chengyi.me/downloads/latest>，从私有 R2 桶的原子版本指针跳转到当前内容寻址安装包，支持断点续传，无需访问 GitHub。
- 备用下载：[GitHub v0.3.0 安装包](https://github.com/cheng-yi-cc/CYword/releases/download/v0.3.0/CYword-Setup-0.3.0.exe)。两个入口必须使用同一份正式发布文件。
- 版本和校验值以 `/downloads/latest.json` 为准；`website/src/release.ts` 只保留动态指针不可用时的 v0.2.1 回退信息。

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
| `website/server/book-api.ts` | 词书 R2 结构、参数校验和错误响应共用逻辑 |
| `website/wrangler.jsonc` | Pages 项目、构建目录和 R2 绑定配置 |
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

HEAD 示例：

```powershell
curl.exe --fail --head 'https://cyword.chengyi.me/downloads/latest'
```

实际续传、上传新版本、部署与回滚、R2 和 Workers 额度见 [运行手册](RUNBOOK.md)。实现数据流见 [架构](ARCHITECTURE.md)。

## 内容与隐私边界

官网沿用暖纸色、陶土橙、橄榄绿和 Cy 标记，中文使用系统无衬线字体，英文单词和品牌使用 Georgia。字体、图标、样式不依赖外部 CDN。主线是“逐词巧记 → 构词成组 → 熟练度与累计复习”。

- 0.3.0 不内置六级详情，运行时通过词书接口加载 5166 个唯一单词。没有手机版、Mac 版、四级或考研词书。
- 计划包含 30 个学习日和 10 个累计复习日，不保证在 40 个自然日内记住全部单词。学习日为 178–187 次曝光，多词根组可重复出现同一词，不能写成 200 个唯一新词或保证记忆效果。
- 0.2.1 仍可离线学习；0.3.0 启动和每天学习都需要联网。学习进度保存在本机，无云同步，正常覆盖升级保留进度。
- 安装包未签名，页面提示核对来源与哈希，不引导用户关闭系统防护，也不把校验一致等同于安全认证。
- 官网没有账号、统计脚本、表单或用户数据云端存储；两个私有 R2 桶分别保存公开安装包和服务端词书分片。交互示例只保留 React 内存状态，刷新即重置，不访问软件进度或 localStorage。
- 示例 portable、transport、porter 来自规范词书，巧记按 CSV 节选，例句为官网编写；不打包完整词书或词书远程图片。
- 2026-08-31 核对：5166 词均有 `memory_markup`，4877 词有 `etymology_markup`；12813 条构词关联中 6390 条有独立 `memory_method`。不能宣传每个构词元素都有独立巧记，也不能把所有词都说成有真正词根。
- 谐音与画面联想属于助记，不得当作词源分析。

## 交互检查清单

1. 切换示例单词同步更新释义、拆词和例句；收藏与熟练度按词保留，刷新重置。
2. 四天日程支持点击、左右方向键及 Home/End，焦点与选中状态一致。
3. 手机导航选择锚点后收起；品牌和“回到顶部”指向页面顶部，页面无水平溢出。
4. 主下载与备用地址指向已发布文件；复制失败时显示可手选地址；FAQ 和校验信息可键盘展开。
5. 复习示例默认 2 词，全部掌握后列表为空，取消跳过后显示 3 词。
6. 桌面、平板、手机布局和系统“减少动态效果”设置正常。

## 已完成验证（2026-08-31，北京时间）

生产部署 `b4545ce7.cyword.pages.dev` 已接入 R2。官网类型检查、构建、15 项下载集成测试通过；首页与本地构建产物哈希一致，页面加载资源均来自正式域名。

21:31 完整下载预览版本的 140500489 字节安装包；21:33 在正式域名先取前 1 MiB，再以 206 响应续传余下 139451913 字节。两次完整文件的 SHA-256 都等于正式发布值：

```text
47aa16276aaf3ef7230149bd44aff16be0172b55f5a3caa930a0d7944da9b5fa
```

21:33 的 ITDOG 安装包 GET 探测：国内 247 个节点中 234 个返回 200，电信 76/81、联通 77/78、移动 81/88；港澳台和海外 39/39。273 份成功响应头均带正确文件长度。失败或超时涉及海南海口、福建泉州/福州/宁德、陕西宝鸡/西安、四川巴中、广西南宁、新疆乌鲁木齐、贵州贵阳的部分线路。

国内探测只证明响应可达，不代表各节点完整下载并校验了文件，也不能把该工具的耗时解释为整包下载时间。过程截图、探测原始文件和重复安装包已按收尾约定清理；后续应按运行手册重新验证，不依赖临时文件。

## 词书接口验证（2026-09-01，北京时间）

生产部署 `48adc795.cyword.pages.dev` 已绑定私有桶 `cyword-book-data`，当前数据版本为 `353a5bffec631ba5`。目录接口返回 5166 词；普通学习日以一次 POST 返回 179 个唯一单词、JSON 正文 2899177 字节。最坏累计复习测试以一次 POST 返回全部 5166 个单词、JSON 正文 79332804 字节，用时约 12.7 秒，证明分片读取和流式响应没有触发 Worker 内存失败。无 `Content-Length` 的超限请求返回 413。同期首页为 200，已发布 0.2.1 安装包 HEAD 仍为 200 且长度保持 140500489 字节。
