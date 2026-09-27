import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteDatabase } from '../scripts/d1-admin.mjs';

test('administrative D1 adapter keeps account IDs parameterized and sends recovery writes as one batch',async()=>{
 const beforeToken=process.env.CLOUDFLARE_API_TOKEN, beforeFetch=globalThis.fetch;
 process.env.CLOUDFLARE_API_TOKEN='isolated-test-token';
 try{
  let sent;
  globalThis.fetch=async(url,options)=>{sent={url,body:JSON.parse(options.body)};return Response.json({success:true,result:[{success:true,meta:{changes:1}},{success:true,meta:{changes:1}}]});};
  const db=remoteDatabase('a'.repeat(32),'b'.repeat(8)+'-bbbb-bbbb-bbbb-'+'b'.repeat(12));
  const adversarial="account' OR 1=1 --";
  const statements=[db.prepare('INSERT INTO archive SELECT ? WHERE user_id = ?').bind(new Uint8Array([0,255,9]),adversarial),db.prepare('UPDATE progress SET revision = ? WHERE user_id = ?').bind(3,adversarial)];
  assert.equal((await db.batch(statements)).length,2);
  assert.equal(sent.body.batch.length,2);
  assert.equal(sent.body.batch[0].sql,"INSERT INTO archive SELECT X'00ff09' WHERE user_id = ?");
  assert.deepEqual(sent.body.batch[0].params,[adversarial]);
  assert.deepEqual(sent.body.batch[1].params,[3,adversarial]);
  await db.prepare('SELECT ?2 WHERE ?1 = ?1').bind(adversarial,7).all();
  assert.equal(sent.body.batch[0].sql,'SELECT ? WHERE ? = ?');
  assert.deepEqual(sent.body.batch[0].params,[7,adversarial,adversarial]);
  globalThis.fetch=async()=>Response.json({success:false,errors:[{code:10000,message:'do not expose private query'}]},{status:403});
  await assert.rejects(db.batch(statements),error=>error.message.includes('403')&&!error.message.includes('private query')&&!error.message.includes('isolated-test-token'));
 }finally{globalThis.fetch=beforeFetch;if(beforeToken===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=beforeToken;}
});
