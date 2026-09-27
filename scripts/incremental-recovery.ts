import { canonicalProgress } from '../src/progress-business.ts';
import { progressToRecords, recordsToProgress } from '../src/progress-records.ts';
import { progressCatalog, progressProtocol } from '../website/server/progress-curriculum.ts';
import { validateIncrementalRecord } from '../website/server/incremental-schema.ts';

const book = progressProtocol.bookCode;
export async function inspectIncrementalSnapshot(db: D1Database, user: string, slot: number) {
  const source = await db.prepare('SELECT payload FROM progress_checkpoints_v2 WHERE user_id=? AND book_code=? AND slot=? ORDER BY bucket').bind(user,book,slot).all<{payload:string}>();
  if (!source.results.length) throw new Error('未找到该账号的恢复快照');
  const records = source.results.flatMap(row => JSON.parse(row.payload)).filter(record => record.value !== null);
  return canonicalProgress(recordsToProgress(records), progressCatalog);
}

/** Operator-only, single-account restoration. Staging is private until one CAS
 * transaction archives exact old bytes, replaces records and rebuilds counters. */
export async function restoreIncrementalSnapshot(db: D1Database, user: string, slot: number, expected: number) {
  if (!user || !Number.isSafeInteger(slot) || !Number.isSafeInteger(expected) || expected < 1) throw new Error('恢复参数无效');
  const restored = await inspectIncrementalSnapshot(db,user,slot);
  const current = await db.batch([
    db.prepare('SELECT revision FROM progress_heads_v2 WHERE user_id=? AND book_code=?').bind(user,book),
    db.prepare('SELECT record_id,value FROM progress_records_v2 WHERE user_id=? AND book_code=?').bind(user,book),
  ]);
  if (Number((current[0].results[0] as any)?.revision) !== expected) throw new Error('恢复期间进度已改变，请重新核对');
  const versions = new Map<string, any>();
  for (const row of current[1].results as any[]) {
    try { versions.set(row.record_id,JSON.parse(row.value)); } catch { /* exact bytes are archived below */ }
  }
  const archiveId=crypto.randomUUID(), actor=`recovery-${archiveId}`, now=Date.now();
  const increment=(...values: unknown[])=>{
    const value=Math.max(0,...values.filter(v=>Number.isSafeInteger(v)&&Number(v)>=0) as number[])+1;
    if(!Number.isSafeInteger(value))throw new Error('恢复版本超出范围');return value;
  };
  for(const [id,word] of Object.entries(restored.words)) word.ratingVersion={actor,counter:increment(word.ratingVersion?.counter,versions.get(`w/${id}`)?.word?.ratingVersion?.counter)};
  for(const rating of restored.reviewHistory) rating.ratingVersion={actor,counter:increment(rating.ratingVersion?.counter,versions.get(`w/${rating.wordId}`)?.reviews?.[rating.planDay]?.rating?.ratingVersion?.counter)};
  const records=[...progressToRecords(restored).values()].map(validateIncrementalRecord);
  await db.prepare('INSERT INTO progress_batches_v2(user_id,book_code,batch_id,base_revision,part_count,created_at) VALUES(?,?,?,?,?,?)')
    .bind(user,book,archiveId,expected,1,now).run();
  const chunks=[];
  for(let start=0;start<records.length;start+=64) chunks.push(db.prepare(`INSERT INTO progress_staging_v2(user_id,book_code,batch_id,record_id,value,first_day,learned,reviews,bucket)
    SELECT ?1,?2,?3,json_extract(value,'$.record_id'),json_extract(value,'$.value'),json_extract(value,'$.first_day'),json_extract(value,'$.learned'),json_extract(value,'$.reviews'),json_extract(value,'$.bucket') FROM json_each(?4)`)
    .bind(user,book,archiveId,JSON.stringify(records.slice(start,start+64))));
  for(let i=0;i<chunks.length;i+=6)await db.batch(chunks.slice(i,i+6));
  const guard='EXISTS(SELECT 1 FROM progress_heads_v2 WHERE user_id=?1 AND book_code=?2 AND last_batch=?3)';
  const result=await db.batch([
    db.prepare('UPDATE progress_heads_v2 SET revision=revision+1,last_batch=?3,updated_at=?5 WHERE user_id=?1 AND book_code=?2 AND revision=?4').bind(user,book,archiveId,expected,now),
    // Store raw strings, including malformed JSON, without interpreting them.
    db.prepare(`INSERT INTO progress_recovery_archive_v2(archive_id,user_id,book_code,revision,archived_at,bucket,payload)
      SELECT ?3,?1,?2,?4,?5,bucket,json_group_array(json_object('id',record_id,'raw',value)) FROM progress_records_v2
      WHERE user_id=?1 AND book_code=?2 AND ${guard} GROUP BY bucket`).bind(user,book,archiveId,expected,now),
    // Tombstones let already-open clients discard cache entries absent in a backup.
    db.prepare(`UPDATE progress_records_v2 SET value='null',revision=?4,first_day=0,learned=0,reviews='{}' WHERE user_id=?1 AND book_code=?2 AND ${guard}
      AND NOT EXISTS(SELECT 1 FROM progress_staging_v2 s WHERE s.user_id=?1 AND s.book_code=?2 AND s.batch_id=?3 AND s.record_id=progress_records_v2.record_id)`).bind(user,book,archiveId,expected+1),
    db.prepare(`INSERT INTO progress_records_v2(user_id,book_code,record_id,value,revision,first_day,learned,reviews,bucket)
      SELECT ?1,?2,record_id,value,?4,first_day,learned,reviews,bucket FROM progress_staging_v2 WHERE user_id=?1 AND book_code=?2 AND batch_id=?3 AND ${guard}
      ON CONFLICT(user_id,book_code,record_id) DO UPDATE SET value=excluded.value,revision=excluded.revision,first_day=excluded.first_day,learned=excluded.learned,reviews=excluded.reviews,bucket=excluded.bucket`).bind(user,book,archiveId,expected+1),
    db.prepare(`DELETE FROM progress_learning_stats_v2 WHERE user_id=?1 AND book_code=?2 AND ${guard}`).bind(user,book,archiveId),
    db.prepare(`DELETE FROM progress_review_stats_v2 WHERE user_id=?1 AND book_code=?2 AND ${guard}`).bind(user,book,archiveId),
    db.prepare(`INSERT INTO progress_learning_stats_v2(user_id,book_code,first_day,marked)
      SELECT ?1,?2,first_day,SUM(learned) FROM progress_records_v2 WHERE user_id=?1 AND book_code=?2 AND first_day>0 AND ${guard} GROUP BY first_day`).bind(user,book,archiveId),
    db.prepare(`INSERT INTO progress_review_stats_v2(user_id,book_code,day,queued,reviewed,skipped)
      SELECT ?1,?2,CAST(j.key AS INTEGER),SUM(json_extract(j.value,'$.queued')),SUM(json_extract(j.value,'$.reviewed')),SUM(json_extract(j.value,'$.skipped'))
      FROM progress_records_v2 r,json_each(r.reviews) j WHERE r.user_id=?1 AND r.book_code=?2 AND ${guard} GROUP BY j.key`).bind(user,book,archiveId),
    db.prepare(`DELETE FROM progress_batches_v2 WHERE user_id=?1 AND book_code=?2 AND batch_id=?3 AND ${guard}`).bind(user,book,archiveId),
  ]);
  if(!result[0].meta.changes)throw new Error('恢复期间进度已改变，未覆盖其他写入');
  return {archiveId,revision:expected+1,progress:restored};
}
