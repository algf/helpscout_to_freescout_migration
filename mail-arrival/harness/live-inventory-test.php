<?php
// Fake metadata only. No network or database access.
class InventoryProtocol {
    public $ops=[];public $next=56;public $validity=7;public $drift=false;public $badUid=false;public $examines=0;
    public function examineFolder($folder){$this->ops[]=['EXAMINE',$folder];$this->examines++;return ['uidvalidity'=>$this->drift&&$this->examines>1?8:$this->validity,'uidnext'=>$this->next];}
    public function search($terms){$this->ops[]=['SEARCH',$terms];return $this->badUid?[$this->next]:range(1,$this->next-1);}
    public function fetch($items,$uids){$this->ops[]=['FETCH',$items,count($uids)];$out=[];foreach($uids as$uid)$out[$uid]=['UID'=>$uid,'INTERNALDATE'=>'14-Nov-2023 22:13:22 +0000','FLAGS'=>$uid===5?['\\Draft']:[],'X-GM-MSGID'=>(string)(9000+$uid),'X-GM-THRID'=>(string)(8000+$uid),'X-GM-LABELS'=>[],'BODY[HEADER]'=>"Message-ID: <private$uid@synthetic.invalid>\r\nSubject: must-not-leak\r\n\r\n"];return$out;}
}
function check($ok,$message){if(!$ok)throw new \RuntimeException($message);echo 'PASS '.$message."\n";}
$provider=new InventoryProtocol();$lookup=function($mailbox,$items){$out=[];foreach($items as$i)if($i['uid']<=2)$out[$i['uid']]=100+$i['uid'];return$out;};
$generate=function($mailbox,$mid){return 'generated-'.$mid;};$inventory=new LiveInventory($provider,$lookup,$generate,2500);
$result=$inventory->mailbox(1,['INBOX'],'2023-11-11');$plan=$result['folders'][0];
check($plan['uidvalidity']==='7'&&$plan['high_uid']===55&&$plan['candidate_count']===55,'bounded source fence and count');
check(count($plan['matched'])===2&&count($plan['unknown_uids'])===52&&$plan['draft_uids']===[5],'matched unknown and draft classification');
check(strpos(json_encode($result),'must-not-leak')===false&&strpos(json_encode($result),'synthetic.invalid')===false,'no raw header or message ID in plan');
$fetches=array_values(array_filter($provider->ops,function($x){return$x[0]==='FETCH';}));
check(array_column($fetches,2)===[50,5],'metadata fetched in batches of fifty');
foreach($fetches as$fetch)check(in_array('BODY.PEEK[HEADER]',$fetch[1],true)&&!in_array('BODY.PEEK[]',$fetch[1],true),'header-only PEEK');
foreach($provider->ops as$op)check(in_array($op[0],['EXAMINE','SEARCH','FETCH'],true),'read-only IMAP operation');
$drift=new InventoryProtocol();$drift->drift=true;try{(new LiveInventory($drift,$lookup,$generate,2500))->mailbox(1,['INBOX'],'2023-11-11');throw new \RuntimeException('epoch accepted');}catch(\RuntimeException $e){check($e->getMessage()==='SOURCE_EPOCH_CHANGED','changed source epoch rejected');}
$oversize=new InventoryProtocol();$oversize->next=56;try{(new LiveInventory($oversize,$lookup,$generate,50))->mailbox(1,['INBOX'],'2023-11-11');throw new \RuntimeException('oversize accepted');}catch(\RuntimeException $e){check($e->getMessage()==='INVENTORY_CAP_EXCEEDED','cap exceeded fails closed');}

$bad=new InventoryProtocol();$bad->badUid=true;try{(new LiveInventory($bad,$lookup,$generate,2500))->mailbox(1,['INBOX'],'2023-11-11');throw new \RuntimeException('bad UID accepted');}catch(\RuntimeException $e){check($e->getMessage()==='SOURCE_UID_INVALID','out-of-fence UID fails closed');}
