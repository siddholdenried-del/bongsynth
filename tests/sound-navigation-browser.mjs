import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const profile=await mkdtemp('/tmp/bongsynth-bench-chrome-');
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-background-networking','--disable-component-update','--no-first-run','--user-data-dir='+profile,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','inherit','inherit']});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try{
 let d;for(let i=0;i<400&&!d;i++){await wait(100);try{d=await readFile(profile+'/DevToolsActivePort','utf8')}catch{}}
 assert.ok(d,'Chrome debugger startup timed out'); const [port]=d.split('\n');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();ws=new WebSocket(tabs[0].webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map();ws.onmessage=e=>{const d=JSON.parse(e.data);pending.get(d.id)?.(d);};
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,d=>{pending.delete(i);d.error?reject(d.error):resolve(d.result)});ws.send(JSON.stringify({id:i,method,params}));});
 const js=async(expression,userGesture=false)=>{const d=await cmd('Runtime.evaluate',{expression,userGesture,awaitPromise:true,returnByValue:true});if(d.exceptionDetails)throw Error(JSON.stringify(d.exceptionDetails));return d.result.value;};
 const poll=async expr=>{for(let i=0;i<120;i++){const x=await js(expr);if(x)return x;await wait(75)}throw Error(expr)};
 const base='http://127.0.0.1:48791/',candidate='http://127.0.0.1:48792/';
 await cmd('Page.enable');
 await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.testAudio=0;
 const original=Object.getOwnPropertyDescriptor(MessagePort.prototype,'onmessage');
 Object.defineProperty(MessagePort.prototype,'onmessage',{...original,set(fn){return original.set.call(this,fn&&function(event){if(event.data?.peak>0)window.testAudio=Math.max(window.testAudio,event.data.peak);return fn.call(this,event);});}});
 `});
 for(const [width,height] of [[390,844],[1440,900]]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
  await cmd('Storage.clearDataForOrigin',{origin:new URL(candidate).origin,storageTypes:'local_storage'});
  await cmd('Page.navigate',{url:candidate});await poll("document.querySelector('[data-desk=sound] .page-tag')?.textContent.trim()");
  const desk="[data-desk=sound]", name=()=>js(`document.querySelector('${desk} .page-tag').value`);
  const stage=id=>`${desk} button[data-stage=${id}]`;
  const click=sel=>js(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const key=async key=>{for(const type of [key==='Enter'?'keyDown':'rawKeyDown','keyUp'])await cmd('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:{ArrowLeft:37,ArrowRight:39,Enter:13}[key],...(key==='Enter'&&type==='keyDown'?{text:'\r'}:{})});};
  const next=desk+' [data-dir="1"]';
  for(const page of ['OSC 2','TONE','SHAPER','FILTER','FILTER ENV','AMP ENV','TOUCH','VOICE','MOD ENV','LFO 2','MACRO','OSC']){
    await click(next); assert.equal(await name(),page,'consecutive sound pages');
  }
  assert.ok(await js(`[...document.querySelectorAll('${desk} button[data-stage]')].filter(e=>e.offsetWidth).every(e=>e.getBoundingClientRect().height>=26 && e.getBoundingClientRect().right<=innerWidth)`));
  await js(`document.querySelector('${next}').focus()`); await key('ArrowRight'); assert.equal(await name(),'OSC 2');
  await js(`document.querySelector('${desk} input').focus()`);await key('ArrowRight');assert.equal(await name(),'OSC 2','knob arrow changes knob, not page');
  await js(`document.querySelector('${stage('shape')}').focus()`);await key('Enter');assert.equal(await name(),'SHAPER');
  assert.equal(await js(`document.querySelector('${stage('shape')}').getAttribute('aria-current')`),'true');
  await js("document.querySelector('#play').click()",true);assert.ok(await poll("window.testAudio>0&&window.testAudio"));
  const target=await js(`(()=>{const r=document.querySelector('${stage('filter')}').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  if(width<500){await cmd('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});await cmd('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else await click(stage('filter'));
  assert.equal(await name(),'FILTER');
  await js('window.testAudio=0');assert.ok(await poll("window.testAudio>0&&window.testAudio"),'audio continues after stage jump');
  await click(stage('out'));assert.equal(await js("document.body.dataset.view"),'fx');
  assert.equal(await js("document.querySelector('[data-desk=fx] .page-tag').value"),'MIX');
  await js("document.querySelector('#play').click()",true);
  assert.equal(await js("document.documentElement.scrollWidth"),width);
  console.log(width,{stageJumps:true,touch:width<500,playingScope:true});
 }
}finally{ws?.close();chrome.kill();await wait(350);await rm(profile,{recursive:true,force:true}).catch(()=>{});}
