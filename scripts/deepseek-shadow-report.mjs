// Read only prospective receipts; never rerun a forecast using later outcomes.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { summarizeReceipts } from '../src/deepseek/report.js';
const dir=resolve(process.argv[2]??'.agent-eta/deepseek');
const journals=readdirSync(dir).filter(n=>n.endsWith('.jsonl')).sort().map(mount=>{
  const records=[];let invalidLines=0;
  for(const line of readFileSync(join(dir,mount),'utf8').split('\n').filter(Boolean)) {
    try{const r=JSON.parse(line);if(!r||typeof r!=='object')throw Error('invalid');records.push(r);}
    catch{invalidLines++;}
  }
  return {mount,records,invalidLines};
});
console.log(JSON.stringify(summarizeReceipts(journals),null,2));
