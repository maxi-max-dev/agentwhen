import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { alias, normalizeEvent } from '../src/deepseek/normalize.js';
import { DeepSeekETA, VERSION } from '../src/deepseek/model.js';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node scripts/deepseek-evaluate.mjs SESSION_DIRECTORY NEW_OUTPUT_DIRECTORY');
if(existsSync(output))throw new Error('OUTPUT_ALREADY_EXISTS');
mkdirSync(output,{recursive:true,mode:0o700});
const hash=b=>createHash('sha256').update(b).digest('hex');
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(join(dir,x.name)):x.name.endsWith('.zstd')?[join(dir,x.name)]:[]);}
const sessions=[],rejected=[];
for(const file of files(resolve(input))){
  try{
    const bytes=readFileSync(file), text=execFileSync('zstd',['-dc',file],{maxBuffer:128*1024*1024}).toString();
    const rows=text.trimEnd().split('\n').map(l=>JSON.parse(l)),h=rows.shift();
    if(h.type!=='session'||!h.id||!Number.isFinite(h.createdAt))throw new Error('HEADER');
    if(h.isSeeded){rejected.push({source:hash(bytes),reason:'seeded_history'});continue;}
    sessions.push({id:alias(h.id),parent:h.parentSession?alias(h.parentSession):null,createdAt:h.createdAt,
      role:h.origin==='subagent'?'subagent':'root',source:hash(bytes),raw:rows});
  }catch{rejected.push({source:hash(readFileSync(file)),reason:'unreadable_or_invalid'});}
}
const byId=new Map(sessions.map(s=>[s.id,s]));
function family(s,seen=new Set()) {
  if(seen.has(s.id))throw new Error('PARENT_CYCLE');seen.add(s.id);
  return s.parent && byId.has(s.parent)?family(byId.get(s.parent),seen):s.parent??s.id;
}
const groups=new Map();
for(const s of sessions){s.family=family(s);groups.set(s.family,Math.min(groups.get(s.family)??Infinity,s.createdAt));}
const ordered=[...groups].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0]));
const warmup=new Set(ordered.slice(0,Math.max(1,Math.floor(ordered.length*.6))).map(x=>x[0]));
for(const s of sessions)s.split=warmup.has(s.family)?'warmup':'heldout';
const manifest={schema:'agent-eta.dsh-offline-plan/1',createdAt:new Date().toISOString(),protocolHash:hash(readFileSync(new URL('../docs/DEEPSEEK-PILOT.md',import.meta.url))),
  modelVersion:VERSION,evidence:'real-history-offline-replay',cost:{modelCalls:0,apiCost:0},
  sessions:sessions.map(({raw,...s})=>s),rejected};
// Assignment is persisted before normalizing/analysing outcome events.
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
const events=[];
for(const s of sessions){
  try{for(const raw of s.raw)events.push({session:s.id,role:s.role,e:normalizeEvent(raw)});}
  catch{s.invalid=true;}
  delete s.raw;
}
events.sort((a,b)=>a.e.time-b.e.time||a.session.localeCompare(b.session)||a.e.seq-b.e.seq);
const engine=new DeepSeekETA(), forecasts=[],landmarks=[60000,300000,600000];
const nextIndex=new Map();
const snapshot=(id,time)=>{const f=engine.predict(id,time);if(f){f.landmark=f.elapsed/60000;forecasts.push(f);}};
function sampleBefore(time,inclusive=false){
  for(const [id,s]of engine.sessions){
    const r=s.open;if(!r||r.waitStart!==null)continue;
    let i=nextIndex.get(r.id)??0;
    while(i<landmarks.length){
      const at=r.start+r.waitMs+landmarks[i];
      if(inclusive?at>time:at>=time)break;
      snapshot(id,at);i++;
    }
    nextIndex.set(r.id,i);
  }
}
for(let i=0;i<events.length;){
  const time=events[i].e.time;sampleBefore(time);
  let j=i;while(j<events.length&&events[j].e.time===time)j++;
  // All same-time facts are visible before a landmark, independent of file order.
  for(let k=i;k<j;k++){
    const x=events[k];if(byId.get(x.session).invalid)engine.session(x.session,x.role).invalid=true;
    engine.apply(x.session,x.e,x.role);
  }
  sampleBefore(time,true);i=j;
}
const outcomes=engine.outcomes.map(({snapshots,...r})=>({...r,split:byId.get(r.session).split,family:byId.get(r.session).family}));
const outcomeById=new Map(outcomes.map(r=>[r.id,r]));
const rows=forecasts.map(f=>({...f,split:byId.get(f.session).split,family:byId.get(f.session).family,
  actualRemaining:outcomeById.has(f.id)?(outcomeById.get(f.id).duration-f.elapsed)/60000:null}));
const eligible=f=>{const r=outcomeById.get(f.id);return r?.valid&&r.reason==='completed'&&!r.hadWait&&f.actualRemaining>0;};
const median=a=>{const s=[...a].sort((a,b)=>a-b);return s.length?(s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2:null;};
function metrics(data,arm){
  const pairs=data.map(f=>[f,arm==='candidate'||arm==='ablation'?f[arm].forecast:f[arm]]).filter(([,p])=>p);
  if(!pairs.length)return {n:0};
  const errs=pairs.map(([f,p])=>Math.abs(p.p50-f.actualRemaining));
  return {n:pairs.length,mae:errs.reduce((a,b)=>a+b,0)/pairs.length,medianAE:median(errs),
    severeUnder:pairs.filter(([f,p])=>f.actualRemaining>2*p.p50).length/pairs.length,
    p80Coverage:arm==='competitor'?null:pairs.filter(([f,p])=>f.actualRemaining<=p.p80).length/pairs.length,
    meanWidth:arm==='competitor'?null:pairs.reduce((a,[,p])=>a+p.p80-p.p20,0)/pairs.length};
}
const counts={sessions:sessions.length,families:groups.size,rejectedSessions:rejected.length,
  closedTurns:outcomes.length,openTurns:[...engine.sessions.values()].filter(s=>s.open).length,
  invalid:outcomes.filter(r=>!r.valid).length,waitContaining:outcomes.filter(r=>r.hadWait).length,
  byReason:{},testCalls:outcomes.reduce((a,r)=>a+r.testCalls,0),knownTestResults:outcomes.reduce((a,r)=>a+r.testKnown,0),
  observedTestFailures:outcomes.reduce((a,r)=>a+r.failures,0),reworkProxies:outcomes.reduce((a,r)=>a+r.rework,0)};
for(const r of outcomes)counts.byReason[r.reason]=(counts.byReason[r.reason]??0)+1;
const comparisons=[];
for(const split of ['warmup','heldout'])for(const landmark of [1,5,10]){
  const all=rows.filter(f=>f.split===split&&f.landmark===landmark),valid=all.filter(eligible);
  const paired=valid.filter(f=>f.original&&f.candidate.forecast&&f.competitor);
  const ownPair=valid.filter(f=>f.original&&f.candidate.forecast);
  comparisons.push({split,landmark,observed:all.length,eligible:valid.length,
    availability:Object.fromEntries(['original','candidate','competitor'].map(k=>[k,metrics(valid,k).n])),
    pairedFamilies:new Set(paired.map(f=>f.family)).size,
    candidateUsed:paired.filter(f=>f.candidate.method===VERSION).length,
    primary:Object.fromEntries(['original','candidate','competitor','ablation'].map(k=>[k,metrics(paired,k)])),
    originalCandidateOnly:{original:metrics(ownPair,'original'),candidate:metrics(ownPair,'candidate')}});
}
const report={...manifest,counts,comparisons,status:'EXPLORATORY_OFFLINE_ONLY_NO_PROMOTION',
  limitations:['Normal turn ending is not human acceptance.','Parent families are clustered; subagents are not independent users.',
    'Historical forecasts reconstructed causally are not saved prospective forecasts.','Test outcome missing is unknown, not passed.',
    'Only the step-based competitor shares the primary prediction target. LLM PERT/report-progress have no comparable saved predictions.',
    'Remaining-round budget heuristic is not scored as successful task completion.','UI finishing state is scored as zero remaining when numeric forecast exhausted; count separately.'],
  competitorExhausted:rows.filter(f=>f.competitorExhausted).length};
for(const [name,data]of [['report.json',report],['outcomes.json',outcomes]])writeFileSync(join(output,name),JSON.stringify(data,null,2)+'\n',{mode:0o600});
writeFileSync(join(output,'forecasts.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
writeFileSync(join(output,'events.jsonl'),events.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
console.log(JSON.stringify({counts,comparisons,status:report.status},null,2));
