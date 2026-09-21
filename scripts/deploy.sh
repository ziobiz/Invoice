#!/bin/bash
set -euo pipefail
cd /opt/invoice-service

if [ ! -f .env ]; then
  if [ -f /root/invoice-service-secrets.env ]; then
    cp /root/invoice-service-secrets.env .env
    chmod 600 .env
  else
    echo "Missing .env"
    exit 1
  fi
fi

# Ensure production public URL
if grep -q '^PUBLIC_BASE_URL=' .env; then
  sed -i 's|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://invoice.icopay.net|' .env
else
  echo 'PUBLIC_BASE_URL=https://invoice.icopay.net' >> .env
fi

npm ci
npm run build
npm run migrate
npm run seed || true

# Multilingual PDF fonts
if [ -f scripts/ensure-fonts.sh ]; then
  sed -i 's/\r$//' scripts/ensure-fonts.sh || true
  bash scripts/ensure-fonts.sh || true
fi

mkdir -p storage/pdfs
pm2 delete invoice-service 2>/dev/null || true
pm2 start dist/index.js --name invoice-service --time
pm2 save

# Give Node a moment to bind
sleep 2

if [ -f scripts/nginx-invoice.conf ]; then
  # Do not clobber Certbot-managed SSL config
  if [ -f /etc/nginx/sites-enabled/invoice ] && grep -q 'listen 443' /etc/nginx/sites-enabled/invoice; then
    echo "Nginx SSL config present — skip overwrite"
  else
    cp scripts/nginx-invoice.conf /etc/nginx/sites-available/invoice
    ln -sf /etc/nginx/sites-available/invoice /etc/nginx/sites-enabled/invoice
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
  fi
fi

curl -fsS http://127.0.0.1:3100/health
echo
echo "Deploy OK"
