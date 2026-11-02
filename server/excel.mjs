/**
 * توليد ملف Excel لغياب الطلاب.
 *
 * قواعد صارمة متفق عليها مع نموذج مديرية شرقية:
 *  - الأعمدة بالضبط وبالترتيب: كود الطالب | الصف | اسم الطالب | الفصل | عدد أيام الغياب
 *  - ورقة واحدة فقط، لا أعمدة ولا أوراق إضافية.
 *  - عدد أيام الغياب = 1 دايماً.
 *  - كود الطالب يُخزَّن نصاً دائماً (تنسيق Text) حتى لا يحوّله Excel إلى رقم.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { EXPORT_DIR } from './store.mjs';

export const COLUMNS = ['كود الطالب', 'الصف', 'اسم الطالب', 'الفصل', 'عدد أيام الغياب'];
export const ABSENCE_DAYS = 1;

/** تنظيف اسم ورقة العمل (Excel يمنع : \ / ? * [ ]) */
function sanitizeSheetName(name) {
  const clean = String(name || 'ورقة1').replace(/[:\\/?*[\]]/g, '-').trim();
  return (clean || 'ورقة1').slice(0, 31);
}

function safeFilePart(name) {
  return String(name || '').replace(/[:\\/?*[\]<>|"]/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{ date: string, className: string, grade: string, section: string,
 *           students: Array<{ studentCode: string, fullName: string }> }} payload
 * @returns {Promise<{ path: string, fileName: string, rowCount: number, columns: string[] }>}
 */
export async function buildAttendanceWorkbook(payload) {
  const { date, className, students } = payload;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام متابعة الغياب اليومي';
  workbook.created = new Date();

  const sheetName = sanitizeSheetName(className || date);
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });

  // صف العناوين بالضبط كما هو مطلوب
  sheet.addRow(COLUMNS);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 12, name: 'Arial' };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 22;

  for (const s of students) {
    const row = sheet.addRow([
      String(s.studentCode ?? '').trim(),   // نص دائماً
      String(s.grade ?? payload.grade ?? '').trim(),
      String(s.fullName ?? '').trim(),
      String(s.section ?? payload.section ?? '').trim(),
      ABSENCE_DAYS,
    ]);
    // كود الطالب نصاً (تنسيق Text) — لا يُحوَّل أبداً إلى رقم
    row.getCell(1).numFmt = '@';
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(5).numFmt = '0';
    row.getCell(5).alignment = { horizontal: 'center' };
  }

  // عرض الأعمدة
  const widths = [16, 18, 42, 14, 18];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  const fileName = `غياب_${safeFilePart(date)}_${safeFilePart(className || 'غير-محدد')}.xlsx`;
  const target = path.join(EXPORT_DIR, fileName);
  await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
  await workbook.xlsx.writeFile(target);

  return {
    path: target,
    fileName,
    rowCount: students.length,
    columns: [...COLUMNS],
  };
}

/**
 * تحقّق فعلي من الملف المُنتَج (يعيد قراءته ويطابق صف العناوين والأعمدة).
 * لا يُعلَن "تم التحقق" إلا بعد هذه القراءة الفعلية.
 */
export async function verifyWorkbook(filePath) {
  const result = { ok: false, reason: '', columns: [], sheets: 0 };
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    result.sheets = wb.worksheets.length;
    if (wb.worksheets.length !== 1) {
      result.reason = `عدد الأوراق ${wb.worksheets.length} بدلاً من ورقة واحدة`;
      return result;
    }
    const sheet = wb.worksheets[0];
    const header = (sheet.getRow(1).values || []).slice(1).map((v) => String(v ?? '').trim());
    result.columns = header;
    if (header.length !== COLUMNS.length || header.some((v, i) => v !== COLUMNS[i])) {
      result.reason = `صف العناوين غير مطابق: ${header.join(' | ')}`;
      return result;
    }
    // التحقق من عمود الكود كنص
    const first = sheet.getRow(2);
    if (first) {
      const codeCell = first.getCell(1);
      if (typeof codeCell.value !== 'string' && codeCell.value != null) {
        result.reason = 'كود الطالب ليس مخزَّناً كنص في الملف';
        return result;
      }
    }
    result.ok = true;
    return result;
  } catch (e) {
    result.reason = `تعذّرت قراءة الملف للتحقق: ${e.message}`;
    return result;
  }
}
