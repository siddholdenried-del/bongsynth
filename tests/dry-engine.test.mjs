import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {boot,apply} from '../web/engine.js';
const mod=await WebAssembly.compile(await readFile(new URL('../web/bongsynth.wasm',import.meta.url)));
const output=(x,p)=>new Float32Array(x.memory.buffer,p,256);
const peak=a=>a.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
function rendered(change=()=>{},kill=false){
 const x=boot(mod);x.gs_preset(24);x.gs_set(31,0);x.gs_set(7,0);
 x.gs_note_on(48,120);change(x);
 const result=[];
 for(let i=0;i<50;i++){x.gs_render(128);result.push(...output(x,x.gs_left()).slice(0,128));}
 if(kill){
  x.gs_kill();let tail=0;
  for(let i=0;i<240;i++){x.gs_render(128);tail=Math.max(tail,peak(output(x,x.gs_left()).slice(0,128)),peak(output(x,x.gs_right()).slice(0,128)));}
  return {peak:peak(result),tail};
 }
 return result;
}
test('dry engine exports no Color or send effects, retains preset and shaper IDs',()=>{
 const x=boot(mod);
 const names=WebAssembly.Module.exports(mod).map(v=>v.name);
 assert.ok(!names.some(n=>/^gs_(?:preset_color|color|send|fx)/.test(n)),names.join(', '));
 assert.equal(typeof x.gs_volume,'function');
 assert.equal(x.gs_presets(),129);
 assert.deepEqual([30,31,32,33].map(i=>[x.gs_param_min(i),x.gs_param_max(i)]),[[0,3],[0,127],[-64,63],[0,1]]);
});
test('killing a voice produces zero samples with no return tails',()=>{
 const r=rendered(()=>{},true);assert.ok(r.peak>0.01);assert.equal(r.tail,0);
});
test('voice shaper stays audible and master volume still controls both outputs',()=>{
 const dry=rendered(),shaped=rendered(x=>{x.gs_set(30,1);x.gs_set(31,110);x.gs_set(33,1);});
 const delta=shaped.reduce((n,v,i)=>n+(v-dry[i])**2,0);
 assert.ok(delta/dry.length>1e-5,delta/dry.length);
 assert.equal(peak(rendered(x=>x.gs_volume(0))),0);
 assert.ok(peak(rendered(x=>x.gs_volume(127)))>peak(dry)*2);
});
test('sequencer and pan render the dry patch through the same apply API',()=>{
 const x=boot(mod),preset=24,mono=!!x.gs_preset(preset);
 const state={preset,mono,sound:Array.from({length:x.gs_param_count()},(_,i)=>x.gs_get(i)),level:100,pan:0,volume:44,bpm:120,transpose:0,lfo:[0,40,0,0],steps:Array.from({length:16},(_,i)=>[36+i%4,1])};
 apply(x,state);x.gs_play(1);let l=0,r=0;
 for(let i=0;i<180;i++){x.gs_render(128);l=Math.max(l,peak(output(x,x.gs_left()).slice(0,128)));r=Math.max(r,peak(output(x,x.gs_right()).slice(0,128)));}
 assert.ok(x.gs_step()>1);assert.ok(l>0.01);assert.ok(r<l*.15,[l,r]);x.gs_play(0);assert.equal(x.gs_step(),-1);
});
