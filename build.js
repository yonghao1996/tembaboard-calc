/**
 * dist/index.html 빌드.
 * colors.js / store-options.js / cutting.js / pricing.js 원본을 그대로 인라인한다.
 * (계산 로직을 페이지용으로 따로 복사해 두지 않기 위함)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

/** ESM 문법만 제거해서 클래식 스크립트로 만든다. */
const toClassic = (src) =>
  src
    .replace(/^import\b[\s\S]*?;\s*$/gm, '') // import 문 제거 (여러 줄 포함)
    .replace(/^export\s+/gm, '')             // export 키워드 제거
    .trim();

const bundle = [read('colors.js'), read('store-options.js'), read('cutting.js'), read('pricing.js')]
  .map(toClassic)
  .join('\n\n');

const html = read('web/index.template.html').replace('/*__BUNDLE__*/', () => bundle);

/**
 * 아티팩트는 <head> 를 알아서 씌워 주지만, 직접 서빙하는 파일은 아무도 안 씌워 준다.
 * charset 이 없으면 브라우저가 인코딩을 추측해서 한글이 깨진다.
 * 그래서 배포용은 완전한 문서로 감싼다.
 */
function standalone(fragment) {
  const cut = fragment.indexOf('<style>');
  const headBits = fragment.slice(0, cut).trim(); // title, 폰트 link
  const bodyBits = fragment.slice(cut);
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="템바보드 치수를 넣으면 주문 옵션, 재단 지시서, 자투리, 견적, 작업지시 도면을 계산합니다.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%239A7A08'/%3E%3Cpath d='M8 7v18h17' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='square'/%3E%3C/svg%3E">
${headBits}
</head>
<body>
${bodyBits}
</body>
</html>
`;
}

// index.html : 저장소 루트. 배포가 서빙하는 파일이라 항상 여기 있어야 한다 (커밋)
// dist/      : 아티팩트 게시용. 조각으로 둬야 한다 (gitignore)
const page = standalone(html);
writeFileSync(join(root, 'index.html'), page);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`index.html ${(page.length / 1024).toFixed(1)} KB (완전한 문서) · dist/index.html ${(html.length / 1024).toFixed(1)} KB (조각)`);
