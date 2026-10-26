/**
 * 스마트스토어 신규 주문(결제완료) → 주안산업 발주서 시트 행.
 *
 *   node naver-orders.js            최근 1일, 추가될 행만 출력 (시트 안 건드림)
 *   node naver-orders.js --days 3   최근 3일
 *   node naver-orders.js --write    시트에 덧붙인다 (이미 있는 상품주문번호는 건너뜀)
 *
 * 키는 저장소 밖에 둔다 (저장소 공개):
 *   ~/.config/tembaboard/naver.env      NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (커머스API센터)
 *   ~/.config/tembaboard/google-sa.json 서비스 계정 키. 시트를 이 계정 이메일에 편집자로 공유
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createSign } from 'node:crypto';
import bcrypt from 'bcryptjs';

const DIR = `${homedir()}/.config/tembaboard`;
const SHEET_ID = '1DOr8O6TiO3hDnsD7eiZicg5ladZpAgtzf4IzOa2DY6c';
const SHEET_TAB = '주안산업확인용';
const API = 'https://api.commerce.naver.com/external';

// ---------- 네이버 ----------

async function naverToken() {
  process.loadEnvFile(`${DIR}/naver.env`);
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) throw new Error(`${DIR}/naver.env 에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 를 넣어 주세요`);
  const timestamp = Date.now();
  const sign = Buffer.from(bcrypt.hashSync(`${id}_${timestamp}`, secret)).toString('base64');
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: id, timestamp, client_secret_sign: sign, grant_type: 'client_credentials', type: 'SELF' }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`네이버 토큰 실패: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function naver(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`네이버 ${path} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

/** 조회 구간이 하루로 묶여 있어 하루씩 끊어 묻는다. */
async function payedProductOrderIds(token, days) {
  const ids = new Set();
  const now = Date.now();
  for (let d = days; d > 0; d--) {
    let from = new Date(now - d * 864e5).toISOString();
    const to = new Date(Math.min(now, now - (d - 1) * 864e5)).toISOString();
    let seq;
    for (;;) {
      const q = new URLSearchParams({ lastChangedFrom: from, lastChangedTo: to, lastChangedType: 'PAYED' });
      if (seq) q.set('moreSequence', seq);
      const { data } = await naver(token, `/v1/pay-order/seller/product-orders/last-changed-statuses?${q}`);
      for (const s of data?.lastChangeStatuses ?? []) ids.add(s.productOrderId);
      if (!data?.more) break;
      ({ moreFrom: from, moreSequence: seq } = data.more);
    }
  }
  return [...ids];
}

async function productOrders(token, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await naver(token, '/v1/pay-order/seller/product-orders/query', {
      method: 'POST', body: JSON.stringify({ productOrderIds: ids.slice(i, i + 300) }),
    });
    out.push(...data);
  }
  return out;
}

// ---------- 변환 ----------

const fmtDate = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }); // 2026-10-26 17:41:00

/** 옵션 글자에서 자재를 알아본다. 모르면 null → 행에 '확인 필요'. */
export function material(name, option) {
  const t = `${name} ${option}`;
  if (/재단/.test(t) && !/템바보드 타입/.test(t)) return { skip: true }; // '재단 필요해요' 추가옵션
  const m = t.match(/몰딩.*?(2440|1200)|(2440|1200)\s*mm.*몰딩/);
  if (m) return { kind: '붙이는 마감몰딩', size: `15*${m[1] ?? m[2]}*12T`, molding: true };
  if (/100\s*[x*×]\s*2440/i.test(t)) return { kind: '붙이는 사각템바', size: '100*2440*12T' };
  if (/반달|원형/.test(t)) return { kind: '붙이는 반달템바', size: '295*2440*9T' };
  if (/사각/.test(t)) return { kind: '붙이는 사각템바', size: '300*2440*12T' };
  return null;
}

const colorCode = (t) => t.match(/JA([0-9A-Z]+)/)?.[1] ?? '';

export function toRows(orders) {
  // 몰딩·낱개 옵션엔 색이 없다. 같은 주문의 원장 색을 따라간다.
  const boardColor = {};
  for (const { order, productOrder: p } of orders) {
    const c = colorCode(p.productOption ?? '');
    if (c) boardColor[order.orderId] ??= c;
  }
  const rows = [];
  for (const { order, productOrder: p } of orders) {
    const mat = material(p.productName ?? '', p.productOption ?? '');
    if (mat?.skip) continue;
    const a = p.shippingAddress ?? {};
    const when = fmtDate(order.orderDate);
    rows.push([
      String(p.productOrderId), when,
      mat?.kind ?? '확인 필요', mat?.size ?? `${p.productName} / ${p.productOption ?? ''}`,
      colorCode(p.productOption ?? '') || boardColor[order.orderId] || '',
      p.quantity, '', '', when,
      a.name ?? '', a.tel1 ?? '', `${a.baseAddress ?? ''}-${a.detailedAddress ?? ''}`,
      '', '', p.shippingMemo ?? '', '', '',
    ]);
  }
  return rows;
}

// ---------- 구글 시트 ----------

async function googleToken() {
  const sa = JSON.parse(readFileSync(`${DIR}/google-sa.json`, 'utf8'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const jwt = `${body}.${createSign('RSA-SHA256').update(body).sign(sa.private_key, 'base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`구글 토큰 실패: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function sheets(token, path, init = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`시트 ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ---------- 실행 ----------

async function main() {
  const args = process.argv.slice(2);
  const days = Number(args[args.indexOf('--days') + 1]) || 1;
  const write = args.includes('--write');

  const nt = await naverToken();
  const ids = await payedProductOrderIds(nt, days);
  let rows = ids.length ? toRows(await productOrders(nt, ids)) : [];

  let gt;
  if (write) {
    gt = await googleToken();
    const range = encodeURIComponent(`${SHEET_TAB}!A:A`);
    const { values = [] } = await sheets(gt, `/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
    const have = new Set(values.flat().map(String));
    rows = rows.filter((r) => !have.has(r[0]));
  }

  console.log(`최근 ${days}일 결제완료 ${ids.length}건 → 추가할 행 ${rows.length}줄`);
  for (const r of rows) console.log(r.join('\t'));
  if (!write || !rows.length) return;

  // RAW: 주문번호가 숫자로 바뀌어 2.03E+15 로 보이지 않게 글자 그대로 넣는다
  const range = encodeURIComponent(`${SHEET_TAB}!A:Q`);
  await sheets(gt, `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', body: JSON.stringify({ values: rows }),
  });
  console.log(`시트 '${SHEET_TAB}' 에 ${rows.length}줄 추가`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
