import { forecastRun } from '../core/estimator.js';
import { etaCore } from './vendor/turn-eta.js';
import { alias } from './normalize.js';

const M = 60000;
const q = (values, p) => {
  const a = [...values].sort((a,b)=>a-b), i = (a.length-1)*p, lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)]-a[lo])*(i-lo);
};
const features = r => ({ steps:r.steps.length, phase:r.phase, unresolved:r.unresolved, rework:r.rework > 0 });
const active = (r, time) => Math.max(0, time-r.start-r.waitMs-(r.waitStart === null ? 0 : time-r.waitStart));
export const VERSION = 'dsh-event-neighbours/1';

export function candidateForecast(base, history, current, elapsed, stepsOnly = false) {
  if (!base) return { forecast:null, method:'cold_start', neighbours:0 };
  const neighbours = history.filter(h=>h.duration>elapsed).map(h=>{
    const f = h.snapshots.findLast(s=>s.elapsed<=elapsed)?.features;
    if (!f) return null;
    const distance = Math.abs(Math.log((current.steps+1)/(f.steps+1))) + (stepsOnly ? 0
      : .75*Number(current.phase!==f.phase)+.75*Number(current.unresolved!==f.unresolved)+.5*Number(current.rework!==f.rework));
    return { distance, residual:(h.duration-elapsed)/M, id:h.id };
  }).filter(Boolean).sort((a,b)=>a.distance-b.distance || a.id.localeCompare(b.id)).slice(0,7);
  if (neighbours.length<3) return {forecast:base,method:'original_fallback',neighbours:neighbours.length};
  const weight = neighbours.length/(neighbours.length+3), values=neighbours.map(n=>n.residual);
  const forecast = {};
  for (const [key, p] of [['p20',.2],['p50',.5],['p80',.8]]) {
    forecast[key] = Math.exp((1-weight)*Math.log(Math.max(.001,base[key]))+weight*Math.log(Math.max(.001,q(values,p))));
  }
  return {forecast,method:stepsOnly?'steps_only':VERSION,neighbours:neighbours.length};
}

/** Pure event state; no host access, prompts, private text, or side effects. */
export class DeepSeekETA {
  constructor() { this.sessions=new Map(); this.history=[]; this.outcomes=[]; }
  session(id, role='root') {
    if (!this.sessions.has(id)) this.sessions.set(id,{id,role,seq:null,time:0,model:'unknown',open:null,invalid:false,stepSamples:[],turnSteps:[]});
    return this.sessions.get(id);
  }
  observeToolPhase(id,callId,phase,time) {
    const r=this.sessions.get(id)?.open;
    if(!r||r.calls.has(callId))return;
    r.calls.set(callId,{phase,settled:true,known:false});
    if(phase==='test')r.testCalls++;
    if(phase==='edit'&&r.unresolved&&r.phase!=='edit')r.rework++;
    r.phase=phase;
    r.snapshots.push({elapsed:active(r,time),features:features(r)});
  }
  observeToolOutcome(id,callId,outcome,time) {
    const r=this.sessions.get(id)?.open,call=r?.calls.get(callId);
    if(!r||!call||call.phase!=='test'||call.known||!['passed','failed'].includes(outcome))return;
    call.known=true;r.testKnown++;
    if(outcome==='failed'){r.failures++;r.unresolved=true;}else r.unresolved=false;
    r.snapshots.push({elapsed:active(r,time),features:features(r)});
  }
  apply(id, e, role='root') {
    const s=this.session(id,role);
    if (s.seq!==null && e.seq<=s.seq) return; // live replay duplicate
    if ((s.seq!==null && e.seq!==s.seq+1) || e.time<s.time) s.invalid=true;
    s.seq=e.seq;s.time=e.time;
    if (e.type==='inherited') s.invalid=true;
    if (e.type==='model') {
      if (s.open && s.open.model!=='unknown' && s.open.model!==e.model) s.open.modelChanged=true;
      s.model=e.model;if(s.open)s.open.model=e.model;
    }
    if (e.type==='turn/start') {
      if(s.open) {s.invalid=true;this.close(s,e.time,'malformed');}
      s.open={id:alias(`${id}/${e.turn}`),session:id,role,turn:e.turn,start:e.time,model:s.model,modelChanged:false,
        steps:[],stepStart:null,stepNumber:null,phase:'model',testCalls:0,testKnown:0,failures:0,rework:0,unresolved:false,
        calls:new Map(),approvals:new Set(),waitingCalls:new Set(),waitStart:null,waitMs:0,hadWait:false,
        lastTotal:undefined,snapshots:[]};
    }
    const r=s.open;if(!r)return;
    if(e.turn!==undefined && e.turn!==r.turn) {s.invalid=true;return;}
    if(e.type==='step/start') {
      if(r.stepStart!==null)s.invalid=true;
      r.stepStart=e.time;r.stepNumber=e.step;r.phase='model';
    }
    if(e.type==='tool/call') {
      if(r.calls.has(e.call))s.invalid=true;
      r.calls.set(e.call,{phase:e.phase,settled:false,known:false});
      if(e.phase==='edit' && r.unresolved && r.phase!=='edit')r.rework++;
      if(e.phase==='test')r.testCalls++;
      if(e.phase==='wait'){r.waitingCalls.add(e.call);r.hadWait=true;}
      r.phase=e.phase;
    }
    if(e.type==='tool/result'||e.type==='job/settled') {
      const call=r.calls.get(e.call);
      this.observeToolOutcome(id,e.call,e.outcome,e.time);
      if(e.type==='tool/result' && call){call.settled=true;r.waitingCalls.delete(e.call);}
    }
    if(e.type==='approval/asked'){r.approvals.add(e.approval);r.hadWait=true;}
    if(e.type==='approval/decided')r.approvals.delete(e.approval);
    const waiting=r.approvals.size+r.waitingCalls.size>0;
    if(waiting && r.waitStart===null)r.waitStart=e.time;
    if(!waiting && r.waitStart!==null){r.waitMs+=e.time-r.waitStart;r.waitStart=null;}
    if(e.type==='step/end') {
      if(r.stepStart===null || r.stepNumber!==e.step)s.invalid=true;
      else {const duration=e.time-r.stepStart;r.steps.push(duration);s.stepSamples.push(duration);}
      r.stepStart=null;
    }
    if(['turn/start','step/start','step/end','assistant/message','tool/call','tool/result'].includes(e.type)) {
      const core=etaCore({startTime:r.start,stepDurations:r.steps,completedTurnSteps:s.turnSteps,
        stepSamples:s.stepSamples,asOf:e.time,previousTotalMs:r.lastTotal});
      r.lastTotal=core.predictedTotalMs;
    }
    r.snapshots.push({elapsed:active(r,e.time),features:features(r)});
    if(e.type==='turn/end')this.close(s,e.time,e.reason);
  }
  close(s,time,reason) {
    const r=s.open;
    const record={id:r.id,session:r.session,role:r.role,model:r.model,start:r.start,end:time,duration:active(r,time),
      reason,valid:!s.invalid&&!r.modelChanged&&r.stepStart===null,hadWait:r.hadWait,
      steps:r.steps.length,testCalls:r.testCalls,testKnown:r.testKnown,failures:r.failures,rework:r.rework,snapshots:r.snapshots};
    this.outcomes.push(record);
    if(record.valid && reason==='completed' && record.duration>0 && !r.hadWait && r.model!=='unknown')this.history.push(record);
    if(r.steps.length)s.turnSteps.push(r.steps.length);
    s.open=null;return record;
  }
  predict(id,time) {
    const s=this.sessions.get(id),r=s?.open;
    if(!r || time<r.start)return null;
    const elapsed=active(r,time),f=features(r);
    const status=s.invalid||r.modelChanged?'invalid':r.waitStart!==null?'waiting':'experimental';
    const history=this.history.filter(h=>h.end<=time && h.model===r.model && h.role===r.role)
      .sort((a,b)=>b.end-a.end||a.id.localeCompare(b.id)).slice(0,200);
    let original=null;
    if(status==='experimental'&&history.length>=3){
      const p=forecastRun({state:{status:'running',activeElapsedMs:elapsed,steps:[]},
        history:history.map(h=>({actualMinutes:h.duration/M})),seed:r.id});
      original={p20:p.lowerMinutes,p50:p.p50Minutes,p80:p.p80Minutes};
    }
    const candidate=candidateForecast(original,history,f,elapsed);
    const ablation=candidateForecast(original,history,f,elapsed,true);
    const competitor=status==='experimental'&&r.lastTotal!==undefined
      ? {p50:Math.max(0,r.lastTotal-(time-r.start))/M}:null;
    return {schema:'agent-eta.dsh/1',id:r.id,session:id,at:time,elapsed,features:f,status,
      historyCount:history.length,original,candidate,ablation,competitor,calibrated:false,
      competitorExhausted:competitor?.p50===0};
  }
}
