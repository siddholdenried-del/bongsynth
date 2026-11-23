import {signalStages,flowStages} from "./signal-flow.mjs";
import {deskPosition} from "./desk-status.mjs";
import {boot,apply} from "./engine.js";
import {$,make,knob,openSheet,wireSheet,stepper} from "./controls.js";
import {css,unit,pixelCanvas,plot,screen,liveTrace,Trace} from "./viz.js";
const info=$("status");
let x,module,ctx,node,port,connecting,playing=false,recording=false,state,timer=0,analyser,scopeBuf=new Float32Array(2048);
const send=(kind,value={})=>port?.postMessage({kind,...value});

// ---------- the engine's names ----------
const utf8=new TextDecoder();
const str=p=>{if(!p)return "";const v=new Uint8Array(x.memory.buffer);let e=p;while(e<v.length&&v[e]!==0)e++;return utf8.decode(v.subarray(p,e));};
const SF_ENUM=1;
const BANKS=[[0,24,"GHETTOMACHINE 0.2"],[24,45,"MOTOR CITY"],[45,66,"HOUSE"],[66,87,"ELECTRO"],[87,108,"WAREHOUSE"],[108,129,"DUB"]];
const bankOf=i=>BANKS.findIndex(([a,b])=>i>=a&&i<b);
const NOTE=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const noteName=n=>NOTE[n%12]+(Math.floor(n/12)-1);
const SLOT0=46,AMP=[18,19,20,21],FENV=[22,23,24,25],MENV=[38,39,40,41];

// ---------- the state ----------
const KEY="bongsynth-v2";
const PHRASES={
  "ACID LINE":[[36,1],[36,0],[48,3],[36,1],[39,5],[41,1],[36,0],[46,3],[36,1],[36,1],[48,1],[43,5],[44,1],[36,0],[39,3],[34,1]],
  "OCTAVE PUMP":[[36,3],[48,1],[36,1],[48,1],[36,3],[48,1],[36,1],[48,5],[39,3],[51,1],[39,1],[51,1],[34,3],[46,1],[34,1],[46,5]],
  "DUB STEPS":[[36,3],[36,0],[36,0],[36,1],[36,0],[36,0],[43,1],[43,0],[39,3],[39,0],[39,0],[39,0],[41,5],[43,1],[43,0],[43,0]],
  "SLIDE RIDE":[[36,5],[39,5],[43,1],[36,0],[46,5],[43,5],[39,1],[36,0],[36,5],[41,5],[44,1],[36,0],[48,7],[46,5],[43,1],[39,0]],
  "STAB CHORDS":[[48,3],[48,0],[48,0],[48,1],[48,0],[48,0],[48,1],[48,0],[48,0],[48,0],[51,3],[51,0],[51,0],[46,1],[46,0],[46,0]],
};
const seed=()=>({preset:24,sound:[],mono:true,color:[0,0,0,0,0,0],level:100,pan:64,rev:20,dly:12,fx:[],bpm:124,transpose:0,
  lfo:[0,40,0,0],steps:PHRASES["ACID LINE"].map(s=>[...s]),octave:4,pages:{sound:0,matrix:0,fx:0}});
const int=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
function restore(){
  const s=seed();
  s.mono=!!x.gs_preset(s.preset);s.sound=[...Array(x.gs_param_count())].map((_,k)=>x.gs_get(k));
  s.color=[...Array(6)].map((_,i)=>x.gs_color_get(i));s.fx=[...Array(x.gs_fx_count())].map((_,i)=>x.gs_fx_get(i));
  try{
    const k=JSON.parse(localStorage.getItem(KEY));if(!k)return s;
    if(int(k.preset,0,x.gs_presets()-1))s.preset=k.preset;
    if(Array.isArray(k.sound)&&k.sound.length===s.sound.length&&k.sound.every((v,i)=>int(v,x.gs_param_min(i),x.gs_param_max(i))))s.sound=k.sound;
    if(typeof k.mono==="boolean")s.mono=k.mono;
    if(Array.isArray(k.color)&&k.color.length===6&&k.color.every((v,i)=>int(v,0,i===5?1:127)))s.color=k.color;
    for(const f of ["level","pan","rev","dly"])if(int(k[f],0,127))s[f]=k[f];
    if(Array.isArray(k.fx)&&k.fx.length===s.fx.length&&k.fx.every((v,i)=>int(v,0,x.gs_fx_max(i))))s.fx=k.fx;
    if(typeof k.bpm==="number"&&k.bpm>=40&&k.bpm<=240)s.bpm=Math.round(k.bpm);
    if(int(k.transpose,-24,24))s.transpose=k.transpose;
    if(Array.isArray(k.lfo)&&k.lfo.length===4&&int(k.lfo[0],0,4)&&int(k.lfo[1],0,127)&&int(k.lfo[2],-64,63)&&int(k.lfo[3],0,9))s.lfo=k.lfo;
    if(Array.isArray(k.steps)&&k.steps.length===16&&k.steps.every(st=>Array.isArray(st)&&int(st[0],0,127)&&int(st[1],0,7)))s.steps=k.steps;
    if(int(k.octave,1,7))s.octave=k.octave;
    if(k.pages&&typeof k.pages==="object")for(const d of ["sound","matrix","fx"])if(int(k.pages[d],0,40))s.pages[d]=k.pages[d];
  }catch{}
  return s;
}
const persist=()=>{clearTimeout(timer);timer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}},120);};

// ---------- settings: what a knob reads, writes, shows, and which graph the plot draws for it ----------
// kind: cycle (the patch's waveform at C3), response (the filter), adsr (that envelope), drive, glide, lfo2, lfo1,
// envelope (a decay), tilt (a tone), echoes (delay feedback), steps (an option), level (anything else)
let cycleDirty=true,custom=false;
const CYCLE=new Set([0,1,2,3,4,5,6,26,27,28,29,30,31,32,33,34,35,36,37]),RESPONSE=new Set([8,9,10,11,12]);
const ENV_OF={};for(const e of [AMP,FENV,MENV])for(const id of e)ENV_OF[id]=e;
function soundSpec(id){
  const fmt=v=>str(x.gs_param_text(id,v)),opt=x.gs_param_fmt(id)===SF_ENUM;
  const kind=ENV_OF[id]?"adsr":CYCLE.has(id)?"cycle":RESPONSE.has(id)?"response":id===7?"drive":id===17?"glide":[42,43,44].includes(id)?"lfo2":opt?"steps":"level";
  return {soundId:id,label:str(x.gs_param_name(id)),min:x.gs_param_min(id),max:x.gs_param_max(id),def:x.gs_param_def(id),fmt,kind,env:ENV_OF[id],
    get:()=>state.sound[id],set:v=>{if(!x.gs_set(id,v))return;state.sound[id]=v;send("set",{id,value:v});cycleDirty=true;markCustom();persist();}};
}
const modeSpec=()=>({flow:"mod",label:"MODE",min:0,max:1,def:1,kind:"steps",fmt:v=>v?"MONO":"POLY",get:()=>state.mono?1:0,
  set:v=>{state.mono=!!v;send("mono",{value:state.mono});x.gs_mono(v);cycleDirty=true;markCustom();persist();}});
const pct=v=>Math.round(v/1.27)+"%";
const levelSpec=()=>({flow:"amp",label:"LEVEL",min:0,max:127,def:100,kind:"level",fmt:pct,get:()=>state.level,set:v=>{state.level=v;send("level",{value:v});persist();}});
const page=(name,ids)=>({name,specs:ids.map(id=>id==="M"?modeSpec():id==="L"?levelSpec():soundSpec(id))});
// The firmware's EDIT and ENV pages, named, four knobs each, as the FM-1's four encoders.
const SOUND_PAGES=()=>[page("OSC",[0,1,2,3]),page("TONE",[4,5,6,7]),page("FILTER",[8,9,10,11]),page("AMP ENV",AMP),page("FILTER ENV",FENV),
  page("VOICE",["M",16,17,15]),page("TOUCH",[12,13,14,"L"]),page("OSC 2",[26,27,28,29]),page("SHAPER",[30,31,32,33]),
  page("MOD ENV",MENV),page("LFO 2",[42,43,44,45]),page("MACRO",[34,35,36,37])];
const MATRIX_PAGES=()=>[0,1,2,3,4,5].map(s=>{const src=SLOT0+3*s;return {name:"SLOT "+(s+1),specs:[
  {...soundSpec(src),label:"SOURCE",kind:"steps"},{...soundSpec(src+1),label:"DEST",kind:"steps"},{...soundSpec(src+2),label:"AMOUNT",kind:"level"}]};});
const LFO_SHAPES=["SINE","TRI","SAW","SQUARE","S&H"],LFO_DEST=["CUTOFF","PITCH","LEVEL","PWM","RESO","DETUNE","MIX","DRIVE","NOISE","SUB"];
const lfoHz=r=>.05*Math.pow(400,r/127);
const hzText=h=>(h<1?h.toFixed(2):h.toFixed(1))+" HZ";
function fxSpec(i,label,kind){
  const max=x.gs_fx_max(i),opt=max<127;
  return {fxId:i,label,min:0,max,def:x.gs_fx_def(i),kind:kind||(opt?"steps":"level"),fmt:v=>opt?str(x.gs_fx_option(i,v)):String(v),
    get:()=>state.fx[i],set:v=>{state.fx[i]=v;send("fx",{index:i,value:v});persist();}};
}
const lfoSpec=(k,label,min,max,def,fmt,kind)=>({trackLfo:true,label,min,max,def,fmt,kind,get:()=>state.lfo[k],set:v=>{state.lfo[k]=v;send("lfo",{value:state.lfo});persist();}});
const colorSpec=(k,label)=>({flow:"color",label,min:0,max:k===5?1:127,def:0,kind:k===5?"steps":"level",fmt:v=>k===5?(v?"ON":"OFF"):String(v),get:()=>state.color[k],
  set:v=>{state.color[k]=v;send("color",{index:k,value:v});x.gs_color(k,v);cycleDirty=true;markCustom();persist();}});
const mixSpec=(key,label,def,fmt,kind,write)=>({mixKey:key,label,min:0,max:127,def,fmt,kind,get:()=>state[key],set:v=>{state[key]=v;write(v);persist();}});
const FX_PAGES=()=>[
  {name:"LFO 1",specs:[lfoSpec(0,"SHAPE",0,4,0,v=>LFO_SHAPES[v],"lfo1"),lfoSpec(1,"RATE",0,127,40,v=>hzText(lfoHz(v)),"lfo1"),
    lfoSpec(2,"DEPTH",-64,63,0,v=>(v>0?"+":"")+v,"lfo1"),lfoSpec(3,"DEST",0,9,0,v=>LFO_DEST[v],"steps")]},
  {name:"COLOR",specs:[colorSpec(5,"COLOR"),colorSpec(0,"AMOUNT"),colorSpec(1,"WEAR"),colorSpec(2,"WOW")]},
  {name:"GRIT",specs:[colorSpec(3,"DIGITAL"),colorSpec(4,"DROP")]},
  {name:"MIX",specs:[mixSpec("rev","REVERB SEND",20,pct,"level",v=>send("send",{index:0,value:v})),mixSpec("dly","DELAY SEND",12,pct,"level",v=>send("send",{index:1,value:v})),
    mixSpec("pan","PAN",64,v=>v===64?"C":(v<64?"L":"R")+Math.abs(v-64),"level",v=>send("pan",{value:v})),{...fxSpec(0,"VOLUME"),fmt:pct}]},
  {name:"REVERB",specs:[fxSpec(4,"DECAY","envelope"),fxSpec(5,"TONE","tilt"),fxSpec(6,"LOW CUT","tilt"),fxSpec(7,"RETURN")]},
  {name:"DELAY",specs:[fxSpec(8,"TIME"),fxSpec(9,"FEEDBACK","echoes"),fxSpec(10,"TONE","tilt"),fxSpec(11,"RETURN")]},
  {name:"STEREO",specs:[fxSpec(15,"PING-PONG"),fxSpec(17,"WIDTH"),fxSpec(12,"LOW CUT","tilt")]},
  {name:"TAPE",specs:[fxSpec(13,"TYPE"),fxSpec(14,"WEAR")]}];

// ---------- the desk (STYLE.md section 6): named pages, arrows beside the knobs, a readout over the plot ----------
const desks={};
function makeDesk(name,pagesFn,modeFn){
  const root=document.querySelector(`[data-desk="${name}"]`);
  const d={name,root,canvas:root.querySelector(".plot-trace canvas"),box:root.querySelector(".desk-knobs"),tag:root.querySelector(".page-tag"),
    label:root.querySelector(".ro-label"),value:root.querySelector(".ro-value"),mode:root.querySelector(".ro-mode"),focus:0,specs:[],els:[],pagesFn,modeFn};
  d.arrows=[...root.querySelectorAll(".page-arrow")];
  d.arrows.forEach(b=>b.onclick=()=>turnPage(d,+b.dataset.dir));
  new ResizeObserver(()=>fitDesk(d)).observe(d.box);
  desks[name]=d;return d;
}
function buildDesk(d){
  const pages=d.pagesFn(),{index:pg,count,name,previous,next}=deskPosition(pages,state.pages[d.name]||0);
  state.pages[d.name]=pg;
  d.tag.value=name;
  d.tag.setAttribute("aria-label",`Page ${pg+1} of ${count}: ${name}`);
  for(const b of d.arrows){
    const back=+b.dataset.dir<0,neighbor=back?previous:next;
    b.title=`${back?"Previous":"Next"} page: ${neighbor}`;
    b.setAttribute("aria-label",b.title);
  }
  d.root.querySelector('[data-context="-1"]').textContent="‹ "+previous;
  d.root.querySelector('[data-context="1"]').textContent=next+" ›";
  d.specs=pages[pg].specs;d.box.replaceChildren();d.els=[];
  d.specs.forEach((s,slot)=>{
    const kn=knob({id:d.name+"-k"+slot,label:s.label,min:s.min,max:s.max,value:s.get(),def:s.def,fmt:s.fmt,onInput:v=>{s.set(v);focusSlot(d,slot);}});
    kn.addEventListener("focusin",()=>focusSlot(d,slot));kn.addEventListener("pointerdown",()=>focusSlot(d,slot));
    d.box.append(kn);d.els.push(kn);
  });
  fitDesk(d);focusSlot(d,Math.min(d.focus,d.specs.length-1));
}
function focusSlot(d,slot){d.focus=Math.max(0,slot);d.els.forEach((k,i)=>k.classList.toggle("on",i===d.focus));readout(d);}
const FLOW_LABELS={osc:["OSC","O","Oscillators"],shape:["SHP","S","Voice shaper"],drive:["DRV","D","Drive"],filter:["FLT","F","Filter"],amp:["AMP","A","Amplitude"],color:["CLR","C","COLOR insert"],dry:["DRY","DR","Dry mix"],room:["RVB","R","ROOM reverb"],delay:["DLY","DL","Delay"],out:["OUT","OUT","Output"],mod:["MOD","M","Control setting, no direct audio stage"]};
function highlightFlow(d,s){
  const flow=d.root.querySelector(".signal-flow"),order=signalStages(state),key=order.join(" ");
  if(flow.dataset.order!==key){
    const node=id=>make("span",FLOW_LABELS[id][0],{"data-stage":id,"data-small":FLOW_LABELS[id][1],title:FLOW_LABELS[id][2]});
    const sep=text=>make("span",text,{class:"signal-sep"});
    const nodes=[];
    for(const id of order){
      if(nodes.length)nodes.push(sep("›"));
      if(id==="parallel"){
        const branch=make("span",null,{class:"signal-branches",title:"Dry, ROOM reverb and delay in parallel"});
        branch.append(node("dry"),sep("+"),node("room"),sep("+"),node("delay"));nodes.push(branch);
      }else nodes.push(node(id));
    }
    nodes.push(node("mod"));
    const row=make("span",null,{class:"signal-chain","aria-hidden":"true"});
    row.append(...nodes);flow.replaceChildren(row);
    flow.setAttribute("role","img");flow.dataset.order=key;
  }
  const active=flowStages(s,state);
  for(const node of flow.querySelectorAll("[data-stage]"))node.classList.toggle("active",active.includes(node.dataset.stage));
  flow.setAttribute("aria-label","Signal flow: "+order.map(id=>id==="parallel"?"dry, ROOM reverb and delay in parallel":FLOW_LABELS[id][2]).join(", then ")+". Current setting: "+active.map(id=>FLOW_LABELS[id][2]).join(", ")+".");
}
const SHORT_READOUT={"SOURCE":"SRC","AMOUNT":"AMT","REVERB SEND":"RV SND","DELAY SEND":"DL SND","FEEDBACK":"FDBK","RESONANCE":"RES","LOW CUT":"LO CUT","PING-PONG":"PING","DECAY":"DEC","RETURN":"RTN","SHAPE":"SHP","VOLUME":"VOL","WIDTH":"WID"};
function readout(d){
  const s=d.specs[d.focus];if(!s)return;
  highlightFlow(d,s);
  const label=s.label.toUpperCase();
  d.label.textContent=label;d.label.dataset.short=SHORT_READOUT[label]||label;
  d.label.title=label;d.value.value=s.fmt(s.get()).toUpperCase();if(d.mode)d.mode.textContent=d.modeFn?.()||"";
}
function turnPage(d,dir){const n=d.pagesFn().length;state.pages[d.name]=((state.pages[d.name]||0)+dir+n)%n;d.focus=0;buildDesk(d);persist();}
// BongDrums' fit: the dial from the room in the row and the narrowest knob.
function fitDesk(d){
  const box=d.box,h=box.clientHeight;if(!h)return;
  let text=0,w=1e9;for(const k of box.querySelectorAll(".knob")){text=Math.max(text,(k.querySelector(".kl")?.offsetHeight||0)+(k.querySelector(".kv")?.offsetHeight||0));w=Math.min(w,k.clientWidth);}
  box.style.setProperty("--dial",Math.round(Math.max(40,Math.min(200,w-unit()*2,h-text-unit()*4)))+"px");
}
const rebuildDesks=()=>Object.values(desks).forEach(buildDesk);

// ---------- the plot: the touched setting's graph in accent, the live output faint behind it ----------
const trace=new Trace(1000);
let raw=null,voiced=null,L=null;
// Two cycles of the patch at C3, rendered by the page's own silent copy of the engine: the oscillators alone (filter,
// drive and shaper out of the way), then the voice as it is.
function grab(){
  if(!L||L.buffer!==x.memory.buffer)L=new Float32Array(x.memory.buffer,x.gs_left(),256);
  x.gs_kill();x.gs_note_on(48,100);
  const out=new Float32Array(2560);for(let b=0;b<60;b++){x.gs_render(128);if(b>=40)out.set(L.subarray(0,128),(b-40)*128);}
  x.gs_note_off(48);x.gs_kill();
  let s=300;for(let i=300;i<1600;i++)if(out[i-1]<=0&&out[i]>0){s=i;break;}
  return out.slice(s,s+675);
}
function computeCycle(){
  const open=[[8,127],[9,0],[10,0],[7,0],[31,0],[11,0]];
  for(const [id,v] of open)x.gs_set(id,v);raw=grab();
  for(const [id] of open)x.gs_set(id,state.sound[id]);voiced=grab();cycleDirty=false;
}
const hz=t=>{const m=/([\d.]+)\s*(K?)HZ/.exec(t);return m?+m[1]*(m[2]?1000:1):1;};
const lfoWave=(shape,ph,seed)=>{const p=ph-Math.floor(ph),r=n=>{const s=Math.sin((Math.floor(ph)+n)*12.9898+seed)*43758.5453;return (s-Math.floor(s))*2-1;};
  switch(shape){case "SINE":return Math.sin(2*Math.PI*p);case "TRI":case "TRIANGLE":return p<.5?4*p-1:3-4*p;case "SAW UP":return 2*p-1;case "SAW":case "SAW DOWN":return 1-2*p;
  case "SQUARE":return p<.5?1:-1;case "S&H":return r(0);case "SMOOTH":{const a=r(0),b=r(1),t=(1-Math.cos(Math.PI*p))/2;return a+(b-a)*t;}default:return 0;}};
const resample=(a,w,mid,amp)=>{if(!a)return null;let m=1e-6;for(const v of a)m=Math.max(m,Math.abs(v));const ys=[];for(let x0=0;x0<w;x0++)ys.push(mid-a[Math.floor(x0*a.length/w)]/m*amp*.9);return ys;};
function drawPlot(d,kindOverride){
  const c=d.canvas;if(!c?.clientWidth)return;
  const [g,w,h]=pixelCanvas(c),top=Math.round(h*.08),bot=Math.round(h*.92),mid=(top+bot)>>1,amp=(bot-top)/2;
  const C={bg:css("--screen"),grid:css("--screen-grid"),faint:css("--screen-faint"),ink:css("--screen-ink"),dim:css("--screen-dim"),trace:css("--screen-trace"),acc:css("--screen-accent"),alert:css("--screen-alert"),well:css("--screen-well")};
  screen(g,w,h,top,bot,C);
  const s=d.specs?.[d.focus],kind=kindOverride||s?.kind||"out",live=ctx?.state==="running";
  if(kind==="out"){const ys=live&&liveTrace(analyser,scopeBuf,w,mid,amp,true);if(ys)plot(g,ys,C.trace,2);return;}
  if(live){const ys=liveTrace(analyser,scopeBuf,w,mid,amp);if(ys)plot(g,ys,C.faint,1);}
  const v=s.get(),lo=s.min,hi=s.max,f=(v-lo)/(hi-lo||1),ys=[];
  if(kind==="steps"){const n=hi-lo+1,gap=n>8?1:3,bw=Math.max(1,Math.floor((w-(n+1)*gap)/n));for(let k=0;k<n;k++){g.fillStyle=k===v-lo?C.acc:C.well;g.fillRect(gap+k*(bw+gap),top+2,bw,bot-top-4);}return;}
  if(kind==="cycle"){if(cycleDirty)computeCycle();const r=resample(raw,w,mid,amp),vo=resample(voiced,w,mid,amp);if(r)plot(g,r,C.dim,1);if(vo)plot(g,vo,C.acc,2);return;}
  if(kind==="response"){
    const fc=hz(str(x.gs_param_text(8,state.sound[8]))),q=.6+Math.pow(state.sound[9]/127,2)*11,type=state.sound[11],db=dB=>top+(18-dB)/54*(bot-top);
    for(let x0=0;x0<w;x0++){const fr=20*Math.pow(1000,x0/(w-1)),r=fr/fc,den=Math.sqrt((1-r*r)**2+(r/q)**2),m=type===0?1/den:type===1?(r/q)/den:(r*r)/den;
      ys.push(db(Math.max(-36,Math.min(18,20*Math.log10(Math.max(m,1e-6))))));}
    g.fillStyle=C.alert;g.fillRect(Math.round(Math.log(fc/20)/Math.log(1000)*(w-1)),top,1,bot-top);plot(g,ys,C.acc,2);return;
  }
  if(kind==="adsr"){
    const [A,D,S,R]=s.env.map(id=>state.sound[id]),seg=w*.27,hold=w*.14,X0=2,T=top+1,B=bot-1;
    const ax=X0+A/127*seg,dx=ax+D/127*seg,sy=B-(B-T)*S/127,hx=dx+hold,rx=hx+R/127*seg;
    for(let x0=0;x0<w;x0++)ys.push(x0<X0?B:x0<ax?B-(B-T)*(x0-X0)/Math.max(1,ax-X0):x0<dx?T+(sy-T)*(x0-ax)/Math.max(1,dx-ax):x0<hx?sy:x0<rx?sy+(B-sy)*(x0-hx)/Math.max(1,rx-hx):B);
    plot(g,ys,C.acc,2);
    const corner=[[ax,T],[dx,sy],[hx,sy],[rx,B]][d.focus];g.fillStyle=C.ink;g.fillRect(Math.round(corner[0])-2,Math.round(corner[1])-2,5,5);
    if(s.env===AMP&&trace.last(1)>=0){const lv=Math.min(1,trace.last(0)/trace.max);g.fillStyle=C.alert;g.fillRect(0,Math.round(B-(B-T)*lv),w,1);}
    return;
  }
  const now=performance.now()/1000;
  if(kind==="lfo2"||kind==="lfo1"){
    // the read point stays in the centre and the wave scrolls through it
    const shape=kind==="lfo2"?str(x.gs_param_text(42,state.sound[42])):LFO_SHAPES[state.lfo[0]],rate=kind==="lfo2"?hz(str(x.gs_param_text(43,state.sound[43]))):lfoHz(state.lfo[1]);
    const depth=kind==="lfo1"?Math.abs(state.lfo[2])/64:1,cycles=Math.min(8,Math.max(1.5,rate*2)),span=cycles/rate;
    for(let x0=0;x0<w;x0++)ys.push(mid-lfoWave(shape,(now+(x0/(w-1)-.5)*span)*rate,7)*amp*.9*Math.max(.08,depth));
    plot(g,ys,C.acc,2);g.fillStyle=C.ink;g.fillRect(w>>1,top,1,bot-top);g.fillRect((w>>1)-2,Math.round(ys[w>>1])-2,5,5);return;
  }
  if(kind==="echoes"){const fb=.85*f;let a=1;for(let k=0;k<12&&a>.02;k++,a*=Math.max(fb,.0001)){const X=Math.round(4+k*(w-8)/11);g.fillStyle=k?C.acc:C.ink;g.fillRect(X,Math.round(bot-(bot-top)*a),2,Math.round((bot-top)*a));}return;}
  for(let x0=0;x0<w;x0++){const t=x0/(w-1);let y;
    if(kind==="envelope")y=Math.exp(-t/(.03+.9*f));
    else if(kind==="drive"){const gg=1+9*f;y=Math.tanh(gg*(2*t-1))/Math.tanh(gg);}
    else if(kind==="glide")y=f<.01?(t<.5?-.6:.6):-.6+1.2*(t<.5?0:1-Math.exp(-(t-.5)/(.01+.4*f*f)));
    else if(kind==="tilt")y=(1-2*t)*(1-2*f)*-1;
    else if(lo<0){const z=(0-lo)/(hi-lo);y=t>=Math.min(z,f)&&t<=Math.max(z,f)?1:-1;}
    else y=t<f?1:-1;
    ys.push(kind==="envelope"?bot-y*(bot-top):mid-y*amp);}
  plot(g,ys,C.acc,2);
}
function frame(){
  requestAnimationFrame(frame);if(document.hidden)return;
  const v=document.body.dataset.view;
  if(v==="keys")drawPlot({canvas:$("keys-scope")},"out");else if(desks[v])drawPlot(desks[v]);
}
// the hit light: every note the voice starts
function flashHit(accent){for(const l of document.querySelectorAll(".view .lcd-hit")){l.classList.remove("on","acc");void l.offsetWidth;l.classList.add("on");if(accent)l.classList.add("acc");}}

// ---------- SOUND: bank picker, P (the bank's sounds), AUDITION ----------
const soundName=i=>String(i+1).padStart(3,"0")+" "+str(x.gs_preset_name(i));
function viewSound(){
  $("bank-name").textContent=BANKS[bankOf(state.preset)][2];
  const n=soundName(state.preset);$("preset-p").title="Sound: "+n;$("preset-p").setAttribute("aria-label","Sound: "+n);
  $("preset-p").classList.toggle("custom",custom);$("keys-sound").textContent=n+(custom?" *":"");
}
function markCustom(){if(custom)return;custom=true;viewSound();for(const d of Object.values(desks))readout(d);}
function soundSheet(bank,from){
  const [a,b,name]=BANKS[bank],items=[];for(let i=a;i<Math.min(b,x.gs_presets());i++)items.push({value:i,label:str(x.gs_preset_name(i)),sub:String(i+1).padStart(3,"0")});
  openSheet("SOUND · "+name,items,custom?-1:state.preset,v=>loadPreset(+v),3,from);
}
function loadPreset(i){
  state.preset=i;state.mono=!!x.gs_preset(i);state.sound=state.sound.map((_,k)=>x.gs_get(k));
  for(let k=0;k<6;k++)state.color[k]=x.gs_color_get(k);
  send("preset",{value:i});send("mono",{value:state.mono});
  custom=false;cycleDirty=true;viewSound();rebuildDesks();persist();
}

// ---------- SEQ: 16 steps of note, accent and slide (a 303's line) ----------
const ROWS=["ON","NOTE","ACC","SLD"];let cells=[],heads=[],active=-1;
function drawStep(i){
  const [n,f]=state.steps[i],c=cells[i];
  c.on.setAttribute("aria-pressed",String(!!(f&1)));c.acc.setAttribute("aria-pressed",String(!!(f&2)));c.sld.setAttribute("aria-pressed",String(!!(f&4)));
  c.note.textContent=noteName(n);c.note.classList.toggle("off",!(f&1));c.note.setAttribute("aria-valuenow",n);c.note.setAttribute("aria-valuetext",noteName(n)+(f&1?"":" (off)"));
}
function setStep(i,n,f){n=Math.max(24,Math.min(84,n));state.steps[i]=[n,f];drawStep(i);send("step",{index:i,note:n,flags:f});persist();}
let popTimer=0;
function pop(label,value){const p=$("lcd-pop");p.querySelector("span").textContent=label;p.querySelector("output").value=value;p.classList.add("on");clearTimeout(popTimer);popTimer=setTimeout(()=>p.classList.remove("on"),1300);}
function buildSteps(){
  const grid=$("steps");
  ROWS.forEach((r,j)=>{const l=make("span",r,{class:"rlab"});l.style.setProperty("--r",j+2);l.style.setProperty("--pc",j+2);grid.append(l);});
  for(let i=0;i<16;i++){
    const col=2+i+Math.floor(i/4),sr=2+i+Math.floor(i/4);
    const hd=make("span",String(i+1).padStart(2,"0"),{class:"hrow"+(i%4===0?" beat":"")});hd.style.setProperty("--c",col);hd.style.setProperty("--sr",sr);grid.append(hd);heads.push(hd);
    const mk=(cls,r,label,tag="button")=>{const e=make(tag,"",{class:"cell "+cls,"aria-label":"Step "+(i+1)+" "+label});if(tag==="button")e.type="button";
      e.style.setProperty("--c",col);e.style.setProperty("--r",r);e.style.setProperty("--sr",sr);e.style.setProperty("--pc",r);grid.append(e);return e;};
    const on=mk("on",2,"on"),note=mk("note",3,"note","div"),acc=mk("acc",4,"accent"),sld=mk("sld",5,"slide");
    note.tabIndex=0;note.setAttribute("role","slider");note.setAttribute("aria-valuemin",24);note.setAttribute("aria-valuemax",84);
    cells.push({on,note,acc,sld});
    const flip=b=>()=>{const [n,f]=state.steps[i];setStep(i,n,f^b);};on.onclick=flip(1);acc.onclick=flip(2);sld.onclick=flip(4);
    const nudge=dn=>{const [n,f]=state.steps[i];setStep(i,n+dn,f|1);pop("STEP "+(i+1),noteName(state.steps[i][0]));preview(state.steps[i][0]);};
    let y0=0,n0=0,moved=false;
    note.addEventListener("pointerdown",e=>{e.preventDefault();note.setPointerCapture(e.pointerId);note.focus({preventScroll:true});y0=e.clientY;n0=state.steps[i][0];moved=false;});
    note.addEventListener("pointermove",e=>{if(!note.hasPointerCapture(e.pointerId))return;const n=Math.round(n0+(y0-e.clientY)/(unit()*5));if(n!==state.steps[i][0]){moved=true;setStep(i,n,state.steps[i][1]|1);pop("STEP "+(i+1),noteName(state.steps[i][0]));}});
    note.addEventListener("pointerup",e=>{if(!note.hasPointerCapture(e.pointerId))return;note.releasePointerCapture(e.pointerId);if(!moved){const [n,f]=state.steps[i];setStep(i,n,f^1);}else preview(state.steps[i][0]);});
    note.addEventListener("keydown",e=>{const dn={ArrowUp:1,ArrowDown:-1,PageUp:12,PageDown:-12}[e.key];if(dn){e.preventDefault();nudge(dn);}else if(e.key===" "||e.key==="Enter"){e.preventDefault();const [n,f]=state.steps[i];setStep(i,n,f^1);}});
    note.addEventListener("wheel",e=>{if(document.activeElement!==note)return;e.preventDefault();nudge(e.deltaY<0?1:-1);},{passive:false});
    drawStep(i);
  }
  const names=Object.keys(PHRASES);
  $("phrase-p").onclick=()=>openSheet("PHRASE",names.map(n=>({value:n,label:n})),"",v=>PHRASES[v].forEach(([n,f],i)=>setStep(i,n,f)),3,$("phrase-p"));
  $("seq-clear").onclick=()=>state.steps.forEach(([n],i)=>setStep(i,n,0));
  $("generate").onclick=generate;
  const tl=[...Array(49)].map((_,k)=>{const v=k-24;return (v>0?"+":"")+v+" ST";});
  stepper($("transpose"),tl,state.transpose+24,k=>{state.transpose=k-24;send("transpose",{value:state.transpose});persist();},{label:"Transpose"});
}
function markStep(s){
  if(s===active)return;
  if(active>=0){heads[active].classList.remove("current");Object.values(cells[active]).forEach(c=>c.classList.remove("current"));}
  active=s;if(active>=0){heads[active].classList.add("current");Object.values(cells[active]).forEach(c=>c.classList.add("current"));}
}
// A 303 line: C minor around C2, mostly on, some octave jumps, accents and slides.
function generate(){
  const scale=[0,3,5,7,10,12,15],r=()=>Math.random();
  for(let i=0;i<16;i++){const on=i%4===0?r()<.92:r()<.68;let n=36+scale[Math.floor(r()*r()*scale.length)];if(r()<.18)n+=12;
    setStep(i,n,(on?1:0)|(on&&r()<.28?2:0)|(on&&r()<.22?4:0));}
}
async function preview(n){if(playing||!(await enableAudio()))return;send("on",{note:n,vel:100});setTimeout(()=>send("off",{note:n}),180);}

// ---------- KEYS: the piano, octave arrows at its sides ----------
const KEYS="awsedftgyhujkolp;'";   // C up to F of the next octave
const held=new Map();let keyEls=[];
function octaveRead(){const span=window.innerWidth<641?1:2;$("oct-tag").value="C"+(state.octave-1)+"–C"+(state.octave-1+span);}
function lightKey(n,on){const k=keyEls[n-state.octave*12];if(k)k.classList.toggle("on",on);}
async function noteOn(who,n,vel){
  if(held.has(who))return;held.set(who,n);lightKey(n,true);$("keys-note").value=noteName(n);flashHit(vel>110);
  if(recording&&playing&&active>=0)setStep(active,n-state.transpose,1|(vel>110?2:0));
  if(await enableAudio())send("on",{note:n,vel});
}
function noteOff(who){const n=held.get(who);if(n===undefined)return;held.delete(who);if(![...held.values()].includes(n))lightKey(n,false);send("off",{note:n});}
function allOff(){for(const who of [...held.keys()])noteOff(who);send("panic");keyEls.forEach(k=>k.classList.remove("on"));}
function buildPiano(){
  const p=$("piano");p.replaceChildren();keyEls=[];
  const whites=[0,2,4,5,7,9,11],span=window.innerWidth<641?1:2,octs=span*12+1,fine=matchMedia("(pointer:fine)").matches;
  const wcount=[...Array(octs)].filter((_,i)=>whites.includes(i%12)).length;let w=0;
  for(let i=0;i<octs;i++){
    const isW=whites.includes(i%12),k=make("div",null,{class:isW?"w":"b","data-i":i});
    if(isW){if(fine&&KEYS[i])k.append(make("kbd",KEYS[i].toUpperCase()));k.append(make("span",i%12===0?"C"+(state.octave-1+Math.floor(i/12)):"",{class:"c"}));w++;}
    else{k.style.setProperty("left",`calc(${w/wcount*100}% - ${100/wcount*.32}%)`);k.style.setProperty("width",`${100/wcount*.64}%`);}
    keyEls[i]=k;p.append(k);
  }
  const hit=e=>document.elementFromPoint(e.clientX,e.clientY)?.closest?.(".piano [data-i]");
  p.onpointerdown=e=>{e.preventDefault();p.setPointerCapture(e.pointerId);const k=hit(e);if(k)noteOn("p"+e.pointerId,state.octave*12+ +k.dataset.i,e.shiftKey?127:100);};
  p.onpointermove=e=>{if(!p.hasPointerCapture(e.pointerId))return;const k=hit(e),who="p"+e.pointerId,n=k?state.octave*12+ +k.dataset.i:undefined;if(held.get(who)!==n){noteOff(who);if(n!==undefined)noteOn(who,n,100);}};
  const up=e=>noteOff("p"+e.pointerId);p.onpointerup=up;p.onpointercancel=up;octaveRead();
}
function octave(dn){const o=Math.max(1,Math.min(7,state.octave+dn));if(o===state.octave)return;allOff();state.octave=o;buildPiano();persist();}

// ---------- audio ----------
let lastAmp=0;
let bench=null;
function benchReadout(text,detail){
  const out=$("dsp-load");
  out.querySelector("b").textContent=text;
  out.setAttribute("aria-label","Browser DSP benchmark: "+text);
  out.title=detail;
  $("dsp-detail").textContent=detail;
}
function benchStop(text,detail){
  if(bench){clearTimeout(bench.timeout);bench.worker.terminate();bench=null;}
  $("dsp-run").disabled=false;
  benchReadout(text,detail);
}
function runBench(){
  if(bench)return;
  if(playing||held.size){benchReadout("—","Stop playback and release all notes before running.");return;}
  try{
    const worker=new Worker(new URL("./dsp-bench.mjs",import.meta.url),{type:"module"});
    const failed=()=>{if(bench?.worker===worker)benchStop("N/A","The browser could not complete the CPU benchmark.");};
    bench={worker,timeout:setTimeout(failed,25000)};
    $("dsp-run").disabled=true;
    benchReadout("…","Rendering the current sequence silently.");
    worker.onmessage=({data})=>{
      if(bench?.worker!==worker)return;
      if(!Number.isFinite(data.load)){failed();return;}
      const load=data.load<1?"<1%":Math.round(data.load)+"%";
      benchStop(load,"Last run: "+load+" of real-time duration for the sequence and sound at the time of the test. Not a live callback or FM‑1 reading.");
    };
    worker.onerror=failed;
    worker.postMessage({module,state});
  }catch{benchStop("N/A","The browser could not start the CPU benchmark.");}
}
async function enableAudio(){
  if(bench)benchStop("—","Benchmark cancelled to prioritize audio playback.");
  if(ctx?.state==="running"&&port)return true;
  if(connecting)return connecting;
  connecting=(async()=>{
    try{
      if(!ctx){ctx=new AudioContext({sampleRate:44100,latencyHint:"interactive"});if(ctx.sampleRate!==44100)throw Error("This browser did not provide a 44.1 kHz audio clock.");
        await ctx.audioWorklet.addModule(new URL("worklet.js",import.meta.url));
        node=new AudioWorkletNode(ctx,"bongsynth",{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{module}});
        node.connect(ctx.destination);port=node.port;
        analyser=ctx.createAnalyser();analyser.fftSize=2048;node.connect(analyser);
        port.onmessage=({data})=>{
          markStep(data.step);trace.push(data.trace);
          for(let i=0;i<data.trace.length;i+=4){const a=data.trace[i];if(lastAmp<=1e-4&&a>1e-4&&!held.size)flashHit(false);lastAmp=a;}
        };
        node.addEventListener("processorerror",()=>{setPlaying(false);info.textContent="Audio processor stopped. Reload to retry.";});
        send("state",{state});}
      await ctx.resume();if(ctx.state!=="running")throw Error("Audio is still suspended.");
      info.textContent=playing?"Playing":"Audio ready";return true;
    }catch(error){info.textContent=error.message;if(ctx){await ctx.close().catch(()=>{});ctx=null;port=null;analyser=null;}return false;}
    finally{connecting=null;}
  })();return connecting;
}
function setPlaying(v){playing=v;$("play").textContent=v?"■ STOP":"▶ PLAY";$("play").setAttribute("aria-pressed",String(v));info.textContent=v?"Playing":"Stopped";if(!v)markStep(-1);}
async function toggle(){if(playing){send("play",{value:false});setPlaying(false);return;}if(await enableAudio()){send("play",{value:true});setPlaying(true);}}
function setRec(v){recording=v;$("rec").setAttribute("aria-pressed",String(v));}

// ---------- sound files ----------
function exportSound(){
  const lines=["BONGSYNTH SOUND 1","BASE "+state.preset+" "+str(x.gs_preset_name(state.preset)),"MODE "+(state.mono?"MONO":"POLY"),"COLOR "+state.color.join(" ")];
  state.sound.forEach((v,k)=>lines.push("P "+k+" "+v+" # "+str(x.gs_param_name(k))));
  const a=make("a",null,{download:"bongsynth-"+str(x.gs_preset_name(state.preset)).toLowerCase().replace(/[^a-z0-9]+/g,"-")+".txt"});
  a.href=URL.createObjectURL(new Blob([lines.join("\n")+"\n"],{type:"text/plain"}));document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function importSound(file){
  const note=$("sound-notice");
  try{
    if(file.size>20000)throw Error("That file is too large.");
    const t=(await file.text()).split(/\r?\n/);if(t[0]!=="BONGSYNTH SOUND 1")throw Error("Not a BongSynth sound file.");
    let base=0,mono=true,color=null;const edits=[];
    for(const l of t.slice(1)){const w=l.split("#")[0].trim().split(/\s+/);
      if(w[0]==="BASE"&&int(+w[1],0,x.gs_presets()-1))base=+w[1];
      else if(w[0]==="MODE")mono=w[1]!=="POLY";
      else if(w[0]==="COLOR"){const c=w.slice(1).map(Number);if(c.length===6&&c.every((v,i)=>int(v,0,i===5?1:127)))color=c;}
      else if(w[0]==="P"){const k=+w[1],v=+w[2];if(int(k,0,x.gs_param_count()-1)&&int(v,x.gs_param_min(k),x.gs_param_max(k)))edits.push([k,v]);}}
    loadPreset(base);
    for(const [k,v] of edits)if(state.sound[k]!==v&&x.gs_set(k,v)){state.sound[k]=v;send("set",{id:k,value:v});custom=true;}
    if(color)color.forEach((v,i)=>{if(state.color[i]!==v)custom=true;state.color[i]=v;send("color",{index:i,value:v});x.gs_color(i,v);});
    if(state.mono!==mono){state.mono=mono;send("mono",{value:mono});x.gs_mono(mono?1:0);custom=true;}
    cycleDirty=true;viewSound();rebuildDesks();persist();note.textContent="Loaded "+file.name+".";
  }catch(e){note.textContent=e.message;}
}

// ---------- start ----------
try{
  const response=await fetch(new URL("bongsynth.wasm",import.meta.url));
  if(!response.ok)throw Error("Synth engine missing");
  module=await WebAssembly.compile(await response.arrayBuffer());x=boot(module);state=restore();apply(x,state);
  x.gs_send(0,0);x.gs_send(1,0);   // the page's own copy draws the oscillator scope: no reverb or delay in it
  {const probe=boot(module);const m=probe.gs_preset(state.preset);custom=state.sound.some((v,k)=>probe.gs_get(k)!==v)||state.color.some((v,i)=>probe.gs_color_get(i)!==v)||!!m!==state.mono;}
  wireSheet();
  makeDesk("sound",SOUND_PAGES,()=>soundName(state.preset)+(custom?" *":""));
  makeDesk("matrix",MATRIX_PAGES,()=>{const s=state.pages.matrix,src=SLOT0+3*s;return str(x.gs_param_text(src,state.sound[src]))+" → "+str(x.gs_param_text(src+1,state.sound[src+1]));});
  makeDesk("fx",FX_PAGES,()=>"");
  viewSound();rebuildDesks();buildSteps();buildPiano();requestAnimationFrame(frame);
  $("bank-pick").onclick=()=>openSheet("BANK",BANKS.map(([a,b,n],i)=>({value:i,label:n,sub:(b-a)+" SOUNDS"})),bankOf(state.preset),v=>soundSheet(+v,$("bank-pick")),3,$("bank-pick"));
  $("preset-p").onclick=()=>soundSheet(bankOf(state.preset),$("preset-p"));
  const au=$("audition");let auHeld=false;
  const auOn=async()=>{if(auHeld)return;auHeld=true;flashHit(false);if(await enableAudio()&&auHeld)send("on",{note:48,vel:100});};
  const auOff=()=>{if(!auHeld)return;auHeld=false;send("off",{note:48});};
  au.addEventListener("pointerdown",e=>{e.preventDefault();au.setPointerCapture(e.pointerId);auOn();});
  au.addEventListener("pointerup",auOff);au.addEventListener("pointercancel",auOff);au.addEventListener("lostpointercapture",auOff);
  au.addEventListener("keydown",e=>{if((e.key===" "||e.key==="Enter")&&!e.repeat){e.preventDefault();auOn();setTimeout(auOff,500);}});
  $("tempo").value=state.bpm;
  $("tempo").onchange=()=>{state.bpm=Math.round(Math.max(40,Math.min(240,+$("tempo").value||state.bpm)));$("tempo").value=state.bpm;send("tempo",{value:state.bpm*10});persist();};
  $("play").onclick=toggle;$("rec").onclick=()=>setRec(!recording);
  $("oct-down").onclick=()=>octave(-1);$("oct-up").onclick=()=>octave(1);
  const VIEWS=["sound","keys","sequence","matrix","fx"],tabs=[...document.querySelectorAll(".modes [data-tab]")];
  const view=t=>{
    if(!VIEWS.includes(t))t="sound";const changed=document.body.dataset.view!==t;document.body.dataset.view=t;
    tabs.forEach(b=>b.setAttribute("aria-selected",String(b.dataset.tab===t)));try{sessionStorage.setItem(KEY+"-view",t);}catch{}
    if(desks[t])fitDesk(desks[t]);
    if(changed){const s=$("screen");s.classList.remove("fringe");void s.offsetWidth;s.classList.add("fringe");}
  };
  tabs.forEach(b=>b.onclick=()=>view(b.dataset.tab));
  let saved="sound";try{saved=sessionStorage.getItem(KEY+"-view")||"sound";}catch{}view(saved);$("screen").classList.remove("fringe");
  const setFx=off=>{document.body.classList.toggle("fx-off",off);$("fx-off").checked=off;try{localStorage.setItem(KEY+"-fx",off?"off":"on");}catch{}};
  $("fx-off").onchange=()=>setFx($("fx-off").checked);try{setFx(localStorage.getItem(KEY+"-fx")==="off");}catch{}
  $("dsp-run").onclick=runBench;
  $("sound-export").onclick=exportSound;$("sound-file").onchange=()=>{const f=$("sound-file").files[0];if(f)importSound(f);$("sound-file").value="";};
  let narrow=window.innerWidth<641;addEventListener("resize",()=>{const n=window.innerWidth<641;if(n!==narrow){narrow=n;allOff();buildPiano();}});
  addEventListener("blur",allOff);
  document.addEventListener("keydown",e=>{
    if(e.metaKey||e.altKey||e.ctrlKey||!$("sheet").hidden)return;
    if(e.key==="Escape"){allOff();return;}
    if(e.target.closest("input,select,textarea,[contenteditable],[role=slider]"))return;
    const k=e.key.toLowerCase();
    if(e.code==="Space"&&!e.target.closest("button,summary,a")){e.preventDefault();if(!e.repeat)toggle();return;}
    if(e.key==="Enter"&&!e.target.closest("button,summary,a")){e.preventDefault();setRec(!recording);return;}
    if(k==="z"&&!e.repeat){octave(-1);return;}if(k==="x"&&!e.repeat){octave(1);return;}
    const i=KEYS.indexOf(k);if(i<0||e.repeat)return;e.preventDefault();noteOn("k"+k,state.octave*12+i,e.shiftKey?127:100);
  });
  document.addEventListener("keyup",e=>{const k=e.key.toLowerCase();if(KEYS.includes(k))noteOff("k"+k);});
}catch(error){info.textContent="BongSynth could not load: "+error.message;$("play").disabled=true;console.error(error);}
