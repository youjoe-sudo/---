import test from 'node:test';
import assert from 'node:assert/strict';
import { visualToLogical } from '../server/pdfExtractor.mjs';
import { makeSyntheticPdf } from './helpers.mjs';

test('تحويل الترتيب البصري إلى منطقي', () => {
  // النص العربي في الـ PDF يُرسم من اليسار إلى اليمين (بترتيب مقلوب) — يجب عكسه
  assert.equal(visualToLogical('نمحرلادب'), 'بدالرحمن');
  assert.equal(visualToLogical('نماث'), 'ثامن');
  assert.equal(visualToLogical('دمحم'), 'محمد');
  // النص اللاتيني/الرقمي لا يُعكس
  assert.equal(visualToLogical('olleh'), 'olleh');
  assert.equal(visualToLogical('472776652'), '472776652');
  assert.equal(visualToLogical(''), '');
});

test('استخراج صفوف من ملف PDF اصطناعي (بيانات وهمية اصطناعية)', async () => {
  const { extractPdf } = await import('../server/pdfExtractor.mjs');

  const synthetic = [
    { code: '472776652', name: 'ALPHA ONE' },
    { code: '476267959', name: 'BETA TWO' },
    { code: '474638570', name: 'GAMMA THREE' },
    { code: null, name: 'DELTA FOUR' },  // لا كود ولا اسم عربي -> لا يُحتسب طالباً
    { code: '469103997', name: null },   // كود بلا اسم -> يجب أن يُعلَّم للمراجعة
  ];
  const bytes = await makeSyntheticPdf(synthetic);
  const result = await extractPdf(bytes, 'synthetic.pdf');

  assert.equal(result.ok, true);
  // الصف بلا كود ولا اسم عربي لا يُحتسب سجلاً (تجنّب صفوف الشبكة)
  assert.equal(result.rows.length, 4, 'عدد الصفوف المستخرجة');

  const codes = result.rows.map((r) => r.studentCode);
  assert.equal(codes[0], '472776652');
  assert.equal(typeof codes[0], 'string', 'الكود يجب أن يبقى نصاً');
  assert.equal(codes[1], '476267959');
  assert.equal(codes[2], '474638570');
  assert.equal(codes[3], '469103997', 'يجب ألا يُحتسب الصف بلا كود');
  assert.ok(codes.every((c) => !c.includes('DELTA')), 'يجب ألّا يظهر اسم بلا كود كصف مستقل');

  // كل صف هنا اسمه غير عربي (خط قياسي لا يدعم العربية) -> يجب أن يُعلَّم للمراجعة
  assert.ok(result.rows.every((r) => r.needsReview === true), 'صفوف بلا اسم عربي تُعلَّم للمراجعة');
  assert.ok(result.rows.every((r) => r.reviewNotes.length > 0), 'يجب تدوين سبب المراجعة');
  assert.ok(result.rows[0].reviewNotes.some((n) => n.includes('اسم الطالب')));
  assert.ok(result.rows[3].reviewNotes.some((n) => n.includes('اسم الطالب')));
});

test('استخراج PDF تالف/فارغ يُعيد خطأ واضحاً بدل الانهيار', async () => {
  const { extractPdf } = await import('../server/pdfExtractor.mjs');
  await assert.rejects(() => extractPdf(Buffer.from('not a pdf at all'), 'bad.pdf'));
  await assert.rejects(() => extractPdf(Buffer.alloc(0), 'empty.pdf'));
});

test('ملف PDF حقيقي بلا صفوف لا يُعلن نجاحاً زائفاً', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const { extractPdf } = await import('../server/pdfExtractor.mjs');

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('no rows here', { x: 200, y: 400, size: 12, font });
  const bytes = Buffer.from(await doc.save());

  const result = await extractPdf(bytes, 'blank.pdf');
  assert.equal(result.ok, false, 'لا يجوز إعلان النجاح عند غياب الصفوف');
  assert.equal(result.rows.length, 0);
});

test('صفوف متعددة الصفحات تُستخرج كلها مع رقم الصفحة', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const { extractPdf } = await import('../server/pdfExtractor.mjs');

  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.CourierBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  const perPage = [
    ['111111111', 'STUDENT A'],
    ['222222222', 'STUDENT B'],
    ['333333333', 'STUDENT C'],
  ];
  perPage.forEach(([code, name], i) => {
    const page = doc.addPage([595, 842]);
    page.drawText(code, { x: 450, y: 700, size: 10, font: bold });
    page.drawText(name, { x: 120, y: 700, size: 10, font: reg });
  });

  const bytes = Buffer.from(await doc.save());
  const result = await extractPdf(bytes, 'multi.pdf');
  assert.equal(result.pages >= 3, true, 'يجب قراءة كل الصفحات');
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map((r) => r.studentCode), ['111111111', '222222222', '333333333']);
  assert.deepEqual(result.rows.map((r) => r.page), [1, 2, 3]);
});
