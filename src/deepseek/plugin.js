import { mkdirSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { alias, classifyTool, normalizeEvent } from './normalize.js';
import { createPanelState, registerPanel } from './panel-host.js';
import { DeepSeekETA } from './model.js';

export const name = 'agent-eta-deepseek-shadow';

/** Host-only opt-in observer: no model capability, no profile or session mutation. */
export function apply(ctx, config = {}) {
  config={...config,journalPath:config.journalPath??resolve(config.journalDirectory??resolve('.agent-eta','deepseek'),`receipts-${randomUUID()}.jsonl`)};
  if (typeof config.journalPath !== 'string' || !isAbsolute(config.journalPath)) throw new Error('ABSOLUTE_ETA_JOURNAL_REQUIRED');
  mkdirSync(dirname(config.journalPath), { recursive:true, mode:0o700 });
  writeFileSync(config.journalPath,'',{flag:'wx',mode:0o600});
  const engine=new DeepSeekETA(), seeded=new WeakSet();
  const panel=createPanelState(config.journalPath);
  registerPanel(ctx,panel,engine);
  writeFileSync(config.journalPath+'.ready.json',JSON.stringify({schema:'agent-eta.dsh-ready/1',
    version:'0.12.0-deepseek.6',startedAt:Date.now(),pid:globalThis.process.pid,
    journalPath:config.journalPath,mode:'shadow',modelCalls:0}),{flag:'wx',mode:0o600});
  const publish=value=>{try{ctx.emit('agent-eta/update',value);}catch{/* A consumer cannot poison observation. */}};
  let queue=Promise.resolve();
  const process=async(session,event,observedAt)=>{
    const id=alias(session.id), role=session.header?.origin==='subagent'?'subagent':'root';
    try {
      if(!seeded.has(session)) {
        seeded.add(session);
        if(session.header?.isSeeded===true)engine.session(id,role).invalid=true;
        if(event.seq>0) {
          // New code must not use the deprecated synchronous snapshotEvents API.
          const query=typeof ctx.get==='function'?ctx.get('sessionQuery'):ctx.sessionQuery;
          if(!query)throw new Error('SESSION_QUERY_REQUIRED_FOR_RESUME');
          const snapshot=await query.readSession(session.id);
          if(snapshot.inheritedEventCount>0)engine.session(id,role).invalid=true;
          for(const previous of snapshot.events) {
            if(previous.seq>=event.seq)break;
            engine.apply(id,normalizeEvent(previous),role);
          }
        }
      }
      if(engine.sessions.get(id)?.seq>=event.seq)return;
      const normalized=normalizeEvent(event);
      engine.apply(id,normalized,role);
      const prediction=engine.predict(id,event.time);
      const outcome=normalized.type==='turn/end'?engine.outcomes.at(-1):undefined;
      const record={schema:'agent-eta.dsh-receipt/1',observedAt,session:id,event:normalized,prediction,outcome};
      await appendFile(config.journalPath,JSON.stringify(record)+'\n',{mode:0o600});
      panel.written(record);
      // Consumers can subscribe; original Agent ETA and the DSH UI stay untouched.
      publish(prediction ?? {id, status:'terminal_or_unknown'});
    } catch {
      panel.failed();
      engine.session(id,role).invalid=true;
      publish({id,status:'invalid',reason:'event_or_journal_failure'});
      ctx.logger?.warn('Agent ETA observation incomplete; estimates withdrawn.');
    }
  };
  ctx.on('session/event',(session,event)=>{
    const observedAt=Date.now();
    queue=queue.then(()=>process(session,event,observedAt));
    return queue;
  });
  // DSH omits canonical tool values from durable tool/result; read the final
  // pipeline observation instead of guessing exit status from arbitrary stdout.
  ctx.on('tools/result',(exec,result)=>{
    const phase=classifyTool(exec.name,exec.arguments??{});
    if(!['test','edit'].includes(phase)||!exec.agent?.session?.id||typeof exec.callId!=='string')return;
    const value=result.value;
    if(value?.timedOut||value?.aborted||value?.stopped||value?.signal)return;
    const code=value?.kind==='foreground'&&Number.isInteger(value.exitCode)?value.exitCode:null;
    const outcome=result.isError===true||code!==null&&code!==0?'failed':code===0?'passed':'unknown';
    if(phase==='test'&&outcome==='unknown')return;
    const id=alias(exec.agent.session.id),call=alias(exec.callId),time=Date.now();
    queue=queue.then(async()=>{
      try{
        // PTC child calls are not necessarily durable tool/call events. Register
        // their observed phase once, without inventing session sequence numbers.
        engine.observeToolPhase(id,call,phase,time);
        engine.observeToolOutcome(id,call,outcome,time);
        const prediction=engine.predict(id,time);
        const record={schema:'agent-eta.dsh-tool-receipt/1',session:id,observedAt:time,call,phase,outcome,provenance:'live_tools_result',prediction};
        await appendFile(config.journalPath,JSON.stringify(record)+'\n',{mode:0o600});
        panel.written(record);
        publish(prediction);
      }catch{
        panel.failed();
        engine.session(id).invalid=true;publish({id,status:'invalid',reason:'tool_observation_failure'});
      }
    });
  });
  ctx.on('session/flush',()=>queue);
}
