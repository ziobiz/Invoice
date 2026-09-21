# Deploy checklist

1. Server packages: Node 20, PostgreSQL, Nginx, PM2 (done via `scripts/remote-bootstrap.sh`)
2. App at `/opt/invoice-service`
3. Secrets in `/opt/invoice-service/.env` (never in git) — seeded from `/root/invoice-service-secrets.env`
4. `npm ci && npm run build && npm run migrate && npm run seed`
5. `pm2 start dist/index.js --name invoice-service && pm2 save && pm2 startup`
6. Nginx reverse proxy → `127.0.0.1:3100` (`scripts/nginx-invoice.conf`)
7. `curl http://127.0.0.1:3100/health`
8. Open `/admin`, login, issue API key for `tinpass`
9. (Later) HTTPS via certbot when domain is ready
10. Cron: `15 3 * * * /opt/invoice-service/scripts/backup.sh`

## Smoke after deploy

```bash
curl -sS http://127.0.0.1:3100/health
# Admin UI
# Issue key → run docs/tinpass-webhook-guide.md curl example
```
