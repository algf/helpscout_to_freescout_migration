<?php
if ((string)config('app.url') !== 'http://localhost:53927') throw new RuntimeException('Local only');
$all=[];
foreach ([1=>'Kindy Weekly: new enrolment guides',2=>'Clay Weekly: new glaze recipes',3=>'AI Digest: agents in production'] as $mid=>$subject) {
    $source=App\Conversation::where('mailbox_id',$mid)->where('subject',$subject)->firstOrFail();
    $sourceThread=$source->threads()->where('type',App\Thread::TYPE_CUSTOMER)->firstOrFail();
    $box=['closeIds'=>[]];
    for($i=0;$i<22;$i++){
        $title='Action speed fixture: '.$mid.' '.str_pad((string)$i,2,'0',STR_PAD_LEFT);
        $c=App\Conversation::where('subject',$title)->first();
        if(!$c){
            $data=$source->getAttributes();unset($data['id']);
            $data['number']=App\Conversation::max('number')+1;$data['subject']=$title;
            $id=DB::table('conversations')->insertGetId($data);$c=App\Conversation::findOrFail($id);
        }
        $c->status=App\Conversation::STATUS_ACTIVE;$c->state=App\Conversation::STATE_PUBLISHED;$c->user_id=null;$c->meta=null;
        $c->last_reply_at=now()->addSeconds(30-$i);$c->created_at=now()->subMinutes(1);$c->save();$c->updateFolder();$c->save();
        DB::table('threads')->where('conversation_id',$c->id)->delete();
        $t=$sourceThread->getAttributes();unset($t['id']);$t['conversation_id']=$c->id;$t['state']=App\Thread::STATE_PUBLISHED;
        $t['message_id']='action-speed-'.$c->id.'@example.invalid';$t['created_at']=date('Y-m-d H:i:s');$t['updated_at']=$t['created_at'];
        $t['body']='<p>Synthetic local action speed fixture.</p>';
        $t['headers']=$i<2 ? "From: Action Speed <news@action-speed.example.invalid>\r\nMessage-ID: <action-speed-{$c->id}@example.invalid>\r\nList-ID: action-speed-{$c->id}.example.invalid\r\nList-Unsubscribe: <https://action-speed.example.invalid/unsubscribe/{$c->id}>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\nDKIM-Signature: v=1; a=rsa-sha256; d=action-speed.example.invalid; s=sel1; h=from:subject:message-id:list-unsubscribe:list-unsubscribe-post; b=AbCdEfGh1234567890restofsignature\r\nAuthentication-Results: mx.google.com; dkim=pass header.i=@action-speed.example.invalid header.s=sel1 header.b=AbCdEfGh; spf=pass\r\n" : "Message-ID: <action-speed-{$c->id}@example.invalid>\r\n";
        DB::table('threads')->insert($t);
        if($i===0)$box['unsubId']=$c->id;elseif($i===1)$box['secondUnsubId']=$c->id;else $box['closeIds'][]=$c->id;
        $box['folderUrl']='/mailbox/'.$mid.'/'.$c->folder_id;
    }
    App\Mailbox::find($mid)->updateFoldersCounters();$all[$mid]=$box;
}
echo json_encode(['mailboxes'=>$all]);
