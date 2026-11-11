<?php
// Test-only server barrier. Never install with release sources.
if ((string)config('app.url') !== 'http://localhost:53927') throw new RuntimeException('Local only');
class ActionSpeedCloseDelay {
    public function handle($request, \Closure $next) {
        if (!$request->isMethod('post') || !$request->is('conversation/ajax') || $request->input('action') !== 'conversation_change_status') return $next($request);
        $control=json_decode(file_get_contents('/tmp/action-speed/control.json'),true);
        if (empty($control['closeDelayMs'])) return $next($request);
        $id=(int)$request->input('conversation_id');
        $c=\App\Conversation::find($id);
        if (!$c || strpos($c->subject,'Action speed fixture: ') !== 0) throw new RuntimeException('Non-fixture close delay refused');
        $emit=function($event,$status=null)use($id){$line=json_encode(['event'=>$event,'id'=>$id,'timeMs'=>microtime(true)*1000,'status'=>$status])."\n";foreach(['/tmp/action-speed/close.jsonl','/www/html/public/action-speed-close-trace.jsonl'] as $path)file_put_contents($path,$line,FILE_APPEND|LOCK_EX);};
        $emit('start');
        if (in_array($id,$control['closeDelayIds'] ?? [],true)) {
            $deadline=hrtime(true)+min(10000,(int)$control['closeDelayMs'])*1000000;
            while (($remaining=$deadline-hrtime(true))>0) usleep((int)min(1000000,ceil($remaining/1000)));
        }
        try {$response=$next($request);$emit('end',$response->getStatusCode());return $response;}
        catch (\Throwable $e) {$emit('error',500);throw $e;}
    }
}
app(\Illuminate\Contracts\Http\Kernel::class)->pushMiddleware(ActionSpeedCloseDelay::class);
