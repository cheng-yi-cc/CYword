# 词典参考层

`lexical.csv` 为冻结的 6,161 个词条逐项保存参考结果，匹配到 ECDICT 的有 6,158 词；空白和歧义提示原样保留。它不是四级原创释义或已完成的基础词库。

来源为 [ECDICT](https://github.com/skywind3000/ECDICT/tree/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b)，固定提交、下载地址和完整文件 SHA-256 见 `manifest.json`，许可全文见 `ECDICT-LICENSE`。音标保留上游记法；没有把不同口音、多音词、技术义项或同形词自动合并成一个已审稿答案。

`supplements.json` 保存实际核对的补充出处。`microwavable`、`ought to`、`résumé` 已有补充资料，但不会倒填成 ECDICT 命中。其初稿在 `../content/exceptions.tsv`。

重建参考层需先将固定提交的 `ecdict.csv`、GitHub 提交响应 `ecdict-commit.json` 和 `ECDICT-LICENSE` 保存到 `.work/cet4/references/`，然后运行 `node scripts/cet4/prepare-lexical-reference.mjs`。通常无需再次下载；本目录的匹配子集已足以供后续编辑查阅。
