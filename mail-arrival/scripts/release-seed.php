<?php
/**
 * Guarded initial ledger/source seed. The operator MUST stop all legacy and current
 * runners and hold the ownership barrier before invoking this command. Importer advisory
 * locks alone do not fence legacy workers. This script performs no mail or conversation mutation.
 */
if(PHP_SAPI!=='cli'){http_response_code(404);exit(2);}ini_set('display_errors','0');ini_set('log_errors','0');
set_error_handler(function($severity,$message,$file,$line){if(!(error_reporting()&$severity))return false;throw new ErrorException('Seed warning',0,$severity,$file,$line);});
$args=getopt('',['expected-app-url:','config:','inventory:','inventory-sha256:','ownership-barrier-confirmed']);
$url=rtrim((string)($args['expected-app-url']??''),'/');$parts=parse_url($url);$sha=strtolower((string)($args['inventory-sha256']??''));
if(!$parts||($parts['scheme']??'')!=='https'||empty($parts['host'])||isset($parts['user'])||isset($parts['pass'])||isset($parts['query'])||isset($parts['fragment'])||!preg_match('/^[a-f0-9]{64}$/',$sha)||!array_key_exists('ownership-barrier-confirmed',$args)){fwrite(STDERR,"Seed stopped: ARGUMENTS_INVALID\n");exit(2);}
$clients=[];$exitCode=0;
try {
    $privateFile=function($path){$base=realpath('/data/mail-arrival');$real=realpath($path);if(!$base||!$real||$real!==$path||strpos($real,$base.'/')!==0||!is_file($real)||!function_exists('posix_geteuid'))throw new RuntimeException('PRIVATE_FILE_PATH_INVALID');$stat=stat($real);if(($stat['mode']&0777)!==0600||(int)$stat['uid']!==posix_geteuid())throw new RuntimeException('PRIVATE_FILE_PERMISSIONS_INVALID');return$real;};
    $configFile=$privateFile((string)($args['config']??''));$inventoryFile=$privateFile((string)($args['inventory']??''));
    if(filesize($inventoryFile)>16*1024*1024)throw new RuntimeException('INVENTORY_TOO_LARGE');
    $bytes=file_get_contents($inventoryFile);if($bytes===false||!hash_equals($sha,hash('sha256',$bytes)))throw new RuntimeException('INVENTORY_HASH_MISMATCH');
    $plan=json_decode($bytes,true,64,JSON_THROW_ON_ERROR);if(!is_array($plan))throw new RuntimeException('PLAN_INVALID');
    $private=require $configFile;if(!is_array($private))throw new RuntimeException('PRIVATE_CONFIG_INVALID');
    $scan=function($value)use(&$scan){if(!is_array($value))return;foreach($value as$key=>$item){if(is_string($key)&&preg_match('/password|secret|token|credential|api.?key/i',$key))throw new RuntimeException('PRIVATE_CONFIG_CONTAINS_CREDENTIAL_FIELD');$scan($item);}};$scan($private);
    chdir('/www/html');require 'vendor/autoload.php';$app=require 'bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    if(rtrim((string)config('app.url'),'/')!==$url)throw new RuntimeException('APP_IDENTITY_MISMATCH');
    Config::set('mail_arrival',$private);Config::set('app.debug',false);Config::set('imap.options.debug',false);
    if (!class_exists(\Modules\MailArrival\DeploymentGuard::class, false)) require_once __DIR__.'/../src/Modules/MailArrival/Backend/DeploymentGuard.php';require_once __DIR__.'/../harness/cutover-seed.php';require_once __DIR__.'/../harness/cutover-pdo-store.php';
    if(\Modules\MailArrival\DeploymentGuard::local()||!\Modules\MailArrival\DeploymentGuard::allowed())throw new RuntimeException('DEPLOYMENT_SCOPE_UNAVAILABLE');
    $identityPins=config('mail_arrival.production.mailboxes',[]);$protocols=[];$folders=[];
    foreach([1,2,3]as$id){
        $mailbox=App\Mailbox::findOrFail($id);$expected=strtolower((string)($identityPins[$id]??''));$username=$mailbox->oauthEnabled()?$mailbox->getInOauthUsername():$mailbox->in_username;$configured=config('mail_arrival.mailboxes.'.$id.'.folders',[]);
        if(!\Modules\MailArrival\DeploymentGuard::matches($mailbox)||!filter_var($expected,FILTER_VALIDATE_EMAIL)||strtolower((string)$username)!==$expected||strtolower((string)$mailbox->in_server)!=='imap.gmail.com'||(int)$mailbox->in_port!==993||strtolower((string)$mailbox->getInProtocolName())!=='imap'||strtolower((string)$mailbox->getInEncryptionName())!=='ssl'||!$mailbox->in_validate_cert||!is_array($configured)||!$configured)throw new RuntimeException('MAILBOX_PROVIDER_SCOPE_MISMATCH');
        // Existing authentication may refresh an expired token under the authorised account scope.
        $client=MailHelper::getMailboxClient($mailbox);$clients[]=$client;
        if(strtolower((string)$client->host)!=='imap.gmail.com'||(int)$client->port!==993||strtolower((string)$client->username)!==$expected||strtolower((string)$client->encryption)!=='ssl'||!$client->validate_cert)throw new RuntimeException('CLIENT_SCOPE_MISMATCH');
        $client->connect();$protocols[$id]=$client->getConnection();$folders[$id]=$configured;
    }
    $pdo=DB::connection()->getPdo();$pdo->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);if($pdo->inTransaction())throw new RuntimeException('UNEXPECTED_ACTIVE_TRANSACTION');
    $store=new MailArrivalEvidence\CutoverPdoStore($pdo);
    $state=function($id,$folder)use($protocols){$s=$protocols[$id]->examineFolder($folder);if(!is_array($s)||empty($s['uidvalidity'])||!isset($s['uidnext']))throw new RuntimeException('SOURCE_EPOCH_CHANGED');return$s;};
    $counts=MailArrivalEvidence\CutoverSeed::apply($plan,$folders,$store,$state);
    // Counts only: no addresses, message identities, UIDs, headers, credentials or plan contents.
    echo json_encode(['status'=>'seeded','counts'=>$counts],JSON_THROW_ON_ERROR)."\n";
} catch(Throwable $e){
    $allowed=['PRIVATE_FILE_PATH_INVALID','PRIVATE_FILE_PERMISSIONS_INVALID','INVENTORY_TOO_LARGE','INVENTORY_HASH_MISMATCH','PRIVATE_CONFIG_INVALID','PRIVATE_CONFIG_CONTAINS_CREDENTIAL_FIELD','APP_IDENTITY_MISMATCH','DEPLOYMENT_SCOPE_UNAVAILABLE','MAILBOX_PROVIDER_SCOPE_MISMATCH','CLIENT_SCOPE_MISMATCH','UNEXPECTED_ACTIVE_TRANSACTION','PLAN_INVALID','PLAN_MAILBOX_INVALID','PLAN_FOLDER_SCOPE_MISMATCH','PLAN_FOLDER_INVALID','PLAN_UID_INVALID','PLAN_MATCH_INVALID','PLAN_MATCH_CONFLICT','IMPORTER_LOCK_UNAVAILABLE','SEED_TABLES_NOT_EMPTY','SOURCE_EPOCH_CHANGED','TARGET_SCOPE_MISMATCH','LEGACY_TARGET_MISMATCH'];
    fwrite(STDERR,'Seed stopped: '.(in_array($e->getMessage(),$allowed,true)?$e->getMessage():'PROVIDER_OR_RUNTIME_FAILURE')."\n");$exitCode=1;
} finally {foreach($clients as$client){try{$client->disconnect();}catch(Throwable $ignored){}}}
exit($exitCode);
