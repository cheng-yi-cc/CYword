import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

export function loadDrafts(root = process.cwd()) {
  const dir = path.join(root, 'authoring/cet4');
  const read = name => parse(fs.readFileSync(path.join(dir, name), 'utf8'), { columns: true, bom: true });
  const frozen = read('wordlist.csv');
  const bySpelling = new Map(frozen.map(w => [w.canonical_spelling, w]));
  const references = new Map(read('references/lexical.csv').map(w => [w.word_id, w]));
  const supplements = JSON.parse(fs.readFileSync(path.join(dir, 'references/supplements.json'))).items;
  const overrides = JSON.parse(fs.readFileSync(path.join(dir, 'display_overrides.json'))).overrides;
  for (const o of overrides) {
    assert.equal(bySpelling.get(o.frozenSpelling)?.word_id, o.wordId, 'Display override does not match frozen identity');
    assert.ok(o.referenceUrl.startsWith('https://'));
  }
  const display = new Map(overrides.map(o => [o.wordId, o.displaySpelling]));
  const files = fs.readdirSync(path.join(dir, 'content')).filter(f => f.endsWith('.tsv') && !f.endsWith('-reading.tsv')).sort();
  const entries = [];
  const batches = [];
  const glosses = new Map();
  for (const name of ['pilot/reading-glosses.tsv', 'content-glosses.tsv']) {
    const glossFile = path.join(dir, name);
    if (!fs.existsSync(glossFile)) continue;
    for (const row of parse(fs.readFileSync(glossFile, 'utf8'), { columns: true, delimiter: '\t', quote: false })) {
      assert.ok(!glosses.has(row.spelling), `Duplicate reading gloss: ${row.spelling}`);
      assert.ok([0, 1, 2].every(i => row[`gloss${i}`]?.trim()), `Incomplete reading gloss: ${row.spelling}`);
      glosses.set(row.spelling, row);
    }
  }
  for (const file of files) {
    const filePath = path.join(dir, 'content', file);
    const rows = parse(fs.readFileSync(filePath, 'utf8'), { columns: true, delimiter: '\t', quote: false });
    const readingPath = filePath.replace(/\.tsv$/, '-reading.tsv');
    const readings = parse(fs.readFileSync(readingPath, 'utf8'), { columns: true, delimiter: '\t', quote: false });
    const readingBySpelling = new Map(readings.map(r => [r.spelling, r]));
    assert.equal(readingBySpelling.size, readings.length, `Duplicate reading in ${file}`);
    assert.equal(rows.length, readings.length, `Reading coverage differs in ${file}`);
    const batchId = `cet4-draft-${file.slice(0, -4)}`;
    for (const row of rows) {
      const word = bySpelling.get(row.spelling);
      assert.ok(word, `Word outside frozen list: ${row.spelling}`);
      for (const [key, value] of Object.entries(row)) assert.ok(value.trim(), `${row.spelling}.${key} is empty`);
      const reading = readingBySpelling.get(row.spelling);
      assert.ok(reading, `Missing reading: ${row.spelling}`);
      const segments = reading.parts.split('||').map((part, index) => {
        const [role, ...rest] = part.split('::');
        const text = rest.join('::');
        assert.ok(['adv', 'subj', 'pred', 'obj', 'attr'].includes(role), `${row.spelling}: invalid segment role`);
        assert.ok(text.trim(), `${row.spelling}: blank segment`);
        return { index, role, text, ...(glosses.has(row.spelling)?{gloss:glosses.get(row.spelling)[`gloss${index}`]}:{}) };
      });
      const sentence = segments.map(p => p.text).join('');
      assert.equal(segments.length, 3, `${row.spelling}: expected three reading sections`);
      assert.ok(sentence.includes(reading.targetSurface), `${row.spelling}: target absent from reading`);
      assert.ok(reading.translation && reading.analysis, `${row.spelling}: empty reading explanation`);
      const ref = references.get(word.word_id);
      const ownSources = supplements.filter(s => s.spelling === row.spelling).flatMap(s => s.urls);
      assert.ok(ref?.dictionary_headword || ownSources.length, `${row.spelling}: no lexical reference`);
      const forms = new Set([row.spelling.toLowerCase(), display.get(word.word_id)?.toLowerCase(),
        ...(ref?.inflections_reference ?? '').split('/').map(part => part.split(':')[1])].filter(Boolean));
      const containsSurface = (text, form) => {
        const escaped = form.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, 'iu').test(text);
      };
      assert.ok(forms.has(reading.targetSurface.toLowerCase()), `${row.spelling}: undocumented reading inflection`);
      assert.ok(containsSurface(sentence, reading.targetSurface), `${row.spelling}: target not a complete word`);
      // Whole-token matching prevents a/an/act from being "found" only inside another word.
      const tokens = row.example.toLocaleLowerCase('en').match(/[\p{L}]+(?:['’-][\p{L}]+)*/gu) ?? [];
      const found = [...forms].some(form => form.includes(' ') ? containsSurface(row.example, form) : tokens.includes(form));
      assert.ok(found, `${row.spelling}: example does not contain the word or a documented inflection`);
      entries.push({
        wordId: word.word_id, wordOrder: Number(word.word_order), spelling: display.get(word.word_id) ?? row.spelling,
        frozenSpelling: row.spelling, variants: JSON.parse(word.variants_json), batchId,
        pronunciation: row.pronunciation, definitionCn: row.definitionCn, memoryMarkup: row.memoryMarkup,
        notes: row.note, examples: [{ sentence: row.example, translation: row.translation }],
        collocations: [{ phrase: row.collocation, meaning: row.collocationMeaning }],
        longSentences: [{ sentence, translation: reading.translation, targetSurface: reading.targetSurface,
          segments, analysis: reading.analysis, sourceNote: 'cyword_original' }],
        status: 'validated_draft', morphologyStatus: 'not_verified',
        lexicalReference: ref?.dictionary_headword ? `references/lexical.csv#${word.word_id}` : '',
        referenceUrls: ownSources,
      });
    }
    batches.push({ batchId, file: `content/${file}`, words: rows.length, status: 'validated_draft' });
  }
  assert.equal(new Set(entries.map(e => e.wordId)).size, entries.length, 'Duplicate drafted word');
  const draftedSpellings = new Set(entries.map(e => e.frozenSpelling));
  for (const spelling of glosses.keys()) assert.ok(draftedSpellings.has(spelling), `Gloss without drafted word: ${spelling}`);
  return { entries, batches, display };
}

export function expectedDraftProgress(entry) {
  return {
    base_status: 'validated', morphology_status: 'draft', sentences_status: 'draft', exam_status: 'not_started',
    batch_id: entry.batchId, evidence_refs: JSON.stringify([entry.lexicalReference, ...entry.referenceUrls].filter(Boolean)),
    issues: `原创初稿通过结构检查；音标与义项须二次核对；构词尚未登记；${entry.longSentences[0].segments.every(s=>s.gloss)?'长句已补逐段释义':'长句分段未补逐段释义'}；真题与词频无语料。`,
    updated_at: '2026-09-17',
  };
}
