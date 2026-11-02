import { useRef, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  FileUp,
  History,
  RefreshCw,
  Save,
  Table2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { apiGet, apiPost, fileToBase64, formatDateTime, toErrorMessage } from '../api';
import { Badge, StatusBanner } from '../components/Badge';
import { Card, EmptyState, ErrorState, Loading, PageHeader } from '../components/States';
import { useResource, type Resource } from '../hooks';
import type {
  ImportMode,
  ImportsResponse,
  MetaResponse,
  PdfConfirmResponse,
  PdfExtractResponse,
  PdfRow,
} from '../types';

const MAX_BYTES = 25 * 1024 * 1024;

export function PdfImport({ meta }: { meta: Resource<MetaResponse> }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extract, setExtract] = useState<PdfExtractResponse | null>(null);
  const [rows, setRows] = useState<PdfRow[]>([]);

  const [classId, setClassId] = useState('');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [result, setResult] = useState<PdfConfirmResponse | null>(null);

  const imports = useResource<ImportsResponse>(() => apiGet<ImportsResponse>('/imports'), []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setExtract(null);
    setRows([]);
    setResult(null);
    setConfirmError(null);
    setExtractError(null);

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setExtractError('يرجى اختيار ملف PDF فقط.');
      setFileName('');
      return;
    }
    if (file.size > MAX_BYTES) {
      setExtractError('حجم الملف يتجاوز الحد المسموح (25MB).');
      setFileName('');
      return;
    }

    setFileName(file.name);
    setExtracting(true);
    try {
      const data = await fileToBase64(file);
      const response = await apiPost<PdfExtractResponse>('/pdf/extract', {
        fileName: file.name,
        data,
      });
      setExtract(response);
      setRows(response.rows);
    } catch (err) {
      setExtractError(toErrorMessage(err));
    } finally {
      setExtracting(false);
    }
  }

  function updateRow(index: number, field: 'studentCode' | 'fullName', value: string) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async function confirmImport() {
    if (!extract) return;
    if (mode === 'merge' && !classId) {
      setConfirmError('اختر الصف المستهدف قبل تأكيد الاستيراد.');
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    try {
      const response = await apiPost<PdfConfirmResponse>('/pdf/confirm', {
        fileName: extract.fileName,
        header: extract.header,
        rows,
        classId,
        mode,
      });
      setResult(response);
      imports.reload();
      meta.reload();
    } catch (err) {
      setConfirmError(toErrorMessage(err));
    } finally {
      setConfirming(false);
    }
  }

  const duplicateCodes = new Set((extract?.duplicatesInFile ?? []).map((d) => d.studentCode));
  const reviewCount = rows.filter((r) => r.needsReview).length;

  return (
    <div className="page">
      <PageHeader
        title="استيراد كشف PDF"
        subtitle="اقرأ الملف، راجع الصفوف وعدّلها، ثم أكّد الاستيراد إلى الصنف المختار"
      />

      <Card title="١ — اختيار ملف الكشف" icon={<FileUp size={17} aria-hidden="true" />}>
        <div className="file-picker">
          <input
            ref={fileInputRef}
            id="pdf-file"
            type="file"
            accept=".pdf,application/pdf"
            className="file-input"
            onChange={(e) => {
              const picked = e.target.files ? e.target.files[0] : undefined;
              void handleFile(picked);
            }}
          />
          <label htmlFor="pdf-file" className="btn btn-primary">
            <Upload size={16} aria-hidden="true" />
            اختيار ملف PDF
          </label>
          <span className="file-name">{fileName || 'لم يتم اختيار ملف بعد'}</span>
        </div>
        <p className="muted small">
          يُرسل الملف إلى الخادم المحلي عبر <span className="mono" dir="ltr">POST /api/pdf/extract</span> بحجم
          أقصى 25MB. لا تُعرض أي بيانات غير موجودة في الملف.
        </p>

        {extracting ? <Loading label="جارٍ قراءة الملف واستخراج الصفوف…" /> : null}
        {extractError ? <StatusBanner tone="danger" title="تعذّر استخراج البيانات">{extractError}</StatusBanner> : null}
      </Card>

      {extract ? (
        <>
          <Card title="٢ — الحقول المقروءة من الملف" icon={<Table2 size={17} aria-hidden="true" />}>
            <dl className="kv">
              <div>
                <dt>اسم الملف</dt>
                <dd>{extract.fileName}</dd>
              </div>
              <div>
                <dt>عدد الصفحات</dt>
                <dd>{extract.pages}</dd>
              </div>
              <div>
                <dt>المديرية</dt>
                <dd>{extract.header.directorate || '—'}</dd>
              </div>
              <div>
                <dt>الإدارة</dt>
                <dd>{extract.header.administration || '—'}</dd>
              </div>
              <div>
                <dt>المدرسة</dt>
                <dd>{extract.header.school || '—'}</dd>
              </div>
              <div>
                <dt>المرحلة / الصف / الفصل</dt>
                <dd>
                  {extract.header.stage || '—'} / {extract.header.grade || '—'} / {extract.header.section || '—'}
                </dd>
              </div>
              <div>
                <dt>اسم الصنف</dt>
                <dd>{extract.header.className || '—'}</dd>
              </div>
              <div>
                <dt>عدد الطلاب في الترويسة</dt>
                <dd>{extract.header.totalStudents ?? '—'}</dd>
              </div>
              <div>
                <dt>تاريخ الكشف</dt>
                <dd dir="ltr" className="mono">
                  {extract.header.date || '—'}
                </dd>
              </div>
              <div>
                <dt>العام الدراسي</dt>
                <dd dir="ltr" className="mono">
                  {extract.header.academicYear || '—'}
                </dd>
              </div>
            </dl>

            {extract.warnings.length > 0 ? (
              <div className="notice notice-warn">
                <p className="notice-title">
                  <TriangleAlert size={15} aria-hidden="true" /> تنبيهات القراءة ({extract.warnings.length})
                </p>
                <ul className="list">
                  {extract.warnings.map((w, i) => (
                    <li key={`warn-${String(i)}`}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="muted">لا توجد تنبيهات في هذه القراءة.</p>
            )}

            {extract.duplicatesInFile.length > 0 ? (
              <div className="notice notice-danger">
                <p className="notice-title">
                  <CircleAlert size={15} aria-hidden="true" /> أكواد مكرّرة داخل الملف
                </p>
                <ul className="list">
                  {extract.duplicatesInFile.map((d) => (
                    <li key={`dup-${d.studentCode}`}>
                      الكود <span className="mono" dir="ltr">{d.studentCode}</span> يظهر في الصفوف:{' '}
                      {d.rows.map((r) => String(r + 1)).join('، ')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {extract.unmapped.length > 0 ? (
              <div className="notice notice-info">
                <p className="notice-title">
                  <CircleAlert size={15} aria-hidden="true" /> محارف غير معروفة (unmapped) — لم يتم تمثيلها
                </p>
                <div className="table-wrap">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th scope="col">الخط (font)</th>
                        <th scope="col">gid</th>
                        <th scope="col">عدد التكرار</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extract.unmapped.map((u) => (
                        <tr key={`${u.font}-${String(u.gid)}`}>
                          <td className="mono" dir="ltr">
                            {u.font}
                          </td>
                          <td className="mono" dir="ltr">
                            {String(u.gid)}
                          </td>
                          <td>{u.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </Card>

          <Card
            title={`٣ — الصفوف المستخرجة (${rows.length})`}
            icon={<Table2 size={17} aria-hidden="true" />}
            action={
              reviewCount > 0 ? (
                <Badge tone="warn" icon={<TriangleAlert size={13} aria-hidden="true" />}>
                  {reviewCount} صف يحتاج مراجعة
                </Badge>
              ) : (
                <Badge tone="ok" icon={<CircleCheck size={13} aria-hidden="true" />}>
                  لا حاجة للمراجعة
                </Badge>
              )
            }
          >
            {rows.length === 0 ? (
              <EmptyState title="لم يستخرج النظام أي صف من الملف" hint="تحقق من الملف أو راجع التنبيهات أعلاه." />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">كود الطالب</th>
                        <th scope="col">اسم الطالب</th>
                        <th scope="col">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={`row-${String(row.index)}-${String(i)}`} className={row.needsReview ? 'row-review' : undefined}>
                          <td className="muted">{row.index + 1}</td>
                          <td>
                            <input
                              type="text"
                              className="input input-code"
                              dir="ltr"
                              value={row.studentCode}
                              aria-label={`كود الطالب في الصف ${String(row.index + 1)}`}
                              onChange={(e) => updateRow(i, 'studentCode', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="input"
                              value={row.fullName}
                              aria-label={`اسم الطالب في الصف ${String(row.index + 1)}`}
                              onChange={(e) => updateRow(i, 'fullName', e.target.value)}
                            />
                            {row.reviewNotes.length > 0 ? (
                              <ul className="review-notes">
                                {row.reviewNotes.map((note, n) => (
                                  <li key={`note-${String(row.index)}-${String(n)}`}>
                                    <TriangleAlert size={13} aria-hidden="true" /> {note}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                          <td>
                            <div className="stack-xs">
                              {row.needsReview ? (
                                <Badge tone="warn" icon={<TriangleAlert size={13} aria-hidden="true" />}>
                                  يحتاج مراجعة
                                </Badge>
                              ) : (
                                <Badge tone="ok" icon={<CircleCheck size={13} aria-hidden="true" />}>
                                  سليم
                                </Badge>
                              )}
                              {duplicateCodes.has(row.studentCode) ? (
                                <Badge tone="danger" icon={<CircleAlert size={13} aria-hidden="true" />}>
                                  كود مكرّر في الملف
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted small">
                  يمكنك تحرير «اسم الطالب» و«كود الطالب» قبل التأكيد — القيم المكتوبة هي التي ستُرسل إلى الخادم.
                </p>
              </>
            )}
          </Card>

          <Card title="٤ — تأكيد الاستيراد" icon={<Save size={17} aria-hidden="true" />}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="target-class">الصف المستهدف</label>
                <select
                  id="target-class"
                  className="select"
                  value={classId}
                  disabled={mode === 'create_class'}
                  onChange={(e) => setClassId(e.target.value)}
                >
                  <option value="">— اختر الصف —</option>
                  {meta.data?.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.stage} ({c.studentCount} طالب)
                    </option>
                  ))}
                </select>
                {meta.loading ? <p className="muted small">جارٍ تحميل الأصناف…</p> : null}
                {meta.error ? <p className="field-error">{meta.error}</p> : null}
              </div>
              <div className="field">
                <label htmlFor="import-mode">طريقة الدمج</label>
                <select
                  id="import-mode"
                  className="select"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ImportMode)}
                >
                  <option value="merge">دمج (لا يحذف أي بيانات)</option>
                  <option value="create_class">إنشاء صنف جديد من ترويسة الملف</option>
                </select>
              </div>
            </div>

            {confirmError ? (
              <StatusBanner tone="danger" title="تعذّر تأكيد الاستيراد">
                {confirmError}
              </StatusBanner>
            ) : null}

            <div className="actions-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={confirming || extracting || rows.length === 0}
                onClick={() => void confirmImport()}
              >
                {confirming ? <RefreshCw className="spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                {confirming ? 'جارٍ الحفظ…' : 'تأكيد الاستيراد'}
              </button>
            </div>

            {result ? (
              <div className="result-card">
                <p className="result-title">
                  <CircleCheck size={18} aria-hidden="true" /> تم تنفيذ عملية الاستيراد
                </p>
                <div className="result-grid">
                  <ResultStat label="مُضاف" value={result.added} tone="ok" />
                  <ResultStat label="مُحدَّث" value={result.updated} tone="info" />
                  <ResultStat label="مُتجاوَز" value={result.skipped} tone="muted" />
                  <ResultStat label="يحتاج مراجعة" value={result.needsReview} tone="warn" />
                  <ResultStat label="تعارضات" value={result.conflicts.length} tone="danger" />
                </div>

                {result.conflicts.length > 0 ? (
                  <div className="table-wrap">
                    <table className="table table-compact">
                      <thead>
                        <tr>
                          <th scope="col">الكود</th>
                          <th scope="col">الحقل</th>
                          <th scope="col">القيمة الحالية</th>
                          <th scope="col">القيمة الواردة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.conflicts.map((c, i) => (
                          <tr key={`conflict-${c.studentCode}-${c.field}-${String(i)}`}>
                            <td className="mono" dir="ltr">
                              {c.studentCode}
                            </td>
                            <td>{c.field}</td>
                            <td>{c.existing}</td>
                            <td>{c.incoming}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">لا توجد تعارضات بين البيانات الحالية والواردة.</p>
                )}
              </div>
            ) : null}
          </Card>
        </>
      ) : extractError ? null : extract === null && !extracting ? (
        <Card title="المعاينة" icon={<Table2 size={17} aria-hidden="true" />}>
          <EmptyState
            title="لم يتم تحميل أي ملف بعد"
            hint="اختر ملف كشف الحضور والغياب بصيغة PDF لتظهر هنا الترويسة والصفوف المستخرجة."
          />
        </Card>
      ) : null}

      <Card
        title="سجل الاستيراد"
        icon={<History size={17} aria-hidden="true" />}
        action={
          <button type="button" className="btn btn-ghost btn-sm" onClick={imports.reload}>
            <RefreshCw size={15} aria-hidden="true" /> تحديث
          </button>
        }
      >
        {imports.loading ? (
          <Loading label="جارٍ تحميل سجل الاستيراد…" />
        ) : imports.error ? (
          <ErrorState message={imports.error} onRetry={imports.reload} />
        ) : imports.data && imports.data.history.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">الملف</th>
                  <th scope="col">الصف</th>
                  <th scope="col">التاريخ</th>
                  <th scope="col">صفحات</th>
                  <th scope="col">مُضاف</th>
                  <th scope="col">مُحدَّث</th>
                  <th scope="col">مُتجاوَز</th>
                  <th scope="col">مراجعة</th>
                  <th scope="col">تعارضات</th>
                </tr>
              </thead>
              <tbody>
                {imports.data.history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.fileName}</td>
                    <td>{item.classLabel}</td>
                    <td>{formatDateTime(item.importedAt)}</td>
                    <td>{item.pages}</td>
                    <td>{item.added}</td>
                    <td>{item.updated}</td>
                    <td>{item.skipped}</td>
                    <td>{item.needsReview}</td>
                    <td>{item.conflicts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="لا توجد عمليات استيراد مسجّلة بعد" hint="سيظهر هنا كل ملف تؤكده." />
        )}
      </Card>
    </div>
  );
}

function ResultStat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'info' | 'warn' | 'danger' | 'muted' }) {
  return (
    <div className={`result-stat result-stat-${tone}`}>
      <span className="result-value">{value}</span>
      <span className="result-label">{label}</span>
    </div>
  );
}
