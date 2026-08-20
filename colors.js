/**
 * 색상 목록. 스토어 제품 옵션 기준.
 *
 * 색상 이름은 두 모양 공통이지만 **선택 가능한 색이 모양마다 다르다.**
 *   사각 14색 / 반달 6색
 * codes 에 해당 모양의 제품 코드가 있으면 그 모양에서 주문 가능한 색이다.
 *
 * JA3054 = 진한블루 (확인 완료). 사각 옵션 목록의 JA3054-연한블루도 받은 그대로 둔다.
 *
 * 정렬 순서는 사각 옵션 목록 순서를 따른다.
 */
export const COLORS = [
  { name: '화이트',   codes: { square: 'JA3011', half: 'JA3011' } },
  { name: '중간회색', codes: { square: 'JA3024' } },
  { name: '연한회색', codes: { square: 'JA3048' } },
  { name: '연한블루', codes: { square: 'JA3054' } },
  { name: '진한블루', codes: { square: 'JA3050', half: 'JA3054' } }, // 반달은 JA3054
  { name: '진한회색', codes: { square: 'JA2205' } },
  { name: '카키',     codes: { square: 'JA2210', half: 'JA2210' } },
  { name: '핑크',     codes: { square: 'JA3034' } },
  { name: '연한오크', codes: { square: 'JA8401', half: 'JA8401' } },
  { name: '중간오크', codes: { square: 'JA5021' } },
  { name: '진한오크', codes: { square: 'JA705',  half: 'JA705'  } },
  { name: '밝은오크', codes: { square: 'JA6W2' } },
  { name: '연한티크', codes: { square: 'JA5033' } },
  { name: '진한티크', codes: { square: 'JA0901', half: 'JA0901' } },
];

/** 출력 정렬 기준: COLORS 선언 순서 */
export const COLOR_ORDER = new Map(COLORS.map((c, i) => [c.name, i]));

export function findColor(name) {
  return COLORS.find((c) => c.name === name) ?? null;
}

/** 해당 모양의 제품 코드. 그 모양에 없는 색이면 null. */
export function colorCode(name, shapeKey) {
  return findColor(name)?.codes[shapeKey] ?? null;
}

/** 그 모양에서 주문 가능한 색인지 */
export function isColorAvailable(name, shapeKey) {
  return colorCode(name, shapeKey) !== null;
}

/** 모양별 선택 가능한 색상 목록 */
export function colorsForShape(shapeKey) {
  return COLORS.filter((c) => c.codes[shapeKey]);
}

/** 스토어 색상 옵션명 (예: JA3011-화이트) */
export function storeColorLabel(name, shapeKey) {
  const code = colorCode(name, shapeKey);
  return code ? `${code}-${name}` : name;
}

/**
 * 제품 코드별 색. 도면에 실제 제품 색을 칠하는 데 쓴다.
 * 색상 카드 이미지에서 눈으로 뽑은 대표색이라 실물과 차이가 있을 수 있다.
 * 정확한 값이 나오면 여기만 고치면 된다.
 */
export const CODE_SWATCH = {
  JA0901: '#8F6B4E', // 진한티크
  JA5033: '#C9A87C', // 연한티크
  JA6W2:  '#E3C98F', // 밝은오크
  JA705:  '#D9B682', // 진한오크
  JA5021: '#D3C2A8', // 중간오크
  JA8401: '#DACEBE', // 연한오크
  JA3034: '#D5A9A5', // 핑크
  JA2210: '#A19A85', // 카키
  JA2205: '#575B62', // 진한회색
  JA3050: '#5C6376', // 진한블루(사각)
  JA3054: '#4E5578', // 진한블루(반달) / 사각 옵션명은 연한블루
  JA3048: '#8C8F93', // 연한회색
  JA3024: '#9C9EA0', // 중간회색
  JA3011: '#ECEDEE', // 화이트
};

/** 해당 모양에서 그 색이 실제로 어떤 색인지 (#rrggbb). 모르면 null */
export function swatchOf(name, shapeKey) {
  const code = colorCode(name, shapeKey);
  return code ? (CODE_SWATCH[code] ?? null) : null;
}
