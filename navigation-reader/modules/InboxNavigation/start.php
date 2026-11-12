<?php
Eventy::addAction('layout.head', function () {
    if (!auth()->check() || Helper::isPrint()) return;
    echo '<style nonce="'.e(Helper::cspNonce()).'">'.file_get_contents(__DIR__.'/navigation.css').'</style>';
});
Eventy::addAction('javascript', function () {
    if (!auth()->check() || Helper::isPrint()) return;
    echo file_get_contents(__DIR__.'/read-state.js');
    echo file_get_contents(__DIR__.'/navigation.js');
}, 110);
