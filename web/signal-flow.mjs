// SPDX-License-Identifier: GPL-3.0-only
// Index order follows SP_*, MD_* and SM_* in dsp/synth.h.
const matrixTarget=['osc','osc','osc','filter','filter','osc','osc','osc','osc','drive','osc','osc','shape','shape','amp','dry','mod'];
const trackTarget=['filter','osc','amp','osc','filter','osc','osc','drive','osc','osc'];
const matrixSlots=Array.from({length:6},(_,i)=>46+3*i);
export function signalStages({sound}){
  return ['osc',...(sound[33]?['drive','filter','shape']:['shape','drive','filter']),'amp','dry','out'];
}
export function flowStages(spec,{sound,lfo}){
  const {soundId:i,mixKey,trackLfo,flow}=spec;
  const target=src=>matrixTarget[sound[src+1]]||'mod';
  const sourcePaths=source=>matrixSlots.filter(slot=>sound[slot]===source).map(target);
  const paths=(list,fallback)=>list.length?[...new Set(list)]:[fallback];
  if(trackLfo)return paths([trackTarget[lfo[3]],...sourcePaths(1)].filter(Boolean),'mod');
  if(mixKey)return [mixKey==='volume'?'out':'dry'];
  if(flow)return [flow];
  if(i>=46){const src=i-(i-46)%3;return [sound[src]?target(src):'mod'];}
  if(i>=42)return paths(sourcePaths(2),'mod');
  if(i>=38)return paths(sourcePaths(3),'mod');
  if(i>=34)return paths(sourcePaths(9+i-34),'mod');
  if(i>=30)return ['shape'];
  if(i===7)return ['drive'];
  if(i>=26||i<7||i===17)return ['osc'];
  if(i>=22||i>=8&&i<=12)return ['filter'];
  if(i===14)return ['dry'];
  if(i===15||i===16)return ['mod'];   // note allocation and legato are voice controls, not a serial audio block
  return ['amp'];
}

// Stable editing order; the scope above can still reflect pre/post-filter shaper routing.
const legacySoundPages=['OSC','TONE','FILTER','AMP ENV','FILTER ENV','VOICE','TOUCH','OSC 2','SHAPER','MOD ENV','LFO 2','MACRO'];
export const soundPageOrder=['OSC','OSC 2','TONE','SHAPER','FILTER','FILTER ENV','AMP ENV','TOUCH','VOICE','MOD ENV','LFO 2','MACRO'];
export const soundPageIndex=(legacyIndex,savedName)=>Math.max(0,soundPageOrder.indexOf(savedName||legacySoundPages[legacyIndex]));
const destinations={
  osc:['sound','OSC'], shape:['sound','SHAPER'], drive:['sound','TONE',3], filter:['sound','FILTER'],
  amp:['sound','AMP ENV'], dry:['fx','MIX',0], out:['fx','MIX',1], mod:['sound','MOD ENV']
};
export const scopeDestination=id=>destinations[id];
const soundGroups=['osc','osc','drive','shape','filter','filter','amp','amp','mod','mod','mod','mod'];
export const soundPageStage=name=>soundGroups[soundPageOrder.indexOf(name)];
