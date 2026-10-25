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
