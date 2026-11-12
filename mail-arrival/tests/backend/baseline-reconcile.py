#!/usr/bin/env python3
"""Standalone reconciliation guard/rollback tests, without Laravel or database access."""
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[2]
container = sys.argv[1] if len(sys.argv) > 1 else 'freescout-ui-local-app-1'
parts = []
for name in ['cutover-seed.php', 'baseline-reconcile.php', 'baseline-reconcile-guard.php']:
    source = (root / 'harness' / name).read_text().replace('<?php', '', 1)
    parts.append(source.replace('namespace MailArrivalEvidence;', '', 1))
test = (root / 'harness/baseline-reconcile-test.php').read_text().replace('<?php', '', 1)
script = '<?php namespace MailArrivalEvidence {' + '\n'.join(parts) + '} namespace {' + test + '}'
result = subprocess.run(['docker', 'exec', '-i', container, 'php'], input=script, text=True, capture_output=True)
log = result.stdout + result.stderr
out = root / 'tests/backend/results'
out.mkdir(exist_ok=True)
(out / 'baseline-reconcile.log').write_text(log)
print(log, end='')
raise SystemExit(result.returncode)
