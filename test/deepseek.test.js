import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeEvent, classifyTool } from '../src/deepseek/normalize.js';
import { DeepSeekETA, candidateForecast } from '../src/deepseek/model.js';
import { apply } from '../src/deepseek/plugin.js';

const M=60000;
function driver() {
  const engine=new DeepSeekETA();let seq=0;
  const emit=(type,time,data={})=>engine.apply('s',normalizeEvent({seq:seq++,time,type,data}));
  const begin=()=>{emit('turn/start',0,{turn:1});emit('request/context',0,{provider:'p',model:'m'});emit('step/start',0,{turn:1,step:0});};
  return {engine,emit,begin};
}
test('DSH keeps only structural fields, never command/output/prompt or raw identifiers',()=>{
  const e=normalizeEvent({seq:0,time:0,type:'tool/call',data:{turn:1,step:0,callId:'secret-id',name:'bash',arguments:JSON.stringify({command:'npm test -- secret-token'})}});
  assert.equal(e.phase,'test');assert.ok(!JSON.stringify(e).includes('secret'));
  const result=normalizeEvent({seq:1,time:1,type:'tool/result',data:{turn:1,step:0,message:{toolCallId:'secret-id',content:[{type:'text',text:'password and FAILED'}],isError:false}}});
  assert.equal(result.outcome,'unknown');assert.ok(!JSON.stringify(result).includes('password'));
});
test('classification avoids arbitrary command prose and recognizes explicit tests',()=>{
  for(const c of ['npm test','pnpm run test','node --test','node --no-warnings --test a.js','python3 -m pytest','cd repo && cargo test'])assert.equal(classifyTool('bash',{command:c}),'test');
  for(const c of ['echo npm test','python hack.py','cat README.md | grep pytest'])assert.equal(classifyTool('bash',{command:c}),'tool');
});
test('test failures and subsequent edits produce rework, pass resolves failure',()=>{
  const d=driver();d.begin();
  d.emit('tool/call',10,{turn:1,step:0,callId:'a',name:'bash',arguments:'{"command":"npm test"}'});
  d.emit('tool/result',20,{turn:1,step:0,message:{toolCallId:'a',isError:false,content:[]},meta:{exitCode:1}});
  d.emit('tool/call',30,{turn:1,step:0,callId:'b',name:'edit',arguments:'{}'});
  assert.equal(d.engine.predict('s',40).features.unresolved,true);assert.equal(d.engine.predict('s',40).features.rework,true);
  d.emit('tool/call',50,{turn:1,step:0,callId:'c',name:'bash',arguments:'{"command":"npm test"}'});
  d.emit('tool/result',60,{turn:1,step:0,message:{toolCallId:'c',isError:false,content:[]},meta:{exitCode:0}});
  assert.equal(d.engine.predict('s',70).features.unresolved,false);
});
test('job completion is unknown; duplicate job/tool failures count once',()=>{
  const d=driver();d.begin();d.emit('tool/call',1,{turn:1,step:0,callId:'a',name:'bash',arguments:'{"command":"npm test"}'});
  d.emit('job/settled',2,{toolCall:{callId:'a'},status:'completed'});
  assert.equal(d.engine.session('s').open.testKnown,0);
  d.emit('job/settled',3,{toolCall:{callId:'a'},status:'failed'});
  d.emit('tool/result',4,{turn:1,step:0,message:{toolCallId:'a',isError:true,content:[]}});
  assert.equal(d.engine.session('s').open.failures,1);
});
test('overlapping approval and ask-user waits stop active elapsed and withdraw numbers',()=>{
  const d=driver();d.begin();d.emit('approval/asked',M,{id:'approval'});
  d.emit('tool/call',2*M,{turn:1,step:0,callId:'ask',name:'ask_user_question',arguments:'{}'});
  d.emit('approval/decided',3*M,{id:'approval',outcome:'allow'});
  assert.equal(d.engine.predict('s',4*M).elapsed,M);
  assert.equal(d.engine.predict('s',4*M).status,'waiting');
  d.emit('tool/result',5*M,{turn:1,step:0,message:{toolCallId:'ask',content:[],isError:false}});
  assert.equal(d.engine.predict('s',6*M).elapsed,2*M);
});
test('sequence gaps, model changes and missing step starts fail closed',()=>{
  const d=driver();d.begin();d.emit('request/context',1,{provider:'p',model:'different'});
  assert.equal(d.engine.predict('s',2).status,'invalid');
  const e=driver();e.begin();e.engine.apply('s',{seq:99,time:3,type:'tick'});assert.equal(e.engine.predict('s',4).status,'invalid');
  const f=driver();f.emit('turn/start',0,{turn:1});f.emit('step/end',1,{turn:1,step:0});assert.equal(f.engine.predict('s',2).status,'invalid');
});
test('completed outcomes enter history only after their terminal; errors never count as success',()=>{
  const d=driver();d.begin();assert.equal(d.engine.history.length,0);
  d.emit('step/end',100,{turn:1,step:0});d.emit('turn/end',101,{turn:1,reason:{kind:'error'}});
  assert.equal(d.engine.history.length,0);assert.equal(d.engine.outcomes[0].reason,'error');
});
test('same cohorts and future outcomes: future data cannot change an earlier prediction',()=>{
  const d=driver();d.begin();
  const r=d.engine.session('s').open;
  for(let i=0;i<4;i++)d.engine.history.push({id:String(i),end:-1,duration:(10+i)*M,model:r.model,role:'root',snapshots:[{elapsed:0,features:{steps:0,phase:'model',unresolved:false,rework:false}}]});
  const before=d.engine.predict('s',M);
  d.engine.history.push({...d.engine.history[0],id:'future',end:10*M,duration:100*M});
  d.engine.history.push({...d.engine.history[0],id:'other-model',model:'other',duration:100*M});
  assert.deepEqual(d.engine.predict('s',M),before);
});
test('signal neighbours differ from steps-only ablation without imposing fixed retry penalty',()=>{
  const base={p20:4,p50:6,p80:10},history=[];
  for(let i=0;i<14;i++)history.push({id:String(i),duration:(i<7?10:30)*M,snapshots:[{elapsed:0,features:{steps:2,phase:'edit',unresolved:i>=7,rework:i>=7}}]});
  const f={steps:2,phase:'edit',unresolved:true,rework:true};
  const informed=candidateForecast(base,history,f,M);
  const clean=candidateForecast(base,history,{...f,unresolved:false,rework:false},M);
  assert.ok(informed.forecast.p50>clean.forecast.p50);
  assert.ok(informed.forecast.p20<=informed.forecast.p50&&informed.forecast.p50<=informed.forecast.p80);
  assert.equal(candidateForecast(base,history.slice(0,2),f,M).method,'original_fallback');
});
test('host observer records sanitized receipts once and never adds model tools',()=>{
  const dir=mkdtempSync(join(tmpdir(),'eta-dsh-test-'));
  try{
    let handler;const emitted=[];
    const ctx={on:(name,fn)=>{assert.equal(name,'session/event');handler=fn;},emit:(...args)=>emitted.push(args)};
    const journalPath=join(dir,'journal.jsonl');apply(ctx,{journalPath});
    const session={id:'private-id',snapshotEvents:()=>[]};
    const event={seq:0,time:0,type:'turn/start',data:{turn:1}};
    handler(session,event);handler(session,event);
    const text=readFileSync(journalPath,'utf8');assert.equal(text.trim().split('\n').length,1);assert.ok(!text.includes('private-id'));
    assert.equal(emitted.length,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
