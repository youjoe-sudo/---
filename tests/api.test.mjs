import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, api } from './helpers.mjs';

test('مسار العمل الكامل عبر الـ API (بيانات اصطناعية فقط)', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  /* 1) الصحة + التهيئة */
  const health = await api(srv.base, 'GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.ok(health.json.dataDir.includes(srv.dataDir), 'يجب استخدام مجلد البيانات المؤقت في الاختبارات');
  assert.equal(health.json.stats.students, 0, 'لا توجد بيانات وهمية عند بدء التشغيل');
  assert.equal(health.json.stats.classes, 0);

  const meta = await api(srv.base, 'GET', '/api/meta');
  assert.equal(meta.json.ok, true);
  assert.ok(meta.json.schools.length >= 1, 'تُهيَّأ مدرسة واحدة من تقارير القوائم المصدر');
  assert.equal(meta.json.excelTemplateVerified, false, 'لا يُعلَن التحقق قبل تحقق فعلي');

  /* 2) إنشاء صنف */
  const cls = await api(srv.base, 'POST', '/api/classes', {
    stage: 'ثانوى عام', grade: 'الأول', section: '1 / 1', name: '1 / 1',
  });
  assert.equal(cls.status, 200);
  assert.equal(cls.json.created, true);
  const classId = cls.json.class.id;

  /* 3) إضافة طلاب */
  const add = await api(srv.base, 'POST', '/api/students', { classId, studentCode: '472776652', fullName: 'طالب تجريبي أول' });
  assert.equal(add.json.created, true);
  await api(srv.base, 'POST', '/api/students', { classId, studentCode: '476267959', fullName: 'طالب تجريبي ثانٍ' });

  const bad = await api(srv.base, 'POST', '/api/students', { classId, studentCode: '12', fullName: 'كود قصير' });
  assert.equal(bad.status, 400, 'يجب رفض كود غير صالح');
  assert.match(bad.json.error, /كود الطالب/);

  /* 4) البحث بالاسم وبالكود */
  const byName = await api(srv.base, 'GET', `/api/students?query=${encodeURIComponent('تجريبي')}&limit=10`);
  assert.equal(byName.json.total, 2);

  const byCode = await api(srv.base, 'GET', '/api/students?query=4727');
  assert.equal(byCode.json.total, 1);
  assert.equal(byCode.json.results[0].studentCode, '472776652');

  /* 5) تسجيل غياب اليوم */
  const date = '2026-10-28';
  const all = await api(srv.base, 'GET', `/api/students?classId=${classId}&limit=100`);
  const pick = [all.json.results[0].id];

  const sel = await api(srv.base, 'POST', '/api/attendance/select', { date, classId, studentIds: pick });
  assert.equal(sel.json.count, 1);

  const day = await api(srv.base, 'GET', `/api/attendance/day?date=${date}`);
  assert.equal(day.json.classes[0].selectedCount, 1);
  assert.equal(day.json.classes[0].classLabel, '1 / 1');

  /* 6) التصدير وإعادة قراءة الملف للتحقق */
  const exp = await api(srv.base, 'POST', '/api/attendance/export', { date, classId });
  assert.equal(exp.status, 200, exp.json?.error);
  assert.equal(exp.json.rowCount, 1);
  assert.equal(exp.json.verified, true);
  assert.deepEqual(exp.json.columns, ['كود الطالب', 'الصف', 'اسم الطالب', 'الفصل', 'عدد أيام الغياب']);

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(exp.json.path);
  assert.equal(wb.worksheets.length, 1);
  const ws = wb.worksheets[0];
  assert.deepEqual((ws.getRow(1).values || []).slice(1), exp.json.columns);
  assert.equal(typeof ws.getRow(2).getCell(1).value, 'string');
  assert.equal(ws.getRow(2).getCell(5).value, 1);

  /* 7) بعد التحقق الفعلي يُضبط علم التحقق في الإعدادات */
  const settings = await api(srv.base, 'GET', '/api/settings');
  assert.equal(settings.json.settings.excelTemplateVerified, true);

  /* 8) التنزيل يعيد ملف فعلي */
  const dl = await fetch(`${srv.base}/api/exports/download?date=${date}&classId=${classId}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-type'), /spreadsheetml/);
  const buf = Buffer.from(await dl.arrayBuffer());
  assert.ok(buf.length > 500, 'ملف التنزيل غير فارغ');
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', 'XLSX هو ملف ZIP');

  /* 9) الأتمتة بلا رابط موقع تُعيد حالة صادقة (لا ادعاء نجاح) */
  const auto = await api(srv.base, 'POST', '/api/automation/run', { date, classId, export: false });
  assert.equal(auto.json.status, 'missing_url');
  assert.equal(auto.json.ok, false);
  assert.match(auto.json.message, /رابط/);

  const status = await api(srv.base, 'GET', '/api/automation/status');
  assert.equal(status.json.status, 'missing_url');

  /* 10) السجلات تُدوِّن ما حدث فعلاً */
  const logs = await api(srv.base, 'GET', '/api/logs?limit=50');
  assert.ok(logs.json.logs.length > 0);
  assert.ok(logs.json.logs.some((l) => l.message.includes('صُدِّر ملف Excel')));
});

test('سجلات غير مكتملة تمنع التصدير حتى التأكيد الصريح', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const cls = await api(srv.base, 'POST', '/api/classes', { grade: 'الأول', section: '1 / 1', name: '1 / 1' });
  const classId = cls.json.class.id;
  const date = '2026-10-28';

  // طالب سليم يُضاف عبر الواجهة
  await api(srv.base, 'POST', '/api/students', { classId, studentCode: '472776652', fullName: 'طالب سليم' });

  // سجل ناقص يصل من استيراد كشف (كود غير مقروء بثقة) — يجب أن يُخزَّن معلَّماً للمراجعة
  const confirmed = await api(srv.base, 'POST', '/api/pdf/confirm', {
    fileName: 'hand-edited.pdf',
    header: { className: '1 / 1', stage: 'ثانوى عام', grade: 'الأول', section: '1 / 1' },
    rows: [{
      index: 1, page: 1, studentCode: '', fullName: 'طالب بلا كود',
      needsReview: true, reviewNotes: ['تعذّر قراءة كود الطالب بثقة'],
    }],
    classId,
    mode: 'merge',
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.needsReview, 1, 'السجل الناقص يجب أن يُعلَّم للمراجعة');

  const review = await api(srv.base, 'GET', '/api/students?needsReview=true');
  assert.equal(review.json.total, 1);
  assert.equal(review.json.results[0].studentCode, '');

  const all = await api(srv.base, 'GET', `/api/students?classId=${classId}&limit=100`);
  const ids = all.json.results.map((s) => s.id);
  await api(srv.base, 'POST', '/api/attendance/select', { date, classId, studentIds: ids });

  // السجل غير الموثّق يمنع التصدير
  const blocked = await api(srv.base, 'POST', '/api/attendance/export', { date, classId });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.ok, false);
  assert.ok(Array.isArray(blocked.json.unconfirmed) && blocked.json.unconfirmed.length > 0,
    'يجب إعادة قائمة السجلات غير المؤكدة');

  // مع التأكيد الصريح يُسمح
  const forced = await api(srv.base, 'POST', '/api/attendance/export', { date, classId, confirmIncomplete: true });
  assert.equal(forced.status, 200);
  assert.equal(forced.json.rowCount, ids.length);
});

test('استيراد PDF مكرر لا يُضيف ولا يحذف شيئاً', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const { makeSyntheticPdf } = await import('./helpers.mjs');
  const bytes = await makeSyntheticPdf([
    { code: '472776652', name: 'ALPHA ONE' },
    { code: '476267959', name: 'BETA TWO' },
  ]);

  const extract = await api(srv.base, 'POST', '/api/pdf/extract', {
    fileName: 'synthetic.pdf', data: bytes.toString('base64'),
  });
  assert.equal(extract.json.ok, true);
  assert.equal(extract.json.rows.length, 2);

  const first = await api(srv.base, 'POST', '/api/pdf/confirm', {
    fileName: 'synthetic.pdf',
    header: { ...extract.json.header, className: '1 / 1' },
    rows: extract.json.rows,
    mode: 'create_class',
  });
  assert.equal(first.json.added, 2);
  const classId = first.json.classId;

  const second = await api(srv.base, 'POST', '/api/pdf/confirm', {
    fileName: 'synthetic.pdf',
    header: { ...extract.json.header, className: '1 / 1' },
    rows: extract.json.rows,
    classId,
    mode: 'merge',
  });
  assert.equal(second.json.added, 0, 'لا يُضاف طالب موجود مسبقاً');
  assert.equal(second.json.updated, 2);

  const after = await api(srv.base, 'GET', `/api/students?classId=${classId}&limit=100`);
  assert.equal(after.json.total, 2, 'لا تكرار ولا حذف عند إعادة الاستيراد');

  const history = await api(srv.base, 'GET', '/api/imports');
  assert.ok(history.json.history.length >= 2, 'يُسجَّل تاريخ الاستيراد');
});

test('رفض الملفات غير الصالحة والطلبات الخاطئة', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const noData = await api(srv.base, 'POST', '/api/pdf/extract', {});
  assert.equal(noData.status, 400);
  assert.match(noData.json.error, /محتوى الملف/);

  const garbage = await api(srv.base, 'POST', '/api/pdf/extract', {
    fileName: 'x.pdf', data: Buffer.from('not a pdf at all').toString('base64'),
  });
  assert.equal(garbage.status, 400);
  assert.match(garbage.json.error, /PDF/);

  const emptyFile = await api(srv.base, 'POST', '/api/pdf/extract', {
    fileName: 'x.pdf', data: Buffer.alloc(0).toString('base64'),
  });
  assert.equal(emptyFile.status, 400);

  const badExport = await api(srv.base, 'POST', '/api/attendance/export', { date: '28/10/2026', classId: 'x' });
  assert.equal(badExport.status, 400);

  const badSelect = await api(srv.base, 'POST', '/api/attendance/select', { date: 'x', classId: 'y', studentIds: [] });
  assert.equal(badSelect.status, 400);

  const badSettings = await api(srv.base, 'POST', '/api/classes', {});
  assert.equal(badSettings.status, 400);
});

test('لا تُخزَّن بيانات اعتماد أبداً في الإعدادات', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const res = await api(srv.base, 'POST', '/api/settings', {
    siteUrl: 'http://127.0.0.1:1/',
    username: 'secret-user',
    password: 'secret-pass',
    credentials: { token: 'abc' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.settings.username, undefined);
  assert.equal(res.json.settings.password, undefined);
  assert.equal(res.json.settings.credentials, undefined);
  assert.equal(res.json.settings.siteUrl, 'http://127.0.0.1:1/');
});

test('الواجهة المبنية تُقدَّم على الجذر', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const res = await fetch(`${srv.base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<div id="root">/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /lang="ar"/);
});

test('تصفير البيانات يحذف الطلاب والأصناف ويحفظ الإعدادات والمدرسة', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  // جهّز بيانات: صنف + طالبان
  const cls = await api(srv.base, 'POST', '/api/classes', {
    stage: 'ثانوى عام', grade: 'الأول', section: '1 / 1', name: '1 / 1',
  });
  const classId = cls.json.class.id;
  await api(srv.base, 'POST', '/api/students', { classId, studentCode: '472776652', fullName: 'طالب تجريبي أول' });
  await api(srv.base, 'POST', '/api/students', { classId, studentCode: '476267959', fullName: 'طالب تجريبي ثانٍ' });
  await api(srv.base, 'POST', '/api/settings', { siteUrl: 'https://example.edu.eg' });

  const before = await api(srv.base, 'GET', '/api/health');
  assert.equal(before.json.stats.students, 2);

  // تأكيد ناقص → مرفوض
  const guarded = await api(srv.base, 'POST', '/api/admin/reset', {});
  assert.equal(guarded.status, 400, 'لا تصفير بلا تأكيد صريح');
  assert.match(guarded.json.error, /تأكيد/);

  const stillThere = await api(srv.base, 'GET', '/api/health');
  assert.equal(stillThere.json.stats.students, 2, 'الرفض لا يحذف شيئاً');

  // تصفير فعلي
  const done = await api(srv.base, 'POST', '/api/admin/reset', { confirm: 'RESET' });
  assert.equal(done.status, 200);
  assert.equal(done.json.removed.students, 2);
  assert.equal(done.json.removed.classes, 1);

  const after = await api(srv.base, 'GET', '/api/health');
  assert.equal(after.json.stats.students, 0);
  assert.equal(after.json.stats.classes, 0);
  assert.equal(after.json.stats.imports, 0);

  // الإعدادات والمدرسة محفوظة
  const settings = await api(srv.base, 'GET', '/api/settings');
  assert.equal(settings.json.settings.siteUrl, 'https://example.edu.eg');
  const meta = await api(srv.base, 'GET', '/api/meta');
  assert.ok(meta.json.schools.length >= 1, 'اسم المدرسة لا يُحذف');

  // نسخة احتياطية أُنشئت قبل الحذف
  const backups = fs.readdirSync(path.join(srv.dataDir, 'backups'));
  assert.ok(backups.some((b) => b.startsWith('students.')), 'يجب إنشاء نسخة احتياطية للطلاب');
});
