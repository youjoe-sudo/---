import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAttendanceWorkbook, verifyWorkbook, COLUMNS, ABSENCE_DAYS } from '../server/excel.mjs';

test('ملف Excel: أعمدة بالضبط الخمسة المطلوبة وترتيبها صحيح', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-'));
  process.env.APP_EXPORT_DIR = dir;

  const built = await buildAttendanceWorkbook({
    date: '2026-10-28',
    className: '1 / 1',
    grade: 'الأول',
    section: '1 / 1',
    students: [
      { studentCode: '472776652', fullName: 'طالب تجريبي أول' },
      { studentCode: '476267959', fullName: 'طالب تجريبي ثانٍ' },
    ],
  });

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(built.path);

  assert.equal(wb.worksheets.length, 1, 'يجب ألا يحتوي الملف إلا على ورقة واحدة');

  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values || []).slice(1).map((v) => String(v ?? '').trim());
  assert.deepEqual(header, COLUMNS);
  assert.deepEqual(header, ['كود الطالب', 'الصف', 'اسم الطالب', 'الفصل', 'عدد أيام الغياب']);
  assert.equal(ws.columns.length, 5, 'لا يجوز أن يكون هناك أعمدة إضافية');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ملف Excel: كود الطالب مخزَّن نصاً وعدد أيام الغياب = 1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-'));
  process.env.APP_EXPORT_DIR = dir;

  const code = '004727766'; // يبدأ بصفر — لا يجوز أن يتحوّل إلى رقم
  const built = await buildAttendanceWorkbook({
    date: '2026-10-28',
    className: '1 / 1',
    grade: 'الأول',
    section: '1 / 1',
    students: [{ studentCode: code, fullName: 'طالب تجريبي' }],
  });

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(built.path);
  const ws = wb.worksheets[0];

  const cell = ws.getRow(2).getCell(1);
  assert.equal(typeof cell.value, 'string', 'كود الطالب يجب أن يكون نصاً في الملف النهائي');
  assert.equal(cell.value, code, 'يجب الحفاظ على الأصفار البادئة');
  assert.equal(cell.numFmt, '@', 'تنسيق الخلية يجب أن يكون نصياً (Text)');
  assert.equal(ws.getRow(2).getCell(5).value, ABSENCE_DAYS);
  assert.equal(ABSENCE_DAYS, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ملف Excel: تحقق ذاتي يقبل الملف السليم ويرفض الملف المعدَّل', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-'));
  process.env.APP_EXPORT_DIR = dir;

  const built = await buildAttendanceWorkbook({
    date: '2026-10-28',
    className: '1 / 1',
    grade: 'الأول',
    section: '1 / 1',
    students: [{ studentCode: '12345678', fullName: 'طالب تجريبي' }],
  });

  const ok = await verifyWorkbook(built.path);
  assert.equal(ok.ok, true, `الملف المُنتَج يجب أن يجتز التحقق: ${ok.reason}`);
  assert.deepEqual(ok.columns, COLUMNS);

  // نُفسد الملف: نضيف ورقة ثانية ونعيد التحقق — يجب أن يُرفض
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(built.path);
  wb.addWorksheet('ورقة زائدة');
  await wb.xlsx.writeFile(built.path);

  const bad = await verifyWorkbook(built.path);
  assert.equal(bad.ok, false, 'الملف الذي يحتوي على ورقة زائدة يجب أن يُرفض');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ملف Excel: اسم ورقة العمل صالح في Excel (لا يحتوي محظورات)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-'));
  process.env.APP_EXPORT_DIR = dir;

  const built = await buildAttendanceWorkbook({
    date: '2026-10-28',
    className: 'فصل 1 / 2: مسار؟ *بديل*', // اسم يحتوي محظورات
    grade: 'الأول',
    section: '1 / 2',
    students: [],
  });

  assert.ok(!/[:\\/?*[\]]/.test(path.basename(built.path)), 'اسم الملف لا يحتوي محظورات');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(built.path);
  const sheetName = wb.worksheets[0].name;
  assert.ok(!/[:\\/?*[\]]/.test(sheetName), `اسم ورقة العمل غير صالح: ${sheetName}`);
  assert.ok(sheetName.length <= 31);

  fs.rmSync(dir, { recursive: true, force: true });
});
