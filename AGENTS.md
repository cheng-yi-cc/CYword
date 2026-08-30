# CYword 项目约定

- 这是一个 Windows Electron 桌面应用，前端使用 React、TypeScript 与 Vite。
- 正式词书数据放在 `books/<book-code>/`；`data/` 是构建生成物，不得手工修改或提交。
- 默认词书是 `cet6`。新增四级、考研等词书时使用独立稳定代码，如 `cet4`、`kaoyan`，不要覆盖六级数据。
- 每本词书必须包含 `book.json` 和 `csv/` 下的完整规范表；先运行 `npm run data:verify`，再构建应用。
- `books/cet6/csv/table_catalog.csv` 记录表及行数，`field_dictionary.csv` 记录字段含义，它们是数据结构的权威索引。
- 第一版只按 `root_type=root` 排课；前缀、后缀、词基只展示在单词详情中。无真正词根的单词作为独立组。
- 同一真正词根组必须在同一天学完；多词根单词在各相关组重复学习，复习日按唯一单词去重。
- 计划节奏固定为学习 3 天、累计复习 1 天；六级编译为 30 个学习日和 10 个复习日。
- 熟练度只有 `unmastered`、`unclear`、`mastered` 三档；复习日默认跳过 `mastered`。
- 桌面端学习进度写入 Electron `userData/progress.json`；浏览器预览使用 localStorage。

## 六级原始数据获取记录

- 2026-08-30 从“单词突围”1.0.3 的已授权桌面会话获取；经本机 Chromium 调试端口调用应用自带请求桥。
- 用词书权限、学习计划、每日预览和候选词全集交叉确认 5166 个唯一单词，再通过词详情预载接口按每批 10 词读取。
- 请求间隔 1000 ms，遇到 429/5xx 指数退避，401 由应用刷新会话；最终校验详情状态和所有 CSV 外键。
- 元数据标称 5169 词，两个可枚举接口一致为 5166 词，差异 3 已在词书清单中保留，禁止擅自补造。
- 原始 JSON、断点缓存、调试/抓取脚本、Excel 与截图检查件已在规范化完成后删除；详细端点、表结构及扩充步骤见 `docs/DATASETS.md`。

## 常用命令

- 本地预览：`npm run dev`
- 数据校验：`npm run data:verify`
- 自动测试：`npm test`
- 生成安装包：`npm run dist`