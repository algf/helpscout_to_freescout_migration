<?php
// Local synthetic IMAP only. A run requires guarded container startup and explicit fixture scope.
if (PHP_SAPI !== 'cli') throw new RuntimeException('CLI only');
chdir('/www/html'); require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (config('app.url') !== 'http://localhost:53927') throw new RuntimeException('Isolated local URL required');
$id=(int)($argv[1]??0);if(!in_array($id,[1,2,3],true))throw new RuntimeException('Synthetic mailbox ID required');
require_once '/data/Modules/MailArrival/bootstrap.php';
\Config::set('queue.default','database'); // Test jobs stay queued; no worker or outbound delivery.
\Config::set('mail_arrival.pause_dir', '/tmp/mail-arrival-'.($argv[3]??'invalid'));
if (!preg_match('/^[a-z0-9-]{8,40}$/', $argv[3]??'')) throw new RuntimeException('Synthetic run ID required');
\Config::set('mail_arrival.enabled',true);\Config::set('mail_arrival.mailbox_ids',[1,2,3]);
// Fixture scope must be explicitly supplied through the backend's local-only guard.
$mailbox=\App\Mailbox::findOrFail($id);
$access=$mailbox->usersHavingAccess()->pluck('email')->all();sort($access);
\Config::set('mail_arrival.fixture_scope.'.$id,['email'=>$mailbox->email,'owner_email'=>\App\User::findOrFail(1)->email,'allowed_users'=>$access]);
// Local-only synthetic identity: it never changes the saved mailbox or production policy.
\Config::set('mail_arrival.fiveways',['team_domain'=>'arrival.invalid','people'=>['fixture'=>['fixture-team@arrival.invalid']],'label_people'=>['Fixture team'=>'fixture']]);
$settings=config('imap');$settings['accounts']['fixture']=['host'=>'127.0.0.1','port'=>11430,'encryption'=>false,'validate_cert'=>false,'username'=>'fixture-'.$id,'password'=>'synthetic-only','protocol'=>'imap'];
$client=(new \Webklex\PHPIMAP\ClientManager($settings))->account('fixture');
$provider=new \Modules\MailArrival\ImapProvider($client,true);$events=[];$beforeEvents=[];$faultIdentity=getenv('MAIL_ARRIVAL_FIXTURE_FAULT_IDENTITY')?:null;
if($faultIdentity!==null&&!preg_match('/^gmail:[0-9]+$/',$faultIdentity))throw new RuntimeException('Invalid synthetic fault identity');
$options=['folders'=>['INBOX'],'initial_since'=>gmdate('Y-m-d',time()-3*86400),'initial_max_messages'=>100,'batch_size'=>25,'before_commit'=>function($mailbox,$identity,$at)use(&$beforeEvents,$faultIdentity){$beforeEvents[]=['mailbox'=>(int)$mailbox,'identity'=>$identity,'observed_before_commit'=>(float)$at];if($faultIdentity!==null&&$identity===$faultIdentity)throw new RuntimeException('Synthetic pre-commit fault');},'after_commit'=>function($mailbox,$identity,$at)use(&$events){$events[]=['mailbox'=>(int)$mailbox,'identity'=>$identity,'observed_after_commit'=>(float)$at];}];
// Folder scenario keeps actual Gmail folder defaults and explicitly models Crockd's two source folders.
if (($argv[2]??'')==='folders') {
    if ($id===3) unset($options['folders']);
    elseif ($id===2) $options['folders']=['INBOX','FreeScout-Crockd-Pilot'];
    else throw new RuntimeException('Folder scenario applies to mailboxes 2 and 3 only');
}
$started=microtime(true);
try {$result=\Modules\MailArrival\Runtime::poll($id,$options,$provider);echo json_encode(['ok'=>true,'poll_started_at'=>$started,'poll_returned_at'=>microtime(true),'result'=>$result,'before_commit'=>$beforeEvents,'after_commit'=>$events],JSON_THROW_ON_ERROR);}
catch (\Throwable $e) {
 $frames=[];foreach($e->getTrace() as $frame){$frames[]=['file'=>$frame['file']??null,'line'=>$frame['line']??null,'class'=>$frame['class']??null,'function'=>$frame['function']??null];if(count($frames)>=24)break;}
 echo json_encode(['ok'=>false,'poll_started_at'=>$started,'poll_returned_at'=>microtime(true),'error'=>get_class($e).': '.$e->getMessage(),'error_site'=>['file'=>$e->getFile(),'line'=>$e->getLine()],'frames'=>$frames,'transaction_level'=>\DB::transactionLevel(),'before_commit'=>$beforeEvents,'after_commit'=>$events],JSON_THROW_ON_ERROR);exit(1);
}
