#!/bin/bash
set -euo pipefail

DB_PASS='InvSvc_$(openssl rand -hex 12)'
# Fixed generation without nested quotes issues:
DB_PASS=$(openssl rand -hex 16)
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_PASS=$(openssl rand -hex 10)

sudo -u postgres psql -c "SELECT version();" >/dev/null
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='invoice'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER invoice WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "ALTER USER invoice WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='invoice'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE invoice OWNER invoice;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE invoice TO invoice;"
sudo -u postgres psql -d invoice -c "GRANT ALL ON SCHEMA public TO invoice;"

mkdir -p /opt/invoice-service/storage/pdfs
mkdir -p /opt/invoice-service/backups

# Write secrets file (root only)
cat > /root/invoice-service-secrets.env <<EOF
DATABASE_URL=postgres://invoice:${DB_PASS}@127.0.0.1:5432/invoice
SESSION_SECRET=${SESSION_SECRET}
ADMIN_EMAIL=admin@invoice.local
ADMIN_PASSWORD=${ADMIN_PASS}
ADMIN_NAME="HQ Admin"
NODE_ENV=production
PORT=3100
PUBLIC_BASE_URL=http://153.75.235.61
PDF_STORAGE_DIR=/opt/invoice-service/storage/pdfs
WEBHOOK_MAX_SKEW_SECONDS=300
INVOICE_TZ=Asia/Seoul
EOF
chmod 600 /root/invoice-service-secrets.env

# UFW basics
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable || true

systemctl enable --now postgresql
systemctl enable --now nginx

echo "SETUP_OK"
echo "ADMIN_PASSWORD=${ADMIN_PASS}"
echo "SECRETS_FILE=/root/invoice-service-secrets.env"
node -v
npm -v
pm2 -v
psql --version
