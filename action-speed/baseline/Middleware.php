<?php
namespace InboxSpeed;

// Global: speculative page loads (rolled back, session untouched) and conversation actions (batched counters,
// then the signal that releases the page prefetched for after the action).
class Middleware
{
    public function handle($request, \Closure $next)
    {
        if (Prefetch::isSpeculative($request)) return Prefetch::guard($request, $next);
        Prefetch::adoptToken($request);
        if (!($request->isMethod('post') && $request->is('conversation/ajax'))) return $next($request);
        Counters::start();
        try {
            $response = $next($request);
        } finally {
            // Recount before the response leaves, so the next page never shows stale counts.
            Counters::flush();
        }
        return Prefetch::afterAction($request, $response);
    }
}

// Web group (runs after the session starts): show the action's "Status updated" message on the page that was
// prefetched for after the action, instead of leaving it in the session for some later page.
class SessionMiddleware
{
    public function handle($request, \Closure $next)
    {
        foreach ((array)$request->attributes->get('inbox_speed_flash', []) as $key => $text) {
            if (in_array($key, Prefetch::FLASHES, true)) session()->now($key, $text);
        }
        return $next($request);
    }
}
