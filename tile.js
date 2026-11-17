/**
 * 데코타일 수량 계산기 (60 × 60). 템바보드 계산기와 같은 방식으로 주문 요약·견적·톡톡·검수 링크를 낸다.
 * 계산은 예전 계산기(tile.shbom.com) 그대로: 장수 = 올림(가로 × 세로 ÷ 3600 × 1.1). 치수 단위 cm.
 * 옵션·가격은 스마트스토어 옵션 엑셀(2026-11-17)에서 옮겼다. 바뀌면 TILE_OPTIONS / TILE_BASE_PRICE 만 고친다.
 */
import { CALC_URL } from './store-options.js';

export const TILE_SIZE = 60;          // cm
export const TILE_LOSS = 1.1;         // 손실 10%
export const TILE_BASE_PRICE = 2900;  // 1장 기본 판매가 (낱장 판매)
export const PYEONG = 3.305785;       // ㎡

/** 스토어 옵션: 1단 '데코타일' (접착식 / 비접착식) · 2단 '색상'. extra = 옵션가 */
export const TILE_TYPES = {
  a: { key: 'a', option: '1. 접착식', label: '접착식' },
  n: { key: 'n', option: '2. 비접착식', label: '비접착식' },
};
export const TILE_OPTIONS = {
  a: [
    ['마블 블루그레이', 0], ['마블 딥그레이', 0], ['마블화이트', 0], ['실버화이트', 0],
    ['허니스톤(그레이톤)', 0], ['그레이스톤', 0], ['테라조그레이', 0], ['테라조베이지', 0],
    ['테라조스노우칩', 0], ['테라조화이트', 0],
    ['마블 실버그레이', 500], ['허니스톤(베이지톤)', 500], ['오트 베이지', 500], ['스톤 그레이', 500],
    ['단색 실버', 500], ['실버 마블', 500],
  ],
  n: [
    ['마블화이트', 700], ['허니스톤(베이지톤)', 700], ['오트 베이지', 700], ['실버 마블', 700],
    ['스톤 그레이', 700], ['모카 샌드', 700], ['마블 딥그레이', 700], ['솔리드 실버', 700],
    ['솔리드 딥그레이', 700], ['테라조 그레이', 700], ['테라조 베이지', 700], ['테라조 화이트', 700],
  ],
};

export const TILE_CALC_URL = CALC_URL + 'tile/';

export const tileColors = (type) => (TILE_OPTIONS[type] ?? []).map(([name]) => name);
export const tileUnitPrice = (type, color) => {
  const hit = (TILE_OPTIONS[type] ?? []).find(([name]) => name === color);
  return hit ? TILE_BASE_PRICE + hit[1] : null;
};
export const tileWon = (n) => `${n.toLocaleString('ko-KR')}원`;

export function validateTile(it) {
  const errors = [];
  if (!(it.width > 0)) errors.push({ code: 'INVALID_WIDTH', message: '가로를 0보다 크게 입력하세요' });
  if (!(it.height > 0)) errors.push({ code: 'INVALID_HEIGHT', message: '세로를 0보다 크게 입력하세요' });
  if (tileUnitPrice(it.type, it.color) === null) {
    errors.push({ code: 'COLOR_NOT_IN_TYPE', message: `${TILE_TYPES[it.type]?.label ?? it.type} 에 없는 색상입니다` });
  }
  return errors;
}

/** 한 시공면. 장수 = 올림(면적 ÷ 타일 1장 × 1.1). 소수점 오차로 딱 떨어지는 값이 올라가지 않게 반올림 후 올림. */
export function tileArea(it) {
  const area = it.width * it.height;                 // ㎠
  const exact = area / (TILE_SIZE * TILE_SIZE);
  const count = Math.ceil(Math.round(exact * TILE_LOSS * 1e6) / 1e6);
  return { ...it, area, m2: area / 10000, pyeong: area / 10000 / PYEONG, exact, count };
}

/** 시공면마다 따로 올림한 뒤 같은 옵션(종류 + 색상)끼리 합친다. 줄 순서 = 스토어 옵션 순서. */
export function calculateTiles(items) {
  const areas = items.map(tileArea);
  const lines = [];
  for (const type of Object.keys(TILE_TYPES)) {
    for (const color of tileColors(type)) {
      const count = areas.filter((a) => a.type === type && a.color === color).reduce((n, a) => n + a.count, 0);
      if (count === 0) continue;
      const unit = tileUnitPrice(type, color);
      lines.push({
        label: `데코타일 / ${TILE_TYPES[type].option}, 색상 / ${color}`,
        count, unit, amount: unit * count,
        item: `데코타일 600x600 ${TILE_TYPES[type].label}`, note: color, // 견적서 엑셀 품명 / 비고
      });
    }
  }
  return { areas, lines, total: lines.reduce((n, l) => n + l.amount, 0), unknown: [] };
}

const fix = (n, d = 2) => n.toFixed(d);

export const formatTileOrder = (r) => r.lines.map((l) => `${l.label} : ${l.count}개`).join('\n');

export function formatTileSpaces(r) {
  return r.areas.map((a, i) =>
    `시공면 ${String(i + 1).padStart(2, '0')} : ${TILE_TYPES[a.type].label} ${a.color} ${a.width} × ${a.height}cm`
    + ` (${fix(a.m2)}㎡ · ${fix(a.pyeong)}평) → ${a.count}장`).join('\n');
}

export function formatTileQuote(r) {
  return [
    ...r.lines.map((l) => `${l.label} : ${l.count}개 × ${tileWon(l.unit)} = ${tileWon(l.amount)}`),
    `합계 : ${tileWon(r.total)}`,
  ].join('\n');
}

/** 검수 링크: 시공면을 `~` 로 잇고, 하나는 `종류.색상.가로x세로` (종류 a 접착식 / n 비접착식) */
export const encodeTiles = (items) => items.map((it) => [it.type, it.color, `${it.width}x${it.height}`].join('.')).join('~');
export function decodeTiles(text) {
  return String(text).split('~').map((part) => {
    const [type, color, ...rest] = part.split('.');
    const size = rest.join('.'); // 치수에 소수점이 들어갈 수 있다
    const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(size ?? '');
    if (!m || !TILE_TYPES[type] || !color) return null;
    return { type, color, width: Number(m[1]), height: Number(m[2]) };
  }).filter(Boolean);
}
