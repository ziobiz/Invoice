# DealMai → Invoice Service 연동

DealMai는 결제 확정 후 Invoice Service(`invoice.icopay.net`)로 웹훅을 보냅니다. PDF는 DealMai에 두지 않습니다.

## 호출 시점

| 경로 | 파일 | 조건 |
|------|------|------|
| ChillPay (직접결제) | `settle-order.js` → `invoice-service.js` | 주문 paid 확정 후 (best effort) |
| ontheline Paid | `ontheline-webhook.js` | Paid 프로비저닝 완료 후 (best effort) |

실패해도 주문·이메일·DM Champ는 롤백하지 않습니다. 결과는 `orders.invoiceService`에 저장됩니다.

## Netlify / VPS 환경변수

```
INVOICE_BASE_URL=https://invoice.icopay.net
INVOICE_API_KEY=inv_...          # Invoice Admin → Sites → dealmai → Create key
INVOICE_HMAC_SECRET=...          # 키 발급 시 1회만 표시
INVOICE_SITE_CODE=dealmai        # 생략 시 dealmai
```

키가 없으면 웹훅은 skip 로그만 남기고 통과합니다.

## Invoice 쪽 준비

1. seed로 site `dealmai` + product `DEALMAI-PACKAGE` + 매핑(OTL-KR → OTL-JP) 생성
2. Admin에서 API 키 발급
3. DealMai env에 반영 후 Netlify/VPS 재배포

## DealMai Admin에서 보기

**Sales → Invoice** (`/admin/invoices`) — TINPASS와 같이 사이트 Admin에서 목록·PDF를 봅니다.

- 프록시: `GET /api/invoices`, `GET /api/invoices/:id/pdf` (Firebase admin 토큰 필요)
- 서버 env의 `INVOICE_API_KEY`로 `invoice.icopay.net`을 호출합니다 (키는 브라우저에 노출되지 않음)

HQ 전체 조회·재발행·감사는 https://invoice.icopay.net/admin 을 사용합니다.
