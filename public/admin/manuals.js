/** Invoice Service — single consolidated ops manual (TINPASS-style viewer) */
(function (global) {
  'use strict';

  const CURRENT_LIVE_VERSION = '1.2.11';

  function L(ko, en, ja, zh, th) {
    return { ko, en, ja: ja || en, zh: zh || en, th: th || en };
  }

  /** @type {{ version: string, kind: 'major'|'minor', date: string, items: Record<string,string[]> }[]} */
  const RELEASE_NOTES = [
    {
      version: '1.2.11',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '운영기록: 제목·표 헤더(시각·작업·이용자·사이트·인보이스·내용·IP) 가운데 정렬. 「누가」→「이용자」.',
        ],
        en: [
          'Operation log: center-align title and column headers; Who → User.',
        ],
        ja: [
          '運用記録: タイトル・表ヘッダーを中央揃え。「実行者」→「利用者」。',
        ],
        zh: [
          '运营记录：标题与表头居中；「操作者」改为「利用者」。',
        ],
        th: [
          'บันทึกการดำเนินงาน: จัดกึ่งกลางหัวข้อและหัวตาราง; ผู้ทำ → ผู้ใช้',
        ],
      },
    },
    {
      version: '1.2.10',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          'PDF Remarks 메타줄: Ticket / Transaction ID / 메모 구분자로 통일.',
          '재발급 시 사용자 열에 재발급한 관리자(별칭/이메일) 표시.',
        ],
        en: [
          'PDF Remarks meta line uses Ticket / Transaction ID / memo separators.',
          'Reissue shows the reissuing admin in the User column.',
        ],
        ja: [
          'PDF Remarksメタ行: Ticket / Transaction ID / メモ区切りに統一。',
          '再発行時にユーザー列へ再発行した管理者を表示。',
        ],
        zh: [
          'PDF Remarks 元数据行统一为 Ticket / Transaction ID / 备注。',
          '重开时用户列显示执行重开的管理员。',
        ],
        th: [
          'บรรทัดเมตา PDF Remarks ใช้คั่น Ticket / Transaction ID / หมายเหตุ',
          'การออกใหม่แสดงแอดมินที่ออกใหม่ในคอลัมน์ผู้ใช้',
        ],
      },
    },
    {
      version: '1.2.9',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '인보이스 상태: 정상(API)·수정(파스텔 빨강)·재생성·재발급·삭제로 표시.',
        ],
        en: [
          'Invoice status: Normal (API), Edited (pastel red), Regenerated, Reissued, Deleted.',
        ],
        ja: [
          '請求書ステータス: 正常(API)・修正(パステル赤)・再生成・再発行・削除。',
        ],
        zh: [
          '发票状态：正常(API)、已修改(粉红)、已重生成、已重开、已删除。',
        ],
        th: [
          'สถานะใบแจ้งหนี้: ปกติ(API) / แก้ไข(แดงพาสเทล) / สร้างใหม่ / ออกใหม่ / ลบ',
        ],
      },
    },
    {
      version: '1.2.8',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '웹훅으로 발행된 인보이스 사용자 열에 API 표시 (관리자 수동 작업은 기존처럼 별칭/이메일).',
        ],
        en: [
          'Webhook-issued invoices show API in the User column (admin actions still show alias/email).',
        ],
        ja: [
          'Webhook発行の請求書はユーザー列に API と表示（管理者操作は従来どおり別名/メール）。',
        ],
        zh: [
          'Webhook 开具的发票在“用户”列显示 API（管理员操作仍显示别名/邮箱）。',
        ],
        th: [
          'ใบแจ้งหนี้จาก webhook แสดง API ในคอลัมน์ผู้ใช้ (การกระทำแอดมินยังแสดงนามแฝง/อีเมล)',
        ],
      },
    },
    {
      version: '1.2.7',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          'PDF Remarks: Swift Code·Ticket 줄 여백을 위 은행 항목과 동일 줄간격·글자 크기로 통일.',
        ],
        en: [
          'PDF Remarks: Swift Code and Ticket lines use the same line gap and font size as bank rows.',
        ],
        ja: [
          'PDF Remarks: Swift Code・Ticket行の余白を上の銀行項目と同じ行間・フォントに統一。',
        ],
        zh: [
          'PDF Remarks：Swift Code 与 Ticket 行间距、字号与上方银行行一致。',
        ],
        th: [
          'PDF Remarks: ระยะห่างและขนาดฟอนต์ของ Swift Code/Ticket ให้เท่าแถวธนาคารด้านบน',
        ],
      },
    },
    {
      version: '1.2.6',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          'PDF Remarks: Bank Name을 A/C Name 다음 순서로 출력.',
          '하단 메타줄: Ticket · Transaction ID · / 메모 형식 (앞에 - 표시).',
        ],
        en: [
          'PDF Remarks: Bank Name printed after A/C Name.',
          'Meta line: Ticket · Transaction ID · / memo (prefixed with -).',
        ],
        ja: [
          'PDF Remarks: Bank Name を A/C Name の次に出力。',
          'メタ行: Ticket · Transaction ID · / メモ（先頭に -）。',
        ],
        zh: [
          'PDF Remarks：Bank Name 紧接 A/C Name 之后。',
          '元数据行：Ticket · Transaction ID · / 备注（前缀 -）。',
        ],
        th: [
          'PDF Remarks: แสดง Bank Name หลัง A/C Name',
          'บรรทัดเมตา: Ticket · Transaction ID · / หมายเหตุ (ขึ้นต้นด้วย -)',
        ],
      },
    },
    {
      version: '1.2.5',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '공급처 은행 정보에 Bank Name(은행명) 필드 추가 — PDF Remarks에 출력.',
        ],
        en: [
          'Seller bank info: Bank Name field added — printed in PDF Remarks.',
        ],
        ja: [
          '供給先銀行情報に Bank Name（銀行名）を追加 — PDF Remarks に出力。',
        ],
        zh: [
          '卖方银行信息增加 Bank Name（银行名）— 写入 PDF Remarks。',
        ],
        th: [
          'เพิ่ม Bank Name ในข้อมูลธนาคารผู้ขาย — แสดงใน PDF Remarks',
        ],
      },
    },
    {
      version: '1.2.4',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '발주처/공급처: 담당자·서명자 성명·직책 필드를 거래처에서 직접 수정 (PDF Messrs·서명 블록 반영).',
          '사이트 서명자 성명/직책은 거래처 값이 없을 때만 폴백. REMARKS·NOTICE 노출 설정은 변경 없음.',
        ],
        en: [
          'Parties: contact/signatory name and title editable on buyer/seller (PDF Messrs + signature).',
          'Site signatory is fallback only when party fields are empty. REMARKS/NOTICE toggles unchanged.',
        ],
        ja: [
          '取引先: 担当者/署名者の氏名・役職を発注先・供給先で編集（PDF Messrs・署名欄）。',
          'サイト署名者は取引先が空のときのみフォールバック。REMARKS・NOTICE表示設定は変更なし。',
        ],
        zh: [
          '交易方：买方/卖方可编辑联系人与签署人姓名、职务（写入 PDF Messrs 与签署区）。',
          '站点签署人仅在交易方为空时回退。REMARKS/NOTICE 显示设置不变。',
        ],
        th: [
          'คู่ค้า: แก้ชื่อ/ตำแหน่งผู้ติดต่อและผู้ลงนามที่ผู้ซื้อ/ผู้ขาย (ขึ้น PDF Messrs + ลายเซ็น)',
          'ผู้ลงนามในไซต์เป็นสำรองเมื่อคู่ค้าว่าง REMARKS/NOTICE ไม่เปลี่ยน',
        ],
      },
    },
    {
      version: '1.2.3',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '상품군: 수정·삭제에 더해 거래처와 동일한 복사 기능 추가 (새 코드 필수, 수정 시 코드 잠금).',
        ],
        en: [
          'Products: copy like parties (new code required; code locked on edit), plus edit/delete.',
        ],
        ja: [
          '商品: 取引先と同じコピー機能を追加（新コード必須、編集時コードロック）。',
        ],
        zh: [
          '商品：增加与交易方相同的复制功能（需新代码；编辑时锁定代码）。',
        ],
        th: [
          'สินค้า: เพิ่มคัดลอกแบบคู่ค้า (ต้องมีรหัสใหม่ ล็อกรหัสตอนแก้ไข)',
        ],
      },
    },
    {
      version: '1.2.2',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '회사직인(와이드형 이미지): 전체 −10% 후 높이 −30% · 좌우 +20%로 PDF 배치 조정.',
          'Admin 직인 미리보기도 동일 와이드 비율 적용.',
        ],
        en: [
          'Company seal (wide image): −10% overall, then −30% height and +20% width on PDF.',
          'Admin seal preview uses the same wide aspect ratio.',
        ],
        ja: [
          '会社印（ワイド画像）: 全体−10%後、高さ−30%・左右+20%でPDF配置を調整。',
          'Adminプレビューも同じワイド比率。',
        ],
        zh: [
          '公司印章（宽幅图片）：整体 −10% 后高度 −30%、左右 +20%。',
          '管理端预览使用相同宽幅比例。',
        ],
        th: [
          'ตราบริษัท (ภาพกว้าง): ลดทั้งก้อน −10% แล้วลดสูง −30% กว้าง +20% บน PDF',
          'ตัวอย่างใน Admin ใช้สัดส่วนกว้างเดียวกัน',
        ],
      },
    },
    {
      version: '1.2.1',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '공급처 은행 정보를 JSON 한 줄 대신 개별 입력란(A/C No·Name·Address·Branch·Swift·Fax·Website)으로 분리.',
          '비어 있는 은행 항목은 PDF Remarks에 표시하지 않음.',
        ],
        en: [
          'Supplier bank info: separate fields instead of a raw JSON textarea.',
          'Empty bank fields are omitted from PDF Remarks.',
        ],
        ja: [
          '供給元の銀行情報を個別入力欄に分割。',
          '空欄の銀行項目はPDF Remarksに出さない。',
        ],
        zh: [
          '供应方银行信息改为分项输入，不再使用整段 JSON。',
          '空的银行字段不在 PDF Remarks 中显示。',
        ],
        th: [
          'แยกช่องกรอกข้อมูลธนาคารผู้จัดหาแทน JSON ทั้งก้อน',
          'ช่องว่างจะไม่แสดงใน PDF Remarks',
        ],
      },
    },
    {
      version: '1.2.0',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '운영메뉴얼 옆에 버전업 히스토리 메뉴 추가 (TINPASS형 목록).',
          '릴리즈 노트 다국어(ko/en/ja/th/zh) 표시.',
        ],
        en: [
          'Added Version history menu next to Ops Manual (TINPASS-style list).',
          'Release notes shown in ko/en/ja/th/zh.',
        ],
        ja: [
          '運営マニュアルの横にバージョンアップ履歴メニューを追加。',
          'リリースノートを多言語表示。',
        ],
        zh: [
          '在运营手册旁新增版本升级历史菜单。',
          '发布说明支持多语言显示。',
        ],
        th: [
          'เพิ่มเมนูประวัติเวอร์ชันข้างคู่มือปฏิบัติการ',
          'แสดงบันทึกการเผยแพร่หลายภาษา',
        ],
      },
    },
    {
      version: '1.1.0',
      kind: 'minor',
      date: '2026-09-21',
      items: {
        ko: [
          '운영 메뉴얼 3종을 통합 1권으로 합침.',
          '시작하기·마스터 순서·웹훅·PDF·브랜딩·FAQ 등 11장으로 사용법 세분화.',
        ],
        en: [
          'Merged three manuals into one complete guide.',
          'Expanded to 11 chapters (setup, masters, webhook, PDF, FAQ).',
        ],
        ja: [
          'マニュアル3種を1冊に統合。',
          '11章構成で利用手順を詳細化。',
        ],
        zh: [
          '将三份手册合并为一份完整指南。',
          '扩展为 11 章使用说明。',
        ],
        th: [
          'รวมคู่มือ 3 เล่มเป็นเล่มเดียว',
          'ขยายเป็น 11 บทวิธีใช้งานละเอียด',
        ],
      },
    },
    {
      version: '1.0.0',
      kind: 'major',
      date: '2026-09-21',
      items: {
        ko: [
          'Admin에 운영메뉴얼 메뉴 추가 (시스템과 별도 최상위).',
          'TINPASS형 표지·목차·인쇄/PDF 뷰어.',
          'DealMai·TINPASS 웹훅 연동 및 Admin 인보이스 UI 정리.',
        ],
        en: [
          'Added Ops Manual top-level menu (separate from System).',
          'TINPASS-style cover, TOC, print/PDF viewer.',
          'DealMai/TINPASS webhook integration and Admin invoice UI.',
        ],
        ja: [
          '運営マニュアルをシステムとは別の最上位メニューに追加。',
          'TINPASS型の表紙・目次・印刷/PDFビューア。',
          'DealMai/TINPASS Webhook連携とAdmin UI整備。',
        ],
        zh: [
          '新增运营手册顶级菜单（独立于系统）。',
          'TINPASS 风格封面、目录、打印/PDF。',
          'DealMai/TINPASS Webhook 对接与管理端发票界面。',
        ],
        th: [
          'เพิ่มเมนูคู่มือปฏิบัติการระดับบนแยกจากระบบ',
          'ปก สารบัญ พิมพ์/PDF แบบ TINPASS',
          'เชื่อม webhook DealMai/TINPASS และ UI อินวอยซ์',
        ],
      },
    },
  ];

  function pick(map, lang) {
    const k = String(lang || 'en').slice(0, 2).toLowerCase();
    return map[k] || map.en || map.ko || '';
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  const MANUAL_CATALOG = [
    {
      id: 'ops-full',
      audience: 'hq',
      docVersion: CURRENT_LIVE_VERSION,
      titleKey: 'manual.item.opsFull',
    },
  ];

  /* Shared detailed bodies — built once per locale via L() */
  const OPS_FULL = {
    id: 'ops-full',
    coverTitle: L(
      '인보이스 서비스 통합 운영 메뉴얼',
      'Invoice Service — Complete Operations Manual',
      'インボイスサービス統合運営マニュアル',
      '发票服务完整运营手册',
      'คู่มือปฏิบัติการครบ Invoice Service',
    ),
    coverSubtitle: L(
      '메뉴·마스터·웹훅·PDF·브랜딩·보안까지 한 권으로',
      'Menus, masters, webhooks, PDF, branding, and security in one guide',
      'メニュー・マスター・Webhook・PDF・ブランディング・セキュリティを一冊に',
      '菜单、主数据、Webhook、PDF、品牌与安全合订',
      'เมนู มาสเตอร์ Webhook PDF แบรนด์และความปลอดภัยในเล่มเดียว',
    ),
    sections: [
      {
        id: 's01',
        title: L('1. 시작하기', '1. Getting started', '1. はじめに', '1. 开始使用', '1. เริ่มต้น'),
        bodyHtml: L(
          `<div class="menu-path">https://invoice.icopay.net/admin</div>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">1</span><span>언어를 선택한 뒤 이메일·비밀번호로 로그인합니다.</span></div>
            <div class="flow-row"><span class="flow-num">2</span><span>Turnstile·이메일 OTP·Authenticator(TOTP)가 켜져 있으면 안내 순서대로 인증합니다.</span></div>
            <div class="flow-row"><span class="flow-num">3</span><span>첫 로그인 시 비밀번호 변경이 요구될 수 있습니다. 변경 후 다시 로그인합니다.</span></div>
            <div class="flow-row"><span class="flow-num">4</span><span>상단에서 테마·언어·도움말(Hello)을 바꿀 수 있습니다. 도움말을 켜면 화면 안내가 더 자세히 표시됩니다.</span></div>
          </div>
          <div class="info-box">역할: <strong>HQ</strong>는 전 메뉴, <strong>Viewer</strong>는 조회 위주입니다. 키 발급·삭제·재발행은 HQ만 가능합니다.</div>`,
          `<div class="menu-path">https://invoice.icopay.net/admin</div>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">1</span><span>Pick a language, then sign in with email and password.</span></div>
            <div class="flow-row"><span class="flow-num">2</span><span>Complete Turnstile, email OTP, and/or Authenticator (TOTP) if enabled.</span></div>
            <div class="flow-row"><span class="flow-num">3</span><span>You may be asked to change the password on first login.</span></div>
            <div class="flow-row"><span class="flow-num">4</span><span>Use the top bar for theme, language, and Hello (help) mode.</span></div>
          </div>
          <div class="info-box"><strong>HQ</strong> has full access; <strong>Viewer</strong> is mostly read-only. Key issue/delete/reissue require HQ.</div>`,
          `<div class="menu-path">https://invoice.icopay.net/admin</div>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">1</span><span>言語を選び、メール・パスワードでログインします。</span></div>
            <div class="flow-row"><span class="flow-num">2</span><span>Turnstile・メールOTP・Authenticator(TOTP)が有効なら案内に従います。</span></div>
            <div class="flow-row"><span class="flow-num">3</span><span>初回はパスワード変更が求められることがあります。</span></div>
            <div class="flow-row"><span class="flow-num">4</span><span>上部でテーマ・言語・Hello(ヘルプ)を切り替えられます。</span></div>
          </div>
          <div class="info-box"><strong>HQ</strong>は全メニュー、<strong>Viewer</strong>は主に閲覧。キー発行・削除・再発行はHQのみ。</div>`,
          `<div class="menu-path">https://invoice.icopay.net/admin</div>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">1</span><span>选择语言后用邮箱和密码登录。</span></div>
            <div class="flow-row"><span class="flow-num">2</span><span>若启用 Turnstile、邮箱 OTP、Authenticator(TOTP)，按提示完成验证。</span></div>
            <div class="flow-row"><span class="flow-num">3</span><span>首次登录可能要求修改密码。</span></div>
            <div class="flow-row"><span class="flow-num">4</span><span>顶部可切换主题、语言与 Hello（帮助）模式。</span></div>
          </div>
          <div class="info-box"><strong>HQ</strong> 拥有全部权限；<strong>Viewer</strong> 以查看为主。签发/删除/重开密钥仅 HQ。</div>`,
          `<div class="menu-path">https://invoice.icopay.net/admin</div>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">1</span><span>เลือกภาษา แล้วเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน</span></div>
            <div class="flow-row"><span class="flow-num">2</span><span>ทำ Turnstile อีเมล OTP และ/หรือ Authenticator (TOTP) หากเปิดใช้</span></div>
            <div class="flow-row"><span class="flow-num">3</span><span>ครั้งแรกอาจต้องเปลี่ยนรหัสผ่าน</span></div>
            <div class="flow-row"><span class="flow-num">4</span><span>แถบบนเปลี่ยนธีม ภาษา และโหมด Hello (ช่วยเหลือ)</span></div>
          </div>
          <div class="info-box"><strong>HQ</strong> ใช้ได้ทุกเมนู <strong>Viewer</strong> ส่วนใหญ่ดูอย่างเดียว การออก/ลบคีย์เป็นของ HQ</div>`,
        ),
      },
      {
        id: 's02',
        title: L('2. 메뉴 구조', '2. Menu structure', '2. メニュー構成', '2. 菜单结构', '2. โครงสร้างเมนู'),
        bodyHtml: L(
          `<table><thead><tr><th>메뉴</th><th>하위</th><th>하는 일</th></tr></thead><tbody>
          <tr><td>대시보드</td><td>—</td><td>발행/재발행/무효 건수, 사이트별 금액, 서버 상태</td></tr>
          <tr><td>인보이스 운영</td><td>인보이스 · 사이트/키 · 거래처 · 상품 · 매핑</td><td>일상 운영·마스터·연동 키</td></tr>
          <tr><td>시스템</td><td>사용자 · 플랫폼 · 운영 로그</td><td>계정·브랜딩·보안·감사</td></tr>
          <tr><td>운영메뉴얼</td><td>—</td><td>본 문서 (시스템과 별도 최상위)</td></tr>
          </tbody></table>
          <div class="info-box">운영메뉴얼은 <strong>시스템 안이 아니라</strong> 시스템 아래(다음) 최상위 항목입니다.</div>`,
          `<table><thead><tr><th>Menu</th><th>Children</th><th>Purpose</th></tr></thead><tbody>
          <tr><td>Dashboard</td><td>—</td><td>Issued/reissued/void counts, per-site amounts, server health</td></tr>
          <tr><td>Invoice Ops</td><td>Invoices · Sites/Keys · Parties · Products · Mappings</td><td>Day-to-day ops &amp; masters</td></tr>
          <tr><td>System</td><td>Users · Platform · Operation log</td><td>Accounts, branding, security, audit</td></tr>
          <tr><td>Ops Manual</td><td>—</td><td>This document (top-level after System)</td></tr>
          </tbody></table>
          <div class="info-box">Ops Manual is <strong>not inside System</strong> — it sits as the next top-level item.</div>`,
          `<table><thead><tr><th>メニュー</th><th>下位</th><th>内容</th></tr></thead><tbody>
          <tr><td>ダッシュボード</td><td>—</td><td>発行/再発行/無効、サイト別金額、サーバー</td></tr>
          <tr><td>インボイス運用</td><td>インボイス・サイト/キー・取引先・商品・マッピング</td><td>日常運用とマスター</td></tr>
          <tr><td>システム</td><td>ユーザー・プラットフォーム・運用ログ</td><td>アカウント・ブランド・監査</td></tr>
          <tr><td>運営マニュアル</td><td>—</td><td>本ドキュメント（システムの次の最上位）</td></tr>
          </tbody></table>
          <div class="info-box">運営マニュアルは<strong>システムの中ではなく</strong>、システムの次の最上位です。</div>`,
          `<table><thead><tr><th>菜单</th><th>子项</th><th>用途</th></tr></thead><tbody>
          <tr><td>仪表盘</td><td>—</td><td>开具/重开/作废、按站点金额、服务器</td></tr>
          <tr><td>发票运营</td><td>发票 · 站点/密钥 · 交易方 · 商品 · 映射</td><td>日常运营与主数据</td></tr>
          <tr><td>系统</td><td>用户 · 平台 · 操作日志</td><td>账户、品牌、安全、审计</td></tr>
          <tr><td>运营手册</td><td>—</td><td>本文档（系统之后的顶级项）</td></tr>
          </tbody></table>
          <div class="info-box">运营手册<strong>不在系统内</strong>，而是系统下方的顶级菜单。</div>`,
          `<table><thead><tr><th>เมนู</th><th>ลูก</th><th>หน้าที่</th></tr></thead><tbody>
          <tr><td>แดชบอร์ด</td><td>—</td><td>จำนวนออก/ออกใหม่/ยกเลิก ยอดตามไซต์ สุขภาพเซิร์ฟเวอร์</td></tr>
          <tr><td>ดำเนินงานอินวอยซ์</td><td>อินวอยซ์ · ไซต์/คีย์ · คู่ค้า · สินค้า · แมป</td><td>งานประจำและมาสเตอร์</td></tr>
          <tr><td>ระบบ</td><td>ผู้ใช้ · แพลตฟอร์ม · บันทึก</td><td>บัญชี แบรนด์ ความปลอดภัย</td></tr>
          <tr><td>คู่มือปฏิบัติการ</td><td>—</td><td>เอกสารนี้ (ระดับบนถัดจากระบบ)</td></tr>
          </tbody></table>
          <div class="info-box">คู่มือ<strong>ไม่อยู่ในระบบ</strong> แต่เป็นรายการระดับบนถัดจากระบบ</div>`,
        ),
      },
      {
        id: 's03',
        title: L('3. 마스터 준비 (순서 권장)', '3. Master data (recommended order)', '3. マスター準備（推奨順）', '3. 主数据准备（建议顺序）', '3. เตรียมมาสเตอร์ (ลำดับแนะนำ)'),
        bodyHtml: L(
          `<p>웹훅으로 인보이스가 나오려면 아래를 <strong>이 순서</strong>로 준비합니다.</p>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">A</span><span><strong>거래처</strong> — 판매자(seller)·구매자(buyer) 법인을 등록합니다. 코드·정식명칭·주소·세금번호를 정확히 넣습니다.</span></div>
            <div class="flow-row"><span class="flow-num">B</span><span><strong>상품</strong> — 인보이스 품목(이름·단가·통화·비고)을 등록합니다.</span></div>
            <div class="flow-row"><span class="flow-num">C</span><span><strong>사이트/키</strong> — 연동 사이트 코드(예: tinpass, dealmai)를 만들고 API 키를 발급합니다.</span></div>
            <div class="flow-row"><span class="flow-num">D</span><span><strong>매핑</strong> — 사이트 ↔ 판매자 ↔ 구매자 ↔ 상품을 연결하고 <em>활성</em>으로 둡니다.</span></div>
            <div class="flow-row"><span class="flow-num">E</span><span>연동 사이트 서버 env에 <code>INVOICE_*</code>를 넣고 재시작합니다.</span></div>
          </div>
          <div class="warn-box">매핑이 없거나 비활성이면 웹훅은 4xx로 실패하고 PDF가 생성되지 않습니다.</div>
          <div class="check-box">테스트: Admin → 인보이스 목록에 새 번호가 보이는지, PDF 버튼으로 파일이 열리는지 확인합니다.</div>`,
          `<p>Before webhooks can issue invoices, prepare masters in <strong>this order</strong>.</p>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">A</span><span><strong>Parties</strong> — register seller and buyer entities (code, legal name, address, tax id).</span></div>
            <div class="flow-row"><span class="flow-num">B</span><span><strong>Products</strong> — line items (name, unit price, currency, remarks).</span></div>
            <div class="flow-row"><span class="flow-num">C</span><span><strong>Sites/Keys</strong> — create site code (e.g. tinpass, dealmai) and issue an API key.</span></div>
            <div class="flow-row"><span class="flow-num">D</span><span><strong>Mappings</strong> — link site ↔ seller ↔ buyer ↔ product and keep it <em>active</em>.</span></div>
            <div class="flow-row"><span class="flow-num">E</span><span>Set <code>INVOICE_*</code> on the site server and restart.</span></div>
          </div>
          <div class="warn-box">Without an active mapping, webhooks fail with 4xx and no PDF is created.</div>
          <div class="check-box">Verify: a new row appears under Invoices and PDF opens.</div>`,
          `<p>Webhookで発行するには、次の<strong>順</strong>でマスターを用意します。</p>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">A</span><span><strong>取引先</strong> — 売主・買主を登録</span></div>
            <div class="flow-row"><span class="flow-num">B</span><span><strong>商品</strong> — 明細を登録</span></div>
            <div class="flow-row"><span class="flow-num">C</span><span><strong>サイト/キー</strong> — サイト作成とAPIキー発行</span></div>
            <div class="flow-row"><span class="flow-num">D</span><span><strong>マッピング</strong> — サイト↔売主↔買主↔商品を有効化</span></div>
            <div class="flow-row"><span class="flow-num">E</span><span>連携サイトのenvに<code>INVOICE_*</code>を入れて再起動</span></div>
          </div>
          <div class="warn-box">有効マッピングが無いとWebhookは4xxで失敗しPDFは作られません。</div>
          <div class="check-box">インボイス一覧に新規が出てPDFが開けることを確認します。</div>`,
          `<p>Webhook 开具前请按<strong>此顺序</strong>准备主数据。</p>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">A</span><span><strong>交易方</strong> — 登记卖方/买方</span></div>
            <div class="flow-row"><span class="flow-num">B</span><span><strong>商品</strong> — 登记明细</span></div>
            <div class="flow-row"><span class="flow-num">C</span><span><strong>站点/密钥</strong> — 创建站点并签发 API 密钥</span></div>
            <div class="flow-row"><span class="flow-num">D</span><span><strong>映射</strong> — 绑定站点↔卖方↔买方↔商品并保持启用</span></div>
            <div class="flow-row"><span class="flow-num">E</span><span>在对接站点 env 写入 <code>INVOICE_*</code> 并重启</span></div>
          </div>
          <div class="warn-box">无有效映射时 Webhook 返回 4xx，不会生成 PDF。</div>
          <div class="check-box">确认发票列表出现新单且 PDF 可打开。</div>`,
          `<p>ก่อน webhook ออกอินวอยซ์ ให้เตรียมมาสเตอร์ตาม<strong>ลำดับนี้</strong></p>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">A</span><span><strong>คู่ค้า</strong> — ลงทะเบียนผู้ขาย/ผู้ซื้อ</span></div>
            <div class="flow-row"><span class="flow-num">B</span><span><strong>สินค้า</strong> — ลงทะเบียนรายการ</span></div>
            <div class="flow-row"><span class="flow-num">C</span><span><strong>ไซต์/คีย์</strong> — สร้างไซต์และออก API key</span></div>
            <div class="flow-row"><span class="flow-num">D</span><span><strong>แมป</strong> — ผูกไซต์↔ผู้ขาย↔ผู้ซื้อ↔สินค้า และเปิดใช้</span></div>
            <div class="flow-row"><span class="flow-num">E</span><span>ใส่ <code>INVOICE_*</code> ใน env ของไซต์แล้วรีสตาร์ท</span></div>
          </div>
          <div class="warn-box">ไม่มีแมปที่เปิดใช้ webhook จะได้ 4xx และไม่มี PDF</div>
          <div class="check-box">ตรวจว่ารายการอินวอยซ์มีแถวใหม่และเปิด PDF ได้</div>`,
        ),
      },
      {
        id: 's04',
        title: L('4. 사이트·API 키 발급', '4. Sites &amp; API keys', '4. サイト・APIキー', '4. 站点与 API 密钥', '4. ไซต์และ API key'),
        bodyHtml: L(
          `<div class="menu-path">인보이스 운영 → 사이트/키</div>
          <ol>
            <li>사이트 코드·표시명을 입력하고 저장합니다. 코드는 웹훅 body의 <code>site</code>와 같아야 합니다.</li>
            <li><strong>키 발급</strong>을 누르면 <code>INVOICE_API_KEY</code>와 <code>INVOICE_HMAC_SECRET</code>이 <em>한 번만</em> 표시됩니다.</li>
            <li>값을 안전한 곳에 복사한 뒤 연동 서버 env에 넣습니다.</li>
            <li>키를 분실하면 재발급하고, 이전 키는 즉시 폐기·env 갱신합니다.</li>
          </ol>
          <div class="block-box">키·시크릿을 Git·채팅·티켓에 남기지 마세요. 서버 환경변수에만 둡니다.</div>
          <pre style="background:#f4f7ff;padding:12px;border-radius:8px;overflow:auto">INVOICE_BASE_URL=https://invoice.icopay.net
INVOICE_API_KEY=inv_...
INVOICE_HMAC_SECRET=...
INVOICE_SITE_CODE=dealmai</pre>`,
          `<div class="menu-path">Invoice Ops → Sites / Keys</div>
          <ol>
            <li>Create a site code and display name. Code must match webhook body <code>site</code>.</li>
            <li><strong>Issue key</strong> shows <code>INVOICE_API_KEY</code> and <code>INVOICE_HMAC_SECRET</code> <em>once</em>.</li>
            <li>Copy them into the connected server env.</li>
            <li>If lost, reissue, revoke the old key, and update env immediately.</li>
          </ol>
          <div class="block-box">Never put keys in Git, chat, or tickets — server env only.</div>
          <pre style="background:#f4f7ff;padding:12px;border-radius:8px;overflow:auto">INVOICE_BASE_URL=https://invoice.icopay.net
INVOICE_API_KEY=inv_...
INVOICE_HMAC_SECRET=...
INVOICE_SITE_CODE=dealmai</pre>`,
          `<div class="menu-path">インボイス運用 → サイト/キー</div>
          <ol>
            <li>サイトコードと表示名を作成。コードはWebhookの <code>site</code> と一致。</li>
            <li><strong>キー発行</strong>で APIキーとHMACが<em>一度だけ</em>表示されます。</li>
            <li>連携サーバーのenvに設定します。</li>
            <li>紛失時は再発行し旧キーを無効化・env更新。</li>
          </ol>
          <div class="block-box">キーをGitやチャットに残さないでください。</div>
          <pre style="background:#f4f7ff;padding:12px;border-radius:8px;overflow:auto">INVOICE_BASE_URL=https://invoice.icopay.net
INVOICE_API_KEY=inv_...
INVOICE_HMAC_SECRET=...
INVOICE_SITE_CODE=dealmai</pre>`,
          `<div class="menu-path">发票运营 → 站点/密钥</div>
          <ol>
            <li>创建站点代码与显示名；代码须与 webhook 的 <code>site</code> 一致。</li>
            <li><strong>签发密钥</strong>时 API Key 与 HMAC <em>只显示一次</em>。</li>
            <li>写入对接服务器 env。</li>
            <li>遗失则重新签发、作废旧钥并立即更新 env。</li>
          </ol>
          <div class="block-box">切勿把密钥写入 Git 或聊天。</div>
          <pre style="background:#f4f7ff;padding:12px;border-radius:8px;overflow:auto">INVOICE_BASE_URL=https://invoice.icopay.net
INVOICE_API_KEY=inv_...
INVOICE_HMAC_SECRET=...
INVOICE_SITE_CODE=dealmai</pre>`,
          `<div class="menu-path">ดำเนินงานอินวอยซ์ → ไซต์/คีย์</div>
          <ol>
            <li>สร้างรหัสไซต์และชื่อแสดง ต้องตรงกับ <code>site</code> ใน webhook</li>
            <li><strong>ออกคีย์</strong> จะแสดง API key และ HMAC <em>ครั้งเดียว</em></li>
            <li>ใส่ใน env ของเซิร์ฟเวอร์ที่เชื่อม</li>
            <li>หากหาย ให้ออกใหม่ เพิกถอนคีย์เก่า และอัปเดต env ทันที</li>
          </ol>
          <div class="block-box">อย่าใส่คีย์ใน Git หรือแชท</div>
          <pre style="background:#f4f7ff;padding:12px;border-radius:8px;overflow:auto">INVOICE_BASE_URL=https://invoice.icopay.net
INVOICE_API_KEY=inv_...
INVOICE_HMAC_SECRET=...
INVOICE_SITE_CODE=dealmai</pre>`,
        ),
      },
      {
        id: 's05',
        title: L('5. 웹훅 연동 (상세)', '5. Webhook integration (detail)', '5. Webhook連携（詳細）', '5. Webhook 对接（详解）', '5. เชื่อม webhook (ละเอียด)'),
        bodyHtml: L(
          `<p><code>POST {INVOICE_BASE_URL}/v1/webhooks/transactions/completed</code></p>
          <table><thead><tr><th>헤더</th><th>필수</th><th>사용 방법</th></tr></thead><tbody>
          <tr><td>Content-Type</td><td>Y</td><td><code>application/json</code></td></tr>
          <tr><td>X-Api-Key</td><td>Y</td><td>발급된 <code>inv_...</code></td></tr>
          <tr><td>X-Signature</td><td>Y</td><td><code>hex(HMAC-SHA256(rawBody, hmacSecret))</code> — raw body 바이트 기준</td></tr>
          <tr><td>X-Idempotency-Key</td><td>Y</td><td>거래당 고유. 재시도 시 <strong>같은 값</strong></td></tr>
          <tr><td>X-Timestamp</td><td>권장</td><td>Unix 초. 허용 오차 약 300초</td></tr>
          </tbody></table>
          <p>Body 예:</p>
          <pre style="background:#f4f7ff;padding:12px;border-radius:8px;overflow:auto">{
  "site": "dealmai",
  "event": "transaction.completed",
  "occurredAt": "2026-09-21T12:00:00+09:00",
  "transactionId": "DM-TX-001",
  "ticketNo": "DM-ORD-001",
  "amount": "49.00",
  "currency": "USD",
  "buyerRef": "user@example.com",
  "memo": "Package name",
  "lang": "en"
}</pre>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">2xx</span><span>성공 — 재시도 금지. 응답에 invoice 번호·id가 포함됩니다.</span></div>
            <div class="flow-row"><span class="flow-num">4xx</span><span>키·서명·매핑 오류 — 수정 후 동일 멱등키로 재시도 가능</span></div>
            <div class="flow-row"><span class="flow-num">5xx</span><span>일시 오류 — 지수 백오프, 멱등키 유지</span></div>
          </div>
          <div class="info-box">TINPASS: Crypto 백엔드 COMPLETED 시 자동 송신. DealMai: ChillPay settle / ontheline Paid 후 best-effort 송신.</div>`,
          `<p><code>POST {INVOICE_BASE_URL}/v1/webhooks/transactions/completed</code></p>
          <table><thead><tr><th>Header</th><th>Req</th><th>How to use</th></tr></thead><tbody>
          <tr><td>Content-Type</td><td>Y</td><td><code>application/json</code></td></tr>
          <tr><td>X-Api-Key</td><td>Y</td><td>Issued <code>inv_...</code></td></tr>
          <tr><td>X-Signature</td><td>Y</td><td><code>hex(HMAC-SHA256(rawBody, hmacSecret))</code> over raw bytes</td></tr>
          <tr><td>X-Idempotency-Key</td><td>Y</td><td>Unique per event; <strong>same</strong> on retry</td></tr>
          <tr><td>X-Timestamp</td><td>Rec</td><td>Unix seconds; ~300s skew</td></tr>
          </tbody></table>
          <p>Sample body:</p>
          <pre style="background:#f4f7ff;padding:12px;border-radius:8px;overflow:auto">{
  "site": "dealmai",
  "event": "transaction.completed",
  "occurredAt": "2026-09-21T12:00:00+09:00",
  "transactionId": "DM-TX-001",
  "ticketNo": "DM-ORD-001",
  "amount": "49.00",
  "currency": "USD",
  "buyerRef": "user@example.com",
  "memo": "Package name",
  "lang": "en"
}</pre>
          <div class="flow">
            <div class="flow-row"><span class="flow-num">2xx</span><span>Success — do not retry. Response includes invoice no/id.</span></div>
            <div class="flow-row"><span class="flow-num">4xx</span><span>Key/signature/mapping — fix then retry with same idempotency key</span></div>
            <div class="flow-row"><span class="flow-num">5xx</span><span>Transient — backoff, keep idempotency key</span></div>
          </div>
          <div class="info-box">TINPASS: auto on COMPLETED. DealMai: after ChillPay settle / ontheline Paid (best effort).</div>`,
          `<p><code>POST {INVOICE_BASE_URL}/v1/webhooks/transactions/completed</code></p>
          <table><thead><tr><th>ヘッダ</th><th>必須</th><th>使い方</th></tr></thead><tbody>
          <tr><td>Content-Type</td><td>Y</td><td><code>application/json</code></td></tr>
          <tr><td>X-Api-Key</td><td>Y</td><td>発行した <code>inv_...</code></td></tr>
          <tr><td>X-Signature</td><td>Y</td><td>rawBodyのHMAC-SHA256(hex)</td></tr>
          <tr><td>X-Idempotency-Key</td><td>Y</td><td>イベント固有。再試行は<strong>同じ値</strong></td></tr>
          <tr><td>X-Timestamp</td><td>推奨</td><td>Unix秒（許容約300秒）</td></tr>
          </tbody></table>
          <div class="info-box">TINPASSはCOMPLETEDで自動送信。DealMaiは決済確定後にbest-effort送信。</div>`,
          `<p><code>POST {INVOICE_BASE_URL}/v1/webhooks/transactions/completed</code></p>
          <table><thead><tr><th>请求头</th><th>必填</th><th>用法</th></tr></thead><tbody>
          <tr><td>Content-Type</td><td>Y</td><td><code>application/json</code></td></tr>
          <tr><td>X-Api-Key</td><td>Y</td><td>已签发的 <code>inv_...</code></td></tr>
          <tr><td>X-Signature</td><td>Y</td><td>对 rawBody 做 HMAC-SHA256(hex)</td></tr>
          <tr><td>X-Idempotency-Key</td><td>Y</td><td>每事件唯一；重试用<strong>相同值</strong></td></tr>
          <tr><td>X-Timestamp</td><td>建议</td><td>Unix 秒（约 300 秒容差）</td></tr>
          </tbody></table>
          <div class="info-box">TINPASS 在 COMPLETED 自动发送；DealMai 在支付确认后尽力发送。</div>`,
          `<p><code>POST {INVOICE_BASE_URL}/v1/webhooks/transactions/completed</code></p>
          <table><thead><tr><th>Header</th><th>ต้อง</th><th>วิธีใช้</th></tr></thead><tbody>
          <tr><td>Content-Type</td><td>Y</td><td><code>application/json</code></td></tr>
          <tr><td>X-Api-Key</td><td>Y</td><td><code>inv_...</code> ที่ออกแล้ว</td></tr>
          <tr><td>X-Signature</td><td>Y</td><td>HMAC-SHA256(hex) ของ rawBody</td></tr>
          <tr><td>X-Idempotency-Key</td><td>Y</td><td>ไม่ซ้ำต่อเหตุการณ์ — retry ใช้<strong>ค่าเดิม</strong></td></tr>
          <tr><td>X-Timestamp</td><td>แนะนำ</td><td>Unix วินาที (คลาดเคลื่อน ~300 วิ)</td></tr>
          </tbody></table>
          <div class="info-box">TINPASS ส่งอัตโนมัติเมื่อ COMPLETED · DealMai ส่งหลังยืนยันชำระ (best effort)</div>`,
        ),
      },
      {
        id: 's06',
        title: L('6. 인보이스 조회·PDF·재발행', '6. Invoices: list, PDF, reissue', '6. インボイス照会・PDF・再発行', '6. 发票查询、PDF、重开', '6. ดูอินวอยซ์ PDF ออกใหม่'),
        bodyHtml: L(
          `<div class="menu-path">인보이스 운영 → 인보이스</div>
          <ol>
            <li><strong>기간·검색</strong> — 발행일 From/To, 번호·티켓·거래ID로 좁힙니다.</li>
            <li><strong>PDF</strong> — 행의 PDF로 다운로드. 언어는 요청/사이트 기본값을 따릅니다.</li>
            <li><strong>재발행</strong> — 내용 정정 후 새 PDF. 감사 로그에 남습니다.</li>
            <li><strong>무효/삭제</strong> — 정책에 따라 사용. 반드시 사유를 남깁니다.</li>
          </ol>
          <div class="check-box">연동 사이트(DealMai Sales→Invoice, TINPASS Invoices)에서도 동일 PDF를 볼 수 있습니다. 키는 사이트 서버에만 둡니다.</div>
          <div class="warn-box">브라우저에 API 키를 넣지 마세요. 사이트 Admin은 서버 프록시(<code>/api/invoices</code>)를 사용합니다.</div>`,
          `<div class="menu-path">Invoice Ops → Invoices</div>
          <ol>
            <li><strong>Filter</strong> — From/To issued dates; search by number, ticket, transaction id.</li>
            <li><strong>PDF</strong> — download from the row. Language follows request/site defaults.</li>
            <li><strong>Reissue</strong> — corrected PDF; written to the audit log.</li>
            <li><strong>Void/delete</strong> — per policy; always leave a reason.</li>
          </ol>
          <div class="check-box">Connected admins (DealMai Sales→Invoice, TINPASS Invoices) show the same PDFs via server proxy.</div>
          <div class="warn-box">Never put API keys in the browser. Site admins use <code>/api/invoices</code> proxies.</div>`,
          `<div class="menu-path">インボイス運用 → インボイス</div>
          <ol>
            <li><strong>期間・検索</strong> — 発行日From/To、番号・チケット・取引ID</li>
            <li><strong>PDF</strong> — 行からダウンロード</li>
            <li><strong>再発行</strong> — 修正PDF。監査ログに記録</li>
            <li><strong>無効/削除</strong> — 方針に従い理由を残す</li>
          </ol>
          <div class="check-box">連携サイト管理画面でも同じPDFを表示（サーバープロキシ）。</div>
          <div class="warn-box">ブラウザにAPIキーを置かないでください。</div>`,
          `<div class="menu-path">发票运营 → 发票</div>
          <ol>
            <li><strong>筛选</strong> — 开具日 From/To；按编号/票据/交易号搜索</li>
            <li><strong>PDF</strong> — 从行下载</li>
            <li><strong>重开</strong> — 修正后的 PDF，写入审计日志</li>
            <li><strong>作废/删除</strong> — 按策略并填写原因</li>
          </ol>
          <div class="check-box">对接站点管理端可通过服务端代理查看同一 PDF。</div>
          <div class="warn-box">不要在浏览器存放 API 密钥。</div>`,
          `<div class="menu-path">ดำเนินงานอินวอยซ์ → อินวอยซ์</div>
          <ol>
            <li><strong>กรอง</strong> — From/To วันที่ออก ค้นเลขที่/ตั๋ว/ธุรกรรม</li>
            <li><strong>PDF</strong> — ดาวน์โหลดจากแถว</li>
            <li><strong>ออกใหม่</strong> — PDF แก้ไข บันทึกใน audit</li>
            <li><strong>ยกเลิก/ลบ</strong> — ตามนโยบาย พร้อมเหตุผล</li>
          </ol>
          <div class="check-box">แอดมินไซต์ที่เชื่อม (DealMai / TINPASS) ดู PDF เดียวกันผ่านพร็อกซีเซิร์ฟเวอร์</div>
          <div class="warn-box">อย่าใส่ API key ในเบราว์เซอร์</div>`,
        ),
      },
      {
        id: 's07',
        title: L('7. 대시보드 읽기', '7. Reading the dashboard', '7. ダッシュボードの見方', '7. 阅读仪表盘', '7. อ่านแดชบอร์ด'),
        bodyHtml: L(
          `<div class="menu-path">대시보드</div>
          <ul>
            <li><strong>발행/재발행/무효</strong> — 전체 건수 카드</li>
            <li><strong>사이트별 표</strong> — 코드·건수·금액·최근 발행·활성</li>
            <li><strong>서버</strong> — uptime·메모리·Node·타임존·PDF 저장 경로</li>
          </ul>
          <div class="info-box">특정 사이트만 이상하면 해당 사이트 키·매핑·연동 env를 먼저 점검합니다.</div>`,
          `<div class="menu-path">Dashboard</div>
          <ul>
            <li><strong>Issued / reissued / void</strong> — global counters</li>
            <li><strong>Per-site table</strong> — code, counts, amounts, last issue, active</li>
            <li><strong>Server</strong> — uptime, memory, Node, timezone, PDF path</li>
          </ul>
          <div class="info-box">If one site looks wrong, check that site’s key, mapping, and env first.</div>`,
          `<div class="menu-path">ダッシュボード</div>
          <ul>
            <li>発行/再発行/無効の件数カード</li>
            <li>サイト別の件数・金額・最終発行</li>
            <li>サーバー稼働・メモリ・TZ・PDFパス</li>
          </ul>`,
          `<div class="menu-path">仪表盘</div>
          <ul>
            <li>开具/重开/作废计数</li>
            <li>按站点件数、金额、最近开具</li>
            <li>服务器运行时间、内存、时区、PDF 路径</li>
          </ul>`,
          `<div class="menu-path">แดชบอร์ด</div>
          <ul>
            <li>การ์ดจำนวนออก/ออกใหม่/ยกเลิก</li>
            <li>ตารางต่อไซต์ จำนวน ยอด ล่าสุด</li>
            <li>เซิร์ฟเวอร์ uptime หน่วยความจำ TZ พาธ PDF</li>
          </ul>`,
        ),
      },
      {
        id: 's08',
        title: L('8. PDF·플랫폼 브랜딩', '8. PDF &amp; platform branding', '8. PDF・ブランディング', '8. PDF与平台品牌', '8. PDF และแบรนด์แพลตฟอร์ม'),
        bodyHtml: L(
          `<div class="menu-path">시스템 → 플랫폼</div>
          <ol>
            <li><strong>로그인 로고 / 사이드바 로고 / 파비콘</strong> — 업로드 후 저장. 메뉴얼 표지도 동일 로고를 씁니다.</li>
            <li><strong>사이트명·푸터</strong> — Admin·로그인 화면에 반영</li>
            <li><strong>OTP / Turnstile / SMTP</strong> — 보안·메일 발송. 변경 후 로그인 흐름을 한 번 검증합니다.</li>
          </ol>
          <div class="info-box">PDF의 <em>시스템 문구</em>(라벨)는 i18n(ko/en/ja/th/zh)입니다. 법인·상품 <em>데이터</em>는 마스터에서 관리합니다.</div>
          <div class="check-box">기본 양식은 Proforma Invoice(DealMai 템플릿) 레이아웃을 따릅니다. 사이트별 도장·기본 고지문은 사이트/매핑 설정을 확인하세요.</div>`,
          `<div class="menu-path">System → Platform</div>
          <ol>
            <li><strong>Login / sidebar logo / favicon</strong> — upload and save. Manual covers reuse the logo.</li>
            <li><strong>Site name &amp; footer</strong> — applied to Admin and login.</li>
            <li><strong>OTP / Turnstile / SMTP</strong> — verify one full login after changes.</li>
          </ol>
          <div class="info-box">PDF <em>system labels</em> are i18n (ko/en/ja/th/zh). Entity/product <em>data</em> comes from masters.</div>
          <div class="check-box">Default layout follows the Proforma Invoice template. Check site seal / default notices per mapping.</div>`,
          `<div class="menu-path">システム → プラットフォーム</div>
          <ol>
            <li>ログイン/サイドバーロゴ・ファビコンをアップロード</li>
            <li>サイト名・フッタを設定</li>
            <li>OTP / Turnstile / SMTP — 変更後にログインを確認</li>
          </ol>
          <div class="info-box">PDFのシステム文言はi18n。法人・商品データはマスター。</div>`,
          `<div class="menu-path">系统 → 平台</div>
          <ol>
            <li>上传登录/侧栏标志与图标</li>
            <li>设置站点名与页脚</li>
            <li>OTP / Turnstile / SMTP — 变更后验证一次登录</li>
          </ol>
          <div class="info-box">PDF 系统文案为 i18n；法人/商品数据在主数据中。</div>`,
          `<div class="menu-path">ระบบ → แพลตฟอร์ม</div>
          <ol>
            <li>อัปโหลดโลโก้ล็อกอิน/แถบข้าง และฟาวิคอน</li>
            <li>ตั้งชื่อไซต์และส่วนท้าย</li>
            <li>OTP / Turnstile / SMTP — หลังแก้ให้ทดสอบล็อกอิน</li>
          </ol>
          <div class="info-box">ข้อความระบบบน PDF เป็น i18n ข้อมูลนิติบุคคล/สินค้าอยู่ที่มาสเตอร์</div>`,
        ),
      },
      {
        id: 's09',
        title: L('9. 사용자·보안·운영 로그', '9. Users, security, audit', '9. ユーザー・セキュリティ・ログ', '9. 用户、安全、审计', '9. ผู้ใช้ ความปลอดภัย บันทึก'),
        bodyHtml: L(
          `<div class="menu-path">시스템 → 사용자 / 운영 로그</div>
          <ul>
            <li>HQ·Viewer 계정을 만들고 역할을 부여합니다.</li>
            <li>비밀번호 재설정·2FA 상태는 사용자 화면에서 확인합니다.</li>
            <li><strong>운영 로그</strong>에서 발행·재발행·삭제·키 발급·마스터 변경을 시간순으로 추적합니다. 필요 시 JSON/CSV로보냅니다.</li>
          </ul>
          <div class="warn-box">운영 로그는 감사용 원본입니다. 임의 삭제를 하지 마세요.</div>`,
          `<div class="menu-path">System → Users / Operation log</div>
          <ul>
            <li>Create HQ/Viewer accounts and assign roles.</li>
            <li>Check password reset and 2FA status on the user screen.</li>
            <li><strong>Operation log</strong> tracks issue/reissue/delete/key/master changes; export JSON/CSV when needed.</li>
          </ul>
          <div class="warn-box">The log is an audit source of truth — do not purge casually.</div>`,
          `<div class="menu-path">システム → ユーザー / 運用ログ</div>
          <ul>
            <li>HQ/Viewerを作成し役割を付与</li>
            <li>パスワード再設定・2FAを確認</li>
            <li>運用ログで発行・キー・マスター変更を追跡。必要ならJSON/CSV</li>
          </ul>`,
          `<div class="menu-path">系统 → 用户 / 操作日志</div>
          <ul>
            <li>创建 HQ/Viewer 并分配角色</li>
            <li>查看密码重置与 2FA</li>
            <li>在操作日志追踪开具、密钥、主数据变更；可导出 JSON/CSV</li>
          </ul>`,
          `<div class="menu-path">ระบบ → ผู้ใช้ / บันทึกการดำเนินงาน</div>
          <ul>
            <li>สร้างบัญชี HQ/Viewer และกำหนดบทบาท</li>
            <li>ตรวจรีเซ็ตรหัสผ่านและ 2FA</li>
            <li>ติดตามการออกคีย์/มาสเตอร์ในบันทึก ส่งออก JSON/CSV ได้</li>
          </ul>`,
        ),
      },
      {
        id: 's10',
        title: L('10. 연동 사이트에서 보기', '10. Viewing on connected sites', '10. 連携サイトでの表示', '10. 在对接站点查看', '10. ดูที่ไซต์ที่เชื่อม'),
        bodyHtml: L(
          `<table><thead><tr><th>사이트</th><th>위치</th><th>비고</th></tr></thead><tbody>
          <tr><td>DealMai</td><td>Admin → Sales → Invoice</td><td>서버 env의 INVOICE_* 필요. 날짜 기본: 오늘−7일 ~ 오늘</td></tr>
          <tr><td>TINPASS</td><td>Dashboard → Invoices</td><td>Crypto 백엔드 env의 INVOICE_*</td></tr>
          <tr><td>Invoice HQ</td><td>인보이스 운영 → 인보이스</td><td>전 사이트 통합 조회·재발행·감사</td></tr>
          </tbody></table>
          <div class="info-box">사이트 Admin에 “not configured”가 보이면 서버 env에 키가 없는 것입니다. Netlify UI에 사용자가 직접 넣을 필요가 없습니다(VPS면 /etc 환경파일).</div>`,
          `<table><thead><tr><th>Site</th><th>Where</th><th>Notes</th></tr></thead><tbody>
          <tr><td>DealMai</td><td>Admin → Sales → Invoice</td><td>Needs INVOICE_* on server env. Default dates: today−7 → today</td></tr>
          <tr><td>TINPASS</td><td>Dashboard → Invoices</td><td>INVOICE_* on Crypto backend env</td></tr>
          <tr><td>Invoice HQ</td><td>Invoice Ops → Invoices</td><td>Cross-site list, reissue, audit</td></tr>
          </tbody></table>
          <div class="info-box">“Not configured” means server env is missing keys — operators do not paste keys into Netlify UI for VPS deploys.</div>`,
          `<table><thead><tr><th>サイト</th><th>場所</th><th>备注</th></tr></thead><tbody>
          <tr><td>DealMai</td><td>Admin → Sales → Invoice</td><td>サーバーenvのINVOICE_*</td></tr>
          <tr><td>TINPASS</td><td>Dashboard → Invoices</td><td>Crypto backendのINVOICE_*</td></tr>
          <tr><td>Invoice HQ</td><td>インボイス運用 → インボイス</td><td>全サイト照会・再発行</td></tr>
          </tbody></table>`,
          `<table><thead><tr><th>站点</th><th>位置</th><th>说明</th></tr></thead><tbody>
          <tr><td>DealMai</td><td>Admin → Sales → Invoice</td><td>服务器 env 的 INVOICE_*</td></tr>
          <tr><td>TINPASS</td><td>Dashboard → Invoices</td><td>Crypto 后端 env</td></tr>
          <tr><td>Invoice HQ</td><td>发票运营 → 发票</td><td>跨站点查询与重开</td></tr>
          </tbody></table>`,
          `<table><thead><tr><th>ไซต์</th><th>ที่</th><th>หมายเหตุ</th></tr></thead><tbody>
          <tr><td>DealMai</td><td>Admin → Sales → Invoice</td><td>ต้องมี INVOICE_* ใน env</td></tr>
          <tr><td>TINPASS</td><td>Dashboard → Invoices</td><td>INVOICE_* ใน Crypto backend</td></tr>
          <tr><td>Invoice HQ</td><td>ดำเนินงานอินวอยซ์ → อินวอยซ์</td><td>ดูทุกไซต์ ออกใหม่ ตรวจสอบ</td></tr>
          </tbody></table>`,
        ),
      },
      {
        id: 's11',
        title: L('11. 문제 해결 (FAQ)', '11. Troubleshooting (FAQ)', '11. トラブルシュート (FAQ)', '11. 故障排查 (FAQ)', '11. แก้ปัญหา (FAQ)'),
        bodyHtml: L(
          `<div class="faq-item"><div class="faq-q">웹훅 200인데 목록이 비어 있습니다</div><div class="faq-a">다른 사이트 키로 발행됐는지, 날짜 필터가 좁은지, kind(live/all) 필터를 확인하세요.</div></div>
          <div class="faq-item"><div class="faq-q">서명 오류(401/403)</div><div class="faq-a">HMAC은 <em>직렬화된 raw body</em> 기준입니다. JSON을 다시 stringify하면 서명이 깨집니다. 시크릿·키가 최신인지 확인하세요.</div></div>
          <div class="faq-item"><div class="faq-q">매핑 오류</div><div class="faq-a">해당 site_id에 활성 매핑이 있는지, 판매자·구매자·상품이 삭제되지 않았는지 확인합니다.</div></div>
          <div class="faq-item"><div class="faq-q">DealMai에 Invoice 메뉴만 있고 데이터 없음</div><div class="faq-a">DealMai 서버 <code>/etc/dealmai/env</code>의 INVOICE_*와 Invoice Admin 발급 키가 일치하는지, <code>dealmai-api</code> 재시작 여부를 확인합니다.</div></div>
          <div class="faq-item"><div class="faq-q">PDF 글자가 깨집니다</div><div class="faq-a">서버 폰트 설치(ensure-fonts)와 요청 언어(lang)를 확인합니다. 시스템 라벨만 i18n이고 마스터 데이터는 입력 언어 그대로입니다.</div></div>`,
          `<div class="faq-item"><div class="faq-q">Webhook 200 but list is empty</div><div class="faq-a">Check site filter, date range, and kind (live/all). Confirm the key belongs to that site.</div></div>
          <div class="faq-item"><div class="faq-q">Signature errors (401/403)</div><div class="faq-a">HMAC over the exact raw body bytes — re-stringify breaks the signature. Confirm latest secret/key.</div></div>
          <div class="faq-item"><div class="faq-q">Mapping errors</div><div class="faq-a">Ensure an active mapping for the site and that parties/products still exist.</div></div>
          <div class="faq-item"><div class="faq-q">DealMai menu shows but no rows</div><div class="faq-a">Match INVOICE_* in <code>/etc/dealmai/env</code> with Admin-issued keys; restart <code>dealmai-api</code>.</div></div>
          <div class="faq-item"><div class="faq-q">Broken PDF glyphs</div><div class="faq-a">Check server fonts (ensure-fonts) and request lang. System labels are i18n; master text is as entered.</div></div>`,
          `<div class="faq-item"><div class="faq-q">Webhookは200なのに一覧が空</div><div class="faq-a">サイト・日付・kindフィルタとキーのサイト一致を確認。</div></div>
          <div class="faq-item"><div class="faq-q">署名エラー</div><div class="faq-a">rawBodyバイトへのHMAC。再stringifyで壊れます。</div></div>
          <div class="faq-item"><div class="faq-q">マッピングエラー</div><div class="faq-a">有効マッピングと取引先・商品の存在を確認。</div></div>
          <div class="faq-item"><div class="faq-q">DealMaiにデータが無い</div><div class="faq-a">envのINVOICE_*とキー一致、<code>dealmai-api</code>再起動。</div></div>`,
          `<div class="faq-item"><div class="faq-q">Webhook 200 但列表为空</div><div class="faq-a">检查站点、日期、kind 过滤，以及密钥所属站点。</div></div>
          <div class="faq-item"><div class="faq-q">签名错误</div><div class="faq-a">必须对原始 rawBody 做 HMAC；重新 stringify 会失效。</div></div>
          <div class="faq-item"><div class="faq-q">映射错误</div><div class="faq-a">确认有效映射及交易方/商品仍存在。</div></div>
          <div class="faq-item"><div class="faq-q">DealMai 无数据</div><div class="faq-a">核对 env 的 INVOICE_* 与密钥，并重启 dealmai-api。</div></div>`,
          `<div class="faq-item"><div class="faq-q">Webhook 200 แต่รายการว่าง</div><div class="faq-a">ตรวจตัวกรองไซต์ วันที่ kind และว่าคีย์เป็นของไซต์นั้น</div></div>
          <div class="faq-item"><div class="faq-q">ลายเซ็นผิด</div><div class="faq-a">HMAC กับ rawBody จริง — stringify ใหม่จะพัง</div></div>
          <div class="faq-item"><div class="faq-q">แมปผิด</div><div class="faq-a">ต้องมีแมปที่เปิดใช้ และคู่ค้า/สินค้ายังอยู่</div></div>
          <div class="faq-item"><div class="faq-q">DealMai ไม่มีข้อมูล</div><div class="faq-a">ตรวจ INVOICE_* ใน env ให้ตรงคีย์ แล้วรีสตาร์ท dealmai-api</div></div>`,
        ),
      },
    ],
  };

  const DOCS = { 'ops-full': OPS_FULL };

  const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.75; color: #1a1a1a; background: #f0f2f8; }
  .page-wrap { max-width: 960px; margin: 32px auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 18px rgba(0,0,0,.11); overflow: hidden; }
  .cover { background: linear-gradient(135deg, #1a3a5c 0%, #1976d2 55%, #42a5f5 100%); color: #fff; padding: 48px 52px 40px; display: flex; align-items: flex-start; justify-content: space-between; gap: 32px; }
  .cover-body { flex: 1; }
  .cover-logo img { height: 64px; background: rgba(255,255,255,.92); padding: 10px 18px; border-radius: 8px; max-width: 220px; object-fit: contain; }
  .cover .logo-line { font-size: 13pt; font-weight: 700; letter-spacing: 2px; opacity: .85; margin-bottom: 14px; }
  .cover h1 { font-size: 22pt; font-weight: 900; line-height: 1.28; margin-bottom: 10px; }
  .cover .subtitle { font-size: 11pt; opacity: .82; margin-bottom: 24px; }
  .cover .meta { font-size: 9.5pt; opacity: .65; border-top: 1px solid rgba(255,255,255,.25); padding-top: 14px; }
  .body { padding: 44px 52px 64px; }
  .toc { background: #f0f4ff; border-left: 4px solid #1565c0; border-radius: 0 8px 8px 0; padding: 20px 26px; margin-bottom: 44px; }
  .toc h2 { font-size: 12pt; font-weight: 700; color: #1565c0; margin-bottom: 12px; }
  .toc ol { padding-left: 20px; }
  .toc li { font-size: 10pt; line-height: 2.1; color: #1a3a5c; }
  .toc a { color: #1565c0; text-decoration: none; }
  h2.section-title { font-size: 15pt; font-weight: 800; color: #1a3a5c; border-bottom: 2.5px solid #1565c0; padding-bottom: 7px; margin: 48px 0 18px; }
  p { margin-bottom: 10px; }
  .info-box  { background: #e3f0ff; border: 1px solid #90caf9; border-left: 4px solid #1565c0; border-radius: 6px; padding: 12px 16px; margin: 14px 0; font-size: 10pt; color: #1a3a5c; }
  .warn-box  { background: #fff8e1; border: 1px solid #ffe082; border-left: 4px solid #f9a825; border-radius: 6px; padding: 12px 16px; margin: 14px 0; font-size: 10pt; color: #5d4037; }
  .check-box { background: #e8f5e9; border: 1px solid #a5d6a7; border-left: 4px solid #2e7d32; border-radius: 6px; padding: 12px 16px; margin: 14px 0; font-size: 10pt; color: #1b5e20; }
  .block-box { background: #fce4ec; border: 1px solid #f48fb1; border-left: 4px solid #c62828; border-radius: 6px; padding: 12px 16px; margin: 14px 0; font-size: 10pt; color: #b71c1c; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0 22px; font-size: 10pt; }
  th { background: #1a3a5c; color: #fff; font-weight: 700; padding: 9px 12px; text-align: left; border: 1px solid #12274a; }
  td { padding: 8px 12px; border: 1px solid #cfd8dc; vertical-align: middle; }
  tr:nth-child(even) td { background: #f4f7ff; }
  .menu-path { display: inline-block; background: #eceff1; border: 1px solid #cfd8dc; border-radius: 5px; padding: 3px 12px; font-size: 9.5pt; color: #37474f; font-weight: 600; margin-bottom: 12px; }
  .flow { background: #f8f9fd; border: 1px solid #dce3f5; border-radius: 8px; padding: 18px 22px; margin: 14px 0 20px; font-size: 10pt; }
  .flow-row { display: flex; align-items: flex-start; margin-bottom: 6px; gap: 6px; }
  .flow-num { display: inline-block; min-width: 28px; font-weight: 800; color: #1565c0; flex-shrink: 0; }
  .faq-item { border: 1px solid #e0e6f0; border-radius: 8px; margin-bottom: 14px; }
  .faq-q { background: #e8edf8; padding: 11px 16px; font-weight: 700; font-size: 10.5pt; color: #1a3a5c; border-radius: 8px 8px 0 0; }
  .faq-q::before { content: "Q. "; color: #1565c0; }
  .faq-a { padding: 11px 16px; font-size: 10pt; color: #37474f; }
  .faq-a::before { content: "A. "; font-weight: 700; color: #2e7d32; }
  ul, ol { padding-left: 20px; margin-bottom: 12px; }
  li { margin-bottom: 6px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9.5pt; }
  .footer { background: #1a3a5c; color: rgba(255,255,255,.6); text-align: center; font-size: 9pt; padding: 18px 24px; }
  .print-btn { position: fixed; bottom: 28px; right: 28px; z-index: 9999; background: #1565c0; color: #fff; border: none; border-radius: 10px; padding: 11px 20px; font-size: 10.5pt; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(21,101,192,.45); }
  @media print { .print-btn { display: none !important; } body { background: #fff; } .page-wrap { margin: 0; box-shadow: none; } }
  `;

  function buildManualHtml(manualId, lang, brand, docVersion) {
    const doc = DOCS[manualId] || DOCS['ops-full'];
    if (!doc) return '<!DOCTYPE html><html><body><p>Manual not found</p></body></html>';
    const locale = String(lang || 'en').slice(0, 2).toLowerCase();
    const title = pick(doc.coverTitle, locale);
    const subtitle = pick(doc.coverSubtitle, locale);
    const site = (brand && brand.siteName) || 'Invoice';
    const ver = String(docVersion || CURRENT_LIVE_VERSION).replace(/^V/i, '');
    const logoSrc = (brand && brand.logoUrl) || '';
    const logo = logoSrc ? `<img src="${esc(logoSrc)}" alt="${esc(site)}" />` : '';
    const tocLabel = pick(L('목차', 'Contents', '目次', '目录', 'สารบัญ'), locale);
    const printLabel = pick(L('인쇄 / PDF', 'Print / PDF', '印刷 / PDF', '打印 / PDF', 'พิมพ์ / PDF'), locale);
    const toc = doc.sections
      .map((s, i) => `<li><a href="#${esc(s.id)}">${esc(pick(s.title, locale))}</a></li>`)
      .join('');
    const sections = doc.sections
      .map((s) => `<h2 class="section-title" id="${esc(s.id)}">${esc(pick(s.title, locale))}</h2>${pick(s.bodyHtml, locale)}`)
      .join('\n<hr style="border:none;border-top:1px dashed #c5cae9;margin:40px 0" />\n');
    const footer = (brand && brand.footerText) || `© ${site} · Manual V${ver}`;
    const htmlLang = locale === 'ja' ? 'ja' : locale === 'zh' ? 'zh' : locale === 'th' ? 'th' : locale === 'ko' ? 'ko' : 'en';

    return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · V${esc(ver)}</title>
<style>${CSS}</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">${esc(printLabel)}</button>
<div class="page-wrap">
  <div class="cover">
    <div class="cover-body">
      <div class="logo-line">${esc(site)}</div>
      <h1>${esc(title)}</h1>
      <div class="subtitle">${esc(subtitle)}</div>
      <div class="meta">Version V${esc(ver)}</div>
    </div>
    ${logo ? `<div class="cover-logo">${logo}</div>` : ''}
  </div>
  <div class="body">
    <div class="toc"><h2>${esc(tocLabel)}</h2><ol>${toc}</ol></div>
    ${sections}
  </div>
  <div class="footer">${esc(footer)}</div>
</div>
</body>
</html>`;
  }

  function openManualPlaceholderWindow() {
    const w = window.open('', '_blank');
    if (!w) throw new Error('popup blocked');
    w.document.write('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;color:#555">Loading…</body></html>');
    w.document.close();
    return w;
  }

  function openManualWindow(html, win) {
    const target = win || window.open('', '_blank');
    if (!target) throw new Error('popup blocked');
    target.document.open();
    target.document.write(html);
    target.document.close();
    return target;
  }

  global.InvoiceManuals = {
    CURRENT_LIVE_VERSION,
    MANUAL_CATALOG,
    RELEASE_NOTES,
    buildManualHtml,
    openManualPlaceholderWindow,
    openManualWindow,
  };
})(typeof window !== 'undefined' ? window : globalThis);
