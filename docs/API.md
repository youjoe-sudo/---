# واجهة API المحلية — عقد التكامل (حقيقي، غير وهمي)

الخادم: `http://127.0.0.1:5199` (في وضع التطوير يمرّ الطلب عبر بروكسي Vite على نفس المسار `/api`).
جميع الاستجابات JSON. جميع الأخطاء: `{ ok:false, error:"رسالة عربية" }` مع كود مناسب.

---

## GET /api/health
```json
{ "ok": true, "version": "1.0.0", "dataDir": "C:\\...\\data", "now": "2026-10-27T12:00:00.000Z",
  "stats": { "students": 0, "classes": 0, "imports": 0, "attendanceDays": 0 } }
```

## GET /api/meta
```json
{ "ok": true,
  "directorate": "مديري التربية والتعليم بالشرقية",
  "administration": "غـرب الزقازيق",
  "schools": [ { "id": "sch_default", "name": "فصول ملحقة بنايوس الثانوية المشتركة", "directorate": "...", "administration": "...", "active": true } ],
  "classes": [ { "id": "cls_...", "schoolId": "sch_default", "stage": "الصف الأول الثانوي", "grade": "1", "section": "1", "name": "1 / 1", "studentCount": 50, "sourceFile": "تقرير قوائم الفصول (85).pdf", "importedAt": "..." } ],
  "siteUrl": "",
  "excelTemplateVerified": false
}
```

---

## GET /api/students?query=&classId=&needsReview=&limit=&offset=
- `query`: بحث حرّ (اسم الطالب أو الكود) — يطابق جزئيًا.
- `needsReview`: `true` يعيد السجلات غير المؤكدة فقط.
- الافتراضي `limit=50`.

**استجابة**
```json
{ "ok": true, "total": 0, "results": [ {
    "id": "stu_...", "studentCode": "472776652", "fullName": "أحمد محمد علي",
    "classId": "cls_...", "classLabel": "1 / 1", "schoolId": "sch_default",
    "stage": "الصف الأول الثانوي", "grade": "1", "section": "1",
    "active": true, "verificationStatus": "verified",
    "reviewNotes": [], "createdAt": "...", "updatedAt": "...",
    "source": { "file": "تقرير قوائم الفصول (85).pdf", "page": 1, "importedAt": "..." } } ] }
```
`verificationStatus` ∈ `"verified"` | `"needs_review"`.

## POST /api/students
الجسم: كائن طالب (id اختياري — يحدّث موجودًا). استجابة `{ ok:true, student, created:boolean }`.

---

## POST /api/pdf/extract
الجسم: `{ "fileName": "تقرير قوائم الفصول (85).pdf", "data": "<base64>" }`
> حجم مسموح حتى 25MB.

**استجابة**
```json
{ "ok": true, "fileName": "...", "pages": 1,
  "header": { "directorate":"...", "administration":"...", "school":"...", "stage":"...",
              "grade":"1", "section":"1", "className":"1 / 1", "totalStudents": 50,
              "date":"10/26/2026", "academicYear":"2026 / 2027" },
  "rows": [ { "index":0, "studentCode":"472776652", "fullName":"...",
              "cells":[ { "kind":"code","text":"472776652","x0":500,"x1":560 },
                        { "kind":"name","text":"...","x0":300,"x1":480} ],
              "needsReview": false, "reviewNotes": [] } ],
  "warnings": [ "لم يتمكن النظام من قراءة كود الطالب في السطر رقم 3" ],
  "unmapped": [ { "font": "/ABCDEE+Segoe UI", "gid": 3941, "count": 7 } ],
  "duplicatesInFile": [ { "studentCode": "...", "rows":[0,5] } ]
}
```
- **لا يُرسل أي ادعاء نجاح غير مُتحقق منه.** أي صفّ بلا كود ⇒ `needsReview:true` + `reviewNotes`.
- `fullName` قد يحتوي `�` لرمز غير معروف ⇒ يُفضَّل تعليمه `needsReview:true`.

## POST /api/pdf/confirm
الجسم:
```json
{ "fileName":"...", "header":{...}, "rows":[...], "classId":"cls_...", "mode":"merge" }
```
- `mode`: `"merge"` (الافتراضي — لا يحذف شيئًا) | `"create_class"` (ينشئ صنفًا جديدًا من header).

**استجابة**
```json
{ "ok": true, "importId":"imp_...", "added":12, "updated":3, "skipped":0,
  "needsReview": 2,
  "conflicts": [ { "studentCode":"...", "field":"fullName", "existing":"...", "incoming":"...", "studentId":"stu_..." } ],
  "classId":"cls_..." }
```

## GET /api/imports
```json
{ "ok": true, "history": [ { "id":"imp_...", "fileName":"...", "importedAt":"...",
    "classId":"...", "classLabel":"1 / 1", "added":0, "updated":0, "skipped":0,
    "needsReview":0, "conflicts":0, "pages":1 } ] }
```

---

## GET /api/attendance/day?date=2026-10-27
```json
{ "ok": true, "date":"2026-10-27",
  "classes": [ { "classId":"cls_...", "classLabel":"1 / 1", "stage":"...", "grade":"1", "section":"1",
                 "selectedCount": 3, "selected": [ { "id":"stu_...", "studentCode":"...", "fullName":"..." } ] } ],
  "export": { "exportedAt":"...", "path":"...", "fileName":"...", "rowCount": 0 },
  "automation": null }
```

## POST /api/attendance/select
الجسم: `{ "date":"2026-10-27", "classId":"cls_...", "studentIds":["stu_..."] }`
استبدال القائمة المحددة لهذا الصف/التاريخ. استجابة `{ ok:true, date, classId, count }`.

## GET /api/attendance/report?date=&classId=
```json
{ "ok": true, "date":"...", "classId":"...",
  "students": [ { "id":"stu_...","studentCode":"...","fullName":"...","selected":true } ] }
```

## POST /api/attendance/export
الجسم: `{ "date":"2026-10-27", "classId":"cls_...", "allClasses": false }`
استجابة:
```json
{ "ok": true, "path":"C:\\...\\exports\\غياب_2026-10-27_1-1.xlsx",
  "fileName":"...", "rowCount": 3,
  "columns": ["كود الطالب","الصف","اسم الطالب","الفصل","عدد أيام الغياب"] }
```
> الأعمدة بالضبط وبالترتيب: `كود الطالب | الصف | اسم الطالب | الفصل | عدد أيام الغياب`، و`عدد أيام الغياب` = `1`. ورقة واحدة فقط، لا أعمدة إضافية.

## GET /api/exports/latest → `{ ok, file: { path, fileName, size, createdAt } }` أو `{ ok:false }`
## GET /api/exports/download?date=&classId= → تنزيل ملف XLSX (octet-stream).

---

## GET /api/settings
```json
{ "ok": true, "settings": {
    "siteUrl": "", "siteName": "",
    "browser": "msedge", "headless": false, "timeoutMs": 45000,
    "manualFallback": true, "openDevTools": false,
    "exportDir": "", "autoExportBeforeRun": true } }
```
## POST /api/settings → `{ ok:true, settings }`

---

## POST /api/automation/run
الجسم: `{ "date":"2026-10-27", "classId":"cls_...", "export": true }`

**استجابة (لا تصرّف "نجاح" دون دليل مُتحقق منه)**
```json
{ "ok": true, "status": "success | needs_manual | blocked_captcha | missing_url | error | partial",
  "message": "رسالة عربية واضحة",
  "steps": [ { "step":"فتح الموقع", "ok":true, "detail":"...", "at":"..." } ],
  "evidence": [ { "type":"screenshot", "path":"C:\\...\\evidence\\....png", "at":"..." } ],
  "startedAt":"...", "finishedAt":"...", "durationMs": 0,
  "excelPath":"..." }
```
- `missing_url`: لم يُضبط رابط الموقع بعد ⇒ واجهة المستخدم تعرض حقلًا للكتابة.
- `blocked_captcha`: رُصد اختبار روبوت ⇒ **لا يتجاوزه**، يُسلّم للمستخدم.
- `error`/`needs_manual`: يحتفظ باللقطات والسجلات.

## GET /api/automation/status → آخر نتيجة (نفس الشكل) أو `{ ok:true, status:"idle" }`

## GET /api/logs?limit=200 → `{ ok:true, logs:[ { at, level, message } ] }`

---

## ملفات البيانات (في `data/`)
`students.json`، `schools.json`، `classes.json`، `attendance.json`، `settings.json`، `import_history.json`
- كتابة ذرّية (tmp + rename) + نسخة احتياطية في `data/backups/`.
- لا تُخزَّن بيانات اعتماد. لا تُحذف بيانات عند إعادة الاستيراد.
