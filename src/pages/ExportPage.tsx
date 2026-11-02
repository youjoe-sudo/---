import { useState } from 'react';
import { Copy, Download, FileSpreadsheet, LoaderCircle, RefreshCw } from 'lucide-react';
import { apiGet, apiPost, buildQuery, copyText, formatDateTime, toErrorMessage, todayISO } from '../api';
import { StatusBanner } from '../components/Badge';
import { Card, EmptyState, ErrorState, Loading, PageHeader } from '../components/States';
import { useResource, type Resource } from '../hooks';
import type { ExportResponse, LatestExportFile, MetaResponse } from '../types';

export function ExportPage({ meta }: { meta: Resource<MetaResponse> }) {
  const [date, setDate] = useState(todayISO());
  const [classId, setClassId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const latest = useResource<LatestExportFile | null>(
    () =>
      apiGet<LatestExportFile>('/exports/latest').catch(() => null),
    [],
  );

  const allClasses = classId === '';

  async function createFile() {
    setCreating(true);
    setError(null);
    try {
      const response = await apiPost<ExportResponse>('/attendance/export', {
        date,
        classId,
        allClasses,
      });
      setResult(response);
      latest.reload();
    } catch (err) {
      setError(toErrorMessage(err));
      setResult(null);
    } finally {
      setCreating(false);
    }
  }

  const downloadHref = `/api/exports/download${buildQuery({ date, classId })}`;

  return (
    <div className="page">
      <PageHeader title="تصدير Excel" subtitle="إنشاء ملف الغياب بترتيب الأعمدة المعتمد ثم تنزيله" />

      <Card title="خيارات التصدير" icon={<FileSpreadsheet size={17} aria-hidden="true" />}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="export-date">التاريخ</label>
            <input
              id="export-date"
              type="date"
              className="input"
              dir="ltr"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="export-class">الصف</label>
            <select id="export-class" className="select" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">كل الصفوف</option>
              {meta.data?.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.stage}
                </option>
              ))}
            </select>
            {meta.loading ? <p className="muted small">جارٍ تحميل الأصناف…</p> : null}
            {meta.error ? <p className="field-error">{meta.error}</p> : null}
          </div>
        </div>

        <div className="actions-row">
          <button type="button" className="btn btn-primary" disabled={creating} onClick={() => void createFile()}>
            {creating ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <FileSpreadsheet size={16} aria-hidden="true" />}
            {creating ? 'جارٍ إنشاء الملف…' : 'إنشاء ملف Excel'}
          </button>
        </div>

        {error ? (
          <StatusBanner tone="danger" title="تعذّر إنشاء الملف">
            {error}
          </StatusBanner>
        ) : null}
      </Card>

      {result ? (
        <Card title="نتيجة الإنشاء" icon={<FileSpreadsheet size={17} aria-hidden="true" />}>
          <div className="result-grid">
            <div className="result-stat result-stat-ok">
              <span className="result-value">{result.rowCount}</span>
              <span className="result-label">عدد الصفوف</span>
            </div>
            <div className="result-stat result-stat-info">
              <span className="result-value">{result.columns.length}</span>
              <span className="result-label">عدد الأعمدة</span>
            </div>
          </div>

          <div className="field">
            <span className="field-label-like">مسار الملف على الجهاز (يمكن نسخه)</span>
            <div className="copy-row">
              <code className="path" dir="ltr">
                {result.path}
              </code>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  void copyText(result.path).then((ok) => setCopied(ok));
                }}
              >
                <Copy size={14} aria-hidden="true" /> {copied ? 'تم النسخ' : 'نسخ المسار'}
              </button>
            </div>
            <p className="muted small">
              لا يمكن فتح مجلد النظام من المتصفح مباشرة — انسخ المسار وألصقه في مستكشف الملفات.
            </p>
          </div>

          <div className="field">
            <span className="field-label-like">الأعمدة الخمسة بالضبط وبالترتيب</span>
            <ol className="columns-list">
              {result.columns.map((col, i) => (
                <li key={`${col}-${String(i)}`}>
                  <span className="col-index">{i + 1}</span> {col}
                </li>
              ))}
            </ol>
          </div>

          <div className="actions-row">
            <a className="btn btn-primary" href={downloadHref} download>
              <Download size={16} aria-hidden="true" /> تنزيل الملف
            </a>
            <span className="muted small mono" dir="ltr">
              {downloadHref}
            </span>
          </div>
        </Card>
      ) : null}

      <Card
        title="آخر ملف تم إنشاؤه"
        icon={<RefreshCw size={17} aria-hidden="true" />}
        action={
          <button type="button" className="btn btn-ghost btn-sm" onClick={latest.reload}>
            <RefreshCw size={15} aria-hidden="true" /> تحديث
          </button>
        }
      >
        {latest.loading ? (
          <Loading label="جارٍ البحث عن آخر ملف…" />
        ) : latest.data && latest.data.file ? (
          <dl className="kv">
            <div>
              <dt>اسم الملف</dt>
              <dd>{latest.data.file.fileName}</dd>
            </div>
            <div>
              <dt>المسار</dt>
              <dd>
                <span className="path" dir="ltr">
                  {latest.data.file.path}
                </span>
              </dd>
            </div>
            <div>
              <dt>تاريخ الإنشاء</dt>
              <dd>{formatDateTime(latest.data.file.createdAt)}</dd>
            </div>
            <div>
              <dt>الحجم</dt>
              <dd>{latest.data.file.size} بايت</dd>
            </div>
          </dl>
        ) : latest.error ? (
          <ErrorState message={latest.error} onRetry={latest.reload} />
        ) : (
          <EmptyState title="لم يتم إنشاء أي ملف تصدير بعد" hint="اضغط «إنشاء ملف Excel» لتظهر النتيجة هنا." />
        )}
      </Card>
    </div>
  );
}
