import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse } from "csv-parse/sync";

const root = process.cwd();
const source = path.join(root, "books/cet6/csv");
const output = path.join(root, "authoring/cet4");
fs.mkdirSync(output, { recursive: true });
const read = (name) => parse(fs.readFileSync(path.join(source, name), "utf8"), { columns: true, bom: true });
const dictionary = read("field_dictionary.csv");
const oldCatalog = read("table_catalog.csv");
const rules = [];
const schemas = {};
const constants = {
  book_id: ["cyword-cet4", "本项目原创词书固定标识"],
  book_code: ["cet4", "稳定代码；不得覆盖 cet6"],
  book_name: ["大学英语四级", "词书显示名称"],
  target_exam: ["cet4", "目标考试"],
  is_completed: ["false", "发行数据不携带个人进度"],
  studied: ["false", "发行数据不携带个人进度"],
  reviewed: ["false", "发行数据不携带个人进度"],
  memorized_count: ["0", "发行数据不携带个人进度"],
  reviewed_count: ["0", "发行数据不携带个人进度"],
  is_active: ["false", "不替用户切换当前词书"],
  purchase_status: ["not_applicable", "原创词书，无上游购买经历"],
  lifecycle_status: ["draft", "仅在正式发布流程中改为 published"],
  currently_available: ["false", "草稿不能作为已发布词书使用；发布后由实际状态填写"],
  access_allowed: ["true", "仅描述本项目已复核导出内容，不声称拥有第三方访问权限"],
  permission_is_expired: ["false", "原创内容无上游到期授权"],
  contract_source: ["cyword_original", "本项目原创内容；真实考题另记逐条来源"],
  requires_membership: ["false", "无第三方会员契约；不改应用现有访问控制"],
  no_auto_fallback: ["true", "缺失内容不自动替换为六级或模拟内容"],
  reader_parse_version: ["1", "第一版结构解析协议"],
  source_exam_type: ["cet4", "只允许可核验的四级考题"],
};
const empty = new Set(["day_id", "day_number", "order_in_day", "vocabulary_id", "access_reason", "permission_type", "current_period_ends_at", "final_ends_at"]);
const optional = new Set(["audio_url", "etymology_markup", "root_affix_accumulation", "memory_method", "difficulty_band", "examples_json"]);
const generated = new Set(["total_words_metadata", "enumerated_unique_words", "metadata_difference", "root_count", "word_order", "example_count", "long_sentence_count", "exam_example_count", "frequency_count", "collocation_count", "root_markup_count", "relation_group_count", "analysis_seen_mark_count", "related_word_count", "order_index", "root_index", "link_index", "relation_index", "related_index", "segment_index", "section_index", "item_index", "table_file", "row_count", "primary_key", "field_name", "category", "data_type", "source_path", "description", "field_path", "observed_types", "occurrences", "non_null_occurrences"]);
const specifics = {
  "words.csv/pronunciation": "阶段 3 必填；核验口音与多音情况。考纲没有读音，不得注明来自考纲。",
  "words.csv/definition_cn": "阶段 3 必填；逐义项标词性，用中文原创概括；同形词保留必要义项，不冒充考纲给出的释义。",
  "words.csv/memory_markup": "阶段 4 必填；原创助记，可用联想但须明确其为记忆法。仅向已登记实体生成双向链接。",
  "words.csv/etymology_markup": "有可靠构词或词源依据才写事实说明；不以谐音或字母巧合充当词源。无证据可空，并在进度中标 not_applicable 或待核实。",
  "words.csv/root_affix_notes": "记录核实后的构词解释、变体与用法；无法拆分时明确整体记忆，不创建假词根。",
  "words.csv/detail_status": "只有该词必填教学内容全部复核、可选项状态已交代且校验通过，才导出 ok；草稿不进入正式 words.csv。",
  "words.csv/sentence_zone_status": "已验收句子内容导出 ready；与 sentence_zones.status 一致。无句子时保持草稿，不伪称 ready。",
  "words.csv/audio_url": "可空；有适合采用的真实音频来源且链接可访问才填，不猜 CDN 地址。",
  "books.csv/total_words_metadata": "由冻结词表的学习词条数 N 生成；5418 是合并级别的原书印刷统计，不可写成四级词数。",
  "books.csv/enumerated_unique_words": "由实际导出 words.csv 唯一 word_id 数生成；来源是本项目导出，不是双接口枚举。",
  "books.csv/metadata_difference": "total_words_metadata 减 enumerated_unique_words；完整正式版必须为 0。源 PDF 印刷统计差异另记 sources.json。",
  "books.csv/root_count": "root_markups 中全部构词类型的唯一 root_id 总数；真正词根数另在 book.json.statistics 中统计。",
  "words.csv/word_order": "冻结词表的连续顺序，从 1 开始；编译器可根据真实依赖调整学习顺序。",
  "sentence_zones.csv/status": "正式导出的已复核句子区使用 ready；与 words.sentence_zone_status 和子表计数一致。",
  "root_markups.csv/root_type": "枚举 root/prefix/suffix/base；只有有依据的 root 参与排课。",
  "root_markups.csv/meaning": "同一 root_id 的含义与登记表一致；同形异源元素须不同 ID。",
  "root_markups.csv/spelling": "引用构词登记表的展示形式，保留前缀尾连字符、后缀首连字符。",
  "root_markups.csv/root_id": "来自构词登记表的稳定 ID，不得用字母片段自动推断归属。",
  "word_markup_links.csv/target_type": "枚举 word/root/prefix/suffix/base；必须与目标实体一致。",
  "word_markup_links.csv/target_identifier": "与正文 [[identifier|display]] 中的 identifier 完全对应；由解析器生成。",
  "root_markup_links.csv/target_identifier": "与构词正文中的 identifier 完全对应；由解析器生成。",
  "root_markup_links.csv/target_type": "枚举 word/root/prefix/suffix/base；必须与目标实体一致。",
  "relations.csv/relation_type": "枚举 synonym/near_synonym/antonym/derivative；依据真实语义或构词关系编写。",
  "relation_words.csv/relation_type": "继承所属 relations 分组；同一 word_id 与 relation_type 唯一分组。",
  "relation_words.csv/related_word_id": "必须命中本书词表；书外扩展词用普通正文展示，不伪造本书 ID。",
  "long_sentences.csv/sentence": "原创英文长句，包含目标词或正确屈折形式；不是主键，主键为 long_sentence_id。",
  "long_sentences.csv/source_note": "原创句写 cyword_original，并在证据台账注明作者/批次；不得填伪造年份或考卷。",
  "long_sentences.csv/reader_parse_target_ref": "从 0 开始的目标片段索引；必须命中本句 segments，不能引用别句。",
  "long_sentences.csv/target_sense": "本句所用的具体中文义项，与词性、语境和译文一致。",
  "long_sentences.csv/sentence_difficulty": "依据实际复杂度填写，例如 cet4_standard/cet4_upper；是本项目编辑标签，不声称考纲定级。",
  "long_sentence_segments.csv/role": "采用已有角色 subj/pred/obj/attr/adv/appos/ocomp/scomp；无标签时可空但需解释，不捏造句法。",
  "long_sentence_segments.csv/role_label": "对应的中文句法标签；与 role、原句和分析一致。",
  "long_sentence_segments.csv/text": "原句连续片段；按 segment_index 拼接须能还原原句（允许约定的空格归一化）。",
  "long_sentence_segments.csv/level": "非负整数；主层 0，逐层嵌套加 1。",
  "long_sentence_segments.csv/spine": "true/false；按实际主干判断。",
  "long_sentence_analysis.csv/section_kind": "采用现有结构分类 structure/difficulty/target/transfer/culture；按内容选用，文化解释不要求凑数。",
  "long_sentence_analysis.csv/refs_json": "JSON 非负整数数组；每项均为本句有效 segment_index。",
  "long_sentence_analysis.csv/examples_json": "可空或 JSON 二维数组 [[英文,中文],…]；迁移句必须与分析相关。",
  "exam_examples.csv/source_year": "有记录时必填，必须由已核验试卷得出。",
  "exam_examples.csv/source_paper": "有记录时必填，包含年份、月份/考次与套卷信息；证据台账另存 URL 和页码。",
  "exam_examples.csv/source_section": "有记录时必填，注明题型、段落或题号，可回到原文定位。",
  "frequencies.csv/exam_type": "使用 cet4；年份、套卷覆盖、归并与去重规则在语料清单里记录，不拼进考试类型。",
  "frequencies.csv/frequency_count": "由冻结真题语料实际统计，非负整数；没有语料记录时整行缺省，不能用 0 表示未查。",
  "frequencies.csv/per_10k_words": "实际出现次数 / 已声明的有效语料总词数 × 10000；分母与归并规则须可复现。",
  "analysis_seen_marks.csv/raw_json": "该表保持零行；不制造个人查看历史。",
};

function classify(file, field) {
  if (file === "analysis_seen_marks.csv") return ["empty_table", "不生成行", "", "无个人查看历史，保留表头。"];
  if (field.startsWith("protection_") || empty.has(field)) return ["empty", "可空", "", field.startsWith("day_") || field === "order_in_day" ? "不伪造原始 DAY；新学习日由编译器分组生成，多词根词没有唯一学习日。" : "上游私有元数据或个人状态不适用，空字符串；不带凭据、隐藏提示或追踪信息。"];
  if (constants[field]) return ["constant", "有行时必填", constants[field][0], constants[field][1]];
  if (generated.has(field)) return ["computed", "有行时必填", "", "由实际编辑数据、顺序或子表生成，禁止手写统计。所有 index 从 0 开始；word_order 从 1 开始。"];
  if (field.endsWith("_id")) return ["registry", "有行时必填", "", "引用稳定 ID 登记表；主键唯一，所有外键可解析，不能跨书混用。"];
  if (file === "frequencies.csv") return ["computed_from_corpus", "有行时必填", "", "按证据语料计算；未查与零次必须区分。"];
  if (file === "exam_examples.csv") return ["verified_exam_source", "有行时必填", "", "英文摘录及出处必须可核验；翻译与用法讲解原创。无证据不创建行。"];
  if (field === "pronunciation" || field === "audio_url") return ["verified_reference", optional.has(field) ? "可空" : "正式版必填", "", "核实参考来源；不声称来自仅列词形的考纲。"];
  if (field === "spelling" && file === "words.csv") return ["frozen_wordlist", "必填", "", "来自冻结词表 canonical_spelling；变体在编辑台账保存，正文需要时展示。"];
  return ["original_editorial", optional.has(field) ? "可空" : "有行时必填", "", "依据编写规范原创并复核；引用事实记录来源，不从六级复制教学正文。"];
}

for (const file of fs.readdirSync(source).filter((x) => x.endsWith(".csv")).sort()) {
  const header = parse(fs.readFileSync(path.join(source, file), "utf8"), { to: 1, bom: true })[0];
  schemas[file] = { columns: header, primaryKey: oldCatalog.find((x) => x.table_file === file)?.primary_key ?? "table_file", emptyAllowed: !["books.csv", "words.csv", "sentence_zones.csv", "field_dictionary.csv", "table_catalog.csv"].includes(file) };
  for (const field of header) {
    const old = dictionary.find((x) => x.table_file === file && x.field_name === field);
    const [method, required, defaultValue, generic] = classify(file, field);
    const supplementedType = field === "row_count" ? "integer" : file === "field_dictionary.csv" && field === "primary_key" ? "boolean" : "string";
    rules.push({ table_file: file, field_name: field, original_data_type: old?.data_type ?? supplementedType, fill_method: method, required_when: required, default_value: defaultValue, editorial_source_path: `editorial.${file.slice(0, -4)}[].${field}`, rule: specifics[`${file}/${field}`] ?? generic, original_source_path: old?.source_path ?? "", original_description: old?.description ?? "原字典未自描述，本规范补足。" });
  }
}
const columns = Object.keys(rules[0]);
const escape = (s) => /[",\r\n]/.test(String(s)) ? `"${String(s).replaceAll('"', '""')}"` : String(s);
fs.writeFileSync(path.join(output, "field_policy.csv"), [columns, ...rules.map((row) => columns.map((c) => row[c]))].map((row) => row.map(escape).join(",")).join("\n") + "\n");
fs.writeFileSync(path.join(output, "schema.json"), JSON.stringify({ schemaVersion: 1, bookCode: "cet4", originalDictionaryEntries: dictionary.length, actualFieldCount: rules.length, sourceDictionarySha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(source, "field_dictionary.csv"))).digest("hex"), tables: schemas }, null, 2) + "\n");
console.log(JSON.stringify({ tables: Object.keys(schemas).length, fields: rules.length, originalDictionaryEntries: dictionary.length, supplementedSelfDescriptionFields: rules.length - dictionary.length }, null, 2));
