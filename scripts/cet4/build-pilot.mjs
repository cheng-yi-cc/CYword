import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { loadDrafts } from './draft-lib.mjs';
import { loadStage2,validateSource,buildSample,serializeCsv,extractMarkup,readCsv } from './stage2-lib.mjs';
import { validateDependencies } from './dependency-graph.mjs';

const dir='authoring/cet4/pilot';
const policy=JSON.parse(fs.readFileSync(`${dir}/policy.json`));
const data=loadStage2();
const context=validateSource(data);
assert.equal(fs.readFileSync('authoring/shared/morphemes.csv','utf8'),fs.readFileSync('authoring/cet4/morpheme_registry.csv','utf8'),'Stale shared registry projection');
const notes=parse(fs.readFileSync(`${dir}/reading-glosses.tsv`,'utf8'),{columns:true,delimiter:'\t',quote:false});
assert.equal(notes.length,70);
const drafts=new Map(loadDrafts().entries.map(e=>[e.spelling,e]));
const entries=context.entries.map(e=>structuredClone(e));
for(const note of notes){
  const e=structuredClone(drafts.get(note.spelling));assert.ok(e,`Missing draft ${note.spelling}`);
  const x=e.longSentences[0];
  const targetSegment=x.segments.findIndex(s=>s.text.toLowerCase().includes(x.targetSurface.toLowerCase()));
  entries.push({...e,
    etymologyMarkup:note.prerequisite?`本条先联系 [[word:${note.prerequisite}|${note.prerequisite}]] 的完整词形和含义学习。这里只登记学习联系，历史构词尚待进一步核查。`:'本条先按完整词形学习，当前没有登记经过核查的细分词根。',
    rootAffixNotes:e.notes+' 本条暂按整体学习处理，未登记词根不表示历史上不可分析。',rootAffixAccumulation:'',morphemes:[],relations:[],
    examples:e.examples.map(example=>({...example,matchedSurface:e.spelling,contextExplanation:e.notes,difficultyRationale:'采用日常或校园语境，覆盖所列常用义。'})),
    collocations:e.collocations.map(c=>({...c,example:''})),
    longSentences:[{...x,difficultyBand:'四级试验集',sentenceDifficulty:'cet4_standard',targetSense:e.definitionCn,targetSegment,
      segments:x.segments.map((s,i)=>({...s,roleLabel:{adv:'状语部分',subj:'主语',pred:'谓语部分'}[s.role],gloss:note[`gloss${i}`],level:s.role==='adv'?1:0,spine:s.role!=='adv'})),
      analyses:[{sectionKind:'structure',dimension:'句子结构',keyword:'主干与修饰',refs:[0,1,2],analysisText:x.analysis},
        {sectionKind:'target',dimension:'目标词',keyword:x.targetSurface,refs:[targetSegment],analysisText:e.notes}]}],
    evidenceRefs:[e.lexicalReference],
  });
}
assert.equal(entries.length,policy.expectedWords);
const entryBySpelling=new Map(entries.map(e=>[e.spelling.toLowerCase(),e]));
assert.equal(entryBySpelling.size,entries.length);
const edges=[];
for(const [word,prerequisite]of [...Object.entries(policy.sampleDependencies),...notes.filter(n=>n.prerequisite).map(n=>[n.spelling,n.prerequisite])]){
  const e=entryBySpelling.get(word),p=entryBySpelling.get(prerequisite);assert.ok(e&&p);
  edges.push({word_id:e.wordId,spelling:word,prerequisite_word_id:p.wordId,prerequisite_spelling:prerequisite,
    relation:'learning_prerequisite',evidence:'人工核对巧记及教学顺序；不表示词源关系。'});
}
validateDependencies(entries.map(e=>e.wordId),edges);
const wordIds=new Set(entries.map(e=>e.wordId));
for(const e of entries){
  assert.ok(e.definitionCn&&e.memoryMarkup&&e.pronunciation);
  for(const field of ['memoryMarkup','etymologyMarkup','rootAffixNotes','rootAffixAccumulation'])for(const link of extractMarkup(e[field])){
    if(link.identifier.startsWith('word:'))assert.ok(entryBySpelling.has(link.identifier.slice(5).toLowerCase()),`Unresolved link ${link.identifier}`);
    else assert.ok(context.morphemeByKey.has(link.identifier),`Unknown morpheme ${link.identifier}`);
  }
  for(const x of e.longSentences){
    assert.equal(x.segments.map(s=>s.text).join(''),x.sentence);
    for(const s of x.segments)assert.ok(s.gloss?.trim(),`Missing gloss ${e.spelling}`);
    assert.ok(x.segments[x.targetSegment]?.text.toLowerCase().includes(x.targetSurface.toLowerCase()));
  }
}
const built=buildSample(data,{...context,entries,entryBySpelling});
built.book.name='大学英语四级（100 词试验集 · 含待复核初稿）';
built.book.contentScope='editorial_trial';
built.book.contentStatus=policy.review;
built.book.dependencies=edges.map(e=>({wordId:e.word_id,prerequisiteWordId:e.prerequisite_word_id}));
built.book.planning.note='仅供试验，未冻结正式学习天数。';
built.book.planning.minimumWordsPerRootStudyGroup=2;
for(const row of built.tables['words.csv']){row.book_name=built.book.name;row.detail_status='editorial_trial';}
for(const row of built.tables['books.csv']){row.book_name=built.book.name;row.lifecycle_status='editorial_trial';}
const out='.work/cet4/pilot-book';fs.mkdirSync(`${out}/csv`,{recursive:true});
fs.writeFileSync(`${out}/book.json`,JSON.stringify(built.book,null,2)+'\n');
for(const name of built.book.canonicalFiles)fs.writeFileSync(`${out}/csv/${name}`,serializeCsv(data.schema.tables[name].columns,built.tables[name]));
fs.writeFileSync(`${dir}/dependencies.csv`,serializeCsv(Object.keys(edges[0]),edges));
fs.writeFileSync(`${dir}/entries.json`,JSON.stringify({schemaVersion:1,status:'editorial_trial',entries},null,2)+'\n');
fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify({schemaVersion:1,words:entries.length,existingReviewedSamples:30,drafts:70,
  readingSegments:entries.reduce((n,e)=>n+e.longSentences[0].segments.length,0),dependencies:edges.length,
  completeBook:false,morphologyReviewedWords:30,contentStatus:policy.review},null,2)+'\n');
console.log({words:wordIds.size,dependencies:edges.length,output:out,completeBook:false});
