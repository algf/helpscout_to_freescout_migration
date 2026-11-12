<?php
namespace Illuminate\Events {class Dispatcher {}}
namespace TorMorten\Eventy {
    class Events {
        protected $filter;public $actions=[];
        public function __construct(){$this->filter=(object)['marker'=>'original'];}
        public function getFilter(){return$this->filter;}
    }
}
namespace App\Console\Commands {class FetchEmails {}}
namespace App\Events {
    class CustomerCreatedConversation {public $conversation,$last_thread;}
    class CustomerReplied {public $conversation,$thread;}
    class UserReplied {public $conversation,$thread;}
    class RealtimeMailboxNewThread {}
}
namespace Illuminate\Mail\Events {class MessageSending {}}
namespace {
class DB {
    public static $records=[],$locks=[];
    public static function selectOne($sql,$params){$key=$params[0];if(isset(self::$locks[$key]))return(object)['acquired'=>0];self::$locks[$key]=true;return(object)['acquired'=>1];}
    public static function select($sql,$params){unset(self::$locks[$params[0]]);return[];}
    public static function table($name){return new class {public function updateOrInsert($key,$data){DB::$records[$key['event_key']]=$data;}};}
}
$settings=['app.url'=>'http://localhost:53927'];
function config($key,$fallback=null){global$settings;return$settings[$key]??$fallback;}
class OriginalDispatcher {public $events=[];public function dispatch($event,$payload=[],$halt=false){$this->events[]=$event;return'forwarded';}}
require_once $argv[1].'/Backend/MessageReservation.php';
require_once $argv[1].'/Backend/DeploymentGuard.php';
require_once $argv[1].'/Backend/Runtime.php';
require_once $argv[1].'/Backend/NativeSink.php';
function check($ok,$label){if(!$ok)throw new RuntimeException($label);echo"PASS $label\n";}
$inner=new OriginalDispatcher();$events=new \Modules\MailArrival\ArrivalEvents($inner,false);
$a=new \App\Events\CustomerCreatedConversation();$a->conversation=(object)['mailbox_id'=>1];$a->last_thread=(object)['id'=>10];$events->dispatch($a);
$b=new \App\Events\CustomerCreatedConversation();$b->conversation=(object)['mailbox_id'=>1];$b->last_thread=(object)['id'=>11];$events->dispatch($b);
check(count(DB::$records)===2,'native new-conversation last_thread identities produce distinct durable events');
$events->dispatch($a);check(count(DB::$records)===2,'same domain event key is idempotent before processing');
$reply=new \App\Events\CustomerReplied();$reply->conversation=(object)['mailbox_id'=>2];$reply->thread=(object)['id'=>12];$events->dispatch($reply);
check(count(DB::$records)===3,'native reply uses thread identity and destination mailbox');
check(!$inner->events,'native notification handlers do not run before source commit');
$events->dispatch(new \App\Events\RealtimeMailboxNewThread());check(!$inner->events,'custom importer suppresses only unsafe immediate inbox refresh');
$events->dispatch((object)['unrelated'=>'model observer']);check(count($inner->events)===1,'unrelated native events remain enabled');
$history=new \Modules\MailArrival\ArrivalEvents($inner,true);$history->dispatch($a);check(count(DB::$records)===3&&count($inner->events)===1,'Fiveways historical domain notifications remain suppressed');
try{$history->dispatch(new \Illuminate\Mail\Events\MessageSending());throw new RuntimeException('Expected send guard');}catch(RuntimeException$e){check($e->getMessage()==='Sending forbidden in Fiveways history import','Fiveways synchronous mail send is forbidden');}
$hooks=new \TorMorten\Eventy\Events();$hooks->actions=['workflow observer'];$quiet=new \Modules\MailArrival\HistoryHooks($hooks);
check($quiet->actions===[]&&$quiet->getFilter()===$hooks->getFilter()&&$hooks->actions===['workflow observer'],'Fiveways disables actions in separate registry while preserving filters and original actions');
$fetch=new \Modules\MailArrival\NativeFetch();$fetch->setSeen(new \stdClass(),new \stdClass());check($fetch->acknowledged,'native terminal acknowledgement captured without provider flag API');
$fetch->logError('Injected native failure');check(count($fetch->errors)===1,'native swallowed error captured independently from acknowledgement');
$directory=sys_get_temp_dir().'/mail-arrival-target-guards-'.getmypid();mkdir($directory);
$destination=new class {public $id=2,$enabled=true,$email='support@example.invalid';public function isInActive(){return$this->enabled;}};
check(\Modules\MailArrival\NativeSink::extraImportEligible($destination,$directory),'normal active Crockd extra-import target remains eligible');
$destination->enabled=false;check(!\Modules\MailArrival\NativeSink::extraImportEligible($destination,$directory),'disabled destination cannot receive cross-mailbox extra import');
$destination->enabled=true;$marker=$directory.'/mailbox-2-sync.paused';file_put_contents($marker,'test-owned');
try{check(!\Modules\MailArrival\NativeSink::extraImportEligible($destination,$directory),'paused destination cannot receive cross-mailbox extra import');}
finally{unlink($marker);rmdir($directory);}
$destination->id=3;check(!\Modules\MailArrival\NativeSink::extraImportEligible($destination,sys_get_temp_dir()),'Fiveways is never routed through native cross-mailbox extra import');
$destination->id=2;
$settings['app.url']='https://mail.example.invalid';
$settings['mail_arrival.production.enabled']=true;
$settings['mail_arrival.production.app_url']=$settings['app.url'];
$settings['mail_arrival.production.mailboxes']=[1=>'personal@example.invalid',2=>'support@example.invalid',3=>'team@example.invalid'];
check(\Modules\MailArrival\NativeSink::extraImportEligible($destination,sys_get_temp_dir()),'matching production target identity remains eligible');
$destination->email='drifted@example.invalid';
check(!\Modules\MailArrival\NativeSink::extraImportEligible($destination,sys_get_temp_dir()),'production target identity drift cannot receive cross-import');
$destination->email='SUPPORT@EXAMPLE.INVALID';
check(\Modules\MailArrival\NativeSink::extraImportEligible($destination,sys_get_temp_dir()),'production target identity comparison remains case insensitive');
$settings['mail_arrival.production.mailboxes']=[1=>'personal@example.invalid',3=>'team@example.invalid'];
check(!\Modules\MailArrival\NativeSink::extraImportEligible($destination,sys_get_temp_dir()),'missing production target pin fails closed');
$settings['app.url']='http://localhost:53927';
$destination->email='local-fixture@example.invalid';
check(\Modules\MailArrival\NativeSink::extraImportEligible($destination,sys_get_temp_dir()),'local fixture target remains eligible without production identity pin');
$sourceThread=(object)['conversation'=>(object)['mailbox_id'=>1]];
check(\Modules\MailArrival\NativeSink::requiresMailboxCopy($sourceThread,2),'resumed explicit-recipient target uses native mailbox-scoped copy path');
check(!\Modules\MailArrival\NativeSink::requiresMailboxCopy($sourceThread,1),'existing source target remains ordinary native dedupe path');
check(!\Modules\MailArrival\NativeSink::requiresMailboxCopy(null,2),'new first delivery retains ordinary native Message-ID policy');
$one=new \Modules\MailArrival\NativeSink((object)['id'=>1]);$two=new \Modules\MailArrival\NativeSink((object)['id'=>2]);
$metadata=['BODY[HEADER]'=>"Message-ID: <shared-lock@example.invalid>\r\n"];
check($one->reserve($metadata,function(){throw new RuntimeException('MIME not needed');}),'real native sink reserves RFC Message-ID without MIME');
check(!$two->reserve($metadata,function(){throw new RuntimeException('MIME not needed');}),'same message reservation defers simultaneous target mailbox');
$one->releaseMessage();check($two->reserve($metadata,function(){throw new RuntimeException('MIME not needed');}),'reservation becomes available after first commit or rollback');$two->releaseMessage();
check(\Modules\MailArrival\MessageReservation::key('one@example.invalid')!==\Modules\MailArrival\MessageReservation::key('two@example.invalid'),'different messages do not share coarse global reservation');
$failure=new \Modules\MailArrival\NativeProcessingFailure(['SQLSTATE[40001]: 1213 Deadlock found; source-person@example.invalid and private body values']);
check($failure->sqlStates===['40001']&&strpos($failure->getMessage(),'source-person')===false&&strpos($failure->getMessage(),'private body')===false,'native swallowed database failure preserves SQLSTATE without SQL values');
$gone=new \Modules\MailArrival\NativeProcessingFailure(["SQLSTATE[HY000]: General error: 2006 MySQL server has gone away (SQL: private source values)"]);
check($gone->driverCodes===['2006']&&$gone->safeReasons===['MySQL server has gone away']&&strpos($gone->getMessage(),'private source')===false,'native driver code and static reason survive without SQL parameters');
$connect=new \Modules\MailArrival\NativeProcessingFailure(['SQLSTATE[HY000] [2002] Connection refused']);check($connect->driverCodes===['2002'],'bracketed native driver code is retained');
echo"BACKEND_OUTBOX_PASS\n";
}
