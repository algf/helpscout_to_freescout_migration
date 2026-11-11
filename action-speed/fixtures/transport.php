<?php
// Local-only dependency substitution. This file is never part of a release module.
if ((string)config('app.url') !== 'http://localhost:53927') throw new RuntimeException('Fixture transport requires local synthetic app');
class ActionSpeedTransport extends \Modules\UnSub\Services\UnsubscribeTransport {
    public function verifyGmail($mailbox,$candidate) {
        return in_array((int)$mailbox->id,[1,2,3],true) && strpos((string)$candidate['message_id'],'action-speed-') !== false;
    }
    public function post($url) {
        if (!preg_match('~^https://action-speed\.example\.invalid/unsubscribe/(\d+)$~D',$url,$match)) throw new RuntimeException('Non-fixture outbound request refused');
        $control=json_decode(file_get_contents('/tmp/action-speed/control.json'),true);
        $emit=function($event,$durationMs=0)use($match,$control){$line=json_encode(['event'=>$event,'id'=>(int)$match[1],'timeMs'=>microtime(true)*1000,'outcome'=>$control['outcome'],'durationMs'=>$durationMs])."\n";file_put_contents('/tmp/action-speed/transport.jsonl',$line,FILE_APPEND|LOCK_EX);file_put_contents('/www/html/public/action-speed-trace.jsonl',$line,FILE_APPEND|LOCK_EX);};
        $emit('start');
        $started=hrtime(true);
        $deadline=$started+min(30000,max(0,(int)$control['delayMs']))*1000000;
        while (($remaining=$deadline-hrtime(true))>0) usleep((int)min(1000000,ceil($remaining/1000)));
        $emit('end',(hrtime(true)-$started)/1000000);
        return ['accepted'=>$control['outcome']==='accepted','message'=>$control['outcome']==='accepted'?'Synthetic sender accepted unsubscribe.':($control['outcome']==='uncertain'?'Synthetic response lost. Result could not be confirmed.':'Synthetic sender rejected unsubscribe.')];
    }
}
app()->bind(\Modules\UnSub\Services\UnsubscribeTransport::class,function(){return new ActionSpeedTransport();});
