import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { alias } from './normalize.js';

/** Read-only local UI bridge. Never exposes raw logs, prompts or identifiers. */
export function createPanelState(journalPath) {
  const sessions=new Map();
  const state={startedAt:Date.now(),receipts:0,lastWrite:null,error:false};
  const track=(r)=>{
    if(!r.session)return;
    const s=sessions.get(r.session)??{receipts:0,lastWrite:null};
    s.receipts++;s.lastWrite=r.observedAt;state.receipts++;state.lastWrite=r.observedAt;
    if(r.outcome)s.outcome={reason:r.outcome.reason,failures:r.outcome.failures,rework:r.outcome.rework,steps:r.outcome.steps};
    sessions.set(r.session,s);
  };
  // Counts survive restart; predictions are deliberately not restored as live.
  try {for(const file of readdirSync(dirname(journalPath)).filter(f=>f.endsWith('.jsonl'))) {
    for(const line of readFileSync(join(dirname(journalPath),file),'utf8').split('\n')) {
      if(!line)continue;try{track(JSON.parse(line));}catch{/* interrupted line excluded */}
    }
  }}catch{state.error=true;}
  return {
    written:track,
    failed:()=>{state.error=true;},
    read(sessionId,engine){
      const id=alias(sessionId),s=sessions.get(id)??{receipts:0,lastWrite:null};
      const open=engine.sessions.get(id)?.open;
      return {...state,session:s,running:!!open,prediction:engine.predict(id,Date.now()),
        signals:open?{failures:open.failures,rework:open.rework,testKnown:open.testKnown}:null,
        version:'0.12.0-deepseek.5',mode:'shadow'};
    }
  };
}
export function registerPanel(ctx,panel,engine) {
  if(typeof ctx.inject!=='function')return;
  ctx.inject(['webServer'],child=>child.effect(()=>child.webServer.register({
    kind:'exact',path:'/agent-eta/status',handler:(req,res)=>{
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      const session=new URL(req.url,'http://localhost').searchParams.get('session')??'';
      if(session.length>256){res.writeHead(400);res.end();return;}
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      res.end(JSON.stringify(panel.read(session,engine)));
    }
  }),'agent-eta local status'));
}
