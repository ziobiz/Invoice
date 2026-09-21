# TINPASS → Invoice Service 웹훅 연동 가이드

Invoice Service가 준비된 뒤, TINPASS(또는 dealmai/pentakleva)는 **거래 COMPLETED 시 아래 웹훅만 송신**하면 됩니다. PDF 생성 로직은 사이트에 두지 않습니다.

## Endpoint

```
POST {INVOICE_BASE_URL}/v1/webhooks/transactions/completed
```

## Headers

| Header | 필수 | 설명 |
|--------|------|------|
| `Content-Type` | Y | `application/json` |
| `X-Api-Key` | Y | Invoice 관리 UI에서 발급한 사이트 키 |
| `X-Signature` | Y | `hex(HMAC-SHA256(rawBody, hmacSecret))` |
| `X-Idempotency-Key` | Y | 이벤트당 고유 키 (재시도 시 동일 값) |
| `X-Timestamp` | 권장 | Unix epoch seconds. 허용 오차 기본 300초 |

## Body

```json
{
  "site": "tinpass",
  "event": "transaction.completed",
  "occurredAt": "2026-09-18T12:00:00+09:00",
  "transactionId": "T-20260918-0001",
  "ticketNo": "TK-10001",
  "amount": "1000.00",
  "currency": "USD",
  "asset": "USDT",
  "assetAmount": "1000.000000",
  "buyerRef": "optional-customer-id",
  "sellerEntityCode": "optional-override",
  "buyerEntityCode": "optional-override",
  "productCode": "optional-override",
  "memo": ""
}
```

- `sellerEntityCode` / `buyerEntityCode` / `productCode` 생략 시 사이트 기본 매핑 사용
- 동일 `X-Idempotency-Key` 재수신 → **새 인보이스 없음**, 기존 반환 (`idempotentReplay: true`)

## Node.js 예시 (복사 가능)

```js
import crypto from 'node:crypto';

const INVOICE_BASE_URL = process.env.INVOICE_BASE_URL; // e.g. https://invoice.example.com
const API_KEY = process.env.INVOICE_API_KEY;
const HMAC_SECRET = process.env.INVOICE_HMAC_SECRET;

export async function sendCompletedInvoiceWebhook(payload, idempotencyKey) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(body, 'utf8')
    .digest('hex');
  const ts = Math.floor(Date.now() / 1000).toString();

  const res = await fetch(`${INVOICE_BASE_URL}/v1/webhooks/transactions/completed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
      'X-Signature': signature,
      'X-Idempotency-Key': idempotencyKey,
      'X-Timestamp': ts,
    },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Invoice webhook failed: ${res.status}`);
    err.status = res.status;
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  }
  return data;
}

// 호출 예
await sendCompletedInvoiceWebhook(
  {
    site: 'tinpass',
    event: 'transaction.completed',
    occurredAt: new Date().toISOString(),
    transactionId: 'T-...',
    ticketNo: '...',
    amount: '1000.00',
    currency: 'USD',
    asset: 'USDT',
    assetAmount: '1000.000000',
  },
  `tinpass:tx:T-...:completed`, // 안정적 멱등 키 권장
);
```

## 응답

**201 Created** (신규) / **200 OK** (멱등 재생)

```json
{
  "idempotentReplay": false,
  "invoice": {
    "id": "uuid",
    "invoiceNo": "TINPASS-2026-000001",
    "status": "issued",
    "issuedAt": "...",
    "amount": "1000.00",
    "currency": "USD",
    "pdfHash": "..."
  }
}
```

## 조회 / PDF

```
GET /v1/invoices
GET /v1/invoices/:id
GET /v1/invoices/:id/pdf
POST /v1/invoices/:id/reissue
```

모두 `X-Api-Key` 필요 (HMAC은 웹훅에만 필수).

## 재시도 권장

| 상태 | 동작 |
|------|------|
| 2xx | 성공, 재시도 금지 |
| 4xx (서명/키/매핑) | 수정 후 동일 멱등키로 재시도 가능. 로직 알림 |
| 5xx / 네트워크 | 지수 백오프 재시도, **동일 Idempotency-Key 유지** |

## TINPASS (Crypto) 운영 연동

Crypto 백엔드는 USDT 매입 상태가 `COMPLETED`로 전이될 때 위 웹훅을 자동 송신합니다.

서버 `backend/.env` (Git 금지):

```
INVOICE_BASE_URL=https://invoice.icopay.net
INVOICE_API_KEY=...
INVOICE_HMAC_SECRET=...
INVOICE_SITE_CODE=tinpass
INVOICE_WEBHOOK_ENABLED=true
```

키 발급: Invoice 서버에서 `scripts/remote-issue-tinpass-key.sh` (또는 Admin → Sites → Issue key).

## curl 스모크 테스트

```bash
BODY='{"site":"tinpass","event":"transaction.completed","occurredAt":"2026-09-18T12:00:00+09:00","transactionId":"T-DEMO-1","ticketNo":"TK-1","amount":"1000.00","currency":"USD","asset":"USDT","assetAmount":"1000.000000"}'
SECRET='your-hmac-secret'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -sS -X POST "$INVOICE_BASE_URL/v1/webhooks/transactions/completed" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_KEY" \
  -H "X-Signature: $SIG" \
  -H "X-Idempotency-Key: demo-1" \
  -H "X-Timestamp: $(date +%s)" \
  -d "$BODY"
```
