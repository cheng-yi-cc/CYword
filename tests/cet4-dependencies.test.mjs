import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDependencies} from '../scripts/cet4/dependency-graph.mjs';
test('explicit word dependencies reject hidden cycles and unknown references',()=>{
  const edge=(a,b)=>({word_id:a,prerequisite_word_id:b});
  assert.equal(validateDependencies(['act','active','activity'],[edge('activity','active'),edge('active','act')]).get('activity')[0],'active');
  assert.throws(()=>validateDependencies(['act','active'],[edge('act','active'),edge('active','act')]),/cycle/);
  assert.throws(()=>validateDependencies(['act'],[edge('act','ghost')]),/Unknown/);
  assert.throws(()=>validateDependencies(['act'],[edge('act','act')]),/Self/);
});
