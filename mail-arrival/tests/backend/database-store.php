<?php
namespace App {class Subscription {public static $occurred_events=[];}}
namespace {
class FakePdo {public $active=false,$locks=['mailbox'=>true,'message'=>true];public function inTransaction(){return$this->active;}}
class FakeConnection {
 public $pdo,$level=0,$resets=0,$writes=[];
 public function __construct(){$this->pdo=new FakePdo();}
 public function getPdo(){return$this->pdo;}
 public function transactionLevel(){return$this->level;}
 public function setPdo($pdo){if($pdo!==$this->pdo)throw new RuntimeException('Unexpected reconnect');$this->level=0;$this->resets++;}
}
class DB {
 public static $connection,$mode='masked',$outbox=[];
 public static function table($table){return new class {public function updateOrInsert($key,$data){DB::$outbox[$key['event_key']]=$data;}};}
 public static function connection(){return self::$connection;}
 public static function transaction($callback){$c=self::$connection;$c->level=1;$c->pdo->active=true;$beforeWrites=$c->writes;$beforeOutbox=self::$outbox;try{$result=$callback();}catch(Throwable$e){$c->writes=$beforeWrites;self::$outbox=$beforeOutbox;$c->pdo->active=false;if(self::$mode==='masked')throw new PDOException('There is no active transaction');$c->level=0;throw$e;}if(self::$mode==='commit-failure'){$c->pdo->active=false;throw new PDOException('Commit failed');}$c->pdo->active=false;$c->level=0;return$result;}
}
require_once $argv[1].'/Backend/DatabaseStore.php';
function check($ok,$label){if(!$ok)throw new RuntimeException($label);echo"PASS $label\n";}
$store=new \Modules\MailArrival\DatabaseStore();DB::$connection=new FakeConnection();$original=new RuntimeException('original callback failure');
try{$store->transaction(function()use($original){\App\Subscription::$occurred_events[]=['uncommitted'=>'event'];throw$original;});throw new RuntimeException('Expected callback failure');}catch(Throwable$e){check($e===$original,'masked rollback retains the original callback exception');}
check(DB::$connection->resets===1&&DB::$connection->level===0&&count(DB::$connection->pdo->locks)===2,'stale transaction counter reset retains exact PDO and advisory locks');
check(\App\Subscription::$occurred_events===[],'failed callback restores native subscription memory');
DB::$mode='normal';DB::$connection=new FakeConnection();try{$store->transaction(function()use($original){throw$original;});}catch(Throwable$e){check($e===$original&&DB::$connection->resets===0,'ordinary rollback does not replace a healthy connection');}
DB::$mode='commit-failure';DB::$connection=new FakeConnection();try{$store->transaction(function(){return'saved';});throw new RuntimeException('Expected commit failure');}catch(Throwable$e){check($e instanceof PDOException&&$e->getMessage()==='Commit failed','unconfirmed commit failure is never accepted as success');}
foreach([1020,1213,40001]as$code){
 DB::$mode='masked';DB::$connection=new FakeConnection();DB::$outbox=[];$store=new \Modules\MailArrival\DatabaseStore();$calls=0;
 $result=$store->transaction(function()use(&$calls,$code){$calls++;DB::$connection->writes=['thread'=>1,'ledger'=>1,'receipt'=>1];\App\Subscription::$occurred_events[]=['conversation'=>(object)['mailbox_id'=>1]];if($calls===1)throw new PDOException('conflict',$code);return'committed';});
 check($result==='committed'&&$calls===2&&DB::$connection->writes===['thread'=>1,'ledger'=>1,'receipt'=>1],'whole callback retries confirmed conflict '.$code.' after write rollback');
 check($store->recoveredConflicts()===1&&DB::$connection->resets===1&&count(DB::$outbox)===1&&\App\Subscription::$occurred_events===[]&&count(DB::$connection->pdo->locks)===2,'retry '.$code.' preserves locks and commits notifications once');
}
DB::$mode='masked';DB::$connection=new FakeConnection();DB::$outbox=[];$store=new \Modules\MailArrival\DatabaseStore();$calls=0;
try{$store->transaction(function()use(&$calls){$calls++;DB::$connection->writes=['uncommitted'=>true];throw new PDOException('conflict',1020);});throw new RuntimeException('Expected exhausted conflict');}catch(Throwable$e){check($e instanceof PDOException&&$e->getCode()===1020&&$calls===3&&!DB::$connection->writes&&DB::$connection->level===0,'exhausted conflict retries stop at three with no committed writes');}
DB::$connection=new FakeConnection();$store=new \Modules\MailArrival\DatabaseStore();$calls=0;try{$store->transaction(function()use(&$calls){$calls++;throw new PDOException('duplicate',1062);});}catch(Throwable$e){check($calls===1&&$store->recoveredConflicts()===0,'non-retryable driver failures are not blindly replayed');}
echo"BACKEND_DATABASE_STORE_PASS\n";
}
