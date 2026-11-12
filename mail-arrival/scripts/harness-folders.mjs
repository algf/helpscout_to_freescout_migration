// Bounded synthetic actual-named source folder integration. No external provider access.
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {guard,docker,php,copy,root} from './local.mjs';
const run=process.argv[2];if(!/^[a-z0-9-]{8,40}$/.test(run||''))throw Error('Unique synthetic run required');
if(!existsSync(path.join(root,'results/backup-path.txt'))||!existsSync(path.join(root,'results/installed.json')))throw Error('Backup and installed receipt required');
const id=guard(),installed=JSON.parse(readFileSync(path.join(root,'results/installed.json'),'utf8'));if(installed.container!==id)throw Error('Container mismatch');
for(const [file,hash] of Object.entries(installed.hashes))if(docker(['exec',id,'sha256sum','/data/Modules/MailArrival/'+file]).split(/\s+/)[0]!==hash)throw Error('Runtime drift: '+file);
const out=path.join(root,'results',`${run}-folders.json`),result={run,container:id,installedHashes:installed.hashes,checks:[],errors:[],startedAt:new Date().toISOString()};
const save=()=>writeFileSync(out,JSON.stringify(result,null,2));
function assert(ok,message,detail){result.checks.push({message,passed:!!ok,detail});save();if(!ok)throw Error(message);}
function poll(mailbox){const r=spawnSync('docker',['exec','-u','nginx',id,'php',`/tmp/mail-arrival-${run}/poll.php`,String(mailbox),'folders',run],{encoding:'utf8',timeout:120000});let data;try{data=JSON.parse(r.stdout);}catch{throw Error('Non-JSON poll: '+(r.stderr||r.stdout).slice(0,500));}if(!data.ok)throw Error('Poll failed: '+data.error);return data;}
function inspect(mailbox,identities){const b=Buffer.from(JSON.stringify(identities)).toString('base64');return JSON.parse(php(`$ids=json_decode(base64_decode('${b}'),true);$out=[];foreach($ids as $identity){$rows=DB::table('mail_arrival_messages')->where('mailbox_id',${mailbox})->where('identity',$identity)->get();$r=$rows->first();$t=$r?App\\Thread::find($r->target_thread_id):null;$out[$identity]=['ledger_count'=>$rows->count(),'thread_id'=>$t?$t->id:null,'conversation_id'=>$t?$t->conversation_id:null,'status'=>$t?(int)$t->conversation->status:null,'state'=>$t?(int)$t->conversation->state:null];}echo json_encode($out);`));}
try{
 execFileSync(process.execPath,[path.join(root,'scripts/harness-provider.mjs'),'start',run,'folders'],{encoding:'utf8',timeout:120000});copy(path.join(root,'harness/poll.php'),`/tmp/mail-arrival-${run}/poll.php`);
 const state=JSON.parse(readFileSync(path.join(root,'results',`${run}-provider.json`),'utf8'));
 for(const mailbox of [2,3]){
  const folders=state.accounts[`fixture-${mailbox}`].folders;
  const names=mailbox===2?['INBOX','FreeScout-Crockd-Pilot']:['[Gmail]/All Mail','[Gmail]/Spam','[Gmail]/Bin'];
  const messages=names.flatMap(name=>folders[name].messages);const identities=[...new Set(messages.map(x=>'gmail:'+x.gmail_msgid))];
  const first=poll(mailbox);assert(first.result.status==='success',`mailbox ${mailbox} named-folder poll succeeds`,first.result);
  const records=inspect(mailbox,identities);assert(identities.every(identity=>records[identity].ledger_count===1&&records[identity].thread_id),`mailbox ${mailbox} unique source identities have exactly one target`,records);
  for(const name of names){const key=Buffer.from(`${mailbox}\0${name}`).toString('hex');const raw=php(`$key=hash('sha256',hex2bin('${key}'));echo DB::table('mail_arrival_sources')->where('source_key',$key)->value('state');`);const source=JSON.parse(raw);assert(String(source.uidvalidity)===String(folders[name].uidvalidity)&&Number(source.last_uid)===Math.max(...folders[name].messages.map(x=>x.uid)),`mailbox ${mailbox} checkpoints ${name}`);}
  if(mailbox===3){
   const archived=folders['[Gmail]/All Mail'].messages[1],spam=folders['[Gmail]/Spam'].messages[1],trash=folders['[Gmail]/Bin'].messages[0];
   const deleted=Number(php('echo App\\Conversation::STATE_DELETED;'));
   assert(records['gmail:'+archived.gmail_msgid].status===3,'Fiveways All Mail archived fixture is closed');
   assert(records['gmail:'+spam.gmail_msgid].status===4,'Fiveways Spam folder fixture is spam');
   assert(records['gmail:'+trash.gmail_msgid].state===deleted,'Fiveways Bin folder fixture is deleted');
  }
  const replay=poll(mailbox);assert(replay.result.changed===0,`mailbox ${mailbox} named-folder replay has no changes`,replay.result);
 }
 result.ok=true;result.completedAt=new Date().toISOString();save();console.log(JSON.stringify({run,passed:result.checks.length,receipt:out}));
}catch(e){result.ok=false;result.errors.push(String(e));result.completedAt=new Date().toISOString();save();console.error(String(e));process.exitCode=1;}
