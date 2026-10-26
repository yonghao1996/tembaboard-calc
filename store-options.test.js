import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeItems, decodeItems } from './store-options.js';

test('검수 링크는 입력을 그대로 되돌린다', () => {
  const items = [
    { shape: 'square', color: '화이트', width: 1200, height: 2000, useMolding: true, bottomMolding: true, trimEnds: false },
    { shape: 'half', color: '카키', width: 590, height: 800, useMolding: false, bottomMolding: false, trimEnds: true },
  ];
  const text = encodeItems(items);
  assert.equal(text, 's.화이트.1200x2000.tb~h.카키.590x800.e');
  assert.deepEqual(decodeItems(text), items);
  assert.deepEqual(decodeItems(decodeURIComponent(encodeURIComponent(text))), items);
});

test('깨진 링크는 읽을 수 있는 재단면만 남긴다', () => {
  assert.deepEqual(decodeItems(''), []);
  assert.equal(decodeItems('s.화이트.1200x2000.~x.카키.1x1.~s.화이트.abc.').length, 1);
});
