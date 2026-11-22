import {boot,apply} from "./engine.js";
class BongSynth extends AudioWorkletProcessor{
  constructor(options){
    super();const x=this.x=boot(options.processorOptions.module);this.last=-2;this.ticks=0;this.peak=0;
    this.left=new Float32Array(x.memory.buffer,x.gs_left(),256);this.right=new Float32Array(x.memory.buffer,x.gs_right(),256);
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
        case "color":x.gs_color(d.index,d.value);break;
        case "level":x.gs_level(d.value);break;
        case "pan":x.gs_pan(d.value);break;
        case "send":x.gs_send(d.index,d.value);break;
        case "fx":x.gs_fx(d.index,d.value);break;
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
    const step=x.gs_step();
    if(step!==this.last||++this.ticks>=12){this.port.postMessage({step,peak:this.peak,voices:x.gs_voices()});this.last=step;this.ticks=0;this.peak=0;}
    return true;
  }
}
registerProcessor("bongsynth",BongSynth);
