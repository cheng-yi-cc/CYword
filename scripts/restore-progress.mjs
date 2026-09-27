import { parseArgs } from 'node:util';
import { remoteDatabase } from './d1-admin.mjs';
import { restoreAccountSnapshot } from '../website/server/progress-store.ts';
import { unpackProgress } from '../src/progress-compression.ts';
import { canonicalProgress } from '../src/progress-business.ts';
import { progressCatalog, progressProtocol } from '../website/server/progress-curriculum.ts';
import { inspectIncrementalSnapshot, restoreIncrementalSnapshot } from './incremental-recovery.ts';

const {values} = parseArgs({options:{account:{type:'string'},database:{type:'string'},user:{type:'string'},slot:{type:'string'},revision:{type:'string'},protocol:{type:'string',default:'2'},apply:{type:'boolean',default:false}}});
if (!values.account || !values.database || !values.user) throw Error('Required: --account ID --database ID --user ID; default is read-only. To restore: --slot N --revision N --apply');
const db=remoteDatabase(values.account,values.database);
const book=progressProtocol.bookCode;
if(values.protocol==='2'){
 const current=await db.prepare('SELECT revision FROM progress_heads_v2 WHERE user_id=? AND book_code=?').bind(values.user,book).first();
 const snapshots=await db.prepare('SELECT slot,revision,MAX(created_at) created_at,SUM(length(payload)) bytes FROM progress_checkpoints_v2 WHERE user_id=? AND book_code=? GROUP BY slot,revision ORDER BY slot DESC').bind(values.user,book).all();
 console.log(JSON.stringify({database:values.database,protocol:2,currentRevision:current?.revision??null,snapshots:snapshots.results},null,2));
 if(values.slot!==undefined){
  const slot=Number(values.slot),revision=Number(values.revision);
  if(!Number.isSafeInteger(slot)||!Number.isSafeInteger(revision)||revision<1)throw Error('Explicit integer --slot and --revision required');
  const progress=await inspectIncrementalSnapshot(db,values.user,slot);
  if(current?.revision!==revision)throw Error('Revision changed; inspect again before restoring');
  console.log(JSON.stringify({mode:values.apply?'apply':'dry-run',slot,words:Object.keys(progress.words).length,reviewRecords:progress.reviewHistory.length}));
  if(values.apply){const result=await restoreIncrementalSnapshot(db,values.user,slot,revision);console.log(JSON.stringify({restoredRevision:result.revision,archiveId:result.archiveId}));}
 }else if(values.apply)throw Error('--apply requires an explicit slot and revision');
 process.exit(0);
}
if(values.protocol!=='1')throw Error('Unknown protocol');
const current=await db.prepare('SELECT revision FROM learning_progress WHERE user_id = ? AND book_code = ?').bind(values.user,book).first();
const snapshots=await db.prepare('SELECT slot, revision, created_at, length(payload) AS bytes FROM progress_snapshots WHERE user_id = ? AND book_code = ? ORDER BY slot DESC').bind(values.user,book).all();
console.log(JSON.stringify({database:values.database,currentRevision:current?.revision??null,snapshots:snapshots.results},null,2));
if(values.slot!==undefined){
 const slot=Number(values.slot),revision=Number(values.revision);
 if(!Number.isSafeInteger(slot)||!Number.isSafeInteger(revision)||revision<1)throw Error('Explicit integer --slot and --revision required');
 const source=await db.prepare('SELECT payload FROM progress_snapshots WHERE user_id = ? AND book_code = ? AND slot = ?').bind(values.user,book,slot).first();
 if(!source)throw Error('Snapshot not found');
 const progress=canonicalProgress(await unpackProgress(source.payload),progressCatalog);
 if(current?.revision!==revision)throw Error('Revision changed; inspect again before restoring');
 console.log(JSON.stringify({mode:values.apply?'apply':'dry-run',slot,words:Object.keys(progress.words).length,reviewRecords:progress.reviewHistory.length}));
 if(values.apply){const result=await restoreAccountSnapshot(db,values.user,slot,revision);console.log(JSON.stringify({restoredRevision:result.revision,archiveId:result.archiveId}));}
}else if(values.apply)throw Error('--apply requires an explicit slot and revision');
