/**
 * طبقة تخزين البيانات المحلية (ملفات JSON داخل data/).
 *
 * ضمانات:
 *  - كتابة ذرّية: ملف مؤقت ثم rename (لا يُكتب الملف أبداً جزئياً).
 *  - نسخة احتياطية تلقائية قبل كل استبدال، مع الاحتفاظ بآخر N نسخ.
 *  - قفل كتابة في الذاكرة لكل ملف (يمنع الكتابة المتزامنة غير الآمنة).
 *  - لا تُخزَّن بيانات اعتماد (اسم مستخدم/كلمة مرور) أبداً.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT, DATA_DIR, BACKUP_DIR, EXPORT_DIR, EVIDENCE_DIR,
} from './db.mjs';

export { ROOT, DATA_DIR, BACKUP_DIR, EXPORT_DIR, EVIDENCE_DIR };

export const FILES = {
  schools: 'schools.json',
  classes: 'classes.json',
  students: 'students.json',
  attendance: 'attendance.json',
  importHistory: 'import_history.json',
  settings: 'settings.json',
  overrides: 'glyph_overrides.json',
  logs: 'logs.json',
};

const MAX_BACKUPS = 20;

function ensureDirs() {
  for (const d of [DATA_DIR, BACKUP_DIR, EXPORT_DIR, EVIDENCE_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
ensureDirs();

/* ---------------------------------------------------------------- */
/* قفل الكتابة                                                       */
/* ---------------------------------------------------------------- */
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => {});
  locks.set(key, settled);
  return next;
}

/* ---------------------------------------------------------------- */
/* قراءة / كتابة                                                     */
/* ---------------------------------------------------------------- */
function backupExisting(file) {
  try {
    if (!fs.existsSync(file)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.basename(file).replace(/\.json$/, '');
    const target = path.join(BACKUP_DIR, `${base}.${stamp}.json`);
    fs.copyFileSync(file, target);
    // تقليم النسخ القديمة
    const all = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith(`${base}.`))
      .sort();
    for (const old of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch { /* تجاهل */ }
    }
  } catch {
    // لا نفشل العملية بسبب النسخ الاحتياطي
  }
}

export async function readJson(name, fallback) {
  const file = path.join(DATA_DIR, name);
  try {
    const txt = await fsp.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

export async function writeJson(name, value) {
  return withLock(name, async () => {
    const file = path.join(DATA_DIR, name);
    backupExisting(file);
    const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fsp.rename(tmp, file);
    return value;
  });
}

/** تعديل ذرّي: قراءة -> تحويل -> كتابة (داخل نفس القفل). */
export async function updateJson(name, fallback, mutator) {
  return withLock(name, async () => {
    const current = await readJson(name, fallback);
    const next = await mutator(current);
    const file = path.join(DATA_DIR, name);
    backupExisting(file);
    const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
    await fsp.rename(tmp, file);
    return next;
  });
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/* ---------------------------------------------------------------- */
/* إعدادات افتراضية (بيانات تهيئة فقط — لا بيانات وهمية)             */
/* ---------------------------------------------------------------- */
export const DEFAULT_SETTINGS = {
  // نطاق العمل الحالي كما هو مذكور في تقارير القوائم المصدر
  directorate: 'مديري التربية والتعليم بالشرقية',
  administration: 'غـرب الزقازيق',
  schoolName: 'فصول ملحقة بنايوس الثانوية المشتركة',
  siteUrl: '',
  headless: false,
  timeoutMs: 45000,
  manualFallback: true,
  exportDir: '',
  successIndicators: [],
};

export async function getSettings() {
  const s = await readJson(FILES.settings, null);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  // حماية: لا نقبل أي حقل يحمل بيانات اعتماد
  delete next.username;
  delete next.password;
  delete next.credentials;
  await writeJson(FILES.settings, next);
  return next;
}

/* ---------------------------------------------------------------- */
/* المدارس والصفوف والطلاب                                            */
/* ---------------------------------------------------------------- */
export async function loadSchools() {
  return (await readJson(FILES.schools, { version: 1, items: [] })) || { version: 1, items: [] };
}
export async function saveSchools(v) {
  return writeJson(FILES.schools, { version: 1, items: v.items || [] });
}
export async function loadClasses() {
  return (await readJson(FILES.classes, { version: 1, items: [] })) || { version: 1, items: [] };
}
export async function saveClasses(v) {
  return writeJson(FILES.classes, { version: 1, items: v.items || [] });
}
export async function loadStudents() {
  return (await readJson(FILES.students, { version: 1, items: [] })) || { version: 1, items: [] };
}
export async function saveStudents(v) {
  return writeJson(FILES.students, { version: 1, items: v.items || [] });
}
export async function loadAttendance() {
  return (await readJson(FILES.attendance, { version: 1, items: [] })) || { version: 1, items: [] };
}
export async function saveAttendance(v) {
  return writeJson(FILES.attendance, { version: 1, items: v.items || [] });
}
export async function loadImportHistory() {
  return (await readJson(FILES.importHistory, { version: 1, items: [] })) || { version: 1, items: [] };
}
export async function saveImportHistory(v) {
  return writeJson(FILES.importHistory, { version: 1, items: v.items || [] });
}

/* ---------------------------------------------------------------- */
/* السجلات (logs)                                                    */
/* ---------------------------------------------------------------- */
export async function log(level, message) {
  const entry = { at: new Date().toISOString(), level, message: String(message).slice(0, 2000) };
  await updateJson(FILES.logs, { version: 1, items: [] }, (cur) => {
    const items = [...(cur.items || []), entry];
    while (items.length > 500) items.shift();
    return { version: 1, items };
  });
  return entry;
}

export async function readLogs(limit = 200) {
  const v = await readJson(FILES.logs, { version: 1, items: [] });
  const items = (v.items || []).slice(-Number(limit) || -200);
  return items;
}
