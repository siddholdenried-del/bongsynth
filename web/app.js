import {boot,apply} from "./engine.js";
const $=id=>document.getElementById(id);
const make=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==null&&text!==undefined)e.textContent=text;for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
const info=$("status");
let x,module,ctx,node,port,connecting,playing=false,state,timer=0;
const send=(kind,value={})=>port?.postMessage({kind,...value});

// ---------- the engine's names ----------
const utf8=new TextDecoder();
const str=p=>{if(!p)return "";const v=new Uint8Array(x.memory.buffer);let e=p;while(e<v.length&&v[e]!==0)e++;return utf8.decode(v.subarray(p,e));};
const SF_ENUM=1;
const BANKS=[[0,24,"GHETTOMACHINE 0.2"],[24,45,"MOTOR CITY"],[45,66,"HOUSE"],[66,87,"ELECTRO"],[87,108,"WAREHOUSE"],[108,129,"DUB"]];
const NOTE=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const noteName=n=>NOTE[n%12]+(Math.floor(n/12)-1);
// The firmware's EDIT and ENV pages: four knobs each, as the FM-1's four encoders. "L" / "P" are the track's level / pan.
const PAGES=[["OSC",[0,1,2,3]],["TONE",[4,5,6,7]],["FILTER",[8,9,10,11]],["AMP ENV",[18,19,20,21]],["FILTER ENV",[22,23,24,25]],["MORE",[12,13,14,15]],["VOICE",[16,17,"L","P"]],
  null,["OSC 2",[26,27,28,29]],["SHAPER",[30,31,32,33]],["MOD ENV",[38,39,40,41]],["LFO 2",[42,43,44,45]],["MACRO",[34,35,36,37]]];
const SLOT0=46,SLOTS=6;

// ---------- the state ----------
const KEY="bongsynth-v1";
const FX_SHOWN={reverb:[4,5,6,7],delay:[8,9,10,11,12,13,14,15,17]};
const PHRASES={
  "ACID LINE":[[36,1],[36,0],[48,3],[36,1],[39,5],[41,1],[36,0],[46,3],[36,1],[36,1],[48,1],[43,5],[44,1],[36,0],[39,3],[34,1]],
  "OCTAVE PUMP":[[36,3],[48,1],[36,1],[48,1],[36,3],[48,1],[36,1],[48,5],[39,3],[51,1],[39,1],[51,1],[34,3],[46,1],[34,1],[46,5]],
  "DUB STEPS":[[36,3],[0,0],[0,0],[36,1],[0,0],[0,0],[43,1],[0,0],[39,3],[0,0],[0,0],[0,0],[41,5],[43,1],[0,0],[0,0]],
  "SLIDE RIDE":[[36,5],[39,5],[43,1],[36,0],[46,5],[43,5],[39,1],[36,0],[36,5],[41,5],[44,1],[36,0],[48,7],[46,5],[43,1],[39,0]],
  "STAB CHORDS":[[48,3],[0,0],[0,0],[48,1],[0,0],[0,0],[48,1],[0,0],[0,0],[0,0],[51,3],[0,0],[0,0],[46,1],[0,0],[0,0]],
};
const seed=()=>({preset:0,sound:[],mono:true,color:[0,0,0,0,0,0],level:100,pan:64,rev:20,dly:12,fx:[],bpm:124,transpose:0,
  lfo:[0,40,0,0],steps:PHRASES["ACID LINE"].map(([n,f])=>[n||36,f]),octave:4});
const int=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
function restore(){
  const s=seed();
  x.gs_preset(0);s.sound=[...Array(x.gs_param_count())].map((_,k)=>x.gs_get(k));s.mono=!!x.gs_is_mono();
  s.color=[...Array(6)].map((_,i)=>x.gs_color_get(i));
  s.fx=[...Array(x.gs_fx_count())].map((_,i)=>x.gs_fx_get(i));
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
  }catch{}
  return s;
}
const persist=()=>{clearTimeout(timer);timer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}},120);};

// ---------- a knob ----------
// spec: {label,min,max,value,def,text:v=>string,set:v=>void,enumish}
function knob(spec){
  const el=make("div",null,{class:"knob"+(spec.enumish?" enum":""),tabindex:0,role:"slider","aria-label":spec.label});
  const lab=make("span",spec.label,{class:"kl"}),dial=make("div",null,{class:"dial"}),val=make("span","",{class:"kv"});
  const NS="http://www.w3.org/2000/svg",svg=document.createElementNS(NS,"svg");svg.setAttribute("viewBox","-50 -50 100 100");
  const ticks=document.createElementNS(NS,"g");ticks.setAttribute("class","ticks");
  for(let i=0;i<=10;i++){const a=(-135+27*i)*Math.PI/180,l=document.createElementNS(NS,"line");
    l.setAttribute("x1",Math.sin(a)*42);l.setAttribute("y1",-Math.cos(a)*42);l.setAttribute("x2",Math.sin(a)*47);l.setAttribute("y2",-Math.cos(a)*47);ticks.append(l);}
  const face=document.createElementNS(NS,"circle");face.setAttribute("class","face");face.setAttribute("r",36);
  const fill=document.createElementNS(NS,"path");fill.setAttribute("class","fill");
  const ptr=document.createElementNS(NS,"line");ptr.setAttribute("class","ptr");ptr.setAttribute("x1",0);ptr.setAttribute("y1",-10);ptr.setAttribute("x2",0);ptr.setAttribute("y2",-33);
  svg.append(ticks,face,fill,ptr);dial.append(svg);el.append(lab,dial,val);
  let v=spec.value;const span=spec.max-spec.min||1;
  const arc=(a0,a1)=>{const r=40,p=a=>[Math.sin(a*Math.PI/180)*r,-Math.cos(a*Math.PI/180)*r];const [x0,y0]=p(a0),[x1,y1]=p(a1);return `M${x0} ${y0}A${r} ${r} 0 ${Math.abs(a1-a0)>180?1:0} ${a1>a0?1:0} ${x1} ${y1}`;};
  const draw=()=>{
    const a=-135+270*(v-spec.min)/span;ptr.setAttribute("transform",`rotate(${a})`);
    const from=spec.min<0?0:-135;const a0=spec.min<0?-135+270*(0-spec.min)/span:from;
    fill.setAttribute("d",Math.abs(a-a0)<.5?"":arc(Math.min(a0,a),Math.max(a0,a)));
    const t=spec.text(v);val.textContent=t;el.setAttribute("aria-valuemin",spec.min);el.setAttribute("aria-valuemax",spec.max);el.setAttribute("aria-valuenow",v);el.setAttribute("aria-valuetext",t);
  };
  const to=n=>{n=Math.max(spec.min,Math.min(spec.max,Math.round(n)));if(n===v)return;v=n;draw();spec.set(v);};
  let y0=0,v0=0,acc=0;
  dial.addEventListener("pointerdown",e=>{e.preventDefault();dial.setPointerCapture(e.pointerId);y0=e.clientY;v0=v;acc=0;el.classList.add("turning");el.focus({preventScroll:true});});
  dial.addEventListener("pointermove",e=>{if(!dial.hasPointerCapture(e.pointerId))return;const px=e.shiftKey?600:spec.enumish?Math.max(90,span*24):160;to(v0+(y0-e.clientY)/px*span);});
  const end=e=>{if(dial.hasPointerCapture?.(e.pointerId))dial.releasePointerCapture(e.pointerId);el.classList.remove("turning");};
  dial.addEventListener("pointerup",end);dial.addEventListener("pointercancel",end);
  dial.addEventListener("wheel",e=>{e.preventDefault();acc+=e.deltaY;const stepPx=spec.enumish?60:12;while(Math.abs(acc)>=stepPx){to(v+(acc<0?1:-1));acc-=Math.sign(acc)*stepPx;}},{passive:false});
  dial.addEventListener("dblclick",()=>to(spec.def));
  el.addEventListener("keydown",e=>{
    const big=Math.max(1,Math.round(span/8));
    const d={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1,PageUp:big,PageDown:-big}[e.key];
    if(d){e.preventDefault();to(v+d);}else if(e.key==="Home"){e.preventDefault();to(spec.min);}else if(e.key==="End"){e.preventDefault();to(spec.max);}
  });
  draw();
  return {el,setValue:n=>{v=n;draw();}};
}

// ---------- SOUND ----------
let page=0;const live={};   // knob handles on screen, by parameter id
function paramKnob(id){
  if(id==="L")return knob({label:"LEVEL",min:0,max:127,value:state.level,def:100,text:v=>Math.round(v/1.27)+"%",set:v=>{state.level=v;send("level",{value:v});persist();}});
  if(id==="P")return knob({label:"PAN",min:0,max:127,value:state.pan,def:64,text:v=>v===64?"C":(v<64?"L":"R")+Math.abs(v-64),set:v=>{state.pan=v;send("pan",{value:v});persist();}});
  const lo=x.gs_param_min(id),hi=x.gs_param_max(id);
  return knob({label:str(x.gs_param_name(id)),min:lo,max:hi,value:state.sound[id],def:x.gs_param_def(id),enumish:x.gs_param_fmt(id)===SF_ENUM,
    text:v=>str(x.gs_param_text(id,v)),set:v=>setParam(id,v)});
}
function setParam(id,v){if(!x.gs_set(id,v))return;state.sound[id]=v;send("set",{id,value:v});markCustom();persist();}
function showPage(i){
  page=i;const [name,ids]=PAGES[i];$("page-title").textContent=name;
  for(const b of $("pages").querySelectorAll("button"))b.setAttribute("aria-selected",String(+b.dataset.page===i));
  const area=$("knobs");area.replaceChildren();for(const k in live)delete live[k];
  for(const id of ids){const k=paramKnob(id);live[id]=k;area.append(k.el);}
}
function buildPages(){
  PAGES.forEach((p,i)=>{if(!p){$("pages").append(make("span",null,{class:"brk"}));return;}
    const b=make("button",p[0],{type:"button",role:"tab","data-page":i});b.onclick=()=>showPage(i);$("pages").append(b);});
}
function buildPresets(){
  const s=$("preset");s.append(make("option","CUSTOM",{value:-1,hidden:""}));
  for(const [a,b,name] of BANKS){const g=make("optgroup",null,{label:name});for(let i=a;i<Math.min(b,x.gs_presets());i++)g.append(make("option",String(i+1).padStart(3,"0")+" "+str(x.gs_preset_name(i)),{value:i}));s.append(g);}
}
let custom=false;
function markCustom(){if(custom)return;custom=true;const o=$("preset").querySelector("option[value='-1']");o.hidden=false;o.textContent="CUSTOM ("+str(x.gs_preset_name(state.preset))+")";$("preset").value="-1";}
function loadPreset(i){
  const n=x.gs_presets();i=((i%n)+n)%n;state.preset=i;
  state.mono=!!x.gs_preset(i);state.sound=state.sound.map((_,k)=>x.gs_get(k));
  for(let k=0;k<6;k++)state.color[k]=x.gs_color_get(k);
  send("preset",{value:i});send("mono",{value:state.mono});
  custom=false;$("preset").querySelector("option[value='-1']").hidden=true;$("preset").value=String(i);
  monoButtons();showPage(page);buildMatrix();refreshColor();persist();
}
function monoButtons(){for(const b of document.querySelectorAll("[data-mono]"))b.setAttribute("aria-pressed",String((b.dataset.mono==="1")===state.mono));}

// ---------- MATRIX ----------
function buildMatrix(){
  const area=$("matrix");area.replaceChildren();
  for(let s=0;s<SLOTS;s++){
    const src=SLOT0+3*s,dst=src+1,amt=src+2,row=make("div",null,{class:"slot"+(state.sound[src]===0?" off":"")});
    row.append(make("b",String(s+1)));
    for(const id of [src,dst]){
      const sel=make("select",null,{"aria-label":"Slot "+(s+1)+(id===src?" source":" destination")});
      for(let v=x.gs_param_min(id);v<=x.gs_param_max(id);v++)sel.append(make("option",str(x.gs_param_text(id,v)),{value:v}));
      sel.value=state.sound[id];sel.onchange=()=>{setParam(id,+sel.value);row.classList.toggle("off",state.sound[src]===0);};row.append(sel);
    }
    const k=knob({label:"Slot "+(s+1)+" amount",min:-64,max:63,value:state.sound[amt],def:0,text:v=>str(x.gs_param_text(amt,v)),set:v=>setParam(amt,v)});
    row.append(k.el);area.append(row);
  }
}

// ---------- EFFECTS ----------
const LFO_SHAPES=["SINE","TRI","SAW","SQUARE","S&H"],LFO_DEST=["CUTOFF","PITCH","LEVEL","PWM","RESO","DETUNE","MIX","DRIVE","NOISE","SUB"];
const lfoHz=r=>.05*Math.pow(400,r/127);
const COLOR_NAMES=["AMOUNT","WEAR","WOW","DIGITAL","DROP"];
let colorKnobs=[];
function refreshColor(){
  for(const b of document.querySelectorAll("[data-color]"))b.setAttribute("aria-pressed",String(+b.dataset.color===state.color[5]));
  colorKnobs.forEach((k,i)=>k.setValue(state.color[i]));
}
function buildEffects(){
  const sendLfo=()=>{send("lfo",{value:state.lfo});persist();};
  const L=[
    knob({label:"SHAPE",min:0,max:4,value:state.lfo[0],def:0,enumish:true,text:v=>LFO_SHAPES[v],set:v=>{state.lfo[0]=v;sendLfo();}}),
    knob({label:"RATE",min:0,max:127,value:state.lfo[1],def:40,text:v=>{const h=lfoHz(v);return (h<1?h.toFixed(2):h.toFixed(1))+" HZ";},set:v=>{state.lfo[1]=v;sendLfo();}}),
    knob({label:"DEPTH",min:-64,max:63,value:state.lfo[2],def:0,text:v=>(v>0?"+":"")+v,set:v=>{state.lfo[2]=v;sendLfo();}}),
    knob({label:"DEST",min:0,max:9,value:state.lfo[3],def:0,enumish:true,text:v=>LFO_DEST[v],set:v=>{state.lfo[3]=v;sendLfo();}})];
  $("lfo").append(...L.map(k=>k.el));
  colorKnobs=COLOR_NAMES.map((n,i)=>knob({label:n,min:0,max:127,value:state.color[i],def:0,text:v=>String(v),set:v=>{state.color[i]=v;send("color",{index:i,value:v});markCustom();persist();}}));
  $("color").append(...colorKnobs.map(k=>k.el));
  for(const b of document.querySelectorAll("[data-color]"))b.onclick=()=>{state.color[5]=+b.dataset.color;send("color",{index:5,value:state.color[5]});refreshColor();markCustom();persist();};
  const pct=v=>Math.round(v/1.27)+"%";
  $("mix").append(
    knob({label:"REVERB SEND",min:0,max:127,value:state.rev,def:20,text:pct,set:v=>{state.rev=v;send("send",{index:0,value:v});persist();}}).el,
    knob({label:"DELAY SEND",min:0,max:127,value:state.dly,def:12,text:pct,set:v=>{state.dly=v;send("send",{index:1,value:v});persist();}}).el,
    knob({label:"VOLUME",min:0,max:127,value:state.fx[0],def:x.gs_fx_def(0),text:pct,set:v=>{state.fx[0]=v;send("fx",{index:0,value:v});persist();}}).el);
  const NICE={RvDec:"DECAY",RvTone:"TONE",RvHPF:"LOW CUT",RvLvl:"RETURN",DlTime:"TIME",DlFdbk:"FEEDBACK",DlTone:"TONE",DlLvl:"RETURN",DlHPF:"LOW CUT",DlType:"TYPE",Wear:"WEAR",Ping:"PING-PONG",Width:"WIDTH"};
  for(const [where,ids] of Object.entries(FX_SHOWN))for(const i of ids){
    const max=x.gs_fx_max(i),opt=max<127;
    $(where).append(knob({label:NICE[str(x.gs_fx_name(i))]||str(x.gs_fx_name(i)),min:0,max,value:state.fx[i],def:x.gs_fx_def(i),enumish:opt,
      text:v=>opt?str(x.gs_fx_option(i,v)):String(v),set:v=>{state.fx[i]=v;send("fx",{index:i,value:v});persist();}}).el);
  }
  refreshColor();
}

// ---------- SEQUENCE ----------
let stepEls=[],active=-1;
function drawStep(i){
  const [n,f]=state.steps[i],e=stepEls[i];
  e.root.classList.toggle("off",!(f&1));e.lamp.setAttribute("aria-pressed",String(!!(f&1)));
  e.note.textContent=noteName(n);e.note.setAttribute("aria-valuenow",n);e.note.setAttribute("aria-valuetext",noteName(n));
  e.acc.setAttribute("aria-pressed",String(!!(f&2)));e.sld.setAttribute("aria-pressed",String(!!(f&4)));
}
function setStep(i,n,f){
  n=Math.max(24,Math.min(84,n));state.steps[i]=[n,f];drawStep(i);send("step",{index:i,note:n,flags:f});persist();
}
function buildSteps(){
  const area=$("steps");
  for(let i=0;i<16;i++){
    const root=make("div",null,{class:"step"}),num=make("span",String(i+1).padStart(2,"0"),{class:"num"});
    const lamp=make("button","",{type:"button",class:"lamp-btn","aria-label":"Step "+(i+1)+" on"});
    const note=make("div","",{class:"note",tabindex:0,role:"slider","aria-label":"Step "+(i+1)+" note","aria-valuemin":24,"aria-valuemax":84});
    const arrows=make("div",null,{class:"arrows"}),up=make("button","▲",{type:"button","aria-label":"Step "+(i+1)+" up a semitone"}),dn=make("button","▼",{type:"button","aria-label":"Step "+(i+1)+" down a semitone"});
    arrows.append(up,dn);
    const acc=make("button","ACC",{type:"button",class:"flag acc","aria-label":"Step "+(i+1)+" accent"}),sld=make("button","SLD",{type:"button",class:"flag sld","aria-label":"Step "+(i+1)+" slide"});
    root.append(num,lamp,note,arrows,acc,sld);area.append(root);stepEls.push({root,lamp,note,acc,sld});
    const nudge=d=>{const [n,f]=state.steps[i];setStep(i,n+d,f);if(f&1)preview(state.steps[i][0]);};
    lamp.onclick=()=>{const [n,f]=state.steps[i];setStep(i,n,f^1);};
    acc.onclick=()=>{const [n,f]=state.steps[i];setStep(i,n,f^2);};
    sld.onclick=()=>{const [n,f]=state.steps[i];setStep(i,n,f^4);};
    up.onclick=()=>nudge(1);dn.onclick=()=>nudge(-1);
    let y0=0,n0=0;
    note.addEventListener("pointerdown",e=>{e.preventDefault();note.setPointerCapture(e.pointerId);y0=e.clientY;n0=state.steps[i][0];note.focus({preventScroll:true});});
    note.addEventListener("pointermove",e=>{if(!note.hasPointerCapture(e.pointerId))return;const n=Math.round(n0+(y0-e.clientY)/12);if(n!==state.steps[i][0]){setStep(i,n,state.steps[i][1]|1);}});
    note.addEventListener("pointerup",e=>{note.releasePointerCapture(e.pointerId);preview(state.steps[i][0]);});
    note.addEventListener("keydown",e=>{const d={ArrowUp:1,ArrowDown:-1,PageUp:12,PageDown:-12}[e.key];if(d){e.preventDefault();nudge(d);}});
    drawStep(i);
  }
  const ph=$("phrase");ph.append(make("option","CHOOSE A PHRASE",{value:""}));for(const k of Object.keys(PHRASES))ph.append(make("option",k,{value:k}));
  ph.onchange=()=>{const p=PHRASES[ph.value];if(!p)return;p.forEach(([n,f],i)=>setStep(i,n||state.steps[i][0],f));ph.value="";};
  $("seq-clear").onclick=()=>state.steps.forEach(([n],i)=>setStep(i,n,0));
  $("generate").onclick=generate;
  $("transpose-slot").append(knob({label:"TRANSPOSE",min:-24,max:24,value:state.transpose,def:0,text:v=>(v>0?"+":"")+v+" ST",set:v=>{state.transpose=v;send("transpose",{value:v});persist();}}).el);
}
// A 303 line: C minor pentatonic-ish around C2, mostly on, some octave jumps, accents and slides.
function generate(){
  const scale=[0,3,5,7,10,12,15],r=()=>Math.random();
  for(let i=0;i<16;i++){
    const on=i%4===0?r()<.92:r()<.68;let n=36+scale[Math.floor(r()*r()*scale.length)];if(r()<.18)n+=12;
    setStep(i,n,(on?1:0)|(on&&r()<.28?2:0)|(on&&r()<.22?4:0));
  }
}
async function preview(n){if(playing||!(await enableAudio()))return;send("on",{note:n,vel:100});setTimeout(()=>send("off",{note:n}),180);}

// ---------- the keyboard ----------
const KEYS="awsedftgyhujkolp;'";   // C up to F of the next octave
const held=new Map();             // a pressing (key or pointer) -> its note
let keyEls=[];
function octaveRead(){$("oct-read").textContent="C"+(state.octave-1);}
function lightKey(n,on){const k=keyEls[n-state.octave*12];if(k)k.classList.toggle("on",on);}
async function noteOn(who,n,vel){
  if(held.has(who))return;held.set(who,n);lightKey(n,true);
  if(await enableAudio())send("on",{note:n,vel});
}
function noteOff(who){const n=held.get(who);if(n===undefined)return;held.delete(who);if(![...held.values()].includes(n))lightKey(n,false);send("off",{note:n});}
function allOff(){for(const who of [...held.keys()])noteOff(who);send("panic");keyEls.forEach(k=>k.classList.remove("on"));}
function buildPiano(){
  const p=$("piano");p.replaceChildren();keyEls=[];
  const whites=[0,2,4,5,7,9,11],span=window.innerWidth<560?1:2,octs=span*12+1;
  const wcount=[...Array(octs)].filter((_,i)=>whites.includes(i%12)).length;
  let w=0;
  for(let i=0;i<octs;i++){
    const isW=whites.includes(i%12),k=make("div",null,{class:isW?"w":"b","data-i":i});
    const hint=KEYS[i];if(isW){const lab=make("span",i%12===0?"C"+(state.octave-1+Math.floor(i/12)):"");k.append(lab);if(hint&&window.matchMedia("(pointer:fine)").matches)k.append(make("kbd",hint.toUpperCase()));w++;}
    else{k.style.left=`calc(${w/wcount*100}% - ${100/wcount*.3}%)`;k.style.width=`${100/wcount*.6}%`;}
    keyEls[i]=k;p.append(k);
  }
  const hit=e=>{const el=document.elementFromPoint(e.clientX,e.clientY);return el?.closest?.(".piano [data-i]");};
  p.onpointerdown=e=>{e.preventDefault();p.setPointerCapture(e.pointerId);const k=hit(e);if(k)noteOn("p"+e.pointerId,state.octave*12+ +k.dataset.i,e.shiftKey?127:100);};
  p.onpointermove=e=>{if(!p.hasPointerCapture(e.pointerId))return;const k=hit(e),who="p"+e.pointerId;const n=k?state.octave*12+ +k.dataset.i:undefined;if(held.get(who)!==n){noteOff(who);if(n!==undefined)noteOn(who,n,100);}};
  const up=e=>noteOff("p"+e.pointerId);p.onpointerup=up;p.onpointercancel=up;
}
function octave(d){const o=Math.max(1,Math.min(7,state.octave+d));if(o===state.octave)return;allOff();state.octave=o;octaveRead();buildPiano();persist();}

// ---------- audio ----------
async function enableAudio(){
  if(ctx?.state==="running"&&port)return true;
  if(connecting)return connecting;
  connecting=(async()=>{
    try{
      if(!ctx){ctx=new AudioContext({sampleRate:44100,latencyHint:"interactive"});if(ctx.sampleRate!==44100)throw Error("This browser did not provide a 44.1 kHz audio clock.");
        await ctx.audioWorklet.addModule(new URL("worklet.js",import.meta.url));
        node=new AudioWorkletNode(ctx,"bongsynth",{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{module}});
        node.connect(ctx.destination);port=node.port;
        port.onmessage=({data})=>{
          if(data.step!==active){if(active>=0)stepEls[active].root.classList.remove("current");active=data.step;if(active>=0)stepEls[active].root.classList.add("current");}
          const db=data.peak>0?20*Math.log10(data.peak):-90,bar=$("out-bar");bar.style.width=Math.max(0,Math.min(100,(db+48)/48*100))+"%";bar.classList.toggle("hot",db>-1);
          $("voices").textContent=data.voices+(data.voices===1?" VOICE":" VOICES");
        };
        node.addEventListener("processorerror",()=>{info.textContent="Audio processor stopped. Reload to retry.";playing=false;});
        send("state",{state});}
      await ctx.resume();if(ctx.state!=="running")throw Error("Audio is still suspended.");
      info.textContent=playing?"Playing":"Audio ready";return true;
    }catch(error){info.textContent=error.message;if(ctx){await ctx.close().catch(()=>{});ctx=null;port=null;}return false;}
    finally{connecting=null;}
  })();return connecting;
}
async function toggle(){
  if(playing){playing=false;send("play",{value:false});$("play").textContent="▶ PLAY";$("play").setAttribute("aria-pressed","false");info.textContent="Stopped";return;}
  if(await enableAudio()){playing=true;send("play",{value:true});$("play").textContent="■ STOP";$("play").setAttribute("aria-pressed","true");info.textContent="Playing";}
}

// ---------- sound files ----------
function exportSound(){
  const lines=["BONGSYNTH SOUND 1","BASE "+state.preset+" "+str(x.gs_preset_name(state.preset)),"MODE "+(state.mono?"MONO":"POLY"),"COLOR "+state.color.join(" ")];
  state.sound.forEach((v,k)=>lines.push("P "+k+" "+v+" # "+str(x.gs_param_name(k))));
  const a=make("a",null,{download:"bongsynth-"+str(x.gs_preset_name(state.preset)).toLowerCase().replace(/[^a-z0-9]+/g,"-")+".txt"});
  a.href=URL.createObjectURL(new Blob([lines.join("\n")+"\n"],{type:"text/plain"}));a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
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
    loadPreset(base);for(const [k,v] of edits)if(state.sound[k]!==v)setParam(k,v);
    if(color)color.forEach((v,i)=>{state.color[i]=v;send("color",{index:i,value:v});});
    state.mono=mono;send("mono",{value:mono});monoButtons();refreshColor();showPage(page);buildMatrix();persist();
    note.textContent="Loaded "+file.name+".";
  }catch(e){note.textContent=e.message;}
}

// ---------- start ----------
try{
  const response=await fetch(new URL("bongsynth.wasm",import.meta.url));
  if(!response.ok)throw Error("Synth engine missing");
  module=await WebAssembly.compile(await response.arrayBuffer());x=boot(module);state=restore();apply(x,state);
  buildPresets();buildPages();buildEffects();buildSteps();
  $("preset").value=String(state.preset);
  {const probe=boot(module);probe.gs_preset(state.preset);if(state.sound.some((v,k)=>probe.gs_get(k)!==v)||state.color.some((v,i)=>probe.gs_color_get(i)!==v))markCustom();}
  monoButtons();showPage(0);buildMatrix();octaveRead();buildPiano();
  $("preset").onchange=()=>{const v=+$("preset").value;if(v>=0)loadPreset(v);};
  $("preset-prev").onclick=()=>loadPreset(state.preset-1);$("preset-next").onclick=()=>loadPreset(state.preset+1);
  for(const b of document.querySelectorAll("[data-mono]"))b.onclick=()=>{state.mono=b.dataset.mono==="1";send("mono",{value:state.mono});monoButtons();markCustom();persist();};
  $("tempo").value=state.bpm;
  $("tempo").onchange=()=>{state.bpm=Math.round(Math.max(40,Math.min(240,+$("tempo").value||state.bpm)));$("tempo").value=state.bpm;send("tempo",{value:state.bpm*10});persist();};
  $("play").onclick=toggle;
  $("oct-down").onclick=()=>octave(-1);$("oct-up").onclick=()=>octave(1);
  const tabs=[...document.querySelectorAll("[data-tab]")];
  const view=v=>{document.body.dataset.view=v;tabs.forEach(t=>t.setAttribute("aria-selected",String(t.dataset.tab===v)));try{sessionStorage.setItem(KEY+"-view",v);}catch{}};
  tabs.forEach(t=>t.onclick=()=>view(t.dataset.tab));
  let saved="sound";try{saved=sessionStorage.getItem(KEY+"-view")||"sound";}catch{}view(tabs.some(t=>t.dataset.tab===saved)?saved:"sound");
  $("fx-off").onchange=()=>{document.body.classList.toggle("fx-off",$("fx-off").checked);try{localStorage.setItem(KEY+"-fx",$("fx-off").checked?"off":"on");}catch{}};
  try{if(localStorage.getItem(KEY+"-fx")==="off"){$("fx-off").checked=true;document.body.classList.add("fx-off");}}catch{}
  $("sound-export").onclick=exportSound;$("sound-file").onchange=()=>{const f=$("sound-file").files[0];if(f)importSound(f);$("sound-file").value="";};
  let narrow=window.innerWidth<560;addEventListener("resize",()=>{const n=window.innerWidth<560;if(n!==narrow){narrow=n;allOff();buildPiano();}});
  addEventListener("blur",allOff);
  document.addEventListener("keydown",e=>{
    if(e.metaKey||e.altKey||e.ctrlKey)return;
    if(e.key==="Escape"){allOff();return;}
    if(e.target.closest("input,select,textarea,[contenteditable]"))return;
    const k=e.key.toLowerCase();
    if(e.code==="Space"&&!e.target.closest("button,summary,a,.knob,.note")){e.preventDefault();if(!e.repeat)toggle();return;}
    if(e.target.closest(".knob,.note"))return;
    if(k==="z"&&!e.repeat){octave(-1);return;}if(k==="x"&&!e.repeat){octave(1);return;}
    const i=KEYS.indexOf(k);if(i<0||e.repeat)return;e.preventDefault();noteOn("k"+k,state.octave*12+i,e.shiftKey?127:100);
  });
  document.addEventListener("keyup",e=>{const k=e.key.toLowerCase();if(KEYS.includes(k))noteOff("k"+k);});
}catch(error){info.textContent="BongSynth could not load: "+error.message;$("play").disabled=true;}
