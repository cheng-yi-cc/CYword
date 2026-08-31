# 架构

仓库包含桌面应用和独立官网。桌面端读取完整词书与本机进度；官网只展示少量交互示例并提供公开安装包，不接入桌面用户数据。

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
                        Electron IPC ────────┤
                                             ▼
                                      React / Vite 界面
```

`books/` 是唯一应手工维护和提交的词书源数据。`data/` 是为快速启动生成的运行时目录：目录表只放单词摘要、词根组和日程，单词详情按 ID 拆分并在需要时读取，避免一次把全部详情加载进渲染进程。

## 桌面边界

Electron 主进程提供词书目录读取、单词详情按需读取、进度原子读写，以及基于 electron-updater 的版本更新管理（检查、下载与重启安装）IPC。渲染进程启用上下文隔离、关闭 Node 集成并开启沙箱；外部 HTTP 链接交给系统浏览器。生产进度原子写入 Electron `userData/progress.json`，网页预览环境降级使用 localStorage。

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
                              └─ /downloads/CYword-Setup-x.y.z.exe
                                           │ GET / HEAD
                                  Pages Function（流式响应）
                                           │ DOWNLOADS 绑定
                                  R2 私有桶 cyword-downloads
```

`website/vite.config.ts` 把 `website/` 构建到 `dist-site/`；`website/wrangler.jsonc` 定义 Pages 项目、输出目录和 R2 绑定。`website/public/_routes.json` 只让 `/downloads` 和 `/downloads/*` 调用函数，首页与静态资源不占用函数请求额度。域名服务器仍在阿里云，只设置子域 CNAME，不接管根域或其他项目。

下载处理器 `website/functions/downloads/[[path]].ts` 仅接受稳定版安装包文件名。HEAD 读取元数据；GET 先取元数据，再按 ETag 条件读取 R2 流，支持单段 Range 和 If-Range，不把完整安装包装入内存。对外没有上传、目录列表或任意 URL 代理。响应允许浏览器缓存一天，但没有额外的边缘 Cache API 层。

R2 桶使用 APAC 位置、Standard 存储，`r2.dev` 公开入口关闭。官网下载主地址和 GitHub 备用地址指向相同发布文件，版本信息集中在 `website/src/release.ts`。桌面应用内更新仍由 electron-updater 访问 GitHub Releases，官网部署不会切换该通道。

下载 HTTP 协议及内容边界见 [官网说明](WEBSITE.md)；账号权限、上线步骤、费用和排障见 [运行手册](RUNBOOK.md)。
