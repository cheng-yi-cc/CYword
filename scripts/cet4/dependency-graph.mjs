import assert from 'node:assert/strict';
export function validateDependencies(wordIds, edges) {
  const ids=new Set(wordIds), incoming=new Map([...ids].map(id=>[id,[]]));
  const seen=new Set();
  for(const e of edges){
    assert.ok(ids.has(e.word_id)&&ids.has(e.prerequisite_word_id),'Unknown prerequisite word');
    assert.notEqual(e.word_id,e.prerequisite_word_id,'Self dependency');
    const key=`${e.word_id}|${e.prerequisite_word_id}`;
    assert.ok(!seen.has(key),'Duplicate dependency');seen.add(key);
    incoming.get(e.word_id).push(e.prerequisite_word_id);
  }
  const visiting=new Set(),done=new Set();
  function visit(id){
    assert.ok(!visiting.has(id),`Dependency cycle at ${id}`);
    if(done.has(id))return;
    visiting.add(id);for(const p of incoming.get(id))visit(p);
    visiting.delete(id);done.add(id);
  }
  for(const id of ids)visit(id);
  return incoming;
}
