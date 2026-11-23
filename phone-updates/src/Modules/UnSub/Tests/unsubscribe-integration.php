<?php
// Run from /www/html in the existing PHP runtime. All records roll back.
// The transport is replaced only in this CLI process; no unsubscribe HTTP call.
if (PHP_SAPI !== 'cli') exit(1);
require 'vendor/autoload.php';
$app=require 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require_once __DIR__.'/../Services/UnsubscribeHeaders.php';
require_once __DIR__.'/../Services/UnsubscribeTransport.php';
require_once __DIR__.'/../Http/Controllers/UnsubscribeController.php';
use Modules\UnSub\Services\UnsubscribeTransport;
use Modules\UnSub\Http\Controllers\UnsubscribeController;
use Illuminate\Http\Request;
class FakeUnsubscribeTransport extends UnsubscribeTransport {
    public $verified=true, $accepted=true, $calls=0;
    public function verifyGmail($mailbox,$candidate) { return $this->verified; }
    public function post($url) { $this->calls++; return ['accepted'=>$this->accepted,'message'=>$this->accepted?'Test request accepted.':'Test request rejected.']; }
}
$app['events']->forget(Illuminate\Mail\Events\MessageSending::class);
$app['events']->listen(Illuminate\Mail\Events\MessageSending::class,function(){throw new RuntimeException('No test email may be sent');});
$queue=new Illuminate\Support\Testing\Fakes\QueueFake($app);
Illuminate\Support\Facades\Queue::swap($queue);
$app->instance(Illuminate\Contracts\Queue\Factory::class,$queue);
Auth::loginUsingId(1);
$fake=new FakeUnsubscribeTransport();$app->instance(UnsubscribeTransport::class,$fake);
$controller=new UnsubscribeController();$checks=0;$tokens=[];
// 21 Nov 2026 (a live unsubscribe): a cache folder owned by root made one cache write fail. This wrapper fails chosen
// writes the same way, so the checks below prove what the user is told and that no request goes out unguarded.
class FailingCache {
    public $real, $fails;
    function __construct($real,$fails){$this->real=$real;$this->fails=$fails;}
    function put($key,$value,$minutes=null){ if(($this->fails)($key)) throw new ErrorException('file_put_contents(): Failed to open stream: No such file or directory'); return $this->real->put($key,$value,$minutes); }
    function __call($method,$args){ return $this->real->$method(...$args); }
}
function check($ok,$message){global $checks;if(!$ok)throw new Exception($message);$checks++;}
function callAction($data){global $controller;return $controller->action(new Request($data));}
function preview($ids){global $tokens;$response=callAction(['action'=>'preview','ids'=>$ids]);check($response->getStatusCode()===200,'preview succeeds');$p=$response->getData(true);$tokens[]=$p;return $p;}
function executePlan($p,$close=true){return callAction(['action'=>'execute','token'=>$p['token'],'key'=>$p['items'][0]['key'],'close'=>$close?'1':'0']);}
// Isolate rollback fixtures from indexing, workflows and other production hooks.
Eventy::removeAllActions();
DB::beginTransaction();
try {
    $source=App\Conversation::where('mailbox_id',1)->firstOrFail();
    $sourceThread=App\Thread::where('type',App\Thread::TYPE_CUSTOMER)->whereNotNull('headers')->firstOrFail();
    $ids=[];
    for($i=0;$i<5;$i++){
        $c=$source->getAttributes();unset($c['id']);$c['number']=App\Conversation::max('number')+1000+$i;$c['subject']='CODEX ROLLBACK UNSUBSCRIBE FIXTURE';$c['customer_email']='unsubscribe-fixture@example.invalid';$c['status']=1;$c['state']=2;
        $id=DB::table('conversations')->insertGetId($c);$ids[]=$id;
        $t=$sourceThread->getAttributes();unset($t['id']);$t['message_id']='rollback-unsubscribe-'.$id.'@example.invalid';$t['to']='[]';$t['cc']=null;$t['bcc']=null;$t['has_attachments']=0;$t['conversation_id']=$id;$t['from']='unsubscribe-fixture@example.invalid';$t['body']='Controlled rollback test';$t['created_at']=date('Y-m-d H:i:s');$t['headers']="Message-ID: <fixture@example.invalid>\r\nList-ID: test.example.com\r\nList-Unsubscribe: <https://example.com/unsubscribe?fixture=1>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n";
        DB::table('threads')->insert($t);
    }
    $p=preview([$ids[0],$ids[1]]);check(count($p['items'])===1 && $p['items'][0]['count']===2,'deduplicated list');
    check($fake->calls===0,'preview has no outbound request');
    $r=executePlan($p)->getData(true);check($r['accepted'] && $r['closed']===2,'accepted closes selected');
    check(App\Conversation::find($ids[2])->status===1,'unselected untouched');
    executePlan($p);check($fake->calls===1,'replay does not resend');
    $fake->accepted=false;$p=preview([$ids[2]]);$r=executePlan($p)->getData(true);check(!$r['accepted'] && $r['closed']===0 && App\Conversation::find($ids[2])->status===1,'failure stays open');
    $fake->accepted=true;$fake->verified=false;$p=preview([$ids[2]]);$before=$fake->calls;$r=executePlan($p)->getData(true);check(!$r['accepted'] && $fake->calls===$before,'authentication failure does not POST');
    $fake->verified=true;$p=preview([$ids[2]]);$r=executePlan($p,false)->getData(true);check($r['accepted'] && $r['closed']===0 && App\Conversation::find($ids[2])->status===1,'close option respected');
    $p=preview([$ids[2]]);$before=$fake->calls;$r=executePlan($p,false)->getData(true);check($r['accepted'] && $fake->calls===$before,'fresh review cannot repeat an accepted request');
    check(App\Thread::where('conversation_id',$ids[2])->where('action_type',167)->count()===1,'accepted request records one activity');
    $p=preview([$ids[2]]);DB::table('conversations')->where('id',$ids[2])->update(['status'=>2]);$before=$fake->calls;$r=executePlan($p);check($r->getStatusCode()===409 && $fake->calls===$before,'stale status rejected');
    // Cache write fails before the request: nothing is sent, the email stays open, and the user is told so.
    $cache=Cache::getFacadeRoot();$fake->accepted=true;$fake->verified=true;
    $p=preview([$ids[3]]);$before=$fake->calls;
    Cache::swap(new FailingCache($cache,function($k){return strpos($k,'unsub-result:')===0;}));
    try { $r=executePlan($p); } finally { Cache::swap($cache); }
    check($r->getStatusCode()===503 && $r->getData(true)['retry']===true,'cache failure before sending returns 503 marked safe to retry');
    check(strpos($r->getData(true)['message'],'nothing was sent')!==false && strpos($r->getData(true)['message'],'stays open')!==false,'cache failure says nothing was sent and the email stays open');
    check($fake->calls===$before,'cache failure before sending makes no request');
    check(App\Conversation::find($ids[3])->status===1,'cache failure before sending leaves the email open');
    $r=executePlan($p)->getData(true);check($r['accepted'] && $r['closed']===1 && $fake->calls===$before+1,'retry after a failed start sends once and closes');
    check(App\Conversation::find($ids[3])->status===3,'accepted retry closed the email');
    // Cache write fails after an accepted request: the email still closes and the answer is still accepted.
    $p=preview([$ids[4]]);$before=$fake->calls;
    Cache::swap(new FailingCache($cache,function($k)use(&$fake,$before){return $fake->calls>$before;}));
    try { $response=executePlan($p); } finally { Cache::swap($cache); }
    $r=$response->getData(true);
    check($response->getStatusCode()===200 && $r['accepted'] && $r['closed']===1,'cache failure after acceptance still reports accepted and closed');
    check(App\Conversation::find($ids[4])->status===3 && !empty(App\Conversation::find($ids[4])->getMeta('unsub.accepted',[])['headers_hash']),'cache failure after acceptance still closes and records acceptance');
    // The review itself cannot be saved: plain message, no request.
    $before=$fake->calls;
    Cache::swap(new FailingCache($cache,function($k){return strpos($k,'unsub:')===0;}));
    try { $r=callAction(['action'=>'preview','ids'=>[$ids[1]]]); } finally { Cache::swap($cache); }
    check($r->getStatusCode()===503 && strpos($r->getData(true)['message'],'nothing was sent')!==false && $fake->calls===$before,'review save failure is explained and sends nothing');
    Auth::loginUsingId(45);
    try { callAction(['action'=>'preview','ids'=>[$ids[0]]]); check(false,'private mailbox must be denied'); }
    catch(\Symfony\Component\HttpKernel\Exception\HttpException $e){check($e->getStatusCode()===403,'Crockd staff denied Andrew mailbox');}
    DB::table('conversations')->where('id',$ids[0])->update(['mailbox_id'=>2]);
    $p=preview([$ids[0]]);check($p['items'][0]['mailbox_id']===2,'Crockd staff can review own mailbox');
    Auth::loginUsingId(1);
    DB::table('threads')->where('conversation_id',$ids[2])->where('type',1)->update(['headers'=>'Message-ID: <no-link@example.invalid>']);
    $p=preview([$ids[2]]);check(!$p['items'][0]['automatic'] && !$p['items'][0]['manual_url'],'missing header cannot unsubscribe');
    DB::table('threads')->where('conversation_id',$ids[2])->where('type',1)->update(['headers'=>'List-Unsubscribe: <https://example.com/manual>']);
    $p=preview([$ids[2]]);check(!$p['items'][0]['automatic'] && $p['items'][0]['manual_url'],'manual page is not automatic');
    $p=preview([$ids[2]]);Auth::logout();$r=executePlan($p);check($r->getStatusCode()===409,'review bound to authenticated user');
    echo "PASS $checks integration checks; fake transport only; all fixture records rolled back\n";
} finally {
    DB::rollBack();
    foreach($tokens as $p){Cache::forget('unsub:'.$p['token']);foreach($p['items'] as $item)Cache::forget('unsub-result:'.$p['token'].':'.$item['key']);}
}
