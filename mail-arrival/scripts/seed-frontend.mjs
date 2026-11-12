import {php,root} from './local.mjs';
import {writeFileSync} from 'node:fs';
const stamp=String(Date.now());
const result=php(String.raw`
$out=['mailboxes'=>[]];
foreach([1,2,3] as $mid){
 $source=App\Conversation::where('mailbox_id',$mid)->where('subject','like','Action speed fixture:%')->firstOrFail();
 $thread=$source->threads()->where('type',App\Thread::TYPE_CUSTOMER)->firstOrFail();
 $data=$source->getAttributes();unset($data['id']);$data['number']=App\Conversation::max('number')+1;
 // Some importer fixtures deliberately use future source dates. Keep these isolated UI
 // fixtures at the top of the seeded inbox so a mobile test can reach their rows.
 $data['subject']='Arrival UI fixture ${stamp} mailbox '.$mid;$data['status']=App\Conversation::STATUS_ACTIVE;$data['state']=App\Conversation::STATE_PUBLISHED;$data['user_id']=null;$data['meta']=null;$data['threads_count']=1;$data['has_attachments']=false;$data['last_reply_at']=date('Y-m-d H:i:s',time()+7*86400);
 $id=DB::table('conversations')->insertGetId($data);$c=App\Conversation::findOrFail($id);$c->updateFolder();$c->save();
 $t=$thread->getAttributes();unset($t['id']);$t['conversation_id']=$id;$t['state']=App\Thread::STATE_PUBLISHED;$t['first']=true;$t['has_attachments']=false;$t['message_id']='arrival-ui-'.$id.'@arrival.invalid';$t['headers']='Message-ID: <'.$t['message_id'].'>'; $t['body']='<p>Local arrival UI test. No customer mail.</p>';$t['created_at']=date('Y-m-d H:i:s');$t['updated_at']=$t['created_at'];DB::table('threads')->insert($t);
 $box=['conversationId'=>$id,'folderUrl'=>'/mailbox/'.$mid.'/'.$c->folder_id];
 foreach(['unsubscribe'=>'unsubId','parallel-close'=>'parallelCloseId','gesture-close'=>'gestureCloseId'] as $kind=>$key){
  $extra=$data;$extra['number']=App\Conversation::max('number')+1;$extra['subject']='Arrival UI fixture ${stamp} mailbox '.$mid.' '.$kind;
  $eid=DB::table('conversations')->insertGetId($extra);$ec=App\Conversation::findOrFail($eid);$ec->updateFolder();$ec->save();
  $et=$t;$et['conversation_id']=$eid;$et['message_id']='action-speed-'.$eid.'@example.invalid';
  $et['headers']="From: Action Speed <news@action-speed.example.invalid>\r\nMessage-ID: <action-speed-{$eid}@example.invalid>\r\n";
  if($kind==='unsubscribe')$et['headers'].="List-ID: action-speed-{$eid}.example.invalid\r\nList-Unsubscribe: <https://action-speed.example.invalid/unsubscribe/{$eid}>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\nDKIM-Signature: v=1; a=rsa-sha256; d=action-speed.example.invalid; s=sel1; h=from:subject:message-id:list-unsubscribe:list-unsubscribe-post; b=AbCdEfGh1234567890restofsignature\r\nAuthentication-Results: mx.google.com; dkim=pass header.i=@action-speed.example.invalid header.s=sel1 header.b=AbCdEfGh; spf=pass\r\n";
  DB::table('threads')->insert($et);$box[$key]=$eid;
 }
 App\Mailbox::find($mid)->updateFoldersCounters();$out['mailboxes'][$mid]=$box;
}
$u=App\User::where('email','arrival-scope@arrival.invalid')->first();
if(!$u){$data=App\User::findOrFail(1)->getAttributes();unset($data['id']);$data['email']='arrival-scope@arrival.invalid';$data['first_name']='Arrival';$data['last_name']='Scope fixture';$data['role']=App\User::ROLE_USER;$data['password']=Hash::make(bin2hex(random_bytes(24)));$data['remember_token']=null;$id=DB::table('users')->insertGetId($data);$u=App\User::findOrFail($id);$u->mailboxes()->sync([1]);}
if(!$u->can('view',App\Mailbox::find(1))||$u->can('view',App\Mailbox::find(2)))throw new RuntimeException('Unexpected fixture scope');
$out['restrictedLoginUrl']='/staging-login/'.$u->id.'?to=%2Fmailbox%2F1';echo json_encode($out);
`);
writeFileSync(root+'/results/frontend-fixture.json',result+'\n');console.log(result);
