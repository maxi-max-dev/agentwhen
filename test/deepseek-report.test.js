import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeReceipts} from '../src/deepseek/report.js';
const prediction={id:'t',at:60000,elapsed:60000,status:'experimental',original:{p50:2},
 candidate:{forecast:{p50:3},method:'original_fallback'},competitor:{p50:1}};
const start={event:{type:'turn/start'},prediction:{...prediction,at:0,elapsed:0}};
const finish={outcome:{id:'t',start:0,end:180000,duration:180000,valid:true,hadWait:false,reason:'completed',testCalls:2,failures:1,rework:1}};
test('report scores only prospective saved numbers at identical frozen windows',()=>{
 const r=summarizeReceipts([{mount:'a',records:[start,{prediction},finish]}]);
 assert.equal(r.eligibleTurns,1);assert.equal(r.comparisons[0].n,1);
 assert.equal(r.comparisons[0].originalMAE,0);assert.equal(r.comparisons[0].candidateMAE,1);
 assert.equal(r.comparisons[0].candidateFallback,1);assert.equal(r.comparisons[1].n,0);
});
test('restart cannot join a prior mount start/forecast to a later outcome',()=>{
 const r=summarizeReceipts([{mount:'a',records:[start,{prediction}]},{mount:'b',records:[{prediction},finish]}]);
 assert.equal(r.closedTurns,1);assert.equal(r.eligibleTurns,0);
 assert.equal(r.turnsWithoutObservedStart,1);assert.equal(r.comparisons[0].n,0);
});
test('report excludes invalid, waiting, failed turns and handles torn lines',()=>{
 for(const patch of [{valid:false},{hadWait:true},{reason:'error'}]) {
  const r=summarizeReceipts([{mount:'a',records:[start,{prediction},{outcome:{...finish.outcome,...patch}}],invalidLines:1}]);
  assert.equal(r.eligibleTurns,0);assert.equal(r.incompleteLines,1);
 }
});
