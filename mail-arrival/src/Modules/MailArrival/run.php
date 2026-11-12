<?php
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require '/www/html/vendor/autoload.php';
$app = require '/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require_once __DIR__ . '/bootstrap.php';
$args = getopt('', ['mailbox:', 'once', 'duration:', 'poll-seconds:']);
$id = (int) ($args['mailbox'] ?? 0);
$duration = isset($args['once']) ? 0 : (int) ($args['duration'] ?? 0);
$interval = (int) ($args['poll-seconds'] ?? 10);
if (
    !in_array($id, [1, 2, 3], true) ||
    $duration < 0 ||
    $duration > 3600 ||
    $interval < 1 ||
    $interval > 60
) {
    fwrite(
        STDERR,
        "Use --mailbox=N --once or --duration=60 --poll-seconds=10\n"
    );
    exit(2);
}
$until = microtime(true) + $duration;
$healthy = true;
$failures = 0;
do {
    $startedAt = microtime(true);
    $startedMonotonic = hrtime(true);
    try {
        $result = \Modules\MailArrival\Runtime::poll($id);
        $finishedAt = microtime(true);
        $result['poll_timing'] = [
            // CLI observes the complete poll, not individual provider phases.
            'stage' => 'poll',
            'started_at' => $startedAt,
            'finished_at' => $finishedAt,
            'elapsed_ms' => round((hrtime(true) - $startedMonotonic) / 1000000, 3)
        ];
        echo json_encode($result) . "\n";
        $healthy = true;
        $failures = 0;
    } catch (Throwable $e) {
        $healthy = false;
        $failures++;
        $failedAt = microtime(true);
        $metadata = [
            'stage' => 'poll',
            'started_at' => $startedAt,
            'failed_at' => $failedAt,
            'elapsed_ms' => round((hrtime(true) - $startedMonotonic) / 1000000, 3)
        ];
        if ($e instanceof \Modules\MailArrival\NativeProcessingFailure) {
            // These fields contain parsed codes and static labels only.
            // Never emit the original SQL, message text or arbitrary exception message.
            $metadata += [
                'sqlStates' => $e->sqlStates,
                'driverCodes' => $e->driverCodes,
                'safeReasons' => $e->safeReasons
            ];
        }
        fwrite(
            STDERR,
            "Mailbox import failed; checkpoint retained. " .
                get_class($e) .
                ' ' . json_encode($metadata) .
                "\n"
        );
    }
    if (microtime(true) >= $until) {
        break;
    }
    $wait = \Modules\MailArrival\PollCadence::delay(
        $startedAt,
        microtime(true),
        $interval,
        $failures
    );
    usleep((int) (min($wait, max(0, $until - microtime(true))) * 1000000));
} while (microtime(true) <= $until);
exit($healthy ? 0 : 1);
