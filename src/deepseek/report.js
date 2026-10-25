/** Summarize saved prospective predictions; one journal is one host mount. */
export function summarizeReceipts(journals) {
  const starts=new Set(),outcomes=new Map(),forecasts=new Map();
  let receipts=0,incompleteLines=0;
  for(const {mount,records,invalidLines=0} of journals) {
    incompleteLines+=invalidLines;
    for(const r of records) {
      receipts++;
      const key=id=>JSON.stringify([mount,id]);
      if(r.event?.type==='turn/start'&&r.prediction)starts.add(key(r.prediction.id));
      if(r.outcome)outcomes.set(key(r.outcome.id),r.outcome);
      if(r.prediction) {
        const k=key(r.prediction.id),list=forecasts.get(k)??[];
        list.push(r.prediction);forecasts.set(k,list);
      }
    }
  }
  const eligible=[...outcomes].filter(([k,o])=>starts.has(k)&&o.valid&&!o.hadWait&&o.reason==='completed');
  const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  const comparisons=[1,5,10].map(minute=>{
    const pairs=[];
    for(const [key,o] of eligible) {
      // Identical frozen windows. Never borrow a start/forecast from another mount.
      const p=(forecasts.get(key)??[]).filter(p=>p.status==='experimental'
        &&p.elapsed>=minute*60000&&p.elapsed<(minute*60+30)*1000&&p.at<o.end
        &&p.original&&p.candidate?.forecast&&p.competitor).sort((a,b)=>a.at-b.at)[0];
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
  return {schema:'agent-eta.prospective-report/2',receipts,incompleteLines,
    closedTurns:outcomes.size,eligibleTurns:eligible.length,
    turnsWithoutObservedStart:[...outcomes.keys()].filter(k=>!starts.has(k)).length,
    testCalls:[...outcomes.values()].reduce((s,o)=>s+o.testCalls,0),
    failures:[...outcomes.values()].reduce((s,o)=>s+o.failures,0),
    rework:[...outcomes.values()].reduce((s,o)=>s+o.rework,0),comparisons,
    conclusion:'Descriptive only; no automatic promotion. Missing/partial/restarted turns excluded.'};
}
