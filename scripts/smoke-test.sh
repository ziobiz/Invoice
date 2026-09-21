#!/bin/bash
set -euo pipefail
# shellcheck disable=SC1091
source /root/invoice-service-secrets.env
BASE=http://127.0.0.1:3100

echo "=== health ==="
curl -fsS "$BASE/health"; echo

# Login via cookie jar
JAR=/tmp/inv-cookies.txt
rm -f "$JAR"
curl -fsS -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  "$BASE/admin/api/auth/login"; echo

SITE_ID=$(curl -fsS -c "$JAR" -b "$JAR" "$BASE/admin/api/sites" | python3 -c "import sys,json; print(json.load(sys.stdin)['items'][0]['id'])")
echo "SITE_ID=$SITE_ID"

KEY_JSON=$(curl -fsS -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' \
  -d '{"label":"smoke"}' "$BASE/admin/api/sites/${SITE_ID}/keys")
echo "$KEY_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print('API_KEY='+d['apiKey']); print('HMAC='+d['hmacSecret'])"
API_KEY=$(echo "$KEY_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiKey'])")
HMAC=$(echo "$KEY_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['hmacSecret'])")

BODY='{"site":"tinpass","event":"transaction.completed","occurredAt":"2026-09-18T12:00:00+09:00","transactionId":"T-SMOKE-1","ticketNo":"TK-1","amount":"1000.00","currency":"USD","asset":"USDT","assetAmount":"1000.000000","memo":"smoke test"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$HMAC" | awk '{print $2}')
TS=$(date +%s)

echo "=== webhook ==="
curl -fsS -X POST "$BASE/v1/webhooks/transactions/completed" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_KEY" \
  -H "X-Signature: $SIG" \
  -H "X-Idempotency-Key: smoke-1" \
  -H "X-Timestamp: $TS" \
  -d "$BODY"; echo

echo "=== webhook idempotent replay ==="
curl -fsS -X POST "$BASE/v1/webhooks/transactions/completed" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_KEY" \
  -H "X-Signature: $SIG" \
  -H "X-Idempotency-Key: smoke-1" \
  -H "X-Timestamp: $TS" \
  -d "$BODY"; echo

echo "=== list invoices ==="
curl -fsS -H "X-Api-Key: $API_KEY" "$BASE/v1/invoices"; echo

INV_ID=$(curl -fsS -H "X-Api-Key: $API_KEY" "$BASE/v1/invoices" | python3 -c "import sys,json; print(json.load(sys.stdin)['items'][0]['id'])")
echo "=== pdf ==="
curl -fsS -H "X-Api-Key: $API_KEY" -o /tmp/smoke-invoice.pdf "$BASE/v1/invoices/${INV_ID}/pdf"
file /tmp/smoke-invoice.pdf
ls -la /tmp/smoke-invoice.pdf

echo "SMOKE_OK"
echo "ADMIN_EMAIL=${ADMIN_EMAIL}"
echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}"
