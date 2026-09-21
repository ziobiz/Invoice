import bcrypt from 'bcryptjs';
import { query } from './pool.js';
import { config } from '../config.js';

/** Bank block from dealmai Proforma Invoice Excel template */
const OTL_KR_BANK = JSON.stringify({
  bankName: 'Shinhan Bank',
  accountNo: '180-009-637906',
  accountName: 'ONTHELINE CO., LTD.',
  bankAddress: '1F LOTTE CASTLE GOLD, 269, Olympic-ro, Songpa-gu, Seoul, Korea',
  branchName: 'Jamsil Lotte Castle Branch',
  swiftCode: 'SHBKKRSE',
  website: 'www.onthelinem.com / www.dealmai.com',
  fax: '+82 (0) 504 444 7899',
});

async function seed() {
  const existing = await query('SELECT id FROM admins LIMIT 1');
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(config.adminPassword, 12);
    await query(
      `INSERT INTO admins (email, password_hash, name, role)
       VALUES ($1, $2, $3, 'hq')`,
      [config.adminEmail, hash, config.adminName],
    );
    console.log(`Seeded admin: ${config.adminEmail}`);
  } else {
    console.log('Admin already exists, skip');
  }

  const sites = await query('SELECT id FROM sites LIMIT 1');
  if (sites.rowCount === 0) {
    const seller = await query<{ id: string }>(
      `INSERT INTO parties (code, kind, legal_name, trade_name, country, address, phone, bank_info, signatory_name, signatory_title)
       VALUES (
         'OTL-KR', 'seller', 'ONTHELINE Co., Ltd.', 'On The Line Korea', 'KR',
         '806, AU Tower, 68, Achasan-ro, Seongdong-gu, Seoul, Republic of Korea',
         '+82 (0) 70 8286 1053', $1, 'BYOUNGSUN YI', 'CEO'
       ) RETURNING id`,
      [OTL_KR_BANK],
    );
    const buyer = await query<{ id: string }>(
      `INSERT INTO parties (code, kind, legal_name, trade_name, country, address, phone, signatory_name, signatory_title)
       VALUES (
         'OTL-JP', 'buyer',
         'ON THE LINE JAPAN CO., LTD',
         NULL,
         'JP',
         '9th Floor, Nihon Building Annex 1-2-18, Nihonbashi-kayabacho, Chuoku, Tokyo, Japan',
         '+81-6-4705-8511',
         'HIROSHI TAKEDA',
         'DIRECTOR'
       ) RETURNING id`,
    );
    const product = await query<{ id: string }>(
      `INSERT INTO products (code, name, description, unit, default_currency)
       VALUES ('USDT-PURCHASE', 'USDT Purchase', 'Virtual asset (USDT) purchase settlement', 'USDT', 'USD')
       RETURNING id`,
    );
    const site = await query<{ id: string }>(
      `INSERT INTO sites (code, name, notes)
       VALUES ('tinpass', 'TINPASS', 'Primary crypto site — webhook MVP')
       RETURNING id`,
    );
    await query(
      `INSERT INTO site_mappings (site_id, seller_party_id, buyer_party_id, product_id)
       VALUES ($1, $2, $3, $4)`,
      [site.rows[0].id, seller.rows[0].id, buyer.rows[0].id, product.rows[0].id],
    );
    console.log('Seeded demo parties/product/site mapping for tinpass');
  }

  // Keep seller bank details aligned with Excel template (idempotent update)
  await query(
    `UPDATE parties SET
       legal_name = 'ONTHELINE Co., Ltd.',
       address = '806, AU Tower, 68, Achasan-ro, Seongdong-gu, Seoul, Republic of Korea',
       phone = '+82 (0) 70 8286 1053',
       bank_info = $1,
       signatory_name = COALESCE(NULLIF(signatory_name,''), 'BYOUNGSUN YI'),
       signatory_title = COALESCE(NULLIF(signatory_title,''), 'CEO'),
       updated_at = NOW()
     WHERE code = 'OTL-KR'`,
    [OTL_KR_BANK],
  );
  await query(
    `UPDATE parties SET
       legal_name = 'ON THE LINE JAPAN CO., LTD',
       address = '9th Floor, Nihon Building Annex 1-2-18, Nihonbashi-kayabacho, Chuoku, Tokyo, Japan',
       phone = '+81-6-4705-8511',
       signatory_name = COALESCE(NULLIF(signatory_name,''), 'HIROSHI TAKEDA'),
       signatory_title = COALESCE(NULLIF(signatory_title,''), 'DIRECTOR'),
       updated_at = NOW()
     WHERE code = 'OTL-JP'`,
  );
  console.log('Synced OTL party profiles from Excel PI template');

  // DealMai site (idempotent) — ChillPay settle + ontheline Paid → webhook
  {
    let dealmai = await query<{ id: string }>(`SELECT id FROM sites WHERE code = 'dealmai'`);
    if (dealmai.rowCount === 0) {
      dealmai = await query<{ id: string }>(
        `INSERT INTO sites (code, name, notes)
         VALUES ('dealmai', 'DealMai', 'DealMai.com — ChillPay + ontheline paid webhooks')
         RETURNING id`,
      );
      console.log('Seeded site: dealmai');
    } else {
      console.log('Site dealmai already exists, skip insert');
    }

    let product = await query<{ id: string }>(
      `SELECT id FROM products WHERE code = 'DEALMAI-PACKAGE'`,
    );
    if (product.rowCount === 0) {
      product = await query<{ id: string }>(
        `INSERT INTO products (code, name, description, unit, default_currency, remark)
         VALUES (
           'DEALMAI-PACKAGE',
           'DealMai Package',
           'DealMai membership / credit package settlement',
           'PKG',
           'USD',
           'DealMai digital package'
         )
         RETURNING id`,
      );
      console.log('Seeded product: DEALMAI-PACKAGE');
    }

    const seller = await query<{ id: string }>(`SELECT id FROM parties WHERE code = 'OTL-KR'`);
    const buyer = await query<{ id: string }>(`SELECT id FROM parties WHERE code = 'OTL-JP'`);
    if (seller.rowCount && buyer.rowCount && product.rowCount) {
      const map = await query(
        `SELECT id FROM site_mappings WHERE site_id = $1`,
        [dealmai.rows[0].id],
      );
      if (map.rowCount === 0) {
        await query(
          `INSERT INTO site_mappings (site_id, seller_party_id, buyer_party_id, product_id)
           VALUES ($1, $2, $3, $4)`,
          [dealmai.rows[0].id, seller.rows[0].id, buyer.rows[0].id, product.rows[0].id],
        );
        console.log('Seeded site_mapping for dealmai → OTL-KR / OTL-JP / DEALMAI-PACKAGE');
      } else {
        console.log('Site mapping for dealmai already exists, skip insert');
      }
    } else {
      console.warn('Skip dealmai mapping — missing OTL parties or product');
    }
  }

  await (await import('./pool.js')).pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
