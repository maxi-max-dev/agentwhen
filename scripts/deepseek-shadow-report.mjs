// Read only prospective receipts; never rerun a forecast using later outcomes.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const dir=resolve(process.argv[2]??'.agent-eta/deepseek');
const rows=[], starts=new Set(), outcomes=new Map();let incompleteLines=0;
for(const name of readdirSync(dir).filter(n=>n.endsWith('.jsonl')).sort()) {
  for(const line of readFileSync(join(dir,name),'utf8').split('\n').filter(Boolean)) {
    try {const r=JSON.parse(line);rows.push(r);
      if(r.event?.type==='turn/start'&&r.prediction)starts.add(r.prediction.id);
      if(r.outcome)outcomes.set(r.outcome.id,r.outcome);
    }catch{incompleteLines++;}
  }
}
const eligible=[...outcomes.values()].filter(o=>starts.has(o.id)&&o.valid&&!o.hadWait&&o.reason==='completed');
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const comparisons=[1,5,10].map(minute=>{
  const pairs=[];
  for(const o of eligible) {
    // First prospectively saved prediction in a 30s window; missed windows abstain.
    const p=rows.filter(r=>r.prediction?.id===o.id).map(r=>r.prediction)
      .filter(p=>p.status==='experimental'&&p.elapsed>=minute*60000&&p.elapsed<(minute*60+30)*1000
        &&p.at<o.end&&p.original&&p.candidate?.forecast&&p.competitor)
      .sort((a,b)=>a.at-b.at)[0];
    if(!p)continue;
    const actual=(o.duration-p.elapsed)/60000;
    pairs.push({original:Math.abs(p.original.p50-actual),candidate:Math.abs(p.candidate.forecast.p50-actual),
      competitor:Math.abs(p.competitor.p50-actual),exhausted:p.competitorExhausted,
      fallback:p.candidate.method==='original_fallback'});
  }
  return {minute,n:pairs.length,originalMAE:mean(pairs.map(p=>p.original)),candidateMAE:mean(pairs.map(p=>p.candidate)),
    competitorRawMAE:mean(pairs.map(p=>p.competitor)),competitorExhausted:pairs.filter(p=>p.exhausted).length,
    candidateFallback:pairs.filter(p=>p.fallback).length};
});
console.log(JSON.stringify({schema:'agent-eta.prospective-report/1',receipts:rows.length,incompleteLines,
  closedTurns:outcomes.size,eligibleTurns:eligible.length,
  testCalls:[...outcomes.values()].reduce((s,o)=>s+o.testCalls,0),
  failures:[...outcomes.values()].reduce((s,o)=>s+o.failures,0),
  rework:[...outcomes.values()].reduce((s,o)=>s+o.rework,0),comparisons,
  conclusion:'Descriptive only; no automatic promotion. Missing/partial/restarted turns excluded.'},null,2));
