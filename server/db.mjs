/**
 * طبقة تخزين JSON محلية آمنة.
 * - كتابة ذرّية: ملف مؤقت ثم استبدال (rename) داخل المجلد نفسه.
 * - نسخة احتياطية قبل كل استبدال، مع الاحتفاظ بآخر N نسخ.
 * - قفل كتابة لكل ملف (تسلسل الوصفات) لمنع الكتابة المتزامنة غير الآمنة.
 * - لا تُخزَّن أي بيانات اعتماد أبداً.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
// يمكن تجاوز المجلدات عبر البيئة (يُستخدم في الاختبارات حتى لا تلمس بيانات المستخدم الحقيقية)
export const DATA_DIR = process.env.APP_DATA_DIR ? path.resolve(process.env.APP_DATA_DIR) : path.join(ROOT, 'data');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const EXPORT_DIR = process.env.APP_EXPORT_DIR ? path.resolve(process.env.APP_EXPORT_DIR) : path.join(ROOT, 'exports');
export const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');

const MAX_BACKUPS = 20;

/** الملفات المعروفة وقيمها الافتراضية (لا بيانات وهمية — قيم فارغة/تهيئة فقط). */
export const FILES = {
  'students.json': [],
  'schools.json': [],
  'classes.json': [],
  'attendance.json': { days: {} },
  'settings.json': {
    siteUrl: '',
    siteName: '',
    browser: 'msedge',
    headless: false,
    timeoutMs: 45000,
    manualFallback: true,
    openDevTools: false,
    exportDir: '',
    autoExportBeforeRun: true,
  },
  'import_history.json': [],
  'glyph_overrides.json': {},
  'logs.json': [],
};

/** أقفال الكتابة لكل ملف (Promise chain). */
const locks = new Map();

function withLock(file, fn) {
  const prev = locks.get(file) || Promise.resolve();
  const next = prev.then(fn, fn);
  // لا ندع الخطأ يكسر السلسلة
  const guard = next.catch(() => {});
  locks.set(file, guard);
  return next;
}

export function ensureDirs() {
  for (const d of [DATA_DIR, BACKUP_DIR, EXPORT_DIR, EVIDENCE_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

ensureDirs();

export function filePath(name) {
  return path.join(DATA_DIR, name);
}

/** قراءة ملف JSON مع قيمة افتراضية وتسهيل التهيئة. */
export function readJson(name, fallback = null) {
  const p = filePath(name);
  try {
    if (!fs.existsSync(p)) {
      const def = FILES[name] !== undefined ? structuredClone(FILES[name]) : (fallback ?? null);
      return def;
    }
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return FILES[name] !== undefined ? structuredClone(FILES[name]) : (fallback ?? null);
    return JSON.parse(raw);
  } catch {
    // ملف تالف: نحاول قراءة آخر نسخة احتياطية قبل الاستسلام
    try {
      const backups = listBackups(name);
      for (const b of backups) {
        try { return JSON.parse(fs.readFileSync(b, 'utf8')); } catch { /* تجاهل */ }
      }
    } catch { /* تجاهل */ }
    return FILES[name] !== undefined ? structuredClone(FILES[name]) : (fallback ?? null);
  }
}

export function listBackups(name) {
  try {
    const base = name.replace(/\.json$/, '');
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith(base + '.'))
      .sort()
      .map((f) => path.join(BACKUP_DIR, f))
      .reverse();
  } catch {
    return [];
  }
}

function pruneBackups(name) {
  const base = name.replace(/\.json$/, '');
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith(base + '.'))
      .sort()
      .reverse();
    for (const f of files.slice(MAX_BACKUPS)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* تجاهل */ }
    }
  } catch { /* تجاهل */ }
}

/** كتابة ذرّية: tmp -> rename، مع نسخة احتياطية للفайл الحالي. */
export async function writeJson(name, data) {
  return withLock(name, async () => {
    const p = filePath(name);
    const json = JSON.stringify(data, null, 2);

    if (fs.existsSync(p)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const bak = path.join(BACKUP_DIR, `${name.replace(/\.json$/, '')}.${stamp}.json`);
      try {
        await fsp.copyFile(p, bak);
        pruneBackups(name);
      } catch { /* نسخة احتياطية فشلت — لا نوقف الكتابة لكنها مسجّلة لاحقاً */ }
    }

    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, json, 'utf8');
    await fsp.rename(tmp, p);
    return data;
  });
}

/** تعديل ذرّي: قراءة -> دالة -> كتابة، داخل القفل نفسه. */
export async function updateJson(name, fn) {
  return withLock(name, async () => {
    const current = readJson(name);
    const next = await fn(current);
    const p = filePath(name);
    if (fs.existsSync(p)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const bak = path.join(BACKUP_DIR, `${name.replace(/\.json$/, '')}.${stamp}.json`);
      try { await fsp.copyFile(p, bak); pruneBackups(name); } catch { /* تجاهل */ }
    }
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
    await fsp.rename(tmp, p);
    return next;
  });
}

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** سجلّ أحداث صغير (بلا أي بيانات اعتماد). */
export async function log(level, message) {
  try {
    await updateJson('logs.json', (cur) => {
      const arr = Array.isArray(cur) ? cur : [];
      arr.push({ at: new Date().toISOString(), level, message: String(message).slice(0, 2000) });
      while (arr.length > 500) arr.shift();
      return arr;
    });
  } catch { /* لا نفشل العمليات بسبب التسجيل */ }
}
