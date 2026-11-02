/**
 * استخراج كشوف الفصول من ملفات PDF الصادرة عن Microsoft SQL Reporting Services.
 *
 * السبب الجذري للتعقيد:
 *   - خطوط PDF مضمّنة بترميز Identity-H وبجدول ToUnicode فارغ تماماً.
 *   - لذلك تعيد pdf.js "الرمز المعرّف للرمز الرمزي" (GID) كأنه نص، فيظهر عربياً مشوّهاً.
 *   - الحل: بناء خريطة عكسية GID -> Unicode من جدول cmap داخل الخط المضمّن نفسه،
 *            ثم عكس الترتيب البصري -> المنطقي، ثم توحيد النماذج العربية (presentation forms).
 *   - بعض الرموز غير مرمّزة في الخط (6 رموز في Segoe UI) => تُحلّ عبر خريطة التصحيح
 *            glyph_overrides.json (بالخط+GID أو ببصمة شكل الرمز)، وإلا تُعلَّم للمراجعة.
 */
import fs from 'fs';
import path from 'node:path';
import zlib from 'zlib';
import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, PDFStream, PDFArray, PDFDict } from 'pdf-lib';
import { readJson, log, ROOT } from './db.mjs';

const STANDARD_FONT_DIR = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts');

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const ARABIC_LETTER = /[\u0621-\u063A\u0641-\u064A\u066E-\u06D3\u0750-\u077F\u0640\uFB50-\uFEFF]/;
const LTR_RUN = /[0-9A-Za-z\u0660-\u0669\/\.\-:%]+/g;
const HAS_ARABIC_LETTER = /[\u0621-\u064A\u066E-\u06D3\u0750-\u077F\u0640\uFB50-\uFEFF]/;

const REPLACEMENT = '\uFFFD';

/* ------------------------------------------------------------------ */
/* خطوط TrueType: قراءة cmap و glyf                                   */
/* ------------------------------------------------------------------ */

function readTables(ttf) {
  const num = ttf.readUInt16BE(4);
  const T = {};
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    T[ttf.subarray(o, o + 4).toString('latin1')] = {
      off: ttf.readUInt32BE(o + 8),
      len: ttf.readUInt32BE(o + 12),
    };
  }
  return T;
}

/** خريطة عكسية: GID -> نص يونيكود (من cmap في الخط). */
function reverseCmap(ttf) {
  const rev = new Map();
  const T = readTables(ttf);
  if (!T.cmap) return rev;
  const off = T.cmap.off;
  const cnt = ttf.readUInt16BE(off + 2);
  for (let i = 0; i < cnt; i++) {
    const o = off + 4 + i * 8;
    const sub = ttf.readUInt32BE(o + 4);
    const t = off + sub;
    if (t + 2 > ttf.length) continue;
    const fmt = ttf.readUInt16BE(t);
    if (fmt === 4) {
      const segX2 = ttf.readUInt16BE(t + 6);
      const seg = segX2 / 2;
      const endO = t + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, roO = deltaO + segX2;
      for (let s = 0; s < seg; s++) {
        const en = ttf.readUInt16BE(endO + s * 2);
        const st = ttf.readUInt16BE(startO + s * 2);
        const dl = ttf.readInt16BE(deltaO + s * 2);
        const ro = ttf.readUInt16BE(roO + s * 2);
        if (st === 0xffff) continue;
        for (let c = st; c <= en && c !== 0xffff; c++) {
          let g;
          if (ro === 0) g = (c + dl) & 0xffff;
          else {
            const gi = roO + s * 2 + ro + (c - st) * 2;
            if (gi + 1 >= ttf.length) continue;
            g = ttf.readUInt16BE(gi);
            if (g) g = (g + dl) & 0xffff;
          }
          if (g && !rev.has(g)) rev.set(g, String.fromCodePoint(c));
        }
      }
    } else if (fmt === 12) {
      const ng = ttf.readUInt32BE(t + 12);
      for (let k = 0; k < ng; k++) {
        const o2 = t + 16 + k * 12;
        const sc = ttf.readUInt32BE(o2), ec = ttf.readUInt32BE(o2 + 4), sg = ttf.readUInt32BE(o2 + 8);
        for (let c = sc; c <= ec; c++) {
          const g = sg + (c - sc);
          if (!rev.has(g)) rev.set(g, String.fromCodePoint(c));
        }
      }
    } else if (fmt === 6) {
      const first = ttf.readUInt16BE(t + 6), c3 = ttf.readUInt16BE(t + 8);
      for (let k = 0; k < c3; k++) {
        const g = ttf.readUInt16BE(t + 10 + k * 2);
        if (g && !rev.has(g)) rev.set(g, String.fromCodePoint(first + k));
      }
    } else if (fmt === 0) {
      for (let k = 0; k < 256; k++) {
        const g = ttf[t + 6 + k];
        if (g && !rev.has(g)) rev.set(g, String.fromCodePoint(k));
      }
    }
  }
  return rev;
}

/** بصمة محتوى glyph (glyf) — لتمييز رمز غير مرمّز حتى لو تغيّر ترقيم GID. */
function glyfHash(ttf, gid) {
  try {
    const T = readTables(ttf);
    if (!T.glyf || !T.loca) return null;
    const longLoca = (() => {
      if (!T.head) return true;
      return ttf.readInt16BE(T.head.off + 50) === 1;
    })();
    const locaAt = (i) => (longLoca ? ttf.readUInt32BE(T.loca.off + i * 4) : ttf.readUInt16BE(T.loca.off + i * 2) * 2);
    const s = locaAt(gid), e = locaAt(gid + 1);
    if (!(e > s)) return null;
    const buf = Buffer.from(ttf.subarray(T.glyf.off + s, T.glyf.off + e));
    return createHash('sha1').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* بناء خرائط الخطوط من ملف الـ PDF نفسه                               */
/* ------------------------------------------------------------------ */

function inflateContents(obj) {
  if (!(obj instanceof PDFStream)) return null;
  let c;
  try { c = obj.getContents(); } catch { return null; }
  const d = Buffer.from(c);
  try { return zlib.inflateSync(d); } catch { return d; }
}

function normalizeBase(name) {
  return String(name).replace(/^\//, '').replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * @returns {Map<string, {rev:Map<number,string>, glyphCount:number, ttf:Buffer}>}
 *          key = اسم الخط الأساسي موحّد
 */
async function buildFontMaps(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const ctx = doc.context;
  const out = new Map();

  const visitedRes = new WeakSet();
  function walkResources(res) {
    if (!(res instanceof PDFDict)) return;
    if (visitedRes.has(res)) return;
    visitedRes.add(res);
    const fontsRef = res.get(PDFName.of('Fonts')) || res.get(PDFName.of('Font'));
    if (!fontsRef) return;
    const fonts = ctx.lookup(fontsRef);
    if (!(fonts instanceof PDFDict)) return;
    for (const key of fonts.keys()) {
      const fref = fonts.get(key);
      const f = ctx.lookup(fref);
      if (!(f instanceof PDFDict)) continue;

      let target = f;
      const descFonts = f.get(PDFName.of('DescendantFonts'));
      if (descFonts) {
        const arr = ctx.lookup(descFonts);
        if (arr instanceof PDFArray && arr.size() > 0) target = ctx.lookup(arr.get(0)) || f;
      }
      const bf = (target.get(PDFName.of('BaseFont')) || f.get(PDFName.of('BaseFont')));
      const base = bf ? normalizeBase(bf) : normalizeBase(key);

      const descRef = target.get(PDFName.of('FontDescriptor'));
      const desc = descRef ? ctx.lookup(descRef) : null;
      let ttf = null;
      if (desc) {
        for (const k of ['FontFile2', 'FontFile3', 'FontFile']) {
          const r = desc.get(PDFName.of(k));
          if (r) {
            const d = inflateContents(ctx.lookup(r));
            if (d && d.length > 4 && d[0] === 0x00 && d[1] === 0x01 && d[2] === 0x00 && d[3] === 0x00) { ttf = d; break; }
          }
        }
      }
      if (ttf && !out.has(base)) {
        out.set(base, { rev: reverseCmap(ttf), ttf, glyphCount: (() => { try { return ttf.readUInt16BE(readTables(ttf).maxp.off + 4); } catch { return 0; } })() });
      }
    }

    // صفحات متداخلة (XObject Forms) قد تحمل مواردها الخاصة
    const xo = res.get(PDFName.of('XObject'));
    if (xo) {
      const xod = ctx.lookup(xo);
      if (xod instanceof PDFDict) {
        for (const k of xod.keys()) {
          let st = null;
          try { st = ctx.lookup(xod.get(k)); } catch { st = null; }
          if (!(st instanceof PDFStream)) continue;
          try {
            const sd = st.dict || st;
            const sm = sd.get(PDFName.of('Subtype'));
            if (sm && String(sm) === '/Form') {
              const inner = sd.get(PDFName.of('Resources'));
              if (inner) walkResources(ctx.lookup(inner));
            }
          } catch { /* تجاهل */ }
        }
      }
    }
  }

  for (const page of doc.getPages()) {
    const resRef = page.node.get(PDFName.of('Resources'));
    if (resRef) walkResources(ctx.lookup(resRef));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* الترميز: بصري -> منطقي                                             */
/* ------------------------------------------------------------------ */

/** يعكس الترتيب البصري إلى المنطقي مع الحفاظ على المقاطع اللاتينية/الأرقام. */
export function visualToLogical(visual) {
  const chars = [...visual];
  if (!chars.some((c) => HAS_ARABIC_LETTER.test(c))) return visual; // نص لاتيني/رقمي: بلا عكس
  const reversed = chars.slice().reverse();
  const res = [];
  let buf = [];
  const flush = () => { if (buf.length) { res.push(...buf.reverse()); buf = []; } };
  for (const c of reversed) {
    if (/[0-9A-Za-z\u0660-\u0669\/\.\-:%]/.test(c)) buf.push(c);
    else { flush(); res.push(c); }
  }
  flush();
  return res.join('');
}

function normalizeArabic(s) {
  let out = s;
  try { out = out.normalize('NFKC'); } catch { /* تجاهل */ }
  // توحيد البدائل الفارسية/الأردية الشائعة في خطوط Segoe/Arial
  out = out
    .replace(/[\u06CC\u06D2]/g, '\u064A')   // ی ے -> ي
    .replace(/\u06A9/g, '\u0643')           // ک -> ك
    .replace(/[\u06C1\u06D5]/g, '\u0647')   // ہ -> ه
    .replace(/\u06BA/g, '\u0646')           // نون غنة -> ن
    .replace(/\u06C0/g, '\u0647')           // ۀ -> ه
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // تشكيل + كشيدة
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

/* ------------------------------------------------------------------ */
/* الاستخراج الرئيسي                                                   */
/* ------------------------------------------------------------------ */

function clusterByY(items, threshold = 8) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    if (!rows.length || Math.abs(rows[rows.length - 1].refY - it.y) > threshold) {
      rows.push({ refY: it.y, items: [it] });
    } else {
      rows[rows.length - 1].items.push(it);
    }
  }
  return rows;
}

function isCodeItem(it) {
  // رقم طالب مكتوب كعنصر مستقل: لا يُدمج مع الاسم المجاور مهما ضاقت المسافة
  // (في صف واحد قد يجلس طالبان جنباً إلى جنب وتفصل بين كود أحدهما واسم الآخر مسافة أقل من العتبة).
  const s = String(it && it.str || '').replace(/\s+/g, '');
  return /^\d{6,12}$/.test(s);
}

function clusterByX(items, gapThreshold = 9) {
  const sorted = items.slice().sort((a, b) => b.x - a.x); // من اليمين لليسار
  const cells = [];
  for (const it of sorted) {
    const last = cells[cells.length - 1];
    const codeItem = isCodeItem(it);
    if (last) {
      const rightEdge = last.items[last.items.length - 1];
      const gap = rightEdge.x - (it.x + (it.width || 0));
      // فصل إجباري عند رقم طالب: لا يُضمَّن رقم في اسم طالب أبداً
      if (gap > gapThreshold || codeItem || isCodeItem(rightEdge)) {
        cells.push({ items: [it] });
        continue;
      }
      last.items.push(it);
      continue;
    }
    cells.push({ items: [it] });
  }
  return cells.map((c) => {
    const asc = c.items.slice().sort((a, b) => a.x - b.x);
    const parts = asc.map((i) => i.str);
    const gaps = [];
    for (let k = 0; k < asc.length - 1; k++) {
      gaps[k] = asc[k + 1].x - (asc[k].x + (asc[k].width || 0));
    }
    const joinAsc = () => parts.map((p, k) => (k > 0 && gaps[k - 1] > 5 ? ' ' : '') + p).join('');
    const joinDesc = () => parts
      .map((p, k) => p)
      .map((p, k) => ({ p, oi: parts.length - 1 - k }))
      .map(({ p, oi }, k) => (k > 0 && gaps[oi] > 5 ? ' ' : '') + p)
      .join('');

    const visual = joinAsc(); // الترتيب البصري (يسار -> يمين)
    let text;
    if (HAS_ARABIC_LETTER.test(visual)) {
      text = visualToLogical(visual); // عربي: عكس البصري -> المنطقي
    } else {
      // بلا عربي: في سياق RTL تُقرأ المقاطع من اليمين، إلا أرقاماً خالصة (تُرسم يسار->يمين)
      const allPureDigits = parts.length > 1 && parts.every((p) => /^\d+$/.test(p.trim()));
      text = allPureDigits ? joinAsc() : joinDesc();
    }

    const xs = c.items.map((i) => i.x);
    const xe = c.items.map((i) => i.x + (i.width || 0));
    return {
      text: normalizeArabic(text),
      raw: visual,
      parts,
      x0: Math.min(...xs),
      x1: Math.max(...xe),
      items: c.items.length,
    };
  });
}

const HEADER_LABELS = [
  { key: 'directorate', label: /^(?:مديرية|المديرية)/ },
  { key: 'administration', label: /^(?:إدارة|الإدارة|ادارة|اداره)/ },
  { key: 'school', label: /^(?:مدرسة|المدرسة)/ },
  { key: 'stage', label: /^المرحلة/ },
  { key: 'grade', label: /^(?:الصف|صف)(?!حة)/ },
  { key: 'section', label: /^(?:ال)?فصل/ },
  { key: 'totalStudents', label: /^(?:عدد|الإجمالي|الاجمالي|العدد)/ },
  { key: 'academicYear', label: /^(?:العام الدراسي|العام|السنة)/ },
];

const hasAlnum = (t) => /[\p{L}\p{N}]/u.test(t);

function parseHeader(headerRows) {
  const header = {
    directorate: '', administration: '', school: '', stage: '',
    grade: '', section: '', className: '', totalStudents: 0, date: '', academicYear: '',
  };
  const isLabel = (t) => HEADER_LABELS.some((d) => d.label.test(t));

  for (const row of headerRows) {
    const cells = row.cells;
    const consumed = new Set();
    for (let i = 0; i < cells.length; i++) {
      if (consumed.has(i)) continue;
      const cell = cells[i];
      const def = HEADER_LABELS.find((d) => d.label.test(cell.text));
      if (!def) continue;

      const m = def.label.exec(cell.text);
      const afterLabel = cell.text.slice(m[0].length).trim();
      let value = '';

      // (1) القيمة داخل الخلية نفسها بعد الفاصلة المسماة: "الفصل: 1 / 1"
      const sep = afterLabel.match(/^[:：=]\s*(.+)$/);
      if (sep && hasAlnum(sep[1])) value = sep[1].trim();

      // (2) الخلية التالية نحو اليسار (لأن التسمية يمين والقيمة يساراً)
      if (!value) {
        for (let j = i + 1; j < cells.length; j++) {
          if (consumed.has(j)) continue;
          if (isLabel(cells[j].text)) continue;
          if (!hasAlnum(cells[j].text)) continue;
          value = cells[j].text;
          consumed.add(j);
          break;
        }
      }

      // (3) بقيّة نص الخلية بعد التسمية: "الصف الأول" -> "الأول"
      if (!value && hasAlnum(afterLabel) && !isLabel(afterLabel)) value = afterLabel;

      // (4) الخلية السابقة
      if (!value) {
        for (let j = i - 1; j >= 0; j--) {
          if (consumed.has(j)) continue;
          if (isLabel(cells[j].text)) continue;
          if (!hasAlnum(cells[j].text)) continue;
          value = cells[j].text;
          consumed.add(j);
          break;
        }
      }

      consumed.add(i);
      if (value && !header[def.key]) header[def.key] = value;
    }
  }

  header.totalStudents = parseInt(String(header.totalStudents).replace(/[^\d]/g, ''), 10) || 0;
  if (!header.section && header.grade.includes('/')) {
    const parts = header.grade.split('/').map((s) => s.trim());
    if (parts.length === 2) { header.grade = parts[0]; header.section = parts[1]; }
  }
  header.className = header.section || header.grade || header.stage;
  return header;
}

function looksLikeCode(text) {
  const t = text.replace(/\s+/g, '');
  return /^\d{6,12}$/.test(t);
}

/**
 * استخراج كامل من مخزن بايتات PDF.
 * @param {Buffer} pdfBytes
 * @param {string} fileName
 */
export async function extractPdf(pdfBytes, fileName = 'file.pdf') {
  const warnings = [];
  const unmappedCounter = new Map();
  const unmappedCtx = new Map();
  const overrides = readJson('glyph_overrides.json', {}) || {};

  const fontMaps = await buildFontMaps(pdfBytes);

  /** @param {string} base */
  const resolveChar = (base, gid, entry) => {
    if (entry && entry.rev.has(gid)) return entry.rev.get(gid);
    const o = overrides[base];
    if (o) {
      if (o.byGid && Object.prototype.hasOwnProperty.call(o.byGid, gid)) return o.byGid[gid];
      if (o.byHash && entry && entry.ttf) {
        const h = glyfHash(entry.ttf, gid);
        if (h && o.byHash[h]) return o.byHash[h];
      }
    }
    const k = `${base}|${gid}`;
    unmappedCounter.set(k, (unmappedCounter.get(k) || 0) + 1);
    return null;
  };

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: false,
    isEvalSupported: false,
    // ملفات الخطوط القياسية المضمّنة مع pdfjs-dist (تخلو من التحذيرات)
    standardFontDataUrl: `${STANDARD_FONT_DIR}${path.sep}`,
  }).promise;

  const allPageRows = [];
  const headerRows = [];
  const footerTexts = [];
  let maxPage = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    maxPage = p;
    const page = await doc.getPage(p);
    await page.getOperatorList().catch(() => {});
    const tc = await page.getTextContent();

    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      let base = null;
      try {
        const f = await page.commonObjs.get(it.fontName);
        if (f && f.name) base = normalizeBase(f.name);
      } catch { /* تجاهل */ }

      const entry = base ? fontMaps.get(base) : null;
      let decoded = '';
      if (entry && entry.rev.size) {
        // الأكواد الرمزية (GID) — الخط مضمّن بترميز Identity-H
        const gids = [...it.str].map((c) => c.codePointAt(0));
        const mapped = [];
        for (const gid of gids) {
          if (gid === 0) continue;
          const ch = resolveChar(base, gid, entry);
          if (ch == null) {
            if (process.env.PDF_TRACE_UNMAPPED) {
              const key = `${base}|${gid}`;
              if (!unmappedCtx.has(key)) {
                unmappedCtx.set(key, {
                  gid,
                  before: mapped.slice(-8).join(''),
                  after: '',
                  sample: '',
                });
              }
            }
            mapped.push(REPLACEMENT); continue;
          }
          if (process.env.PDF_TRACE_UNMAPPED) {
            for (const v of unmappedCtx.values()) if (!v.after && v.gid === gid) v.after = mapped.slice(0, 6).join('');
          }
          mapped.push(ch);
        }
        decoded = mapped.join(''); // بصري — يُعكس لاحقاً على مستوى الخلية
        if (process.env.PDF_TRACE_UNMAPPED) {
          for (const v of unmappedCtx.values()) if (!v.sample && decoded.includes(REPLACEMENT)) v.sample = decoded;
        }
      } else {
        decoded = it.str; // خط قياسي: النص أصلاً Unicode صحيح
      }
      if (!decoded || !decoded.trim()) continue;

      items.push({
        str: decoded,
        base,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width || 0,
        height: it.height || 0,
      });
    }
    if (!items.length) continue;

    if (process.env.PDF_TRACE === 'ITEMS') {
      const y0 = Number(process.env.PDF_TRACE_Y0 || 0);
      const y1 = Number(process.env.PDF_TRACE_Y1 || 1e9);
      const sel = items.filter((i) => i.y >= y0 && i.y <= y1).sort((a, b) => b.y - a.y || b.x - a.x);
      for (const i of sel) {
        console.error('[items] x=%s y=%s w=%s base=%s %j',
          Math.round(i.x * 10) / 10, Math.round(i.y * 10) / 10, Math.round(i.width * 10) / 10, i.base, i.str);
      }
    }

    const rows = clusterByY(items, 8);
    const rowCells = rows.map((r) => ({ y: r.refY, cells: clusterByX(r.items, 9) }));

    if (process.env.PDF_TRACE) {
      const pat = process.env.PDF_TRACE;
      for (const r of rowCells) {
        const hasCode = r.cells.some((c) => /^\d{6,12}$/.test(c.text.replace(/\s+/g, '')));
        const hasName = r.cells.some((c) => /[\u0621-\u064A]/.test(c.text));
        const match = pat === 'ALL'
          || (pat === 'NOCODE' ? (hasName && !hasCode) : r.cells.some((c) => c.raw.includes(pat) || c.text.includes(pat)));
        if (!match) continue;
        for (const c of r.cells) {
          console.error('[trace] raw=%j parts=%j text=%j', c.raw, c.parts, c.text);
        }
        const near = items.filter((i) => Math.abs(i.y - r.y) < 20)
          .sort((a, b) => b.x - a.x)
          .map((i) => ({ str: i.str, x: Math.round(i.x * 10) / 10, y: Math.round(i.y * 10) / 10, w: Math.round(i.width * 10) / 10, base: i.base }));
        console.error('[trace] items:', JSON.stringify(near));
      }
    }

    // تحديد نطاق الجدول: صف عنوان الأعمدة (كود/اسم) ثم صفوف الأكواد
    const codeYs = rowCells
      .filter((r) => r.cells.some((c) => looksLikeCode(c.text)))
      .map((r) => r.y);
    const colHeaderYs = rowCells
      .filter((r) => {
        const t = r.cells.map((c) => c.text).join(' ');
        return /كود/.test(t) && /(اسم|الأسم)/.test(t);
      })
      .map((r) => r.y);

    let tableTopY = -Infinity;   // أكبر y ينتمي للجدول
    let tableBottomY = Infinity;  // أصغر y ينتمي للجدول
    if (colHeaderYs.length) {
      tableTopY = Math.max(...colHeaderYs) - 3;
    } else if (codeYs.length) {
      tableTopY = Math.max(...codeYs) + 6;
    }
    if (codeYs.length) tableBottomY = Math.min(...codeYs) - 6;

    const hasRange = Number.isFinite(tableTopY);
    if (process.env.PDF_DEBUG) {
      console.error('[dbg]', JSON.stringify({
        items: items.length, rowCells: rowCells.length,
        codeYs: codeYs.length, colHeaderYs, tableTopY, tableBottomY,
        sample: rowCells.slice(0, 6).map((r) => `${Math.round(r.y)}: ` + r.cells.map((c) => c.text).join(' || ')),
      }, null, 1));
    }
    // حالة احتياطية: لا عنوان أعمدة ولا أكواد — أعلى صفوف تُعامَل كترويسة
    const forcedHeader = new Set();
    if (!hasRange && !codeYs.length) {
      rowCells.slice().sort((a, b) => b.y - a.y).slice(0, Math.min(4, rowCells.length))
        .forEach((r) => forcedHeader.add(r));
    }
    for (const r of rowCells) {
      const txt = r.cells.map((c) => c.text).join(' | ');
      if (forcedHeader.has(r) || (hasRange && r.y > tableTopY)) { headerRows.push(r); continue; }
      if (codeYs.length && r.y < tableBottomY) { footerTexts.push(txt); continue; }
      allPageRows.push({ page: p, y: r.y, cells: r.cells });
    }
    if (typeof page.cleanup === 'function') page.cleanup();
  }

  const header = parseHeader(headerRows);

  // التاريخ والعام الدراسي من نصوص التذييل/الترويسة
  const allText = [...footerTexts, ...headerRows.map((r) => r.cells.map((c) => c.text).join(' '))].join(' ');
  const dateM = allText.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dateM) header.date = `${dateM[1]}/${dateM[2]}/${dateM[3]}`;
  const yearM = allText.match(/\b(20\d{2})\s*[\/\-]\s*(20\d{2})\b/);
  if (yearM) {
    // توحيد ترتيب العام الدراسي تصاعدياً (النص قد يصل معكوساً في سياق RTL)
    const [a, b] = [Number(yearM[1]), Number(yearM[2])];
    header.academicYear = header.academicYear || (b > a ? `${a} / ${b}` : `${b} / ${a}`);
  }

  // تجميع صفوف الطلاب
  const rows = [];
  const byRow = new Map();
  for (const r of allPageRows) {
    const key = `${r.page}:${Math.round(r.y)}`;
    if (!byRow.has(key)) byRow.set(key, r);
    else byRow.get(key).cells.push(...r.cells);
  }
  const mergedRows = [...byRow.values()].sort((a, b) => a.page - b.page || b.y - a.y);

  let index = 0;
  for (const r of mergedRows) {
    const cells = r.cells;
    const codes = cells.filter((c) => looksLikeCode(c.text));
    const names = cells.filter((c) => !looksLikeCode(c.text) && ARABIC_LETTER.test(c.text));
    if (!codes.length && !names.length) continue;
    if (!codes.length && !names.length) continue;

    const codesSorted = codes.slice().sort((a, b) => b.x0 - a.x0);
    const namesSorted = names.slice().sort((a, b) => b.x0 - a.x0);

    // تجميع الأسماء المتفرقة في خلايا واحدة لكل طالب
    const nameGroups = [];
    for (const n of namesSorted) {
      const last = nameGroups[nameGroups.length - 1];
      if (last) {
        const gap = last.x0 - n.x1;
        if (gap <= 14) { last.text = `${last.text} ${n.text}`.trim(); last.x0 = Math.min(last.x0, n.x0); last.x1 = Math.max(last.x1, n.x1); continue; }
      }
      nameGroups.push({ text: n.text, x0: n.x0, x1: n.x1 });
    }

    const count = Math.max(codesSorted.length, nameGroups.length);
    for (let i = 0; i < count; i++) {
      const code = codesSorted[i];
      const name = nameGroups[i];
      const reviewNotes = [];
      const studentCode = code ? code.text.replace(/\s+/g, '') : '';
      const fullName = name ? name.text : '';
      if (!studentCode) reviewNotes.push('تعذّر قراءة كود الطالب بثقة — يتطلب تدخلاً يدوياً');
      if (!fullName) reviewNotes.push('تعذّر قراءة اسم الطالب بثقة — يتطلب تدخلاً يدوياً');
      if (fullName.includes(REPLACEMENT)) reviewNotes.push('يحتوي الاسم على رمز غير معروف في الخط — راجع الاسم قبل التصدير');
      if (studentCode && !/^\d{6,12}$/.test(studentCode)) reviewNotes.push('كود الطالب ليس رقماً كاملاً — راجعه');

      rows.push({
        index: index++,
        page: r.page,
        physKey: `${r.page}:${Math.round(r.y)}`,
        studentCode,
        fullName,
        cells: [
          ...(code ? [{ kind: 'code', text: studentCode, x0: code.x0, x1: code.x1 }] : []),
          ...(name ? [{ kind: 'name', text: fullName, x0: name.x0, x1: name.x1 }] : []),
        ],
        needsReview: reviewNotes.length > 0,
        reviewNotes,
      });
    }
  }

  // تنبيه أمان: إذا أنتج صف فيزيائي واحد سجلاً بلا كود، فهذا يعني أن خلاياه
  // توزّعت على أكثر من طالب توزيعاً غير مؤكد. نعلّم كل سجلات ذلك الصف للمراجعة
  // بدل السماح بتصدير اسم مبتور بصمت.
  const physGroups = new Map();
  for (const r of rows) {
    if (!r.physKey) continue;
    if (!physGroups.has(r.physKey)) physGroups.set(r.physKey, []);
    physGroups.get(r.physKey).push(r);
  }
  for (const group of physGroups.values()) {
    const hasOrphan = group.some((r) => !r.studentCode);
    if (!hasOrphan) continue;
    for (const r of group) {
      const note = 'أُنتج من هذا السطر أكثر من سجل ولم يُقرن الاسم بكوده بثقة — راجعه يدوياً قبل التصدير';
      if (!r.reviewNotes.includes(note)) r.reviewNotes.push(note);
      r.needsReview = true;
    }
  }
  for (const r of rows) delete r.physKey;

  // تكرارات داخل الملف نفسه
  const seen = new Map();
  rows.forEach((r) => {
    if (!r.studentCode) return;
    if (!seen.has(r.studentCode)) seen.set(r.studentCode, []);
    seen.get(r.studentCode).push(r.index);
  });
  const duplicatesInFile = [...seen.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([studentCode, r]) => ({ studentCode, rows: r }));

  if (duplicatesInFile.length) {
    warnings.push(`يوجد ${duplicatesInFile.length} كود مكرر داخل الملف نفسه — راجعها قبل التأكيد`);
  }
  const reviewCount = rows.filter((r) => r.needsReview).length;
  if (reviewCount) {
    warnings.push(`${reviewCount} سجلاً يحتاج مراجعة يدوية قبل التصدير`);
  }

  const unmapped = [...unmappedCounter.entries()].map(([k, count]) => {
    const [font, gid] = k.split('|');
    return { font, gid: Number(gid), count };
  }).sort((a, b) => b.count - a.count);
  if (unmapped.length) {
    warnings.push('يوجد رموز غير معروفة في بعض الحروف — عُلّمت السجلات المتأثرة للمراجعة');
  }

  if (!rows.length) {
    warnings.push('لم يُعثر على أي صف طالب في الملف — تأكد أن الملف هو كشف قوائم الفصول');
  }

  await doc.destroy().catch(() => {});

  if (process.env.PDF_TRACE_UNMAPPED && unmappedCtx.size) {
    for (const v of unmappedCtx.values()) {
      console.error('[unmapped] %s|%s before=%j after=%j sample=%j', fileName, v.gid, v.before, v.after, v.sample);
    }
  }

  return {
    ok: rows.length > 0,
    fileName,
    pages: maxPage,
    header,
    rows,
    warnings,
    unmapped,
    duplicatesInFile,
  };
}

/* وضع سطر الأوامر للتجربة: node server/pdfExtractor.mjs "file.pdf" */
if (process.argv[1] && /pdfExtractor\.mjs$/.test(process.argv[1])) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node server/pdfExtractor.mjs <file.pdf>'); process.exit(1); }
  const buf = fs.readFileSync(file);
  const t0 = Date.now();
  const res = await extractPdf(buf, file);
  console.log(JSON.stringify({ ...res, rows: res.rows.slice(0, 6), tookMs: Date.now() - t0 }, null, 2));
  console.log('\n--- header ---');
  console.log(res.header);
  console.log(`rows=${res.rows.length} review=${res.rows.filter((r) => r.needsReview).length}`);
}
