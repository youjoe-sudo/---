import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CircleCheck, Copy, HardDrive, Info, RefreshCw, Save, Server, Trash2, X } from 'lucide-react';
import { apiGet, apiPost, copyText, formatDateTime, toErrorMessage } from '../api';
import { StatusBanner } from '../components/Badge';
import { Card, ErrorState, Loading, PageHeader } from '../components/States';
import { useResource } from '../hooks';
import type { BrowserName, HealthResponse, Settings, SettingsResponse } from '../types';

const EMPTY_SETTINGS: Settings = {
  siteUrl: '',
  siteName: '',
  browser: 'msedge',
  headless: false,
  timeoutMs: 45000,
  manualFallback: true,
  exportDir: '',
  autoExportBeforeRun: true,
};

export function SettingsPage() {
  const settings = useResource<SettingsResponse>(() => apiGet<SettingsResponse>('/settings'), []);
  const health = useResource<HealthResponse>(() => apiGet<HealthResponse>('/health'), []);

  const [form, setForm] = useState<Settings>(EMPTY_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // تصفير البيانات
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setForm({ ...EMPTY_SETTINGS, ...settings.data.settings });
      setSaved(false);
      setError(null);
    }
  }, [settings.data]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Settings = {
        ...form,
        siteUrl: form.siteUrl.trim(),
        siteName: form.siteName.trim(),
        exportDir: form.exportDir.trim(),
        timeoutMs: Number.isFinite(form.timeoutMs) && form.timeoutMs > 0 ? Math.round(form.timeoutMs) : 45000,
      };
      const response = await apiPost<SettingsResponse>('/settings', payload);
      setForm({ ...EMPTY_SETTINGS, ...response.settings });
      setSaved(true);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function resetDatabase() {
    setResetting(true);
    setResetError(null);
    setResetDone(null);
    try {
      const r = await apiPost<{
        ok: boolean;
        removed: { students: number; classes: number; attendance: number; imports: number };
      }>('/admin/reset', { confirm: 'RESET' });
      const x = r.removed;
      setResetDone(
        `تم التصفير: حُذف ${x.students} طالباً و${x.classes} صنفاً و${x.attendance} يوم غياب و${x.imports} سجل استيراد. الإعدادات والمدرسة محفوظة.`,
      );
      setResetOpen(false);
      settings.reload();
      health.reload();
    } catch (err) {
      setResetError(toErrorMessage(err));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="الإعدادات"
        subtitle="ضبط موقع الإدارة والمتصفح ومجلد التصدير، مع معلومات النظام"
        actions={
          <button type="button" className="btn btn-outline" onClick={settings.reload}>
            <RefreshCw size={16} aria-hidden="true" /> تحديث
          </button>
        }
      />

      {settings.loading ? (
        <Loading label="جارٍ تحميل الإعدادات…" />
      ) : settings.error ? (
        <ErrorState message={settings.error} onRetry={settings.reload} />
      ) : (
        <form onSubmit={(e) => void save(e)}>
          <Card title="إعدادات الموقع والأتمتة" icon={<Info size={17} aria-hidden="true" />}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="set-site-url">رابط الموقع (siteUrl)</label>
                <input
                  id="set-site-url"
                  type="text"
                  className="input"
                  dir="ltr"
                  placeholder="https://example.edu.eg"
                  value={form.siteUrl}
                  onChange={(e) => update('siteUrl', e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="set-site-name">اسم الموقع (siteName)</label>
                <input
                  id="set-site-name"
                  type="text"
                  value={form.siteName}
                  onChange={(e) => update('siteName', e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="set-browser">المتصفح</label>
                <select
                  id="set-browser"
                  className="select"
                  value={form.browser}
                  onChange={(e) => update('browser', e.target.value as BrowserName)}
                >
                  <option value="msedge">Microsoft Edge (msedge)</option>
                  <option value="chrome">Google Chrome (chrome)</option>
                  <option value="chromium">Chromium (chromium)</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="set-timeout">مهلة التنفيذ بالمللي ثانية (timeout)</label>
                <input
                  id="set-timeout"
                  type="number"
                  min={1000}
                  step={500}
                  className="input"
                  dir="ltr"
                  value={String(form.timeoutMs)}
                  onChange={(e) => update('timeoutMs', Number(e.target.value))}
                />
              </div>

              <div className="field">
                <label htmlFor="set-export-dir">مجلد التصدير (exportDir)</label>
                <input
                  id="set-export-dir"
                  type="text"
                  className="input"
                  dir="ltr"
                  placeholder="اتركه فارغًا لاستخدام المجلد الافتراضي"
                  value={form.exportDir}
                  onChange={(e) => update('exportDir', e.target.value)}
                />
              </div>
            </div>

            <div className="checkbox-grid">
              <label className="check-line" htmlFor="set-headless">
                <input
                  id="set-headless"
                  type="checkbox"
                  checked={form.headless}
                  onChange={(e) => update('headless', e.target.checked)}
                />
                <span>تشغيل المتصفح في وضع مخفي (headless)</span>
              </label>

              <label className="check-line" htmlFor="set-manual">
                <input
                  id="set-manual"
                  type="checkbox"
                  checked={form.manualFallback}
                  onChange={(e) => update('manualFallback', e.target.checked)}
                />
                <span>السماح بالإدخال اليدوي عند التعثّر (manualFallback)</span>
              </label>

              <label className="check-line" htmlFor="set-autoexport">
                <input
                  id="set-autoexport"
                  type="checkbox"
                  checked={form.autoExportBeforeRun}
                  onChange={(e) => update('autoExportBeforeRun', e.target.checked)}
                />
                <span>إنشاء ملف Excel قبل كل تشغيل (autoExportBeforeRun)</span>
              </label>
            </div>

            {error ? (
              <StatusBanner tone="danger" title="تعذّر حفظ الإعدادات">
                {error}
              </StatusBanner>
            ) : null}
            {saved ? (
              <p className="inline-ok" role="status">
                <CircleCheck size={15} aria-hidden="true" /> تم حفظ الإعدادات بنجاح.
              </p>
            ) : null}

            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <RefreshCw className="spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                {saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setForm(EMPTY_SETTINGS)}>
                <X size={16} aria-hidden="true" /> إعادة الضبط للقيم الافتراضية
              </button>
            </div>
          </Card>
        </form>
      )}

      <Card title="تصفير البيانات" icon={<Trash2 size={17} aria-hidden="true" />}>
        <div className="danger-zone">
          <p>
            يحذف <strong>كل الطلاب</strong> و<strong>كل الأصناف</strong> و<strong>سجلات الغياب</strong> و
            <strong>سجل الاستيراد</strong> من قاعدة البيانات المحلية، لتبدأ من جديد بكشوف نظيفة.
          </p>
          <p className="muted small">
            لا يُحذف: إعدادات الموقع والمتصفح، اسم المدرسة، خريطة رموز الخط، وسجل الأحداث.
            تُنشأ نسخة احتياطية تلقائياً لكل ملف قبل الحذف في <span className="mono" dir="ltr">data/backups</span>.
          </p>

          {resetError ? (
            <StatusBanner tone="danger" title="تعذّر تصفير البيانات">
              {resetError}
            </StatusBanner>
          ) : null}
          {resetDone ? (
            <p className="inline-ok" role="status">
              <CircleCheck size={15} aria-hidden="true" /> {resetDone}
            </p>
          ) : null}

          {resetOpen ? (
            <div className="danger-confirm">
              <p className="danger-warn">
                <AlertTriangle size={16} aria-hidden="true" />
                هل أنت متأكد؟ سيُحذف كل الطلاب والأصناف والغياب نهائياً من قاعدة البيانات الحالية.
              </p>
              <div className="actions-row">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void resetDatabase()}
                  disabled={resetting}
                >
                  {resetting ? (
                    <RefreshCw className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <Trash2 size={16} aria-hidden="true" />
                  )}
                  {resetting ? 'جارٍ الحذف…' : 'نعم، احذف كل البيانات'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setResetOpen(false)}
                  disabled={resetting}
                >
                  <X size={16} aria-hidden="true" /> إلغاء
                </button>
              </div>
            </div>
          ) : (
            <div className="actions-row">
              <button type="button" className="btn btn-danger-outline" onClick={() => setResetOpen(true)}>
                <Trash2 size={16} aria-hidden="true" /> تصفير قاعدة البيانات والطلاب
              </button>
            </div>
          )}
        </div>
      </Card>

      <Card title="معلومات النظام" icon={<Server size={17} aria-hidden="true" />}>
        {health.loading ? (
          <Loading label="جارٍ تحميل معلومات النظام…" />
        ) : health.error ? (
          <ErrorState message={health.error} onRetry={health.reload} />
        ) : health.data ? (
          <>
            <dl className="kv">
              <div>
                <dt>إصدار النظام</dt>
                <dd className="mono" dir="ltr">
                  {health.data.version}
                </dd>
              </div>
              <div>
                <dt>مجلد البيانات (dataDir)</dt>
                <dd>
                  <div className="copy-row">
                    <span className="path" dir="ltr">
                      {health.data.dataDir}
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        void copyText(health.data ? health.data.dataDir : '').then((ok) => setCopied(ok));
                      }}
                    >
                      <Copy size={14} aria-hidden="true" /> {copied ? 'تم النسخ' : 'نسخ'}
                    </button>
                  </div>
                </dd>
              </div>
              <div>
                <dt>وقت الخادم</dt>
                <dd>{formatDateTime(health.data.now)}</dd>
              </div>
              <div>
                <dt>عدد الطلاب</dt>
                <dd>{health.data.stats.students}</dd>
              </div>
              <div>
                <dt>عدد الأصناف</dt>
                <dd>{health.data.stats.classes}</dd>
              </div>
              <div>
                <dt>عدد عمليات الاستيراد</dt>
                <dd>{health.data.stats.imports}</dd>
              </div>
              <div>
                <dt>أيام الغياب المسجّلة</dt>
                <dd>{health.data.stats.attendanceDays}</dd>
              </div>
            </dl>
            <p className="muted small">
              <HardDrive size={14} aria-hidden="true" /> تُحفظ البيانات محليًا على هذا الجهاز فقط، ولا تُخزَّن أي بيانات
              اعتماد.
            </p>
          </>
        ) : null}
      </Card>
    </div>
  );
}
