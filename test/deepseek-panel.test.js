import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPanelState,registerPanel} from '../src/deepseek/panel-host.js';
import {alias} from '../src/deepseek/normalize.js';
test('panel restores counts, scopes sessions, never restores historical predictions as live',()=>{
 const dir=mkdtempSync(join(tmpdir(),'eta-panel-'));
 try{
  const row={session:alias('one'),observedAt:12,prediction:{private:'not returned'}};
  writeFileSync(join(dir,'old.jsonl'),JSON.stringify(row)+'\n');
  const state=createPanelState(join(dir,'new.jsonl')),engine={sessions:new Map(),predict:()=>null};
  assert.equal(state.read('one',engine).session.receipts,1);
  assert.equal(state.read('two',engine).session.receipts,0);
  assert.equal(state.read('one',engine).prediction,null);
  state.written({...row,observedAt:20});assert.equal(state.read('one',engine).lastWrite,20);
  state.failed();assert.equal(state.read('one',engine).error,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('status route is read-only and returns only selected snapshot',()=>{
 let route,body,status;
 const child={effect:f=>f(),webServer:{register:r=>{route=r;return ()=>{};}}};
 registerPanel({inject:(_,fn)=>fn(child)},{read:id=>({selected:id})},{});
 const res={writeHead:s=>status=s,end:b=>body=b};
 route.handler({method:'POST',url:'/agent-eta/status'},res);assert.equal(status,405);
 route.handler({method:'GET',url:'/agent-eta/status?session=one'},res);
 assert.equal(status,200);assert.equal(JSON.parse(body).selected,'one');
});

test('UI uses only the last successful write, never recomputes or shows another turn',()=>{
 const dir=mkdtempSync(join(tmpdir(),'eta-panel-saved-'));
 try {
  const state=createPanelState(join(dir,'new.jsonl')),id=alias('one');
  const engine={sessions:new Map([[id,{open:{id:'turn-1'}}]]),predict:()=>{throw Error('must not recalculate');}};
  const prediction={id:'turn-1',at:10,status:'experimental',original:{p50:3}};
  assert.equal(state.read('one',engine).prediction,null);
  state.written({session:id,observedAt:11,prediction});
  prediction.original.p50=99;
  assert.equal(state.read('one',engine).prediction.original.p50,3);
  const exposed=state.read('one',engine);exposed.prediction.original.p50=200;
  assert.equal(state.read('one',engine).prediction.original.p50,3);
  engine.sessions.get(id).open={id:'turn-2'};
  assert.equal(state.read('one',engine).prediction,null);
  engine.sessions.get(id).open={id:'turn-1'};
  state.failed();assert.equal(state.read('one',engine).prediction,null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('restored last-write timestamp is independent of random journal filename order',()=>{
 const dir=mkdtempSync(join(tmpdir(),'eta-panel-order-'));
 try {
  const newer={session:alias('one'),observedAt:200,outcome:{end:190,reason:'completed',steps:2}};
  const older={session:alias('one'),observedAt:100,outcome:{end:90,reason:'error',steps:1}};
  writeFileSync(join(dir,'a.jsonl'),JSON.stringify(newer)+'\n');
  writeFileSync(join(dir,'z.jsonl'),JSON.stringify(older)+'\n{"interrupted":');
  const state=createPanelState(join(dir,'next.jsonl')),result=state.read('one',{sessions:new Map()});
  assert.equal(result.receipts,2);assert.equal(result.lastWrite,200);
  assert.equal(result.session.lastWrite,200);assert.equal(result.session.outcome.reason,'completed');
  assert.equal(result.incompleteLines,1);assert.equal(result.prediction,null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
