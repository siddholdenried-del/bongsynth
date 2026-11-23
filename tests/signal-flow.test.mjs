import test from 'node:test';
import assert from 'node:assert/strict';
import {signalStages,flowStages} from '../web/signal-flow.mjs';
const state=()=>({sound:Array(64).fill(0),lfo:[0,0,0,0]});
test('only dry stages are shown; shaper follows its PRE/POST setting',()=>{
 const s=state();
 assert.deepEqual(signalStages(s),['osc','shape','drive','filter','amp','dry','out']);
 s.sound[33]=1;
 assert.deepEqual(signalStages(s),['osc','drive','filter','shape','amp','dry','out']);
});
test('touches resolve to real stages, including dry pan and master volume',()=>{
 const s=state();
 for(const [spec,expected] of [[{soundId:7},'drive'],[{soundId:8},'filter'],[{soundId:18},'amp'],[{soundId:32},'shape'],[{mixKey:'pan'},'dry'],[{mixKey:'volume'},'out']])assert.deepEqual(flowStages(spec,s),[expected]);
});
test('matrix and LFOs highlight mapped targets, not imaginary serial stages',()=>{
 const s=state();
 assert.deepEqual(flowStages({soundId:46},s),['mod']);
 s.sound[46]=2;s.sound[47]=3;
 assert.deepEqual(flowStages({soundId:46},s),['filter']);
 assert.deepEqual(flowStages({soundId:43},s),['filter']);
 s.sound[47]=16;
 assert.deepEqual(flowStages({soundId:46},s),['mod']);
 s.lfo[0]=1;s.lfo[3]=2;
 assert.deepEqual(flowStages({trackLfo:true},s),['amp']);
});
