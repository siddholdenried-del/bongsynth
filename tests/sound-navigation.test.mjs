import test from 'node:test';
import assert from 'node:assert/strict';
import * as nav from '../web/signal-flow.mjs';
test('sound pages follow the editing path; old saved pages still identify the same panel',()=>{
  assert.deepEqual(nav.soundPageOrder,['OSC','OSC 2','SHAPER','TONE','FILTER','FILTER ENV','AMP ENV','VOICE','TOUCH','MOD ENV','LFO 2','MACRO']);
  assert.equal(nav.soundPageIndex(8),2);
  assert.equal(nav.soundPageIndex(8,'SHAPER'),2);
});
test('scope stages map to a stable named destination',()=>{
  assert.deepEqual(nav.scopeDestination('filter'),['sound','FILTER']);
  assert.deepEqual(nav.scopeDestination('drive'),['sound','TONE',3]);
  assert.deepEqual(nav.scopeDestination('out'),['fx','MIX',1]);
});
