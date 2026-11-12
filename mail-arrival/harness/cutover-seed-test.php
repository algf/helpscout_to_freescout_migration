<?php
class FakeSeedStore {
    public $held=[],$matches=[],$sources=[],$occupied=false,$failLock=null,$badTarget=false,$badLegacy=false,$failWrite=false;
    public function lock($id){if($id===$this->failLock)return false;$this->held[]=$id;return true;}
    public function unlock($id){$i=array_search($id,$this->held,true);if($i!==false)unset($this->held[$i]);}
    public function empty(){return !$this->occupied&&!$this->matches&&!$this->sources;}
    public function verifyTargets($matches,$lock=false){if($this->badTarget)throw new \RuntimeException('TARGET_SCOPE_MISMATCH');if($this->badLegacy)throw new \RuntimeException('LEGACY_TARGET_MISMATCH');}
    public function transaction($callback){$a=$this->matches;$b=$this->sources;try{$callback();}catch(\Throwable $e){$this->matches=$a;$this->sources=$b;throw$e;}}
    public function insertMatch($m){$this->matches[]=$m;if($this->failWrite)throw new \RuntimeException('SYNTHETIC_WRITE_FAILURE');}
    public function insertSource($s){$this->sources[]=$s;}
}
function check($condition,$label){if(!$condition)throw new \RuntimeException($label);echo 'PASS '.$label."\n";}
function fixture(){ $boxes=[];foreach([1,2,3]as$id)$boxes[]=['mailbox_id'=>$id,'folders'=>[['folder'=>'INBOX','uidvalidity'=>(string)(100+$id),'high_uid'=>5,'floor_since'=>'2026-11-09','candidate_count'=>3,'matched'=>[['gmail_id'=>(string)(700+$id),'thread_id'=>100+$id]],'unknown_uids'=>[4],'draft_uids'=>[5]]]];return ['schema'=>1,'floor_since_utc'=>'2026-11-09','mailboxes'=>$boxes];}
$plan=fixture();$folders=[1=>['INBOX'],2=>['INBOX'],3=>['INBOX']];$state=function($id,$folder){return ['uidvalidity'=>(string)(100+$id),'uidnext'=>6];};
$store=new FakeSeedStore();$counts=CutoverSeed::apply($plan,$folders,$store,$state);
check($counts===['mailboxes'=>3,'folders'=>3,'matched_identities'=>3,'candidate_count'=>9,'unknown_count'=>3,'draft_count'=>3],'counts reflect full plan');
check(count($store->matches)===3&&count($store->sources)===3,'only known identities and source fences seeded');
check($store->sources[0]['high_uid']===5&&$store->sources[0]['floor']==='2026-11-09','source fence and floor retained');
check(!$store->held,'all advisory locks released');
foreach(['occupied'=>'SEED_TABLES_NOT_EMPTY','badTarget'=>'TARGET_SCOPE_MISMATCH','badLegacy'=>'LEGACY_TARGET_MISMATCH','failWrite'=>'SYNTHETIC_WRITE_FAILURE']as$flag=>$expected){$s=new FakeSeedStore();$s->$flag=true;try{CutoverSeed::apply($plan,$folders,$s,$state);throw new \RuntimeException('failure missed');}catch(\RuntimeException $e){check($e->getMessage()===$expected,$flag.' fails closed');check(!$s->matches&&!$s->sources&&!$s->held,$flag.' leaves no partial seed and releases locks');}}
$s=new FakeSeedStore();$s->failLock=2;try{CutoverSeed::apply($plan,$folders,$s,$state);throw new \RuntimeException('lock accepted');}catch(\RuntimeException $e){check($e->getMessage()==='IMPORTER_LOCK_UNAVAILABLE'&&!$s->held,'partial lock acquisition released');}
$s=new FakeSeedStore();$n=0;$changed=function($id,$folder)use(&$n){$n++;return ['uidvalidity'=>(string)(100+$id+($n>3?1:0)),'uidnext'=>6];};try{CutoverSeed::apply($plan,$folders,$s,$changed);throw new \RuntimeException('drift accepted');}catch(\RuntimeException $e){check($e->getMessage()==='SOURCE_EPOCH_CHANGED'&&!$s->matches&&!$s->sources&&!$s->held,'second epoch fence aborts before writes');}
$invalid=fixture();$invalid['mailboxes'][0]['folders'][0]['unknown_uids']=[6];try{CutoverSeed::apply($invalid,$folders,new FakeSeedStore(),$state);throw new \RuntimeException('invalid UID accepted');}catch(\RuntimeException $e){check($e->getMessage()==='PLAN_UID_INVALID','unknown UID outside high fence rejected');}
