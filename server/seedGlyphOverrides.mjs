/**
 * يبني data/glyph_overrides.json لرموز الخطوط غير المرمّزة.
 * يحسب بصمة SHA-1 لكل glyph من الخط المضمّن داخل ملف الـ PDF نفسه،
 * حتى لو تغيّر ترقيم GID في ملف مستقبلي بنفس الحروف.
 *
 * الاستخدام: node server/seedGlyphOverrides.mjs "<pdf1>" "<pdf2>" ...
 *
 * KNOWN: قاموس مُتحقَّق منه بصرياً (مطابقة النص المستخرَج بالصورة) لرموز Segoe UI غير المرمّزة.
 */
import fs from 'fs';
import zlib from 'zlib';
import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, PDFStream, PDFArray, PDFDict } from 'pdf-lib';
import { readJson, writeJson, DATA_DIR } from './db.mjs';

const KNOWN = {
  'ABCDEE+Segoe UI': {
    // — المجموعة الأصلية (تحقّقت منها بصرياً من الصفوف المستخرَج) —
    3941: 'ا', // يظهر في: صلاح، اسلام، بلال، السلام
    3948: 'س', // يظهر في: سرى
    3950: 'ش', // يظهر في: شريف  (مركّب: نفس 3948 + نقاط)
    3971: 'ص', // يظهر في: نصر الدين
    3981: 'ل', // يظهر في: صلاح، اسلام، بلال، السلام
    3992: 'ر', // يظهر في: شريف، سرى، نصر

    // — أشكال سياقية غير مرمّزة: تحققت منها بعرض مخططاتها الكبيرة
    //   ثم مطابقة النتيجة بالصف المطبوع الفعلي —
    3951: 'ش', // شكل بثلاث نقاط — يظهر في: «بشري»
    3970: 'ص', // حلقة ص بلا ذيل — يظهر في: «ناصر»
    3972: 'ض', // حلقة ص + نقطة أعلى — يظهر في: «ماضي»
    4011: 'ى', // بغرة بلا نقاط (ألف مقصورة) — تظهر في: «مرسى»، «الشامى»، «البردينى»
    4012: 'ي', // بغرة بنقطتين أسفل (ياء) — يظهر في: «مرسي»
  },
};

function tables(ttf) {
  const num = ttf.readUInt16BE(4);
  const T = {};
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    T[ttf.subarray(o, o + 4).toString('latin1')] = { off: ttf.readUInt32BE(o + 8), len: ttf.readUInt32BE(o + 12) };
  }
  return T;
}

function inflate(obj) {
  if (!(obj instanceof PDFStream)) return null;
  let c;
  try { c = obj.getContents(); } catch { return null; }
  const d = Buffer.from(c);
  try { return zlib.inflateSync(d); } catch { return d; }
}

function normalizeBase(name) {
  return String(name).replace(/^\//, '').replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function glyfBytes(ttf, gid) {
  const T = tables(ttf);
  if (!T.glyf || !T.loca) return null;
  const longLoca = !T.head || ttf.readInt16BE(T.head.off + 50) === 1;
  const at = (i) => (longLoca ? ttf.readUInt32BE(T.loca.off + i * 4) : ttf.readUInt16BE(T.loca.off + i * 2) * 2);
  const s = at(gid), e = at(gid + 1);
  if (!(e > s)) return null;
  return Buffer.from(ttf.subarray(T.glyf.off + s, T.glyf.off + e));
}

async function fontsOf(file) {
  const bytes = fs.readFileSync(file);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const found = new Map();
  function walk(res) {
    if (!(res instanceof PDFDict)) return;
    const fontsRef = res.get(PDFName.of('Fonts')) || res.get(PDFName.of('Font'));
    if (!fontsRef) return;
    const fonts = ctx.lookup(fontsRef);
    if (!(fonts instanceof PDFDict)) return;
    for (const key of fonts.keys()) {
      const f = ctx.lookup(fonts.get(key));
      if (!(f instanceof PDFDict)) continue;
      let t = f;
      const df = f.get(PDFName.of('DescendantFonts'));
      if (df) {
        const arr = ctx.lookup(df);
        if (arr instanceof PDFArray && arr.size()) t = ctx.lookup(arr.get(0)) || f;
      }
      const bf = t.get(PDFName.of('BaseFont')) || f.get(PDFName.of('BaseFont'));
      const base = bf ? normalizeBase(bf) : normalizeBase(key);
      const dRef = t.get(PDFName.of('FontDescriptor'));
      const desc = dRef ? ctx.lookup(dRef) : null;
      if (!desc) continue;
      for (const k of ['FontFile2', 'FontFile3', 'FontFile']) {
        const r = desc.get(PDFName.of(k));
        if (!r) continue;
        const d = inflate(ctx.lookup(r));
        if (d && d[0] === 0 && d[1] === 1) { if (!found.has(base)) found.set(base, d); break; }
      }
    }
  }
  for (const page of doc.getPages()) {
    const rr = page.node.get(PDFName.of('Resources'));
    if (rr) walk(ctx.lookup(rr));
  }
  return found;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node server/seedGlyphOverrides.mjs <file.pdf> [...]');
  process.exit(1);
}

const overrides = readJson('glyph_overrides.json', {}) || {};
let added = 0;

for (const file of files) {
  let fonts;
  try { fonts = await fontsOf(file); } catch (e) { console.error('skip', file, e.message); continue; }
  for (const [base, known] of Object.entries(KNOWN)) {
    const ttf = fonts.get(base);
    if (!ttf) { console.log(`!! ${base} not embedded in ${file}`); continue; }
    if (!overrides[base]) overrides[base] = { byGid: {}, byHash: {} };
    for (const [gid, ch] of Object.entries(known)) {
      overrides[base].byGid[gid] = ch;
      const b = glyfBytes(ttf, Number(gid));
      if (b) { overrides[base].byHash[createHash('sha1').update(b).digest('hex')] = ch; added++; }
    }
  }
  console.log('processed:', file);
}

await writeJson('glyph_overrides.json', overrides);
console.log(`\nwrote ${DATA_DIR}\\glyph_overrides.json (${added} hashes)`);
console.log(JSON.stringify(overrides, null, 2));
