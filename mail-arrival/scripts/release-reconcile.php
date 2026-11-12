<?php
/** Release operator only. All fetch owners must be fenced before this command. */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(2); }
ini_set('display_errors', '0');
ini_set('log_errors', '0');
set_error_handler(function ($severity) {
    if (!(error_reporting() & $severity)) { return false; }
    throw new ErrorException('Reconciliation warning');
});
require_once __DIR__ . '/../harness/cutover-seed.php';
require_once __DIR__ . '/../harness/cutover-pdo-store.php';
require_once __DIR__ . '/../harness/baseline-reconcile.php';
require_once __DIR__ . '/../harness/baseline-reconcile-pdo-store.php';
require_once __DIR__ . '/../harness/baseline-reconcile-guard.php';
$args = getopt('', ['expected-app-url:', 'config:', 'config-sha256:', 'inventory:',
    'inventory-sha256:', 'gate-closed-confirmed', 'all-mailboxes-paused-confirmed',
    'host-locks-drained-confirmed']);
$clients = [];
$exitCode = 0;
try {
    $scope = MailArrivalEvidence\BaselineReconcileGuard::arguments($args);
    MailArrivalEvidence\BaselineReconcileGuard::privateBytes(
        (string) ($args['config'] ?? ''), $args['config-sha256']
    );
    $bytes = MailArrivalEvidence\BaselineReconcileGuard::privateBytes(
        (string) ($args['inventory'] ?? ''), $args['inventory-sha256']
    );
    $private = require $args['config'];
    if (!is_array($private)) { throw new RuntimeException('PRIVATE_CONFIG_INVALID'); }
    $scan = function ($value) use (&$scan) {
        if (!is_array($value)) { return; }
        foreach ($value as $key => $item) {
            if (is_string($key) && preg_match('/password|secret|token|credential|api.?key/i', $key)) {
                throw new RuntimeException('PRIVATE_CONFIG_CONTAINS_CREDENTIAL_FIELD');
            }
            $scan($item);
        }
    };
    $scan($private);
    $plan = json_decode($bytes, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($plan)) { throw new RuntimeException('PLAN_INVALID'); }
    $folders = MailArrivalEvidence\BaselineReconcileGuard::scope($private, $plan);
    MailArrivalEvidence\BaselineReconcileGuard::paused($private);
    chdir('/www/html');
    require 'vendor/autoload.php';
    $app = require 'bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    if (rtrim((string) config('app.url'), '/') !== $scope['app_url']) {
        throw new RuntimeException('APP_IDENTITY_MISMATCH');
    }
    Config::set('mail_arrival', $private);
    Config::set('app.debug', false);
    Config::set('imap.options.debug', false);
    if (!class_exists(\Modules\MailArrival\DeploymentGuard::class, false)) {
        require_once __DIR__ . '/../src/Modules/MailArrival/Backend/DeploymentGuard.php';
    }
    if (\Modules\MailArrival\DeploymentGuard::local() ||
        !\Modules\MailArrival\DeploymentGuard::allowed()) {
        throw new RuntimeException('DEPLOYMENT_SCOPE_UNAVAILABLE');
    }
    $protocols = [];
    foreach ([1, 2, 3] as $id) {
        $mailbox = App\Mailbox::findOrFail($id);
        $pin = $private['production']['observer_clients'][$id] ?? [];
        $login = $mailbox->oauthEnabled() ? $mailbox->getInOauthUsername() : $mailbox->in_username;
        if (!\Modules\MailArrival\DeploymentGuard::matches($mailbox) ||
            !is_string($pin['login'] ?? null) || !filter_var($pin['login'], FILTER_VALIDATE_EMAIL) ||
            !is_string($pin['host'] ?? null) || !preg_match('/^[a-z0-9.-]+$/i', $pin['host']) ||
            ($pin['port'] ?? null) !== 993 || ($pin['encryption'] ?? null) !== 'ssl' ||
            ($pin['validate_cert'] ?? null) !== true ||
            strtolower((string) $login) !== strtolower($pin['login']) ||
            strtolower((string) $mailbox->in_server) !== strtolower($pin['host']) ||
            (int) $mailbox->in_port !== 993 || !$mailbox->in_validate_cert ||
            strtolower((string) $mailbox->getInProtocolName()) !== 'imap' ||
            strtolower((string) $mailbox->getInEncryptionName()) !== 'ssl') {
            throw new RuntimeException('MAILBOX_PROVIDER_SCOPE_MISMATCH');
        }
        // Uses existing authentication only; an expired OAuth token may refresh.
        $client = MailHelper::getMailboxClient($mailbox);
        $clients[] = $client;
        if (strtolower((string) $client->host) !== strtolower($pin['host']) ||
            strtolower((string) $client->username) !== strtolower($pin['login']) ||
            (int) $client->port !== 993 || strtolower((string) $client->encryption) !== 'ssl' ||
            !$client->validate_cert) {
            throw new RuntimeException('CLIENT_SCOPE_MISMATCH');
        }
        $client->connect();
        $protocols[$id] = $client->getConnection();
    }
    $pdo = DB::connection()->getPdo();
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    if ($pdo->inTransaction()) { throw new RuntimeException('UNEXPECTED_ACTIVE_TRANSACTION'); }
    $store = new MailArrivalEvidence\BaselineReconcilePdoStore($pdo);
    $state = function ($id, $folder) use ($protocols, $private) {
        MailArrivalEvidence\BaselineReconcileGuard::paused($private);
        return $protocols[$id]->examineFolder($folder);
    };
    $counts = MailArrivalEvidence\BaselineReconcile::apply($plan, $folders, $store, $state);
    echo json_encode(['status' => 'reconciled', 'counts' => $counts], JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) {
    $safe = ['ARGUMENTS_INVALID', 'OWNERSHIP_BARRIER_NOT_CONFIRMED', 'PRIVATE_FILE_PATH_INVALID',
        'PRIVATE_FILE_PERMISSIONS_INVALID', 'PRIVATE_FILE_TOO_LARGE', 'PRIVATE_FILE_HASH_MISMATCH',
        'PRIVATE_CONFIG_INVALID', 'PRIVATE_CONFIG_CONTAINS_CREDENTIAL_FIELD', 'PRIVATE_CONFIG_PLAN_MISMATCH',
        'MAILBOX_NOT_PAUSED', 'APP_IDENTITY_MISMATCH', 'DEPLOYMENT_SCOPE_UNAVAILABLE',
        'MAILBOX_PROVIDER_SCOPE_MISMATCH', 'CLIENT_SCOPE_MISMATCH', 'UNEXPECTED_ACTIVE_TRANSACTION',
        'PLAN_INVALID', 'PLAN_MAILBOX_INVALID', 'PLAN_FOLDER_SCOPE_MISMATCH', 'PLAN_FOLDER_INVALID',
        'PLAN_UID_INVALID', 'PLAN_MATCH_INVALID', 'PLAN_MATCH_CONFLICT', 'IMPORTER_LOCK_UNAVAILABLE',
        'SOURCE_EPOCH_CHANGED', 'TARGET_SCOPE_MISMATCH', 'LEGACY_TARGET_MISMATCH',
        'MATCHED_LEDGER_MISMATCH', 'CHECKPOINT_SCOPE_MISMATCH', 'COMPLETED_CHECKPOINT_BELOW_FENCE',
        'SEED_FENCE_MISMATCH', 'DEFERRED_SCOPE_MISMATCH', 'CHECKPOINT_WRITE_FAILED'];
    fwrite(STDERR, 'Reconciliation stopped: ' .
        (in_array($error->getMessage(), $safe, true) ? $error->getMessage() : 'PROVIDER_OR_RUNTIME_FAILURE') . "\n");
    $exitCode = 1;
} finally {
    foreach ($clients as $client) {
        try { $client->disconnect(); } catch (Throwable $ignored) {}
    }
}
exit($exitCode);
