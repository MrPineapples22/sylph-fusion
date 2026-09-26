import test from 'node:test';
import assert from 'node:assert/strict';
import {searchOperations,moveSearchSelection,selectedSearchIndex} from '../src/operator-search.js';
import {WORKSPACES} from '../src/operator-navigation.js';

test('empty command query offers every workspace without overwhelming token results',()=>{
  assert.deepEqual(searchOperations('  ',[{mint:'abc',symbol:'TOKEN'}]).map(r=>r.workspace),WORKSPACES);
});
test('commands match purpose, symbols and mint with all terms and stable unique identities',()=>{
  assert.equal(searchOperations('provider health')[0].workspace,'System');
  const tokens=[{mint:'AbC123',symbol:'SOL'},{mint:'AbC123',symbol:'SOL'},{mint:'xyz',symbol:'SOL'}];
  assert.deepEqual(searchOperations('sol abc',tokens).map(r=>r.id),['token:AbC123']);
  assert.equal(searchOperations('ABC',tokens)[0].token,tokens[0]);
  assert.equal(searchOperations('no-such-result',tokens).length,0);
});
test('token search ignores missing identities and bounds high-volume results',()=>{
  const tokens=[null,{},...Array.from({length:40},(_,i)=>({mint:`mint-${i}`,symbol:'TOKEN'}))];
  assert.equal(searchOperations('mint',tokens).filter(r=>r.kind==='token').length,12);
  assert.doesNotThrow(()=>searchOperations('test',null));
});
test('keyboard result selection wraps and empty lists stay safe',()=>{
  assert.equal(moveSearchSelection(0,-1,8),7);
  assert.equal(moveSearchSelection(7,1,8),0);
  assert.equal(moveSearchSelection(0,1,0),0);
});
test('live search reordering preserves token identity and removed results reset safely',()=>{
  const alpha={mint:'mint-a',symbol:'zzq Alpha'}, beta={mint:'mint-b',symbol:'zzq Beta'};
  const original=searchOperations('zzq',[alpha,beta]);
  const chosen=original[1].id;
  const updated=searchOperations('zzq',[beta,alpha]);
  assert.equal(updated[selectedSearchIndex(updated,chosen)].token,beta);
  assert.equal(selectedSearchIndex(searchOperations('zzq',[alpha]),chosen),0);
  assert.equal(selectedSearchIndex([],chosen),0);
});
