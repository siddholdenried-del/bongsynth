// BongSynth's controls, taken from BongDrums (web/app.js, v0.4.2 desk): the knob, its dial drawing, and the tile sheet.
export const $=id=>document.getElementById(id);
export const make=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==null&&text!==undefined)e.textContent=text;for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};

const DIAL=`<svg viewBox="0 0 48 48"><g class="ticks"><line x1="9.50" y1="38.50" x2="7.38" y2="40.62"/><line x1="4.50" y1="30.33" x2="1.65" y2="31.26"/><line x1="3.75" y1="20.79" x2="0.79" y2="20.32"/><line x1="7.42" y1="11.95" x2="4.99" y2="10.19"/><line x1="14.69" y1="5.73" x2="13.33" y2="3.06"/><line x1="24.00" y1="3.50" x2="24.00" y2="0.50"/><line x1="33.31" y1="5.73" x2="34.67" y2="3.06"/><line x1="40.58" y1="11.95" x2="43.01" y2="10.19"/><line x1="44.25" y1="20.79" x2="47.21" y2="20.32"/><line x1="43.50" y1="30.33" x2="46.35" y2="31.26"/><line x1="38.50" y1="38.50" x2="40.62" y2="40.62"/></g><circle class="face" cx="24" cy="24" r="17.5"/><path class="fill"/><line class="ptr" x1="24" y1="24" x2="24" y2="10"/></svg>`;
const polar=a=>{const r=(a-90)*Math.PI/180;return [24+17.5*Math.cos(r),24+17.5*Math.sin(r)];};
const arc=(a0,a1)=>{if(Math.abs(a1-a0)<.5)return "";const [x0,y0]=polar(Math.min(a0,a1)),[x1,y1]=polar(Math.max(a0,a1));return `M${x0.toFixed(2)} ${y0.toFixed(2)}A17.5 17.5 0 ${Math.abs(a1-a0)>180?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;};
// A knob: a hidden range input (the value, keyboard and screen readers) and a drawn dial (drag up/down, Shift fine,
// wheel, double-click to reset). wrap.set(v) redraws without firing onInput.
export function knob({id,label,min,max,value,def=value,fmt=String,onInput,cls=""}){
  const wrap=make("div",null,{class:"knob "+cls});
  const input=make("input",null,{type:"range",id,min,max,step:1,class:"knob-input"});input.value=value;
  const lab=make("label",label.toUpperCase(),{for:id,class:"kl"});
  const dial=make("div",null,{class:"dial","aria-hidden":"true"});dial.innerHTML=DIAL;
  const fill=dial.querySelector(".fill"),ptr=dial.querySelector(".ptr");
  const out=make("output",null,{for:id,class:"kv"});
  wrap.append(lab,dial,out,input);
  const span=max-min,origin=min<0&&max>0?0:min,angle=v=>-135+270*(v-min)/span;
  const draw=()=>{const v=+input.value;fill.setAttribute("d",arc(angle(origin),angle(v)));ptr.setAttribute("transform",`rotate(${angle(v)} 24 24)`);
    const t=fmt(v).toUpperCase();out.value=t;input.setAttribute("aria-valuetext",t);};
  const commit=v=>{v=Math.max(min,Math.min(max,Math.round(v)));if(v===+input.value)return;input.value=v;input.dispatchEvent(new Event("input",{bubbles:true}));};
  input.addEventListener("input",()=>{draw();onInput(+input.value);});
  input.addEventListener("keydown",e=>{
    const step=Math.max(1,Math.round(span/100)),page=Math.max(1,Math.round(span/10));
    const d={ArrowUp:step,ArrowRight:step,ArrowDown:-step,ArrowLeft:-step,PageUp:page,PageDown:-page}[e.key];
    if(d){e.preventDefault();commit(+input.value+(e.shiftKey?Math.sign(d):d));}
    else if(e.key==="Home"||e.key==="End"){e.preventDefault();commit(e.key==="Home"?min:max);}
  });
  dial.addEventListener("pointerdown",e=>{
    e.preventDefault();dial.setPointerCapture(e.pointerId);input.focus({preventScroll:true});
    const y0=e.clientY,v0=+input.value;wrap.classList.add("turning");
    const move=ev=>commit(v0+(y0-ev.clientY)/(ev.shiftKey?700:170)*span);
    const up=()=>{wrap.classList.remove("turning");dial.removeEventListener("pointermove",move);dial.removeEventListener("pointerup",up);dial.removeEventListener("pointercancel",up);};
    dial.addEventListener("pointermove",move);dial.addEventListener("pointerup",up);dial.addEventListener("pointercancel",up);
  });
  dial.addEventListener("dblclick",()=>commit(def));
  dial.addEventListener("wheel",e=>{e.preventDefault();commit(+input.value+(e.deltaY<0?1:-1)*Math.max(1,Math.round(span/(e.shiftKey?400:60))));},{passive:false});
  wrap.input=input;wrap.set=v=>{input.value=v;draw();};
  draw();return wrap;
}

// The tile sheet: one big grid of choices instead of a native dropdown (Escape, a click outside, or ✕ closes it).
let sheetReturn=null;
export function openSheet(title,items,current,onPick,cols,from){
  const sheet=$("sheet"),grid=$("sheet-grid");$("sheet-title").textContent=title;
  grid.style.setProperty("--cols",cols);grid.replaceChildren();
  let first=null;
  for(const it of items){
    const b=make("button",null,{type:"button",class:"tile","aria-pressed":String(String(it.value)===String(current))});
    b.append(make("b",it.label));if(it.sub)b.append(make("small",it.sub));
    b.onclick=()=>{closeSheet();onPick(it.value);};grid.append(b);
    if(String(it.value)===String(current)||!first)first=String(it.value)===String(current)?b:first||b;
  }
  sheetReturn=from;sheet.hidden=false;(grid.querySelector("[aria-pressed=true]")||first)?.focus({preventScroll:true});
}
export function closeSheet(){const s=$("sheet");if(s.hidden)return;s.hidden=true;sheetReturn?.focus({preventScroll:true});sheetReturn=null;}
export function wireSheet(){
  $("sheet-close").onclick=closeSheet;
  $("sheet").addEventListener("pointerdown",e=>{if(e.target.id==="sheet")closeSheet();});
  $("sheet").addEventListener("keydown",e=>{
    if(e.key==="Escape"){e.preventDefault();closeSheet();return;}
    const tiles=[...$("sheet-grid").children],i=tiles.indexOf(document.activeElement);if(i<0)return;
    const cols=getComputedStyle($("sheet-grid")).gridTemplateColumns.split(" ").length;
    const d={ArrowRight:1,ArrowLeft:-1,ArrowDown:cols,ArrowUp:-cols}[e.key];
    if(d){e.preventDefault();tiles[Math.max(0,Math.min(tiles.length-1,i+d))].focus();}
  });
}

// One framed bar for every arrow control: ‹ | selection | ›.
export function stepBar(middle,prev,next,label){
  const bar=make("div",null,{class:"stepbar",role:"group"});if(label)bar.setAttribute("aria-label",label);
  const a=make("button","‹",{type:"button",class:"arrow","aria-label":"Previous "+(label||"").toLowerCase()}),b=make("button","›",{type:"button",class:"arrow","aria-label":"Next "+(label||"").toLowerCase()});
  a.onclick=prev;b.onclick=next;bar.append(a,middle,b);return bar;
}
// More than three options: a stepper bar with a fixed-width value, so the arrows never move.
export function stepper(host,labels,value,onPick,{label="",cls=""}={}){
  host.replaceChildren();host.className="stepper "+cls;host.removeAttribute("role");
  let cur=value;
  const out=make("output",labels[cur]??"—",{class:"val","aria-live":"polite"});
  out.style.setProperty("--w",Math.max(...labels.map(l=>l.length))+"ch");
  const go=d=>{cur=((cur<0?0:cur)+d+labels.length)%labels.length;out.value=labels[cur];onPick(cur);};
  host.append(stepBar(out,()=>go(-1),()=>go(1),label));
  host.set=v=>{cur=v;out.value=labels[v]??"—";};return host;
}
