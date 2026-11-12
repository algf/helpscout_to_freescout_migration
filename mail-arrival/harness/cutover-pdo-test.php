<?php
// Run only through the isolated-container guard. Temporary tables shadow local tables
// on this connection and disappear when it closes; no fixture rows are changed.
$pdo=DB::connection()->getPdo();$pdo->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
foreach([
 'CREATE TEMPORARY TABLE conversations (id INT PRIMARY KEY, mailbox_id INT NOT NULL) ENGINE=InnoDB',
 'CREATE TEMPORARY TABLE threads (id INT PRIMARY KEY, conversation_id INT NOT NULL) ENGINE=InnoDB',
 'CREATE TEMPORARY TABLE fiveways_gmail_history (gmail_id VARCHAR(32) PRIMARY KEY, target_thread_id INT NOT NULL) ENGINE=InnoDB',
 'CREATE TEMPORARY TABLE mail_arrival_messages (message_key VARCHAR(64) PRIMARY KEY, mailbox_id INT, identity VARCHAR(255), target_thread_id INT, sha256 VARCHAR(64), outcome VARCHAR(32), committed_at DATETIME) ENGINE=InnoDB',
 'CREATE TEMPORARY TABLE mail_arrival_sources (source_key VARCHAR(64) PRIMARY KEY, mailbox_id INT, state TEXT) ENGINE=InnoDB',
 'CREATE TEMPORARY TABLE mail_arrival_deferred (message_key VARCHAR(64) PRIMARY KEY) ENGINE=InnoDB'
] as $sql)$pdo->exec($sql);
$pdo->exec('INSERT INTO conversations VALUES (1,1),(2,2),(3,3)');
$pdo->exec('INSERT INTO threads VALUES (101,1),(102,2),(103,3)');
$pdo->exec("INSERT INTO fiveways_gmail_history VALUES ('703',103)");
$store=new MailArrivalEvidence\CutoverPdoStore($pdo);
$matches=[['mailbox_id'=>1,'gmail_id'=>'701','thread_id'=>101],['mailbox_id'=>2,'gmail_id'=>'702','thread_id'=>102],['mailbox_id'=>3,'gmail_id'=>'703','thread_id'=>103]];
$folders=[];$mailboxes=[];
foreach([1,2,3] as $id){$folders[$id]=['INBOX'];$mailboxes[]=['mailbox_id'=>$id,'folders'=>[['folder'=>'INBOX','uidvalidity'=>'9','high_uid'=>5,'floor_since'=>'2026-11-09','candidate_count'=>3,'matched'=>[$matches[$id-1]],'unknown_uids'=>[4],'draft_uids'=>[5]]]];}
$plan=['schema'=>1,'floor_since_utc'=>'2026-11-09','mailboxes'=>$mailboxes];
$count=MailArrivalEvidence\CutoverSeed::apply($plan,$folders,$store,function(){return ['uidvalidity'=>'9','uidnext'=>6];});
$assert=function($ok,$name){if(!$ok)throw new RuntimeException('FAILED: '.$name);echo 'PASS '.$name."\n";};
$assert($count['matched_identities']===3&&$count['unknown_count']===3&&$count['draft_count']===3,'seed counts');
$rows=$pdo->query('SELECT * FROM mail_arrival_messages ORDER BY mailbox_id')->fetchAll(PDO::FETCH_ASSOC);
$assert(count($rows)===3&&$rows[0]['message_key']===hash('sha256',"1\0gmail:701")&&$rows[0]['outcome']==='matched'&&$rows[0]['sha256']===null,'native message ledger format');
$sources=$pdo->query('SELECT * FROM mail_arrival_sources ORDER BY mailbox_id')->fetchAll(PDO::FETCH_ASSOC);$state=json_decode($sources[0]['state'],true);
$assert(count($sources)===3&&$sources[0]['source_key']===hash('sha256',"1\0INBOX")&&$state===['uidvalidity'=>'9','last_uid'=>0,'seed_since'=>'2026-11-09','seed_high_uid'=>5,'seeding'=>true],'source checkpoint format');
try{$store->transaction(function()use($store){$store->insertMatch(['mailbox_id'=>1,'gmail_id'=>'799','thread_id'=>101]);throw new RuntimeException('injected');});}catch(RuntimeException $e){if($e->getMessage()!=='injected')throw $e;}
$assert((int)$pdo->query('SELECT COUNT(*) FROM mail_arrival_messages')->fetchColumn()===3,'PDO rollback removes partial write');
try{$store->verifyTargets([['mailbox_id'=>3,'gmail_id'=>'703','thread_id'=>102]],true);throw new RuntimeException('not rejected');}catch(RuntimeException $e){$assert($e->getMessage()==='TARGET_SCOPE_MISMATCH','target mailbox revalidated');}
try{$store->verifyTargets([['mailbox_id'=>3,'gmail_id'=>'799','thread_id'=>103]],true);throw new RuntimeException('not rejected');}catch(RuntimeException $e){$assert($e->getMessage()==='LEGACY_TARGET_MISMATCH','Fiveways legacy mapping revalidated');}
$assert(!$store->empty(),'occupied tables detected');
