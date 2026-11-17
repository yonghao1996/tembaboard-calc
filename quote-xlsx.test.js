import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { calculate } from './cutting.js';
import { quote } from './pricing.js';
import { QUOTE_SLOTS, quoteXlsx } from './quote-xlsx.js';

const dir = 'web/quote-template';
const template = Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name !== '.DS_Store')
  .map((d) => { const f = join(d.parentPath, d.name); return [f.slice(dir.length + 1), readFileSync(f).toString('base64')]; }));

const item = { shape: 'square', color: '화이트', width: 1970, height: 800, useMolding: true, trimEnds: false };

test('견적서 엑셀: 품명·수량·단가 수식이 양식 칸에 들어간다', () => {
  const lines = quote(calculate([item])).lines;
  const xml = Buffer.from(quoteXlsx(template, lines, '테스트학교')).toString('utf8');
  assert.match(xml, /<c r="B6" s="\d+" t="inlineStr"><is><t>테스트학교<\/t>/);
  assert.match(xml, /<c r="F11" s="\d+" t="inlineStr"><is><t>템바보드 사각<\/t>/);
  assert.match(xml, /<c r="G11" s="\d+" t="inlineStr"><is><t>JA3011-화이트<\/t>/);
  assert.match(xml, new RegExp(`<c r="I11" s="\\d+"><f>${lines[0].unit}/1.1</f>`));
  assert.match(xml, /<c r="L11" s="\d+"><f>\(J11\+K11\)<\/f>/);
  assert.match(xml, new RegExp(`<c r="F${QUOTE_SLOTS[6]}" s="\\d+"/>`), '빈 칸은 비운다');
  assert.match(xml, /fullCalcOnLoad="1"/);
});

test('견적서 엑셀: 양식 7줄을 넘으면 알린다', () => {
  const lines = Array.from({ length: 8 }, () => ({ item: 'x', note: '', count: 1, unit: 1, amount: 1 }));
  assert.throws(() => quoteXlsx(template, lines, ''), /7줄/);
});
