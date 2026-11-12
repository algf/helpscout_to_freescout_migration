<?php
namespace MailArrivalEvidence;

/** Read-only bounded metadata inventory; callers must enforce deployment/account pins. */
final class LiveInventory
{
    private $protocol; private $lookup; private $generate; private $cap;
    public function __construct($protocol, callable $lookup, callable $generate, int $cap = 2500)
    {
        if ($cap < 1 || $cap > 2500) throw new \RuntimeException('INVENTORY_CAP_INVALID');
        $this->protocol=$protocol; $this->lookup=$lookup; $this->generate=$generate; $this->cap=$cap;
    }
    private function state(string $folder): array
    {
        $s=$this->protocol->examineFolder($folder);
        if (!is_array($s) || empty($s['uidvalidity']) || !isset($s['uidnext']) || (int)$s['uidnext']<1) throw new \RuntimeException('FOLDER_STATE_UNAVAILABLE');
        return ['uidvalidity'=>(string)$s['uidvalidity'],'uidnext'=>(int)$s['uidnext']];
    }
    private static function messageId(string $header): ?string
    {
        $unfolded=preg_replace('/\r?\n[ \t]+/', ' ', $header);
        preg_match_all('/^Message-ID[ \t]*:[ \t]*([^\r\n]*)/mi', $unfolded, $matches);
        if (count($matches[1])!==1) return null;
        $id=trim($matches[1][0], " \t<>");
        // Ambiguous headers remain unknown; they are never skipped as already imported.
        return strlen($id)<=255 && preg_match('/^[^\s<>@]+@[^\s<>@]+$/', $id) ? $id : null;
    }
    public function mailbox(int $id, array $folders, string $floor): array
    {
        if (!in_array($id,[1,2,3],true) || !$folders || count($folders)>5 || count(array_unique($folders))!==count($folders) || !preg_match('/^\d{4}-\d{2}-\d{2}$/',$floor) || !strtotime($floor.' UTC')) throw new \RuntimeException('INVENTORY_SCOPE_INVALID');
        $plans=[]; $known=[];
        foreach ($folders as $folder) {
            if (!is_string($folder) || $folder==='' || strlen($folder)>255 || preg_match('/[\x00-\x1f\x7f]/',$folder)) throw new \RuntimeException('FOLDER_SCOPE_INVALID');
            $initial=$this->state($folder); $high=$initial['uidnext']-1;
            $uids=$high>0?$this->protocol->search(['UID','1:'.$high,'SINCE',gmdate('d-M-Y',strtotime($floor.' UTC'))]):[];
            if (!is_array($uids)) throw new \RuntimeException('SOURCE_UID_INVALID');
            foreach($uids as $uid) if(!ctype_digit((string)$uid)||(int)$uid<1||(int)$uid>$high) throw new \RuntimeException('SOURCE_UID_INVALID');
            $uids=array_map('intval',$uids);if(count(array_unique($uids))!==count($uids))throw new \RuntimeException('SOURCE_UID_INVALID');sort($uids,SORT_NUMERIC);
            if (count($uids)>$this->cap) throw new \RuntimeException('INVENTORY_CAP_EXCEEDED');
            $plan=['folder'=>$folder,'uidvalidity'=>$initial['uidvalidity'],'high_uid'=>$high,'floor_since'=>$floor,'candidate_count'=>count($uids),'matched'=>[],'unknown_uids'=>[],'draft_uids'=>[]];
            foreach (array_chunk($uids,50) as $batch) {
                $rows=$this->protocol->fetch(['UID','INTERNALDATE','FLAGS','X-GM-MSGID','X-GM-THRID','X-GM-LABELS','BODY.PEEK[HEADER]'],$batch);
                $items=[];
                foreach($batch as $uid){
                    $row=$rows[$uid]??null;
                    if(!$row||(int)($row['UID']??0)!==$uid||(!ctype_digit((string)($row['X-GM-MSGID']??''))||(string)$row['X-GM-MSGID']==='0'||strlen((string)$row['X-GM-MSGID'])>20||!ctype_digit((string)($row['X-GM-THRID']??''))||(string)$row['X-GM-THRID']==='0'||strlen((string)$row['X-GM-THRID'])>20)||!preg_match('/^\d{1,2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/',(string)($row['INTERNALDATE']??''))||!is_array($row['FLAGS']??null)||!is_array($row['X-GM-LABELS']??null)||!is_string($row['BODY[HEADER]']??null))throw new \RuntimeException('SOURCE_METADATA_INCOMPLETE');
                    $flags=array_map(function($x){return strtolower(ltrim((string)$x,'\\'));},$row['FLAGS']);
                    $labels=array_map(function($x){return strtolower(ltrim((string)$x,'\\'));},$row['X-GM-LABELS']);
                    if(in_array('draft',$flags,true)||in_array('draft',$labels,true)){$plan['draft_uids'][]=$uid;continue;}
                    $mid=self::messageId($row['BODY[HEADER]']);
                    $items[]=['uid'=>$uid,'gmail_id'=>(string)$row['X-GM-MSGID'],'gmail_thread_id'=>(string)$row['X-GM-THRID'],'message_id'=>$mid,'generated_id'=>$mid===null?null:($this->generate)($id,$mid)];
                }
                $matches=($this->lookup)($id,$items);
                foreach($items as $item){
                    $thread=$matches[$item['uid']]??null;
                    if($thread!==null){if(!is_int($thread)||$thread<1)throw new \RuntimeException('MATCH_INVALID');if(isset($known[$item['gmail_id']])&&$known[$item['gmail_id']]!==$thread)throw new \RuntimeException('CROSS_FOLDER_MATCH_CONFLICT');$known[$item['gmail_id']]=$thread;$plan['matched'][]=['gmail_id'=>$item['gmail_id'],'thread_id'=>$thread];}
                    else $plan['unknown_uids'][]=$item['uid'];
                }
            }
            $after=$this->state($folder);
            if($after['uidvalidity']!==$initial['uidvalidity']||$after['uidnext']<$initial['uidnext'])throw new \RuntimeException('SOURCE_EPOCH_CHANGED');
            $plans[]=$plan;
        }
        // Recheck every folder after the whole mailbox scan; cutover must fence again before seeding.
        foreach($plans as $plan){$latest=$this->state($plan['folder']);if($latest['uidvalidity']!==$plan['uidvalidity']||$latest['uidnext']<$plan['high_uid']+1)throw new \RuntimeException('SOURCE_EPOCH_CHANGED');}
        return ['mailbox_id'=>$id,'folders'=>$plans];
    }
}
