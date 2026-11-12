<?php
// Temporary tables shadow app tables on this connection. No app records are changed.
$pdo=DB::connection()->getPdo();
$pdo->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
foreach ([
    'CREATE TEMPORARY TABLE conversations (id INT PRIMARY KEY,mailbox_id INT NOT NULL) ENGINE=InnoDB',
    'CREATE TEMPORARY TABLE threads (id INT PRIMARY KEY,conversation_id INT NOT NULL) ENGINE=InnoDB',
    'CREATE TEMPORARY TABLE fiveways_gmail_history (gmail_id VARCHAR(32) PRIMARY KEY,target_thread_id INT NOT NULL) ENGINE=InnoDB',
    'CREATE TEMPORARY TABLE mail_arrival_messages (message_key VARCHAR(64) PRIMARY KEY,mailbox_id INT,identity VARCHAR(255),target_thread_id INT,sha256 VARCHAR(64),outcome VARCHAR(32),committed_at DATETIME) ENGINE=InnoDB',
    'CREATE TEMPORARY TABLE mail_arrival_sources (source_key VARCHAR(64) PRIMARY KEY,mailbox_id INT,state TEXT) ENGINE=InnoDB',
    'CREATE TEMPORARY TABLE mail_arrival_deferred (message_key VARCHAR(64) PRIMARY KEY,mailbox_id INT,source TEXT) ENGINE=InnoDB',
    'CREATE TEMPORARY TABLE mail_arrival_versions (mailbox_id INT PRIMARY KEY,version BIGINT) ENGINE=InnoDB',
    'CREATE TEMPORARY TABLE mail_arrival_event_outbox (event_key VARCHAR(64) PRIMARY KEY) ENGINE=InnoDB'
] as $sql) { $pdo->exec($sql); }
$pdo->exec('INSERT INTO conversations VALUES (1,1),(2,2),(3,3)');
$pdo->exec('INSERT INTO threads VALUES (101,1),(102,2),(103,3)');
$pdo->exec("INSERT INTO fiveways_gmail_history VALUES ('703',103)");
$pdo->exec('INSERT INTO mail_arrival_versions VALUES (1,42),(2,42),(3,42)');
$pdo->exec("INSERT INTO mail_arrival_event_outbox VALUES ('retained')");
$seed=new MailArrivalEvidence\CutoverPdoStore($pdo);
$matches=[]; $boxes=[]; $folders=[];
foreach ([1,2,3] as $id) {
    $match=['mailbox_id'=>$id,'gmail_id'=>(string)(700+$id),'thread_id'=>100+$id];
    $matches[]=$match; $seed->insertMatch($match); $folders[$id]=['INBOX'];
    $seed->insertSource(['mailbox_id'=>$id,'folder'=>'INBOX','uidvalidity'=>'9','floor'=>'2026-11-09','high_uid'=>5]);
    $boxes[]=['mailbox_id'=>$id,'folders'=>[['folder'=>'INBOX','uidvalidity'=>'9','high_uid'=>5,
        'floor_since'=>'2026-11-09','candidate_count'=>3,'matched'=>[$match],
        'unknown_uids'=>[4],'draft_uids'=>[5]]]];
}
$plan=['schema'=>1,'floor_since_utc'=>'2026-11-09','mailboxes'=>$boxes];
$store=new MailArrivalEvidence\BaselineReconcilePdoStore($pdo);
$remote=function(){return ['uidvalidity'=>'9','uidnext'=>10];};
$assert=function($ok,$name){if(!$ok)throw new RuntimeException($name); echo 'PASS '.$name."\n";};
$refuse=function($fn,$reason,$label)use($assert){try{$fn();}catch(RuntimeException $error){$assert($error->getMessage()===$reason,$label);return;}throw new RuntimeException('Expected refusal: '.$label);};
$source=function($id)use($store){return $store->source($id,'INBOX');};
$state=$source(1);$state['last_uid']=4;$store->checkpoint(1,'INBOX',$state);
$completed=$source(2);$completed['last_uid']=8;$completed['seeding']=false;$store->checkpoint(2,'INBOX',$completed);
$existing=['folder'=>'INBOX','uidvalidity'=>'9','UID'=>'4','retained_metadata'=>['original']];
$insert=$pdo->prepare('INSERT INTO mail_arrival_deferred VALUES (?,?,?)');
$existingKey=hash('sha256',"1\0INBOX:9:4");$existingBytes=json_encode($existing);$insert->execute([$existingKey,1,$existingBytes]);
$counts=MailArrivalEvidence\BaselineReconcile::apply($plan,$folders,$store,$remote);
$assert($counts===['matched_identities'=>3,'advanced_sources'=>2,'completed_sources_unchanged'=>1,'deferred_inserted'=>3,'deferred_retained'=>1],'PDO atomically queues unknown/draft work and advances only still-seeding sources');
$assert($source(1)['last_uid']===5&&$source(1)['seeding']===false&&$source(2)===$completed,'PDO checkpoints preserve completed newer source and reach original fence');
$q=$pdo->prepare('SELECT source FROM mail_arrival_deferred WHERE message_key=?');$q->execute([$existingKey]);$assert($q->fetchColumn()===$existingBytes,'PDO existing deferred JSON retained byte for byte');$q->closeCursor();
$assert((int)$pdo->query('SELECT COUNT(*) FROM mail_arrival_deferred')->fetchColumn()===4,'PDO deferred keys match Engine mailbox-folder-epoch-UID format');
$assert($pdo->query('SELECT version FROM mail_arrival_versions ORDER BY mailbox_id')->fetchAll(PDO::FETCH_COLUMN)===['42','42','42']||array_map('intval',$pdo->query('SELECT version FROM mail_arrival_versions ORDER BY mailbox_id')->fetchAll(PDO::FETCH_COLUMN))===[42,42,42],'PDO reconciliation does not bump mailbox versions');
$assert((int)$pdo->query('SELECT COUNT(*) FROM threads')->fetchColumn()===3&&(int)$pdo->query('SELECT COUNT(*) FROM conversations')->fetchColumn()===3&&(int)$pdo->query('SELECT COUNT(*) FROM mail_arrival_event_outbox')->fetchColumn()===1,'PDO conversation thread and event-outbox records remain untouched');
$before=$pdo->query('SELECT * FROM mail_arrival_sources ORDER BY mailbox_id')->fetchAll(PDO::FETCH_ASSOC);
$again=MailArrivalEvidence\BaselineReconcile::apply($plan,$folders,$store,$remote);
$assert($again['advanced_sources']===0&&$again['deferred_inserted']===0&&$pdo->query('SELECT * FROM mail_arrival_sources ORDER BY mailbox_id')->fetchAll(PDO::FETCH_ASSOC)===$before,'PDO rerun is idempotent and never regresses completed sources');
$key=hash('sha256',"1\0gmail:701");
$update=$pdo->prepare('UPDATE mail_arrival_messages SET target_thread_id=102 WHERE message_key=?');$update->execute([$key]);
$refuse(function()use($store,$matches){$store->transaction(function()use($store,$matches){$store->verifyMatches($matches);});},'MATCHED_LEDGER_MISMATCH','PDO mismatched new ledger target is rejected');
$update=$pdo->prepare('UPDATE mail_arrival_messages SET target_thread_id=101 WHERE message_key=?');$update->execute([$key]);
$pdo->exec('UPDATE threads SET conversation_id=2 WHERE id=101');
$refuse(function()use($store,$matches){$store->transaction(function()use($store,$matches){$store->verifyMatches($matches);});},'TARGET_SCOPE_MISMATCH','PDO native target mailbox change is rejected');
$pdo->exec('UPDATE threads SET conversation_id=1 WHERE id=101');
$pdo->exec("UPDATE fiveways_gmail_history SET target_thread_id=102 WHERE gmail_id='703'");
$refuse(function()use($store,$matches){$store->transaction(function()use($store,$matches){$store->verifyMatches($matches);});},'LEGACY_TARGET_MISMATCH','PDO legacy Gmail mapping change is rejected');
$pdo->exec("UPDATE fiveways_gmail_history SET target_thread_id=103 WHERE gmail_id='703'");
$before=$source(1);$count=(int)$pdo->query('SELECT COUNT(*) FROM mail_arrival_deferred')->fetchColumn();
$refuse(function()use($store,$before){$store->transaction(function()use($store,$before){$store->defer(1,['folder'=>'INBOX','uidvalidity'=>'9','UID'=>99]);$changed=$before;$changed['last_uid']=99;$store->checkpoint(1,'INBOX',$changed);throw new RuntimeException('SYNTHETIC_ROLLBACK');});},'SYNTHETIC_ROLLBACK','PDO injected failure after deferred and checkpoint writes is observed');
$assert($source(1)===$before&&(int)$pdo->query('SELECT COUNT(*) FROM mail_arrival_deferred')->fetchColumn()===$count,'PDO rollback removes all partial queue and checkpoint writes');
$q=$pdo->query("SELECT IS_FREE_LOCK('mail-arrival-1'),IS_FREE_LOCK('mail-arrival-2'),IS_FREE_LOCK('mail-arrival-3')");
$assert(array_map('intval',$q->fetch(PDO::FETCH_NUM))===[1,1,1],'PDO importer advisory locks released after reconciliation');$q->closeCursor();
