import fs from 'node:fs';
import path from 'node:path';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const STANDARD_FONT_DIR = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts');
const OPS = pdfjs.OPS;

const file = process.argv[2];
const bytes = fs.readFileSync(file);
const doc = await pdfjs.getDocument({
  data: new Uint8Array(bytes),
  useSystemFonts: false,
  isEvalSupported: false,
  standardFontDataUrl: `${STANDARD_FONT_DIR}${path.sep}`,
}).promise;

const page = await doc.getPage(1);
const ol = await page.getOperatorList();

const out = [];
let curFont = null;
for (let i = 0; i < ol.fnArray.length; i++) {
  const fn = ol.fnArray[i];
  const args = ol.argsArray[i];
  if (fn === OPS.setFont) { curFont = args[0]; continue; }
  if (fn !== OPS.showText) continue;
  const glyphs = args[0];
  const codes = glyphs.map((g) => g.originalCharCode);
  if (!codes.includes(2274)) continue;
  out.push(`=== op ${i} font=${curFont} n=${glyphs.length} ===`);
  for (const g of glyphs) {
    out.push(`  code=${g.originalCharCode} unicode=${JSON.stringify(g.unicode)} fontChar=${JSON.stringify(g.fontChar)} width=${g.width} isInFont=${g.isInFont} isSpace=${g.isSpace}`);
  }
  if (out.length > 400) break;
}
fs.writeFileSync('server/_glyphs_out.txt', out.join('\n'), 'utf8');
console.log('written');
