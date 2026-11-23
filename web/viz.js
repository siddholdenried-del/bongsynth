// BongSynth's screens, drawn as BongDrums draws them (STYLE.md section 8): one canvas pixel per block, scaled up with
// image-rendering: pixelated, lines as connected pixel runs, a phosphor fade, no text in the canvas.
export const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const unit=()=>parseFloat(css("--u"))||3;
export function pixelCanvas(c){
  const u=unit(),w=Math.max(8,Math.floor(c.clientWidth/u)),h=Math.max(8,Math.floor(c.clientHeight/u));
  if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
  return [c.getContext("2d"),w,h];
}
// A connected one-pixel line: each column fills from the previous row to its own.
export function plot(g,ys,color,thick=2){
  g.fillStyle=color;let prev=null;
  for(let x=0;x<ys.length;x++){if(ys[x]===null){prev=null;continue;}const y=Math.round(ys[x]),a=prev===null?y:Math.min(prev,y),b=prev===null?y:Math.max(prev,y);g.fillRect(x,a,1,b-a+thick);prev=y;}
}
// The screen behind a graph: the last frame fades (phosphor) unless FX is off, then the grid.
export function screen(g,w,h,top,bot,colours){
  const fx=!document.body.classList.contains("fx-off");
  g.globalAlpha=fx?.55:1;g.fillStyle=colours.bg;g.fillRect(0,0,w,h);g.globalAlpha=1;
  const amp=(bot-top)/2;g.fillStyle=colours.grid;
  for(let x=0;x<w;x+=Math.max(6,Math.round(w/16)))g.fillRect(x,0,1,h);
  for(let y=top;y<=bot;y+=Math.max(4,Math.round(amp/2)))g.fillRect(0,y,w,1);
}
// The live output, trigger-locked on a rising zero crossing so it holds still; returns one y per column or null.
let gain=1;
export function liveTrace(analyser,buf,w,mid,amp,auto=false){
  if(!analyser)return null;analyser.getFloatTimeDomainData(buf);
  const N=Math.min(1024,buf.length>>1);let s=0;for(let i=1;i<buf.length-N;i++)if(buf[i-1]<=0&&buf[i]>0){s=i;break;}
  let k=1.6;if(auto){let pk=0;for(const v of buf)pk=Math.max(pk,Math.abs(v));const want=Math.min(8,.9/Math.max(pk,1e-4));gain=want<gain?want:gain+(want-gain)*.05;k=gain;}
  const ys=[];for(let x=0;x<w;x++)ys.push(mid-Math.max(-1,Math.min(1,buf[s+Math.floor(x*N/w)]*k))*amp);return ys;
}
// The newest voice's amp envelope, cutoff, MOD ENV and LFO 2, once a render quantum (2.9 ms), for the last few seconds.
export class Trace{
  constructor(frames=900){this.n=frames;this.d=new Float32Array(frames*4);for(let i=0;i<frames;i++){this.d[i*4+1]=-1;this.d[i*4+2]=-1;}this.at=0;this.max=.05;}
  push(t){for(let i=0;i<t.length;i+=4){this.d.set(t.subarray(i,i+4),this.at*4);this.at=(this.at+1)%this.n;}
    let m=.05;for(let i=0;i<this.n;i++)m=Math.max(m,this.d[i*4]);this.max=Math.max(m,this.max*.98);}
  last(k){const i=((this.at-1+this.n)%this.n)*4;return this.d[i+k];}
}
