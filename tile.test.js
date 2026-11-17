import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTiles, tileArea, formatTileOrder, formatTileQuote, encodeTiles, decodeTiles, validateTile, tileUnitPrice } from './tile.js';

test('장수 = 올림(가로 × 세로 ÷ 3600), 손실분 없음', () => {
  assert.equal(tileArea({ width: 300, height: 400 }).count, 34);   // 33.33
  assert.equal(tileArea({ width: 60, height: 60 }).count, 1);
  assert.equal(tileArea({ width: 600, height: 600 }).count, 100);
  assert.equal(tileArea({ width: 181.8, height: 181.8 }).count, 10); // 한평 ≈ 9.18장
  assert.equal(tileArea({ width: 5000, height: 5000 }).count, 6945); // 6944.4
});

test('단가 = 기본 2,900 + 옵션가', () => {
  assert.equal(tileUnitPrice('a', '마블화이트'), 2900);
  assert.equal(tileUnitPrice('a', '오트 베이지'), 3400);
  assert.equal(tileUnitPrice('n', '마블화이트'), 3600);
  assert.equal(tileUnitPrice('n', '테라조그레이'), null, '비접착식은 띄어 쓴 테라조 그레이');
  assert.equal(validateTile({ type: 'n', color: '실버화이트', width: 1, height: 1 })[0].code, 'COLOR_NOT_IN_TYPE');
});

test('시공면마다 올림하고 같은 옵션은 합친다. 줄 순서 = 스토어 옵션 순서', () => {
  const r = calculateTiles([
    { type: 'n', color: '실버 마블', width: 100, height: 100 },
    { type: 'a', color: '마블화이트', width: 300, height: 400 },
    { type: 'a', color: '마블화이트', width: 100, height: 100 },
  ]);
  assert.equal(formatTileOrder(r), [
    '데코타일 / 1. 접착식, 색상 / 마블화이트 : 37개',   // 34 + 3
    '데코타일 / 2. 비접착식, 색상 / 실버 마블 : 3개',
  ].join('\n'));
  assert.equal(r.total, 37 * 2900 + 3 * 3600);
  assert.match(formatTileQuote(r), /합계 : 118,100원$/);
  assert.deepEqual([r.lines[0].item, r.lines[0].note], ['데코타일 600x600 접착식', '마블화이트']);
});

test('검수 링크 왕복', () => {
  const items = [{ type: 'a', color: '허니스톤(그레이톤)', width: 300.5, height: 400 }, { type: 'n', color: '실버 마블', width: 100, height: 100 }];
  assert.deepEqual(decodeTiles(encodeTiles(items)), items);
  assert.deepEqual(decodeTiles('x.y.1x1~garbage'), []);
});
