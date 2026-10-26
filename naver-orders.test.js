import { test } from 'node:test';
import assert from 'node:assert/strict';
import { material, toRows } from './naver-orders.js';

test('옵션 글자 → 자재', () => {
  assert.equal(material('붙이는 템바보드', '템바보드 타입: 사각 / 색상: JA8401-연한오크').size, '300*2440*12T');
  assert.equal(material('붙이는 템바보드', '템바보드 타입: 반달 / 색상: JA3011-화이트').size, '295*2440*9T');
  assert.equal(material('마감몰딩 2440mm 기준', '').size, '15*2440*12T');
  assert.equal(material('사각템바 (100x2440x12T)', '').size, '100*2440*12T');
  assert.ok(material('재단 필요해요', '톡톡으로 말씀주세요').skip);
  assert.equal(material('알 수 없는 상품', ''), null);
});

test('몰딩은 같은 주문 원장 색을 따라가고 재단 옵션은 행이 안 생긴다', () => {
  const order = { orderId: 'O1', orderDate: '2026-10-26T08:00:00.000+09:00' };
  const addr = { name: '홍길동', tel1: '010-0000-0000', baseAddress: '서울', detailedAddress: '1호' };
  const rows = toRows([
    { order, productOrder: { productOrderId: 1, productName: '템바보드', productOption: '템바보드 타입: 사각 / 색상: JA6W2-밝은오크', quantity: 4, shippingAddress: addr, shippingMemo: '사각-밝은오크 : 1200 - 8조각' } },
    { order, productOrder: { productOrderId: 2, productName: '마감몰딩 1200mm 기준', quantity: 2, shippingAddress: addr } },
    { order, productOrder: { productOrderId: 3, productName: '재단 필요해요', productOption: '톡톡으로 말씀주세요', quantity: 8, shippingAddress: addr } },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].slice(0, 6), ['1', '2026-10-26 08:00:00', '붙이는 사각템바', '300*2440*12T', '6W2', 4]);
  assert.equal(rows[0].length, 17);
  assert.equal(rows[0][14], '사각-밝은오크 : 1200 - 8조각');
  assert.equal(rows[1][4], '6W2');
  assert.equal(rows[1][3], '15*1200*12T');
});
