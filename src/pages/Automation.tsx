import { useEffect, useState } from 'react';
import {
  Bot,
  CircleCheck,
  CircleX,
  Copy,
  ExternalLink,
  Globe,
  History,
  Link2,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { apiGet, apiPost, copyText, formatDateTime, toErrorMessage, todayISO } from '../api';
import { Badge, StatusBanner } from '../components/Badge';
import { Card, EmptyState, ErrorState, Loading, PageHeader } from '../components/States';
import { useResource, type Resource } from '../hooks';
import { AUTOMATION_STATUS_LABEL, AUTOMATION_STATUS_TONE, levelLabel } from '../labels';
import type { AutomationResult, LogsResponse, MetaResponse, Settings, SettingsResponse } from '../types';

export function Automation({ meta }: { meta: Resource<MetaResponse> }) {
  const settings = useResource<SettingsResponse>(() => apiGet<SettingsResponse>('/settings'), []);
  const logs = useResource<LogsResponse>(() => apiGet<LogsResponse>('/logs?limit=50'), []);

  const [siteUrlDraft, setSiteUrlDraft] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlOk, setUrlOk] = useState(false);

  const [date, setDate] = useState(todayISO());
  const [classId, setClassId] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<AutomationResult | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const siteUrl = settings.data?.settings.siteUrl ?? '';

  useEffect(() => {
    if (settings.data) setSiteUrlDraft(settings.data.settings.siteUrl);
  }, [settings.data]);

  useEffect(() => {
    let alive = true;
    apiGet<AutomationResult>('/automation/status')
      .then((status) => {
        if (!alive) return;
        if (status && status.status && status.status !== 'idle') setResult(status);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function saveSiteUrl() {
    if (!settings.data) return;
    setSavingUrl(true);
    setUrlError(null);
    setUrlOk(false);
    try {
      const payload: Settings = { ...settings.data.settings, siteUrl: siteUrlDraft.trim() };
      await apiPost<SettingsResponse>('/settings', payload);
      setUrlOk(true);
      settings.reload();
    } catch (err) {
      setUrlError(toErrorMessage(err));
    } finally {
      setSavingUrl(false);
    }
  }

  async function runAutomation() {
    setRunning(true);
    setRunError(null);
    try {
      const response = await apiPost<AutomationResult>('/automation/run', {
        date,
        classId,
        export: true,
      });
      setResult(response);
      logs.reload();
    } catch (err) {
      setRunError(toErrorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  const status = result?.status ?? 'idle';

  return (
    <div className="page">
      <PageHeader
        title="الإدخال إلى الموقع (الأتمتة)"
        subtitle="تشغيل الإدخال التلقائي إلى موقع الإدارة مع تسجيل كل خطوة ودليل مُتحقَّق منه"
      />

      <StatusBanner tone="info" title="سياسة الاشتباك الأخلاقي مع اختبارات الروبوت">
        <p>
          <strong>لا يتجاوز النظام اختبارات الروبوت (CAPTCHA) مطلقًا.</strong> عند رصد اختبار روبوت يتوقف التنفيذ
          فورًا ويُسلَّم الأمر إليك لإدخاله يدويًا، مع الاحتفاظ بلقطات الشاشة والسجلات.
        </p>
      </StatusBanner>

      <Card title="رابط موقع الإدارة" icon={<Globe size={17} aria-hidden="true" />}>
        {settings.loading ? (
          <Loading label="جارٍ تحميل الإعدادات…" />
        ) : settings.error ? (
          <ErrorState message={settings.error} onRetry={settings.reload} />
        ) : siteUrl ? (
          <div className="copy-row">
            <span className="path" dir="ltr">
              {siteUrl}
            </span>
            <Badge tone="ok" icon={<CircleCheck size={13} aria-hidden="true" />}>
              مضبوط
            </Badge>
          </div>
        ) : (
          <>
            <StatusBanner tone="warning" title="لم يتم ضبط رابط الموقع بعد">
              لن تعمل الأتمتة قبل كتابة رابط موقع الإدارة.
            </StatusBanner>
            <div className="form-row">
              <div className="field field-grow">
                <label htmlFor="site-url">رابط الموقع (siteUrl)</label>
                <input
                  id="site-url"
                  type="text"
                  className="input"
                  dir="ltr"
                  placeholder="https://example.edu.eg"
                  value={siteUrlDraft}
                  onChange={(e) => setSiteUrlDraft(e.target.value)}
                />
              </div>
              <div className="field field-actions">
                <span className="field-label-like">&nbsp;</span>
                <button type="button" className="btn btn-primary" disabled={savingUrl} onClick={() => void saveSiteUrl()}>
                  {savingUrl ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
                  حفظ الرابط
                </button>
              </div>
            </div>
            {urlOk ? (
              <p className="inline-ok" role="status">
                <CircleCheck size={15} aria-hidden="true" /> تم حفظ الرابط.
              </p>
            ) : null}
            {urlError ? (
              <p className="inline-error" role="alert">
                <CircleX size={15} aria-hidden="true" /> {urlError}
              </p>
            ) : null}
          </>
        )}
      </Card>

      <Card title="تشغيل الإدخال التلقائي" icon={<Play size={17} aria-hidden="true" />}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="auto-date">التاريخ</label>
            <input
              id="auto-date"
              type="date"
              className="input"
              dir="ltr"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="auto-class">الصف</label>
            <select id="auto-class" className="select" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">— اختر الصف —</option>
              {meta.data?.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.stage}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="actions-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={running || !classId}
            onClick={() => void runAutomation()}
          >
            {running ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Bot size={16} aria-hidden="true" />}
            {running ? 'جارٍ التنفيذ…' : 'تشغيل الإدخال التلقائي'}
          </button>
          {!classId ? <span className="muted small">اختر الصف أولًا.</span> : null}
        </div>

        {runError ? (
          <StatusBanner tone="danger" title="تعذّر تشغيل الأتمتة">
            {runError}
          </StatusBanner>
        ) : null}
      </Card>

      {result ? (
        <Card title="نتيجة آخر تشغيل" icon={<Bot size={17} aria-hidden="true" />}>
          <StatusBanner tone={AUTOMATION_STATUS_TONE[status]} title={AUTOMATION_STATUS_LABEL[status]}>
            <div className="stack-xs">
              <p>{result.message || 'لا توجد رسالة إضافية من الخادم.'}</p>
              <p className="small">
                بدأ: {formatDateTime(result.startedAt)} — انتهى: {formatDateTime(result.finishedAt)}
                {typeof result.durationMs === 'number' ? ` — المدة: ${result.durationMs} مللي ثانية` : ''}
              </p>
            </div>
          </StatusBanner>

          <p className="notice-title">
            <CircleCheck size={15} aria-hidden="true" /> خطوات التنفيذ ({result.steps.length})
          </p>
          {result.steps.length === 0 ? (
            <EmptyState title="لم يُسجَّل أي خطوة في هذه العملية" />
          ) : (
            <ul className="steps">
              {result.steps.map((step, i) => (
                <li key={`${step.step}-${String(i)}`} className={step.ok ? 'step step-ok' : 'step step-fail'}>
                  <span className="step-icon" aria-hidden="true">
                    {step.ok ? <CircleCheck size={17} /> : <CircleX size={17} />}
                  </span>
                  <div className="step-body">
                    <p className="step-name">
                      {step.step}
                      <span className={`step-flag ${step.ok ? 'flag-ok' : 'flag-fail'}`.trim()}>
                        {step.ok ? 'تم' : 'فشل'}
                      </span>
                    </p>
                    {step.detail ? <p className="step-detail">{step.detail}</p> : null}
                    {step.at ? <p className="step-at">{formatDateTime(step.at)}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="notice-title">
            <ExternalLink size={15} aria-hidden="true" /> الأدلة (لقطات الشاشة) ({result.evidence.length})
          </p>
          {result.evidence.length === 0 ? (
            <p className="muted">لا توجد لقطات محفوظة لهذه العملية.</p>
          ) : (
            <ul className="evidence-list">
              {result.evidence.map((item, i) => (
                <li key={`${item.path}-${String(i)}`}>
                  <a className="evidence-link" href={item.path} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} aria-hidden="true" />
                    <span className="path" dir="ltr">
                      {item.path}
                    </span>
                  </a>
                  <span className="muted small">{formatDateTime(item.at)}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void copyText(item.path).then((ok) => setCopiedPath(ok ? item.path : null));
                    }}
                  >
                    <Copy size={14} aria-hidden="true" />
                    {copiedPath === item.path ? 'تم النسخ' : 'نسخ المسار'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {result.excelPath ? (
            <div className="copy-row">
              <span className="field-label-like">ملف Excel:</span>
              <span className="path" dir="ltr">
                {result.excelPath}
              </span>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card
        title="آخر السجلات"
        icon={<History size={17} aria-hidden="true" />}
        action={
          <button type="button" className="btn btn-ghost btn-sm" onClick={logs.reload}>
            <RefreshCw size={15} aria-hidden="true" /> تحديث
          </button>
        }
      >
        {logs.loading ? (
          <Loading label="جارٍ تحميل السجلات…" />
        ) : logs.error ? (
          <ErrorState message={logs.error} onRetry={logs.reload} />
        ) : logs.data && logs.data.logs.length > 0 ? (
          <ul className="log-list">
            {logs.data.logs.map((log, i) => (
              <li key={`${log.at}-${String(i)}`}>
                <Badge tone={log.level.toLowerCase() === 'error' ? 'danger' : log.level.toLowerCase() === 'warn' ? 'warn' : 'info'}>
                  {levelLabel(log.level)}
                </Badge>
                <span className="log-message">{log.message}</span>
                <span className="muted small mono" dir="ltr">
                  {formatDateTime(log.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="لا توجد سجلات بعد" hint="ستظهر هنا كل عمليات الأتمتة والاستيراد." />
        )}
      </Card>

      {!siteUrl && !settings.loading ? (
        <p className="muted small">
          <ShieldAlert size={14} aria-hidden="true" /> الأتمتة معطّلة حتى يتم ضبط رابط الموقع من الأعلى.
        </p>
      ) : null}
    </div>
  );
}
