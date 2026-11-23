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
 const url=process.argv[2]||'http://127.0.0.1:4190/';
 await cmd('Page.enable');
 await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.testAudio=0;window.testStep=-1;window.testRate=0;
 if(!localStorage.getItem('bongsynth-v2'))localStorage.setItem('bongsynth-v2',JSON.stringify({color:[127,127,127,127,127,1],fx:[70,7,30,127],rev:127,dly:127}));
 const A=window.AudioContext;window.AudioContext=class extends A{constructor(opts){super(opts);window.testRate=this.sampleRate;}};
 const original=Object.getOwnPropertyDescriptor(MessagePort.prototype,'onmessage');
 Object.defineProperty(MessagePort.prototype,'onmessage',{...original,set(fn){return original.set.call(this,fn&&function(event){
 if(event.data?.peak>0)window.testAudio=Math.max(window.testAudio,event.data.peak);
 if(Number.isInteger(event.data?.step))window.testStep=event.data.step;
 return fn.call(this,event);});}});
 `});
 for(const [width,height] of [[390,844],[1440,900]]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
  await cmd('Storage.clearDataForOrigin',{origin:new URL(url).origin,storageTypes:'local_storage'});
  await cmd('Page.navigate',{url});await poll("document.querySelector('[data-desk=sound] .page-tag')?.value==='OSC'");
  const mix=await js(`(()=>{document.querySelector('[data-tab=fx]').click();const d=document.querySelector('[data-desk=fx]');const next=d.querySelector('[data-dir="1"]');const tags=[d.querySelector('.page-tag').value];next.click();tags.push(d.querySelector('.page-tag').value);const inputs=[...d.querySelectorAll('.knob')].map(e=>e.querySelector('.kl').textContent);const ranges=[...d.querySelectorAll('.knob-input')].map(e=>Number(e.value));next.click();return {tags,inputs,ranges,wrap:d.querySelector('.page-tag').value}})()`);
  assert.deepEqual(mix.tags,['LFO 1','MIX']);assert.deepEqual(mix.inputs,['PAN','VOLUME']);assert.deepEqual(mix.ranges,[64,70]);assert.equal(mix.wrap,'LFO 1');
  await js(`(()=>{const input=document.querySelector('#sound-file');const data=new DataTransfer();data.items.add(new File(['BONGSYNTH SOUND 1\\nBASE 24 TEST\\nMODE POLY\\nCOLOR 127 127 127 127 127 1\\nP 30 1\\nP 31 107\\nP 33 1\\n'],'earlier.txt',{type:'text/plain'}));input.files=data.files;input.dispatchEvent(new Event('change'));})()`);
  await poll("document.querySelector('#sound-notice').textContent.includes('Legacy COLOR settings were ignored')");
  const saved=await poll(`(()=>{const s=JSON.parse(localStorage.getItem('bongsynth-v2'));return s.sound?.[31]===107?s:null})()`);
  assert.equal(saved.preset,24);assert.equal(saved.mono,false);assert.equal(saved.volume,70);
  for(const old of ['fx','rev','dly','color'])assert.equal(old in saved,false);
  await js(`(()=>{document.querySelector('[data-tab=sound]').click();const next=document.querySelector('[data-desk=sound] [data-dir="1"]');for(let i=0;i<8;i++)next.click()})()`);
  const routing=await js(`(()=>{const d=document.querySelector('[data-desk=sound]');const flow=d.querySelector('.signal-flow');const c=flow.querySelector('.signal-chain').getBoundingClientRect();const p=d.querySelector('.plot').getBoundingClientRect();return {name:d.querySelector('.page-tag').value,chain:flow.dataset.order,active:flow.querySelector('.active').dataset.stage,fit:c.left>=p.left&&c.right<=p.right,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert.deepEqual(routing,{name:'SHAPER',chain:'osc drive filter shape amp dry out',active:'shape',fit:true,overflow:false});
  await js("document.querySelector('#menu').open=true;document.querySelector('#dsp-run').click()",true);
  const bench=await poll("document.querySelector('#dsp-detail').textContent.startsWith('Last run:')&&document.querySelector('#dsp-load b').textContent");
  await js("document.querySelector('#menu').open=false;document.querySelector('#play').click()",true);
  const audio=await poll("testRate===44100&&testStep>=1&&testAudio>0&&{rate:testRate,step:testStep,peak:testAudio}");
  await js("document.querySelector('#play').click()",true);
  await poll("document.querySelector('#play').getAttribute('aria-pressed')==='false'");
  const shot=await cmd("Page.captureScreenshot",{format:"png"});await writeFile('/tmp/bong-dry-stage/synth-'+width+'.png',Buffer.from(shot.data,'base64'));
  console.log(JSON.stringify({width,routing,mix,legacySavedVolume:saved.volume,legacyShaper:saved.sound[31],bench,audio}));
 }
}finally{ws?.close();chrome.kill();await wait(350);await rm(profile,{recursive:true,force:true}).catch(()=>{});}
