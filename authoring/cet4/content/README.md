# 四级原创初稿

这里是编写源，不是正式应用词书。当前 `a01.tsv` 有 102 词，`exceptions.tsv` 有 3 词；既有 30 词样板继续在 `../sample/` 原位维护。生成的数量与缺口见 `manifest.json`。

每个普通 TSV 都有同名的 `-reading.tsv`。普通表保存原创释义、音标编辑稿、巧记、例句、搭配与用法；阅读表保存原创长句、译文、实际命中的词形、三段结构和对应解析。制表符只作列分隔，字段不能带制表符或实际换行。`||` 分隔阅读段，`role::text` 指定段的角色，所有段的原始空格保留并能完整拼回原句。

新增 105 词已经过结构检查，315 个逐段中文释义已补齐，分别在 `../pilot/reading-glosses.tsv` 和 `../content-glosses.tsv` 维护。仍须二次核实音标和释义，补充构词登记与词间关系。状态为初稿；不能因字段非空而标记 reviewed，也不能用 `detail_status=ok` 导出成正式词书。

修改已有词条就在原行改，不创建备份词条，不重分稳定 ID。新批次必须来自冻结词表，不能与样板或其他初稿重复。只在有依据时新增 `display_overrides.json` 的展示更正，保持原来源可追溯。

保存后运行：

```powershell
npm run cet4:review:build
npm run cet4:draft:verify
npm run cet4:sample:build
```

审稿页通过 `npm run cet4:review` 打开，地址 `http://127.0.0.1:5188/`。生成的 HTML 与 Markdown 不作为编辑源；浏览器批注需要导出才能在浏览器外保存。
