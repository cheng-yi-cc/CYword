import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {signJWT} from '../website/server/auth.ts';
import {progressCatalog} from '../website/server/progress-curriculum.ts';
import {incrementalProtocol} from '../website/server/incremental-schema.ts';
import {emptyProgress,rateSearchWord} from '../src/progress.ts';
import {canonicalProgress} from '../src/progress-business.ts';
import {progressToRecords,recordsToProgress} from '../src/progress-records.ts';
import {fullProgressFixture} from './full-progress-fixture.ts';
import {IncrementalProgressTransport} from '../src/incremental-client.ts';
import {restoreIncrementalSnapshot} from '../scripts/incremental-recovery.ts';
import {commitIncrementalBatch} from '../website/server/incremental-store.ts';

async function fixture(){
 const bundle=await build({stdin:{contents:`import {onRequest} from './website/functions/api/progress-incremental.ts';export default {fetch(request,env){return onRequest({request,env})}}`,resolveDir:process.cwd(),sourcefile:'incremental-worker.ts'},bundle:true,write:false,format:'esm',platform:'browser'});
 const secret='test-only-incremental-secret-at-least-32-characters';
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',d1Databases:['DB'],bindings:{JWT_SECRET:secret}}));
 const db=await mf.getD1Database('DB');
 await db.prepare('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,created_at INTEGER,last_login_at INTEGER,login_count INTEGER)').run();
 const sql=await readFile('website/migrations/0004_incremental_progress.sql','utf8');
 for(const statement of sql.split(';').filter(s=>s.trim()))await db.prepare(statement).run();
 const tokens={};for(const id of ['a','b']){await db.prepare('INSERT INTO users VALUES(?,?,1,1,1)').bind(id,`${id}@example.test`).run();tokens[id]=await signJWT({sub:id,email:`${id}@example.test`},secret);}
 async function request(user,operation){const response=await mf.dispatchFetch('https://example.test/api/progress-incremental',{method:'POST',headers:{Authorization:`Bearer ${tokens[user]??user}`,'Content-Type':'application/json'},body:JSON.stringify({...incrementalProtocol,...operation})});return {status:response.status,data:await response.json()};}
 async function stage(user,revision,records,batchId=crypto.randomUUID()){
  const parts=Math.ceil(records.length/24);
  for(let i=0;i<parts;i++){const r=await request(user,{action:'stage',revision,batchId,part:i,parts,records:records.slice(i*24,i*24+24)});assert.equal(r.status,200,JSON.stringify(r));}
  return batchId;
 }
 async function read(user){let cursor='',revision=0;const records=[];do{const r=await request(user,{action:'read',after:0,cursor});assert.equal(r.status,200,JSON.stringify(r));records.push(...r.data.records);revision=r.data.revision;cursor=r.data.cursor;}while(cursor);return {revision,records,progress:canonicalProgress(recordsToProgress(records),progressCatalog)};}
 return {db,request,stage,read,close:()=>mf.dispose()};
}
const word=progressCatalog.groups[0].wordIds[0];
test('repeated interrupted uploads cannot block the next batch for an hour; staging stays bounded',async()=>{
 const f=await fixture();try{
  const records=[...progressToRecords(canonicalProgress(rateSearchWord(emptyProgress(),word,'unclear'),progressCatalog)).values()];
  const batches=[];
  for(let i=0;i<6;i++){
   batches.push(await f.stage('a',0,records));
   const row=await f.db.prepare('SELECT COUNT(*) count FROM progress_batches_v2 WHERE user_id=?').bind('a').first();
   assert.ok(row.count<=3);
  }
  assert.equal((await f.read('a')).records.length,0);
  assert.equal((await f.request('a',{action:'commit',batchId:batches[0],revision:0})).status,400);
  assert.equal((await f.request('a',{action:'commit',batchId:batches.at(-1),revision:0})).status,200);
  assert.equal((await f.read('a')).progress.words[word].proficiency,'unclear');
 }finally{await f.close();}
});
test('incremental staging is invisible, commit is atomic, retries are idempotent and accounts stay isolated',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('invalid',{action:'read',after:0,cursor:''})).status,401);
  const progress=canonicalProgress(rateSearchWord(emptyProgress(),word,'unclear'),progressCatalog);
  const batchId=await f.stage('a',0,[...progressToRecords(progress).values()]);
  assert.equal((await f.read('a')).records.length,0);
  const commit=()=>f.request('a',{action:'commit',batchId,revision:0});
  assert.equal((await commit()).status,200);
  assert.deepEqual((await f.read('a')).progress,progress);
  assert.equal((await commit()).data.revision,1);
  assert.equal((await f.read('b')).records.length,0);
  const checkpoint=await f.db.prepare('SELECT payload FROM progress_checkpoints_v2 WHERE user_id=?').bind('a').all();
  assert.deepEqual(canonicalProgress(recordsToProgress(checkpoint.results.flatMap(r=>JSON.parse(r.payload))),progressCatalog),progress);
 }finally{await f.close();}
});
test('concurrent staged batches cannot overwrite a newer committed revision',async()=>{
 const f=await fixture();try{
  const a=canonicalProgress(rateSearchWord(emptyProgress(),word,'mastered'),progressCatalog),b=canonicalProgress(rateSearchWord(emptyProgress(),word,'unmastered'),progressCatalog);
  const aa=await f.stage('a',0,[...progressToRecords(a).values()]),bb=await f.stage('a',0,[...progressToRecords(b).values()]);
  assert.equal((await f.request('a',{action:'commit',batchId:aa,revision:0})).status,200);
  assert.equal((await f.request('a',{action:'commit',batchId:bb,revision:0})).status,409);
  assert.equal((await f.read('a')).progress.words[word].proficiency,'mastered');
 }finally{await f.close();}
});
test('full-book bounded records commit with exact history; missing prerequisites are rejected without visible partial data',async()=>{
 const f=await fixture();try{
  const full=fullProgressFixture(progressCatalog),records=[...progressToRecords(full).values()];
  const invalid=await f.stage('a',0,records.filter(r=>r.id!==`w/${word}`));
  assert.equal((await f.request('a',{action:'commit',batchId:invalid,revision:0})).status,400);
  assert.equal((await f.read('a')).records.length,0);
  const valid=await f.stage('a',0,records);
  assert.equal((await f.request('a',{action:'commit',batchId:valid,revision:0})).status,200);
  const actual=await f.read('a');assert.equal(actual.revision,1);assert.deepEqual(actual.progress,full);
  const stats=await f.db.prepare('SELECT SUM(queued) queued,SUM(reviewed) reviewed FROM progress_review_stats_v2 WHERE user_id=?').bind('a').first();
  assert.equal(stats.queued,full.reviewHistory.length);assert.equal(stats.reviewed,full.reviewHistory.length);
  const changed=structuredClone(records.find(r=>r.id===`w/${word}`));
  changed.value.word.proficiency='mastered';changed.value.word.ratingVersion.counter++;
  const batchId=await f.stage('a',1,[changed]);let transaction;
  const measured={prepare:sql=>f.db.prepare(sql),batch:async statements=>{transaction=await f.db.batch(statements);return transaction;}};
  assert.equal((await commitIncrementalBatch(measured,'a',batchId,1)).status,200);
  assert.equal(transaction[2].meta.changes,0,'rerating must not rewrite every learning-day counter');
  assert.equal(transaction[3].meta.changes,0,'rerating must not rewrite every review-day counter');
 }finally{await f.close();}
});

test('production incremental transport recovers a lost commit response and uploads only the changed word',async()=>{
 const f=await fixture();try{
  let loseCommit=false;const calls=[];
  const transport=new IncrementalProgressTransport(progressCatalog,async op=>{
   calls.push(structuredClone(op)); const response=await f.request('a',op);
   if(loseCommit&&op.action==='commit'){loseCommit=false;throw Error('response lost after persistence');}
   return response;
  });
  let initial=await transport.request();
  const original=canonicalProgress(rateSearchWord(emptyProgress(),word,'mastered'),progressCatalog);
  loseCommit=true;
  await assert.rejects(transport.request({revision:0,progress:original}),/response lost/);
  initial=await transport.request();assert.equal(initial.data.revision,1);assert.deepEqual(initial.data.progress,original);
  const updated=canonicalProgress(rateSearchWord(initial.data.progress,word,'unmastered'),progressCatalog);
  calls.length=0;const result=await transport.request({revision:1,progress:updated});
  assert.equal(result.status,200);assert.equal(result.data.progress.words[word].proficiency,'unmastered');
  assert.equal(calls.filter(c=>c.action==='stage').flatMap(c=>c.records).length,1);
  assert.equal((await transport.request(undefined,result.data.revision)).status,304);
 }finally{await f.close();}
});

test('missing parts and changed retries cannot expose incomplete batches',async()=>{
 const f=await fixture();try{
  const records=[...progressToRecords(canonicalProgress(rateSearchWord(emptyProgress(),word,'unclear'),progressCatalog)).values()];
  const batchId=crypto.randomUUID();
  const op={action:'stage',batchId,revision:0,part:0,parts:2,records};
  assert.equal((await f.request('a',op)).status,200);
  assert.equal((await f.request('a',op)).status,200);
  const changed=structuredClone(op);changed.records.find(r=>r.id===`w/${word}`).value.word.proficiency='mastered';
  assert.equal((await f.request('a',changed)).status,400);
  assert.equal((await f.request('a',{action:'commit',batchId,revision:0})).status,400);
  assert.equal((await f.read('a')).records.length,0);
 }finally{await f.close();}
});

test('account recovery archives corrupt bytes, advances revision and is readable by a cached client',async()=>{
 const f=await fixture();try{
  const client=new IncrementalProgressTransport(progressCatalog,op=>f.request('a',op));
  await client.request();
  const original=canonicalProgress(rateSearchWord(emptyProgress(),word,'unclear'),progressCatalog);
  const first=await client.request({revision:0,progress:original});assert.equal(first.status,200);
  const slot=(await f.db.prepare('SELECT slot FROM progress_checkpoints_v2 WHERE user_id=? LIMIT 1').bind('a').first()).slot;
  const b=await f.stage('b',0,[...progressToRecords(original).values()]);await f.request('b',{action:'commit',batchId:b,revision:0});
  await assert.rejects(f.db.prepare('UPDATE progress_records_v2 SET value=? WHERE user_id=? AND record_id=?').bind('{broken','a',`w/${word}`).run(),/CHECK constraint/);
  await f.db.prepare('UPDATE progress_records_v2 SET value=? WHERE user_id=? AND record_id=?').bind('{"corrupt":true}','a',`w/${word}`).run();
  await assert.rejects(restoreIncrementalSnapshot(f.db,'a',slot,99),/已改变/);
  const result=await restoreIncrementalSnapshot(f.db,'a',slot,1);assert.equal(result.revision,2);
  const read=await client.request();assert.equal(read.status,200);assert.equal(read.data.progress.words[word].proficiency,'unclear');
  assert.equal(read.data.progress.words[word].ratingVersion.counter>0,true);
  const archive=await f.db.prepare('SELECT payload FROM progress_recovery_archive_v2 WHERE archive_id=?').bind(result.archiveId).all();
  assert.equal(archive.results.flatMap(r=>JSON.parse(r.payload)).find(r=>r.id===`w/${word}`).raw,'{"corrupt":true}');
  assert.deepEqual((await f.read('b')).progress,original);
 }finally{await f.close();}
});

test('pagination catches concurrent changes behind the cursor and discards incomplete failed reads',async()=>{
 const f=await fixture();try{
  let progress=emptyProgress();
  for(const id of [...new Set(progressCatalog.groups.flatMap(g=>g.wordIds))].slice(0,70)) progress=rateSearchWord(progress,id,'unclear');
  progress=canonicalProgress(progress,progressCatalog);
  const batch=await f.stage('a',0,[...progressToRecords(progress).values()]);await f.request('a',{action:'commit',batchId:batch,revision:0});
  let interrupt=true,changed=false;
  const firstWord=[...progressToRecords(progress).values()].find(r=>r.id.startsWith('w/'));
  const client=new IncrementalProgressTransport(progressCatalog,async op=>{
   if(interrupt&&op.action==='read'&&op.cursor){interrupt=false;return {status:503,data:{error:'interrupted page'}};}
   const response=await f.request('a',op);
   if(!changed&&op.action==='read'&&!op.cursor){
    changed=true;const record=structuredClone(firstWord);record.value.word.proficiency='mastered';
    const newer=await f.stage('a',1,[record]);assert.equal((await f.request('a',{action:'commit',batchId:newer,revision:1})).status,200);
   }
   return response;
  });
  assert.equal((await client.request()).status,503);
  const read=await client.request();assert.equal(read.status,200);assert.equal(read.data.revision,2);
  assert.equal(read.data.progress.words[firstWord.id.slice(2)].proficiency,'mastered');
  assert.equal(Object.keys(read.data.progress.words).length,70);
  // A separate cold reader observes a successful revision change across pages.
  let changedAgain=false;
  const racing=new IncrementalProgressTransport(progressCatalog,async op=>{
   const response=await f.request('a',op);
   if(!changedAgain&&op.action==='read'&&!op.cursor){
    changedAgain=true;const record=structuredClone(firstWord);record.value.word.proficiency='unmastered';
    const newer=await f.stage('a',2,[record]);await f.request('a',{action:'commit',batchId:newer,revision:2});
   }
   return response;
  });
  const caught=await racing.request();assert.equal(caught.status,200);assert.equal(caught.data.revision,3);
  assert.equal(caught.data.progress.words[firstWord.id.slice(2)].proficiency,'unmastered');
 }finally{await f.close();}
});
