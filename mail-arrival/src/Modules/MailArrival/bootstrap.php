<?php
foreach (
    [
        'Version',
        'DeploymentGuard',
        'Installer',
        'ImapProvider',
        'DatabaseStore',
        'Engine',
        'MessageReservation',
        'PollCadence',
        'NativeSink',
        'FivewaysSink',
        'Runtime'
    ]
    as $file
) {
    require_once __DIR__ . '/Backend/' . $file . '.php';
}
