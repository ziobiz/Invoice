#!/bin/bash
set -euo pipefail
# Configure invoice.icopay.net + Let's Encrypt HTTPS

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y certbot python3-certbot-nginx fonts-noto-cjk

cp /opt/invoice-service/scripts/nginx-invoice.conf /etc/nginx/sites-available/invoice
ln -sf /etc/nginx/sites-available/invoice /etc/nginx/sites-enabled/invoice
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Obtain / renew cert (non-interactive)
certbot --nginx -d invoice.icopay.net --non-interactive --agree-tos --email admin@icopay.net --redirect || {
  echo "CERTBOT_WARN: will retry once"
  sleep 3
  certbot --nginx -d invoice.icopay.net --non-interactive --agree-tos --email admin@icopay.net --redirect
}

# Update app env for HTTPS cookies
if [ -f /opt/invoice-service/.env ]; then
  sed -i 's|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://invoice.icopay.net|' /opt/invoice-service/.env
fi
if [ -f /root/invoice-service-secrets.env ]; then
  sed -i 's|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://invoice.icopay.net|' /root/invoice-service-secrets.env
fi

pm2 restart invoice-service --update-env
sleep 1
curl -fsS https://invoice.icopay.net/health || curl -fsS http://invoice.icopay.net/health
echo
echo "DOMAIN_SSL_OK"
