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

// index.html : 저장소 루트. 배포가 서빙하는 파일이라 항상 여기 있어야 한다 (커밋)
// dist/      : 아티팩트 게시용. 링크가 이 경로에 묶여 있다 (gitignore)
writeFileSync(join(root, 'index.html'), html);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`index.html, dist/index.html — ${(html.length / 1024).toFixed(1)} KB`);
