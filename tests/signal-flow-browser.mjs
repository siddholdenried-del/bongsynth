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
 const geometry=()=>js(`Object.fromEntries(['.bar','.screen','.plot','.desk-row','.brand-foot'].map(sel=>{const e=document.querySelector(sel==='.plot'||sel==='.desk-row'?'[data-view="'+document.body.dataset.view+'"] '+sel:sel);const r=e.getBoundingClientRect();return [sel,[r.x,r.y,r.width,r.height]]}))`);
 for(const [width,height] of [[390,844],[1440,900]]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
  await cmd('Storage.clearDataForOrigin',{origin:new URL(base).origin,storageTypes:'local_storage'});
  await cmd('Storage.clearDataForOrigin',{origin:new URL(candidate).origin,storageTypes:'local_storage'});
  const bounds={};
  for(const [which,url] of [['baseline',base],['candidate',candidate]]){
   await cmd('Page.navigate',{url});await poll("document.querySelector('[data-desk=sound] .page-tag')?.textContent.trim()");
   for(const [view,count] of [['sound',12],['matrix',6],['fx',8]]){
    await js(`document.querySelector('[data-tab=${view}]').click()`);
    if(which==='baseline'){bounds[view]=await geometry();continue;}
    assert.deepEqual(await geometry(),bounds[view],view+' changed desk geometry');
    assert.equal(await js("document.documentElement.scrollWidth"),width);
    const page=await js(`(()=>{const d=document.querySelector('[data-desk=${view}]');const tag=d.querySelector('.page-tag'),next=d.querySelector('[data-dir="1"]'),previous=d.querySelector('[data-dir="-1"]');const position=()=>tag.getAttribute('aria-label');const start=position(),startName=tag.value;previous.click();const wrap=position();next.click();const restored=position();next.click();return {start,startName,wrap,restored,end:position(),endName:tag.value,next:next.getAttribute('aria-label'),length:d.querySelectorAll('.knob').length}})()`);
    assert.match(page.start,new RegExp('^Page 1 of '+count+': '));
    assert.match(page.wrap,new RegExp('^Page '+count+' of '+count+': '));
    assert.equal(page.restored,page.start);
    assert.match(page.end,new RegExp('^Page 2 of '+count+': '));
    assert.equal(page.startName,page.start.split(': ')[1]);
    assert.equal(page.endName,page.end.split(': ')[1]);
    assert.match(page.next,/^Next page: /);
    assert.equal(page.length,view==='matrix'?3:4);
    const flow=await js(`(()=>{const d=document.querySelector('[data-desk=${view}]'),f=d.querySelector('.signal-flow'),c=f.querySelector('.signal-chain').getBoundingClientRect(),b=d.querySelector('.plot').getBoundingClientRect();return {active:[...f.querySelectorAll('.active')].map(x=>x.dataset.stage),branches:[...f.querySelectorAll('.signal-branches [data-stage]')].map(x=>x.dataset.stage),fitting:c.left>=b.left&&c.right<=b.right,cRight:c.right,bRight:b.right,row:d.querySelector(".readout").getBoundingClientRect().toJSON(),readout:d.querySelector('.ro-label').textContent,number:d.querySelector('.ro-value').value}})()`);
    assert.deepEqual(flow.active,[{sound:"osc",matrix:"filter",fx:"color"}[view]]);
    assert.deepEqual(flow.branches,["dry","room","delay"]);
    console.log(width,view,JSON.stringify(flow));
    assert.ok(flow.fitting&&flow.readout&&flow.number);
    const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/bong-next/flow-'+view+'-'+width+'.png',Buffer.from(shot.data,'base64'));
   }
  }
  await js("document.querySelector('#menu').open=true;document.querySelector('#dsp-run').click()",true);
  const load=await poll("document.querySelector('#dsp-detail').textContent.startsWith('Last run:')&&document.querySelector('#dsp-load b').textContent");
  assert.match(load,/^(<1|\d+)%$/);
  await js("document.querySelector('#menu').open=false;document.querySelector('#play').click()",true);
  assert.ok(await poll("window.testAudio>0&&window.testAudio"));
  await js("document.querySelector('#dsp-run').click()",true);
  assert.match(await js("document.querySelector('#dsp-detail').textContent"),/Stop playback/);
  console.log(width,{load,peak:await js('testAudio'),sameGeometry:true});
 }
}finally{ws?.close();chrome.kill();await wait(350);await rm(profile,{recursive:true,force:true}).catch(()=>{});}
