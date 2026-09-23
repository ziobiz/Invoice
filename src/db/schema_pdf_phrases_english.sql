-- Invoice PDF system phrases are English by design (admin UI may be multilingual).
-- Restore any Hangul/CJK that was saved from a localized admin session into English defaults.

UPDATE sites SET
  pdf_payment_terms = 'The above TOTAL amount must be deposited in full (The remittance fee is to be paid by the remitter)'
WHERE pdf_payment_terms IS NOT NULL
  AND pdf_payment_terms ~ '[가-힣ぁ-んァ-ン一-龯]';

UPDATE sites SET
  pdf_payment_due = 'Please deposit by the due date'
WHERE pdf_payment_due IS NOT NULL
  AND pdf_payment_due ~ '[가-힣ぁ-んァ-ン一-龯]';

UPDATE sites SET
  pdf_simulator_watermark_text = NULL
WHERE pdf_simulator_watermark_text IS NOT NULL
  AND pdf_simulator_watermark_text ~ '[가-힣ぁ-んァ-ン一-龯]';
