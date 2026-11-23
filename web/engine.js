// The WASM engine: one instance on the page (to read names, ranges and presets) and one in the AudioWorklet (to play).
export function boot(module){const x=new WebAssembly.Instance(module).exports;x._initialize();x.gs_init();return x;}
// Bring an instance to a saved state: the sound, the dry mix, LFO 1 and the sequence.
export function apply(x,s){
  x.gs_preset(s.preset);
  for(let k=0;k<s.sound.length;k++)x.gs_set(k,s.sound[k]);
  x.gs_mono(s.mono?1:0);
  x.gs_level(s.level);x.gs_pan(s.pan);x.gs_volume(s.volume);
  x.gs_tempo(Math.round(s.bpm*10));x.gs_transpose(s.transpose);
  x.gs_lfo(s.lfo[0],s.lfo[1],s.lfo[2],s.lfo[3]);
  s.steps.forEach(([n,f],i)=>x.gs_step_set(i,n,f));
}
