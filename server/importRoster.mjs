/**
 * استيراد كشف قوائم من ملف PDF من سطر الأوامر (بدون واجهة).
 * الاستخدام: node server/importRoster.mjs <file.pdf> [file2.pdf ...]
 *
 * ملاحظة: لا يُستبدل أي طالب تلقائياً عند اختلاف الاسم — يُسجَّل التعارض للمراجعة.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractPdf } from './pdfExtractor.mjs';
import {
  loadSchools, saveSchools, loadClasses, saveClasses, loadStudents, saveStudents,
  loadImportHistory, saveImportHistory, log, newId,
} from './store.mjs';

const normAr = (s) => String(s || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[\u064B-\u0652\u0670\u0640]/g, '').replace(/\s+/g, ' ').trim();
const nowISO = () => new Date().toISOString();
const label = (c) => c.name || [c.grade, c.section].filter(Boolean).join(' / ');

async function importOne(file) {
  const name = path.basename(file);
  const bytes = fs.readFileSync(file);
  const result = await extractPdf(bytes, name);
  if (!result.rows.length) {
    console.log(`✗ ${name}: لم يُعثر على صفوف طلاب`);
    return null;
  }

  const schools = await loadSchools();
  let school = schools.items.find((s) => normAr(s.name) === normAr(result.header.school));
  if (!school) {
    school = {
      id: newId('sch'),
      name: result.header.school || '',
      directorate: result.header.directorate ? `مديري التربية والتعليم بال${result.header.directorate}` : '',
      administration: result.header.administration || '',
      active: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    schools.items.push(school);
    await saveSchools(schools);
  }

  const classes = await loadClasses();
  const key = `${school.id}|${normAr(result.header.className)}|${normAr(result.header.stage)}|${normAr(result.header.grade)}|${normAr(result.header.section)}`;
  let cls = classes.items.find((c) => c.syncKey === key);
  if (!cls) {
    cls = {
      id: newId('cls'),
      syncKey: key,
      schoolId: school.id,
      stage: result.header.stage || '',
      grade: result.header.grade || '',
      section: result.header.section || '',
      name: result.header.className || '',
      studentCount: 0,
      sourceFile: name,
      importedAt: nowISO(),
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    classes.items.push(cls);
    await saveClasses(classes);
  }

  const students = await loadStudents();
  const now = nowISO();
  let added = 0;
  let updated = 0;
  let conflicts = 0;
  let needsReview = 0;

  for (const raw of result.rows) {
    const studentCode = String(raw.studentCode ?? '').trim();
    const fullName = String(raw.fullName ?? '').trim();
    const codeOk = /^\d{6,12}$/.test(studentCode);
    const nameOk = !!fullName && !fullName.includes('\uFFFD');
    if (!codeOk && !nameOk) continue;

    const reviewNotes = [];
    if (!codeOk) reviewNotes.push('كود الطالب غير مكتمل — عدّله قبل التصدير');
    if (!nameOk) reviewNotes.push('اسم الطالب غير مكتمل — عدّله قبل التصدير');
    const status = codeOk && nameOk ? 'verified' : 'needs_review';
    if (status === 'needs_review') needsReview += 1;

    const match = codeOk
      ? (s) => s.classId === cls.id && s.studentCode === studentCode
      : (s) => s.classId === cls.id && normAr(s.fullName) === normAr(fullName);
    const existing = students.items.find(match);

    if (existing) {
      if (nameOk && normAr(existing.fullName) !== normAr(fullName)) {
        conflicts += 1;
        console.log(`  ! تعارض للكود ${studentCode}: "${existing.fullName}" ≠ "${fullName}" (أُبقي القديم)`);
      } else {
        updated += 1;
      }
      existing.updatedAt = now;
      existing.lastSeenAt = now;
      if (existing.verificationStatus === 'verified' && status === 'needs_review') {
        existing.verificationStatus = 'needs_review';
        existing.reviewNotes = reviewNotes;
      }
      continue;
    }

    students.items.push({
      id: newId('stu'),
      studentCode,
      fullName,
      classId: cls.id,
      classLabel: label(cls),
      schoolId: school.id,
      stage: cls.stage,
      grade: cls.grade,
      section: cls.section,
      active: true,
      verificationStatus: status,
      reviewNotes,
      createdAt: now,
      updatedAt: now,
      source: { file: name, page: raw.page || 0, importedAt: now },
    });
    added += 1;
  }

  await saveStudents(students);
  cls.studentCount = students.items.filter((s) => s.classId === cls.id && s.active !== false).length;
  cls.importedAt = now;
  cls.sourceFile = name;
  await saveClasses(classes);

  const history = await loadImportHistory();
  history.items = [{
    id: newId('imp'),
    fileName: name,
    importedAt: now,
    classId: cls.id,
    classLabel: label(cls),
    added, updated, skipped: 0, needsReview,
    conflicts,
    conflictList: [],
    pages: result.pages,
    rows: result.rows.length,
    warnings: result.warnings,
  }, ...(history.items || [])].slice(0, 200);
  await saveImportHistory(history);
  await log('info', `استيراد CLI "${name}" إلى ${label(cls)}: أُضيف ${added}، حُدّث ${updated}، تعارض ${conflicts}، يحتاج مراجعة ${needsReview}`);

  console.log(`✓ ${name} → صنف "${label(cls)}" (${cls.id})`);
  console.log(`   أُضيف ${added} | حُدّث ${updated} | تعارض ${conflicts} | يحتاج مراجعة ${needsReview} | الكشف يقول ${result.header.totalStudents}`);
  for (const r of result.rows.filter((x) => x.needsReview)) {
    console.log(`   • مراجعة: [${r.studentCode || '—'}] ${r.fullName || '—'} — ${r.reviewNotes.join('؛ ')}`);
  }
  return cls;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('الاستخدام: node server/importRoster.mjs <file.pdf> [file2.pdf ...]');
  process.exit(1);
}
for (const f of files) {
  try {
    await importOne(f);
  } catch (e) {
    console.log(`✗ ${f}: ${e.message}`);
  }
}
