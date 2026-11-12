<?php
namespace Illuminate\Events {class Dispatcher {}}
namespace TorMorten\Eventy {class Events {}}
namespace App {
    class Mailbox {
        public static $mailboxes = [];
        public $id, $email, $enabled = true;
        public function __construct($id, $email) {$this->id=$id; $this->email=$email;}
        public static function findOrFail($id) {
            if (!isset(self::$mailboxes[$id])) {throw new \RuntimeException('Missing mailbox');}
            return self::$mailboxes[$id];
        }
        public function isInActive() {return $this->enabled;}
    }
}
namespace {
class Schema {
    public static $checks=0;
    public static function hasTable($table) {self::$checks++; return false;}
}
$identities=[1=>'personal@example.invalid',2=>'support@example.invalid',3=>'team@example.invalid'];
$settings=[
    'app.url'=>'http://localhost:53927',
    'mail_arrival.enabled'=>true,
    'mail_arrival.mailbox_ids'=>[1,2,3],
    'mail_arrival.mailbox_identities'=>$identities,
    'mail_arrival.pause_dir'=>sys_get_temp_dir().'/mail-arrival-guards-'.getmypid()
];
function config($key,$fallback=null) {global $settings; return $settings[$key]??$fallback;}
require_once $argv[1].'/Backend/Version.php';
require_once $argv[1].'/Backend/DeploymentGuard.php';
require_once $argv[1].'/Backend/Installer.php';
require_once $argv[1].'/Backend/Runtime.php';
function check($ok,$label) {if(!$ok)throw new RuntimeException($label); echo "PASS $label\n";}
function failure($fn,$message,$label) {
    try {$fn();} catch (RuntimeException $error) {check($error->getMessage()===$message,$label); return;}
    throw new RuntimeException('Expected failure: '.$label);
}
foreach ($identities as $id=>$email) {\App\Mailbox::$mailboxes[$id]=new \App\Mailbox($id,$email);}
$mailbox=\App\Mailbox::$mailboxes[1];
$provider=new class {public $connections=0; public function connect() {$this->connections++;}};
$mailbox->enabled=false;
$result=\Modules\MailArrival\Runtime::poll(1,[],$provider);
check($result['status']==='disabled'&&$provider->connections===0,'native disabled mailbox cannot connect or import');
$mailbox->enabled=true;
mkdir($settings['mail_arrival.pause_dir']);
$marker=$settings['mail_arrival.pause_dir'].'/mailbox-1-sync.paused';
file_put_contents($marker,'test-owned');
try {
    $result=\Modules\MailArrival\Runtime::poll(1,[],$provider);
    check($result['status']==='paused'&&$provider->connections===0,'owner pause marker cannot be bypassed by injected provider');
} finally {unlink($marker); rmdir($settings['mail_arrival.pause_dir']);}
$refusal='Importer requires explicitly enabled approved CLI mailbox';
$settings['mail_arrival.enabled']=false;
failure(function()use($provider){\Modules\MailArrival\Runtime::poll(1,[],$provider);},$refusal,'module activation alone does not enable importing');
$settings['mail_arrival.enabled']=true;
$settings['app.url']='https://mail.example.invalid';
failure(function(){\Modules\MailArrival\Runtime::poll(1);},$refusal,'production URL without explicit production opt-in is refused');
$settings['mail_arrival.production.enabled']=true;
$settings['mail_arrival.production.app_url']='https://mail.example.invalid';
$settings['mail_arrival.production.mailboxes']=$identities;
check(\Modules\MailArrival\DeploymentGuard::allowed(),'exact HTTPS application and private identity pins permit production');
check(\Modules\MailArrival\Runtime::enrolled(1,$mailbox),'matching production mailbox is enrolled');
$mailbox->enabled=false;
$result=\Modules\MailArrival\Runtime::poll(1);
check($result['status']==='disabled','production respects native disabled mailbox before provider creation');
failure(function()use($provider){\Modules\MailArrival\Runtime::poll(1,[],$provider);},'Provider injection requires local deployment','production refuses injected provider before any import');
$settings['mail_arrival.enabled']=false;
\Modules\MailArrival\DeploymentGuard::assertInstall();
check(true,'production schema preparation can run while importing stays disabled');
check(!\Modules\MailArrival\Runtime::enrolled(1,$mailbox),'disabled importer does not suppress legacy fetch');
$settings['mail_arrival.enabled']=true;
$mailbox->email='wrong@example.invalid';
check(!\Modules\MailArrival\Runtime::enrolled(1,$mailbox),'identity mismatch leaves legacy fetch active');
$schemaBefore=Schema::$checks;
failure(function(){\Modules\MailArrival\Installer::install();},'Mailbox identity mismatch','installer validates saved identities before schema changes');
check(Schema::$checks===$schemaBefore,'refused installer does not inspect or mutate schema');
$mailbox->email=$identities[1];
foreach ([
    ['app.url','https://other.example.invalid','different app host fails closed'],
    ['app.url','https://mail.example.invalid/other','different app path fails closed'],
    ['mail_arrival.production.app_url','http://mail.example.invalid','non-HTTPS production pin fails closed'],
    ['mail_arrival.production.enabled',false,'production flag remains required'],
    ['mail_arrival.production.mailboxes',[1=>$identities[1]],'incomplete identity pins fail closed'],
    ['mail_arrival.production.mailboxes',$identities+[4=>'other@example.invalid'],'extra identity pins fail closed'],
    ['mail_arrival.fixture_scope.2',['email'=>'fixture@example.invalid'],'production rejects fixture scope for any mailbox'],
    ['mail_arrival.clients.3',['host'=>'127.0.0.1'],'production rejects custom credential client for any mailbox']
] as $case) {
    [$key,$value,$label]=$case;
    $prior=$settings[$key]??null; $settings[$key]=$value;
    check(!\Modules\MailArrival\DeploymentGuard::allowed(),$label);
    if ($prior===null) {unset($settings[$key]);} else {$settings[$key]=$prior;}
}
$settings['mail_arrival.fixture_scope.3']=['email'=>'fixture@example.invalid'];
failure(function(){\Modules\MailArrival\DeploymentGuard::fixtureScope(3);},'Fixture scope requires local deployment','direct history constructor cannot read production fixture scope');
$settings['app.url']='http://127.0.0.1:53927';
check(\Modules\MailArrival\DeploymentGuard::local()&&\Modules\MailArrival\DeploymentGuard::fixtureScope(3)['email']==='fixture@example.invalid','loopback fixture scope remains available');
check(\Modules\MailArrival\DeploymentGuard::matches((object)['id'=>3,'email'=>'fixture@example.invalid']),'loopback fixture identity is explicit');
\Modules\MailArrival\DeploymentGuard::assertInstall();
check(true,'loopback standalone installer guard remains available');
echo "BACKEND_RUNTIME_GUARDS_PASS\n";
}
