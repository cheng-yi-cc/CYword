import { incrementalProtocol, maximumRecords, reviews, validateIncrementalRecord, wireRecord, IncrementalInputError } from './incremental-schema.ts';

const book = incrementalProtocol.bookCode;
const expected = reviews.map(day => `(${day.day},${day.reviewWordIds!.length})`).join(',');
// Every request binds its authenticated account. These small SQL aggregates keep
// cross-record verification inside D1 rather than a full-book JavaScript parse.
const projected = `WITH
 pending AS (SELECT * FROM progress_staging_v2 WHERE user_id=?1 AND book_code=?2 AND batch_id=?3),
 original AS (SELECT r.* FROM progress_records_v2 r JOIN pending p USING(record_id) WHERE r.user_id=?1 AND r.book_code=?2),
 learning_delta AS (SELECT first_day,SUM(marked) marked FROM (
   SELECT first_day,learned marked FROM pending WHERE first_day>0 UNION ALL
   SELECT first_day,-learned FROM original WHERE first_day>0) GROUP BY first_day),
 next_learning AS (SELECT first_day,SUM(marked) marked FROM (
   SELECT first_day,marked FROM progress_learning_stats_v2 WHERE user_id=?1 AND book_code=?2 UNION ALL
   SELECT first_day,marked FROM learning_delta) GROUP BY first_day),
 review_delta AS (SELECT day,SUM(queued) queued,SUM(reviewed) reviewed,SUM(skipped) skipped FROM (
   SELECT CAST(j.key AS INTEGER) day,json_extract(j.value,'$.queued') queued,json_extract(j.value,'$.reviewed') reviewed,json_extract(j.value,'$.skipped') skipped FROM pending p,json_each(p.reviews) j
   UNION ALL SELECT CAST(j.key AS INTEGER),-json_extract(j.value,'$.queued'),-json_extract(j.value,'$.reviewed'),-json_extract(j.value,'$.skipped') FROM original o,json_each(o.reviews) j) GROUP BY day),
 next_reviews AS (SELECT day,SUM(queued) queued,SUM(reviewed) reviewed,SUM(skipped) skipped FROM (
   SELECT day,queued,reviewed,skipped FROM progress_review_stats_v2 WHERE user_id=?1 AND book_code=?2 UNION ALL
   SELECT day,queued,reviewed,skipped FROM review_delta) GROUP BY day),
 markers AS (SELECT record_id,value FROM pending WHERE record_id LIKE 'd/%' UNION ALL
   SELECT record_id,value FROM progress_records_v2 r WHERE user_id=?1 AND book_code=?2 AND record_id LIKE 'd/%' AND NOT EXISTS(SELECT 1 FROM pending p WHERE p.record_id=r.record_id)),
 expected(day,scope) AS (VALUES ${expected})`;

const businessValid = `
 NOT EXISTS(SELECT 1 FROM next_learning WHERE marked<0) AND
 NOT EXISTS(SELECT 1 FROM next_reviews WHERE queued<0 OR reviewed<0 OR skipped<0 OR reviewed>queued) AND
 NOT EXISTS(SELECT 1 FROM next_reviews r WHERE r.queued+r.skipped>0 AND NOT EXISTS(SELECT 1 FROM markers m WHERE m.record_id=printf('d/%02d',r.day))) AND
 NOT EXISTS(SELECT 1 FROM expected e JOIN markers m ON m.record_id=printf('d/%02d',e.day)
   LEFT JOIN next_reviews r ON r.day=e.day WHERE
   COALESCE((SELECT SUM(marked) FROM next_learning WHERE first_day<e.day),0)<>e.scope OR
   COALESCE(r.queued+r.skipped,0)<>e.scope OR
   (r.skipped>0 AND json_extract(m.value,'$.skipMastered')<>1) OR
   (COALESCE(r.queued,0)=0 AND COALESCE(json_extract(m.value,'$.emptyReviewConfirmed'),0)<>1) OR
   EXISTS(SELECT 1 FROM expected prior LEFT JOIN markers pm ON pm.record_id=printf('d/%02d',prior.day)
     LEFT JOIN next_reviews pr ON pr.day=prior.day WHERE prior.day<e.day AND
     (pm.record_id IS NULL OR COALESCE(pr.queued+pr.skipped,0)<>prior.scope OR COALESCE(pr.reviewed,0)<>COALESCE(pr.queued,0)
       OR (COALESCE(pr.queued,0)=0 AND COALESCE(json_extract(pm.value,'$.emptyReviewConfirmed'),0)<>1)))) AND
 NOT EXISTS(SELECT 1 FROM pending p,json_each(p.value,'$.exposures') x WHERE NOT EXISTS(SELECT 1 FROM markers m WHERE m.record_id=printf('d/%02d',CAST(x.key AS INTEGER)) AND json_extract(m.value,'$.kind')='study')) AND
 NOT EXISTS(SELECT 1 FROM original o JOIN pending p USING(record_id) WHERE o.learned>p.learned OR
   COALESCE(json_extract(o.value,'$.word.ratingVersion.counter'),0)>COALESCE(json_extract(p.value,'$.word.ratingVersion.counter'),0) OR
   json_extract(o.value,'$.word.learnedAt')<json_extract(p.value,'$.word.learnedAt')) AND
 NOT EXISTS(SELECT 1 FROM original o JOIN pending p USING(record_id),json_each(o.value,'$.exposures') d,json_each(d.value) x
   WHERE NOT EXISTS(SELECT 1 FROM json_each(p.value,'$.exposures') nd,json_each(nd.value) nx WHERE nd.key=d.key AND nx.value=x.value)) AND
 NOT EXISTS(SELECT 1 FROM original o JOIN pending p USING(record_id),json_each(o.value,'$.reviews') old
   LEFT JOIN json_each(p.value,'$.reviews') new ON new.key=old.key WHERE new.key IS NULL OR
   json_extract(old.value,'$.queued')>json_extract(new.value,'$.queued') OR
   (json_type(old.value,'$.rating') IS NOT NULL AND json_type(new.value,'$.rating') IS NULL) OR
   COALESCE(json_extract(old.value,'$.rating.ratingVersion.counter'),0)>COALESCE(json_extract(new.value,'$.rating.ratingVersion.counter'),0))`;

const committed = `EXISTS(SELECT 1 FROM progress_heads_v2 WHERE user_id=?1 AND book_code=?2 AND last_batch=?3)`;
export async function incrementalHead(db: D1Database, user: string) {
  return await db.prepare('SELECT revision,last_batch FROM progress_heads_v2 WHERE user_id=? AND book_code=?').bind(user,book).first<{revision:number;last_batch:string|null}>() ?? {revision:0,last_batch:null};
}

export async function readIncrementalPage(db: D1Database, user: string, after: number, cursor: string) {
  // Initial full reads use the primary-key order and visit only the next page,
  // instead of sorting every remaining row again through the revision index.
  const index = after === 0 ? ' INDEXED BY sqlite_autoindex_progress_records_v2_1' : '';
  const batch = await db.batch([
    db.prepare('SELECT revision FROM progress_heads_v2 WHERE user_id=? AND book_code=?').bind(user,book),
    db.prepare(`SELECT record_id,value,revision FROM progress_records_v2${index} WHERE user_id=? AND book_code=? AND revision>? AND record_id>? ORDER BY record_id LIMIT 33`).bind(user,book,after,cursor),
  ]);
  const rows = batch[1].results as unknown as Array<{record_id:string;value:string;revision:number}>;
  const more = rows.length > 32, page = rows.slice(0,32);
  return { revision: Number((batch[0].results[0] as {revision?:number}|undefined)?.revision ?? 0), records: page.map(wireRecord), cursor: more ? page.at(-1)!.record_id : null };
}

export async function stageIncrementalPart(db: D1Database, user: string, body: { batchId:string;revision:number;part:number;parts:number;records:unknown[] }) {
  const records = body.records.map(validateIncrementalRecord);
  if (new Set(records.map(r=>r.record_id)).size !== records.length) throw new IncrementalInputError('增量批次含重复记录');
  const serialized = JSON.stringify(records), now = Date.now();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const result = await db.batch([
    db.prepare(`DELETE FROM progress_batches_v2 WHERE user_id=?1 AND book_code=?2 AND (created_at<?3 OR
      base_revision<(SELECT revision FROM progress_heads_v2 WHERE user_id=?1 AND book_code=?2))`).bind(user,book,now-3_600_000),
    db.prepare('INSERT INTO progress_heads_v2(user_id,book_code) VALUES(?,?) ON CONFLICT DO NOTHING').bind(user,book),
    // Failed requests can leave incomplete batches. Make room for a fresh retry
    // without making its locally durable records wait for the one-hour expiry.
    // Existing-part retries never evict another batch; committed data is untouched.
    db.prepare(`DELETE FROM progress_batches_v2 WHERE user_id=?1 AND book_code=?2
      AND EXISTS(SELECT 1 FROM progress_heads_v2 WHERE user_id=?1 AND book_code=?2 AND revision=?4)
      AND NOT EXISTS(SELECT 1 FROM progress_batches_v2 WHERE user_id=?1 AND book_code=?2 AND batch_id=?3)
      AND batch_id IN (SELECT batch_id FROM progress_batches_v2 WHERE user_id=?1 AND book_code=?2
        ORDER BY created_at DESC,batch_id DESC LIMIT -1 OFFSET 2)`).bind(user,book,body.batchId,body.revision),
    db.prepare(`INSERT INTO progress_batches_v2(user_id,book_code,batch_id,base_revision,part_count,created_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM progress_heads_v2 WHERE user_id=? AND book_code=? AND revision=?)
      AND (SELECT COUNT(*) FROM progress_batches_v2 WHERE user_id=? AND book_code=?)<3 ON CONFLICT DO NOTHING`)
      .bind(user,book,body.batchId,body.revision,body.parts,now,user,book,body.revision,user,book),
    db.prepare(`INSERT INTO progress_parts_v2(user_id,book_code,batch_id,part,digest,record_count)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM progress_batches_v2 WHERE user_id=? AND book_code=? AND batch_id=? AND base_revision=? AND part_count=?) ON CONFLICT DO NOTHING`)
      .bind(user,book,body.batchId,body.part,digest,records.length,user,book,body.batchId,body.revision,body.parts),
    db.prepare(`INSERT INTO progress_staging_v2(user_id,book_code,batch_id,record_id,value,first_day,learned,reviews,bucket)
      SELECT ?1,?2,?3,json_extract(j.value,'$.record_id'),json_extract(j.value,'$.value'),json_extract(j.value,'$.first_day'),json_extract(j.value,'$.learned'),json_extract(j.value,'$.reviews'),json_extract(j.value,'$.bucket')
      FROM json_each(?4) j WHERE EXISTS(SELECT 1 FROM progress_parts_v2 WHERE user_id=?1 AND book_code=?2 AND batch_id=?3 AND part=?5 AND digest=?6) ON CONFLICT DO NOTHING`)
      .bind(user,book,body.batchId,serialized,body.part,digest),
    db.prepare('SELECT digest FROM progress_parts_v2 WHERE user_id=? AND book_code=? AND batch_id=? AND part=?').bind(user,book,body.batchId,body.part),
  ]);
  if ((result[6].results[0] as {digest?:string}|undefined)?.digest !== digest) {
    const head=await incrementalHead(db,user);
    if(head.revision!==body.revision)return {status:409,revision:head.revision};
    throw new IncrementalInputError('增量批次冲突或暂存空间已满，请重试');
  }
  return {status:200,revision:body.revision};
}

export async function commitIncrementalBatch(db:D1Database,user:string,batchId:string,revision:number){
  const head=await incrementalHead(db,user);
  if(head.last_batch===batchId)return {status:200,revision:head.revision};
  if(head.revision!==revision)return {status:409,revision:head.revision};
  const now=Date.now(),slot=Math.floor(now/3_600_000);
  const snapshot=(savedRevision:number)=>db.prepare(`INSERT INTO progress_checkpoints_v2(user_id,book_code,slot,revision,created_at,bucket,payload)
    SELECT ?1,?2,?4,?6,?5,r.bucket,json_group_array(json_object('id',r.record_id,'value',json(r.value))) FROM progress_records_v2 r
    WHERE r.user_id=?1 AND r.book_code=?2 AND ${committed}
    AND NOT EXISTS(SELECT 1 FROM progress_checkpoints_v2 WHERE user_id=?1 AND book_code=?2 AND slot=?4)
    GROUP BY r.bucket`).bind(user,book,batchId,slot,now,savedRevision);
  const result=await db.batch([
    db.prepare(`${projected} UPDATE progress_heads_v2 SET revision=revision+1,last_batch=?3,updated_at=?5
      WHERE user_id=?1 AND book_code=?2 AND revision=?4 AND ${businessValid}
      AND EXISTS(SELECT 1 FROM progress_batches_v2 b WHERE user_id=?1 AND book_code=?2 AND batch_id=?3 AND base_revision=?4
        AND part_count=(SELECT COUNT(*) FROM progress_parts_v2 WHERE user_id=?1 AND book_code=?2 AND batch_id=?3))
      AND (SELECT COUNT(*) FROM pending) BETWEEN 1 AND ${maximumRecords}
      AND (SELECT COUNT(*) FROM pending)=(SELECT SUM(record_count) FROM progress_parts_v2 WHERE user_id=?1 AND book_code=?2 AND batch_id=?3)`)
      .bind(user,book,batchId,revision,now),
    snapshot(revision),
    db.prepare(`${projected} INSERT INTO progress_learning_stats_v2(user_id,book_code,first_day,marked)
      SELECT ?1,?2,first_day,marked FROM next_learning WHERE ${committed}
      AND first_day IN (SELECT first_day FROM learning_delta WHERE marked<>0)
      ON CONFLICT(user_id,book_code,first_day) DO UPDATE SET marked=excluded.marked`).bind(user,book,batchId),
    db.prepare(`${projected} INSERT INTO progress_review_stats_v2(user_id,book_code,day,queued,reviewed,skipped)
      SELECT ?1,?2,day,queued,reviewed,skipped FROM next_reviews WHERE ${committed}
      AND day IN (SELECT day FROM review_delta WHERE queued<>0 OR reviewed<>0 OR skipped<>0)
      ON CONFLICT(user_id,book_code,day) DO UPDATE SET queued=excluded.queued,reviewed=excluded.reviewed,skipped=excluded.skipped`).bind(user,book,batchId),
    db.prepare(`INSERT INTO progress_records_v2(user_id,book_code,record_id,value,revision,first_day,learned,reviews,bucket)
      SELECT ?1,?2,record_id,value,?4,first_day,learned,reviews,bucket FROM progress_staging_v2
      WHERE user_id=?1 AND book_code=?2 AND batch_id=?3 AND ${committed}
      ON CONFLICT(user_id,book_code,record_id) DO UPDATE SET value=excluded.value,revision=excluded.revision,first_day=excluded.first_day,learned=excluded.learned,reviews=excluded.reviews,bucket=excluded.bucket`)
      .bind(user,book,batchId,revision+1),
    snapshot(revision+1),
    db.prepare(`DELETE FROM progress_checkpoints_v2 WHERE user_id=? AND book_code=? AND (created_at<? OR slot NOT IN
      (SELECT DISTINCT slot FROM progress_checkpoints_v2 WHERE user_id=? AND book_code=? ORDER BY slot DESC LIMIT 24))`).bind(user,book,now-7*86400000,user,book),
    db.prepare(`DELETE FROM progress_batches_v2 WHERE user_id=?1 AND book_code=?2 AND batch_id=?3 AND ${committed}`).bind(user,book,batchId),
  ]);
  if(!result[0].meta.changes){const current=await incrementalHead(db,user);return {status:current.revision===revision?400:409,revision:current.revision};}
  return {status:200,revision:revision+1};
}
