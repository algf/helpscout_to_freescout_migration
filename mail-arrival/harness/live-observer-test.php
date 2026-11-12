<?php
// Standalone fake protocol. No production credentials, files, DB or network.
class FakeProtocol {
    public $validity=1; public $next=10; public $ops=[]; public $date='14-Nov-2023 22:13:22 +0000'; public $messageId='777123456789';
    public function examineFolder($folder) {$this->ops[]=['EXAMINE',$folder];return ['uidvalidity'=>$this->validity,'uidnext'=>$this->next];}
    public function search($terms) {$this->ops[]=['SEARCH',$terms];return $this->next>10?[10]:[];}
    public function fetch($items,$from,$to) {$this->ops[]=['FETCH',$items];return [10=>['UID'=>10,'INTERNALDATE'=>$this->date,'X-GM-MSGID'=>$this->messageId]];}
}
function check($ok,$label) {if(!$ok)throw new \RuntimeException($label);echo 'PASS '.$label."\n";}
$now=1700000000.1; $persist=false; $protocol=new FakeProtocol();
$lookup=function($mailbox,$identity)use(&$persist){return $persist?['thread_id'=>11,'conversation_id'=>42,'ledger_written_at_utc'=>'2023-11-14 22:13:24']:null;};
$observer=new LiveObserver($protocol,3,['[Gmail]/All Mail','[Gmail]/Spam'],$lookup,function()use(&$now){return $now;});
$base=$observer->baseline();check($base['completed_ms']===1700000000100,'baseline time bounded');
$protocol->next=11;$now=1700000003;check($observer->sample()===[],'uncommitted candidate withheld');
$persist=true;$now=1700000005;$rows=$observer->sample();
check(count($rows)===1,'cross-folder identity emitted once');
check($rows[0]['provider_received_lower_ms']===1700000002000&&$rows[0]['provider_received_upper_ms']===1700000002999,'provider second precision bounded');
check($rows[0]['commit_lower_ms']===1700000004000&&$rows[0]['commit_upper_ms']===1700000005000,'commit observation bounded');
check($rows[0]['conversation_id']===42,'committed conversation identity');
check(strpos(json_encode($rows),'777123456789')===false&&strlen($rows[0]['opaque_id'])===64,'raw provider identifier not emitted');
foreach($protocol->ops as $op){check(in_array($op[0],['EXAMINE','SEARCH','FETCH'],true),'read-only protocol operation');if($op[0]==='FETCH')check($op[1]===['UID','INTERNALDATE','X-GM-MSGID'],'metadata-only fetch');}
$protocol->validity=2;try{$observer->sample();throw new \RuntimeException('epoch accepted');}catch(\RuntimeException $e){check($e->getMessage()==='Source epoch or UIDNEXT changed unexpectedly','UIDVALIDITY change stops observation');}

$oldProtocol=new FakeProtocol();$oldProtocol->date='14-Nov-2023 22:13:20 +0000';$now=1700000000.1;
$oldObserver=new LiveObserver($oldProtocol,1,['INBOX'],$lookup,function()use(&$now){return $now;});$oldObserver->baseline();$oldProtocol->next=11;$now=1700000003;
check($oldObserver->sample()===[],'ambiguous pre-baseline receipt excluded');
$invalid=new FakeProtocol();$now=1700000000.1;$invalidObserver=new LiveObserver($invalid,1,['INBOX'],$lookup,function()use(&$now){return $now;});$invalidObserver->baseline();$invalid->next=11;$invalid->messageId='not-a-gmail-id';$now=1700000003;
try{$invalidObserver->sample();throw new \RuntimeException('invalid ID accepted');}catch(\RuntimeException $e){check($e->getMessage()==='Stable source metadata unavailable','invalid stable identity rejected');}
try{new LiveObserver(new FakeProtocol(),1,["bad\0folder"],$lookup,function(){return 1;});throw new \RuntimeException('unsafe folder accepted');}catch(\RuntimeException $e){check($e->getMessage()==='Observation folder is invalid','unsafe folder rejected');}
