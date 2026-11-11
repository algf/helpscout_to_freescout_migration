<?php
namespace Modules\UnSub\Http\Controllers;

use App\Conversation;
use App\Thread;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Modules\UnSub\Services\MessageKind;
use Modules\UnSub\Services\UnsubscribeHeaders as Headers;
use Modules\UnSub\Services\UnsubscribeTransport;

class UnsubscribeController extends Controller
{
    public function action(Request $request)
    {
        if ($request->input('action') === 'preview') return $this->preview($request);
        if ($request->input('action') === 'status') return $this->status($request);
        if ($request->input('action') === 'execute') return $this->execute($request);
        return response()->json(['message'=>'Unknown action.'], 422);
    }

    private function latest($conversation)
    {
        return $conversation->threads()->where('type', Thread::TYPE_CUSTOMER)->where('state', Thread::STATE_PUBLISHED)->orderBy('created_at','desc')->orderBy('id','desc')->first();
    }

    private function preview(Request $request)
    {
        $ids = $request->input('ids', []);
        if (!is_array($ids) || !$ids || count($ids)>50) return response()->json(['message'=>'Select between 1 and 50 conversations.'],422);
        foreach ($ids as $id) if (!ctype_digit((string)$id) || (int)$id<=0) return response()->json(['message'=>'Invalid selection.'],422);
        $ids = array_values(array_unique(array_map('intval',$ids)));
        $groups = [];
        foreach ($ids as $id) {
            $conversation = Conversation::findOrFail($id);
            abort_unless(auth()->user()->can('update',$conversation),403);
            abort_unless($conversation->state === Conversation::STATE_PUBLISHED,409);
            $thread = $this->latest($conversation);
            $candidate = Headers::candidate($thread ? $thread->headers : '');
            // Issue #134: security, account, order, payment, legal and service notices are never unsubscribed here.
            $operational = MessageKind::operational($thread ? $thread->headers : '', (string)$conversation->subject);
            if ($operational !== '') $candidate = array_merge($candidate, ['url'=>null, 'manual_url'=>null, 'mailto'=>null, 'one_click'=>false,
                'reason'=>'This looks like '.$operational.'. Stopping these emails could hide security or service problems, so it is not unsubscribed here. Close the conversation instead, or change notification settings with the sender.']);
            $sender = ($thread ? $thread->from : '') ?: $conversation->customer_email ?: 'Unknown sender';
            // Exact endpoint deduplication avoids merging independent lists from
            // the same sender. List-ID deduplication also requires the sender.
            $identity = $candidate['list_id'] && $candidate['url'] ? strtolower($sender).'|'.$candidate['list_id'].'|'.parse_url($candidate['url'],PHP_URL_HOST) : ($candidate['url'] ?: 'conversation:'.$id);
            $key = hash('sha256',$conversation->mailbox_id.'|'.$identity);
            if (!isset($groups[$key])) $groups[$key] = ['key'=>$key,'sender'=>mb_substr($sender,0,191),'list'=>mb_substr(strip_tags($candidate['list_id']),0,200),'candidate'=>$candidate,'automatic'=>(bool)$candidate['one_click'],'reason'=>$candidate['reason'],'conversation_url'=>route('conversations.view',['id'=>$id]),'mailbox_id'=>$conversation->mailbox_id,'snapshots'=>[]];
            $groups[$key]['snapshots'][]=['id'=>$id,'thread_id'=>$thread ? $thread->id : null,'headers_hash'=>hash('sha256',$thread ? $thread->headers : ''),'status'=>$conversation->status];
        }
        $token = bin2hex(random_bytes(24));
        \Cache::put('unsub:'.$token,['user_id'=>auth()->id(),'created'=>time(),'groups'=>$groups],10);
        $items=[];
        foreach ($groups as $group) $items[]=['key'=>$group['key'],'ids'=>array_column($group['snapshots'],'id'),'mailbox_id'=>$group['mailbox_id'],'sender'=>$group['sender'],'list'=>$group['list'],'count'=>count($group['snapshots']),'automatic'=>$group['automatic'],'reason'=>$group['reason'],'host'=>$group['candidate']['url'] ? parse_url($group['candidate']['url'],PHP_URL_HOST) : null,'manual_url'=>$group['candidate']['manual_url'],'mailto'=>$group['candidate']['mailto'],'conversation_url'=>$group['conversation_url']];
        return response()->json(['token'=>$token,'items'=>$items]);
    }

    // Recovery is read-only: never infer acceptance from a running request or resend it.
    private function status(Request $request)
    {
        $token=(string)$request->input('token'); $key=(string)$request->input('key');
        if (!preg_match('/^[a-f0-9]{48}$/D',$token) || !preg_match('/^[a-f0-9]{64}$/D',$key)) abort(422);
        $plan=\Cache::get('unsub:'.$token);
        if (!$plan || $plan['user_id'] !== auth()->id() || $plan['created'] < time()-600) return response()->json(['message'=>'This review expired. Open Unsubscribe again.'],409);
        $group=$plan['groups'][$key] ?? null;
        if (!$group || !$group['automatic']) abort(422);
        foreach ($group['snapshots'] as $snapshot) {
            $c=Conversation::findOrFail($snapshot['id']);
            abort_unless(auth()->user()->can('update',$c),403);
            if ($c->mailbox_id !== $group['mailbox_id'] || $c->state !== Conversation::STATE_PUBLISHED) return response()->json(['state'=>'unknown']);
        }
        $prefix='unsub-result:'.$token.':'.$key;
        $final=\Cache::get($prefix.':final');
        if ($final) {
            // Acceptance is historical. Only project closure when the current message still matches.
            $closed=0;
            foreach ($group['snapshots'] as $snapshot) {
                $c=Conversation::findOrFail($snapshot['id']);
                $t=$this->latest($c);
                if ($c->status === Conversation::STATUS_CLOSED && $t && $t->id === $snapshot['thread_id'] && hash('sha256',$t->headers) === $snapshot['headers_hash']) $closed++;
            }
            $final['closed']=min((int)$final['closed'],$closed);
            if ($final['accepted'] && !$final['closed']) $final['message']='Unsubscribe was accepted. The conversation is not confirmed closed for the current message.';
            return response()->json(['state'=>'complete','result'=>$final]);
        }
        $started=\Cache::get($prefix.':running');
        return response()->json(['state'=>$started && $started >= time()-120 ? 'pending' : 'unknown']);
    }

    private function execute(Request $request)
    {
        $token = (string)$request->input('token'); $key=(string)$request->input('key');
        if (!preg_match('/^[a-f0-9]{48}$/D',$token) || !preg_match('/^[a-f0-9]{64}$/D',$key)) abort(422);
        $plan = \Cache::get('unsub:'.$token);
        if (!$plan || $plan['user_id'] !== auth()->id() || $plan['created'] < time()-600) return response()->json(['message'=>'This review expired. Open Unsubscribe again.'],409);
        $group = $plan['groups'][$key] ?? null;
        if (!$group || !$group['automatic']) abort(422);
        $lockDir=storage_path('app/unsub');
        if (!is_dir($lockDir)) @mkdir($lockDir,0700,true);
        // Serialise requests per mailbox, including different agents and reviews.
        $lock=fopen($lockDir.'/mailbox-'.$group['mailbox_id'].'.lock','c');
        if (!$lock) return response()->json(['message'=>'Could not start the unsubscribe request.'],503);
        if (!flock($lock,LOCK_EX|LOCK_NB)) { fclose($lock); return response()->json(['message'=>'An unsubscribe request is already running.'],409); }
        $resultKey='unsub-result:'.$token.':'.$key;
        $running=false;
        try {
            $cached=\Cache::get($resultKey);
            if ($cached) return response()->json($cached);
            foreach ($group['snapshots'] as $snapshot) {
                $c=Conversation::findOrFail($snapshot['id']);
                abort_unless(auth()->user()->can('update',$c),403);
                $t=$this->latest($c);
                if ($c->state !== Conversation::STATE_PUBLISHED || $c->mailbox_id !== $group['mailbox_id'] || !$t || $t->id !== $snapshot['thread_id'] || hash('sha256',$t->headers)!==$snapshot['headers_hash'] || $c->status !== $snapshot['status']) return response()->json(['message'=>'A selected conversation changed. Review the selection again.'],409);
            }
            foreach ($group['snapshots'] as $snapshot) {
                $done=Conversation::find($snapshot['id'])->getMeta('unsub.accepted', []);
                if (($done['headers_hash'] ?? '') === $snapshot['headers_hash']) {
                    $duplicate=['accepted'=>true,'closed'=>0,'message'=>'An unsubscribe request for this message was already accepted. No new request was sent.'];
                    \Cache::put($resultKey.':final',$duplicate,15);
                    return response()->json($duplicate);
                }
            }
            // Persist an indeterminate result before any network operation. A
            // dropped connection or duplicate click must never resend silently.
            $result=['accepted'=>false,'closed'=>0,'message'=>'The previous attempt could not be confirmed. Check the manual link before retrying.'];
            \Cache::put($resultKey,$result,15);
            \Cache::put($resultKey.':running',time(),2);
            $running=true;
            $transport=app(UnsubscribeTransport::class);
            try { $verified=$transport->verifyGmail(\App\Mailbox::findOrFail($group['mailbox_id']),$group['candidate']); }
            catch (\Throwable $e) { $verified=false; }
            if (!$verified) {
                $result['message']='Could not verify one-click unsubscribe for this message. Use the manual link; no emails were closed.';
            } else {
                try { $outcome=$transport->post($group['candidate']['url']); }
                catch (\Throwable $e) { $outcome=['accepted'=>false,'message'=>'Could not confirm the request. Check the manual link before retrying.']; }
                $result=array_merge($result,$outcome);
                \Cache::put($resultKey,$result,15);
                if ($result['accepted']) {
                    foreach ($group['snapshots'] as $snapshot) {
                        $c=Conversation::find($snapshot['id']);
                        $c->setMeta('unsub.accepted', ['headers_hash'=>$snapshot['headers_hash'],'requested_at'=>date('c'),'user_id'=>auth()->id()], true);
                        Thread::create($c, Thread::TYPE_LINEITEM, '', [
                            'user_id'=>$c->user_id, 'created_by_user_id'=>auth()->id(),
                            'action_type'=>167, 'source_via'=>Thread::PERSON_USER,
                            'source_type'=>Thread::SOURCE_TYPE_WEB, 'body'=>'',
                            'meta'=>['unsub_request_accepted'=>true]
                        ]);
                    }
                }
                if ($result['accepted'] && filter_var($request->input('close'), FILTER_VALIDATE_BOOLEAN)) {
                    $result['closed']=\DB::transaction(function()use($group){
                        $count=0;
                        foreach ($group['snapshots'] as $snapshot) {
                            $c=Conversation::where('id',$snapshot['id'])->lockForUpdate()->first();
                            if (!$c || !auth()->user()->can('update',$c) || $c->state !== Conversation::STATE_PUBLISHED || $c->mailbox_id !== $group['mailbox_id'] || $c->status !== $snapshot['status']) continue;
                            $t=$this->latest($c);
                            if (!$t || $t->id!==$snapshot['thread_id'] || hash('sha256',$t->headers)!==$snapshot['headers_hash']) continue;
                            if ($c->status!==Conversation::STATUS_CLOSED) $c->changeStatus(Conversation::STATUS_CLOSED,auth()->user());
                            $count++;
                        }
                        return $count;
                    });
                    \App\Mailbox::find($group['mailbox_id'])->updateFoldersCounters();
                    $result['message'].=' Closed '.$result['closed'].' of '.count($group['snapshots']).' selected conversations.';
                }
            }
            \Cache::put($resultKey,$result,15);
            // Recovery may poll before middleware returns. Finish active recounts
            // before publishing completion, so its list refresh sees reconciled counts.
            if (class_exists('InboxSpeed\\Counters')) \InboxSpeed\Counters::flush();
            \Cache::put($resultKey.':final',$result,15);
            \Log::info('UnSub request',['user_id'=>auth()->id(),'group'=>$key,'accepted'=>$result['accepted'],'closed'=>$result['closed']]);
            return response()->json($result);
        } finally { if ($running) \Cache::forget($resultKey.':running'); flock($lock,LOCK_UN);fclose($lock); }
    }
}
