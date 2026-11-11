<?php
// Invoke inside the already bootstrapped local Laravel app as nginx.
// Input: $options associative array. Output: one fixture JSON object + generation.
if ((string)config('app.url') !== 'http://localhost:53927') throw new RuntimeException('Reset requires the isolated local app');
if (!isset($options)) $options = [];
if (!is_array($options)) throw new InvalidArgumentException('Reset options must be an array');
$control = array_merge(['delayMs'=>10000, 'outcome'=>'accepted', 'closeDelayMs'=>0, 'closeDelayIds'=>[]], $options);
if (!is_numeric($control['delayMs']) || $control['delayMs'] < 0 || $control['delayMs'] > 30000 || !in_array($control['outcome'], ['accepted','rejected','uncertain'], true)) throw new InvalidArgumentException('Invalid transport options');
if (!is_int($control['closeDelayMs']) || $control['closeDelayMs'] < 0 || $control['closeDelayMs'] > 10000 || !is_array($control['closeDelayIds']) || count($control['closeDelayIds']) > 50) throw new InvalidArgumentException('Invalid close delay options');
foreach ($control['closeDelayIds'] as $id) if (!is_int($id) || $id <= 0) throw new InvalidArgumentException('Invalid close delay conversation ID');
$handles = [];
$deadline = microtime(true) + 35;
$acquire = function ($path) use (&$handles, $deadline) {
    $handle = fopen($path, 'c');
    if (!$handle) throw new RuntimeException('Cannot open reset barrier lock');
    do {
        if (flock($handle, LOCK_EX | LOCK_NB)) { $handles[] = $handle; return; }
        if (microtime(true) >= $deadline) { fclose($handle); throw new RuntimeException('Reset barrier timed out after 35 seconds; no fixture reset was started'); }
        usleep(20000);
    } while (true);
};
$atomic = function ($path, $contents) {
    $temp = tempnam(dirname($path), '.action-speed-');
    if ($temp === false) throw new RuntimeException('Cannot create fixture control file');
    try {
        if (file_put_contents($temp, $contents) !== strlen($contents) || !chmod($temp, 0600) || !rename($temp, $path)) throw new RuntimeException('Cannot publish fixture control file');
    } finally { if (is_file($temp)) unlink($temp); }
};
try {
    // Acquire lifecycle first. Existing execute requests own a shared lifecycle
    // lock followed by a mailbox lock, so this order avoids lock inversion.
    $acquire('/tmp/action-speed/lifecycle.lock');
    $mailboxDir = storage_path('app/unsub');
    if (!is_dir($mailboxDir) && !mkdir($mailboxDir, 0700, true) && !is_dir($mailboxDir)) throw new RuntimeException('Cannot create mailbox lock directory');
    foreach ([1,2,3] as $mailboxId) $acquire($mailboxDir.'/mailbox-'.$mailboxId.'.lock');
    // These mailbox locks also drain execute requests from the earlier runtime
    // that did not yet have lifecycle middleware installed.
    $generation = bin2hex(random_bytes(16));
    // Fail closed if seeding fails: no previous document may write partial fixtures.
    $atomic('/tmp/action-speed/generation.txt', 'reset-in-progress\n');
    $control['generation'] = $generation;
    $atomic('/tmp/action-speed/control.json', json_encode($control, JSON_THROW_ON_ERROR));
    $level = ob_get_level();
    ob_start();
    try { require '/tmp/action-speed/records.php'; $fixtureJson = ob_get_contents(); }
    finally { while (ob_get_level() > $level) ob_end_clean(); }
    $fixture = json_decode($fixtureJson, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($fixture) || !isset($fixture['mailboxes'])) throw new RuntimeException('Invalid records fixture result');
    foreach (['/tmp/action-speed/transport.jsonl','/www/html/public/action-speed-trace.jsonl','/tmp/action-speed/close.jsonl','/www/html/public/action-speed-close-trace.jsonl'] as $trace) {
        if (file_put_contents($trace, '', LOCK_EX) === false) throw new RuntimeException('Cannot clear fixture trace');
    }
    // Publish the new generation last while all locks are still held. A queued
    // old-generation request is then rejected before it can touch reset records.
    $atomic('/tmp/action-speed/generation.txt', $generation."\n");
    $fixture['generation'] = $generation;
    echo json_encode($fixture, JSON_THROW_ON_ERROR);
} finally {
    foreach (array_reverse($handles) as $handle) { flock($handle, LOCK_UN); fclose($handle); }
}
