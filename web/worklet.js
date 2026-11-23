import {boot,apply} from "./engine.js";
const TRACE=6;   // render quanta (128 samples, 2.9 ms) per message: about 17 ms
class BongSynth extends AudioWorkletProcessor{
  constructor(options){
    super();const x=this.x=boot(options.processorOptions.module);this.n=0;this.peak=0;
    this.left=new Float32Array(x.memory.buffer,x.gs_left(),256);this.right=new Float32Array(x.memory.buffer,x.gs_right(),256);
    // the newest voice's amp envelope, cutoff, MOD ENV and LFO 2, once a quantum: the envelope scopes
    this.trace=new Float32Array(TRACE*4);
    this.port.onmessage=({data:d})=>{
      switch(d.kind){
        case "state":apply(x,d.state);break;
        case "preset":x.gs_preset(d.value);break;
        case "set":x.gs_set(d.id,d.value);break;
        case "mono":x.gs_mono(d.value?1:0);break;
        case "on":x.gs_note_on(d.note,d.vel);break;
        case "off":x.gs_note_off(d.note);break;
        case "panic":x.gs_panic();break;
        case "play":x.gs_play(d.value?1:0);break;
        case "tempo":x.gs_tempo(d.value);break;
        case "step":x.gs_step_set(d.index,d.note,d.flags);break;
        case "transpose":x.gs_transpose(d.value);break;
        case "lfo":x.gs_lfo(...d.value);break;
        case "level":x.gs_level(d.value);break;
        case "pan":x.gs_pan(d.value);break;
        case "volume":x.gs_volume(d.value);break;
      }
    };
  }
  process(_,outputs){
    const [l,r]=outputs[0];if(!l||!r)return true;const x=this.x;
    for(let at=0;at<l.length;at+=128){
      const n=Math.min(128,l.length-at);x.gs_render(n);
      l.set(this.left.subarray(0,n),at);r.set(this.right.subarray(0,n),at);
      this.peak=Math.max(this.peak,x.gs_peak());
    }
    const amp=x.gs_probe(4),t=this.trace,i=this.n*4;
    if(amp<0){t[i]=0;t[i+1]=-1;t[i+2]=-1;t[i+3]=0;}
    else{t[i]=amp/32768;t[i+1]=x.gs_probe(1)/32512;t[i+2]=x.gs_probe(2)/1000;t[i+3]=x.gs_probe(3)/1000;}
    if(++this.n>=TRACE){
      this.port.postMessage({step:x.gs_step(),peak:this.peak,voices:x.gs_voices(),trace:t.slice()});
      this.n=0;this.peak=0;
    }
    return true;
  }
}
registerProcessor("bongsynth",BongSynth);
