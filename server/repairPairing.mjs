/**
 * مواءمة قاعدة البيانات بعد إصلاح ازدواج الطلاب في الصف الواحد:
 * كان كود الطالب في المجموعة اليسرى يُقرن باسم المجموعة اليمنى عندما تكون
 * المسافة بين رقم أحدهما واسم الآخر أقل من عتبة التجميع.
 *
 * النتيجة على قاعدة بياناتك الحالية: تصحيح اسم واحد، استرجاع طالب محذوف،
 * وحذف سجل مكرر بلا كود تولّد من نفس الخطأ.
 *
 * الاستخدام: node server/repairPairing.mjs <file.pdf> [file2.pdf ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractPdf } from './pdfExtractor.mjs';
import { loadStudents, saveStudents, loadClasses, saveClasses, log } from './store.mjs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('الاستخدام: node server/repairPairing.mjs <file.pdf> [file2.pdf ...]');
  process.exit(1);
}

const normAr = (s) => String(s || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[\u064B-\u0652\u0670\u0640]/g, '').replace(/\s+/g, ' ').trim();

const students = await loadStudents();
const byKey = new Map();
for (const s of students.items || []) {
  byKey.set(`${s.classId}|${s.studentCode || ''}`, s);
}

const fixedNames = [];
const addedStudents = [];
const removedDupes = [];

for (const f of files) {
  const fileName = path.basename(f);
  const res = await extractPdf(fs.readFileSync(f), fileName);
  if (res.rows.some((r) => r.needsReview && r.studentCode)) {
    console.log(`تنبيه: ${fileName} يحوي صفوف مراجعة بكود — لن يُعتمد أي صف منها.`);
  }

  // كل الصفوف ذات الكود — بما فيها ما يحتاج مراجعة — لتزامنة حالة التحقق
  const codedRows = res.rows.filter((r) => r.studentCode);

  // صنف هذا الملف: من السجلات المخزَّنة المرتبطة بنفس المصدر
  const existingOfClass = (students.items || []).filter((s) => s.source && s.source.file === fileName);
  const classId = existingOfClass[0]?.classId;

  for (const r of codedRows) {
    const rec = byKey.get(`${classId}|${r.studentCode}`);
    if (rec) {
      // لا نلمس الأسماء السليمة — نصحّح فقط ما فسد فعلاً (رقم داخل الاسم أو رمز غير معروف)،
      // ولا من صف يحتاج مراجعة يدوية.
      const corrupt = /[0-9]/.test(String(rec.fullName || '')) || String(rec.fullName || '').includes('\uFFFD');
      if (corrupt && !r.needsReview) {
        fixedNames.push({ code: r.studentCode, from: rec.fullName, to: r.fullName });
        rec.fullName = r.fullName;
        rec.pairingRepairedAt = new Date().toISOString();
      }
      // مزامنة حالة المراجعة: الاستخراج هو المرجع في تقرير الجودة
      if (r.needsReview) {
        rec.reviewNotes = (r.reviewNotes || []).slice();
        rec.verificationStatus = 'needs_review';
      } else {
        rec.reviewNotes = [];
        rec.verificationStatus = 'verified';
      }
      rec.updatedAt = new Date().toISOString();
      rec.reviewSyncedAt = rec.updatedAt;
      continue;
    }
    // طالب مستخرج لا يوجد له سجل بكوده — لا نضيفه إذا كان صفه يحتاج مراجعة
    if (!classId || r.needsReview) continue;
    const dupeIdx = (students.items || []).findIndex(
      (s) => s.classId === classId && !s.studentCode && normAr(s.fullName) === normAr(r.fullName),
    );
    if (dupeIdx >= 0) {
      // سجل بلا كود تولّد من نفس الخطأ: يحمل الاسم الصحيح لطالب كوده معروف
      const old = students.items[dupeIdx];
      old.studentCode = r.studentCode;
      old.verificationStatus = 'verified';
      old.reviewNotes = [];
      old.updatedAt = new Date().toISOString();
      old.pairingRepairedAt = old.updatedAt;
      byKey.set(`${classId}|${r.studentCode}`, old);
      fixedNames.push({ code: r.studentCode, from: `${old.fullName} (بلا كود)`, to: `${r.fullName} (كود ${r.studentCode})` });
      continue;
    }
    // طالب فعلاً غائب من القاعدة
    const cls = (await loadClasses()).items.find((c) => c.id === classId);
    const now = new Date().toISOString();
    const rec2 = {
      id: `stu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      classId,
      classLabel: cls?.name ?? '',
      schoolId: cls?.schoolId ?? '',
      studentCode: r.studentCode,
      fullName: r.fullName,
      stage: cls?.stage ?? '',
      grade: cls?.grade ?? '',
      section: cls?.section ?? '',
      active: true,
      verificationStatus: 'verified',
      reviewNotes: [],
      createdAt: now,
      updatedAt: now,
      source: { file: fileName, page: r.page, importedAt: now },
      pairingRepairedAt: now,
    };
    students.items.push(rec2);
    byKey.set(`${classId}|${r.studentCode}`, rec2);
    addedStudents.push({ code: r.studentCode, name: r.fullName });
  }
}

// استكمال بيانات الأصناف الناقصة في أي سجل (كُتب يدوياً أو أُضيف خارج الاستيراد)
const classes = await loadClasses();
const classById = new Map((classes.items || []).map((c) => [c.id, c]));
let backfilled = 0;
for (const s of students.items || []) {
  const cls = classById.get(s.classId);
  if (!cls) continue;
  let touched = false;
  for (const [k, v] of [['classLabel', cls.name], ['schoolId', cls.schoolId], ['stage', cls.stage], ['grade', cls.grade], ['section', cls.section]]) {
    if (!s[k] && v) { s[k] = v; touched = true; }
  }
  if (s.active === undefined) { s.active = true; touched = true; }
  if (touched) { s.updatedAt = new Date().toISOString(); backfilled++; }
}

// إزالة السجلات البديلة: سجل بلا كود يحمل اسماً مطابقاً تماماً لسجل آخر بكود في الصنف نفسه
const before = (students.items || []).length;
students.items = (students.items || []).filter((s) => {
  if (s.studentCode) return true;
  const twin = (students.items || []).find(
    (o) => o !== s && o.studentCode && o.classId === s.classId && normAr(o.fullName) === normAr(s.fullName),
  );
  if (twin) removedDupes.push({ name: s.fullName, twinCode: twin.studentCode });
  return !twin;
});
const removedCount = before - (students.items || []).length;

await saveStudents(students);

// تحديث العدد في الأصناف
for (const c of classes.items || []) {
  c.studentCount = (students.items || []).filter((s) => s.classId === c.id).length;
  c.updatedAt = new Date().toISOString();
}
await saveClasses(classes);

if (fixedNames.length) await log('info', `مواءمة الأزواج: تصحيح ${fixedNames.length} سجلاً`);
if (addedStudents.length) await log('info', `مواءمة الأزواج: إضافة ${addedStudents.length} طالباً مفقوداً`);

console.log(`\nتصحيحات: ${fixedNames.length}`);
for (const c of fixedNames) console.log(`  [${c.code}]\n    قبل: ${c.from}\n    بعد: ${c.to}`);
console.log(`\nإضافات: ${addedStudents.length}`);
for (const a of addedStudents) console.log(`  [${a.code}] ${a.name}`);
console.log(`\nاستكمال بيانات أصناف: ${backfilled}`);
console.log(`\nحذف مكررات: ${removedDupes.length}${removedCount ? ` (حُذف ${removedCount} سجل)` : ''}`);
for (const d of removedDupes) console.log(`  ${d.name}  ← توأم بكود ${d.twinCode}`);
console.log(`\nالإجمالي الآن: ${(students.items || []).length} طالباً`);
