import type { AutomationStatus, VerificationStatus } from './types';

export const AUTOMATION_STATUS_LABEL: Record<AutomationStatus, string> = {
  success: 'نجح الإدخال (مع دليل مُتحقَّق منه)',
  needs_manual: 'يحتاج إدخالًا يدويًا',
  blocked_captcha: 'تم رصد اختبار روبوت — لا يمكن تجاوزه',
  missing_url: 'لم يتم ضبط رابط الموقع',
  error: 'خطأ',
  partial: 'اكتمل جزئيًا',
  idle: 'لا توجد عملية بعد',
};

export const AUTOMATION_STATUS_TONE: Record<AutomationStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  success: 'success',
  needs_manual: 'warning',
  blocked_captcha: 'danger',
  missing_url: 'warning',
  error: 'danger',
  partial: 'warning',
  idle: 'info',
};

export function verificationLabel(status: VerificationStatus): string {
  return status === 'verified' ? 'مؤكَّد' : 'يحتاج مراجعة';
}

export function levelLabel(level: string): string {
  switch (level.toLowerCase()) {
    case 'error':
      return 'خطأ';
    case 'warn':
    case 'warning':
      return 'تحذير';
    case 'info':
      return 'معلومة';
    case 'debug':
      return 'تنقيح';
    default:
      return level;
  }
}
