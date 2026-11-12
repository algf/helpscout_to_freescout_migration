#!/usr/bin/env python3
"""Run portable PHP policies without Laravel boot or app state writes using an existing PHP CLI.

Usage: python3 tests/backend/run-portable.py [existing-local-PHP-container]
With PHP on PATH, run each .php test directly with the module source path.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import sys

here = Path(__file__).resolve().parent
package = here.parents[1]
module = package / 'src/Modules/MailArrival'
container = sys.argv[1] if len(sys.argv) > 1 else 'freescout-ui-local-app-1'
outputs = here / 'results'
outputs.mkdir(exist_ok=True)
results = {}
for name, sources in {
    'engine': ['MessageReservation', 'Engine', 'FivewaysSink'],
    'runtime-guards': ['Version', 'DeploymentGuard', 'Installer', 'Runtime'],
    'outbox': ['MessageReservation', 'DeploymentGuard', 'Runtime', 'NativeSink'],
    'cadence': ['PollCadence'],
    'database-store': ['DatabaseStore'],
    'imap-dates': ['ImapProvider'],
}.items():
    test = (here / (name + '.php')).read_text()
    definitions = []
    for source in sources:
        code = (module / 'Backend' / (source + '.php')).read_text().replace('<?php', '', 1)
        code = code.replace('namespace Modules\\MailArrival;', 'namespace Modules\\MailArrival {', 1) + '\n}'
        definitions.append(code)
        marker = "require_once $argv[1].'/Backend/" + source + ".php';"
        if name != 'engine':
            test = test.replace(marker, '}\n' + code + '\nnamespace {\n')
    if name == 'engine':
        test = '\n'.join(line for line in test.splitlines() if not line.startswith('require_once '))
        test = '<?php\n' + '\n'.join(definitions) + '\nnamespace {\n' + test.replace('<?php', '', 1) + '\n}'
    proc = subprocess.run(['docker', 'exec', '-i', container, 'php'], input=test, text=True, capture_output=True)
    log = proc.stdout + proc.stderr
    (outputs / (name + '.log')).write_text(log)
    count = sum(line.startswith('PASS ') for line in proc.stdout.splitlines())
    results[name] = {'exit_code': proc.returncode, 'passed_checks': count, 'log': str(outputs / (name + '.log'))}
    print(f'{name}: {count} passed, exit {proc.returncode}')
    if proc.returncode:
        print(log)
        raise SystemExit(proc.returncode)
proc = subprocess.run([sys.executable, str(here / 'cli-failures.py'), container], text=True, capture_output=True)
log = proc.stdout + proc.stderr
(outputs / 'cli-failures.log').write_text(log)
count = sum(line.startswith('PASS ') for line in proc.stdout.splitlines())
results['cli-failures'] = {'exit_code': proc.returncode, 'passed_checks': count, 'log': str(outputs / 'cli-failures.log')}
print(f'cli-failures: {count} passed, exit {proc.returncode}')
if proc.returncode:
    print(log)
    raise SystemExit(proc.returncode)
receipt = {'at': datetime.now(timezone.utc).isoformat(), 'scope': 'standalone PHP, no Laravel boot or DB',
           'tests': results, 'total_passed_checks': sum(row['passed_checks'] for row in results.values()),
           'source_sha256': {str(path.relative_to(module)): hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in sorted(module.rglob('*.php')) if path.name != 'routes.php'}}
(outputs / 'results.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(f"Total: {receipt['total_passed_checks']} passed")
