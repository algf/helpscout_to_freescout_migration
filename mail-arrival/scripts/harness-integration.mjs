// Real local importer integration. Never selects a remote host or changes mailbox settings.
import {execFileSync,execFile,spawnSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
const execAsync=promisify(execFile);
import {guard,docker,php,copy,root} from './local.mjs';
const run=process.argv[2];if(!/^[a-z0-9-]{8,40}$/.test(run||''))throw Error('Unique synthetic run required');
if(!existsSync(path.join(root,'results/backup-path.txt'))||!existsSync(path.join(root,'results/installed.json')))throw Error('Verified backup and local module receipt required');
const id=guard(), install=JSON.parse(readFileSync(path.join(root,'results/installed.json'),'utf8'));if(install.container!==id)throw Error('Installed container mismatch');
for(const [file,expected] of Object.entries(install.hashes)){const actual=docker(['exec',id,'sha256sum','/data/Modules/MailArrival/'+file]).split(/\s+/)[0];if(actual!==expected)throw Error('Installed module drift: '+file);}
const results={run,container:id,installedHashes:install.hashes,startedAt:new Date().toISOString(),checks:[],errors:[]};const out=path.join(root,'results',`${run}-integration.json`);
function save(){writeFileSync(out,JSON.stringify(results,null,2));}
function assert(ok,message,details){results.checks.push({message,passed:!!ok,details});save();if(!ok)throw Error(message);}
function call(file,args){return execFileSync(process.execPath,[path.join(root,'scripts',file),...args],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});}
function poll(mailbox,expectSuccess=true,faultIdentity=null){const env=faultIdentity?['-e',`MAIL_ARRIVAL_FIXTURE_FAULT_IDENTITY=${faultIdentity}`]:[];const r=spawnSync('docker',['exec','-u','nginx',...env,id,'php',`/tmp/mail-arrival-${run}/poll.php`,String(mailbox),'standard',run],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});let data;try{data=JSON.parse(r.stdout);}catch{throw Error(`Mailbox ${mailbox} poll returned non-JSON: ${(r.stderr||r.stdout).slice(0,500)}`);}if(expectSuccess&&!data.ok)throw Error(`Mailbox ${mailbox} poll failed: ${data.error}`);return data;}
function manipulate(mailbox,args){return JSON.parse(docker(['exec','-u','nginx',id,'python3',`/tmp/mail-arrival-${run}/control.py`,'--state',`/tmp/mail-arrival-${run}/state.json`,'--mailbox',String(mailbox),...args]));}
function inject(mailbox,kind,extra=[]){return JSON.parse(docker(['exec','-u','nginx',id,'python3',`/tmp/mail-arrival-${run}/inject.py`,'--state',`/tmp/mail-arrival-${run}/state.json`,'--mailbox',String(mailbox),'--kind',kind,...extra]));}
function rows(identities){const b=Buffer.from(JSON.stringify(identities)).toString('base64');return JSON.parse(php(`$ids=json_decode(base64_decode('${b}'),true);$out=[];foreach($ids as $identity){$r=DB::table('mail_arrival_messages')->where('identity',$identity)->first();if(!$r){$out[$identity]=null;continue;}$t=App\\Thread::find($r->target_thread_id);$out[$identity]=['outcome'=>$r->outcome,'thread_id'=>$r->target_thread_id,'conversation_id'=>$t?$t->conversation_id:null,'mailbox_id'=>$r->mailbox_id,'status'=>$t?(int)$t->conversation->status:null,'state'=>$t?(int)$t->conversation->state:null,'thread_type'=>$t?(int)$t->type:null,'has_attachments'=>$t?(bool)$t->has_attachments:false,'attachment_hashes'=>$t?$t->attachments->map(function($a){return is_file($a->getLocalFilePath())?hash_file('sha256',$a->getLocalFilePath()):null;})->all():[]];}echo json_encode($out);`));}
try{
 call('harness-provider.mjs',['start',run]);copy(path.join(root,'harness/poll.php'),`/tmp/mail-arrival-${run}/poll.php`);
 const state=JSON.parse(readFileSync(path.join(root,'results',`${run}-provider.json`),'utf8'));
 for(const mailbox of [1,2,3]){
  const messages=state.accounts[`fixture-${mailbox}`].folders.INBOX.messages, identities=messages.map(x=>'gmail:'+x.gmail_msgid);
  const first=poll(mailbox);assert(first.ok&&first.result.status==='success',`mailbox ${mailbox} initial poll completes`,first.result);
  const records=rows(identities);assert(identities.every(x=>records[x]&&records[x].mailbox_id===mailbox&&records[x].thread_id),`mailbox ${mailbox} persists all four fixture messages`,records);
  const afterState=JSON.parse(docker(['exec',id,'cat',`/tmp/mail-arrival-${run}/state.json`]));
  const afterMessages=afterState.accounts[`fixture-${mailbox}`].folders.INBOX.messages;
  assert(messages[3].seen===true&&afterMessages[3].seen===true&&!!records[identities[3]]?.thread_id,`mailbox ${mailbox} imports read-before-fetch message and preserves seen flag`);
  assert(messages.every((m,index)=>m.seen===afterMessages[index].seen),`mailbox ${mailbox} leaves all initial source flags unchanged`);

  assert(records[identities[0]].conversation_id===records[identities[1]].conversation_id,`mailbox ${mailbox} groups reply with new message`);
  assert(records[identities[2]].has_attachments&&records[identities[2]].attachment_hashes.includes(createHash('sha256').update('local-synthetic-attachment\n').digest('hex')),`mailbox ${mailbox} persists exact attachment bytes`);
  const replay=poll(mailbox);assert(replay.ok&&replay.result.changed===0,`mailbox ${mailbox} replay creates no change`,replay.result);
 }
 // Fiveways labels and drafts retain the existing importer policy.
 const policy=Object.fromEntries(['archived','sent','spam','trash','draft'].map(kind=>[kind,inject(3,`policy-${kind}`)]));
 const policyPoll=poll(3);assert(policyPoll.ok,'Fiveways policy fixture poll completes',policyPoll.result);
 const policyRows=rows(Object.values(policy).map(x=>x.identity));
 assert(policyRows[policy.archived.identity]?.status===3,'Fiveways archived message remains closed');
 assert(policyRows[policy.sent.identity]?.thread_type===2,'Fiveways Sent fixture becomes a user thread');
 assert(policyRows[policy.spam.identity]?.status===4,'Fiveways Spam fixture remains spam');
 const deletedState=Number(php('echo App\\Conversation::STATE_DELETED;'));
 assert(policyRows[policy.trash.identity]?.state===deletedState,'Fiveways Trash fixture remains deleted');
 const deferred=JSON.parse(php("echo json_encode(DB::table('mail_arrival_deferred')->where('mailbox_id',3)->pluck('source')->all());")).map(JSON.parse);
 assert(!policyRows[policy.draft.identity]&&deferred.some(x=>Number(x.UID)===policy.draft.uid),'Fiveways Draft stays deferred');
 // The provider transcript differentiates BODY[] from metadata; empty steady polls must fetch no bodies.
 const before=JSON.parse('['+docker(['exec',id,'cat',`/tmp/mail-arrival-${run}/events.jsonl`]).trim().split('\n').filter(Boolean).join(',')+']');
 assert(!before.some(e=>e.operation==='STORE'||(['body','header'].includes(e.kind)&&e.peek!==true)),'import transcript contains no STORE or non-PEEK MIME fetches');
 for(const mailbox of [1,2,3])poll(mailbox);
 const after=JSON.parse('['+docker(['exec',id,'cat',`/tmp/mail-arrival-${run}/events.jsonl`]).trim().split('\n').filter(Boolean).join(',')+']');
 assert(after.slice(before.length).filter(e=>e.kind==='body').length===0,'empty steady polls fetch zero message bodies');
 // A provider error must leave the checkpoint unchanged, then recovery processes the same UID.
 const injected=inject(1,'timing-01');const key=Buffer.from('1\0INBOX').toString('hex');
 const checkpoint=()=>php(`$k=hash('sha256',hex2bin('${key}'));echo DB::table('mail_arrival_sources')->where('source_key',$k)->value('state');`);
 const old=checkpoint();manipulate(1,['--fail','FETCH']);const failure=poll(1,false);const unchanged=checkpoint();
 assert(!failure.ok&&unchanged===old,'provider FETCH failure does not advance checkpoint',{error:failure.error});
 manipulate(1,['--fail','off']);const recovery=poll(1);assert(recovery.ok&&recovery.result.changed>0,'provider recovery imports previously failed UID',recovery.result);
 // Fail after the native write and ledger/version updates, immediately before DB commit.
 const rollback=inject(1,'rollback'),rollbackSubject=Buffer.from(`Arrival fixture ${run} mailbox 1 rollback`).toString('base64'),rollbackIdentity=Buffer.from(rollback.identity).toString('base64');
 const snapshot=()=>JSON.parse(php(`$subject=base64_decode('${rollbackSubject}');$identity=base64_decode('${rollbackIdentity}');$key=hash('sha256',"1\\0INBOX");echo json_encode(['conversations'=>DB::table('conversations')->where('mailbox_id',1)->where('subject',$subject)->count(),'threads'=>DB::table('threads')->join('conversations','conversations.id','=','threads.conversation_id')->where('conversations.mailbox_id',1)->where('conversations.subject',$subject)->count(),'ledger'=>DB::table('mail_arrival_messages')->where('mailbox_id',1)->where('identity',$identity)->count(),'version'=>DB::table('mail_arrival_versions')->where('mailbox_id',1)->value('version'),'outbox'=>DB::table('mail_arrival_event_outbox')->where('mailbox_id',1)->count(),'checkpoint'=>DB::table('mail_arrival_sources')->where('source_key',$key)->value('state')]);`));
 const beforeRollback=snapshot();const failedCommit=poll(1,false,rollback.identity);const afterRollback=snapshot();
 assert(!failedCommit.ok&&failedCommit.error.includes('Synthetic pre-commit fault')&&JSON.stringify(beforeRollback)===JSON.stringify(afterRollback),'pre-commit failure rolls back native thread, conversation, ledger, version, outbox and checkpoint',{before:beforeRollback,after:afterRollback,error:failedCommit.error});
 const retried=poll(1);const finalRollback=snapshot();assert(retried.ok&&finalRollback.conversations===1&&finalRollback.threads===1&&finalRollback.ledger===1,'rolled-back message imports exactly once on retry',finalRollback);
 // A new UIDVALIDITY forces bounded reconciliation; already imported stable IDs must not duplicate.
 const original=state.accounts['fixture-1'].folders.INBOX.uidvalidity;manipulate(1,['--uidvalidity',String(original+1)]);
 const reset=poll(1);assert(reset.ok&&reset.result.changed===0,'UIDVALIDITY reset replays without duplicate changes',reset.result);
 const firstIdentity='gmail:'+state.accounts['fixture-1'].folders.INBOX.messages[0].gmail_msgid;
 const duplicates=Number(php(`echo DB::table('mail_arrival_messages')->where('mailbox_id',1)->where('identity','${firstIdentity}')->count();`));assert(duplicates===1,'UIDVALIDITY replay retains one stable ledger record');
 // Slow one provider account and prove independent workers in the other mailboxes finish first.
 for(const mailbox of [1,2,3])inject(mailbox,'timing-02');
 manipulate(1,['--delay-search-ms','5000']);
 try {
  const concurrent=await Promise.all([1,2,3].map(async mailbox=>{const r=await execAsync('docker',['exec','-u','nginx',id,'php',`/tmp/mail-arrival-${run}/poll.php`,String(mailbox),'standard',run],{timeout:120000,maxBuffer:8*1024*1024});return JSON.parse(r.stdout);}));
  assert(concurrent.every(x=>x.ok&&x.result.status==='success'&&x.result.changed>0)&&concurrent[1].poll_returned_at<concurrent[0].poll_returned_at&&concurrent[2].poll_returned_at<concurrent[0].poll_returned_at,'slow mailbox does not block the other two workers',concurrent.map(x=>({mailbox:x.result.mailbox_id,returnedAt:x.poll_returned_at,changed:x.result.changed})));
 } finally {manipulate(1,['--delay-search-ms','0']);}
 // Cross-mail source and target are synthetic; the target owner pause must not be bypassed.
 const emails=JSON.parse(php("echo json_encode(App\\Mailbox::whereIn('id',[1,2])->orderBy('id')->pluck('email')->all());"));
 assert(emails.length===2,'two isolated mailbox addresses available for cross-mail fixture');
 const cross=inject(1,'cross-mail',['--recipients-json',JSON.stringify(emails)]);manipulate(2,['--copy-from-mailbox1-uid',String(cross.uid)]);
 const marker=`/tmp/mail-arrival-${run}/mailbox-2-sync.paused`,released=marker+'.released';
 docker(['exec','-u','nginx',id,'touch',marker]);
 try {
  const source=poll(1);assert(source.ok&&source.result.changed>0,'source mailbox imports cross-mail while target paused');
  const encoded=Buffer.from(cross.identity).toString('base64');
  const targets=()=>JSON.parse(php(`$key=base64_decode('${encoded}');$out=[];foreach([1,2]as$m){$rows=DB::table('mail_arrival_messages')->where('mailbox_id',$m)->where('identity',$key)->get();$out[$m]=['count'=>$rows->count(),'thread_id'=>$rows->first()->target_thread_id??null];}echo json_encode($out);`));
  const paused=targets();assert(paused['1'].count===1&&paused['2'].count===0,'paused target receives no cross-import',paused);
  const stopped=poll(2);assert(stopped.result.status==='paused'&&stopped.result.changed===0,'target poll respects owner pause',stopped.result);
 } finally {docker(['exec','-u','nginx',id,'mv',marker,released]);}
 const resumed=poll(2);assert(resumed.ok&&resumed.result.changed>0,'target imports cross-mail after pause is lifted',resumed.result);
 const encodedCross=Buffer.from(cross.identity).toString('base64');const crossTargets=JSON.parse(php(`$key=base64_decode('${encodedCross}');$out=[];foreach([1,2]as$m){$rows=DB::table('mail_arrival_messages')->where('mailbox_id',$m)->where('identity',$key)->get();$r=$rows->first();$t=$r?App\\Thread::find($r->target_thread_id):null;$out[$m]=['count'=>$rows->count(),'conversation_id'=>$t?$t->conversation_id:null];}echo json_encode($out);`));
 assert(crossTargets['1'].count===1&&crossTargets['2'].count===1&&crossTargets['1'].conversation_id!==crossTargets['2'].conversation_id,'cross-mail has one separate target per mailbox after resume',crossTargets);
 // Race the same provider message through both native mailbox workers.
 const race=inject(1,'cross-race',['--recipients-json',JSON.stringify(emails)]);manipulate(2,['--copy-from-mailbox1-uid',String(race.uid)]);
 const racePolls=await Promise.all([1,2].map(async mailbox=>{try{const r=await execAsync('docker',['exec','-u','nginx',id,'php',`/tmp/mail-arrival-${run}/poll.php`,String(mailbox),'standard',run],{timeout:120000,maxBuffer:8*1024*1024});return JSON.parse(r.stdout);}catch(e){let d;try{d=JSON.parse(e.stdout);}catch{d={ok:false,error:String(e)}}return d;}}));
 assert(racePolls.every(x=>x.ok&&['success','busy'].includes(x.result.status)),'simultaneous cross-mailbox polls complete or defer safely',racePolls);
 for(let index=0;index<racePolls.length;index++)if(racePolls[index].result.status==='busy'){const retry=poll(index+1);assert(retry.ok&&retry.result.status==='success',`mailbox ${index+1} completes after safe lock deferral`,retry.result);}
 const raceEncoded=Buffer.from(race.identity).toString('base64'), subjectEncoded=Buffer.from(`Arrival fixture ${run} mailbox 1 cross-race`).toString('base64');
 const raceCounts=JSON.parse(php(`$key=base64_decode('${raceEncoded}');$subject=base64_decode('${subjectEncoded}');$out=[];foreach([1,2]as$m){$ledger=DB::table('mail_arrival_messages')->where('mailbox_id',$m)->where('identity',$key)->get();$threads=DB::table('threads')->join('conversations','conversations.id','=','threads.conversation_id')->where('conversations.mailbox_id',$m)->where('conversations.subject',$subject)->count();$out[$m]=['ledger'=>$ledger->count(),'threads'=>$threads];}echo json_encode($out);`));
 assert([1,2].every(m=>raceCounts[m].ledger===1&&raceCounts[m].threads===1),'simultaneous cross-mailbox delivery has exactly one thread per mailbox',raceCounts);
 // Hold the real mailbox advisory lock from another DB connection to test overlap.
 const holder=spawn('docker',['exec','-i','-u','nginx','-w','/www/html',id,'php'],{stdio:['pipe','pipe','pipe']});
 const finished=new Promise((resolve,reject)=>{holder.once('error',reject);holder.once('exit',code=>code===0?resolve():reject(Error('Lock holder exit '+code)));});
 const lockCode=`<?php require 'vendor/autoload.php';$app=require 'bootstrap/app.php';$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();if ((int)DB::selectOne("SELECT GET_LOCK('mail-arrival-1',0) acquired")->acquired!==1)exit(2);echo "LOCKED\\n";flush();sleep(10);DB::select("SELECT RELEASE_LOCK('mail-arrival-1')");`;
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Lock holder did not start')),10000);holder.stdout.once('data',data=>{clearTimeout(timer);String(data).includes('LOCKED')?resolve():reject(Error('Lock holder failed'));});holder.once('error',reject);});holder.stdin.end(lockCode);await ready;
 const overlap=poll(1);assert(overlap.ok&&overlap.result.status==='busy','overlapping mailbox worker fails safe as busy',overlap.result);await finished;
 results.completedAt=new Date().toISOString();results.ok=true;save();console.log(JSON.stringify({run,passed:results.checks.length,receipt:out},null,2));
}catch(e){results.errors.push(String(e));results.ok=false;results.completedAt=new Date().toISOString();save();console.error(String(e));process.exitCode=1;}
