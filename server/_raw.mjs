import fs from 'node:fs';
import path from 'node:path';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const STANDARD_FONT_DIR = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts');

const file = process.argv[2];
const bytes = fs.readFileSync(file);
const doc = await pdfjs.getDocument({
  data: new Uint8Array(bytes),
  useSystemFonts: false,
  isEvalSupported: false,
  standardFontDataUrl: `${STANDARD_FONT_DIR}${path.sep}`,
}).promise;

const out = [];
const page = await doc.getPage(1);
const tc = await page.getTextContent();

for (const it of tc.items) {
  if (!it.str || !it.str.trim()) continue;
  // نبحث عن العنصر الذي يحتوي الكلمة الأخيرة من صف عاصم
  let base = null;
  try {
    const f = await page.commonObjs.get(it.fontName);
    if (f && f.name) base = f.name;
  } catch { /* ignore */ }

  const cps = [...it.str].map((c) => c.codePointAt(0));
  out.push(
    `x=${Math.round(it.transform[4] * 10) / 10} y=${Math.round(it.transform[5] * 10) / 10} w=${Math.round((it.width || 0) * 10) / 10} font=${base}`,
  );
  out.push('  str=' + JSON.stringify(it.str));
  out.push('  cps=' + cps.map((c) => 'U+' + c.toString(16).toUpperCase().padStart(4, '0')).join(' '));
  out.push('  len=' + it.str.length + ' hasEOL=' + it.hasEOL);
}
fs.writeFileSync('server/_raw_out.txt', out.join('\n'), 'utf8');
console.log('written', tc.items.length);
