#!/bin/bash
set -euo pipefail
# Daily backup of Postgres + PDF storage. Cron example:
# 15 3 * * * /opt/invoice-service/scripts/backup.sh

APP_DIR=/opt/invoice-service
BACKUP_ROOT=/opt/invoice-service/backups
STAMP=$(date +%Y%m%d_%H%M%S)
DEST="${BACKUP_ROOT}/${STAMP}"
mkdir -p "$DEST"

if [ -f "${APP_DIR}/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "${APP_DIR}/.env"; set +a
fi

pg_dump "$DATABASE_URL" | gzip > "${DEST}/invoice.sql.gz"
tar -czf "${DEST}/pdfs.tar.gz" -C "${PDF_STORAGE_DIR:-${APP_DIR}/storage/pdfs}" . 2>/dev/null || true

# retain 14 days
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +

echo "Backup done: $DEST"
