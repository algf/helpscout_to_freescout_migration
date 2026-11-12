// Bounded local transaction-error diagnostic. It does not establish arrival performance.
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('@playwright/test');
import {guard,root,php,copy,docker as guardedDocker} from './local.mjs';
const exec=promisify(execFile),run=process.argv[2];if(!/^[a-z0-9-]{8,40}$/.test(run||''))throw Error('Synthetic fixture run required');
const installed=JSON.parse(readFileSync(path.join(root,'results','installed.json'),'utf8'));if(installed.container!==guard())throw Error('Installed container mismatch');
for(const [file,hash] of Object.entries(installed.hashes))if(guardedDocker(['exec',guard(),'sha256sum','/data/Modules/MailArrival/'+file]).split(/\s+/)[0]!==hash)throw Error('Runtime source drift: '+file);
const id=guard(),dir=`/tmp/mail-arrival-${run}`,receipt=path.join(root,'results',`${run}-diagnostic.json`);
const result={run,container:id,startedAt:new Date().toISOString(),cadenceSeconds:10,rounds:6,intervalSeconds:4,installedHashes:installed.hashes,observations:[],polls:[],errors:[]};
const save=()=>writeFileSync(receipt,JSON.stringify(result,null,2));const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
async function docker(args){return (await exec('docker',args,{timeout:120000,maxBuffer:8*1024*1024})).stdout.trim();}
async function inject(mailbox,kind){const raw=await docker(['exec','-u','nginx',id,'python3',`${dir}/inject.py`,'--state',`${dir}/state.json`,'--mailbox',String(mailbox),'--kind',kind]);const row=JSON.parse(raw);delete row.message_id;result.observations.push(row);save();}
const lastPollOk={1:false,2:false,3:false},lastPending={1:null,2:null,3:null};
async function poll(mailbox){try{const raw=await docker(['exec','-u','nginx',id,'php',`${dir}/poll.php`,String(mailbox),'standard',run]);const x=JSON.parse(raw);result.polls.push({mailbox,...x});if(!x.ok||x.result.status!=='success')throw Object.assign(new Error(`mailbox ${mailbox} poll: ${x.error||x.result.status}`),{stdout:raw});lastPollOk[mailbox]=true;lastPending[mailbox]=Number(x.result.pending_side_effects??x.result.pending_index??0);save();}catch(e){let detail;try{detail=JSON.parse(e.stdout||'');}catch{detail={message:String(e),stderr:(e.stderr||'').slice(0,1000)};}lastPollOk[mailbox]=false;result.polls.push({mailbox,failed:true,detail});result.errors.push({mailbox,detail});save();return false;}}
let done=false,workerError=null,started=false;const browsers=[],pages=[];
try{
 execFileSync(process.execPath,[path.join(root,'scripts/harness-provider.mjs'),'start',run],{encoding:'utf8',timeout:120000});started=true;copy(path.join(root,'harness/poll.php'),`${dir}/poll.php`);
 for(const mailbox of [1,2,3])await poll(mailbox);
 const fixtures=JSON.parse(readFileSync(path.join(root,'results','frontend-fixture.json'),'utf8'));
 for(const mailbox of [1,2,3]){
  const browser=await chromium.launch({headless:true});browsers.push(browser);const page=await browser.newPage({viewport:{width:1440,height:900}});pages.push(page);
  await page.addInitScript(({run,mailbox})=>{
   const seen={};window.__syntheticArrivalSeen=seen;
   const scan=()=>{for(const row of document.querySelectorAll('tr[data-conversation_id]')){
    const text=row.querySelector('.conv-subject')?.textContent||'';const prefix=`Arrival fixture ${run} mailbox ${mailbox} `;const start=text.indexOf(prefix);if(start<0)continue;
    const kind=text.slice(start+prefix.length).match(/^timing-\d{2}/)?.[0];if(!kind||seen[kind])continue;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{const r=row.getBoundingClientRect();const css=getComputedStyle(row);if(row.isConnected&&css.display!=='none'&&css.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight)seen[kind]={at:Date.now(),conversationId:row.dataset.conversation_id};}));
   }};
   document.addEventListener('DOMContentLoaded',()=>{new MutationObserver(scan).observe(document.documentElement,{subtree:true,childList:true,attributes:true});scan();},{once:true});
  },{run,mailbox});
  const url=fixtures.mailboxes[String(mailbox)].folderUrl;await page.goto('http://localhost:53927/staging-login/1?to='+encodeURIComponent(url));
  await page.waitForFunction(()=>document.documentElement.dataset.mailArrival==='ready'&&document.visibilityState==='visible',null,{timeout:15000});
 }
 const clockStart=Date.now(),containerMs=Number(await docker(['exec',id,'python3','-c','import time; print(int(time.time()*1000))'])),clockEnd=Date.now();
 result.clockComparison={containerMs,hostBeforeMs:clockStart,hostAfterMs:clockEnd,offsetEstimateMs:containerMs-(clockStart+clockEnd)/2,uncertaintyMs:(clockEnd-clockStart)/2,browserMs:await Promise.all(pages.map(page=>page.evaluate(()=>Date.now())))};
 const t=Date.now();
 const workers=Promise.all([1,2,3].map(async mailbox=>{let tick=0;while(!done){await sleep(t+tick*10000-Date.now());if(done)break;await poll(mailbox);tick++;}})).catch(e=>{workerError=e;done=true;});
 for(let round=1;round<7;round++){
  await sleep(t+(round-1)*4000-Date.now());
  if(workerError)throw workerError;
  await Promise.all([1,2,3].map(async mailbox=>{await sleep((mailbox-1)*1000);await inject(mailbox,`timing-${String(round).padStart(2,'0')}`);}));
  if(round%3===0)console.log(JSON.stringify({rounds:round,arrivals:result.observations.length,failedPolls:result.errors.length}));
 }
 await sleep(12000);done=true;await workers;if(workerError)throw workerError;await Promise.all([1,2,3].map(poll));await sleep(4000);
 const endClockStart=Date.now(),endContainerMs=Number(await docker(['exec',id,'python3','-c','import time; print(int(time.time()*1000))'])),endClockEnd=Date.now();
 const offsetLow=Math.min(containerMs-clockEnd,endContainerMs-endClockEnd),offsetHigh=Math.max(containerMs-clockStart,endContainerMs-endClockStart);
 Object.assign(result.clockComparison,{endContainerMs,endHostBeforeMs:endClockStart,endHostAfterMs:endClockEnd,offsetLowMs:offsetLow,offsetHighMs:offsetHigh,offsetEstimateMs:(offsetLow+offsetHigh)/2,uncertaintyMs:(offsetHigh-offsetLow)/2});
 const visibleByMailbox=await Promise.all(pages.map(page=>page.evaluate(()=>window.__syntheticArrivalSeen||{})));
 result.browserResources=await Promise.all(pages.map((page,index)=>page.evaluate(mailbox=>({mailbox,visibility:document.visibilityState,timeOrigin:performance.timeOrigin,entries:performance.getEntriesByType('resource').filter(e=>{const p=new URL(e.name).pathname;return new URL(e.name).origin===location.origin&&['fetch','xmlhttprequest'].includes(e.initiatorType);}).map(e=>({path:new URL(e.name).pathname,initiatorType:e.initiatorType,startTime:e.startTime,duration:e.duration,responseStart:e.responseStart,responseEnd:e.responseEnd}))}),index+1)));

 const commits=new Map(result.polls.flatMap(p=>p.after_commit||[]).map(e=>[e.identity,e.observed_after_commit*1000]));
 const beforeCommits=new Map(result.polls.flatMap(p=>p.before_commit||[]).map(e=>[e.identity,e.observed_before_commit*1000]));
 for(const o of result.observations){
  const c=commits.get(o.identity),b=beforeCommits.get(o.identity),v=visibleByMailbox[o.mailbox-1][o.kind],offset=result.clockComparison.offsetEstimateMs,uncert=result.clockComparison.uncertaintyMs;
  o.observed_before_commit=b??null;o.observed_after_commit=c??null;o.visible_at_ms=v?.at??null;o.conversation_id=v?.conversationId??null;
  o.receipt_to_observed_commit_lower_ms=c==null?null:c-Date.parse(o.provider_received_after);o.receipt_to_observed_commit_upper_ms=c==null?null:c-Date.parse(o.provider_received_before);
  o.provider_to_visible_lower_ms=v?v.at+offset-uncert-Date.parse(o.provider_received_after):null;
  o.provider_to_visible_upper_ms=v?v.at+offset+uncert-Date.parse(o.provider_received_before):null;
  o.commit_to_visible_lower_ms=v&&c!=null?v.at+offset-uncert-c:null;
  o.commit_to_visible_upper_ms=v&&b!=null?v.at+offset+uncert-b:null;
 }

 const encoded=Buffer.from(JSON.stringify(result.observations.map(x=>x.identity))).toString('base64');
 const mapping=JSON.parse(php(`$ids=json_decode(base64_decode('${encoded}'),true);$out=[];foreach(DB::table('mail_arrival_messages')->whereIn('identity',$ids)->get() as $r){$t=App\\Thread::find($r->target_thread_id);if($t)$out[$r->identity]=['mailbox_id'=>(int)$r->mailbox_id,'conversation_id'=>(string)$t->conversation_id];}echo json_encode($out);`));
 for(const o of result.observations)o.visible_matches_committed=!!mapping[o.identity]&&mapping[o.identity].mailbox_id===o.mailbox&&mapping[o.identity].conversation_id===String(o.conversation_id);

 const p95=xs=>{const a=xs.slice().sort((a,b)=>a-b);return a[Math.ceil(a.length*.95)-1]??null;};
 result.byMailbox=[1,2,3].map(mailbox=>{const rows=result.observations.filter(x=>x.mailbox===mailbox);return {mailbox,samples:rows.length,observedCommitted:rows.filter(x=>Number.isFinite(x.observed_before_commit)&&Number.isFinite(x.observed_after_commit)).length,visible:rows.filter(x=>Number.isFinite(x.visible_at_ms)&&x.visible_matches_committed).length,p95CommitUpperMs:p95(rows.map(x=>x.receipt_to_observed_commit_upper_ms).filter(Number.isFinite)),p95ProviderToVisibleUpperMs:p95(rows.map(x=>x.provider_to_visible_upper_ms).filter(Number.isFinite)),p95CommitToVisibleLowerMs:p95(rows.map(x=>x.commit_to_visible_lower_ms).filter(Number.isFinite)),p95CommitToVisibleUpperMs:p95(rows.map(x=>x.commit_to_visible_upper_ms).filter(Number.isFinite))};});
 if(result.observations.length!==18||result.byMailbox.some(x=>x.samples!==6||x.observedCommitted!==6||x.visible!==6)||result.observations.some(o=>o.observed_after_commit<o.observed_before_commit||o.provider_to_visible_upper_ms<0||o.commit_to_visible_upper_ms<0)||Object.values(lastPollOk).some(ok=>!ok)||Object.values(lastPending).some(n=>n!==0))throw Error('Incomplete or inconsistent timing samples, unresolved poll failure or pending side effects');
 result.scope='Diagnostic only: six arrivals per mailbox and three foreground synthetic browsers; no performance acceptance claim.';
 result.lastPending=lastPending;result.unresolvedPollFailures=Object.entries(lastPollOk).filter(([,ok])=>!ok).map(([mailbox])=>Number(mailbox));result.ok=true;result.completedAt=new Date().toISOString();result.limit='Synthetic provider and local emulated stack; commit is bounded between observers immediately before and after transaction commit, not known exactly. Visibility requires a row within the headless browser viewport after two animation frames. Clock offset is bounded separately; this does not measure Gmail delivery.';save();console.log(JSON.stringify({run,byMailbox:result.byMailbox,receipt}));
}catch(e){done=true;result.errors.push(String(e));result.lastPending=lastPending;result.unresolvedPollFailures=Object.entries(lastPollOk).filter(([,ok])=>!ok).map(([mailbox])=>Number(mailbox));result.ok=false;result.completedAt=new Date().toISOString();save();console.error(String(e));process.exitCode=1;}finally{await Promise.all(browsers.map(b=>b.close()));if(started){try{execFileSync(process.execPath,[path.join(root,'scripts/harness-provider.mjs'),'stop',run],{encoding:'utf8',timeout:120000});}catch(e){console.error('Provider stop failed: '+String(e));process.exitCode=1;}}}
