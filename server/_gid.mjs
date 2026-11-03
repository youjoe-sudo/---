import fs from 'node:fs';
import path from 'node:path';
import { buildFontMaps, normalizeBase } from './pdfExtractor.mjs';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const STANDARD_FONT_DIR = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts');

const file = process.argv[2];
const bytes = fs.readFileSync(file);
const fontMaps = await buildFontMaps(bytes);

const doc = await pdfjs.getDocument({
  data: new Uint8Array(bytes),
  useSystemFonts: false,
  isEvalSupported: false,
  standardFontDataUrl: `${STANDARD_FONT_DIR}${path.sep}`,
}).promise;

const page = await doc.getPage(1);
await page.getOperatorList().catch(() => {});
const tc = await page.getTextContent();
const out = [];

for (const it of tc.items) {
  if (!it.str || !it.str.trim()) continue;
  const y = it.transform[5];
  const x = it.transform[4];
  if (Math.abs(y - 574.9) > 1 || Math.abs(x - 51.3) > 1) continue;

  let base = null;
  try {
    const f = await page.commonObjs.get(it.fontName);
    if (f && f.name) base = normalizeBase(f.name);
  } catch { /* ignore */ }

  const entry = base ? fontMaps.get(base) : null;
  out.push(`item x=${x} y=${y} base=${base} revSize=${entry ? entry.rev.size : 'none'}`);
  const gids = [...it.str].map((c) => c.codePointAt(0));
  out.push('gids: ' + gids.join(','));
  for (const gid of gids) {
    const ch = entry && entry.rev.has(gid) ? entry.rev.get(gid) : null;
    out.push(`  gid=${gid} char=${ch == null ? 'NULL' : JSON.stringify(ch)} cp=${ch == null ? '-' : 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} nfkc=${ch == null ? '-' : JSON.stringify(ch.normalize('NFKC'))}`);
  }
  break;
}

fs.writeFileSync('server/_gid_out.txt', out.join('\n'), 'utf8');
console.log('written');
