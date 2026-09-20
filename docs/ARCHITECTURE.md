# 架构

仓库包含 Windows 桌面应用、Capacitor 安卓应用和独立官网。安装包只携带软件，启动时联网读取词书目录；进度按账号先写入设备，再由 `/api/progress` 同步到 D1。生产同步表和函数已于 2026-09-20 部署。官网页面只展示少量交互示例，不读取用户进度；Pages Functions 承载认证、同步、只读词书接口和安装包下载。缓存、会话、凭据、同步与发布校验改进已随 2026-09-20 的 Windows 0.4.5、安卓 0.1.1 和官网函数发布。部署与验证边界见 [安卓与同步说明](ANDROID.md)。

## 数据流

```text
books/<code>/book.json + csv/*.csv + enhancements/*.jsonl（可选）
                │
                ├─ scripts/verify-book-data.mjs  校验文件、行数、外键和基线
                │
                └─ scripts/build-app-data.mjs   编译运行时 JSON
                                  │
                                  ├─ data/curriculum.json → 两端内置排序元数据
                                  ├─ data/catalog.json
                                  └─ data/words/<word-id>.json
                                             │
                      scripts/build-book-api-data.mjs
                                             │
                  .work/book-api/<code>/<version>/
                    ├─ catalog.json + manifest.json
                    └─ shard-01.json ... shard-30.json
                                             │ 上传
                                      私有 R2 词书桶
                                             │ Pages Functions
                                             ▼
                          Electron IPC → React / Vite 界面
```

`books/` 是唯一应手工维护和提交的词书源数据，原巧记正文严禁修改。`data/` 是构建生成物；完整目录及单词详情不进入安装包。`data/curriculum.json` 仅包含分组 ID、词 ID 与日程顺序，由两端共用的 `applyCurriculum` 编译进应用，校验远端分组成员一致后应用；远端 `dataVersion` 保留用于请求原有分片，因此重排不要求替换线上词书，也不改变旧客户端的日程。服务端发布物按内容哈希生成不可变版本：每个单词只进入首次出现的学习日分片，清单记录单词到分片的映射。所有版本文件上传完成后才更新 `current.json`。

## 桌面边界

音形增强在编译时合入 `WordDetail.pronunciationGuide`，不参与排课或进度模型。`PronunciationMemory` 在学习主卡和详情复用；字段缺失时隐藏增强入口。结构验收及源音标快照检查由 `pronunciation-data.mjs` 执行，候选生成器不在构建/运行时调用。Vite 开发模式从 `data/` 提供本地接口，正式应用继续请求线上版本化词书。

词义桥接由 `meaning-bridge-data.mjs` 校验逐对审核及全书逐词结果，编译为可选的 `WordDetail.meaningBridges`。`MeaningBridgeProvider` 根据同一排课的曝光顺序与学习记录筛选同书参照；学习页传入本次曝光位置，详情默认首次位置。`MeaningBridgeMemory` 在构词分析后显示一个候选，复用 `WordHoverContext`，无候选则隐藏。新关系不增加排课依赖，不改写原巧记或进度。

Electron 主进程通过固定 HTTPS 地址读取词书目录和每日批量词汇，并提供进度原子读写、同步请求及基于 electron-updater 的版本更新管理 IPC。渲染进程启用上下文隔离、关闭 Node 集成并开启沙箱。进度原子写入 `userData/accounts/<账号哈希>/progress.json`；旧版 `progress.json` 保留且只向已知归属账号迁移。Windows 会话令牌由 `electron/session-store.cjs` 使用 safeStorage/DPAPI 加密，读取旧 `session.json` 时原子迁移；加密失败不明文降级。窗口初始和最小尺寸受当前显示器工作区限制，常规最小尺寸为 760×560。

网页预览使用 localStorage，安卓通过 `src/platform.ts` 使用 Capacitor 原生 HTTP；账号进度仍保存在原 Preferences 键，由自有 `DeviceStoragePlugin` 通过 `commit()` 确认写入，失败恢复内存缓存并上报。会话使用 Android Keystore 的 AES-GCM 密文，旧 Preferences 明文仅在密文提交成功后删除，凭据迁移不改变进度文件或账号归属。

正式桌面包启动时检测更新，`autoDownload=true` 自动下载；下载完成后通过安装 IPC 一次点击安装，`autoInstallOnAppQuit=false` 保证普通退出不会触发安装。界面展示下载进度、失败重试和安装入口；开发预览不执行自动更新。

`useWordResources` 为当前词书代码和 `dataVersion` 创建共享 `WordResourceCache`，默认容量为 256 个详情，采用 LRU 淘汰；版本切换清空旧缓存并丢弃迟到响应，同词并发请求按 ID 去重。学习、复习和列表详情由 `useSessionWord` 先取当前词，成功后只预取随后最多 4 词；加载失败留在局部详情并提供重试，不再以整日或累计复习全量请求驱动缓存。服务端仍根据清单按学习日分片读取 R2 并流式拼接 JSON。`WordHoverContext` 按需加载引用词并提供局部失败重试，不阻塞主学习流。

学习和浏览详情共用 `useSessionSave` 的同步保存锁，以及 `useSessionDialog` 的背景 inert、焦点约束、Esc/安卓返回键和焦点/滚动恢复；关闭行为先处理悬浮卡，保存期间不退出。所有发音入口共用 `PronunciationPlayer` 单通道和 `AudioButton`，新播放停止旧播放，迟到的播放结果不能覆盖当前词，错误在原入口显示并可重试。

## 排课与复习

编译阶段只把真正词根组成学习组；无真正词根的单词独立成组。`scripts/learning-schedule.mjs` 区分熟词前置依赖与已经解释词根含义的回指；后者仍保留原文和悬浮窗，并在可行时优先满足。可学习的单词组和多词组按全书比例穿插，限制连续单词组；只有一个词的词根组也按单词组计入节奏。

互相依赖的词根组先合并成同日学习单元，再按真实词级依赖安排曝光，尽量保持组内连续，必要时先学另一组的基础词。`exposureOrder` 是当天分组展开序列的索引排列，仅顺序不同的日期保存该字段；学习前后导航与悬浮窗使用同一序列。根本无法满足的熟词循环直接中止构建，不再静默放行。日界线通过整体均衡分配，保持 30 个学习日和同组不跨天，多词根词的重复曝光保留。编译日程的可选 `segmentEnds` 记录累计曝光终点：按完整同日互依单元累积到约 20 个曝光后设置休息点，大单元可以超过 20；仅用于学习中途休息提示，不重排、拆组、改变日界线或新增依赖。

界面把每 3 个学习日后插入 1 个复习日。六级共 30 个学习日和 10 个复习日。计划视图支持自由点击任意天数直接查阅对应日程。学习日单词卡片默认隐藏「下一个」并拦截右方向键跳过，强制完成三档熟练度判断后自动跳入下一词；使用「上一个」或左方向键回看已评级词时动态显示「下一个」按钮并恢复方向键，支持直接前进或重新评级后前进。学习日按“组 × 单词”安排计数，任何已有熟练度状态的词均计入已学，开始学习及评级后优先进入剩余未学词；完成剩余未学词即可完成当天。实际评级曝光另行保留，不为提前已学词伪造曝光；复习从此前所有已学唯一单词动态生成，默认排除 `mastered`，顺序为 `unmastered`、`unclear`、`mastered`，每词本轮只出现一次。

## 进度模型

进度格式版本为 2，包含：

- 每个计划日的已完成组、已评级曝光、复习队列和完成时间。
- 每个单词的首次学习时间、末次查看时间、三档熟练度、复习次数和曝光次数。
- 复习历史，以及为旧客户端兼容保留的收藏时间戳。
- 可选 `bookmarkChanges` 保留旧版收藏删除标记；新版不再提供手动收藏入口。
- `vocabularyOverview` 从当前词书目录和 `words` 派生四类统计及待巩固列表，不创建第二份词汇状态。只展示已评级的未掌握/不清楚词，按状态与上次查看时间排序；详情按选中词加载，每页 50 词。
- `updateWordProficiency` 仅更新已有词的评级和修改时间，不增加曝光/复习次数，不推进计划日；同步沿用最新评级胜出的规则。
- `WordBrowseSession` 同时供词汇掌握和单词搜索使用，打开时固定当前分类和搜索后的完整词序（包括后续分页），以本轮评级集合控制前进权限，防止已存在的全局评级绕过重新判断。全屏详情通过 Portal 渲染，背景保留并设为不可交互，退出时恢复焦点和滚动位置；评级不改变本轮词序，返回列表才看到更新后的归类。

“单词搜索”在全书目录上按拼写前缀即时筛选，不区分大小写；`bookWordOrder` 按编译日程及 `exposureOrder` 的首次出现位置去重排列。桌面与手机共用居中标题和搜索框；输入中的查询展示前 8 个候选，提交的查询独立保留完整结果，每页 50 词，提交后搜索框移至顶部。候选支持方向键选择、回车打开、Esc 收起；直接回车或点击搜索展示完整结果。详情打开时固定整个匹配列表，沿用强制评级、跨页浏览和返回恢复行为。`rateSearchWord` 可建立新词评级；`completedStudyExposureKeys` 将原有曝光与已有词汇状态共同用于进度计算。搜索不写复习记录，也不替代复习日判断。

如需改变这些字段，必须同时提供旧版本迁移逻辑并补充测试，不能直接让已有 `progress.json` 失效。

重排学习日时，`reconcileCompletion` 汇总稳定的“组 ID × 单词 ID”曝光键并分配回新日程，重新计算完成状态，移除错误继承的旧完成标记；同时根据已有词汇评级计算各组及学习日完成状态；熟练度可以带来学习进度，但不会增加另一个词根的实际评级曝光记录。单词评级、时间、复习队列和复习历史保持不变。同步合并按稳定曝光键去重，旧设备带来的原日期记录会再次归位；本机读取时也迁移，不依赖云端请求成功。

`ProgressSync` 将保存与远端合并串行持久化，写盘成功后才更新可见快照并允许上传；保存失败保留旧快照，失败评级不会被下一次同步带入云端。`save(next, baseline)` 按原渲染基线识别真正改动的词，避免把旧快照中其他词误判为新评级。`flush()` 返回 `{ localSaved, cloudSynced, message }`，区分本机保存失败与仅云端未完成；退出账号时前者阻止退出，后者明确提示并允许用户决定是否继续。

合并继续按稳定曝光键取并集并重算完成状态；熟练度沿用旧客户端的 `lastSeenAt` 规则，收藏保留删除标记。保存本次评级时，将该词时间设为用户有效时间与已观察该词时间加 1 毫秒中的较大值，保证已看到快时钟评级后仍可重新评级，不新增同步协议字段。没有观察到彼此更新的离线并发继续按相同既有时间和平局规则收敛，不能据此保证真实墙钟上最后一次操作胜出。

前台定期同步并在恢复网络/回到应用时补同步。D1 `learning_progress` 表按账号与词书隔离，保存 gzip 快照、修订号和更新时间；条件写入防止并发覆盖，409 返回新快照供客户端再次合并。超过请求或存储限额时保留本机记录并显示错误。

手机端在 1080 像素以下使用底部导航、单栏内容与固定评级区，词根和长难句通过标签页切换。学习规则直接复用 `src/progress.ts`，不单独实现另一套排课。安卓返回键与应用恢复事件通过 Capacitor App 插件接入。

同步返回 401 时停止旧同步器、清除持久化会话并显示登录页，移除过期账号信息；本机学习进度保留。普通网络故障保留登录态，账号切换后的迟到响应被忽略。

桌面学习页长难句默认收起为侧边按钮，展开通过网格列宽动画调整三栏，收起后空间分配给词根栏与单词栏；减少动态效果设置下直接切换。`memory-display.ts` 仅对单词巧记的页面文本隐藏行首固定引导语，词书数据、后续正文及引用、词根词缀巧记均不改动。

## 官网与下载

```text
Cloudflare DNS：cyword.chengyi.me → cyword.pages.dev
                              │
                    Cloudflare Pages 项目 cyword
                              ├─ /、/assets/* → dist-site/ 静态页面
                              ├─ /downloads/latest{,.json,.yml}
                               ├─ /downloads/releases/<version>/<sha256>/*
                                            │ GET / HEAD
                                   Pages Function（流式响应）
                                            │ DOWNLOADS 绑定
                                   R2 私有桶 cyword-downloads
                               ├─ /api/books/<code>/{catalog,words}
                                            │ GET / POST
                                   Pages Function（批量流式响应）
                                            │ BOOKS 绑定
                                   R2 私有桶 cyword-book-data
                               └─ /api/auth/{send-code,verify-code,me}
                                            │ POST / GET
                                   Pages Function（用户认证与 JWT 签发）
                                            │ DB 绑定
                                   D1 数据库 cyword-db
```

`website/vite.config.ts` 把 `website/` 构建到 `dist-site/`；`website/wrangler.jsonc` 定义 Pages 项目、输出目录、两个 R2 绑定和 D1 数据库绑定。必需的 `RESEND_API_KEY`、`JWT_SECRET` 通过 Pages Production 加密 Secret 单独管理，不写入配置文件。`website/public/_routes.json` 让 `/downloads/*`、`/api/books/*`、`/api/auth/*` 和 `/api/progress` 调用函数，首页与静态资源不占用函数请求额度。

下载处理器 `website/functions/downloads/[[path]].ts` 只接受稳定最新版入口、受约束的内容寻址资产和迁移前安装包路径。认证处理器 `website/functions/api/auth/*.ts` 基于 Cloudflare D1 存储用户数据与验证码，通过专用发信域 `auth.cyword.chengyi.me` 的 Resend Key 发送邮件，并使用强随机 Secret 和 Web Crypto 签发/校验 HMAC-SHA256 JWT；任一密钥缺失时生产接口关闭，不降级为模拟模式。验证码的匹配、有效期和次数检查与核销通过单条 `DELETE ... RETURNING` 原子执行；错误次数在条件 UPDATE 中递增，发码冷却与占位使用条件 UPSERT，账号创建及登录次数也由 UPSERT 保证。Electron `userData/session.json` 保存加密令牌与账号信息，该目录不进入安装包。

两个 R2 桶与 D1 数据库均使用 APAC 位置，不开放 `r2.dev` 入口。electron-updater 使用官网 generic provider；GitHub Release 作为维护者的发布来源及工作流取件入口，不向用户宣传私有仓库下载或备用链接。

`website/server/release-manifest.ts` 统一校验 Windows/安卓发布身份与内容寻址路径。下载函数兼容已发布 v1 指针和新 v2 指针，对外只返回官网路径、版本、大小和 SHA-256 等必要字段，发行说明指向官网。安装器和 blockmap 继续流式响应并支持 HEAD、Range 与条件请求。v2 发布前须先部署兼容函数；`scripts/release-preflight.mjs` 以固定官网域名、禁止重定向的 HEAD 请求检查 `X-CYword-Release-Schemas: 1,2`，未确认支持就拒绝写入 R2。能力响应不依赖当前是否已有安装包指针。安装包资产先校验上传，最后切换相应平台的 `current.json`，Windows 与安卓指针彼此独立。

下载、认证与进度同步 HTTP 协议见 [官网说明](WEBSITE.md)；账号权限、上线步骤、费用和排障见 [运行手册](RUNBOOK.md)。

## 0.4.5 / 0.1.1 验证边界

同步测试覆盖本机失败不污染云端、上传期间评级、修订冲突、设备时差、新旧客户端合并一致与旧渲染基线；本地真实 D1 测试覆盖 OTP 并发核销及次数限制。缓存、音频和休息点有对应行为测试。Windows 实际 Electron/DPAPI 的旧会话迁移、密文回读与退出清除已通过，安卓 Release 构建与延续旧版证书的签名校验已通过；未连接安卓真机，尚不能声称 Keystore 升级迁移、真实账号跨设备同步和移动设备音频已验收。两个平台已发布，正式下载验证记录见 [运行手册](RUNBOOK.md)。
