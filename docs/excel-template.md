# Proforma Invoice template (dealmai Excel)

Source file: `templates/proforma-invoice-dealmai.xlsx`  
Sheet: `PI`

The PDF engine (`src/services/pdf.ts`) reproduces this layout:

1. Seller header (legal name, address, tel/fax, website)
2. Title: **PROFORMA INVOICE**
3. Messrs (buyer) + P/I No. / Date
4. Intro + Origin / Price / Payment / Delivery terms
5. Line table: Item | Description | Unit Price | Unit | Amount | Remark
6. TOTAL
7. Payment block + bank remarks (from seller `bank_info` JSON)
8. Accepted by / Yours very truly

Webhook invoices fill one (or more) dynamic line rows from product mapping + transaction amount/currency — not the full static catalog of zero-qty rows from the sample Excel.
