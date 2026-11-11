<?php
// Local test infrastructure only. Never package this middleware as a release module.
if ((string)config('app.url') !== 'http://localhost:53927') throw new RuntimeException('Lifecycle fixture requires the isolated local app');
class ActionSpeedLifecycle
{
    public function handle($request, \Closure $next)
    {
        $mutation = $request->isMethod('post') && (
            $request->is('conversation/ajax') ||
            (($request->is('unsubscriber/action') || $request->is('unsub/action')) && $request->input('action') === 'execute')
        );
        if (!$mutation) return $next($request);
        $lock = fopen('/tmp/action-speed/lifecycle.lock', 'c');
        if (!$lock) return response()->json(['message'=>'Local fixture lifecycle lock unavailable.'], 503);
        $held = false;
        try {
            $deadline = microtime(true) + 35;
            do {
                if (flock($lock, LOCK_SH | LOCK_NB)) { $held = true; break; }
                if (microtime(true) >= $deadline) return response()->json(['message'=>'Local fixture reset barrier timed out.'], 503);
                usleep(20000);
            } while (true);
            // Missing header is permitted for manual local browser review. Automated
            // tests must attach the generation returned by reset to every request.
            $supplied = $request->header('X-Action-Speed-Generation');
            if ($supplied !== null) {
                $current = @file_get_contents('/tmp/action-speed/generation.txt');
                if ($current === false || trim((string)$supplied) === '' || !hash_equals(trim($current), trim((string)$supplied))) {
                    return response()->json(['message'=>'Stale local fixture generation. No write was performed.'], 409);
                }
            }
            return $next($request);
        } finally {
            if ($held) flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}
// Outermost placement keeps the lock until inner controller AND middleware
// work (including counter cleanup) has returned.
app(\Illuminate\Contracts\Http\Kernel::class)->prependMiddleware(ActionSpeedLifecycle::class);
