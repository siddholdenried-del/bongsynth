import test from "node:test";
import assert from "node:assert/strict";
import {deskPosition, benchLayout, medianLoad} from "../web/desk-status.mjs";
test("three named pages wrap and report neighbors",()=>{
 const pages=["OSC","AMP","MOD"].map(name=>({name}));
 assert.deepEqual(deskPosition(pages,-1),{index:2,count:3,name:"MOD",previous:"AMP",next:"OSC"});
 assert.deepEqual(deskPosition(pages,3),{index:0,count:3,name:"OSC",previous:"MOD",next:"AMP"});
});

test("bench uses complete bounded patterns and fixed 128-frame native blocks",()=>{
 assert.deepEqual(benchLayout(120),{rate:44100,block:128,warmup:690,sample:1380,repeats:3});
 assert.equal(benchLayout(40).sample,4136);
 assert.throws(()=>benchLayout(39),/out of range/);
});
test("reported renderer fraction uses median only and is never faked or clamped",()=>{
 assert.equal(medianLoad([10,50,25],128*32,40960),25);
 assert.equal(medianLoad([200,50,250],128*32,40960),200);
 assert.throws(()=>medianLoad([0,10,25],128*32,40960),/No usable/);
});

test("worker benchmarks the unchanged real WASM with an initialized patch and a played pattern",async()=>{
 const {readFile}=await import("node:fs/promises");
 const {boot}=await import("../web/engine.js");
 const module=await WebAssembly.compile(await readFile(new URL("../web/bongsynth.wasm",import.meta.url)));
 const x=boot(module),preset=24;
 const mono=!!x.gs_preset(preset);
 const state={preset,mono,sound:Array.from({length:x.gs_param_count()},(_,i)=>x.gs_get(i)),color:Array.from({length:6},(_,i)=>x.gs_color_get(i)),fx:Array.from({length:x.gs_fx_count()},(_,i)=>x.gs_fx_get(i)),level:100,pan:64,rev:20,dly:12,bpm:120,transpose:0,lfo:[0,40,0,0],steps:Array.from({length:16},(_,i)=>[36+i%4,(i%4?1:3)])};
 const emitted=[];
 globalThis.self={postMessage:value=>emitted.push(value)};
 try{
  await import("../web/dsp-bench.mjs");
  self.onmessage({data:{module,state}});
  assert.equal(emitted.length,1);
  assert.ok(Number.isFinite(emitted[0].load)&&emitted[0].load>0,JSON.stringify(emitted[0]));
 }finally{delete globalThis.self;}
});
