# Cloudflare setup for invoice.icopay.net

## Goal

Put `invoice.icopay.net` behind Cloudflare (orange-cloud proxy) while keeping the VPS Origin at `153.75.235.61` with existing Let's Encrypt certificates.

## Steps

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) and open (or add) the `icopay.net` zone.
2. If the zone is new, replace registrar nameservers with Cloudflare's nameservers and wait for active status.
3. **DNS → Records → Add record**
   - Type: `A`
   - Name: `invoice`
   - IPv4: `153.75.235.61`
   - Proxy status: **Proxied** (orange cloud)
   - TTL: Auto
4. **SSL/TLS → Overview**
   - Encryption mode: **Full (strict)**
   - Origin already has a valid Let's Encrypt cert for `invoice.icopay.net`
5. **SSL/TLS → Edge Certificates**
   - Always Use HTTPS: On
6. **Turnstile** (login bot protection)
   - Create a widget for `invoice.icopay.net`
   - Copy Site Key + Secret Key
   - Paste into Invoice Admin → **Platform** → Turnstile fields, enable Turnstile, Save
7. (Optional) **API Tokens**
   - Create a token with Zone → DNS Read for `icopay.net`
   - Paste Token + Zone ID into Platform settings
   - Dashboard then shows live DNS record status

## Origin notes

- Nginx on the VPS continues to terminate TLS for Full (strict).
- Express uses `trust proxy` so `X-Forwarded-Proto` from Cloudflare is honored for secure cookies.
- Do not point the record to Cloudflare Pages/Workers for this service; keep Origin = VPS.

## Verify

```bash
dig +short invoice.icopay.net
# should return Cloudflare anycast IPs when proxied

curl -fsS https://invoice.icopay.net/health
```

Open https://invoice.icopay.net/admin — first screen after login is the Cloudflare checklist dashboard.
