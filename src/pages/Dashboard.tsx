import type { ReactNode } from 'react';
import {
  Bot,
  CalendarX,
  ClipboardList,
  FileSpreadsheet,
  FileUp,
  HardDrive,
  History,
  RefreshCw,
  Server,
  TriangleAlert,
  CircleCheck,
  Users,
} from 'lucide-react';
import { apiGet, buildQuery, formatDateTime, todayISO } from '../api';
import { Card, ErrorState, Loading, PageHeader } from '../components/States';
import { Badge, StatusBanner } from '../components/Badge';
import { useResource, type Resource } from '../hooks';
import { AUTOMATION_STATUS_LABEL, AUTOMATION_STATUS_TONE } from '../labels';
import type {
  AttendanceDayResponse,
  AutomationResult,
  HealthResponse,
  ImportsResponse,
  MetaResponse,
  PageId,
} from '../types';

interface DashboardProps {
  meta: Resource<MetaResponse>;
  onNavigate: (page: PageId) => void;
}

export function Dashboard({ meta, onNavigate }: DashboardProps) {
  const health = useResource<HealthResponse>(() => apiGet<HealthResponse>('/health'), []);
  const today = todayISO();
  const day = useResource<AttendanceDayResponse>(
    () => apiGet<AttendanceDayResponse>(`/attendance/day${buildQuery({ date: today })}`),
    [today],
  );
  const imports = useResource<ImportsResponse>(() => apiGet<ImportsResponse>('/imports'), []);
  const automation = useResource<AutomationResult>(() => apiGet<AutomationResult>('/automation/status'), []);

  const busy = health.loading || day.loading;
  const failed = health.error || day.error;

  const stats = health.data?.stats;
  const metaError = meta.error;
  const lastImport = imports.data && imports.data.history.length > 0 ? imports.data.history[0] : null;
  const absentToday =
    day.data && day.data.classes.length > 0
      ? day.data.classes.reduce((sum, c) => sum + (c.selectedCount || 0), 0)
      : 0;

  const automationStatus = automation.data && automation.data.status !== 'idle' ? automation.data.status : null;

  return (
    <div className="page">
      <PageHeader
        title="لوحة التحكم"
        subtitle="ملخّص البيانات الفعلية القادمة من الخادم المحلي"
        actions={
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              health.reload();
              day.reload();
              imports.reload();
              automation.reload();
              meta.reload();
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
            تحديث
          </button>
        }
      />

      {failed ? (
        <StatusBanner tone="danger" title="تعذّر جلب بعض بيانات اللوحة">
          <div className="stack-xs">
            {health.error ? <p>{health.error}</p> : null}
            {day.error ? <p>{day.error}</p> : null}
            <p>شغّل الخادم المحلي ثم اضغط «تحديث».</p>
          </div>
        </StatusBanner>
      ) : null}

      {metaError ? (
        <StatusBanner tone="warning" title="تعذّر جلب بيانات المديرية والأصناف">
          <p>{metaError}</p>
        </StatusBanner>
      ) : null}

      {busy ? (
        <Loading label="جارٍ تحميل مؤشرات لوحة التحكم…" />
      ) : (
        <>
          <div className="grid stats-grid">
            <StatCard
              icon={<Users size={20} />}
              tone="blue"
              label="عدد الطلاب"
              value={stats ? String(stats.students) : '—'}
              hint="من /api/health"
            />
            <StatCard
              icon={<ClipboardList size={20} />}
              tone="violet"
              label="عدد الأصناف"
              value={stats ? String(stats.classes) : '—'}
              hint={meta.data ? `من /api/meta — ${meta.data.classes.length} صنف مُعرَّف` : 'من /api/health'}
            />
            <StatCard
              icon={<History size={20} />}
              tone="slate"
              label="آخر استيراد"
              value={lastImport ? formatDateTime(lastImport.importedAt) : stats && stats.imports > 0 ? `${stats.imports} عملية` : 'لا توجد عمليات'}
              hint={lastImport ? `${lastImport.fileName} — ${lastImport.classLabel}` : 'لم يتم استيراد أي ملف بعد'}
            />
            <StatCard
              icon={<CalendarX size={20} />}
              tone="red"
              label="الغائبون المحددون اليوم"
              value={day.data ? String(absentToday) : '—'}
              hint={day.data ? `تاريخ ${day.data.date}` : '—'}
            />
            <StatCard
              icon={<Bot size={20} />}
              tone="green"
              label="حالة الأتمتة الأخيرة"
              value={automationStatus ? AUTOMATION_STATUS_LABEL[automationStatus] : 'لا توجد عملية بعد'}
              hint={
                automation.data && automation.data.message
                  ? automation.data.message
                  : 'من /api/automation/status'
              }
            />
            <StatCard
              icon={meta.data?.excelTemplateVerified ? <CircleCheck size={20} /> : <TriangleAlert size={20} />}
              tone={meta.data?.excelTemplateVerified ? 'green' : 'amber'}
              label="حالة ملف Excel"
              value={meta.data ? (meta.data.excelTemplateVerified ? 'مُتحقَّق منه' : 'غير مُتحقَّق منه') : '—'}
              hint="excelTemplateVerified من /api/meta"
            />
          </div>

          {automationStatus ? (
            <StatusBanner
              tone={AUTOMATION_STATUS_TONE[automationStatus]}
              title={`آخر سجل أتمتة: ${AUTOMATION_STATUS_LABEL[automationStatus]}`}
            >
              <p>{automation.data?.message || 'لا توجد رسالة إضافية.'}</p>
            </StatusBanner>
          ) : null}

          <div className="grid two-col">
            <Card title="حالة الخادم" icon={<Server size={17} aria-hidden="true" />}>
              {health.error ? (
                <ErrorState message={health.error} onRetry={health.reload} />
              ) : health.data ? (
                <dl className="kv">
                  <div>
                    <dt>الإصدار</dt>
                    <dd className="mono" dir="ltr">
                      {health.data.version}
                    </dd>
                  </div>
                  <div>
                    <dt>مجلد البيانات</dt>
                    <dd>
                      <span className="path" dir="ltr">
                        {health.data.dataDir}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>وقت الخادم</dt>
                    <dd>{formatDateTime(health.data.now)}</dd>
                  </div>
                  <div>
                    <dt>أيام الغياب المسجّلة</dt>
                    <dd>{health.data.stats.attendanceDays}</dd>
                  </div>
                  <div>
                    <dt>عدد ملفات الاستيراد</dt>
                    <dd>{health.data.stats.imports}</dd>
                  </div>
                </dl>
              ) : (
                <Loading />
              )}
            </Card>

            <Card title="إجراءات سريعة" icon={<FileUp size={17} aria-hidden="true" />}>
              <div className="quick-actions">
                <QuickAction
                  icon={<FileUp size={18} />}
                  label="استيراد كشف PDF"
                  onClick={() => onNavigate('import')}
                />
                <QuickAction
                  icon={<CalendarX size={18} />}
                  label="تحديد غياب اليوم"
                  onClick={() => onNavigate('attendance')}
                />
                <QuickAction
                  icon={<FileSpreadsheet size={18} />}
                  label="إنشاء ملف Excel"
                  onClick={() => onNavigate('export')}
                />
                <QuickAction
                  icon={<Users size={18} />}
                  label="عرض الطلاب"
                  onClick={() => onNavigate('students')}
                />
                <QuickAction
                  icon={<Bot size={18} />}
                  label="تشغيل الإدخال التلقائي"
                  onClick={() => onNavigate('automation')}
                />
                <QuickAction
                  icon={<HardDrive size={18} />}
                  label="الإعدادات"
                  onClick={() => onNavigate('settings')}
                />
              </div>
            </Card>
          </div>

          <Card
            title="آخر عمليات الاستيراد"
            icon={<History size={17} aria-hidden="true" />}
            action={
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate('import')}>
                فتح شاشة الاستيراد
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
                      <th scope="col">مُضاف</th>
                      <th scope="col">مُحدَّث</th>
                      <th scope="col">يحتاج مراجعة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.data.history.slice(0, 8).map((item) => (
                      <tr key={item.id}>
                        <td>{item.fileName}</td>
                        <td>{item.classLabel}</td>
                        <td>{formatDateTime(item.importedAt)}</td>
                        <td>{item.added}</td>
                        <td>{item.updated}</td>
                        <td>
                          {item.needsReview > 0 ? (
                            <Badge tone="warn">{item.needsReview}</Badge>
                          ) : (
                            <Badge tone="ok">0</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">
                لا توجد عمليات استيراد حتى الآن. ابدأ من شاشة «استيراد كشف PDF».
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone: 'blue' | 'violet' | 'slate' | 'red' | 'green' | 'amber';
}) {
  return (
    <article className={`stat stat-${tone}`}>
      <span className="stat-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="stat-body">
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
        {hint ? <p className="stat-hint">{hint}</p> : null}
      </div>
    </article>
  );
}

function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="quick-action" onClick={onClick}>
      <span className="quick-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
