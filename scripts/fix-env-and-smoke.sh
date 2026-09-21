#!/bin/bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
for p in [Path('/root/invoice-service-secrets.env'), Path('/opt/invoice-service/.env')]:
    text = p.read_text()
    lines = []
    for line in text.splitlines():
        if line.startswith('ADMIN_NAME='):
            lines.append('ADMIN_NAME="HQ Admin"')
        else:
            lines.append(line)
    p.write_text('\n'.join(lines) + '\n')
    print('fixed', p)
PY
bash /tmp/smoke-test.sh
