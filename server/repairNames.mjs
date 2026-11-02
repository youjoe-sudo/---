/**
 * إصلاح أسماء الطلاب التي حُفظت وهي تحتوي رمزاً غير معروف (�)
 * بعد اكتمال خريطة رموز الخط.
 *
 * الاستخدام: node server/repairNames.mjs <file.pdf> [file2.pdf ...]
 *
 * قواعد السلامة:
 *  - يغيّر الاسم فقط إذا كان المخزَّن يحتوي على � (فساد مؤكد).
 *  - لا يغيّر أي اسم آخر مهما اختلف.
 *  - يسجّل كل تغيير في السجل ويعيد ملخصه على الشاشة.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractPdf } from './pdfExtractor.mjs';
import { loadStudents, saveStudents, log } from './store.mjs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('الاستخدام: node server/repairNames.mjs <file.pdf> [file2.pdf ...]');
  process.exit(1);
}

const normAr = (s) => String(s || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[\u064B-\u0652\u0670\u0640]/g, '').replace(/\s+/g, ' ').trim();

// كود -> اسم مُصلَّح لكل ملف
const fixedByCode = new Map();
for (const f of files) {
  const res = await extractPdf(fs.readFileSync(f), path.basename(f));
  for (const r of res.rows) {
    if (!r.studentCode) continue;
    if (r.needsReview) continue; // لا نعتمد على صف لم يجتز التحقق
    fixedByCode.set(r.studentCode, { name: r.fullName, file: path.basename(f) });
  }
}

const students = await loadStudents();
const now = new Date().toISOString();
const changes = [];

for (const s of students.items || []) {
  if (!String(s.fullName || '').includes('\uFFFD')) continue;
  const fix = fixedByCode.get(s.studentCode);
  if (!fix || fix.name.includes('\uFFFD')) continue;
  changes.push({ code: s.studentCode, from: s.fullName, to: fix.name });
  s.fullName = fix.name;
  s.verificationStatus = 'verified';
  s.reviewNotes = [];
  s.updatedAt = now;
  s.nameRepairedAt = now;
}

if (!changes.length) {
  console.log('لا توجد أسماء مخزَّنة تحتوي على رمز غير معروف — لا حاجة للإصلاح.');
  process.exit(0);
}

await saveStudents(students);
await log('info', `إصلاح الأسماء: تم تصحيح ${changes.length} اسماً كان يحتوي رمزاً غير معروف`);

console.log(`تم إصلاح ${changes.length} اسمًا:\n`);
for (const c of changes) console.log(`  ${c.code}\n    قبل: ${c.from}\n    بعد: ${c.to}`);

// إحصاء نهائي
const left = (students.items || []).filter((s) => String(s.fullName || '').includes('\uFFFD'));
console.log(`\nالمتبقّي بالرمز غير المعروف: ${left.length}`);
