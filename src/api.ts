export const API_BASE = '/api';

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, init);
  } catch {
    throw new ApiError(
      'تعذّر الاتصال بالخادم المحلي. تأكد من تشغيل الخادم ثم أعد المحاولة.',
    );
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  const obj = payload as { ok?: boolean; error?: string } | null;
  if (!res.ok || (obj && obj.ok === false)) {
    const message =
      obj && typeof obj.error === 'string' && obj.error.trim().length > 0
        ? obj.error
        : `فشل الطلب (رمز الحالة ${res.status}).`;
    throw new ApiError(message);
  }

  if (payload === null) {
    throw new ApiError(`استجابة غير متوقعة من الخادم (رمز الحالة ${res.status}).`);
  }

  return payload as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * مثل apiGet لكنه لا يعتبر `ok:false` خطأً — لأن بعض النقاط (نتيجة الأتمتة)
 * تُرجع `ok:false` كجزء من النتيجة التفصيلية التي يجب عرضها للمستخدم.
 * أخطاء HTTP الحقيقية (4xx/5xx) ما زالت تُرفع.
 */
export async function apiGetResult<T>(path: string): Promise<T> {
  return rawRequest<T>(path);
}

/** نظير apiGetResult: لا يعتبر `ok:false` خطأً. */
export async function apiPostResult<T>(path: string, body: unknown): Promise<T> {
  return rawRequest<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, init);
  } catch {
    throw new ApiError('تعذّر الاتصال بالخادم المحلي. تأكد من تشغيل الخادم ثم أعد المحاولة.');
  }

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const obj = payload as { error?: string } | null;
    const message =
      obj && typeof obj.error === 'string' && obj.error.trim().length > 0
        ? obj.error
        : `فشل الطلب (رمز الحالة ${res.status}).`;
    throw new ApiError(message);
  }

  if (payload === null) {
    throw new ApiError(`استجابة غير متوقعة من الخادم (رمز الحالة ${res.status}).`);
  }

  return payload as T;
}

/** يقرأ الملف ويُرجع محتواه base64 بدون البادئة data:*;base64, */
export function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ApiError('تعذّرت قراءة الملف المحدد.'));
    reader.onabort = () => reject(new ApiError('تم إلغاء قراءة الملف.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim().length > 0) return err;
  return 'حدث خطأ غير متوقع أثناء تنفيذ الطلب.';
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** تاريخ اليوم بصيغة YYYY-MM-DD بحسب توقيت الجهاز */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** تنسيق ISO إلى عرض عربي مقروء: 2026/10/27 — 12:30 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} — ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* تجاهل وانتقل إلى الطريقة البديلة */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'true');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
