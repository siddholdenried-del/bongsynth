// SPDX-License-Identifier: GPL-3.0-only
import {boot,apply} from "./engine.js";
import {benchLayout,medianLoad} from "./desk-status.mjs";

self.onmessage=({data})=>{
  try{
    const {module,state}=data,{rate,block,sample,warmup,repeats}=benchLayout(state.bpm);
    const times=[];
    for(let pass=0;pass<repeats;pass++){
      const engine=boot(module);
      apply(engine,state);
      engine.gs_play(1);
      const render=engine.gs_render;
      for(let i=0;i<warmup;i++)render(block);
      const start=performance.now();
      for(let i=0;i<sample;i++)render(block);
      times.push(performance.now()-start);
    }
    self.postMessage({load:medianLoad(times,sample*block,rate)});
  }catch(error){self.postMessage({error:error?.message||"Render check failed"});}
};
