import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir=process.argv[2]||'results';
const files=readdirSync(dir).filter(n=>n.endsWith('.json')&&n!=='summary.json');
const documents=files.map(file=>({file,data:JSON.parse(readFileSync(`${dir}/${file}`,'utf8'))}));
const manifests=documents.filter(d=>d.file.endsWith('-manifest.json')).map(d=>d.data);
if(!manifests.length)throw Error('Run manifest missing. Refusing to combine unverified or historical samples.');
const percentile=(values,p)=>{if(!values.length)return null;const sorted=values.map(v=>typeof v==='number'&&Number.isFinite(v)?v:Infinity).sort((a,b)=>a-b);const v=sorted[Math.ceil(sorted.length*p)-1];return Number.isFinite(v)?Math.round(v*10)/10:'FAIL / missing';};
const groups=new Map();const integrityFailures=[];
for(const manifest of manifests){
 const actual=documents.filter(d=>d.data.scenario&&d.data.variant===manifest.variant);
 const stale=actual.filter(d=>d.data.runId!==manifest.runId);
 for(const d of stale)integrityFailures.push(`${d.file}: stale run ID excluded`);
 for(const expected of manifest.expected){
  const matches=actual.filter(d=>d.data.runId===manifest.runId&&['project','mailbox','scenario','repeat'].every(k=>d.data[k]===expected[k]));
  const failures=[];if(matches.length!==1)failures.push(`Expected exactly one sample, found ${matches.length}`);
  const run=matches.length===1?matches[0].data:{...expected,variant:manifest.variant,runId:manifest.runId,actions:[],responses:[],config:{closeCount:expected.scenario==='unsubscribe-only'?0:10},failures:[]};
  const runtimeHashes=Object.values(manifest.verifiedRuntime?.files||{}).sort();
  const sampleHashes=Object.values(run.sourceHashes||{}).sort();
  if(JSON.stringify(runtimeHashes)!==JSON.stringify(sampleHashes)||runtimeHashes.length!==5)failures.push('Sample source hashes do not match five verified runtime source files');
  run.reportFailures=[...(run.failures||[]),...failures];
  for(const mailbox of ['all',String(expected.mailbox)]){
   const key=[manifest.variant,expected.project,`mailbox-${mailbox}`,expected.scenario].join('/');
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(run);
  }
 }
}
const report=[];
for(const [group,runs] of groups){
 const ack=[],server=[],confirmed=[],inputBursts=[],batchCompletions=[],runMeasurements=[];
 for(const run of runs){
  const expected=run.config?.closeCount??10;
  const ids=run.closeIds||[];
  const runEvents=[],runCompletions=[];
  let completeEvents=Boolean(expected)&&ids.length===expected;
  let completeResponses=completeEvents;
  if(expected&&ids.length===expected){
   for(const id of ids){
    const actions=(run.actions||[]).filter(a=>a.kind==='close'&&a.id===id);
    const responses=(run.responses||[]).filter(r=>new URLSearchParams(r.body).get('conversation_id')===String(id));
    ack.push(actions.length===1?actions[0].ackMs:null);
    server.push(responses.length===1&&responses[0].success?responses[0].responseMs:null);
    const event=actions.length===1?actions[0].eventEpochMs:null;
    const completion=responses.length===1&&responses[0].success?responses[0].completedEpochMs:null;
    const validEvent=typeof event==='number'&&Number.isFinite(event);
    const validCompletion=typeof completion==='number'&&Number.isFinite(completion);
    confirmed.push(validEvent&&validCompletion&&completion>=event?completion-event:null);
    if(validEvent)runEvents.push(event);else completeEvents=false;
    if(validCompletion&&validEvent&&completion>=event)runCompletions.push(completion);else completeResponses=false;
   }
  }else for(let i=0;i<expected;i++){ack.push(null);server.push(null);confirmed.push(null);}
  if(expected){
   inputBursts.push(completeEvents?Math.max(...runEvents)-Math.min(...runEvents):null);
   batchCompletions.push(completeEvents&&completeResponses?Math.max(...runCompletions)-Math.min(...runEvents):null);
   runMeasurements.push({mailbox:run.mailbox,repeat:run.repeat,inputBurstMs:inputBursts.at(-1),confirmedBatchMs:batchCompletions.at(-1)});
  }
 }
 const ackP95Ms=percentile(ack,.95);
 const p95Passed=ack.length?typeof ackP95Ms==='number'&&ackP95Ms<100:null;
 const failures=runs.flatMap(r=>r.reportFailures);
 if(p95Passed===false)failures.push('Group close acknowledgement p95 must be below 100 ms');
 report.push({group,runMeasurements,runId:runs[0].runId,runs:runs.length,failedRuns:runs.filter(r=>r.reportFailures.length).length,failures,ackP50Ms:percentile(ack,.5),ackP95Ms,ackP95Passed:p95Passed,serverP50Ms:percentile(server,.5),serverP95Ms:percentile(server,.95),clickToConfirmedP50Ms:percentile(confirmed,.5),clickToConfirmedP95Ms:percentile(confirmed,.95),inputBurstP50Ms:percentile(inputBursts,.5),inputBurstP95Ms:percentile(inputBursts,.95),confirmedBatchP50Ms:percentile(batchCompletions,.5),confirmedBatchP95Ms:percentile(batchCompletions,.95),transportToHiddenP50Ms:percentile(runs.filter(r=>r.scenario==='unsubscribe-only').map(r=>r.transportToHiddenMs),.5),transportToHiddenP95Ms:percentile(runs.filter(r=>r.scenario==='unsubscribe-only').map(r=>r.transportToHiddenMs),.95),transportToCounterP95Ms:percentile(runs.filter(r=>r.scenario==='unsubscribe-only').map(r=>r.transportToCounterMs),.95)});
}
for(const row of report){const parts=row.group.split('/');if(parts[3]==='close-only'||parts[3]==='unsubscribe-only')continue;const closeOnly=report.find(r=>r.group===[...parts.slice(0,3),'close-only'].join('/'));for(const key of ['ackP50Ms','ackP95Ms','serverP50Ms','serverP95Ms','clickToConfirmedP50Ms','clickToConfirmedP95Ms','inputBurstP50Ms','inputBurstP95Ms','confirmedBatchP50Ms','confirmedBatchP95Ms'])row[`${key}MixedToCloseOnlyRatio`]=typeof row[key]==='number'&&typeof closeOnly?.[key]==='number'&&closeOnly[key]>0?Math.round(row[key]/closeOnly[key]*100)/100:null;}
writeFileSync(`${dir}/summary.json`,JSON.stringify({integrityFailures,groups:report},null,2));
console.table(report.map(({failures,runMeasurements,...r})=>r));
if(integrityFailures.length)console.error(integrityFailures.join('\n'));
console.log('Each expected ticket contributes one sample per run. Missing, duplicate and unsuccessful confirmations remain in denominators. Source and run IDs must match the verified manifest.');
if(integrityFailures.length||report.some(r=>r.group.startsWith('candidate/')&&r.failures.length))process.exitCode=1;
