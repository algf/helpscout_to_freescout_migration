<?php
use MailArrivalEvidence\BaselineReconcile;
use MailArrivalEvidence\BaselineReconcileGuard;
function check($ok, $name) { if (!$ok) { throw new RuntimeException($name); } echo 'PASS '.$name."\n"; }
function rejected($fn, $reason, $name) {
    try { $fn(); } catch (RuntimeException $error) { check($error->getMessage()===$reason,$name); return; }
    throw new RuntimeException('Expected refusal: '.$name);
}
function plan() {
    $mailboxes=[];
    foreach ([1,2,3] as $id) {
        $mailboxes[]=['mailbox_id'=>$id,'folders'=>[['folder'=>'INBOX','uidvalidity'=>'9',
            'high_uid'=>5,'floor_since'=>'2026-11-09','candidate_count'=>3,
            'matched'=>[['gmail_id'=>(string)(700+$id),'thread_id'=>100+$id]],
            'unknown_uids'=>[4],'draft_uids'=>[5]]]];
    }
    return ['schema'=>1,'floor_since_utc'=>'2026-11-09','mailboxes'=>$mailboxes];
}
class ReconcileFakeStore {
    public $transactionActive=false;
    public $sources=[], $deferred=[], $held=[], $failLock=null, $badMatch=false, $failWrite=false;
    public function __construct() {
        foreach ([1,2,3] as $id) {
            $this->sources[$id]=['uidvalidity'=>'9','last_uid'=>4,'seed_since'=>'2026-11-09',
                'seed_high_uid'=>5,'seeding'=>true,'retained_field'=>'keep'];
        }
    }
    public function lock($id) { if ($id===$this->failLock) return false; $this->held[$id]=true; return true; }
    public function unlock($id) { unset($this->held[$id]); }
    public function transaction($fn) {
        $before=[$this->sources,$this->deferred];
        try { $this->transactionActive=true; $fn(); } catch (Throwable $error) { [$this->sources,$this->deferred]=$before; throw $error; } finally { $this->transactionActive=false; }
    }
    public function verifyMatches($matches) { if ($this->badMatch) throw new RuntimeException('MATCHED_LEDGER_MISMATCH'); }
    public function source($id,$folder) { return $this->sources[$id]??null; }
    public function defer($id,$row) {
        $key=$id.':'.$row['UID']; if (isset($this->deferred[$key])) return false;
        $this->deferred[$key]=$row; return true;
    }
    public function checkpoint($id,$folder,$state) {
        if ($this->failWrite && $id===2) throw new RuntimeException('SYNTHETIC_WRITE_FAILURE');
        $this->sources[$id]=$state;
    }
}
$folders=[1=>['INBOX'],2=>['INBOX'],3=>['INBOX']];
$remote=function(){return ['uidvalidity'=>'9','uidnext'=>10];};
$store=new ReconcileFakeStore(); $counts=BaselineReconcile::apply(plan(),$folders,$store,$remote);
check($counts===['matched_identities'=>3,'advanced_sources'=>3,'completed_sources_unchanged'=>0,'deferred_inserted'=>6,'deferred_retained'=>0],'all matched identities verified and all remaining unknown/draft work queued');
check($store->sources[1]['last_uid']===5&&$store->sources[1]['seeding']===false&&$store->sources[1]['retained_field']==='keep','source fence advances with other state retained');
check(isset($store->deferred['1:4']),'unknown UID at or below prior last UID is safely replay queued');
check(!$store->held,'all importer locks released after success');
$store=new ReconcileFakeStore(); $prior=['folder'=>'INBOX','uidvalidity'=>'9','UID'=>4,'original_metadata'=>['keep']]; $store->deferred['1:4']=$prior;
$counts=BaselineReconcile::apply(plan(),$folders,$store,$remote);
check($counts['deferred_retained']===1&&$counts['deferred_inserted']===5&&$store->deferred['1:4']===$prior,'existing deferred source is preserved in full');
$before=$store->sources; $counts=BaselineReconcile::apply(plan(),$folders,$store,$remote);
check($counts['completed_sources_unchanged']===3&&$counts['deferred_inserted']===0&&$store->sources===$before,'repeated reconciliation leaves completed sources unchanged');
$store=new ReconcileFakeStore(); $store->sources[1]['last_uid']=9; $store->sources[1]['seeding']=false; $before=$store->sources[1];
$counts=BaselineReconcile::apply(plan(),$folders,$store,$remote);
check($counts['completed_sources_unchanged']===1&&$store->sources[1]===$before&&!isset($store->deferred['1:4']),'newer completed source never regresses or gains baseline work');
foreach ([
    ['uidvalidity','10','CHECKPOINT_SCOPE_MISMATCH'], ['seed_since','2026-11-08','CHECKPOINT_SCOPE_MISMATCH'],
    ['seed_high_uid',6,'SEED_FENCE_MISMATCH'], ['last_uid',6,'SEED_FENCE_MISMATCH']
] as [$field,$value,$reason]) {
    $store=new ReconcileFakeStore(); $store->sources[2][$field]=$value; $before=$store->sources;
    rejected(function()use($store,$folders,$remote){BaselineReconcile::apply(plan(),$folders,$store,$remote);},$reason,'checkpoint '.$field.' drift fails closed');
    check($store->sources===$before&&!$store->deferred&&!$store->held,'checkpoint '.$field.' refusal rolls back every earlier source');
}
$store=new ReconcileFakeStore(); $store->badMatch=true;
rejected(function()use($store,$folders,$remote){BaselineReconcile::apply(plan(),$folders,$store,$remote);},'MATCHED_LEDGER_MISMATCH','missing or mismatched committed known target refuses reconciliation');
check(!$store->deferred&&!$store->held,'known-target failure writes nothing and releases locks');
$store=new ReconcileFakeStore(); $store->failWrite=true; $before=$store->sources;
rejected(function()use($store,$folders,$remote){BaselineReconcile::apply(plan(),$folders,$store,$remote);},'SYNTHETIC_WRITE_FAILURE','injected partial write fails');
check($store->sources===$before&&!$store->deferred&&!$store->held,'transaction rollback restores sources and deferred work across mailboxes');
$store=new ReconcileFakeStore(); $store->failLock=2;
rejected(function()use($store,$folders,$remote){BaselineReconcile::apply(plan(),$folders,$store,$remote);},'IMPORTER_LOCK_UNAVAILABLE','busy importer lock refuses reconciliation');
check(!$store->held&&!$store->deferred,'partial lock acquisition is released');
$store=new ReconcileFakeStore(); $calls=0;
$changed=function()use(&$calls){return ['uidvalidity'=>(++$calls>6?'10':'9'),'uidnext'=>10];};
rejected(function()use($store,$folders,$changed){BaselineReconcile::apply(plan(),$folders,$store,$changed);},'SOURCE_EPOCH_CHANGED','fresh provider snapshot rejects epoch drift before transaction');
check(!$store->deferred&&!$store->held,'late epoch change writes no work');
$store=new ReconcileFakeStore(); $networkCalls=0;
$outsideTransaction=function()use($store,&$networkCalls){if($store->transactionActive)throw new RuntimeException('NETWORK_INSIDE_TRANSACTION');$networkCalls++;return ['uidvalidity'=>'9','uidnext'=>10];};
BaselineReconcile::apply(plan(),$folders,$store,$outsideTransaction);
check($networkCalls===9,'all provider callbacks run before database transaction and row locks');
$args=['expected-app-url'=>'https://support.example.com','config-sha256'=>str_repeat('a',64),'inventory-sha256'=>str_repeat('b',64),'gate-closed-confirmed'=>false,'all-mailboxes-paused-confirmed'=>false,'host-locks-drained-confirmed'=>false];
check(BaselineReconcileGuard::arguments($args)['app_url']==='https://support.example.com','explicit HTTPS scope and all operator barriers accepted');
foreach (['gate-closed-confirmed','all-mailboxes-paused-confirmed','host-locks-drained-confirmed'] as $key) {
    $bad=$args; unset($bad[$key]); rejected(function()use($bad){BaselineReconcileGuard::arguments($bad);},'OWNERSHIP_BARRIER_NOT_CONFIRMED','missing '.$key.' acknowledgement fails closed');
}
$bad=$args; $bad['expected-app-url']='http://support.example.com';
rejected(function()use($bad){BaselineReconcileGuard::arguments($bad);},'ARGUMENTS_INVALID','non-HTTPS app scope rejected');
$private=['mailboxes'=>[]]; foreach ([1,2,3] as $id) $private['mailboxes'][$id]=['folders'=>['INBOX'],'initial_since'=>'2026-11-09'];
check(BaselineReconcileGuard::scope($private,plan())===$folders,'private configuration binds exact plan floor and folders');
$private['mailboxes'][2]['initial_since']='2026-11-08';
rejected(function()use($private){BaselineReconcileGuard::scope($private,plan());},'PRIVATE_CONFIG_PLAN_MISMATCH','private floor drift rejected');
$dir=sys_get_temp_dir().'/baseline-reconcile-'.getmypid(); mkdir($dir,0700); $file=$dir.'/inventory.json'; file_put_contents($file,'{}'); chmod($file,0600);
try {
    check(BaselineReconcileGuard::privateBytes($file,hash('sha256','{}'),$dir)==='{}','private file owner mode path and exact hash accepted');
    rejected(function()use($file,$dir){BaselineReconcileGuard::privateBytes($file,str_repeat('0',64),$dir);},'PRIVATE_FILE_HASH_MISMATCH','changed private inventory bytes rejected');
    chmod($file,0644); clearstatcache();
    rejected(function()use($file,$dir){BaselineReconcileGuard::privateBytes($file,hash('sha256','{}'),$dir);},'PRIVATE_FILE_PERMISSIONS_INVALID','public-readable private input rejected');
    foreach ([1,2] as $id) file_put_contents($dir.'/mailbox-'.$id.'-sync.paused','test-owned');
    rejected(function()use($dir){BaselineReconcileGuard::paused(['pause_dir'=>$dir]);},'MAILBOX_NOT_PAUSED','all three actual pause markers are required');
    file_put_contents($dir.'/mailbox-3-sync.paused','test-owned');
    BaselineReconcileGuard::paused(['pause_dir'=>$dir]); check(true,'all three actual pause markers accepted');
} finally { foreach (glob($dir.'/*') as $path) unlink($path); rmdir($dir); }
