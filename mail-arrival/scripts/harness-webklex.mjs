import {php,guard,root} from './local.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const run=process.argv[2];if(!/^[a-z0-9-]{8,40}$/.test(run||''))throw Error('Fixture run required');
const receipt=JSON.parse(readFileSync(path.join(root,'results',`${run}-provider-receipt.json`),'utf8'));if(receipt.container!==guard()||receipt.port!==11430||receipt.host!=='127.0.0.1')throw Error('Fixture scope mismatch');
const state=JSON.parse(readFileSync(receipt.state,'utf8'));if(state.run!==run)throw Error('Fixture identity mismatch');
const observations=[];
for(const mailbox of [1,2,3]){
 const code=`$config=config('imap');$config['accounts']['fixture']=['host'=>'127.0.0.1','port'=>11430,'encryption'=>false,'validate_cert'=>false,'username'=>'fixture-${mailbox}','password'=>'synthetic-only','protocol'=>'imap'];$c=(new Webklex\\PHPIMAP\\ClientManager($config))->account('fixture');$c->connect();$p=$c->getConnection();$folder=$p->selectFolder('INBOX');$uids=$p->search(['UID','1:4']);$metadata=$p->fetch(['UID','INTERNALDATE','FLAGS','X-GM-MSGID','X-GM-THRID','X-GM-LABELS'],4,4);$raw=$p->fetch(['UID','BODY.PEEK[]'],4,4);$after=$p->fetch(['UID','FLAGS'],4,4);echo json_encode(['folder'=>$folder,'uids'=>$uids,'metadata'=>$metadata[4]??null,'after'=>$after[4]??null,'raw_sha256'=>hash('sha256',$raw[4]['BODY[]']??''),'raw_length'=>strlen($raw[4]['BODY[]']??'')]);$c->disconnect();`;
 const data=JSON.parse(php(code));const expected=state.accounts[`fixture-${mailbox}`].folders.INBOX.messages[3];const sha=createHash('sha256').update(Buffer.from(expected.raw_b64,'base64')).digest('hex');
 if(data.folder.uidvalidity!==state.accounts[`fixture-${mailbox}`].folders.INBOX.uidvalidity||data.raw_sha256!==sha||data.uids.join(',')!=='1,2,3,4'||!data.metadata.FLAGS.includes('\\Seen')||!data.after.FLAGS.includes('\\Seen')||data.metadata['X-GM-MSGID']!==expected.gmail_msgid)throw Error(`Webklex protocol mismatch mailbox ${mailbox}`);
 observations.push({mailbox,uidvalidity:data.folder.uidvalidity,uidnext:data.folder.uidnext,rawSha256:data.raw_sha256,rawLength:data.raw_length,readFlagPreserved:true});
}
const output={run,container:guard(),verifiedAt:new Date().toISOString(),scope:'synthetic IMAP protocol only; no importer or delivery claim',observations};
writeFileSync(path.join(root,'results',`${run}-webklex-smoke.json`),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
