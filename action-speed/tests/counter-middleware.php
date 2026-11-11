<?php
// Isolated PHP middleware harness, no application boot or database.
namespace InboxSpeed {
class Counters { static function start(){ $GLOBALS['events'][]='start'; } static function flush(){ $GLOBALS['events'][]='flush'; } }
class Prefetch { const FLASHES=[]; static $speculative=false; static function isSpeculative($r){return self::$speculative;} static function guard($r,$next){$GLOBALS['events'][]='guard';return $next($r);} static function adoptToken($r){$GLOBALS['events'][]='adopt';} static function afterAction($r,$response){$GLOBALS['events'][]='after';return $response;} }
}
namespace {
require __DIR__.'/../src/InboxSpeed/Middleware.php';
class RequestStub { private $method,$path,$action; function __construct($method,$path,$action){$this->method=$method;$this->path=$path;$this->action=$action;} function isMethod($method){return strtolower($this->method)===$method;} function is($path){return $path===$this->path;} function input($key){return $key==='action'?$this->action:null;} }
$middleware=new InboxSpeed\Middleware;$checks=0;
$run=function($method,$path,$action,$expected,$throws=false)use($middleware,&$checks){
 $GLOBALS['events']=[];$caught=false;
 try {$result=$middleware->handle(new RequestStub($method,$path,$action),function()use($throws){$GLOBALS['events'][]='next';if($throws)throw new RuntimeException('original');return 'response';});if($result!=='response')throw new RuntimeException('Response changed');}
 catch(RuntimeException $e){if($e->getMessage()!=='original')throw $e;$caught=true;}
 if($caught!==$throws||$GLOBALS['events']!==$expected)throw new RuntimeException('Middleware mismatch: '.json_encode($GLOBALS['events']));$checks++;
};
$run('POST','unsubscriber/action','execute',['adopt','start','next','flush']);
$run('POST','unsubscriber/action','execute',['adopt','start','next','flush'],true);
foreach(['preview','status','other',null] as $action)$run('POST','unsubscriber/action',$action,['adopt','next']);
$run('GET','unsubscriber/action','execute',['adopt','next']);
$run('POST','elsewhere','execute',['adopt','next']);
$run('POST','conversation/ajax','conversation_change_status',['adopt','start','next','flush','after']);
$run('POST','conversation/ajax','conversation_change_status',['adopt','start','next','flush'],true);
InboxSpeed\Prefetch::$speculative=true;$run('POST','unsubscriber/action','execute',['guard','next']);
echo 'Counter middleware assertions passed: '.$checks.".\n";
}
