import bcrypt from 'bcryptjs';
import { query } from './pool.js';
import { config } from '../config.js';

/** Bank block from dealmai Proforma Invoice Excel template */
const OTL_KR_BANK = JSON.stringify({
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
      `INSERT INTO parties (code, kind, legal_name, trade_name, country, address, phone, bank_info)
       VALUES (
         'OTL-KR', 'seller', 'ONTHELINE CO.,LTD', 'On The Line Korea', 'KR',
         '806, AU Tower, 68, Achasan-ro, Seongdong-gu, Seoul, Republic of Korea',
         '+82 (0) 70 8286 1053', $1
       ) RETURNING id`,
      [OTL_KR_BANK],
    );
    const buyer = await query<{ id: string }>(
      `INSERT INTO parties (code, kind, legal_name, trade_name, country, address, phone)
       VALUES (
         'OTL-JP', 'buyer',
         'ON THE LINE JAPAN CO., LTD / Mr. HIROSHI TAKEDA / DIRECTOR',
         'On The Line Japan', 'JP',
         '9th Floor, Nihon Building Annex 1-2-18, Nihonbashi-kayabacho, Chuo-ku, Tokyo, Japan',
         '+81-6-4705-8511'
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
       legal_name = COALESCE(NULLIF(legal_name,''), 'ONTHELINE CO.,LTD'),
       address = CASE WHEN code = 'OTL-KR' THEN '806, AU Tower, 68, Achasan-ro, Seongdong-gu, Seoul, Republic of Korea' ELSE address END,
       phone = CASE WHEN code = 'OTL-KR' THEN '+82 (0) 70 8286 1053' ELSE phone END,
       bank_info = CASE WHEN code = 'OTL-KR' THEN $1 ELSE bank_info END,
       updated_at = NOW()
     WHERE code = 'OTL-KR'`,
    [OTL_KR_BANK],
  );
  await query(
    `UPDATE parties SET
       legal_name = 'ON THE LINE JAPAN CO., LTD / Mr. HIROSHI TAKEDA / DIRECTOR',
       address = '9th Floor, Nihon Building Annex 1-2-18, Nihonbashi-kayabacho, Chuo-ku, Tokyo, Japan',
       phone = '+81-6-4705-8511',
       updated_at = NOW()
     WHERE code = 'OTL-JP'`,
  );
  console.log('Synced OTL party profiles from Excel PI template');

  await (await import('./pool.js')).pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
