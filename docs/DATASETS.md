# 词书数据

## 规范目录

每本词书使用独立目录：

```text
books/
  cet6/
    book.json
    csv/
      books.csv
      words.csv
      ...
```

`book.json` 保存稳定代码、名称、数据版本、核心统计和规范文件清单。`csv/table_catalog.csv` 是表级索引，`csv/field_dictionary.csv` 是字段级字典。二者和 CSV 一起提交；原始接口响应、会话信息、断点缓存、预览图和临时工作簿不提交。

## 六级数据基线

| 指标 | 数量 |
| --- | ---: |
| 元数据标称单词 | 5169 |
| 双接口确认的唯一单词 | 5166 |
| 真正词根 | 1128 |
| 含真正词根的单词 | 4047 |
| 无真正词根的独立单词 | 1119 |
| 涉及多个真正词根的单词 | 241 |
| 学习组 | 2247 |
| 学习曝光次数 | 5415 |
| 最大真正词根组 | 34 词 |
| 普通例句 / 真题例句 | 5148 / 5163 |
| 长难句 / 固定搭配 / 词频记录 | 5166 / 5993 / 4493 |

标称数量比实际可枚举数量多 3。学习日预览与候选词全集返回的 5166 个 ID 完全一致，因此应用以 5166 为可验证基线，不补造缺失项。

## 19 张规范表

- 核心：`books.csv`、`words.csv`、`sentence_zones.csv`。
- 例句：`examples.csv`、`exam_examples.csv`、`long_sentences.csv`、`long_sentence_segments.csv`、`long_sentence_analysis.csv`。
- 扩展：`frequencies.csv`、`collocations.csv`、`relations.csv`、`relation_words.csv`。
- 构词与标记：`word_markup_links.csv`、`root_markups.csv`、`root_markup_links.csv`、`analysis_seen_marks.csv`。
- 自描述：`raw_field_inventory.csv`、`field_dictionary.csv`、`table_catalog.csv`。

单词主表保留音标、中文释义、音频地址、巧记正文、词源正文、词根词缀笔记和积累等字段；其他表通过 `word_id` 与单词关联。完整字段定义不要在本文重复维护，以 `field_dictionary.csv` 为准。

## 2026-08-30 获取与规范化记录

数据来自“单词突围”1.0.3 中采集账号在 2026-08-30 可合法访问的大学英语六级词书。获取过程只使用该桌面应用自身的已登录请求通道，没有把登录凭据写入仓库：

1. 在本机 9223 调试端口连接 URL 以 `app://bundle/` 开头的渲染进程，通过 `window.desktop.request` 发起 JSON 请求。
2. 请求 `/api/v1/user/books` 与 `/api/v1/user/permissions/current`，只选择已发布且当前有权限的词书。
3. 请求 `/api/v1/user/books/{book_id}/plan?mode=study`，逐学习日读取 `/api/v1/user/learning/preview`；同时读取 `/api/v1/user/learning/candidates`，对两个全集按单词 ID 去重并比对。
4. 对确认后的单词 ID 调用 `POST /api/v1/user/content/word/preload`，每批 10 词。请求间隔 1000 ms；429 和 5xx 最多重试 5 次并指数退避；401 交给应用刷新会话后重试。
5. 原始嵌套 JSON 被展开为 19 张 UTF-8 CSV；核对详情条目全部为 `ok`、词书/候选/详情数量一致、规范表齐全且 `word_id` 无孤儿外键。
6. 规范化和复核完成后，原始 JSON、逐日预览、批次断点、ASAR/CDP 调试脚本、Excel 索引、检查日志和截图全部删除，只保留本目录中的可复现规范结果。

## 新增四级或考研词书

1. 创建 `books/cet4/` 或 `books/kaoyan/`，不要修改 `books/cet6/`。
2. 按六级的 19 张表导出数据，保持表头和 `word_id` 外键语义；没有记录的表也保留表头。
3. 创建对应 `book.json`，更新代码、名称、统计和文件清单；同步更新 `table_catalog.csv` 的实际行数。
4. 在 PowerShell 中选择词书并验证、构建：

```powershell
$env:CYWORD_BOOK = "cet4"
npm run data:verify
npm run data:build
Remove-Item Env:CYWORD_BOOK
```

当前版本一次构建一本词书，默认 `cet6`。真正加入多词书切换时，应先把运行时目录改为按词书代码分层，再在 UI 中添加词书选择；不要把多本词书合并到一组 CSV。

## 排课数据约定

只有 `root_markups.csv` 中 `root_type=root` 的元素参与排课。`prefix`、`suffix`、`base` 只进入单词详情。一个单词若没有真正词根，就独立成组；若包含多个真正词根，它会在相应学习组中重复出现。同组不跨天拆分，复习队列再按唯一 `word_id` 去重。

原巧记内容及引用不得修改，也不得用运行时替换绕过此约定。排课区分必须先学的熟词与已解释词根含义的回指；后者保留悬浮窗补充。互相依赖的词根组同日完成，必要时在组间穿插基础词；生成的 `exposureOrder` 指定当天实际学习顺序。重排只改变顺序和日期，不增删词条、学习组或曝光次数。
