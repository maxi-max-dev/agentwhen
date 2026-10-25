import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/deepseek/client.js',import.meta.url),'utf8');
function harness(value,{offline=false,sessionId='one',running=true}={}) {
 let entry,Component,index=0;const states=[{sessionId:'one',value},offline,true,false],storage=new Map();
 const React={createElement:(type,props,...children)=>({type,props,children}),useEffect:()=>{},
  useState:initial=>{const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
   return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];}};
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load:e=>entry=e}},Date,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
 entry.factory(()=>React).apply({slots:{inject:(_,f)=>f(),register:(_,c)=>Component=c}});
 return {render(){index=0;return Component({sessionId,useSession:f=>f({running})});},storage};
}
function textOf(node){return node==null||typeof node==='boolean'?'':typeof node==='object'?node.children.map(textOf).join(' '):String(node);}
function button(node,label){if(node?.type==='button'&&textOf(node)===label)return node;for(const child of node?.children??[]){const match=typeof child==='object'&&button(child,label);if(match)return match;}}
const sample=()=>({running:true,error:false,receipts:50,session:{receipts:12,lastWrite:Date.now()},prediction:{at:Date.now(),status:'experimental',historyCount:4,original:{p20:2,p50:4.2,p80:7},candidate:{forecast:{p20:3,p50:5.6,p80:9}},features:{steps:5,rework:true,unresolved:true}}});
test('native client suppresses stale, disconnected, invalid and other-session estimates',()=>{
 const base=sample();
 for(const [value,options] of [[{...base,prediction:{...base.prediction,at:Date.now()-61000}},{}],
  [base,{offline:true}],[{...base,error:true},{}],[base,{sessionId:'two'}]]) {
  const text=textOf(harness(value,options).render());assert.ok(!text.includes('4.2 分钟'));assert.ok(!text.includes('5.6 分钟'));
 }
 assert.ok(textOf(harness(base,{sessionId:'two'}).render()).includes('本对话已记录 0 条'));
});
test('cold-start progress and pending observation do not report a busy session idle',()=>{
 const base=sample();base.prediction.original=null;base.prediction.candidate.forecast=null;base.prediction.historyCount=1;
 const cold=textOf(harness(base).render());assert.ok(cold.includes('可比历史 1/3 条'));assert.ok(cold.includes('还需 2 条'));
 const pending=textOf(harness({...base,running:false,prediction:null}).render());
 assert.ok(pending.includes('正在执行'));assert.ok(!pending.includes('当前没有执行中的任务'));
});
test('collapsed comparison keeps both saved numbers and remembers visibility without journal writes',()=>{
 const ui=harness(sample());const expanded=ui.render();assert.ok(textOf(expanded).includes('已保存预测的时间'));
 button(expanded,'收起对照').props.onClick();const collapsed=textOf(ui.render());
 assert.ok(collapsed.includes('4.2 分钟'));assert.ok(collapsed.includes('5.6 分钟'));
 assert.equal(ui.storage.get('agent-eta:expanded'),'false');assert.ok(!collapsed.includes('估计范围'));
});
