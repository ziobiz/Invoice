#!/bin/bash
set -euo pipefail
cd /opt/invoice-service
sed -i 's/\r$//' scripts/backfill-official-invoices.mjs scripts/list-tinpass-kinds.sql 2>/dev/null || true
node scripts/backfill-official-invoices.mjs
echo '==== AFTER ===='
set -a
# shellcheck disable=SC1091
. ./.env
set +a
psql "$DATABASE_URL" -f scripts/list-tinpass-kinds.sql
