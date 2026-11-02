import { useState } from 'react';
import { Check, Pencil, RefreshCw, Save, Search, Users, X } from 'lucide-react';
import { apiGet, apiPost, buildQuery, toErrorMessage } from '../api';
import { Badge, VerificationBadge } from '../components/Badge';
import { EmptyState, ErrorState, Loading, PageHeader } from '../components/States';
import { useDebounced, useResource, type Resource } from '../hooks';
import type { MetaResponse, Student, StudentsResponse } from '../types';

export function Students({ meta }: { meta: Resource<MetaResponse> }) {
  const [searchValue, setSearchValue] = useState('');
  const query = useDebounced(searchValue, 300);
  const [classId, setClassId] = useState('');
  const [needsReview, setNeedsReview] = useState(false);

  const students = useResource<StudentsResponse>(
    () =>
      apiGet<StudentsResponse>(
        `/students${buildQuery({
          query,
          classId,
          needsReview: needsReview ? 'true' : '',
          limit: 100,
          offset: 0,
        })}`,
      ),
    [query, classId, needsReview],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  function startEdit(student: Student) {
    setEditingId(student.id);
    setDraftName(student.fullName);
    setSaveError(null);
    setSaveOk(null);
  }

  async function saveStudent(student: Student) {
    const name = draftName.trim();
    if (!name) {
      setSaveError('لا يمكن حفظ اسم فارغ.');
      return;
    }
    setSavingId(student.id);
    setSaveError(null);
    setSaveOk(null);
    try {
      await apiPost('/students', {
        id: student.id,
        studentCode: student.studentCode,
        fullName: name,
        classId: student.classId,
        schoolId: student.schoolId,
        stage: student.stage,
        grade: student.grade,
        section: student.section,
        active: student.active ?? true,
        verificationStatus: student.verificationStatus,
      });
      setEditingId(null);
      setSaveOk(`تم حفظ اسم الطالب «${name}» بنجاح.`);
      students.reload();
      meta.reload();
    } catch (err) {
      setSaveError(toErrorMessage(err));
    } finally {
      setSavingId(null);
    }
  }

  const list = students.data?.results ?? [];

  return (
    <div className="page">
      <PageHeader
        title="الطلاب"
        subtitle="بحث بالاسم أو الكود، تصفية حسب الصنف، وتعديل الاسم مباشرة"
        actions={
          <button type="button" className="btn btn-outline" onClick={students.reload}>
            <RefreshCw size={16} aria-hidden="true" /> تحديث
          </button>
        }
      />

      <div className="card">
        <div className="card-body">
          <div className="filters">
            <div className="field field-grow">
              <label htmlFor="students-search">بحث (اسم الطالب أو الكود)</label>
              <div className="input-with-icon">
                <Search size={16} aria-hidden="true" />
                <input
                  id="students-search"
                  type="search"
                  className="input"
                  value={searchValue}
                  placeholder="اكتب اسمًا أو كودًا…"
                  onChange={(e) => setSearchValue(e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="students-class">الصف</label>
              <select id="students-class" className="select" value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">كل الأصناف</option>
                {meta.data?.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.stage}
                  </option>
                ))}
              </select>
            </div>

            <div className="field field-toggle">
              <span className="field-label-like">تصفية</span>
              <label className="switch" htmlFor="needs-review">
                <input
                  id="needs-review"
                  type="checkbox"
                  checked={needsReview}
                  onChange={(e) => setNeedsReview(e.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
                <span>فقط غير المؤكَّدة</span>
              </label>
            </div>
          </div>

          {saveOk ? (
            <p className="inline-ok" role="status">
              <Check size={15} aria-hidden="true" /> {saveOk}
            </p>
          ) : null}
          {saveError ? (
            <p className="inline-error" role="alert">
              <X size={15} aria-hidden="true" /> {saveError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {students.loading ? (
            <Loading label="جارٍ تحميل قائمة الطلاب…" />
          ) : students.error ? (
            <ErrorState message={students.error} onRetry={students.reload} />
          ) : list.length === 0 ? (
            <EmptyState
              title="لا توجد نتائج مطابقة"
              hint="جرّب تعديل كلمات البحث أو إلغاء التصفية، أو استورد كشف الفصل أولًا."
            />
          ) : (
            <>
              <p className="muted small">
                عدد النتائج: {students.data?.total ?? list.length} (تُعرض حتى 100 سجل في هذه الصفحة).
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">كود الطالب</th>
                      <th scope="col">اسم الطالب</th>
                      <th scope="col">الصف</th>
                      <th scope="col">حالة التحقق</th>
                      <th scope="col">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((student) => {
                      const editing = editingId === student.id;
                      const saving = savingId === student.id;
                      return (
                        <tr key={student.id}>
                          <td>
                            <span className="mono code-chip" dir="ltr">
                              {student.studentCode}
                            </span>
                          </td>
                          <td>
                            {editing ? (
                              <input
                                type="text"
                                className="input"
                                value={draftName}
                                autoFocus
                                aria-label={`تعديل اسم الطالب ${student.fullName}`}
                                onChange={(e) => setDraftName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void saveStudent(student);
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                              />
                            ) : (
                              <span className="name-text">{student.fullName}</span>
                            )}
                          </td>
                          <td>{student.classLabel || '—'}</td>
                          <td>
                            <VerificationBadge status={student.verificationStatus} />
                          </td>
                          <td>
                            {editing ? (
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={saving}
                                  onClick={() => void saveStudent(student)}
                                >
                                  {saving ? <RefreshCw className="spin" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                                  حفظ
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                                  <X size={14} aria-hidden="true" /> إلغاء
                                </button>
                              </div>
                            ) : (
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => startEdit(student)}>
                                <Pencil size={14} aria-hidden="true" /> تعديل الاسم
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {meta.data && meta.data.classes.length === 0 ? (
        <p className="muted small">
          <Users size={14} aria-hidden="true" /> لا توجد أصناف مُعرَّفة حتى الآن — استورد كشف الفصول أولًا.
        </p>
      ) : null}
      {!needsReview && list.length > 0 && students.data && students.data.total > list.length ? (
        <p className="muted small">
          <Badge tone="info">ملاحظة</Badge> هناك {students.data.total - list.length} سجلًا إضافيًا لم يُعرض؛ ضيّق البحث
          للوصول إليها.
        </p>
      ) : null}
    </div>
  );
}
