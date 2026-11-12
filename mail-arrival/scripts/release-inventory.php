<?php
/**
 * Bounded, metadata-only pre-cutover inventory. This file is preparation, not permission to run.
 * The JSON result contains provider identifiers and must be captured only in a private artifact.
 * No MIME bodies, subject, sender, raw Message-ID, credentials or OAuth tokens are emitted.
 * Existing MailHelper authentication may refresh an expired token under the authorised account scope.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(2); }
ini_set('display_errors','0'); ini_set('log_errors','0');
set_error_handler(function($severity,$message,$file,$line){if(!(error_reporting() & $severity))return false;throw new ErrorException('Inventory warning',0,$severity,$file,$line);});
$args=getopt('',['config:','expected-app-url:']);
$configPath=(string)($args['config']??'/data/mail-arrival/release-config.php');
$expectedUrl=rtrim((string)($args['expected-app-url']??''),'/');$url=parse_url($expectedUrl);
if(!$url||($url['scheme']??'')!=='https'||empty($url['host'])||isset($url['user'])||isset($url['pass'])||isset($url['query'])||isset($url['fragment'])){fwrite(STDERR,"Inventory stopped: APP_URL_INVALID\n");exit(2);}
$clients=[];
try {
    $real=realpath($configPath);$base=realpath('/data/mail-arrival');
    if(!$real||!$base||strpos($real,$base.'/')!==0||$real!==$configPath||!is_file($real)||!function_exists('posix_geteuid'))throw new RuntimeException('PRIVATE_CONFIG_PATH_INVALID');
    $stat=stat($real);if(($stat['mode']&0777)!==0600||(int)$stat['uid']!==posix_geteuid())throw new RuntimeException('PRIVATE_CONFIG_PERMISSIONS_INVALID');
    $private=require $real;if(!is_array($private))throw new RuntimeException('PRIVATE_CONFIG_INVALID');
    $scan=function($value)use(&$scan){if(!is_array($value))return;foreach($value as$key=>$item){if(is_string($key)&&preg_match('/password|secret|token|credential|api.?key/i',$key))throw new RuntimeException('PRIVATE_CONFIG_CONTAINS_CREDENTIAL_FIELD');$scan($item);}};$scan($private);
    chdir('/www/html');require 'vendor/autoload.php';$app=require 'bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    if(rtrim((string)config('app.url'),'/')!==$expectedUrl)throw new RuntimeException('APP_IDENTITY_MISMATCH');
    Config::set('mail_arrival',$private);Config::set('app.debug',false);Config::set('imap.options.debug',false);
    if (!class_exists(\Modules\MailArrival\DeploymentGuard::class, false)) require_once __DIR__.'/../src/Modules/MailArrival/Backend/DeploymentGuard.php';
    require_once __DIR__.'/../harness/live-inventory.php';
    if(\Modules\MailArrival\DeploymentGuard::local()||!\Modules\MailArrival\DeploymentGuard::allowed())throw new RuntimeException('DEPLOYMENT_SCOPE_UNAVAILABLE');
    $identityPins=config('mail_arrival.production.mailboxes',[]);$observers=[];$pdo=null;$lookupQuery=null;
    foreach([1,2,3] as $id){
        $mailbox=App\Mailbox::findOrFail($id);$expected=strtolower((string)($identityPins[$id]??''));
        $username=$mailbox->oauthEnabled()?$mailbox->getInOauthUsername():$mailbox->in_username;
        $folders=config('mail_arrival.mailboxes.'.$id.'.folders',[]);
        if(!\Modules\MailArrival\DeploymentGuard::matches($mailbox)||!filter_var($expected,FILTER_VALIDATE_EMAIL)||strtolower((string)$username)!==$expected||strtolower((string)$mailbox->in_server)!=='imap.gmail.com'||(int)$mailbox->in_port!==993||strtolower((string)$mailbox->getInProtocolName())!=='imap'||strtolower((string)$mailbox->getInEncryptionName())!=='ssl'||!$mailbox->in_validate_cert||!is_array($folders)||!$folders)throw new RuntimeException('MAILBOX_PROVIDER_SCOPE_MISMATCH');
        // Existing helper may refresh OAuth before the observation session becomes read-only.
        $client=MailHelper::getMailboxClient($mailbox);$clients[]=$client;
        if(strtolower((string)$client->host)!=='imap.gmail.com'||(int)$client->port!==993||strtolower((string)$client->username)!==$expected||strtolower((string)$client->encryption)!=='ssl'||!$client->validate_cert)throw new RuntimeException('CLIENT_SCOPE_MISMATCH');
        $client->connect();$observers[$id]=['protocol'=>$client->getConnection(),'folders'=>$folders];
    }
    $pdo=DB::connection()->getPdo();if($pdo->inTransaction())throw new RuntimeException('UNEXPECTED_ACTIVE_TRANSACTION');
    $pdo->exec('SET SESSION TRANSACTION READ ONLY');
    try{$readOnly=(int)$pdo->query('SELECT @@session.tx_read_only')->fetchColumn();}catch(Throwable $e){$readOnly=(int)$pdo->query('SELECT @@session.transaction_read_only')->fetchColumn();}
    if($readOnly!==1)throw new RuntimeException('READ_ONLY_SESSION_UNAVAILABLE');
    $lookup=function(int $mailboxId,array $items)use($pdo){
        $out=[];if(!$items)return$out;
        if($mailboxId===3){
            $ids=array_values(array_unique(array_column($items,'gmail_id')));$marks=implode(',',array_fill(0,count($ids),'?'));
            $q=$pdo->prepare("SELECT h.gmail_id,h.gmail_thread_id,h.target_thread_id,c.mailbox_id FROM fiveways_gmail_history h LEFT JOIN threads t ON t.id=h.target_thread_id LEFT JOIN conversations c ON c.id=t.conversation_id WHERE h.gmail_id IN ($marks)");$q->execute($ids);$found=[];
            while($r=$q->fetch(PDO::FETCH_ASSOC)){if((int)($r['mailbox_id']??0)!==3||(int)$r['target_thread_id']<1)throw new RuntimeException('LEGACY_TARGET_SCOPE_MISMATCH');$found[(string)$r['gmail_id']]=['thread_id'=>(int)$r['target_thread_id'],'gmail_thread_id'=>(string)$r['gmail_thread_id']];}$q->closeCursor();
            foreach($items as$item)if(isset($found[$item['gmail_id']])){if($found[$item['gmail_id']]['gmail_thread_id']!==$item['gmail_thread_id'])throw new RuntimeException('LEGACY_GROUP_SCOPE_MISMATCH');$out[$item['uid']]=$found[$item['gmail_id']]['thread_id'];}return$out;
        }
        $values=[];foreach($items as$item){if($item['message_id']!==null)$values[$item['message_id']]=true;if($item['generated_id']!==null)$values[$item['generated_id']]=true;}
        if(!$values)return$out;$keys=array_keys($values);$marks=implode(',',array_fill(0,count($keys),'?'));
        $q=$pdo->prepare("SELECT t.id,t.message_id FROM threads t JOIN conversations c ON c.id=t.conversation_id WHERE c.mailbox_id=? AND t.message_id IN ($marks)");$q->execute(array_merge([$mailboxId],$keys));$found=[];
        while($r=$q->fetch(PDO::FETCH_ASSOC))$found[$r['message_id']][]=(int)$r['id'];$q->closeCursor();
        foreach($items as$item){$hits=array_values(array_unique(array_merge($found[$item['message_id']]??[],$found[$item['generated_id']]??[])));if(count($hits)>1)throw new RuntimeException('NATIVE_MATCH_AMBIGUOUS');if($hits)$out[$item['uid']]=$hits[0];}
        return$out;
    };
    $generate=function(int $id,string $messageId){return MailHelper::generateMessageId($messageId,$id.$messageId);};
    $started=(int)floor(microtime(true)*1000);$floor=gmdate('Y-m-d',time()-3*86400);$plans=[];
    foreach($observers as$id=>$entry){$inventory=new MailArrivalEvidence\LiveInventory($entry['protocol'],$lookup,$generate,2500);$plans[]=$inventory->mailbox($id,$entry['folders'],$floor);}
    // Emit only after every folder passed its epoch check. Capture this JSON privately, not in public logs.
    echo json_encode(['schema'=>1,'started_ms'=>$started,'completed_ms'=>(int)floor(microtime(true)*1000),'floor_since_utc'=>$floor,'mailboxes'=>$plans],JSON_THROW_ON_ERROR)."\n";
} catch(Throwable $e) {
    $allowed=['PRIVATE_CONFIG_PATH_INVALID','PRIVATE_CONFIG_PERMISSIONS_INVALID','PRIVATE_CONFIG_INVALID','PRIVATE_CONFIG_CONTAINS_CREDENTIAL_FIELD','APP_IDENTITY_MISMATCH','DEPLOYMENT_SCOPE_UNAVAILABLE','MAILBOX_PROVIDER_SCOPE_MISMATCH','CLIENT_SCOPE_MISMATCH','UNEXPECTED_ACTIVE_TRANSACTION','READ_ONLY_SESSION_UNAVAILABLE','LEGACY_TARGET_SCOPE_MISMATCH','LEGACY_GROUP_SCOPE_MISMATCH','NATIVE_MATCH_AMBIGUOUS','INVENTORY_CAP_INVALID','INVENTORY_SCOPE_INVALID','FOLDER_SCOPE_INVALID','FOLDER_STATE_UNAVAILABLE','SOURCE_UID_INVALID','INVENTORY_CAP_EXCEEDED','SOURCE_METADATA_INCOMPLETE','MATCH_INVALID','CROSS_FOLDER_MATCH_CONFLICT','SOURCE_EPOCH_CHANGED'];
    $reason=in_array($e->getMessage(),$allowed,true)?$e->getMessage():'PROVIDER_OR_RUNTIME_FAILURE';
    fwrite(STDERR,'Inventory stopped: '.$reason."\n");exit(1);
} finally {foreach($clients as$client){try{$client->disconnect();}catch(Throwable $ignored){}}}
