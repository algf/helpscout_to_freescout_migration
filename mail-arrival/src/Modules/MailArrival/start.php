<?php
require_once __DIR__ . '/bootstrap.php';
if (is_file(__DIR__ . '/routes.php')) {
    require __DIR__ . '/routes.php';
}
// Opt-in cutover only. Never change native polling merely by activating this module.
\Eventy::addFilter(
    'mailbox.in_active',
    function ($active, $mailbox) {
        if (
            PHP_SAPI === 'cli' &&
            in_array('freescout:fetch-emails', $_SERVER['argv'] ?? [], true) &&
            $mailbox &&
            \Modules\MailArrival\Runtime::enrolled($mailbox->id, $mailbox)
        ) {
            return false;
        }
        return $active;
    },
    40,
    2
);
// Capture before controller pagination. The composer must use this earlier receipt.
app('router')->pushMiddlewareToGroup(
    'web',
    \Modules\MailArrival\CaptureVersion::class
);
\View::composer('mailboxes.view', function ($view) {
    if (!config('mail_arrival.enabled', false)) {
        return;
    }
    $data = $view->getData();
    $mailbox = $data['mailbox'] ?? null;
    if (!app()->bound('mailarrival.captured')) {
        return;
    }
    $captured = app('mailarrival.captured');
    if (
        $mailbox &&
        (int) $mailbox->id === $captured['mailbox_id'] &&
        auth()->user() &&
        auth()->user()->can('view', $mailbox)
    ) {
        app()->instance('mailarrival.initial', [
            'mailbox_id' => (int) $mailbox->id,
            'version' => $captured['version'],
            'endpoint' => url(
                '/mail-arrival/version?mailbox_id=' . (int) $mailbox->id
            )
        ]);
    }
});
\Eventy::addAction(
    'javascript',
    function () {
        if (!app()->bound('mailarrival.initial')) {
            return;
        }
        echo 'window.mailArrivalInitial=' .
            json_encode(
                app('mailarrival.initial'),
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
            ) .
            ';';
        if (is_file(__DIR__ . '/Resources/assets/mail-arrival.js')) {
            echo file_get_contents(
                __DIR__ . '/Resources/assets/mail-arrival.js'
            );
        }
    },
    120,
    0
);
\Eventy::addAction(
    'layout.head',
    function () {
        if (
            config('mail_arrival.enabled', false) &&
            is_file(__DIR__ . '/Resources/assets/mail-arrival.css')
        ) {
            echo '<style ' .
                \Helper::cspNonceAttr() .
                '>' .
                file_get_contents(
                    __DIR__ . '/Resources/assets/mail-arrival.css'
                ) .
                '</style>';
        }
    },
    120,
    0
);
