/**
 * 견적서 엑셀. 사장님 견적서 양식(web/quote-template/ = xlsx 를 푼 것)의 품목 칸만 채워 다시 묶는다.
 * 로고·직인·증서 탭·서식은 양식 그대로. 단가·세액·합계는 양식처럼 수식으로 남기고 엑셀이 다시 계산한다.
 * 양식을 바꾸려면: unzip -o 새양식.xlsx -d web/quote-template  후  node build.js
 */

/** 품목 칸: 11·13·…·23행 (2행씩 병합). 양식에 7줄뿐이다. */
export const QUOTE_SLOTS = [11, 13, 15, 17, 19, 21, 23];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 셀 하나를 바꾼다. 서식(s=)은 그대로 둔다. v: 문자열 / 숫자 / {f: 수식} / null(비움) */
function setCell(xml, ref, v) {
  const re = new RegExp(`<c r="${ref}"( s="\\d+")?[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  if (!re.test(xml)) throw new Error(`견적서 양식에 ${ref} 칸이 없습니다`);
  return xml.replace(re, (_, s = '') => {
    const open = `<c r="${ref}"${s}`;
    if (v === null || v === undefined || v === '') return `${open}/>`;
    if (typeof v === 'number') return `${open}><v>${v}</v></c>`;
    if (typeof v === 'object') return `${open}><f>${esc(v.f)}</f></c>`;
    return `${open} t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  });
}

/** 양식 sheet1.xml 에 받는 분과 견적 줄(pricing.quote().lines)을 채운다. */
export function fillQuoteSheet(xml, lines, customer = '') {
  if (lines.length > QUOTE_SLOTS.length) {
    throw new Error(`견적 품목이 ${lines.length}줄이라 양식(${QUOTE_SLOTS.length}줄)에 다 들어가지 않습니다`);
  }
  xml = setCell(xml, 'B6', customer);
  QUOTE_SLOTS.forEach((r, i) => {
    const l = lines[i];
    const row = l
      ? {
        F: l.item, G: l.amount === null ? `${l.note} (단가 미정)`.trim() : l.note, H: l.count,
        I: l.unit === null ? null : { f: `${l.unit}/1.1` },
        J: { f: `I${r}*H${r}` }, K: { f: `J${r}*0.1` }, L: { f: `(J${r}+K${r})` },
      }
      : { F: null, G: null, H: null, I: null, J: null, K: null, L: null };
    for (const [c, v] of Object.entries(row)) xml = setCell(xml, `${c}${r}`, v);
  });
  return xml;
}

/** 열 때 수식을 전부 다시 계산하게 한다 (캐시 값을 지웠으므로). */
export const recalcOnLoad = (xml) => xml.replace(/<calcPr[^>]*\/>|<calcPr[^>]*>[\s\S]*?<\/calcPr>/, '<calcPr fullCalcOnLoad="1"/>');

const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (b) => {
  let c = ~0;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};

/** 무압축(stored) zip. files: [[경로, Uint8Array]] */
export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = enc.encode(path), crc = crc32(data);
    const head = (sig, extra) => {
      const h = new DataView(new ArrayBuffer(extra));
      h.setUint32(0, sig, true);
      return h;
    };
    const local = head(0x04034b50, 30);
    // 버전 20, 플래그 0x800(UTF-8), 무압축, 날짜 1980-01-01
    local.setUint16(4, 20, true); local.setUint16(6, 0x800, true); local.setUint16(12, 33, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    const cen = head(0x02014b50, 46);
    cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x800, true); cen.setUint16(14, 33, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/** template: { 경로: base64 } (build.js 가 만든 quote-template.json). 반환: xlsx 바이트 */
export function quoteXlsx(template, lines, customer) {
  const dec = new TextDecoder(), enc = new TextEncoder();
  const bytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const edit = {
    'xl/worksheets/sheet1.xml': (x) => fillQuoteSheet(x, lines, customer),
    'xl/workbook.xml': recalcOnLoad,
  };
  const paths = Object.keys(template).sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
  return zipStore(paths.map((p) => [p, edit[p] ? enc.encode(edit[p](dec.decode(bytes(template[p])))) : bytes(template[p])]));
}
