import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { alias, normalizeEvent } from './normalize.js';
import { DeepSeekETA } from './model.js';

export const name = 'agent-eta-deepseek-shadow';

/** Host-only opt-in observer: no model capability, no profile or session mutation. */
export function apply(ctx, config = {}) {
  if (typeof config.journalPath !== 'string' || !isAbsolute(config.journalPath)) throw new Error('ABSOLUTE_ETA_JOURNAL_REQUIRED');
  mkdirSync(dirname(config.journalPath), { recursive:true, mode:0o700 });
  const engine=new DeepSeekETA(), seeded=new WeakSet();
  ctx.on('session/event',(session,event)=>{
    const id=alias(session.id), role=session.origin==='subagent'?'subagent':'root';
    try {
      if(!seeded.has(session)) {
        seeded.add(session);
        if(session.isSeeded===true)engine.session(id,role).invalid=true;
        // Warm-up is explicitly not a saved historical prediction.
        for(const previous of session.snapshotEvents()) {
          if(previous.seq>=event.seq)break;
          engine.apply(id,normalizeEvent(previous),role);
        }
      }
      if(engine.sessions.get(id)?.seq>=event.seq)return;
      const normalized=normalizeEvent(event);
      engine.apply(id,normalized,role);
      const prediction=engine.predict(id,event.time);
      const record={schema:'agent-eta.dsh-receipt/1',observedAt:Date.now(),session:id,event:normalized,prediction};
      appendFileSync(config.journalPath,JSON.stringify(record)+'\n',{mode:0o600});
      // Consumers can subscribe; original Agent ETA and the DSH UI stay untouched.
      ctx.emit('agent-eta/update',prediction ?? {id, status:'terminal_or_unknown'});
    } catch {
      engine.session(id,role).invalid=true;
      ctx.emit('agent-eta/update',{id,status:'invalid',reason:'event_or_journal_failure'});
      ctx.logger?.warn('Agent ETA observation incomplete; estimates withdrawn.');
    }
  });
}
