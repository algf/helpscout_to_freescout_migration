<?php
namespace MailArrivalEvidence;
/** One PDO holds locks, validation and the atomic seed. Does not touch mail content or versions. */
final class CutoverPdoStore
{
    private $pdo;
    public function __construct(\PDO $pdo) {$this->pdo=$pdo;}
    public function lock(int $id): bool {$q=$this->pdo->prepare('SELECT GET_LOCK(?,0)');$q->execute(['mail-arrival-'.$id]);$value=$q->fetchColumn();$q->closeCursor();return (int)$value===1;}
    public function unlock(int $id): void {$q=$this->pdo->prepare('SELECT RELEASE_LOCK(?)');$q->execute(['mail-arrival-'.$id]);$q->closeCursor();}
    public function empty(): bool {foreach(['mail_arrival_messages','mail_arrival_sources','mail_arrival_deferred']as$table)if((int)$this->pdo->query('SELECT COUNT(*) FROM '.$table)->fetchColumn()!==0)return false;return true;}
    public function verifyTargets(array $matches, bool $lock=false): void
    {
        $threads=[];$legacy=[];
        foreach($matches as$m){if(isset($threads[$m['thread_id']])&&$threads[$m['thread_id']]!==$m['mailbox_id'])throw new \RuntimeException('TARGET_SCOPE_MISMATCH');$threads[$m['thread_id']]=$m['mailbox_id'];if($m['mailbox_id']===3)$legacy[$m['gmail_id']]=$m['thread_id'];}
        foreach(array_chunk(array_keys($threads),100)as$ids){$marks=implode(',',array_fill(0,count($ids),'?'));$sql="SELECT t.id,c.mailbox_id FROM threads t JOIN conversations c ON c.id=t.conversation_id WHERE t.id IN ($marks)".($lock?' FOR UPDATE':'');$q=$this->pdo->prepare($sql);$q->execute($ids);$found=[];while($r=$q->fetch(\PDO::FETCH_ASSOC))$found[(int)$r['id']]=(int)$r['mailbox_id'];$q->closeCursor();foreach($ids as$id)if(($found[$id]??null)!==$threads[$id])throw new \RuntimeException('TARGET_SCOPE_MISMATCH');}
        foreach(array_chunk(array_keys($legacy),100)as$ids){$marks=implode(',',array_fill(0,count($ids),'?'));$sql="SELECT gmail_id,target_thread_id FROM fiveways_gmail_history WHERE gmail_id IN ($marks)".($lock?' FOR UPDATE':'');$q=$this->pdo->prepare($sql);$q->execute($ids);$found=[];while($r=$q->fetch(\PDO::FETCH_ASSOC))$found[(string)$r['gmail_id']]=(int)$r['target_thread_id'];$q->closeCursor();foreach($ids as$id)if(($found[$id]??null)!==$legacy[$id])throw new \RuntimeException('LEGACY_TARGET_MISMATCH');}
    }
    public function transaction(callable $fn): void
    {
        if($this->pdo->inTransaction())throw new \RuntimeException('UNEXPECTED_ACTIVE_TRANSACTION');
        $this->pdo->beginTransaction();try{$fn();$this->pdo->commit();}catch(\Throwable $e){if($this->pdo->inTransaction())$this->pdo->rollBack();throw$e;}
    }
    public function insertMatch(array $m): void
    {
        $identity='gmail:'.$m['gmail_id'];$key=hash('sha256',$m['mailbox_id']."\0".$identity);
        $q=$this->pdo->prepare('INSERT INTO mail_arrival_messages (message_key,mailbox_id,identity,target_thread_id,sha256,outcome,committed_at) VALUES (?,?,?,?,NULL,?,?)');
        $q->execute([$key,$m['mailbox_id'],$identity,$m['thread_id'],'matched',gmdate('Y-m-d H:i:s')]);
    }
    public function insertSource(array $s): void
    {
        $key=hash('sha256',$s['mailbox_id']."\0".$s['folder']);$value=['uidvalidity'=>$s['uidvalidity'],'last_uid'=>0,'seed_since'=>$s['floor'],'seed_high_uid'=>$s['high_uid'],'seeding'=>true];
        $q=$this->pdo->prepare('INSERT INTO mail_arrival_sources (source_key,mailbox_id,state) VALUES (?,?,?)');$q->execute([$key,$s['mailbox_id'],json_encode($value,JSON_THROW_ON_ERROR)]);
    }
}
