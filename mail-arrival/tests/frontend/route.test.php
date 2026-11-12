<?php
namespace Illuminate\Http { class Request { private $id; function __construct($id) {$this->id=$id;} function query($key) {return $this->id;} } }
namespace App { class Mailbox { static function find($id) {return in_array($id,[1,2,3],true)?(object)['id'=>$id]:null;} } }
namespace Modules\MailArrival { class Version { static $reads=[]; static function forMailbox($id) {self::$reads[]=$id;return '7';} } }
namespace {
class Helper { static function getSubdirectory(){return '';} }
class Route {static $group;static $handler;static function group($options,$callback){self::$group=$options;$callback();}static function get($path,$handler){if($path==='/mail-arrival/version')self::$handler=$handler;return new self;}function name($name){return $this;}}
class User {public $allowed=1;function can($ability,$mailbox){return $ability==='view'&&$mailbox->id===$this->allowed;}}
class Auth {public $user;function __construct(){$this->user=new User;}function user(){return $this->user;}}
class Response {public $data;public $code;public $headers=[];function json($data,$code=200){$this->data=$data;$this->code=$code;return $this;}function header($name,$value){$this->headers[$name]=$value;return $this;}}
$auth=new Auth;function auth(){global $auth;return $auth;}function response(){return new Response;}
function check($pass,$message){if(!$pass)throw new \Exception($message);echo "PASS $message\n";}
require __DIR__.'/../../src/Modules/MailArrival/routes.php';
check(in_array('auth',Route::$group['middleware'],true),'native authentication middleware required');
check(in_array('roles',Route::$group['middleware'],true),'native role middleware required');
$handler=Route::$handler;
foreach([null,'0','-1','1foo',[], '1.0'] as $id){$r=$handler(new \Illuminate\Http\Request($id));check($r->code===400,'invalid mailbox denied');}
$r=$handler(new \Illuminate\Http\Request('2'));check($r->code===403,'cross-mailbox access denied');check(count(\Modules\MailArrival\Version::$reads)===0,'unauthorised request never reads receipt');
$r=$handler(new \Illuminate\Http\Request('99'));check($r->code===403,'unknown mailbox denied without existence disclosure');
foreach([1,2,3] as $id){$auth->user->allowed=$id;$r=$handler(new \Illuminate\Http\Request((string)$id));check($r->code===200&&$r->data===['status'=>'success','mailbox_id'=>$id,'version'=>'7'],'authorised mailbox '.$id);check($r->headers['Cache-Control']==='private, no-store','receipt not cacheable '.$id);}
}
