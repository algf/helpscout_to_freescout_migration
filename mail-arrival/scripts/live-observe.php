<?php
/**
 * Read-only observation of naturally arriving Gmail messages.
 * Does not send, fetch MIME/header/body, change flags, invoke the importer, or alter schedules.
 * The existing MailHelper OAuth path may refresh an expired access token under the existing auth scope.
 * Never print or persist the connection settings, token, sender, subject, source ID or message content.
 * Execution against production requires the release operator to verify the app URL, mailbox identity,
 * folder scope and network path first. This file is a preparation artifact, not an authorisation to run.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(2); }
// Provider/library warnings may contain connection details. Keep them out of output and logs.
ini_set('display_errors', '0'); ini_set('log_errors', '0');
set_error_handler(function ($severity, $message, $file, $line) { throw new ErrorException('Observation warning', 0, $severity, $file, $line); });
$args = getopt('', ['expected-app-url:', 'mailboxes:', 'duration:', 'interval:', 'cap:']);
$expectedUrl = rtrim((string) ($args['expected-app-url'] ?? ''), '/');
$parts = parse_url($expectedUrl);
if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) { fwrite(STDERR, "Invalid observation scope\n"); exit(2); }
$rawIds = (string) ($args['mailboxes'] ?? '');
if (!preg_match('/^[123](,[123])*$/', $rawIds)) { fwrite(STDERR, "Invalid mailbox scope\n"); exit(2); }
$ids = array_map('intval', explode(',', $rawIds));
$duration = (int) ($args['duration'] ?? 120); $interval = (int) ($args['interval'] ?? 5); $cap = (int) ($args['cap'] ?? 20);
if (count(array_unique($ids)) !== count($ids) || $duration < 10 || $duration > 300 || $interval < 5 || $interval > 30 || $cap < 1 || $cap > 50) { fwrite(STDERR, "Invalid observation bounds\n"); exit(2); }
$clients = [];
try {
    chdir('/www/html'); require 'vendor/autoload.php'; $app = require 'bootstrap/app.php'; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    if (rtrim((string) config('app.url'), '/') !== $expectedUrl) throw new RuntimeException('App identity mismatch');
    require_once __DIR__ . '/../harness/live-observer.php';
    // Suppress protocol diagnostics in this process, including any OAuth credentials.
    Config::set('app.debug', false); Config::set('imap.options.debug', false);
    require_once '/data/Modules/MailArrival/bootstrap.php';
    if (\Modules\MailArrival\DeploymentGuard::local() || !\Modules\MailArrival\DeploymentGuard::allowed()) throw new RuntimeException('Production deployment scope unavailable');
    $expected = config('mail_arrival.production.mailboxes', []);
    $observers = []; $ledgerQuery = null;
    foreach ($ids as $id) {
        $mailbox = App\Mailbox::findOrFail($id);
        $username = $mailbox->oauthEnabled() ? $mailbox->getInOauthUsername() : $mailbox->in_username;
        // These private pins are supplied only after the release operator verifies the actual login and host.
        $pin = config('mail_arrival.production.observer_clients.' . $id, []);
        $folders = config('mail_arrival.mailboxes.' . $id . '.folders', []);
        if (!is_array($pin) || !is_string($pin['login'] ?? null) || !filter_var($pin['login'], FILTER_VALIDATE_EMAIL) || !is_string($pin['host'] ?? null) || !preg_match('/^[a-z0-9.-]+$/i', $pin['host']) || (int) ($pin['port'] ?? 0) !== 993 || strtolower((string) ($pin['encryption'] ?? '')) !== 'ssl' || ($pin['validate_cert'] ?? null) !== true || !is_array($folders) || !$folders) throw new RuntimeException('Verified provider pins or folders unavailable');
        if (!\Modules\MailArrival\DeploymentGuard::matches($mailbox) || strtolower((string) $mailbox->email) !== strtolower((string) ($expected[$id] ?? '')) || strtolower((string) $username) !== strtolower($pin['login']) || strtolower((string) $mailbox->in_server) !== strtolower($pin['host']) || (int) $mailbox->in_port !== (int) $pin['port'] || strtolower((string) $mailbox->getInProtocolName()) !== 'imap' || strtolower((string) $mailbox->getInEncryptionName()) !== strtolower($pin['encryption']) || !$mailbox->in_validate_cert) throw new RuntimeException('Mailbox provider identity mismatch');
        // This existing helper may refresh an expired OAuth token; it does not fetch mail.
        $client = MailHelper::getMailboxClient($mailbox); $clients[] = $client;
        if (strtolower((string) $client->host) !== strtolower($pin['host']) || (int) $client->port !== (int) $pin['port'] || strtolower((string) $client->username) !== strtolower($pin['login']) || strtolower((string) $client->encryption) !== strtolower($pin['encryption']) || !$client->validate_cert) throw new RuntimeException('Client identity mismatch');
        $client->connect();
        // Use this same primary PDO for every ledger read; a replica could lag the commit.
        $lookup = function (int $mailboxId, string $identity) use (&$ledgerQuery) {
            if (!$ledgerQuery) throw new RuntimeException('Read-only ledger query unavailable');
            $ledgerQuery->execute([$mailboxId, $identity, $mailboxId]);
            $row = $ledgerQuery->fetch(PDO::FETCH_ASSOC); $ledgerQuery->closeCursor();
            return $row ? ['thread_id' => (int) $row['thread_id'], 'conversation_id' => (int) $row['conversation_id'], 'ledger_written_at_utc' => $row['committed_at']] : null;
        };
        $observers[] = new MailArrivalEvidence\LiveObserver($client->getConnection(), $id, $folders, $lookup, function () { return microtime(true); }, $cap);
    }
    // Enforce a session-only read-only default after any routine OAuth refresh has completed.
    $pdo = DB::connection()->getPdo();
    if ($pdo->inTransaction()) throw new RuntimeException('Unexpected active transaction');
    $pdo->exec('SET SESSION TRANSACTION READ ONLY');
    try { $readOnly = (int) $pdo->query('SELECT @@session.tx_read_only')->fetchColumn(); }
    catch (Throwable $e) { $readOnly = (int) $pdo->query('SELECT @@session.transaction_read_only')->fetchColumn(); }
    if ($readOnly !== 1) throw new RuntimeException('Read-only database session unavailable');
    $ledgerQuery = $pdo->prepare("SELECT t.id AS thread_id, c.id AS conversation_id, m.committed_at FROM mail_arrival_messages m JOIN threads t ON t.id=m.target_thread_id JOIN conversations c ON c.id=t.conversation_id WHERE m.mailbox_id=? AND m.identity=? AND m.outcome='imported' AND c.mailbox_id=? LIMIT 1");
    if (!$ledgerQuery) throw new RuntimeException('Ledger unavailable');
    // Capture all baseline boundaries before any follow-up sample.
    foreach ($observers as $observer) { echo json_encode($observer->baseline(), JSON_THROW_ON_ERROR) . "\n"; flush(); }
    $end = microtime(true) + $duration;
    while (microtime(true) < $end) {
        foreach ($observers as $observer) foreach ($observer->sample() as $event) { echo json_encode($event, JSON_THROW_ON_ERROR) . "\n"; flush(); }
        $remaining = $end - microtime(true); if ($remaining > 0) usleep((int) (min($interval, $remaining) * 1000000));
    }
    echo json_encode(['event' => 'complete', 'completed_ms' => (int) floor(microtime(true) * 1000)], JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $e) {
    // Only fixed, reviewed reason codes may leave the process. Provider messages can contain credentials.
    $safeReasons = [
        'App identity mismatch' => 'APP_IDENTITY_MISMATCH',
        'Production deployment scope unavailable' => 'DEPLOYMENT_SCOPE_UNAVAILABLE',
        'Verified provider pins or folders unavailable' => 'PROVIDER_PINS_OR_FOLDERS_UNAVAILABLE',
        'Mailbox provider identity mismatch' => 'MAILBOX_PROVIDER_IDENTITY_MISMATCH',
        'Client identity mismatch' => 'CLIENT_IDENTITY_MISMATCH',
        'Unexpected active transaction' => 'UNEXPECTED_ACTIVE_TRANSACTION',
        'Read-only database session unavailable' => 'READ_ONLY_SESSION_UNAVAILABLE',
        'Ledger unavailable' => 'LEDGER_UNAVAILABLE',
        'Observation scope is not approved' => 'OBSERVATION_SCOPE_REJECTED',
        'Observation folder is invalid' => 'FOLDER_SCOPE_INVALID',
        'Source epoch or UIDNEXT changed unexpectedly' => 'SOURCE_EPOCH_CHANGED',
        'Read-only folder state unavailable' => 'FOLDER_STATE_UNAVAILABLE',
        'Observation bound exceeded' => 'OBSERVATION_BOUND_EXCEEDED',
        'Source returned out-of-range UID' => 'SOURCE_UID_OUT_OF_RANGE',
        'Stable source metadata unavailable' => 'SOURCE_METADATA_UNAVAILABLE',
        'Provider receipt date invalid' => 'SOURCE_DATE_INVALID',
        'Committed ledger target incomplete' => 'LEDGER_TARGET_INCOMPLETE',
        'Ledger timestamp invalid' => 'LEDGER_DATE_INVALID',
        'Clock or ledger timestamp inconsistent' => 'CLOCK_OR_LEDGER_INCONSISTENT'
    ];
    fwrite(STDERR, 'Observation stopped: ' . ($safeReasons[$e->getMessage()] ?? 'PROVIDER_OR_RUNTIME_FAILURE') . "\n"); exit(1);
} finally {
    foreach ($clients as $client) { try { $client->disconnect(); } catch (Throwable $ignored) {} }
}
