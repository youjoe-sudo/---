import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarX, Check, CircleCheck, RefreshCw, Save, TriangleAlert, Users, X } from 'lucide-react';
import { apiGet, apiPost, buildQuery, formatDateTime, toErrorMessage, todayISO } from '../api';
import { Badge, StatusBanner } from '../components/Badge';
import { Card, EmptyState, ErrorState, Loading, PageHeader } from '../components/States';
import { useResource } from '../hooks';
import type {
  AttendanceDayResponse,
  AttendanceReportResponse,
  AttendanceSelectResponse,
} from '../types';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function Attendance() {
  const [date, setDate] = useState(todayISO());
  const [activeClassId, setActiveClassId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const day = useResource<AttendanceDayResponse>(
    () => apiGet<AttendanceDayResponse>(`/attendance/day${buildQuery({ date })}`),
    [date],
  );

  const report = useResource<AttendanceReportResponse>(
    () =>
      activeClassId
        ? apiGet<AttendanceReportResponse>(`/attendance/report${buildQuery({ date, classId: activeClassId })}`)
        : Promise.resolve<AttendanceReportResponse>({ ok: true, date, classId: '', students: [] }),
    [date, activeClassId],
  );

  const classes = day.data?.classes ?? [];

  useEffect(() => {
    if (!day.data) return;
    const ids = day.data.classes.map((c) => c.classId);
    if (ids.length === 0) {
      setActiveClassId('');
      return;
    }
    if (!activeClassId || !ids.includes(activeClassId)) {
      setActiveClassId(ids[0]);
    }
  }, [day.data, activeClassId]);

  useEffect(() => {
    if (!report.data) return;
    setSelected(new Set(report.data.students.filter((s) => s.selected).map((s) => s.id)));
    setSaveState('idle');
    setSaveError(null);
  }, [report.data]);

  const timerRef = useRef<number | null>(null);
  const saveSeq = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  function persist(ids: string[]) {
    if (!activeClassId) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const seq = ++saveSeq.current;
    setSaveState('dirty');
    timerRef.current = window.setTimeout(() => {
      setSaveState('saving');
      apiPost<AttendanceSelectResponse>('/attendance/select', {
        date,
        classId: activeClassId,
        studentIds: ids,
      })
        .then(() => {
          if (seq !== saveSeq.current) return;
          setSaveState('saved');
          setSaveError(null);
          day.reload();
        })
        .catch((err: unknown) => {
          if (seq !== saveSeq.current) return;
          setSaveState('error');
          setSaveError(toErrorMessage(err));
        });
    }, 600);
  }

  function toggle(studentId: string) {
    const next = new Set(selected);
    if (next.has(studentId)) next.delete(studentId);
    else next.add(studentId);
    setSelected(next);
    persist([...next]);
  }

  function selectAll() {
    const ids = (report.data?.students ?? []).map((s) => s.id);
    setSelected(new Set(ids));
    persist(ids);
  }

  function clearAll() {
    setSelected(new Set());
    persist([]);
  }

  const activeClass = classes.find((c) => c.classId === activeClassId) ?? null;
  const reportStudents = report.data?.students ?? [];
  const selectedStudents = useMemo(
    () => reportStudents.filter((s) => selected.has(s.id)),
    [reportStudents, selected],
  );
  const totalSelected = classes.reduce((sum, c) => sum + (c.selectedCount || 0), 0);

  return (
    <div className="page">
      <PageHeader
        title="غياب اليوم"
        subtitle="اختر التاريخ والصف ثم حدّد الغائبين — يُحفظ التحديد تلقائيًا بعد كل تعديل"
        actions={
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              day.reload();
              report.reload();
            }}
          >
            <RefreshCw size={16} aria-hidden="true" /> تحديث
          </button>
        }
      />

      <Card title="التاريخ" icon={<CalendarX size={17} aria-hidden="true" />}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="attendance-date">تاريخ الغياب</label>
            <input
              id="attendance-date"
              type="date"
              className="input"
              dir="ltr"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setActiveClassId('');
                setSelected(new Set());
              }}
            />
          </div>
          <div className="field field-grow">
            <span className="field-label-like">إجمالي المحدَّدين في هذا التاريخ</span>
            <p className="big-number">
              {day.data ? totalSelected : '—'}
              <span className="muted small"> طالب عبر {classes.length} صنف</span>
            </p>
          </div>
        </div>
      </Card>

      {day.loading && !day.data ? (
        <Loading label="جارٍ تحميل بيانات اليوم…" />
      ) : day.error ? (
        <ErrorState message={day.error} onRetry={day.reload} />
      ) : classes.length === 0 ? (
        <EmptyState
          title="لا توجد أصناف لعرضها"
          hint="لم يتم استيراد أي فصل بعد. انتقل إلى «استيراد كشف PDF» لإضافة قائمة الفصل."
        />
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="الأصناف">
            {classes.map((c) => (
              <button
                key={c.classId}
                type="button"
                role="tab"
                aria-selected={c.classId === activeClassId}
                className={`tab ${c.classId === activeClassId ? 'tab-active' : ''}`.trim()}
                onClick={() => setActiveClassId(c.classId)}
              >
                {c.classLabel}
                <span className="tab-count">{c.selectedCount}</span>
              </button>
            ))}
          </div>

          <div className="grid attendance-grid">
            <Card
              title={`قائمة طلاب ${activeClass ? activeClass.classLabel : ''}`}
              icon={<Users size={17} aria-hidden="true" />}
              action={
                <div className="row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={selectAll}>
                    <Check size={14} aria-hidden="true" /> تحديد الكل
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
                    <X size={14} aria-hidden="true" /> مسح الكل
                  </button>
                </div>
              }
            >
              {report.loading && !report.data ? (
                <Loading label="جارٍ تحميل طلاب الصف…" />
              ) : report.error ? (
                <ErrorState message={report.error} onRetry={report.reload} />
              ) : reportStudents.length === 0 ? (
                <EmptyState title="لا يوجد طلاب مسجّلون في هذا الصنف" />
              ) : (
                <ul className="student-list">
                  {reportStudents.map((student) => {
                    const checked = selected.has(student.id);
                    return (
                      <li key={student.id}>
                        <label className={`student-row ${checked ? 'student-row-absent' : ''}`.trim()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(student.id)}
                            aria-label={`تحديد ${student.fullName} كغائب`}
                          />
                          <span className="student-name">{student.fullName}</span>
                          <span className="mono code-chip" dir="ltr">
                            {student.studentCode}
                          </span>
                          <span className={`absent-flag ${checked ? 'absent-flag-on' : ''}`.trim()}>
                            {checked ? 'غائب' : 'حاضر'}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card title="ملخّص المحدَّدين" icon={<CircleCheck size={17} aria-hidden="true" />}>
              <div className="save-bar" aria-live="polite">
                {saveState === 'saving' ? (
                  <span className="save-state save-saving">
                    <RefreshCw className="spin" size={15} aria-hidden="true" /> جارٍ الحفظ…
                  </span>
                ) : saveState === 'saved' ? (
                  <span className="save-state save-saved">
                    <Check size={15} aria-hidden="true" /> تم حفظ التحديد في الخادم
                  </span>
                ) : saveState === 'dirty' ? (
                  <span className="save-state save-saving">تعديلات غير محفوظة…</span>
                ) : saveState === 'error' ? (
                  <span className="save-state save-error">
                    <TriangleAlert size={15} aria-hidden="true" /> تعذّر الحفظ
                  </span>
                ) : (
                  <span className="save-state">لا توجد تعديلات بعد</span>
                )}
              </div>

              {saveError ? (
                <StatusBanner tone="danger" title="فشل حفظ التحديد">
                  {saveError}
                </StatusBanner>
              ) : null}

              <p className="big-number">
                {selectedStudents.length}
                <span className="muted small"> غائب محدَّد في هذا الصنف</span>
              </p>

              {selectedStudents.length > 0 ? (
                <ul className="summary-list">
                  {selectedStudents.map((s) => (
                    <li key={s.id}>
                      <span className="name-text">{s.fullName}</span>
                      <span className="mono code-chip" dir="ltr">
                        {s.studentCode}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">لم يتم تحديد أي غائب في هذا الصنف حتى الآن.</p>
              )}

              <div className="divider" />

              <p className="notice-title">
                <CalendarX size={15} aria-hidden="true" /> عدد المحدَّدين في باقي الأصناف ({formatDateTime(date)})
              </p>
              <ul className="summary-list">
                {classes.map((c) => (
                  <li key={c.classId}>
                    <span>{c.classLabel}</span>
                    <Badge tone={c.selectedCount > 0 ? 'warn' : 'muted'}>{c.selectedCount}</Badge>
                  </li>
                ))}
              </ul>
              <div className="actions-row">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => persist([...selected])} disabled={!activeClassId}>
                  <Save size={14} aria-hidden="true" /> حفظ الآن
                </button>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
