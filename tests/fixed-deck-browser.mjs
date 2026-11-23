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
 const candidate=process.argv[2]||'http://127.0.0.1:48792/';
 await cmd('Page.enable');
 await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.testAudio=0;
 const original=Object.getOwnPropertyDescriptor(MessagePort.prototype,'onmessage');
 Object.defineProperty(MessagePort.prototype,'onmessage',{...original,set(fn){return original.set.call(this,fn&&function(event){if(event.data?.peak>0)window.testAudio=Math.max(window.testAudio,event.data.peak);return fn.call(this,event);});}});
 `});
 for(const [width,height] of [[320,720],[390,844],[1440,900]]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
  await cmd('Storage.clearDataForOrigin',{origin:new URL(candidate).origin,storageTypes:'local_storage'});
  await cmd('Page.navigate',{url:candidate});
  await poll("document.querySelector('[data-desk=sound] .deck-readback span')?.textContent");
  const proof=await js(`(()=>{
    const q=(s,r=document)=>r.querySelector(s), all=(s,r)=>[...r.querySelectorAll(s)];
    const dims=e=>e.getBoundingClientRect().toJSON();
    const mid=e=>{const r=dims(e);return r.x+r.width/2;};
    const decks={};
    for(const view of ['sound','matrix','fx']){
      q('[data-tab='+view+']').click();
      const root=q('[data-desk='+view+']'), next=q('.desk-row [data-dir="1"]',root);
      const extract=()=>({readHeights:all(".deck-readback",root).map(e=>dims(e).height),x:all('.desk-knobs .dial',root).map(mid),rx:all('.deck-readback',root).map(mid),dial:all('.desk-knobs .dial',root).map(e=>dims(e).width),scope:dims(q('.plot',root)),row:dims(q('.desk-row',root)),scroll:scrollY,reads:all('.deck-readback',root).map(e=>e.textContent),active:all('.desk-knobs input:not(:disabled)',root).length,arrows:all('.desk-row .page-arrow > svg',root).map(e=>dims(e).width)});
      const first=extract();const page=q('.page-tag',root).value;next.click();const second=extract();
      const invariants=[],textOverflows=[];
      do {
        const sample=extract();invariants.push([sample.scope,sample.row,sample.x,sample.readHeights,sample.scroll]);
        for(const e of all('.deck-readback > :is(span,output)',root)){
          const bounds=dims(e),range=new Range();range.selectNodeContents(e);const t=range.getBoundingClientRect();
          if(t.height>bounds.height+1||t.width>bounds.width+1)textOverflows.push([q('.page-tag',root).value,e.textContent,t.height,bounds.height,t.width,bounds.width]);
        }
        next.click();
      }while(q('.page-tag',root).value!==page&&invariants.length<30);
      next.click();
      if(view==='sound')q('[data-desk=sound] button[data-stage=filter]').click();
      decks[view]={first,second,page,invariants,textOverflows,nextName:q('.page-tag',root).value};
    }
    return {decks,width:innerWidth,scroll:document.documentElement.scrollWidth};
  })()`);
  assert.equal(proof.scroll,width);
  const first=proof.decks.sound.first;
  for(const [view,{first:a,second:b,page,invariants,textOverflows,nextName}] of Object.entries(proof.decks)){
    assert.equal(a.x.length,4,view);assert.equal(a.rx.length,4,view);
    assert.deepEqual(a.x,a.rx,view+' columns');assert.deepEqual(a.x,first.x,view+' centers across tabs');
    assert.deepEqual(a.dial,Array(4).fill(width<641?41:64));
    assert.deepEqual(a.scope,first.scope,view+' scope across tabs');assert.deepEqual(a.row,first.row,view+' row across tabs');
    assert.deepEqual(a.scope,b.scope,view+' scope across pages');assert.deepEqual(a.x,b.x);assert.equal(a.scroll,b.scroll);
    assert.ok(a.arrows.length===2&&a.arrows.every(x=>x>20),view);
    assert.notEqual(page,nextName);
    for(const invariant of invariants)assert.deepEqual(invariant,[a.scope,a.row,a.x,a.readHeights,a.scroll],view+' complete sequence geometry');
    assert.deepEqual(textOverflows,[],view+' text overflow');
    if(view==='matrix'){assert.equal(a.active,3);assert.equal(a.reads[3],'—');}
  }
  await js("document.querySelector('[data-tab=sound]').click()");
  const png=await cmd('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/bong-synth-deck-'+width+'.png',Buffer.from(png.data,'base64'));
  await js("document.querySelector('#play').click()",true); const peak=await poll("window.testAudio>0&&window.testAudio");
  assert.ok(peak>0);await js("document.querySelector('#play').click()",true);
  console.log(width,{centers:first.x,scope:[first.scope.x,first.scope.y,first.scope.width,first.scope.height],peak});
 }
}finally{ws?.close();chrome.kill();await wait(350);await rm(profile,{recursive:true,force:true}).catch(()=>{});}
