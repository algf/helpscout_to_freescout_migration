<?php
// Run in the bootstrapped local app CLI after fixture reset and candidate install.
if (PHP_SAPI !== 'cli' || (string)config('app.url') !== 'http://localhost:53927') throw new RuntimeException('Local CLI only');
$controller=app(Modules\UnSub\Http\Controllers\UnsubscribeController::class);
$originalUser=Auth::id(); $keys=[]; $checks=0;
$assert=function($condition,$message)use(&$checks){if(!$condition)throw new RuntimeException($message);$checks++;};
$call=function($data)use($controller){return $controller->action(new Illuminate\Http\Request($data));};
$decode=function($response){return json_decode($response->getContent(),true);};
try {
    Auth::loginUsingId(1);
    $conversation=App\Conversation::where('subject','Action speed fixture: 1 00')->firstOrFail();
    $assert($conversation->status === App\Conversation::STATUS_ACTIVE,'Reset fixtures before this test');
    $preview=$decode($call(['action'=>'preview','ids'=>[$conversation->id]]));
    $token=$preview['token'];$key=$preview['items'][0]['key'];
    $planKey='unsub:'.$token;$prefix='unsub-result:'.$token.':'.$key;
    $keys=[$planKey,$prefix,$prefix.':running',$prefix.':final'];
    $status=function()use($call,$token,$key){return $call(['action'=>'status','token'=>$token,'key'=>$key]);};
    $assert($decode($status())['state']==='unknown','Undispatched status must be unknown');
    Cache::put($prefix.':running',time(),2);
    $assert($decode($status())['state']==='pending','Running status must be pending');
    Cache::put($prefix.':final',['accepted'=>true,'closed'=>1,'message'=>'Fixture historical acceptance'],15);
    $final=$decode($status());
    $assert($final['state']==='complete' && $final['result']['accepted']===true && $final['result']['closed']===0,'Open fixture must not project historical closure');
    $assert(Cache::get($prefix.':final')['closed']===1,'Status must not alter cached final result');
    $plan=Cache::get($planKey);
    Auth::loginUsingId(19);
    $assert(Auth::id()===19,'Permission fixture user19 is required');
    $assert($status()->getStatusCode()===409,'Wrong plan owner must be rejected');
    $plan['user_id']=19;Cache::put($planKey,$plan,10);
    $assert(!Auth::user()->can('update',$conversation),'User19 must lack mailbox1 update permission');
    $denied=false;
    try {$status();}catch(Symfony\Component\HttpKernel\Exception\HttpException $error){$denied=$error->getStatusCode()===403;}
    $assert($denied,'Current conversation policy must reject status with403');
    echo 'Real app status assertions passed: '.$checks." (no execute or transport calls).\n";
} finally {
    foreach($keys as $cacheKey)Cache::forget($cacheKey);
    if($originalUser)Auth::loginUsingId($originalUser);else Auth::logout();
}
