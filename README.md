# Invoice Service

얇은 통합 인보이스 API 서버. 여러 사이트(tinpass / dealmai / pentakleva 등)에서 거래 `COMPLETED` 웹훅을 받아 인보이스를 자동 채번·PDF 생성·보관하고, 사이트/본사가 조회·재발행·다운로드·감사 export 한다.

## 확정 스택

| 영역 | 선택 |
|------|------|
| Runtime | Node.js 20 + TypeScript + Express |
| DB | PostgreSQL 14+ |
| PDF | PDFKit (서버 사이드, Chromium 불필요) |
| Auth | 사이트: API Key + HMAC-SHA256 / 관리자: 세션 로그인 |
| Process | PM2 |
| Proxy | Nginx |
| Admin UI | 단일 페이지 (`/admin`) |

## 폴더 구조

```
invoice-service/
  src/
    index.ts              # Express entry
    config.ts
    db/                   # schema, migrate, seed, pool
    middleware/           # API key, HMAC, admin session
    routes/               # auth, admin, webhooks, invoices
    services/             # invoice issue, PDF, numbering, keys
  public/admin.html       # 관리자 UI
  docs/                   # TINPASS 연동 가이드
  scripts/                # deploy / backup
  .env.example
```

## 가정 (Assumptions)

1. **채번**: `{SITECODE}-{YYYY}-{NNNNNN}` (예: `TINPASS-2026-000001`). 사이트+연도별 시퀀스.
2. **타임존**: `INVOICE_TZ=Asia/Seoul` (연도 계산은 `occurredAt`의 로컬 연도 사용 — 현재는 `Date#getFullYear()`).
3. **기본 매핑**: 웹훅에 seller/buyer/product 미지정 시 `site_mappings` 사용.
4. **멱등**: `(site_id, X-Idempotency-Key)` UNIQUE. 재수신 시 기존 인보이스 반환 (201→200).
5. **HMAC**: `X-Signature` = hex(HMAC-SHA256(rawBody, hmacSecret)). 선택 헤더 `X-Timestamp` (unix sec) 스큐 검증.
6. **PDF 템플릿**: v1 단일 양식. 버전은 코드로 관리.

## 로컬 실행

```bash
cp .env.example .env
# DATABASE_URL, SESSION_SECRET, ADMIN_* 설정

npm install
npm run migrate
npm run seed
npm run dev
```

- Health: `GET /health`
- Admin UI: `http://localhost:3100/admin`

## 주요 API

### Webhook (사이트 → Invoice)

`POST /v1/webhooks/transactions/completed`

Headers:
- `X-Api-Key`
- `X-Signature` (HMAC-SHA256 hex of raw body)
- `X-Idempotency-Key` (필수)
- `X-Timestamp` (권장)

### Site API

- `GET /v1/invoices`
- `GET /v1/invoices/:id`
- `GET /v1/invoices/:id/pdf`
- `POST /v1/invoices/:id/reissue`

### Admin API (세션)

- `/admin/api/auth/login|logout|me`
- `/admin/api/sites`, `/admin/api/sites/:id/keys`
- `/admin/api/parties`, `/admin/api/products`, `/admin/api/mappings/:siteId`
- `/admin/api/invoices`, `/admin/api/audit/export`

상세 예시는 `docs/tinpass-webhook-guide.md`.

## 역할 분담

| 책임 | 위치 |
|------|------|
| 채번·PDF·원본·감사 | **이 서버** |
| 웹훅 송신 + 관리자 조회 UX | 각 사이트 |
| 마스터(판매/발주/상품/키) | Invoice 관리 UI |

TINPASS/NOTI 본체에 PDF 엔진을 넣지 않는다. TINPASS 송신 코드는 이 API가 준비된 뒤 **별도 지시**로 추가한다.

## 배포 (Ubuntu)

```bash
# 서버에서
cd /opt/invoice-service
cp /root/invoice-service-secrets.env .env   # 실키는 repo 밖
npm ci
npm run build
npm run migrate
npm run seed
pm2 start dist/index.js --name invoice-service
pm2 save
```

Nginx 예시는 `scripts/nginx-invoice.conf`. HTTPS는 certbot 권장.

## 보안

- API 키는 SHA-256 해시 저장, 평문 키는 발급 시 1회만 표시
- HMAC secret은 서버 DB에 보관 (MVP). 운영 시 디스크 암호화/백업 분리
- 비밀번호·실키는 Git에 커밋하지 말 것
- 일 백업: `scripts/backup.sh`
