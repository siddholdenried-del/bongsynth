import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boot} from '../web/engine.js';
const wasm=new WebAssembly.Module(readFileSync(new URL('../web/bongsynth.wasm',import.meta.url)));
function render(tempo,sync){
  const x=boot(wasm);
  x.gs_preset(24);
  for(let i=46;i<64;i+=3)x.gs_set(i,0);
  assert.equal(x.gs_set(45,sync),1);
  x.gs_set(42,0);x.gs_set(43,60);
  x.gs_set(46,2);x.gs_set(47,0);x.gs_set(48,36);
  x.gs_tempo(tempo*10);
  x.gs_note_on(48,120);
  const phase=[];
  for(let i=0;i<160;i++){
    x.gs_render(128);
    phase.push(...new Float32Array(x.memory.buffer,x.gs_left(),128));
  }
  return phase;
}
test('clocked held note responds to BPM but free-running LFO does not',()=>{
  assert.deepEqual(render(80,0),render(160,0));
  const a=render(80,2),b=render(160,2);
  assert.ok(a.some((x,i)=>Math.abs(x-b[i])>0.001),'tempo never reached the DSP');
});
