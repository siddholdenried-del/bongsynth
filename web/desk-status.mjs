// SPDX-License-Identifier: GPL-3.0-only
export function deskPosition(pages,current){
  const count=pages.length, index=((current%count)+count)%count;
  return {index,count,name:pages[index].name,previous:pages[(index+count-1)%count].name,next:pages[(index+1)%count].name};
}

export function benchLayout(bpm,rate=44100){
  if(!Number.isFinite(bpm)||bpm<40||bpm>240)throw Error("Tempo is out of range");
  const block=128;
  const patternBlocks=Math.ceil((4*60/bpm)*rate/block);
  return {rate,block,warmup:patternBlocks,sample:patternBlocks*2,repeats:3};
}
export function medianLoad(timings,frames,rate){
  if(timings.length!==3||!timings.every(v=>Number.isFinite(v)&&v>0)||!(frames>0&&rate>0))throw Error("No usable render timing");
  return [...timings].sort((a,b)=>a-b)[1]/(frames/rate*1000)*100;
}
