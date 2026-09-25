# 内容来源与授权材料台账

记录日期：2026-09-20。范围为当前仓库中的六级词书、记忆增强及官网示例。

2026-09-21 更新：维护者已将仓库公开；新版源码增加在用户设备下载、保存并离线播放全部原音频的流程，直接从原 CDN 获取，不新增音频再托管。该变化记录使用方式，不把软件 Apache-2.0 许可证扩展为第三方正文或录音的许可；下表待补材料状态保持不变。

2026-09-23 更新（待发布源码）：完整词书、全部原发音及正文原配图改为构建时从规范表及原 CDN 收集，随 Windows / 安卓安装包分发；原内容的授权材料状态保持不变。新增 Gentium 7.000 Regular 原版 WOFF2，用于 IPA 音标，来源为 [SIL 官方下载](https://software.sil.org/gentium/download/)，未修改字体文件；SIL Open Font License 1.1 副本随安装包保存在 `third-party/GENTIUM-OFL.txt`，源码文件为 `src/assets/Gentium-Regular.woff2`。

本文记录文件能够支持的来源信息和仍待补齐的材料，不判断具体使用是否获得授权，也不作法律结论。“未见材料”仅指本轮检查的仓库文件中未找到相应凭据，不表示维护者在仓库外没有材料。

本轮没有修改原巧记、词根正文及其引用，也没有完成逐项权利核验。数据完整性检查、内容审核哈希和接口可访问状态均未被记作再分发或公开服务的授权证明。

## 采集与许可记录的边界

- [获取记录](DATASETS.md#2026-08-30-获取与规范化记录)记载：数据从“单词突围”1.0.3 的已登录请求通道取得，采集日期为 2026-08-30。
- [book.json](../books/cet6/book.json)记录源词书 ID `b55b4dec-300a-4caa-a704-2a1fa40a90b1`、获取时间及 5166 个可枚举单词；[books.csv](../books/cet6/csv/books.csv)保存 `purchased`、`published`、`currently_available=true` 等当时的接口状态。这些文件没有附上允许向其他用户分发词书、通过公开接口提供内容或在官网展示内容的协议正文。
- 仓库根目录保有 [Apache License 2.0 文本](../LICENSE)。本轮未见把该文本与上游词书、录音及其他第三方内容逐项对应的授权方声明；台账不据此推定这些内容的许可范围。
- 音形增强另有明确存档的 [CMUdict 许可文本](../books/cet6/enhancements/CMUDICT-LICENSE)及[发行材料副本](../public/third-party/CMUDICT-LICENSE.txt)。该项单独记录，不扩展为其他内容的授权状态。

## 分类台账

| 内容类别 | 仓库可确认的来源与证据 | 当前材料状态 | 待维护者补档 |
| --- | --- | --- | --- |
| 词书释义、单词巧记、词根巧记与构词正文 | 获取记录指向原六级词书。[words.csv](../books/cet6/csv/words.csv)保存释义、`memory_markup`、构词分析和笔记；[root_markups.csv](../books/cet6/csv/root_markups.csv)保存构词元素及 `memory_method`；[字段字典](../books/cet6/csv/field_dictionary.csv)记录接口字段路径。 | 来源和字段映射已记录；未见覆盖这些正文再分发、客户端展示及公开词书服务的授权协议、许可声明或适用条款存档。 | 内容提供方与权利主体的对应关系；涵盖具体表、字段、版本和使用方式的材料；需要保留的署名、通知、有效期及其他约定。 |
| 普通例句、真题例句、长难句及解析 | 原接口内容规范化为 [examples.csv](../books/cet6/csv/examples.csv)、[exam_examples.csv](../books/cet6/csv/exam_examples.csv)、[long_sentences.csv](../books/cet6/csv/long_sentences.csv)及分段、解析表。真题表含年份、试卷、章节字段；长难句 `source_note` 记为上游“原创仿真 CET6”内容、非真题原文。 | 有分类及部分出处字段，未见逐条原始出处核对记录、作者归属材料或覆盖句子、译文、解析公开展示与再分发的凭据。上游“原创”标签仅按来源字段保留，未验证作者身份。 | 分开核对句子、译文和解析的来源；补齐真题出处、仿真句作者记录，以及对应展示和分发范围的材料。 |
| 发音音频 | 本轮按 [words.csv](../books/cet6/csv/words.csv)逐行统计：5166 个 `audio_url` 均指向 `cdn.aimwords.com`。官网 [Website.tsx](../website/src/Website.tsx)的 `immersivePortable.audioUrl` 也使用该域名。规范数据保存音频地址；Windows 0.4.7 / Android 0.1.4 构建时收集原录音并随安装包分发。 | 服务域名和 URL 已记录；未见录音制作方、录音权利归属、外部播放、缓存、离线打包或再托管的使用范围凭据。可从 CDN 请求文件未被记作许可证明。 | 音频提供方及录音归属说明；当前外链播放的适用材料；针对已增加的缓存及离线安装包分发，分别补齐相应范围记录。 |
| 音形分块与音标纠正参考 | [增强说明](../books/cet6/enhancements/README.md)记录原词书音标基线、94 条独立纠正及 Cambridge、Collins、CMUdict 参考；[pronunciation-guides.jsonl](../books/cet6/enhancements/pronunciation-guides.jsonl)的纠正项保存理由和具体 URL；[pronunciation-review.jsonl](../books/cet6/enhancements/pronunciation-review.jsonl)保存逐词审查与参考读音。CMUdict 记录含快照日期、哈希及许可副本。 | CMUdict 许可文件已存档；音标来源链接、处理说明和内容审核记录已存档。未见其他参考来源适用条款的存档及逐项使用范围核验记录；`accepted` 和哈希表示项目内容检查，不表示完成权利核验。 | 保留实际使用版本、对应许可和发行通知的核对记录；补充其他参考来源的适用材料、使用方式及检查结论；记录增强文字的贡献者与维护责任。 |
| 以熟带生增强 | [增强说明](../books/cet6/enhancements/README.md)及 [meaning-bridge-reviews.jsonl](../books/cet6/enhancements/meaning-bridge-reviews.jsonl)记录来自本书关系表的候选、本书释义审查、逐对说明及排除理由；[逐词结果](../books/cet6/enhancements/meaning-bridges.jsonl)与[逐词审核](../books/cet6/enhancements/meaning-bridge-word-review.jsonl)通过哈希关联。 | 形成过程和所依赖的词书材料已有记录；未见增强说明文字的独立作者归属记录，也未见对所引用、依赖的上游材料完成用途核验的凭据。语义审查未被记作权利审查。 | 增强文字的贡献者、生成与复核记录；上游释义及关系材料的适用范围；如另引外部材料，逐项登记来源与所用部分。 |
| 官网自编示例及混合展示内容 | [官网说明](WEBSITE.md)记载部分示例例句为官网编写；[Website.tsx](../website/src/Website.tsx)直接维护 `demoWords` 和 `immersivePortable`。本轮逐字比对确认：`immersivePortable` 的普通例句、真题例句、长难句分别与原词书的对应 CSV 一致；其发音仍为上游 CDN 地址。portable 的 por·ta·ble 分块取自本书已审核的 pronunciation-guides.jsonl，不作词根拆解。因此官网示例包含多种来源。 | 部分自编内容的说明存在；未见按具体字段区分原创、摘录、改写和外链素材的清单，也未见完整作者记录及上游内容官网公开展示的凭据。不能把“官网编写”概括到整个交互示例。 | 按 `demoWords`、`immersivePortable` 的字段登记作者、来源与改动方式；分别补齐引用正文、真题、译文、解析和音频的展示范围材料，并使官网来源说明与台账一致。 |

## 补档与维护

维护者补档时，每项至少记录：对应内容或字段、来源方与材料名称、取得日期、适用版本、约定的使用范围、署名或通知要求、有效期，以及核验人和核验日期。涉及安装包、公开 API、官网展示和音频外链时，应分别写明材料覆盖的使用方式，不能以其中一项替代其他项。

协议或通信材料若不适合公开入库，可在本表登记由维护者保管的文档编号、保管位置和可复核摘要；不要提交账号凭据或私人通信全文。尚未取得或未完成核验的项目继续标记为“待补档”或“待核验”，不改写为“已获授权”。

新增词书、替换上游内容、扩大公开展示范围或改变音频托管方式时，同步更新本台账。当前原巧记保护约定继续适用；补档过程不自动允许修改原正文或引用。
