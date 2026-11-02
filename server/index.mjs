/**
 * الخادم المحلي — API + تقديم واجهة React المبنية.
 * منفذ واحد: 127.0.0.1:5199 (دون إنترنت، دون أي بيانات تُرسَل للخارج).
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { PDFDocument } from 'pdf-lib';
import { extractPdf } from './pdfExtractor.mjs';
import { buildAttendanceWorkbook, verifyWorkbook, COLUMNS } from './excel.mjs';
import { runAutomation, closeManualBrowser } from './automation.mjs';
import {
  ROOT, DATA_DIR, EXPORT_DIR,
  getSettings, saveSettings, DEFAULT_SETTINGS,
  loadSchools, saveSchools, loadClasses, saveClasses,
  loadStudents, saveStudents, loadAttendance, saveAttendance,
  loadImportHistory, saveImportHistory,
  log, readLogs, newId,
} from './store.mjs';

const PORT = Number(process.env.PORT) || 5199;
const HOST = '127.0.0.1';
const VERSION = '1.0.0';
const MAX_PDF_BYTES = 25 * 1024 * 1024;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));

const nowISO = () => new Date().toISOString();
const todayISO = () => new Date().toISOString().slice(0, 10);

function normAr(s) {
  return String(s || '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bad(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

/* ---------------------------------------------------------------- */
/* تهيئة أولية: مدرسة حقيقية واحدة (بيانات تهيئة، لا بيانات وهمية)   */
/* ---------------------------------------------------------------- */
async function ensureSeed() {
  const schools = await loadSchools();
  if (!schools.items.length) {
    schools.items = [{
      id: 'sch_default',
      name: DEFAULT_SETTINGS.schoolName,
      directorate: DEFAULT_SETTINGS.directorate,
      administration: DEFAULT_SETTINGS.administration,
      active: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    }];
    await saveSchools(schools);
    await log('info', 'تهيئة: أُنشئت المدرسة الافتراضية من تقارير القوائم المصدر');
  }
}

function findOrCreateSchool(schoolsDoc, { name, directorate, administration }) {
  const items = schoolsDoc.items || [];
  const found = items.find((s) => normAr(s.name) === normAr(name));
  if (found) return found;
  const school = {
    id: newId('sch'),
    name: name || DEFAULT_SETTINGS.schoolName,
    directorate: directorate || DEFAULT_SETTINGS.directorate,
    administration: administration || DEFAULT_SETTINGS.administration,
    active: true,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  items.push(school);
  return school;
}

function classLabel(cls) {
  return cls.name || [cls.grade, cls.section].filter(Boolean).join(' / ');
}

async function recomputeClassCount(classId) {
  const students = await loadStudents();
  const count = (students.items || []).filter((s) => s.classId === classId && s.active !== false).length;
  const classes = await loadClasses();
  const cls = (classes.items || []).find((c) => c.id === classId);
  if (cls) {
    cls.studentCount = count;
    cls.updatedAt = nowISO();
    await saveClasses(classes);
  }
  return count;
}

/* ================================================================= */
/* 1) الصحة والإعدادات العامة                                        */
/* ================================================================= */
app.get('/api/health', async (_req, res) => {
  const [students, classes, imports, attendance, settings] = await Promise.all([
    loadStudents(), loadClasses(), loadImportHistory(), loadAttendance(), getSettings(),
  ]);
  res.json({
    ok: true,
    version: VERSION,
    dataDir: DATA_DIR,
    exportDir: EXPORT_DIR,
    now: nowISO(),
    stats: {
      students: (students.items || []).length,
      classes: (classes.items || []).length,
      imports: (imports.items || []).length,
      attendanceDays: (attendance.items || []).length,
    },
    settings: { siteUrl: settings.siteUrl, headless: settings.headless, browser: settings.browser },
  });
});

app.get('/api/meta', async (_req, res) => {
  const [schools, classes, settings] = await Promise.all([loadSchools(), loadClasses(), getSettings()]);
  res.json({
    ok: true,
    directorate: settings.directorate,
    administration: settings.administration,
    schools: schools.items || [],
    classes: (classes.items || []).map((c) => ({ ...c, label: classLabel(c) })),
    siteUrl: settings.siteUrl,
    excelTemplateVerified: !!settings.excelTemplateVerified,
  });
});

app.get('/api/classes', async (_req, res) => {
  const classes = await loadClasses();
  res.json({ ok: true, classes: (classes.items || []).map((c) => ({ ...c, label: classLabel(c) })) });
});

app.post('/api/classes', async (req, res) => {
  const b = req.body || {};
  const stage = String(b.stage || '').trim();
  const grade = String(b.grade || '').trim();
  const section = String(b.section || '').trim();
  const name = String(b.name || '').trim() || [grade, section].filter(Boolean).join(' / ');
  if (!name) return bad(res, 400, 'اسم الصنف مطلوب');

  const schools = await loadSchools();
  const schoolId = String(b.schoolId || (schools.items || [])[0]?.id || 'sch_default');
  const classes = await loadClasses();
  const dup = (classes.items || []).find((c) => c.schoolId === schoolId && normAr(classLabel(c)) === normAr(name));
  if (dup) return res.json({ ok: true, class: dup, created: false });

  const now = nowISO();
  const cls = {
    id: newId('cls'),
    schoolId,
    stage,
    grade,
    section,
    name,
    studentCount: 0,
    sourceFile: '',
    importedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  classes.items.push(cls);
  await saveClasses(classes);
  await log('info', `أُنشئ صنف ${name}`);
  res.json({ ok: true, class: cls, created: true });
});

app.get('/api/settings', async (_req, res) => {
  res.json({ ok: true, settings: await getSettings() });
});

app.post('/api/settings', async (req, res) => {
  const patch = req.body && typeof req.body === 'object' ? req.body : {};
  delete patch.excelTemplateVerified; // لا تُضبط يدوياً — تُشتق من تحقق فعلي فقط
  const settings = await saveSettings(patch);
  res.json({ ok: true, settings });
});

app.get('/api/logs', async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 200);
  res.json({ ok: true, logs: await readLogs(limit) });
});

/* ================================================================= */
/* 2) الطلاب                                                         */
/* ================================================================= */
app.get('/api/students', async (req, res) => {
  const [students, classes] = await Promise.all([loadStudents(), loadClasses()]);
  const byId = new Map((classes.items || []).map((c) => [c.id, c]));
  let items = (students.items || []).slice();

  const needsReview = String(req.query.needsReview || '') === 'true';
  if (needsReview) items = items.filter((s) => s.verificationStatus === 'needs_review');

  const classId = String(req.query.classId || '').trim();
  if (classId) items = items.filter((s) => s.classId === classId);

  const query = normAr(req.query.query).toLowerCase();
  const queryRaw = String(req.query.query || '').trim().toLowerCase();
  if (query || queryRaw) {
    items = items.filter((s) => {
      const byName = normAr(s.fullName).toLowerCase().includes(query);
      const byCode = String(s.studentCode || '').toLowerCase().includes(queryRaw);
      return byName || byCode;
    });
  }

  items.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'ar'));

  const total = items.length;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const page = items.slice(offset, offset + limit).map((s) => {
    const cls = byId.get(s.classId);
    return { ...s, classLabel: cls ? classLabel(cls) : s.classLabel || '' };
  });

  res.json({ ok: true, total, limit, offset, results: page });
});

app.post('/api/students', async (req, res) => {
  const b = req.body || {};
  const students = await loadStudents();
  const items = students.items || [];
  const now = nowISO();

  const studentCode = String(b.studentCode ?? '').trim();
  const fullName = String(b.fullName ?? '').trim();
  const classId = String(b.classId ?? '').trim();
  if (!classId) return bad(res, 400, 'لا يمكن حفظ الطالب دون صنف (classId)');
  if (!fullName) return bad(res, 400, 'لا يمكن حفظ الطالب دون اسم');
  if (!/^\d{6,12}$/.test(studentCode)) {
    return bad(res, 400, 'كود الطالب يجب أن يكون رقماً من 6 إلى 12 خانة');
  }

  const classes = await loadClasses();
  const cls = (classes.items || []).find((c) => c.id === classId);
  const label = cls ? classLabel(cls) : '';

  const codeKey = studentCode;
  let target = b.id ? items.find((s) => s.id === b.id) : null;
  if (!target) target = items.find((s) => s.classId === classId && s.studentCode === codeKey);
  let created = false;

  if (target) {
    target.fullName = fullName;
    target.studentCode = studentCode;
    target.verificationStatus = 'verified';
    target.reviewNotes = [];
    target.updatedAt = now;
  } else {
    created = true;
    target = {
      id: newId('stu'),
      studentCode,
      fullName,
      classId,
      classLabel: label,
      schoolId: cls ? cls.schoolId : 'sch_default',
      stage: cls ? cls.stage : '',
      grade: cls ? cls.grade : '',
      section: cls ? cls.section : '',
      active: true,
      verificationStatus: 'verified',
      reviewNotes: [],
      createdAt: now,
      updatedAt: now,
      source: { file: b.sourceFile || '', page: b.sourcePage || 0, importedAt: now },
    };
    items.push(target);
  }

  await saveStudents({ items });
  await recomputeClassCount(classId);
  await log('info', created ? `أُضيف طالب ${fullName} (${studentCode})` : `عُدّل الطالب ${fullName} (${studentCode})`);
  res.json({ ok: true, student: target, created });
});

/* ================================================================= */
/* 3) استيراد كشف PDF                                                */
/* ================================================================= */
app.post('/api/pdf/extract', async (req, res) => {
  const { fileName, data } = req.body || {};
  if (!data || typeof data !== 'string') return bad(res, 400, 'لم يصل محتوى الملف');
  let bytes;
  try {
    bytes = Buffer.from(data, 'base64');
  } catch {
    return bad(res, 400, 'تعذّر فك ترميز الملف المرسل');
  }
  if (!bytes.length) return bad(res, 400, 'الملف المرسل فارغ');
  if (bytes.length > MAX_PDF_BYTES) return bad(res, 413, 'حجم الملف يتجاوز 25 ميجابايت');

  const safeName = path.basename(String(fileName || 'file.pdf'));
  try {
    // تحقق أن الملف فعلياً PDF
    const probe = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    if (!probe.getPageCount()) return bad(res, 400, 'الملف لا يحتوي على صفحات');
  } catch {
    return bad(res, 400, 'الملف ليس ملف PDF صالحاً');
  }

  try {
    const result = await extractPdf(bytes, safeName);
    await log('info', `استُخرج كشف "${safeName}": ${result.rows.length} طالب، ${result.rows.filter((r) => r.needsReview).length} يحتاج مراجعة`);
    res.json(result);
  } catch (e) {
    await log('error', `فشل استخراج ${safeName}: ${e.message}`);
    return bad(res, 500, `تعذّر قراءة الملف: ${e.message}`);
  }
});

app.post('/api/pdf/confirm', async (req, res) => {
  const { fileName, header, rows, classId, mode } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return bad(res, 400, 'لا توجد صفوف لتأكيدها');

  const schools = await loadSchools();
  const classes = await loadClasses();
  const students = await loadStudents();

  let targetClassId = String(classId || '').trim();
  if (mode === 'create_class' || !targetClassId) {
    const school = findOrCreateSchool(schools, {
      name: header?.school,
      directorate: header?.directorate ? `مديري التربية والتعليم بال${header.directorate}` : '',
      administration: header?.administration,
    });
    await saveSchools(schools);

    const key = `${school.id}|${normAr(header?.className || '')}|${normAr(header?.stage || '')}|${normAr(header?.grade || '')}|${normAr(header?.section || '')}`;
    let cls = (classes.items || []).find((c) => c.syncKey === key);
    if (!cls) {
      cls = {
        id: newId('cls'),
        syncKey: key,
        schoolId: school.id,
        stage: header?.stage || '',
        grade: header?.grade || '',
        section: header?.section || '',
        name: header?.className || '',
        studentCount: 0,
        sourceFile: fileName || '',
        importedAt: nowISO(),
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      classes.items.push(cls);
    }
    targetClassId = cls.id;
  }

  const cls = (classes.items || []).find((c) => c.id === targetClassId);
  if (!cls) return bad(res, 404, 'الصنف المحدد غير موجود');

  const items = students.items || [];
  const now = nowISO();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let needsReview = 0;
  const conflicts = [];
  const incomplete = [];

  for (const raw of rows) {
    const studentCode = String(raw.studentCode ?? '').trim();
    const fullName = String(raw.fullName ?? '').trim();
    const codeOk = /^\d{6,12}$/.test(studentCode);
    const nameOk = !!fullName && !fullName.includes('\uFFFD');

    if (!codeOk && !nameOk) { skipped += 1; continue; }

    const reviewNotes = [];
    if (!codeOk) reviewNotes.push('كود الطالب غير مكتمل — عدّله قبل التصدير');
    if (!nameOk) reviewNotes.push('اسم الطالب غير مكتمل — عدّله قبل التصدير');
    const status = codeOk && nameOk ? 'verified' : 'needs_review';
    if (status === 'needs_review') needsReview += 1;

    const key = codeOk
      ? (s) => s.classId === targetClassId && s.studentCode === studentCode
      : (s) => s.classId === targetClassId && normAr(s.fullName) === normAr(fullName);

    const existing = items.find(key);
    if (existing) {
      // لا نحذف ولا نستبدل تلقائياً عند الاختلاف — نسجّل التعارض للمراجعة
      if (normAr(existing.fullName) !== normAr(fullName) && nameOk) {
        conflicts.push({
          studentCode,
          studentId: existing.id,
          field: 'fullName',
          existing: existing.fullName,
          incoming: fullName,
        });
      } else {
        updated += 1;
      }
      existing.updatedAt = now;
      existing.lastSeenAt = now;
      existing.source = { file: fileName || '', page: raw.page || 0, importedAt: now };
      if (existing.verificationStatus === 'verified' && status === 'needs_review') {
        existing.verificationStatus = 'needs_review';
        existing.reviewNotes = reviewNotes;
      }
      continue;
    }

    const student = {
      id: newId('stu'),
      studentCode,
      fullName,
      classId: targetClassId,
      classLabel: classLabel(cls),
      schoolId: cls.schoolId,
      stage: cls.stage,
      grade: cls.grade,
      section: cls.section,
      active: true,
      verificationStatus: status,
      reviewNotes,
      createdAt: now,
      updatedAt: now,
      source: { file: fileName || '', page: raw.page || 0, importedAt: now },
    };
    items.push(student);
    added += 1;
  }

  if (header?.className && !cls.name) cls.name = header.className;
  cls.importedAt = now;
  cls.sourceFile = fileName || cls.sourceFile;
  cls.updatedAt = now;

  await saveSchools(schools);
  await saveClasses(classes);
  await saveStudents({ items });

  const count = await recomputeClassCount(targetClassId);
  cls.studentCount = count;

  const record = {
    id: newId('imp'),
    fileName: String(fileName || ''),
    importedAt: now,
    classId: targetClassId,
    classLabel: classLabel(cls),
    added,
    updated,
    skipped,
    needsReview,
    conflicts: conflicts.length,
    conflictList: conflicts.slice(0, 50),
    pages: Number(header?.pages) || 0,
    rows: rows.length,
    warnings: Array.isArray(header?.warnings) ? header.warnings.slice(0, 20) : [],
  };
  const history = await loadImportHistory();
  history.items = [record, ...(history.items || [])].slice(0, 200);
  await saveImportHistory(history);

  await log('info', `أُكّد استيراد "${fileName}" إلى ${classLabel(cls)}: أُضيف ${added}، حُدّث ${updated}، تعارض ${conflicts.length}، يحتاج مراجعة ${needsReview}`);

  res.json({ ok: true, importId: record.id, added, updated, skipped, needsReview, conflicts, classId: targetClassId });
});

app.get('/api/imports', async (_req, res) => {
  const history = await loadImportHistory();
  res.json({ ok: true, history: history.items || [] });
});

/* ================================================================= */
/* 4) الغياب اليومي                                                  */
/* ================================================================= */
function attendanceKey(date, classId) {
  return `${date}|${classId}`;
}

async function getDayRecord(date, classId) {
  const doc = await loadAttendance();
  const items = doc.items || [];
  return items.find((d) => attendanceKey(d.date, d.classId) === attendanceKey(date, classId)) || null;
}

app.get('/api/attendance/day', async (req, res) => {
  const date = String(req.query.date || todayISO()).trim();
  const [classes, students, attendance] = await Promise.all([loadClasses(), loadStudents(), loadAttendance()]);
  const byId = new Map((students.items || []).map((s) => [s.id, s]));

  const classesOut = (classes.items || []).map((cls) => {
    const rec = (attendance.items || []).find((d) => d.date === date && d.classId === cls.id);
    const selectedIds = rec ? (rec.studentIds || []) : [];
    const selected = selectedIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((s) => ({ id: s.id, studentCode: s.studentCode, fullName: s.fullName, verificationStatus: s.verificationStatus }));
    return {
      classId: cls.id,
      classLabel: classLabel(cls),
      stage: cls.stage,
      grade: cls.grade,
      section: cls.section,
      studentCount: cls.studentCount || 0,
      selectedCount: selected.length,
      selected,
      export: rec && rec.exportedAt ? {
        exportedAt: rec.exportedAt,
        path: rec.exportedPath || '',
        fileName: rec.exportedFileName || '',
        rowCount: rec.exportedRows || 0,
      } : null,
      automation: rec && rec.automation ? rec.automation : null,
    };
  });

  res.json({ ok: true, date, classes: classesOut });
});

app.post('/api/attendance/select', async (req, res) => {
  const { date, classId, studentIds } = req.body || {};
  const d = String(date || '').trim();
  const cid = String(classId || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return bad(res, 400, 'التاريخ غير صالح (الشكل YYYY-MM-DD)');
  if (!cid) return bad(res, 400, 'لم يُحدد صنف');

  const students = await loadStudents();
  const valid = new Set((students.items || []).filter((s) => s.classId === cid).map((s) => s.id));
  const ids = Array.isArray(studentIds) ? studentIds.map(String).filter((id) => valid.has(id)) : [];

  const doc = await loadAttendance();
  const items = doc.items || [];
  let rec = items.find((x) => attendanceKey(x.date, x.classId) === attendanceKey(d, cid));
  if (!rec) {
    rec = { date: d, classId: cid, studentIds: [], createdAt: nowISO() };
    items.push(rec);
  }
  rec.studentIds = ids;
  rec.updatedAt = nowISO();
  await saveAttendance({ items });
  res.json({ ok: true, date: d, classId: cid, count: ids.length });
});

app.get('/api/attendance/report', async (req, res) => {
  const date = String(req.query.date || todayISO()).trim();
  const classId = String(req.query.classId || '').trim();
  const [students, attendance] = await Promise.all([loadStudents(), loadAttendance()]);
  const rec = (attendance.items || []).find((d) => d.date === date && d.classId === classId);
  const selected = new Set(rec ? rec.studentIds || [] : []);
  const list = (students.items || [])
    .filter((s) => s.classId === classId && s.active !== false)
    .map((s) => ({ id: s.id, studentCode: s.studentCode, fullName: s.fullName, selected: selected.has(s.id) }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
  res.json({ ok: true, date, classId, students: list });
});

app.post('/api/attendance/export', async (req, res) => {
  const { date, classId, allClasses, confirmIncomplete } = req.body || {};
  const d = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return bad(res, 400, 'التاريخ غير صالح (الشكل YYYY-MM-DD)');

  const [classes, students, attendance, settings] = await Promise.all([
    loadClasses(), loadStudents(), loadAttendance(), getSettings(),
  ]);
  const byId = new Map((students.items || []).map((s) => [s.id, s]));
  const clsById = new Map((classes.items || []).map((c) => [c.id, c]));

  const targetClassIds = allClasses
    ? (classes.items || []).map((c) => c.id)
    : [String(classId || '').trim()].filter(Boolean);
  if (!targetClassIds.length) return bad(res, 400, 'لم يُحدد صنف للتصدير');

  const records = (attendance.items || []).filter((r) => r.date === d && targetClassIds.includes(r.classId));
  const selectedIds = [...new Set(records.flatMap((r) => r.studentIds || []))];
  if (!selectedIds.length) return bad(res, 400, 'لا توجد طلاب محدَّدين كغائبين في هذا التاريخ');

  const picked = selectedIds.map((id) => byId.get(id)).filter(Boolean);
  if (picked.length !== selectedIds.length) {
    return bad(res, 409, 'بعض الطلاب المحدَّدين لم يعد موجوداً في القاعدة — أعد تحديد الغائبين');
  }

  // سجلات غير مكتملة تتطلب تأكيداً صريحاً قبل التصدير
  const unconfirmed = picked
    .filter((s) => s.verificationStatus === 'needs_review' || !/^\d{6,12}$/.test(String(s.studentCode || '')))
    .map((s) => ({ id: s.id, studentCode: s.studentCode, fullName: s.fullName, classLabel: s.classLabel, notes: s.reviewNotes || [] }));

  if (unconfirmed.length && !confirmIncomplete) {
    return res.status(409).json({
      ok: false,
      error: 'يوجد سجلات غير مكتملة أو غير مؤكدة بين المحدَّدين. عدّلها من شاشة الطلاب ثم أعد التحديد، أو أعد الطلب بتأكيد صريح.',
      unconfirmed,
    });
  }

  const primaryClass = allClasses ? null : clsById.get(targetClassIds[0]);
  const rows = picked
    .map((s) => ({
      studentCode: String(s.studentCode || '').trim(),
      fullName: s.fullName,
      grade: s.grade || (primaryClass ? primaryClass.grade : '') || '',
      section: s.section || (primaryClass ? primaryClass.section : '') || '',
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));

  let built;
  try {
    built = await buildAttendanceWorkbook({
      date: d,
      className: allClasses ? 'كل الأصناف' : classLabel(primaryClass || {}),
      grade: primaryClass ? primaryClass.grade : '',
      section: primaryClass ? primaryClass.section : '',
      students: rows,
    });
  } catch (e) {
    await log('error', `فشل إنشاء ملف Excel: ${e.message}`);
    return bad(res, 500, `تعذّر إنشاء ملف Excel: ${e.message}`);
  }

  // تحقق فعلي من الملف المُنتَج قبل إعلان أي شيء
  const verified = await verifyWorkbook(built.path);
  if (!verified.ok) {
    await log('error', `الملف المُنتَج لم يجتز التحقق: ${verified.reason}`);
    return bad(res, 500, `الملف المُنتَج لم يجتز التحقق: ${verified.reason}`);
  }
  if (!settings.excelTemplateVerified) {
    await saveSettings({ excelTemplateVerified: true, excelVerifiedAt: nowISO() });
  }

  const info = await loadAttendance();
  for (const rec of (info.items || [])) {
    if (rec.date === d && targetClassIds.includes(rec.classId)) {
      rec.exportedAt = nowISO();
      rec.exportedPath = built.path;
      rec.exportedFileName = built.fileName;
      rec.exportedRows = built.rowCount;
    }
  }
  await saveAttendance(info);

  await log('info', `صُدِّر ملف Excel "${built.fileName}" بعدد ${built.rowCount} غائب`);
  res.json({ ...built, verified: true });
});

app.get('/api/exports/latest', async (_req, res) => {
  const attendance = await loadAttendance();
  const exported = (attendance.items || [])
    .filter((d) => d.exportedPath)
    .sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt)))[0];
  if (!exported || !fs.existsSync(exported.exportedPath)) return res.json({ ok: false });
  const st = fs.statSync(exported.exportedPath);
  res.json({
    ok: true,
    file: {
      path: exported.exportedPath,
      fileName: exported.exportedFileName,
      size: st.size,
      createdAt: exported.exportedAt,
      rowCount: exported.exportedRows || 0,
    },
  });
});

app.get('/api/exports/download', async (req, res) => {
  const date = String(req.query.date || '').trim();
  const classId = String(req.query.classId || '').trim();
  const attendance = await loadAttendance();
  const rec = (attendance.items || [])
    .filter((d) => (!date || d.date === date) && (!classId || d.classId === classId))
    .sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt)))[0];
  if (!rec || !rec.exportedPath || !fs.existsSync(rec.exportedPath)) {
    return bad(res, 404, 'لا يوجد ملف مُصدَّر لهذا الاختيار');
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rec.exportedFileName || 'export.xlsx')}`);
  fs.createReadStream(rec.exportedPath).pipe(res);
});

/* ================================================================= */
/* 5) الأتمتة                                                        */
/* ================================================================= */
let lastAutomation = null;

app.post('/api/automation/run', async (req, res) => {
  const { date, classId, export: doExport } = req.body || {};
  const d = String(date || todayISO()).trim();
  const cid = String(classId || '').trim();
  const settings = await getSettings();

  let excelPath = null;
  if (doExport !== false && cid) {
    const attendance = await loadAttendance();
    const rec = (attendance.items || []).find((x) => x.date === d && x.classId === cid);
    if (rec?.exportedPath && fs.existsSync(rec.exportedPath)) {
      excelPath = rec.exportedPath;
    } else {
      // نُصدِّر أولاً (بنفس قواعد التحقق)
      const [classes, students] = await Promise.all([loadClasses(), loadStudents()]);
      const cls = (classes.items || []).find((c) => c.id === cid);
      const byId = new Map((students.items || []).map((s) => [s.id, s]));
      const ids = rec ? rec.studentIds || [] : [];
      const picked = ids.map((id) => byId.get(id)).filter(Boolean);
      if (!picked.length) {
        lastAutomation = {
          ok: false,
          status: 'error',
          message: 'لا توجد طلاب محدَّدين كغائبين في هذا التاريخ — حدِّدهم أولاً من شاشة «غياب اليوم».',
          steps: [], evidence: [], startedAt: nowISO(), finishedAt: nowISO(), durationMs: 0,
        };
        return res.json(lastAutomation);
      }
      const unconfirmed = picked.filter((s) => s.verificationStatus === 'needs_review' || !/^\d{6,12}$/.test(String(s.studentCode || '')));
      if (unconfirmed.length) {
        lastAutomation = {
          ok: false,
          status: 'error',
          message: 'يوجد سجلات غير مكتملة بين المحدَّدين — عدّلها من شاشة الطلاب قبل الإدخال.',
          steps: [], evidence: [], startedAt: nowISO(), finishedAt: nowISO(), durationMs: 0,
          unconfirmed: unconfirmed.map((s) => ({ id: s.id, studentCode: s.studentCode, fullName: s.fullName })),
        };
        return res.json(lastAutomation);
      }
      try {
        const built = await buildAttendanceWorkbook({
          date: d,
          className: cls ? classLabel(cls) : cid,
          grade: cls ? cls.grade : '',
          section: cls ? cls.section : '',
          students: picked.map((s) => ({
            studentCode: s.studentCode, fullName: s.fullName, grade: s.grade, section: s.section,
          })),
        });
        const v = await verifyWorkbook(built.path);
        if (!v.ok) return res.json({ ok: false, status: 'error', message: `الملف المُنتَج لم يجتز التحقق: ${v.reason}`, steps: [], evidence: [] });
        excelPath = built.path;
        const info = await loadAttendance();
        for (const r of (info.items || [])) {
          if (r.date === d && r.classId === cid) {
            r.exportedAt = nowISO();
            r.exportedPath = built.path;
            r.exportedFileName = built.fileName;
            r.exportedRows = built.rowCount;
          }
        }
        await saveAttendance(info);
      } catch (e) {
        return res.json({ ok: false, status: 'error', message: `تعذّر إنشاء ملف Excel: ${e.message}`, steps: [], evidence: [] });
      }
    }
  }

  const result = await runAutomation({ date: d, classId: cid, excelPath, settings });
  lastAutomation = result;

  const info = await loadAttendance();
  for (const r of (info.items || [])) {
    if (r.date === d && r.classId === cid) {
      r.automation = { status: result.status, message: result.message, at: result.finishedAt, evidence: result.evidence?.length || 0 };
    }
  }
  await saveAttendance(info);
  await log(result.status === 'success' ? 'info' : 'warn', `الأتمتة (${d}): ${result.status} — ${result.message}`);

  res.json(result);
});

app.get('/api/automation/status', (_req, res) => {
  res.json(lastAutomation || { ok: true, status: 'idle' });
});

app.post('/api/automation/close', async (_req, res) => {
  res.json(await closeManualBrowser());
});

/* ================================================================= */
/* 6) تقديم الواجهة                                                  */
/* ================================================================= */
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res
    .status(200)
    .type('html')
    .send('<html lang="ar" dir="rtl"><meta charset="utf-8"><title>لم تُبنَ الواجهة بعد</title>'
      + '<body style="font-family:Segoe UI,Tahoma,Arial;text-align:center;padding:40px">'
      + '<h1>لم تُبنَ واجهة المستخدم بعد</h1>'
      + '<p>شغّل <span dir="ltr">npm run build</span> أولاً ثم أعد تشغيل الخادم.</p></body></html>'));
}

// معالج أخطاء موحّد (لا يُعيد أي بيانات حساسة)
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ ok: false, error: 'خطأ داخلي في الخادم المحلي' });
});

async function main() {
  await ensureSeed();
  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`\n  نظام متابعة الغياب اليومي — خادم محلي`);
    console.log(`  الرابط: http://${HOST}:${PORT}`);
    console.log(`  البيانات: ${DATA_DIR}`);
    console.log(`  الملفات المصدَّرة: ${EXPORT_DIR}\n`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('فشل تشغيل الخادم:', e);
  process.exit(1);
});
