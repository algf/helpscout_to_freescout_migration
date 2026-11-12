<?php
namespace MailArrivalEvidence;
/** Bounded inventory seeding; caller owns the release barrier and injected store/provider guards. */
final class CutoverSeed
{
    public static function apply(array $plan, array $configuredFolders, $store, callable $state): array
    {
        if (($plan['schema'] ?? null)!==1 || !preg_match('/^\d{4}-\d{2}-\d{2}$/',(string)($plan['floor_since_utc']??'')) || empty($plan['mailboxes']) || count($plan['mailboxes'])!==3) throw new \RuntimeException('PLAN_INVALID');
        $floor=$plan['floor_since_utc'];$date=\DateTimeImmutable::createFromFormat('!Y-m-d',$floor,new \DateTimeZone('UTC'));if(!$date||$date->format('Y-m-d')!==$floor)throw new \RuntimeException('PLAN_INVALID');$sources=[];$matched=[];$seenMailboxes=[];
        foreach($plan['mailboxes'] as $mailbox){
            $id=$mailbox['mailbox_id']??null;
            if(!is_int($id)||!in_array($id,[1,2,3],true)||isset($seenMailboxes[$id])||!is_array($mailbox['folders']??null)||!is_array($configuredFolders[$id]??null))throw new \RuntimeException('PLAN_MAILBOX_INVALID');
            $seenMailboxes[$id]=true;$expected=$configuredFolders[$id];$actual=array_column($mailbox['folders'],'folder');
            if(!$expected||count($expected)>5||count(array_unique($expected))!==count($expected)||count(array_unique($actual))!==count($actual)||count($actual)!==count($expected)||array_diff($actual,$expected)||array_diff($expected,$actual))throw new \RuntimeException('PLAN_FOLDER_SCOPE_MISMATCH');
            foreach($mailbox['folders'] as $f){
                $name=$f['folder']??null;$validity=$f['uidvalidity']??null;$high=$f['high_uid']??null;$count=$f['candidate_count']??null;
                if(!is_string($name)||$name===''||strlen($name)>255||preg_match('/[\x00-\x1f\x7f]/',$name)||!is_string($validity)||!ctype_digit($validity)||(int)$validity<1||!is_int($high)||$high<0||!is_int($count)||$count<0||$count>2500||($f['floor_since']??null)!==$floor||!is_array($f['matched']??null)||!is_array($f['unknown_uids']??null)||!is_array($f['draft_uids']??null)||count($f['matched'])+count($f['unknown_uids'])+count($f['draft_uids'])!==$count)throw new \RuntimeException('PLAN_FOLDER_INVALID');
                $observed=[];foreach(array_merge($f['unknown_uids'],$f['draft_uids'])as$uid){if(!is_int($uid)||$uid<1||$uid>$high||isset($observed[$uid]))throw new \RuntimeException('PLAN_UID_INVALID');$observed[$uid]=true;}
                $folderGmail=[];foreach($f['matched'] as $record){$gmail=$record['gmail_id']??null;$thread=$record['thread_id']??null;if(!is_string($gmail)||!ctype_digit($gmail)||$gmail==='0'||strlen($gmail)>20||!is_int($thread)||$thread<1||isset($folderGmail[$gmail]))throw new \RuntimeException('PLAN_MATCH_INVALID');$folderGmail[$gmail]=true;$key=$id."\0".$gmail;if(isset($matched[$key])&&$matched[$key]['thread_id']!==$thread)throw new \RuntimeException('PLAN_MATCH_CONFLICT');$matched[$key]=['mailbox_id'=>$id,'gmail_id'=>$gmail,'thread_id'=>$thread];}
                $sources[]=['mailbox_id'=>$id,'folder'=>$name,'uidvalidity'=>$validity,'high_uid'=>$high,'floor'=>$floor,'candidate_count'=>$count,'unknown_count'=>count($f['unknown_uids']),'draft_count'=>count($f['draft_uids'])];
            }
        }
        if(count($seenMailboxes)!==3)throw new \RuntimeException('PLAN_MAILBOX_INVALID');
        $held=[];
        try {
            foreach([1,2,3]as$id){if(!$store->lock($id))throw new \RuntimeException('IMPORTER_LOCK_UNAVAILABLE');$held[]=$id;}
            if(!$store->empty())throw new \RuntimeException('SEED_TABLES_NOT_EMPTY');
            $verifyEpoch=function()use($sources,$state){foreach($sources as$s){$current=$state($s['mailbox_id'],$s['folder']);if(!is_array($current)||(string)($current['uidvalidity']??'')!==$s['uidvalidity']||!isset($current['uidnext'])||(int)$current['uidnext']<$s['high_uid']+1)throw new \RuntimeException('SOURCE_EPOCH_CHANGED');}};
            $verifyEpoch();$store->verifyTargets(array_values($matched));$verifyEpoch();
            $store->transaction(function()use($store,$sources,$matched){
                if(!$store->empty())throw new \RuntimeException('SEED_TABLES_NOT_EMPTY');
                $store->verifyTargets(array_values($matched),true);
                foreach($matched as$m)$store->insertMatch($m);
                foreach($sources as$s)$store->insertSource($s);
            });
            return ['mailboxes'=>3,'folders'=>count($sources),'matched_identities'=>count($matched),'candidate_count'=>array_sum(array_column($sources,'candidate_count')),'unknown_count'=>array_sum(array_column($sources,'unknown_count')),'draft_count'=>array_sum(array_column($sources,'draft_count'))];
        } finally {foreach(array_reverse($held)as$id)$store->unlock($id);}
    }
}
