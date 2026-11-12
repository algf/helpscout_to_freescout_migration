<?php
// Native controller still retrieves all threads for metadata. Bound rendering only.
Eventy::addFilter('conversation.view.threads', function ($threads) {
    app()->instance('conversationhistory.hidden', 0);
    if (Helper::isPrint() || request()->has('full_history')) {
        return $threads;
    }
    $recent = $threads->take(12)->pluck('id')->all();
    // Match the timeline's preview classification without invoking body render hooks.
    $isActivity = function ($body) {
        $document = new \DOMDocument();
        $document->loadHTML('<meta charset="utf-8"><div>'.(string) $body.'</div>', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        $xpath = new \DOMXPath($document);
        foreach ($xpath->query('//script|//style|//*[contains(concat(" ", normalize-space(@class), " "), " thread-attachments ") or contains(concat(" ", normalize-space(@class), " "), " thread-meta ")]') as $node) {
            if ($node->parentNode) $node->parentNode->removeChild($node);
        }
        $withQuotes = $document->textContent;
        foreach ($xpath->query('//blockquote') as $node) {
            if ($node->parentNode) $node->parentNode->removeChild($node);
        }
        foreach ($xpath->query('//br') as $node) $node->parentNode->replaceChild($document->createTextNode(' '), $node);
        foreach ($xpath->query('//p|//div|//li') as $node) $node->appendChild($document->createTextNode(' '));
        $preview = trim(preg_replace('/\s+/u', ' ', $document->textContent));
        if ($preview === '') $preview = trim(preg_replace('/\s+/u', ' ', $withQuotes));
        return preg_match('/^Imported Help Scout activity\b/', $preview) === 1;
    };
    $latest = null;
    foreach ($threads as $thread) {
        if ($thread->state == \App\Thread::STATE_DRAFT || !in_array($thread->type, [\App\Thread::TYPE_CUSTOMER, \App\Thread::TYPE_MESSAGE, \App\Thread::TYPE_NOTE])) continue;
        // Timeline uses created-at seconds, then numeric ID, including timestamp ties.
        if ($latest && ($thread->created_at->timestamp < $latest->created_at->timestamp || ($thread->created_at->timestamp == $latest->created_at->timestamp && (int) $thread->id <= (int) $latest->id))) continue;
        if (!$isActivity($thread->body)) $latest = $thread;
    }
    $visible = $threads->filter(function ($thread) use ($recent, $latest) {
        return in_array($thread->id, $recent) || $thread->state == \App\Thread::STATE_DRAFT || ($latest && $thread->id == $latest->id);
    })->values();
    app()->instance('conversationhistory.hidden', $threads->count() - $visible->count());
    return $visible;
}, 100);

Eventy::addAction('conversation.before_threads', function ($conversation) {
    if (!app()->bound('conversationhistory.hidden') || !app('conversationhistory.hidden')) {
        return;
    }
    // Reload through the native controller: auth, policy, hooks and attachments stay native.
    $url = request()->fullUrlWithQuery(['full_history' => 1]);
    echo '<div class="alert alert-info" id="conversation-history-notice" role="status">Showing recent messages. <a id="conversation-history-all" href="'.e($url).'">Load all older messages ('.(int) app('conversationhistory.hidden').')</a></div>';
}, 100);

Eventy::addAction('javascript', function () {
    echo file_get_contents(__DIR__.'/history.js');
}, 100, 0);
