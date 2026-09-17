# 四级词库编辑入口

**全库仍在编写中，尚未完成。** 冻结词表仍为 **6,161 个学习词条**、版本 `cet4-2016-v1`。截至 2026-09-17，30 词样板已原位改写巧记，另有 105 词原创初稿，合计 135 词有原创巧记。其余 6,026 词尚待编写。105 词初稿含释义、巧记、普通例句、搭配、长句与解析；315 个逐段中文释义已补齐，但构词核查与二次语言复核仍未完成，不能计为已复核词条。

采用用户提供的新方案后，已建立 [共用内容标准](../shared/STANDARD.md)、[选词审计](selection/README.md) 和 [100 词应用试验](pilot/README.md)。共用构词登记为 `authoring/shared/morphemes.csv`；六级旧用法逐词映射，混合词根身份的疑点暂不复用。试验入口为 `npm run cet4:pilot`、**http://127.0.0.1:5189/**，含 70 个待复核初稿，未发布为正式词书。

用户已要求自主推进，不再按阶段等待用户确认；内部仍按批次保存真实进度。全量参考对照已建立，其中 6,158 词有 ECDICT 匹配，3 个词通过补充资料核对；3,325 词有六级同词参考。参考命中不能算作原创正文完成。

## 逐词审稿

在仓库根目录运行 `npm run cet4:review`，然后访问 **http://127.0.0.1:5188/**。这里是独立的本地审稿页，不是正式学习应用。支持单词、释义和拼写变体搜索，六级同词对照，以及逐词批注的本地保存和导出、导入。

也可以先运行 `npm run cet4:review:build`，直接在浏览器打开 [审稿页](review/index.html)，或在编辑器查看 [原创正文稿](review/originals.md)。浏览器批注不会自动改写源文件；需要保留或换浏览器时导出审稿意见。

新增编辑源在 [content/](content/)，词典参考及 MIT 许可在 [references/](references/)。`display_overrides.json` 把冻结层的 `oughtto` 展示为标准的 `ought to`，保留原 ID、原始拼写与来源定位。`review/` 由脚本生成，不在其中手改正文。

本轮检查命令为 `npm run cet4:draft:verify`、`npm run cet4:sample:build` 和 `node scripts/cet4/verify-stage1.mjs --self-test`。全库尚未完成，因此未创建正式 `books/cet4/`，也未接入应用的四级排课。

## 已完成的材料

| 文件 | 用途 |
| --- | --- |
| [wordlist.csv](wordlist.csv) | 冻结的 6,161 个学习词条、稳定 ID、拼写变体和词形来源类型。 |
| [word_sources.csv](word_sources.csv) | 6,248 条学习词条与考纲单元格之间的来源关系。 |
| [wordlist_manifest.json](wordlist_manifest.json)、[scope_decision.json](scope_decision.json) | 词表版本、统计、哈希以及用户已确认的完整收录范围。 |
| [progress.csv](progress.csv) | 6,161 个词条的分组进度；30 个样板词已复核，105 词新增初稿的基础为 validated、构词和句子为 draft；真题未开始。 |
| [excluded_entries.csv](excluded_entries.csv) | 未纳入四级的 1,695 个六级来源单元格，保留排除依据。 |
| [source_entries.csv](source_entries.csv) | 官方词表全部 7,896 个可定位单元格，保留主词条、附列词、六级标记和同形词上标。 |
| [sources.json](sources.json) | 来源版本、官方链接、文件校验值、页码与数量口径。 |
| [extraction_audit.json](extraction_audit.json) | 每页提取数量与范围，含全部 129 个词表页。 |
| [source_verification.json](source_verification.json) | 两个独立解析器对 58,586 个字母、连字符字形和星号的逐页顺序比对结果。 |
| [normalization_rules.json](normalization_rules.json) | 212 种含斜杠或括号记法的明确展开、合并与特殊处理规则。 |
| [EDITORIAL_RULES.md](EDITORIAL_RULES.md) | 收词、稳定 ID、原创编写、引用、空值、解析及复核要求。 |
| [schema.json](schema.json)、[field_policy.csv](field_policy.csv) | 与六级兼容的 19 张表、173 个字段及逐字段填写规则。 |
| [PROGRESS.md](PROGRESS.md) | 当前决定、已完成检查及下一步。 |
| [issues.csv](issues.csv) | 印刷计数差异、原文记法问题及处置。 |
| [sample/](sample/) | 3 个 10 词人工编辑批次、选词覆盖清单和脚本生成的 19 张样板 CSV。 |
| [evidence.csv](evidence.csv)、[morpheme_registry.csv](morpheme_registry.csv)、[batches.csv](batches.csv) | 48 条证据、32 个稳定构词身份和 3 个已复核批次。 |

## 已冻结的收录范围

| 组成 | 唯一学习词条 | 说明 |
| --- | ---: | --- |
| 有主词条出处 | 4,069 | 同形词与纯拼写变体合并，独立并列词和缩略形式分开。 |
| 只有附列出处 | 2,092 | 考纲明确附列的词形独立学习，例如 ability。 |
| 合计 | 6,161 | 包括原表明确列出的 4 个短语单位，不额外扩充派生词或词组。 |

最终清单只认本目录的 `wordlist.csv`，SHA-256 为 `c7f97ea24f32387df77a5559bb49abf72704492900471d0c9777be8b18295088`。早期两种候选保留在 `.work/cet4/` 作为过程材料，后续编写不得从候选目录领取任务。教学内容完成后再导出正式应用词书。

## 原表计数不能直接当作学习词数

官方说明及末页印有主词目 5,418、附列词 2,551；按实际表格枚举为主词条行 5,377、附列单元格 2,519。两个解析器在全部词表页上的字母顺序和星号一致，未发现漏字；印刷统计的具体差异原因尚未有足够依据解释，已保留记录，没有补词凑数。

逐行枚举中，无星号的四级主词条有 4,114 行，其附列词 2,087 格；有星号的六级主词条 1,263 行，其附列词 432 格。不同源单元格可能合并为一个学习词条；一个单元格也可能明确并列多个独立词，故最终学习词数不能直接相加得到。

## 本地查看和复核

在编辑器中打开本 README 或 `EDITORIAL_RULES.md` 可直接预览规范；在本地表格工具中打开 `wordlist.csv` 可搜索和筛选冻结词表。用 `word_id` 在 `word_sources.csv` 找到出处，再用 `source_entry_id` 在 `source_entries.csv` 查考纲页码与行号。

运行 `npm run dev` 仍会打开六级应用；四级 100 词试验通过 `npm run cet4:pilot` 独立预览，全量正式接入仍未完成。阶段 2 可用下列命令生成、校验并通过现有读取逻辑编译样板，结果写入 `.work/cet4/stage2-data/`，不会覆盖正式六级 `data/`。

已实测的数据检查命令，在仓库根目录运行：

```powershell
npm run data:verify
node scripts/cet4/verify-stage1.mjs --self-test
npm run cet4:sample:build
```

阶段 1 校验会核对用户决定、词表哈希、来源覆盖、重复 ID、全部进度行及字段规则。`--self-test` 另确认重复 ID、缺失来源关系、混入六级出处三类错误均被拒绝。样板检查另覆盖空必填项、重复词条、无效关联、句子不能还原、无效解析引用和目标词未命中六类故障。

来源提取脚本为 `scripts/cet4/extract-syllabus.py`，独立核对脚本为 `scripts/cet4/verify-source.py`；二者接收缓存 PDF 路径，均验证 SHA-256。依赖为 `pdfplumber` 和 `pypdf`，实际验证版本见 `source_verification.json`。需要重建时先确认来源校验值一致，不能对换版 PDF 直接沿用旧坐标规则。

上述冻结清单由 `scripts/cet4/prepare-wordlist.py --include-related` 生成。生成器会拒绝用仅主词条模式覆盖已确认的完整范围。开始内容编写后，不得以重跑初始生成器代替词条编辑或 ID 迁移；按 `progress.csv` 逐批续写。正式词书仍按项目约定在阶段 7 导出到 `books/cet4/`。
