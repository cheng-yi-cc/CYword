# 架构

仓库包含 Windows 桌面应用、Capacitor 安卓应用和独立官网。安装包只携带软件，启动时联网读取词书目录；进度按账号先写入设备，由已实现的 `/api/progress` 同步到 D1（生产开通仍待授权与部署）。官网页面只展示少量交互示例，不读取用户进度；Pages Functions 承载认证、同步、只读词书接口和安装包下载。同步接口的部署条件见 [安卓与同步说明](ANDROID.md)。

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

Electron 主进程通过固定 HTTPS 地址读取词书目录和每日批量词汇，并提供进度原子读写、同步请求及基于 electron-updater 的版本更新管理 IPC。渲染进程启用上下文隔离、关闭 Node 集成并开启沙箱。进度原子写入 `userData/accounts/<账号哈希>/progress.json`；旧版 `progress.json` 保留且只向已知归属账号迁移。网页预览使用 localStorage，安卓通过 `src/platform.ts` 使用 Capacitor 原生 HTTP 与 Preferences。

学习日先请求当前单词，随后后台批量加载当天其余唯一单词 ID；未命中缓存时按需补载。复习日由本机进度生成动态 ID 列表，同样只发一个请求。服务端根据清单按学习日分片读取 R2，并流式拼接 JSON，避免累计复习在 Worker 内同时展开整本词书。渲染层通过 `WordHoverContext` 实现词汇交叉引用即时悬浮预览，按需拉取补充分片，不阻塞主学习流。

## 排课与复习

编译阶段只把真正词根组成学习组；无真正词根的单词独立成组。`scripts/learning-schedule.mjs` 区分熟词前置依赖与已经解释词根含义的回指；后者仍保留原文和悬浮窗，并在可行时优先满足。可学习的单词组和多词组按全书比例穿插，限制连续单词组；只有一个词的词根组也按单词组计入节奏。

互相依赖的词根组先合并成同日学习单元，再按真实词级依赖安排曝光，尽量保持组内连续，必要时先学另一组的基础词。`exposureOrder` 是当天分组展开序列的索引排列，仅顺序不同的日期保存该字段；学习前后导航与悬浮窗使用同一序列。根本无法满足的熟词循环直接中止构建，不再静默放行。日界线通过整体均衡分配，保持 30 个学习日和同组不跨天，多词根词的重复曝光保留。

界面把每 3 个学习日后插入 1 个复习日。六级共 30 个学习日和 10 个复习日。计划视图支持自由点击任意天数直接查阅对应日程。学习日单词卡片默认隐藏「下一个」并拦截右方向键跳过，强制完成三档熟练度判断后自动跳入下一词；使用「上一个」或左方向键回看已评级词时动态显示「下一个」按钮并恢复方向键，支持直接前进或重新评级后前进。学习完成以“组 × 单词”的评级曝光为准；复习从此前所有已学唯一单词动态生成，默认排除 `mastered`，顺序为 `unmastered`、`unclear`、`mastered`，每词本轮只出现一次。

## 进度模型

进度格式版本为 2，包含：

- 每个计划日的已完成组、已评级曝光、复习队列和完成时间。
- 每个单词的首次学习时间、末次查看时间、三档熟练度、复习次数和曝光次数。
- 复习历史，以及为旧客户端兼容保留的收藏时间戳。
- 可选 `bookmarkChanges` 保留旧版收藏删除标记；新版不再提供手动收藏入口。
- `vocabularyOverview` 从当前词书目录和 `words` 派生四类统计及待巩固列表，不创建第二份词汇状态。只展示已评级的未掌握/不清楚词，按状态与上次查看时间排序；详情按选中词加载，每页 50 词。
- `updateWordProficiency` 仅更新已有词的评级和修改时间，不增加曝光/复习次数，不推进计划日；同步沿用最新评级胜出的规则。
- `VocabularySession` 打开时固定当前分类和搜索后的完整词序（包括后续分页），以本轮评级集合控制前进权限，防止已存在的全局评级绕过重新判断。全屏详情通过 Portal 渲染，背景保留并设为不可交互，退出时恢复焦点和滚动位置；评级不改变本轮词序，返回列表才看到更新后的归类。

如需改变这些字段，必须同时提供旧版本迁移逻辑并补充测试，不能直接让已有 `progress.json` 失效。

重排学习日时，`reconcileCompletion` 汇总稳定的“组 ID × 单词 ID”曝光键并分配回新日程，重新计算完成状态，移除错误继承的旧完成标记；不根据熟练度自动完成另一个词根的曝光。单词评级、时间、复习队列和复习历史保持不变。同步合并按稳定曝光键去重，旧设备带来的原日期记录会再次归位；本机读取时也迁移，不依赖云端请求成功。

`ProgressSync` 将本地操作串行持久化，前台定期同步并在恢复网络/回到应用时补同步。客户端合并已完成曝光集合，按目录重算完成状态；评级采用最新修改时间，收藏包含删除标记。D1 `learning_progress` 表按账号与词书隔离，保存 gzip 快照、修订号和更新时间；条件写入防止并发覆盖，409 返回新快照供客户端再次合并。超过请求或存储限额时保留本机记录并显示错误。

手机端在 1080 像素以下使用底部导航、单栏内容与固定评级区，词根和长难句通过标签页切换。学习规则直接复用 `src/progress.ts`，不单独实现另一套排课。安卓返回键与应用恢复事件通过 Capacitor App 插件接入。

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

下载处理器 `website/functions/downloads/[[path]].ts` 只接受稳定最新版入口、受约束的内容寻址资产和迁移前安装包路径。认证处理器 `website/functions/api/auth/*.ts` 基于 Cloudflare D1 存储用户数据与验证码，通过专用发信域 `auth.cyword.chengyi.me` 的 Resend Key 发送邮件，并使用强随机 Secret 和 Web Crypto 签发/校验 HMAC-SHA256 JWT；任一密钥缺失时生产接口关闭，不降级为模拟模式。客户端会话持久化保存在 Electron `userData/session.json`，该目录不进入安装包。

两个 R2 桶与 D1 数据库均使用 APAC 位置，不开放 `r2.dev` 入口。electron-updater 使用官网 generic provider，GitHub Release 只保留公开发布记录和迁移前客户端的过渡入口。

下载、认证与进度同步 HTTP 协议见 [官网说明](WEBSITE.md)；账号权限、上线步骤、费用和排障见 [运行手册](RUNBOOK.md)。
