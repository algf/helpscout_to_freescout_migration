#!/usr/bin/env python3
"""Exercise the actual CLI loop with only Laravel boot and Runtime::poll replaced.

The native failure class is the real source. Children execute PHP on stdin,
without booting the app, touching a database or invoking a provider.
"""
from pathlib import Path
import base64
import json
import math
import subprocess
import sys

here = Path(__file__).resolve().parent
module = here.parents[1] / 'src/Modules/MailArrival'
container = sys.argv[1] if len(sys.argv) > 1 else 'freescout-ui-local-app-1'
entry = (module / 'run.php').read_text().replace('<?php', '', 1)
boot = """require '/www/html/vendor/autoload.php';
$app = require '/www/html/bootstrap/app.php';
$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
require_once __DIR__ . '/bootstrap.php';"""
args = "$args = getopt('', ['mailbox:', 'once', 'duration:', 'poll-seconds:']);"
assert entry.count(boot) == 1 and entry.count(args) == 1, 'CLI test seam changed'
entry = entry.replace(boot, '').replace(args, "$args = ['mailbox'=>1,'once'=>true];")
error_class = (module / 'Backend/NativeSink.php').read_text().split('/** Calls the native processor,')[0]
error_class = error_class.replace('<?php', '', 1).replace('namespace Modules\\MailArrival;', '', 1)
raw = "SQLSTATE[HY000]: General error: 1020 Record has changed since last read (SQL: insert into threads(body,email) values ('private body text','recipient@example.invalid'))"
payload = base64.b64encode(raw.encode()).decode()
results = []
for mode in ['native', 'general', 'success']:
    if mode == 'success':
        body = "return ['status'=>'success','mailbox_id'=>$id,'processed'=>0,'changed'=>0,'completed_at'=>1700000000];"
    elif mode == 'native':
        body = f'throw new NativeProcessingFailure([base64_decode("{payload}")]);'
    else:
        body = f'throw new \\RuntimeException(base64_decode("{payload}"));'
    script = ('<?php namespace Modules\\MailArrival {' + error_class +
              '\nclass Runtime { public static function poll($id) {usleep(20000);' + body + ';}}}' +
              "\nnamespace { define('STDERR', fopen('php://stderr','w'));" + entry + '\n}')
    proc = subprocess.run(['docker', 'exec', '-i', container, 'php'], input=script, text=True, capture_output=True)
    checks = []
    if mode == 'success':
        result = json.loads(proc.stdout)
        timing = result.get('poll_timing', {})
        checks += [
            (proc.returncode == 0 and not proc.stderr, 'successful CLI poll retains zero exit without failure output'),
            (result.get('status') == 'success' and result.get('mailbox_id') == 1 and result.get('completed_at') == 1700000000, 'CLI timing preserves the original runtime result'),
            (timing.get('started_at', 0) <= timing.get('finished_at', -1) and 'failed_at' not in timing, 'success records start and finish without a failure timestamp'),
        ]
    else:
        start = proc.stderr.find('{')
        timing = json.loads(proc.stderr[start:]) if start >= 0 else {}
        expected_class = 'Modules\\MailArrival\\NativeProcessingFailure' if mode == 'native' else 'RuntimeException'
        checks += [
            (proc.returncode == 1, 'CLI failure retains nonzero exit'),
            (not proc.stdout, 'CLI failure emits no success result'),
            (all(value not in proc.stderr for value in ['private body text', 'recipient@example.invalid', 'insert into threads', 'values (']), 'CLI failure never emits raw SQL, body or email values'),
            (proc.stderr.startswith('Mailbox import failed; checkpoint retained. ' + expected_class + ' '), 'existing human failure prefix and exception class remain intact'),
            (timing.get('started_at', 0) <= timing.get('failed_at', -1) and 'finished_at' not in timing, 'failure records start and failed timestamps'),
        ]
        if mode == 'native':
            checks += [
                (timing.get('sqlStates') == ['HY000'] and timing.get('driverCodes') == ['1020'], 'native CLI failure emits safe SQLSTATE and driver metadata'),
                (timing.get('safeReasons') == ['Record changed outside transaction read view'], 'native CLI failure emits only the static reason label'),
            ]
        else:
            checks += [
                (all(key not in timing for key in ['sqlStates', 'driverCodes', 'safeReasons']) and 'SQLSTATE' not in proc.stderr, 'general CLI failure emits class and timing without exception message'),
            ]
    numeric = ['started_at', 'elapsed_ms', 'finished_at' if mode == 'success' else 'failed_at']
    checks += [
        (all(type(timing.get(key)) in (int, float) and math.isfinite(timing[key]) for key in numeric), 'CLI timing fields are finite JSON numbers'),
        (timing.get('stage') == 'poll', 'CLI stage remains a fixed poll label without unmeasured provider claims'),
        (timing.get('elapsed_ms', 0) >= 15, 'CLI elapsed duration includes actual poll work'),
    ]
    for ok, label in checks:
        if not ok:
            raise AssertionError(label + ': ' + proc.stderr + proc.stdout)
        print('PASS ' + label)
    results.append({'mode': mode, 'exit_code': proc.returncode, 'stdout': proc.stdout,
                    'stderr': proc.stderr, 'passed_checks': len(checks)})
output = here / 'results'
output.mkdir(exist_ok=True)
(output / 'cli-failures.json').write_text(json.dumps(results, indent=2) + '\n')
