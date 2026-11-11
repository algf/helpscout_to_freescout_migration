<?php
// Isolated controller integration harness. Run with PHP 7.2+; no app or network boot.
namespace Illuminate\Routing { class Controller {} }
namespace Illuminate\Http { class Request { private $data; function __construct($data){$this->data=$data;} function input($key){return $this->data[$key]??null;} } }
namespace App { class Thread {const TYPE_CUSTOMER=1;const STATE_PUBLISHED=2;} class Conversation { const STATE_PUBLISHED=2; const STATUS_CLOSED=3; static $row; static function findOrFail($id){if(!self::$row)throw new \RuntimeException('404');return self::$row;} } }
namespace {
class Cache { static $data=[]; static function get($key){return self::$data[$key]??null;} }
class TestUser { public $allowed=true; function can($action,$row){return $this->allowed;} }
class TestAuth { public $id=1; public $person; function id(){return $this->id;} function user(){return $this->person;} }
$auth=new TestAuth; $auth->person=new TestUser;
function auth(){global $auth;return $auth;}
function abort($code){throw new RuntimeException((string)$code);}
function abort_unless($condition,$code){if(!$condition)abort($code);}
function response(){return new class {function json($data,$status=200){return ['status'=>$status,'data'=>$data];}};}
require __DIR__.'/../src/UnSub/Http/Controllers/UnsubscribeController.php';
$controller=new Modules\UnSub\Http\Controllers\UnsubscribeController;
$token=str_repeat('a',48);$key=str_repeat('b',64);$prefix='unsub-result:'.$token.':'.$key;
$thread=(object)['id'=>9,'headers'=>'fixture'];
class TestThreads { function where($a,$b){return $this;} function orderBy($a,$b){return $this;} function first(){global $thread;return $thread;} }
class TestConversation { public $mailbox_id=1,$state=2,$status=3; function threads(){return new TestThreads;} }
$plan=['user_id'=>1,'created'=>time(),'groups'=>[$key=>['automatic'=>true,'mailbox_id'=>1,'snapshots'=>[['id'=>7,'thread_id'=>9,'headers_hash'=>hash('sha256','fixture')]]]]];
App\Conversation::$row=new TestConversation;
function callStatus($extra=[]){global $controller,$token,$key;return $controller->action(new Illuminate\Http\Request(array_merge(['action'=>'status','token'=>$token,'key'=>$key],$extra)));}
function same($got,$want){if($got!==$want)throw new RuntimeException('Assertion failed: '.json_encode([$got,$want]));}
function rejected($fn,$status){try{$fn();}catch(RuntimeException $e){same($e->getMessage(),(string)$status);return;}throw new RuntimeException('Expected rejection');}
Cache::$data['unsub:'.$token]=$plan;
same(callStatus()['data']['state'],'unknown');
Cache::$data[$prefix.':running']=time();same(callStatus()['data']['state'],'pending');
Cache::$data[$prefix.':running']=time()-121;same(callStatus()['data']['state'],'unknown');
$result=['accepted'=>true,'closed'=>1,'message'=>'Accepted'];Cache::$data[$prefix.':final']=$result;
same(callStatus()['data'],['state'=>'complete','result'=>$result]);
App\Conversation::$row->status=1;same(callStatus()['data']['result']['closed'],0);App\Conversation::$row->status=3;
$thread->id=10;same(callStatus()['data']['result']['closed'],0);$thread->id=9;
$thread->headers='changed';same(callStatus()['data']['result']['closed'],0);$thread->headers='fixture';
same(Cache::$data[$prefix.':final']['closed'],1);
$auth->person->allowed=false;rejected(function(){callStatus();},403);$auth->person->allowed=true;
$auth->id=2;same(callStatus()['status'],409);$auth->id=1;
Cache::$data['unsub:'.$token]['created']=time()-601;same(callStatus()['status'],409);Cache::$data['unsub:'.$token]=$plan;
rejected(function(){callStatus(['key'=>str_repeat('c',64)]);},422);
rejected(function(){callStatus(['token'=>'bad']);},422);
App\Conversation::$row->mailbox_id=2;same(callStatus()['data']['state'],'unknown');
echo "Status controller assertions passed (isolated harness, no transport).\n";
}
