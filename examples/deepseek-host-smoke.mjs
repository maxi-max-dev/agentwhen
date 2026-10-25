// Actual Cordis + DSH SessionStore, controlled lifecycle and real local tests.
// No LLM. This verifies integration, NOT ETA accuracy or an autonomous agent.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const [runtime, output, installed]=process.argv.slice(2);
if(!runtime||!output||existsSync(output))throw new Error('Supply isolated runtime directory and NEW output directory');
const require=createRequire(join(resolve(runtime),'package.json'));
const load=async name=>import(pathToFileURL(require.resolve(name)).href);
const eta=installed==='installed'?await load('agent-eta/deepseek'):await import('../src/deepseek/plugin.js');
const {Context}=await load('@deepseek-ai/cordis');
const {default:SessionStore}=await load('@deepseek-ai/dsh-session');
const {createToolResultMessage}=await load('@deepseek-ai/dsh-llm/message');
mkdirSync(output,{recursive:true});
const journalPath=join(resolve(output),'receipts.jsonl');
const ctx=new Context();
await ctx.plugin(SessionStore).await();
await ctx.plugin(eta,{journalPath}).await();
const session=ctx.sessions.create('eta-controlled-smoke',{meta:{cwd:resolve(output)}});
const updates=[];ctx.on('agent-eta/update',p=>updates.push(p));
session.append('turn/start',{turn:0});
session.append('request/context',{provider:'controlled-no-llm',model:'none',contextWindow:4096,systemPromptUpdate:'replace'});
session.append('step/start',{turn:0,step:0});
const testPath=join(resolve(output),'arithmetic.test.mjs');
writeFileSync(testPath,"import assert from 'node:assert/strict'; assert.equal(1+1,3);\n");
function executeTest(callId,step){
  const call=session.append('tool/call',{turn:0,step,callId,name:'bash',arguments:JSON.stringify({command:`node --test ${testPath}`})});
  const run=spawnSync(process.execPath,['--test',testPath],{encoding:'utf8'});
  // Controlled host hook: real exit status, no native bash executor or LLM.
  ctx.emit('tools/result',{name:'bash',arguments:{command:`node --test ${testPath}`},callId,agent:{session}},
    {isError:false,value:{kind:'foreground',exitCode:run.status},content:[]});
  session.append('tool/result',{turn:0,step,message:createToolResultMessage({callId,isError:false,
    content:[{type:'text',text:run.stdout+(run.status?`\n[exit code: ${run.status}]`:'')}]})},
    {surfaceOp:'append',sourceEventSeqs:[call.seq]});
  return run.status;
}
assert.equal(executeTest('test-first',0),1);
session.append('tool/call',{turn:0,step:0,callId:'edit-fixture',name:'edit',arguments:'{}'});
writeFileSync(testPath,"import assert from 'node:assert/strict'; assert.equal(1+1,2);\n");
session.append('step/end',{turn:0,step:0});
session.append('step/start',{turn:0,step:1});
assert.equal(executeTest('test-second',1),0);
session.append('step/end',{turn:0,step:1});
session.append('turn/end',{turn:0,reason:{kind:'completed'}});
await ctx.sessions.flush(session);
const receipts=readFileSync(journalPath,'utf8').trim().split('\n').map(JSON.parse);
assert.ok(receipts.some(r=>r.prediction?.features.unresolved));
assert.ok(receipts.some(r=>r.prediction?.features.rework));
assert.ok(receipts.some(r=>r.prediction?.features.steps===2&&!r.prediction.features.unresolved));
assert.equal(receipts.filter(r=>r.schema==='agent-eta.dsh-tool-receipt/1').length,2);
assert.ok(!readFileSync(journalPath,'utf8').includes(testPath));
assert.ok(!updates.some(r=>r.status==='invalid'));
const result={evidence:'controlled-real-runtime-and-subprocesses',autonomousAgent:false,modelCalls:0,
  hostVersion:require('@deepseek-ai/dsh-session/package.json').version,cordisVersion:require('@deepseek-ai/cordis/package.json').version,
  packagedPlugin:installed==='installed',receipts:receipts.length,stepsObserved:2,liveCanonicalToolResults:2,
  failedTestThenEditThenPassingTest:true,privateTextPersisted:false};
writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
await ctx.fiber.dispose();
