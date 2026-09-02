# 架构

仓库包含桌面应用和独立官网。桌面安装包只携带软件，启动时联网读取词书目录，进入学习或复习时一次请求当天需要的单词；学习进度仍只保存在本机。官网页面只展示少量交互示例，不接入桌面用户进度，但 Pages Functions 同时承载只读词书接口和安装包下载。

## 数据流

```text
books/<code>/book.json + csv/*.csv
                │
                ├─ scripts/verify-book-data.mjs  校验文件、行数、外键和基线
                │
                └─ scripts/build-app-data.mjs   编译运行时 JSON
                                  │
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

`books/` 是唯一应手工维护和提交的词书源数据。`data/` 仅供校验、测试和本地开发，不进入安装包。服务端发布物按内容哈希生成不可变版本：目录包含单词摘要、词根组和日程；每个单词只进入首次出现的学习日分片，清单记录单词到分片的映射。所有版本文件上传完成后才更新 `current.json`，避免客户端读到半成品。

## 桌面边界

Electron 主进程通过固定 HTTPS 地址读取词书目录和每日批量词汇，并提供进度原子读写及基于 electron-updater 的版本更新管理 IPC。渲染进程启用上下文隔离、关闭 Node 集成并开启沙箱；词书只保存在当前运行内存，切换页面会释放已加载详情。生产进度原子写入 Electron `userData/progress.json`，网页预览环境降级使用 localStorage。

学习日先从目录算出当天唯一单词 ID，再以一个 POST 请求批量获取。复习日由本机进度生成动态 ID 列表，同样只发一个请求。服务端根据清单按学习日分片读取 R2，并流式拼接 JSON，避免累计复习在 Worker 内同时展开整本词书。

## 排课与复习

编译阶段只把真正词根组成学习组；无真正词根的单词是单词组。组按原词书顺序排入目标约 190 次曝光的学习日，同组绝不拆天。多词根单词允许在不同组重复曝光。

界面把每 3 个学习日后插入 1 个复习日。六级共 30 个学习日和 10 个复习日。学习完成以“组 × 单词”的评级曝光为准；复习从此前所有已学唯一单词动态生成，默认排除 `mastered`，顺序为 `unmastered`、`unclear`、`mastered`，每词本轮只出现一次。

## 进度模型

进度格式版本为 2，包含：

- 每个计划日的已完成组、已评级曝光、复习队列和完成时间。
- 每个单词的首次学习时间、末次查看时间、三档熟练度、复习次数和曝光次数。
- 生词本时间戳与复习历史。

如需改变这些字段，必须同时提供旧版本迁移逻辑并补充测试，不能直接让已有 `progress.json` 失效。

## 官网与下载

```text
阿里云 DNS：cyword.chengyi.me → cyword.pages.dev
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

`website/vite.config.ts` 把 `website/` 构建到 `dist-site/`；`website/wrangler.jsonc` 定义 Pages 项目、输出目录、两个 R2 绑定和 D1 数据库绑定。`website/public/_routes.json` 让 `/downloads/*`、`/api/books/*` 和 `/api/auth/*` 调用函数，首页与静态资源不占用函数请求额度。

下载处理器 `website/functions/downloads/[[path]].ts` 只接受稳定最新版入口、受约束的内容寻址资产和迁移前安装包路径。认证处理器 `website/functions/api/auth/*.ts` 基于 Cloudflare D1 存储用户数据与验证码，通过 Resend 发送邮件，并使用 Web Crypto 签发/校验 HMAC-SHA256 JWT。客户端会话持久化保存在 Electron `userData/session.json`。

两个 R2 桶与 D1 数据库均使用 APAC 位置，不开放 `r2.dev` 入口。electron-updater 使用官网 generic provider，GitHub Release 只保留公开发布记录和迁移前客户端的过渡入口。

下载与认证 HTTP 协议见 [官网说明](WEBSITE.md)；账号权限、上线步骤、费用和排障见 [运行手册](RUNBOOK.md)。
