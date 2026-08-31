# 官网说明

## 用途与入口

官网面向普通用户介绍 CYword，提供功能体验、Windows 安装包与安装指南，不是桌面应用的在线完整版。

- 官网：<https://cyword.chengyi.me/>；Pages 备用域名：<https://cyword.pages.dev/>。
- 主下载：<https://cyword.chengyi.me/downloads/CYword-Setup-0.2.1.exe>，通过私有 R2 桶提供，支持断点续传，无需访问 GitHub。
- 备用下载：[GitHub v0.2.1 安装包](https://github.com/cheng-yi-cc/CYword/releases/download/v0.2.1/CYword-Setup-0.2.1.exe)。两个入口必须使用同一份正式发布文件。
- 版本和校验值以 `website/src/release.ts` 为准；v0.2.1 为 140500489 字节，界面显示约 134 MB。

网站使用境外 Cloudflare 服务。国内线路受地区、运营商和跨境网络影响，不能承诺全国永久可达；境外托管适用的备案说明见[阿里云文档](https://help.aliyun.com/en/icp-filing/basic-icp-service/support/for-the-record-process-faq)。软件内自动更新仍使用 GitHub Releases，并未迁移到 R2。

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

`npm run build:site` 会生成函数类型并检查 TypeScript。`npm run test:site:download` 会构建官网，以 256 KiB 确定性文件在本地 R2 模拟器运行 15 项集成检查，覆盖字节完整性、HEAD、Range、续传拼接、条件请求、错误码及静态首页；不读取或写入远端桶。生成类型和测试状态不提交。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| `website/index.html` | 页面标题、描述和无脚本下载入口 |
| `website/src/Website.tsx` | 官网内容、交互示例、复制下载地址及备用入口 |
| `website/src/styles.css` | 独立视觉样式、响应式布局、键盘焦点及减少动态效果 |
| `website/src/release.ts` | 已发布安装包的版本、大小、主地址、备用地址和 SHA-256 |
| `website/public/` | 图标、抓取规则、站点地图、`_headers` 和 `_routes.json` |
| `website/functions/downloads/[[path]].ts` | 只读 R2 下载接口 |
| `website/wrangler.jsonc` | Pages 项目、构建目录和 R2 绑定配置 |
| `website/vite.config.ts` | 页面开发服务与构建输出 |
| `scripts/test-site-download.mjs` | 本地 R2 集成测试，显式传入同一配置中的绑定 |
| `scripts/upload-site-installer.mjs` | 核对文件名、长度及哈希后上传 Standard 桶 |

## 下载 HTTP 协议

公开路由为 `/downloads/CYword-Setup-x.y.z.exe`。只提供已上传的稳定版安装包，不列目录，不接受上传、删除、任意 URL 或用户指定桶名。其他静态页面不调用下载函数。

| 请求 / 条件 | 响应 |
| --- | --- |
| GET，文件存在 | 200，流式传输完整安装包 |
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

成功响应包含 `Content-Type: application/octet-stream`、附件文件名、Content-Length、Accept-Ranges、ETag、Last-Modified 和 `X-Content-Type-Options: nosniff`。单段响应另有 Content-Range。安装包按版本不可变，允许浏览器缓存一天；没有额外的边缘 Cache API 缓存。错误响应不缓存。

HEAD 示例：

```powershell
curl.exe --fail --head 'https://cyword.chengyi.me/downloads/CYword-Setup-0.2.1.exe'
```

实际续传、上传新版本、部署与回滚、R2 和 Workers 额度见 [运行手册](RUNBOOK.md)。实现数据流见 [架构](ARCHITECTURE.md)。

## 内容与隐私边界

官网沿用暖纸色、陶土橙、橄榄绿和 Cy 标记，中文使用系统无衬线字体，英文单词和品牌使用 Georgia。字体、图标、样式不依赖外部 CDN。主线是“逐词巧记 → 构词成组 → 熟练度与累计复习”。

- 当前提供 Windows 10/11 64 位安装包，内置六级 5166 个唯一单词；没有手机版、Mac 版、四级或考研词书。
- 计划包含 30 个学习日和 10 个累计复习日，不保证在 40 个自然日内记住全部单词。学习日为 178–187 次曝光，多词根组可重复出现同一词，不能写成 200 个唯一新词或保证记忆效果。
- 核心学习可离线；发音、检查更新和下载更新需要联网。学习进度保存在本机，无云同步，正常覆盖升级保留进度。
- 安装包未签名，页面提示核对来源与哈希，不引导用户关闭系统防护，也不把校验一致等同于安全认证。
- 官网没有账号、统计脚本、表单或用户数据云端存储；R2 仅保存公开安装包。交互示例只保留 React 内存状态，刷新即重置，不访问软件进度或 localStorage。
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
