/**
 * 템바보드 재단 계산 로직.
 * UI 코드 없음. 순수 계산 + 출력 텍스트 포맷만 담당한다.
 * 규칙 출처: CLAUDE.md 2장(계산 로직), 3장(출력 형식).
 */
import { COLOR_ORDER, findColor, isColorAvailable, storeColorLabel } from './colors.js';
import { STORE_OPTIONS } from './store-options.js';

/** 모양별 원장 규격. 유효폭 = 실측폭(옆판 겹침 손실 없음). */
export const SHAPES = {
  half:   { key: 'half',   label: '반달', effectiveWidth: 295, sheetLength: 2440 },
  square: { key: 'square', label: '사각', effectiveWidth: 300, sheetLength: 2440 },
};

/** 예전 표기(원형)로 들어온 입력도 계속 받는다. */
export const SHAPE_ALIASES = { round: 'half', 원형: 'half' };

/** 톱날 손실(커프). 재단 1회당, 조각과 조각 사이에만 발생. */
export const KERF = 20;
/** 끝단 정리 선택 시 원장에서 빠지는 길이. */
export const TRIM_LOSS = 20;
/** 상단 마감몰딩 1면 차감. */
export const MOLDING_DEDUCTION = 15;
/** 재단 손실. 조각을 자를 때마다 세로가 이만큼 줄어든다. 조각 1개당 1회. */
export const CUT_LOSS = 5;
/** 낱개 템바 폭 (100 × 2440). 원장으로 못 채우는 자투리 폭을 이걸로 메운다. */
export const STRIP_WIDTH = 100;
/** 마감몰딩 규격 (15 × L × 12t). 긴 것부터. */
export const MOLDING_LENGTHS = [2440, 1200];
export const MOLDING_TYPE = '민자';

/** 자재 종류: 원장(유효폭) / 낱개 템바(100폭) */
export const STOCK_BOARD = 'board';
export const STOCK_STRIP = 'strip';

export class CuttingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CuttingError';
    this.code = code;
  }
}

export function resolveShape(shape) {
  if (typeof shape === 'string') {
    if (SHAPES[shape]) return SHAPES[shape];
    if (SHAPE_ALIASES[shape]) return SHAPES[SHAPE_ALIASES[shape]];
    const byLabel = Object.values(SHAPES).find((s) => s.label === shape);
    if (byLabel) return byLabel;
  }
  throw new CuttingError('INVALID_SHAPE', `알 수 없는 모양: ${shape}`);
}

// --- 2.2 완성 치수 / 재단 길이 (세로) ---------------------------------------
// 몰딩은 상단 한 면에만 붙으므로 세로 차감은 15mm 1회.
// 완성 치수 = 고객에게 나가는 길이.
export function finishedLength(height, useMolding) {
  return useMolding ? height - MOLDING_DEDUCTION : height;
}

// 재단하면 조각 세로가 5mm 줄어든다. 완성 치수를 맞추려면 그만큼 크게 잘라야 하므로
// 원장에서 실제로 잘라내는 길이(= 원장 점유 길이)는 완성 치수 + 5.
// 재단 지시서에 찍히는 값도 이 길이다.
export function cutLength(height, useMolding) {
  return finishedLength(height, useMolding) + CUT_LOSS;
}

// --- 2.2b 세로 나누기 -------------------------------------------------------
// 세로가 원장 유효길이를 넘으면 한 장으로 못 뽑는다. 길이를 나눠서 이어 붙인다.
// 조각 하나가 가질 수 있는 최대 완성 길이 = 유효길이 - 재단손실.
// 이음을 최소로 하려고 앞 조각부터 최대로 채우고 마지막 조각이 나머지를 갖는다.
export function lengthPlan(finished, usableLength) {
  const max = usableLength - CUT_LOSS;
  const count = Math.max(1, Math.ceil(finished / max));
  const segments = [];
  let left = finished;
  for (let i = 0; i < count; i++) {
    const seg = Math.min(max, left);
    segments.push(seg);
    left -= seg;
  }
  return segments;
}

// --- 2.3 가로 채우기 --------------------------------------------------------
// 원장(유효폭)으로 채울 수 있는 만큼 채우고, 남는 폭은 100mm 낱개 템바로 메운다.
// 예) 사각 400 → 300 × 1장 + 100 × 1장
//
// 단, 낱개로 메우는 폭이 원장 폭 이상이면 원장 1장으로 대신한다.
// 자재량은 같거나 적으면서 개수는 적기 때문. (사각 남는 폭 250 → 낱개 3개 300 = 원장 1장)
// 그래서 낱개는 최대 (유효폭 - 100) 폭까지만 쓴다. 사각 200 / 반달 195.
//
// 마지막 1장(낱개든 원장이든)은 폭을 잘라 쓰고 자투리는 버린다.
export function widthPlan(width, effectiveWidth) {
  let boards = Math.floor(width / effectiveWidth);
  const rest = width - boards * effectiveWidth;
  let strips = rest > 0 ? Math.ceil(rest / STRIP_WIDTH) : 0;

  let scrap = 0;
  let scrapFrom = null;
  if (strips > 0) {
    if (strips * STRIP_WIDTH >= effectiveWidth) {
      boards += 1;
      strips = 0;
      scrap = effectiveWidth - rest;
      scrapFrom = scrap > 0 ? STOCK_BOARD : null;
    } else {
      scrap = strips * STRIP_WIDTH - rest;
      scrapFrom = scrap > 0 ? STOCK_STRIP : null;
    }
  }

  return {
    boards,
    strips,
    /** 마지막 1장을 폭 재단하고 버리는 양 */
    scrap,
    /** 그 자투리가 원장에서 나오는지 낱개에서 나오는지 */
    scrapFrom,
    covered: boards * effectiveWidth + strips * STRIP_WIDTH,
  };
}

/** 재단 조각 총 개수 (원장 조각 + 낱개 조각) */
export function pieceCount(width, effectiveWidth) {
  const plan = widthPlan(width, effectiveWidth);
  return plan.boards + plan.strips;
}

// --- 2.4 원장 유효 길이 -----------------------------------------------------
export function usableSheetLength(shapeSpec, trimEnds) {
  return shapeSpec.sheetLength - (trimEnds ? TRIM_LOSS : 0);
}

// --- 2.5 원장 1개당 뽑을 수 있는 개수 ---------------------------------------
// n × L + (n-1) × KERF ≤ 유효길이  →  n = floor((유효길이 + KERF) / (L + KERF))
export function piecesPerSheet(length, usableLength) {
  if (length > usableLength) return 0;
  return Math.floor((usableLength + KERF) / (length + KERF));
}

// --- 2.6 소요 원장 수 -------------------------------------------------------
export function sheetsNeeded(pieces, perSheet) {
  if (perSheet <= 0) throw new CuttingError('NO_FIT', '원장에서 뽑을 수 없는 길이입니다.');
  return Math.ceil(pieces / perSheet);
}

// --- 2.7 재단 횟수 (스토어 '재단 필요해요' 수량) ----------------------------
// 원장 길이를 재단 길이로 나눈 횟수 × 가로 장수.
// 예) 2440 / 800 → 3회, 폭 1200(사각 300) → 4장 → 3 × 4 = 12회
export function cutCount(usableLength, length, pieces) {
  return Math.floor(usableLength / length) * pieces;
}

// --- 2.8 몰딩 수량 ----------------------------------------------------------
// 필요 길이 = 고객 입력 가로. 2440/1200 조합으로 덮는다.
// 1순위 총 개수 최소, 2순위 자투리 최소. 이음부 커프 손실은 계산하지 않는다.
export function moldingPlan(width) {
  const [long, short] = MOLDING_LENGTHS;
  let best = null;
  for (let a = 0; a <= Math.ceil(width / long); a++) {
    const rest = width - a * long;
    const b = rest > 0 ? Math.ceil(rest / short) : 0;
    const total = a * long + b * short;
    const cand = { count: a + b, leftover: total - width, total, pieces: { [long]: a, [short]: b } };
    if (!best || cand.count < best.count || (cand.count === best.count && cand.leftover < best.leftover)) {
      best = cand;
    }
  }
  const items = MOLDING_LENGTHS
    .filter((len) => best.pieces[len] > 0)
    .map((len) => ({ length: len, count: best.pieces[len] }));
  return { items, count: best.count, total: best.total, leftover: best.leftover };
}

// --- 자투리 -----------------------------------------------------------------
// (1) 세로 자르고 남은 부분: 자재 끝에 남는 토막.
//     마지막 자재는 조각 수가 모자랄 수 있으므로 따로 계산한다.
//     커프는 조각과 조각 사이에만 계산한다(2.5 모델). 남는 토막을 톱으로 떼어내는
//     마지막 1컷(20mm)은 빼지 않은 값이다.
export function sheetTails(pieces, perSheet, usableLength, length) {
  const sheets = sheetsNeeded(pieces, perSheet);
  const lastCount = pieces - (sheets - 1) * perSheet;
  const tailOf = (n) => usableLength - (n * length + (n - 1) * KERF);

  const map = new Map();
  const add = (tail, count) => {
    if (tail > 0 && count > 0) map.set(tail, (map.get(tail) ?? 0) + count);
  };
  add(tailOf(perSheet), sheets - 1); // 가득 채운 자재
  add(tailOf(lastCount), 1);         // 마지막 자재

  return [...map.entries()]
    .map(([tail, count]) => ({ length: tail, count }))
    .sort((a, b) => b.length - a.length);
}

// (2) 가로 자르고 남은 부분: 마지막 100mm 낱개를 폭 재단하고 버리는 조각.
//     widthPlan().scrap 참조.
// (3) 몰딩 자투리는 moldingPlan().leftover 참조.

function mergeWidthScraps(scraps) {
  const map = new Map();
  for (const s of scraps) {
    const key = `${s.width}|${s.length}`;
    const row = map.get(key) ?? { width: s.width, length: s.length, count: 0 };
    row.count += s.count;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.width - a.width || b.length - a.length);
}

// --- 입력 검증 (CLAUDE.md 5-(4)) --------------------------------------------
export function validateItem(input) {
  const errors = [];
  const { width, height, useMolding = false, trimEnds = false } = input;

  let shapeSpec = null;
  try {
    shapeSpec = resolveShape(input.shape);
  } catch (e) {
    errors.push({ code: e.code, message: e.message });
  }

  if (!findColor(input.color)) {
    errors.push({ code: 'INVALID_COLOR', message: `알 수 없는 색상: ${input.color}` });
  } else if (shapeSpec && !isColorAvailable(input.color, shapeSpec.key)) {
    errors.push({
      code: 'COLOR_NOT_IN_SHAPE',
      message: `${shapeSpec.label}에는 ${input.color}이(가) 없습니다.`,
    });
  }
  if (!Number.isFinite(width) || width <= 0) {
    errors.push({ code: 'INVALID_WIDTH', message: '가로는 0보다 큰 값이어야 합니다.' });
  }
  if (!Number.isFinite(height) || height <= 0) {
    errors.push({ code: 'INVALID_HEIGHT', message: '세로는 0보다 큰 값이어야 합니다.' });
  } else if (shapeSpec) {
    const finished = finishedLength(height, useMolding);
    if (finished <= 0) {
      errors.push({
        code: 'CUT_LENGTH_TOO_SMALL',
        message: `몰딩 ${MOLDING_DEDUCTION}mm 차감 후 완성 치수가 0 이하입니다. (세로 ${height})`,
      });
    }
    // 세로 상한은 두지 않는다. 유효길이를 넘으면 나눠서 이어 붙인다(lengthPlan).
  }
  return errors;
}

/** 항목 1건 계산. 검증 실패 시 CuttingError 를 던진다. */
export function calculateItem(input) {
  const errors = validateItem(input);
  if (errors.length > 0) {
    const err = new CuttingError(errors[0].code, errors[0].message);
    err.errors = errors;
    throw err;
  }

  const shapeSpec = resolveShape(input.shape);
  const { width, height, useMolding = false, trimEnds = false } = input;

  const finished = finishedLength(height, useMolding);
  const usableLength = usableSheetLength(shapeSpec, trimEnds);
  const plan = widthPlan(width, shapeSpec.effectiveWidth);
  const pieces = plan.boards + plan.strips;

  // 세로가 유효길이를 넘으면 여러 조각으로 나눠 이어 붙인다.
  const segments = lengthPlan(finished, usableLength).map((segFinished) => {
    const length = segFinished + CUT_LOSS;
    const perSheet = piecesPerSheet(length, usableLength);
    // 원장과 낱개는 자재가 다르므로 소요 수량도 따로 센다.
    const stocks = [
      { kind: STOCK_BOARD, stockWidth: shapeSpec.effectiveWidth, pieces: plan.boards },
      { kind: STOCK_STRIP, stockWidth: STRIP_WIDTH, pieces: plan.strips },
    ]
      .filter((s) => s.pieces > 0)
      .map((s) => ({ ...s, bars: sheetsNeeded(s.pieces, perSheet) }));

    return {
      finishedLength: segFinished,
      cutLength: length,
      piecesPerSheet: perSheet,
      pieces,
      stocks,
      // 폭 자투리도 같이 재단되므로 길이는 완성 치수 기준. 조각마다 하나씩 나온다.
      widthScrap: plan.scrap > 0 ? { width: plan.scrap, length: segFinished, count: 1 } : null,
      widthScrapFrom: plan.scrapFrom,
    };
  });

  const barsOf = (kind) => segments.reduce(
    (n, seg) => n + seg.stocks.filter((s) => s.kind === kind).reduce((m, s) => m + s.bars, 0), 0);

  return {
    input: { ...input, useMolding, trimEnds },
    shape: shapeSpec,
    color: findColor(input.color),
    width,
    height,
    finishedLength: finished,
    /** 첫 조각 기준. 나눠진 경우 전체는 segments 참조. */
    cutLength: segments[0].cutLength,
    segments,
    /** 이음 개수 (0이면 한 장으로 나옴) */
    joints: segments.length - 1,
    widthPlan: plan,
    pieces,
    usableLength,
    piecesPerSheet: segments[0].piecesPerSheet,
    sheets: barsOf(STOCK_BOARD),
    strips: barsOf(STOCK_STRIP),
    cutCount: segments.reduce((n, seg) => n + cutCount(usableLength, seg.cutLength, seg.pieces), 0),
    molding: useMolding ? moldingPlan(width) : null,
  };
}

// --- 3. 합산 / 정렬 ---------------------------------------------------------
// 동일 사양(모양 + 색상 + 재단길이 + 자재)은 합산하여 한 줄로 출력. 정렬은 색상별.
function colorRank(name) {
  return COLOR_ORDER.has(name) ? COLOR_ORDER.get(name) : Number.MAX_SAFE_INTEGER;
}

function bySpec(a, b) {
  return (
    colorRank(a.color) - colorRank(b.color) ||
    (a.color ?? '').localeCompare(b.color ?? '') ||
    (a.shape ?? '').localeCompare(b.shape ?? '') ||
    (a.kind === STOCK_STRIP ? 1 : 0) - (b.kind === STOCK_STRIP ? 1 : 0) ||
    (a.cutLength ?? 0) - (b.cutLength ?? 0) ||
    (a.length ?? 0) - (b.length ?? 0)
  );
}

export function calculate(inputs) {
  const items = inputs.map(calculateItem);

  // 원장당 개수는 끝단정리 여부에 따라 달라지므로 소요 수량 계산은 trimEnds 까지 묶는다.
  const buckets = new Map();
  for (const item of items) {
    for (const seg of item.segments) {
      for (const stock of seg.stocks) {
        const key = [item.shape.label, item.color.name, seg.cutLength, item.input.trimEnds, stock.kind].join('|');
        const bucket = buckets.get(key) ?? {
          shape: item.shape.label,
          shapeKey: item.shape.key,
          color: item.color.name,
          kind: stock.kind,
          stockWidth: stock.stockWidth,
          cutLength: seg.cutLength,
          finishedLength: seg.finishedLength,
          piecesPerSheet: seg.piecesPerSheet,
          usableLength: item.usableLength,
          sheetLength: item.shape.sheetLength,
          trimEnds: item.input.trimEnds,
          pieces: 0,
          widthScraps: [],
        };
        bucket.pieces += stock.pieces;
        if (seg.widthScrap && stock.kind === seg.widthScrapFrom) bucket.widthScraps.push(seg.widthScrap);
        buckets.set(key, bucket);
      }
    }
  }
  for (const bucket of buckets.values()) {
    bucket.bars = sheetsNeeded(bucket.pieces, bucket.piecesPerSheet);
    // 자투리는 합산된 조각 수 기준으로 다시 계산한다.
    // (2건을 한 자재에 몰아 뽑으면 자투리도 줄어들기 때문)
    bucket.sheetTails = sheetTails(bucket.pieces, bucket.piecesPerSheet, bucket.usableLength, bucket.cutLength);
  }

  // 재단 지시서: 모양 + 색상 + 재단길이 + 자재
  const cutMap = new Map();
  for (const b of buckets.values()) {
    const key = [b.shape, b.color, b.cutLength, b.kind].join('|');
    const row = cutMap.get(key) ?? {
      shape: b.shape, color: b.color, kind: b.kind, stockWidth: b.stockWidth,
      cutLength: b.cutLength, finishedLength: b.finishedLength, pieces: 0,
    };
    row.pieces += b.pieces;
    cutMap.set(key, row);
  }
  const cuts = [...cutMap.values()].sort(bySpec);

  // 주문 수량: 모양 + 색상 + 자재
  const stockMap = new Map();
  for (const b of buckets.values()) {
    const key = [b.shape, b.color, b.kind].join('|');
    const row = stockMap.get(key) ?? {
      shape: b.shape, shapeKey: b.shapeKey, color: b.color, kind: b.kind, bars: 0,
    };
    row.bars += b.bars;
    stockMap.set(key, row);
  }
  const stocks = [...stockMap.values()].sort(bySpec);
  const boards = stocks
    .filter((s) => s.kind === STOCK_BOARD)
    .map((s) => ({ shape: s.shape, shapeKey: s.shapeKey, color: s.color, sheets: s.bars }));
  const stripOrders = stocks.filter((s) => s.kind === STOCK_STRIP);

  // 몰딩: 색상 + 규격. 색상은 보드 색상을 따라간다.
  const moldingMap = new Map();
  for (const item of items) {
    if (!item.molding) continue;
    for (const m of item.molding.items) {
      const key = `${item.color.name}|${m.length}`;
      const row = moldingMap.get(key) ?? { color: item.color.name, length: m.length, count: 0 };
      row.count += m.count;
      moldingMap.set(key, row);
    }
  }
  const moldings = [...moldingMap.values()].sort(bySpec);

  // 자투리: 재단 지시서와 같은 단위로 묶는다.
  const leftoverMap = new Map();
  for (const b of buckets.values()) {
    const key = [b.shape, b.color, b.cutLength, b.kind].join('|');
    const row = leftoverMap.get(key) ?? {
      shape: b.shape, shapeKey: b.shapeKey, color: b.color, kind: b.kind, stockWidth: b.stockWidth,
      cutLength: b.cutLength, sheetTails: [], widthScraps: [],
    };
    row.sheetTails.push(...b.sheetTails);
    row.widthScraps.push(...b.widthScraps); // 폭 자투리는 마지막 낱개에서 나온다
    leftoverMap.set(key, row);
  }
  const leftovers = [...leftoverMap.values()]
    .map((row) => ({
      ...row,
      sheetTails: [...row.sheetTails
        .reduce((m, t) => m.set(t.length, (m.get(t.length) ?? 0) + t.count), new Map())]
        .map(([length, count]) => ({ length, count }))
        .sort((a, b) => b.length - a.length),
      widthScraps: mergeWidthScraps(row.widthScraps),
    }))
    .sort(bySpec);

  // 몰딩 자투리. 따로 떨어지는 조각이므로 길이별로 센다(합산하지 않는다).
  const moldingLeftoverMap = new Map();
  for (const item of items) {
    if (!item.molding) continue;
    const key = [item.color.name, item.shape.key, item.molding.leftover].join('|');
    const row = moldingLeftoverMap.get(key) ??
      { color: item.color.name, shapeKey: item.shape.key, leftover: item.molding.leftover, count: 0 };
    row.count += 1;
    moldingLeftoverMap.set(key, row);
  }
  const moldingLeftovers = [...moldingLeftoverMap.values()].sort(bySpec);

  return {
    items,
    boards,
    stripOrders,
    cuts,
    moldings,
    leftovers,
    moldingLeftovers,
    cutCount: items.reduce((n, it) => n + it.cutCount, 0),
    joints: items.reduce((n, it) => n + it.joints, 0),
    barGroups: barGroupsOf([...buckets.values()].sort(bySpec)),
    walls: items.map(wallLayout),
  };
}

// --- 4. 도면 데이터 ---------------------------------------------------------
// 숫자와 그림이 어긋나지 않도록, 계산에 쓴 버킷에서 그대로 뽑는다.

/**
 * 자재 1개(원장 또는 낱개)에 조각이 어떻게 들어가는지.
 * 같은 모양의 자재는 묶어서 bars 개수로 센다.
 */
export function barGroupsOf(buckets) {
  const groups = new Map();
  for (const b of buckets) {
    let left = b.pieces;
    while (left > 0) {
      const count = Math.min(b.piecesPerSheet, left);
      const used = count * b.cutLength + (count - 1) * KERF;
      const key = [b.shape, b.color, b.kind, b.cutLength, count, b.trimEnds].join('|');
      const group = groups.get(key) ?? {
        shape: b.shape,
        shapeKey: b.shapeKey,
        color: b.color,
        kind: b.kind,
        stockWidth: b.stockWidth,
        sheetLength: b.sheetLength,
        usableLength: b.usableLength,
        trimEnds: b.trimEnds,
        cutLength: b.cutLength,
        /** 자재 1개에 들어가는 조각 수 */
        count,
        used,
        tail: b.usableLength - used,
        /** 이렇게 생긴 자재가 몇 개인지 */
        bars: 0,
      };
      group.bars += 1;
      groups.set(key, group);
      left -= count;
    }
  }
  return [...groups.values()];
}

/**
 * 벽면 배치도. 가로는 자재 열, 세로는 조각(이음)으로 나뉜다.
 * 마지막 열은 폭을 잘라 쓰므로 실제 폭이 줄어든다.
 */
export function wallLayout(item) {
  const { boards, strips, scrap } = item.widthPlan;
  const nominal = [
    ...Array.from({ length: boards }, () => ({ kind: STOCK_BOARD, width: item.shape.effectiveWidth })),
    ...Array.from({ length: strips }, () => ({ kind: STOCK_STRIP, width: STRIP_WIDTH })),
  ];
  const columns = nominal.map((c, i) => ({
    ...c,
    nominal: c.width,
    width: i === nominal.length - 1 ? c.width - scrap : c.width,
    trimmed: i === nominal.length - 1 && scrap > 0,
  }));

  const rows = [];
  if (item.input.useMolding) rows.push({ kind: 'molding', length: MOLDING_DEDUCTION });
  for (const seg of item.segments) {
    rows.push({ kind: 'piece', length: seg.finishedLength, cutLength: seg.cutLength });
  }

  return { width: item.width, height: item.height, columns, rows };
}

/**
 * 자투리 목록. 재단이 끝나고 손에 남는 조각을 한 곳에 모은다.
 * 같은 크기·같은 출처는 묶어서 센다.
 */
export function leftoverPieces(result) {
  const map = new Map();
  const add = (p) => {
    const key = [p.shape, p.color, p.width, p.length, p.from].join('|');
    const row = map.get(key) ?? { ...p, count: 0 };
    row.count += p.count;
    map.set(key, row);
  };

  for (const row of result.leftovers) {
    for (const t of row.sheetTails) {
      add({ shape: row.shape, shapeKey: row.shapeKey, color: row.color, kind: row.kind,
        width: row.stockWidth, length: t.length, count: t.count, from: 'cut' });
    }
    for (const s of row.widthScraps) {
      add({ shape: row.shape, shapeKey: row.shapeKey, color: row.color, kind: row.kind,
        width: s.width, length: s.length, count: s.count, from: 'rip' });
    }
  }
  for (const m of result.moldingLeftovers) {
    if (m.leftover <= 0) continue;
    add({ shape: '마감몰딩', shapeKey: m.shapeKey, color: m.color, kind: 'molding',
      width: 15, length: m.leftover, count: m.count, from: 'molding' });
  }

  return [...map.values()].sort((a, b) => b.width * b.length - a.width * a.length);
}

export const LEFTOVER_SOURCE = {
  cut: '세로 자르고 남은 부분',
  rip: '가로 자르고 남은 부분',
  molding: '마감몰딩 남은 길이',
};

// --- 3. 출력 형식 -----------------------------------------------------------

/** 같은 스토어 옵션에 색이 둘 이상 섞이면 괄호로 내역을 덧붙인다. */
function colorNote(rows, countOf) {
  return rows.length > 1 ? ` (${rows.map((r) => `${r.color} ${countOf(r)}`).join(', ')})` : '';
}

/**
 * 주문 요약. 스토어 옵션명 그대로 적어서 주문서와 한 줄씩 대조할 수 있게 한다.
 * 줄 순서도 스토어 옵션 순서를 따른다.
 */
export function formatOrderSummary(result) {
  const lines = result.boards.map((b) =>
    `${STORE_OPTIONS.shape} / ${b.shape}, ${STORE_OPTIONS.color} / ` +
    `${storeColorLabel(b.color, b.shapeKey)} : ${b.sheets}개`);

  if (result.cutCount > 0) {
    lines.push(`${STORE_OPTIONS.cutting} : ${result.cutCount}개`);
  }

  for (const length of MOLDING_LENGTHS) {
    const rows = result.moldings.filter((m) => m.length === length);
    if (rows.length === 0) continue;
    const total = rows.reduce((sum, m) => sum + m.count, 0);
    lines.push(`${STORE_OPTIONS.moldingByLength[length]} : ${total}개${colorNote(rows, (r) => r.count)}`);
  }

  for (const shapeKey of Object.keys(SHAPES)) {
    const rows = result.stripOrders.filter((s) => s.shapeKey === shapeKey);
    if (rows.length === 0) continue;
    const total = rows.reduce((sum, s) => sum + s.bars, 0);
    lines.push(`${STORE_OPTIONS.stripByShape[shapeKey]} : ${total}개${colorNote(rows, (r) => r.bars)}`);
  }

  return lines.join('\n');
}

/** 재단 지시서. 작업장용이라 색상 이름만 쓴다. 낱개는 100폭으로 표시. */
export function formatCuttingSheet(result) {
  return result.cuts
    .map((c) => {
      const stock = c.kind === STOCK_STRIP ? ` ${STRIP_WIDTH}폭` : '';
      return `${c.shape}-${c.color}${stock} : ${c.cutLength} X ${c.pieces}컷`;
    })
    .join('\n');
}

export const NO_LEFTOVER_TEXT = '자투리 없음';

/**
 * 자투리 내역.
 * 작업장 용어(원장/자투리) 대신 실제 조각 크기를 가로 X 세로로 적는다.
 */
export function formatLeftovers(result) {
  const lines = [];
  for (const row of result.leftovers) {
    for (const t of row.sheetTails) {
      lines.push(`${row.shape}-${row.color} : 가로 ${row.stockWidth} X 세로 ${t.length}, ${t.count}개 (세로 자르고 남은 부분)`);
    }
    for (const s of row.widthScraps) {
      lines.push(`${row.shape}-${row.color} : 가로 ${s.width} X 세로 ${s.length}, ${s.count}개 (가로 자르고 남은 부분)`);
    }
  }
  for (const m of result.moldingLeftovers) {
    if (m.leftover <= 0) {
      lines.push(`마감몰딩-${m.color} : 남는 길이 없음`);
    } else {
      lines.push(`마감몰딩-${m.color} : ${m.leftover} 남음` + (m.count > 1 ? `, ${m.count}개` : ''));
    }
  }
  return lines.join('\n');
}

/** 재단 지시서 + 자투리 (클립보드 복사용 전체 텍스트) */
export function formatCuttingSheetWithLeftovers(result) {
  const leftovers = formatLeftovers(result) || NO_LEFTOVER_TEXT;
  return `${formatCuttingSheet(result)}\n\n--- 자투리 ---\n${leftovers}`;
}
