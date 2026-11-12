// This checks the real Webklex adapter without invoking an importer or changing the database.
import {php,guard,root,copy} from './local.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const run=process.argv[2];if(!/^[a-z0-9-]{8,40}$/.test(run||''))throw Error('Synthetic fixture run required');
const receipt=JSON.parse(readFileSync(path.join(root,'results',`${run}-provider-receipt.json`),'utf8'));
if(receipt.container!==guard()||receipt.dir!==`/tmp/mail-arrival-${run}`)throw Error('Fixture scope mismatch');
const state=JSON.parse(readFileSync(receipt.state,'utf8'));const source=path.join(root,'src/Modules/MailArrival/Backend/ImapProvider.php');
const sourceHash=createHash('sha256').update(readFileSync(source)).digest('hex');copy(source,`${receipt.dir}/ImapProvider.php`);
const observations=[];
for(const id of [1,2,3]){
 const code=`require '${receipt.dir}/ImapProvider.php';$cfg=config('imap');$cfg['accounts']['fixture']=['host'=>'127.0.0.1','port'=>11430,'encryption'=>false,'validate_cert'=>false,'username'=>'fixture-${id}','password'=>'synthetic-only','protocol'=>'imap'];$c=(new Webklex\\PHPIMAP\\ClientManager($cfg))->account('fixture');$p=new Modules\\MailArrival\\ImapProvider($c,true);$p->connect();$s=$p->state('INBOX');$ids=$p->uids('INBOX',0,4,gmdate('Y-m-d',time()-3*86400));$before=$p->metadata('INBOX',4);$raw=$p->raw('INBOX',4);$after=$p->metadata('INBOX',4);echo json_encode(['state'=>$s,'uids'=>$ids,'before'=>$before,'after'=>$after,'rawSha'=>hash('sha256',$raw),'rawLength'=>strlen($raw)]);$p->disconnect();`;
 const observed=JSON.parse(php(code));const expected=state.accounts[`fixture-${id}`].folders.INBOX.messages[3];
 const sha=createHash('sha256').update(Buffer.from(expected.raw_b64,'base64')).digest('hex');
 if(observed.state.uidvalidity!==String(state.accounts[`fixture-${id}`].folders.INBOX.uidvalidity)||observed.uids.join(',')!=='1,2,3,4'||observed.rawSha!==sha||observed.before['X-GM-MSGID']!==expected.gmail_msgid||!observed.before.FLAGS.includes('\\Seen')||!observed.after.FLAGS.includes('\\Seen')||!observed.before['BODY[HEADER]'].includes('Message-ID:'))throw Error(`Adapter smoke failed for mailbox ${id}`);
 observations.push({mailbox:id,uidvalidity:observed.state.uidvalidity,uidnext:observed.state.uidnext,rawSha:sha,rawLength:observed.rawLength,readFlagPreserved:true});
}
const output={run,container:guard(),sourceHash,verifiedAt:new Date().toISOString(),scope:'local provider adapter only; no import or delivery claim',observations};writeFileSync(path.join(root,'results',`${run}-adapter-smoke.json`),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
