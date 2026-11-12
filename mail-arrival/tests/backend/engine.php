<?php
require_once $argv[1].'/Backend/MessageReservation.php';
require_once $argv[1].'/Backend/Engine.php';
require_once $argv[1].'/Backend/FivewaysSink.php';
use Modules\MailArrival\Engine;
use Modules\MailArrival\FivewaysPolicy;
function check($ok,$label){if(!$ok)throw new RuntimeException($label);echo "PASS $label\n";}
function failure($fn,$label){try{$fn();}catch(Throwable$e){echo "PASS $label\n";return;}throw new RuntimeException('Expected failure: '.$label);}
class MemoryStore {
    public $sources=[],$messages=[],$deferredRows=[],$threads=[],$version=0,$busy=false,$locked=false;
    public function lock($id){if($this->busy)return false;$this->locked=true;return true;}
    public function unlock($id){$this->locked=false;}
    public function source($id,$folder){return $this->sources[$id][$folder]??null;}
    public function checkpoint($id,$folder,$state){$this->sources[$id][$folder]=$state;}
    public function message($id,$key){return$this->messages[$id][$key]??null;}
    public function remember($id,$key,$result){if(isset($this->messages[$id][$key]))throw new RuntimeException('Duplicate ledger insert');$this->messages[$id][$key]=$result;if(!empty($result['changed']))$this->version++;}
    public function transaction($fn){$snapshot=serialize([$this->sources,$this->messages,$this->deferredRows,$this->threads,$this->version]);try{return$fn();}catch(Throwable$e){list($this->sources,$this->messages,$this->deferredRows,$this->threads,$this->version)=unserialize($snapshot);throw$e;}}
    private function key($id,$row){return$id.':'.$row['folder'].':'.$row['uidvalidity'].':'.$row['UID'];}
    public function defer($id,$row){$this->deferredRows[$this->key($id,$row)]=$row;}
    public function deferred($id){return array_values(array_filter($this->deferredRows,function($row,$key)use($id){return strpos($key,$id.':')===0;},ARRAY_FILTER_USE_BOTH));}
    public function undefer($id,$row){unset($this->deferredRows[$this->key($id,$row)]);}
}
class ProviderFixture {
    public $folders=[],$bodyCalls=0,$metadataCalls=0,$failUid=null,$resetOnRaw=false,$connected=0,$searchFloors=[];
    public function connect(){$this->connected++;}
    public function disconnect(){}
    public function state($folder){return['uidvalidity'=>$this->folders[$folder]['validity'],'uidnext'=>$this->folders[$folder]['next']];}
    public function uids($folder,$after,$through,$since=null){$this->searchFloors[]=$since;return array_values(array_filter(array_keys($this->folders[$folder]['rows']),function($uid)use($after,$through){return$uid>$after&&$uid<=$through;}));}
    public function metadata($folder,$uid){$this->metadataCalls++;if(!isset($this->folders[$folder]['rows'][$uid]))throw new RuntimeException('Missing UID');return$this->folders[$folder]['rows'][$uid]+['UID'=>$uid,'folder'=>$folder,'uidvalidity'=>$this->folders[$folder]['validity']];}
    public function raw($folder,$uid,$validity=null){$this->bodyCalls++;if($uid===$this->failUid)throw new RuntimeException('Injected MIME failure');if($this->resetOnRaw||(string)$validity!==(string)$this->folders[$folder]['validity'])throw new RuntimeException('Changed UIDVALIDITY');return"Message-ID: <fixture-$uid@example.invalid>\r\n\r\nbody $uid";}
}
class SinkFixture {
    private $store;public $knownCalls=0,$skip=[];
    public function __construct($store){$this->store=$store;}
    public function known($row){$this->knownCalls++;return null;}
    public function deferred($row){return in_array('\\Draft',$row['X-GM-LABELS']??[],true);}
    public function import($row,$raw){$key=$row['X-GM-MSGID']??'no-provider-id';if(isset($this->skip[$key]))return['outcome'=>'native_ack_skip','changed'=>false];$id=count($this->store->threads)+1;$this->store->threads[$id]=$row;return['outcome'=>'imported','thread_id'=>$id,'changed'=>true];}
}
function setup($count=3,$options=[]){$provider=new ProviderFixture();$rows=[];for($i=1;$i<=$count;$i++)$rows[$i]=['X-GM-MSGID'=>(string)(100+$i),'X-GM-THRID'=>'900','FLAGS'=>['\\Seen'],'X-GM-LABELS'=>['\\Inbox']];$provider->folders=['INBOX'=>['validity'=>'1','next'=>$count+1,'rows'=>$rows]];$store=new MemoryStore();$sink=new SinkFixture($store);$config=array_replace(['folders'=>['INBOX'],'initial_since'=>'2026-11-01','initial_max_messages'=>100,'batch_size'=>25],$options);return[$provider,$store,$sink,$config];}
function runCase($parts,$id=1){list($p,$s,$sink,$o)=$parts;return(new Engine($p,$s,$sink,$o))->run($id);}
$parts=setup();$result=runCase($parts);list($p,$s)=$parts;check($result['processed']===3&&count($s->threads)===3,'read-before-fetch messages imported');check($s->version===3&&!$s->locked,'receipt changes atomically and lock released');$calls=$p->bodyCalls;runCase($parts);check($p->bodyCalls===$calls&&count($s->threads)===3,'idle incremental poll parses no old MIME');
$parts=setup(3,['batch_size'=>2]);runCase($parts);check($parts[1]->sources[1]['INBOX']['last_uid']===2,'bounded first batch stops at last committed UID');runCase($parts);check(count($parts[1]->threads)===3,'bounded seed resumes without loss');
$parts=setup();$parts[0]->failUid=2;failure(function()use($parts){runCase($parts);},'MIME failure propagated');check($parts[1]->sources[1]['INBOX']['last_uid']===1&&count($parts[1]->threads)===1,'failure cannot advance past failed message');$parts[0]->failUid=null;runCase($parts);check(count($parts[1]->threads)===3,'failure retry imports failed and following messages once');
$parts=setup(3,['initial_max_messages'=>2]);failure(function()use($parts){runCase($parts);},'initial catch-up bound enforced');check(!$parts[1]->sources&&!$parts[1]->threads,'over-bound initial scan leaves no checkpoint or target');
$parts=setup(1,['before_commit'=>function(){throw new RuntimeException('before commit crash');}]);failure(function()use($parts){runCase($parts);},'before-commit crash injected');check(!$parts[1]->threads&&!$parts[1]->messages&&$parts[1]->version===0,'before-commit crash rolls back thread ledger receipt checkpoint');
$parts=setup(1,['after_commit'=>function(){throw new RuntimeException('after commit crash');}]);failure(function()use($parts){runCase($parts);},'after-commit crash injected');check(count($parts[1]->threads)===1&&$parts[1]->version===1,'after-commit crash leaves committed thread and receipt');unset($parts[3]['after_commit']);runCase($parts);check(count($parts[1]->threads)===1&&$parts[1]->version===1,'post-commit replay does not duplicate target or receipt');
$parts=setup(1);runCase($parts);$parts[0]->folders['INBOX']['validity']='2';$parts[0]->folders['INBOX']['rows'][1]['X-GM-MSGID']='new999';failure(function()use($parts){runCase($parts);},'invalid provider stable identity fails closed');$parts[0]->folders['INBOX']['rows'][1]['X-GM-MSGID']='999';runCase($parts);check(count($parts[1]->threads)===2,'new UIDVALIDITY can reuse low UID without losing new identity');
$parts=setup(1);runCase($parts);$parts[0]->folders['INBOX']['validity']='2';$parts[3]['initial_since']='2026-11-10';$calls=$parts[0]->bodyCalls;runCase($parts);check(count($parts[1]->threads)===1&&$parts[0]->bodyCalls===$calls,'UIDVALIDITY reset replays known identity without MIME');check(in_array('2026-11-01',$parts[0]->searchFloors,true),'UIDVALIDITY recovery retains original explicit lower bound');
$parts=setup(1);$parts[0]->resetOnRaw=true;failure(function()use($parts){runCase($parts);},'UIDVALIDITY race before MIME refuses import');check(!$parts[1]->threads&&!$parts[1]->sources,'UIDVALIDITY race leaves no target or checkpoint');
$parts=setup(1);$parts[0]->folders['Archive']=$parts[0]->folders['INBOX'];$parts[3]['folders'][]='Archive';runCase($parts);check(count($parts[1]->threads)===1&&$parts[0]->bodyCalls===1,'same provider identity in two folders imported once');runCase($parts,2);check(count($parts[1]->threads)===2,'stable identity dedupe is scoped per mailbox');
$parts=setup(3,['batch_size'=>2,'folders'=>['INBOX','Spam']]);$parts[0]->folders['Spam']=$parts[0]->folders['INBOX'];foreach($parts[0]->folders['Spam']['rows']as&$row)$row['X-GM-MSGID'].='9';unset($row);runCase($parts);check($parts[1]->sources[1]['INBOX']['last_uid']===1&&$parts[1]->sources[1]['Spam']['last_uid']===1,'busy first folder does not starve second folder');
$parts=setup(1);$parts[0]->folders['INBOX']['rows'][1]['X-GM-LABELS']=['\\Draft'];runCase($parts);check(!$parts[1]->threads&&count($parts[1]->deferredRows)===1,'draft retained as deferred work');$parts[0]->folders['INBOX']['rows'][1]['X-GM-LABELS']=['\\Sent'];runCase($parts);check(count($parts[1]->threads)===1&&!$parts[1]->deferredRows,'same UID draft becoming sent is revisited');
$parts=setup(1);$parts[0]->folders['INBOX']['rows'][1]['X-GM-LABELS']=['\\Draft'];runCase($parts);unset($parts[0]->folders['INBOX']['rows'][1]);runCase($parts);check(!$parts[1]->deferredRows,'verified expunged draft does not poison mailbox');
$parts=setup(1);$parts[0]->folders['INBOX']['rows'][1]['X-GM-LABELS']=['\\Draft'];runCase($parts);$parts[0]->folders['INBOX']['validity']='2';$parts[0]->folders['INBOX']['rows'][1]['X-GM-LABELS']=['\\Sent'];runCase($parts);check(!$parts[1]->deferredRows&&count($parts[1]->threads)===1,'draft old-generation ghost cleared and current generation reconciled');
$parts=setup();$parts[1]->busy=true;$result=runCase($parts);check($result['status']==='busy'&&$parts[0]->connected===0,'overlapping worker exits without provider connection');
$parts=setup(2);$parts[2]->skip['101']=true;runCase($parts);check(count($parts[1]->threads)===1&&$parts[1]->sources[1]['INBOX']['last_uid']===2,'acknowledged native skip does not poison following new mail');
check(FivewaysPolicy::status([['X-GM-LABELS'=>['\\Inbox']],['X-GM-LABELS'=>['Closed']]])==='closed','group Closed label takes precedence over latest Inbox');check(FivewaysPolicy::status([['X-GM-LABELS'=>['Active']],['folder'=>'[Gmail]/Spam']])==='spam','group Spam takes precedence over Active');check(FivewaysPolicy::status([['folder'=>'[Gmail]/Spam'],['folder'=>'[Gmail]/Bin']])==='deleted','group Bin takes precedence over Spam');
$scope=['email'=>'team@example.invalid','owner_email'=>'owner@example.invalid','allowed_users'=>['owner@example.invalid','staff@example.invalid']];
FivewaysPolicy::assertScope((object)['id'=>3,'email'=>'team@example.invalid'],['owner@example.invalid','staff@example.invalid'],$scope);check(true,'exact private-config team policy retained');failure(function()use($scope){FivewaysPolicy::assertScope((object)['id'=>3,'email'=>'team@example.invalid'],['owner@example.invalid','outsider@example.invalid'],$scope);},'unknown teammate denied');
failure(function(){FivewaysPolicy::assertScope((object)['id'=>3,'email'=>'team@example.invalid'],['owner@example.invalid']);},'missing private scope fails closed without source identity fallback');
$personPolicy=['team_domain'=>'example.invalid','people'=>['first'=>['first@example.invalid','alias@example.invalid'],'second'=>['second@example.invalid']],'label_people'=>['To First'=>'first','To Second'=>'second']];
check(FivewaysPolicy::personMatches(['ALIAS@EXAMPLE.INVALID'],[],$personPolicy)===['first'],'private configured person aliases preserve case-insensitive address matching');
check(FivewaysPolicy::personMatches([],[],$personPolicy,'Delivered-To: second@example.invalid')===['second'],'private configured team domain preserves delivery-header matching');
check(FivewaysPolicy::personMatches([],['To First','To Second'],$personPolicy)===['first','second'],'private Gmail label mappings preserve person routing');
check(FivewaysPolicy::personMatches([],['Unmapped'],$personPolicy,'second@example.invalid.evil')===[],'unknown labels and lookalike domains cannot invent person tags');
failure(function(){FivewaysPolicy::personMatches([],[],[]);},'missing private person identity policy fails closed');
class ReservedSinkFixture extends SinkFixture {
    public $reservations=0,$released=0,$busyAt=null,$held=false,$loadRaw=false;
    public function reserve($row,$loadRaw){$this->reservations++;if($this->reservations===$this->busyAt)return false;if($this->loadRaw)$loadRaw();$this->held=true;return true;}
    public function releaseMessage(){$this->held=false;$this->released++;}
}
$parts=setup(2);$parts[2]=new ReservedSinkFixture($parts[1]);$parts[2]->busyAt=1;$result=runCase($parts);check($result['status']==='busy'&&$result['processed']===0&&!$parts[1]->sources&&!$parts[1]->locked,'message reservation contention returns busy without advancing');
$parts=setup(3);$parts[2]=new ReservedSinkFixture($parts[1]);$parts[2]->busyAt=2;$result=runCase($parts);check($result['status']==='busy'&&$result['processed']===1&&$parts[1]->sources[1]['INBOX']['last_uid']===1&&$parts[2]->released===1,'reservation contention preserves prior committed progress');
$parts=setup(1);$parts[2]=new ReservedSinkFixture($parts[1]);$parts[0]->failUid=1;failure(function()use($parts){runCase($parts);},'reserved message MIME failure propagated');check($parts[2]->released===1&&!$parts[2]->held&&!$parts[1]->threads,'reservation released after failed transaction');
$parts=setup(1,['after_commit'=>function(){throw new RuntimeException('postcommit');}]);$parts[2]=new ReservedSinkFixture($parts[1]);failure(function()use($parts){runCase($parts);},'reserved message postcommit failure propagated');check($parts[2]->released===1&&count($parts[1]->threads)===1,'reservation released after postcommit observer failure');
$parts=setup(1);$parts[2]=new ReservedSinkFixture($parts[1]);$parts[2]->loadRaw=true;runCase($parts);check($parts[0]->bodyCalls===1,'MIME fetched for fallback reservation is reused by importer');
$parts=setup(1);$parts[0]->folders['INBOX']['rows'][1]['X-GM-LABELS']=['\\Draft'];runCase($parts);$parts[2]=new ReservedSinkFixture($parts[1]);$parts[2]->busyAt=1;$parts[0]->folders['INBOX']['rows'][1]['X-GM-LABELS']=['\\Sent'];$result=runCase($parts);check($result['status']==='busy'&&count($parts[1]->deferredRows)===1&&!$parts[1]->threads,'deferred sent draft uses same reservation boundary');
$parts=setup(1);unset($parts[0]->folders['INBOX']['rows'][1]['X-GM-MSGID']);$parts[2]=new ReservedSinkFixture($parts[1]);$parts[2]->loadRaw=true;runCase($parts);check($parts[0]->bodyCalls===1,'generic IMAP fallback reservation reuses MIME when metadata has no stable provider ID');
class RetryAfterCallbackStore extends MemoryStore {
 public $injected=false;
 public function transaction($callback){if(!$this->injected){$this->injected=true;try{return parent::transaction(function()use($callback){$result=$callback();throw new RuntimeException('simulated transaction auto-rollback');});}catch(RuntimeException$e){return parent::transaction($callback);}}return parent::transaction($callback);}
}
$parts=setup(2);$parts[1]=new RetryAfterCallbackStore();$parts[2]=new SinkFixture($parts[1]);$retried=runCase($parts);check($retried['processed']===2&&$retried['changed']===2&&count($parts[1]->threads)===2&&$parts[1]->version===2,'transaction retry cannot double-count processed messages or changed receipts');
$parts=setup(1);$parts[0]->folders['INBOX']['rows'][1]['X-GM-LABELS']=['\\Draft'];runCase($parts);$parts[0]->folders['INBOX']['rows'][1]['X-GM-LABELS']=['\\Sent'];$sent=runCase($parts);check($sent['processed']===1&&$sent['changed']===1,'deferred message counts are taken from committed result');
echo "BACKEND_ENGINE_PASS\n";
