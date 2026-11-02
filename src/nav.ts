import type { ComponentType } from 'react';
import {
  Bot,
  CalendarX,
  FileSpreadsheet,
  FileUp,
  LayoutDashboard,
  Settings,
  Users,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { PageId } from './types';

export interface NavItem {
  id: PageId;
  label: string;
  hint: string;
  icon: ComponentType<LucideProps>;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', hint: 'نظرة عامة على البيانات', icon: LayoutDashboard },
  { id: 'import', label: 'استيراد كشف PDF', hint: 'استيراد قوائم الفصول', icon: FileUp },
  { id: 'students', label: 'الطلاب', hint: 'بحث وتعديل السجلات', icon: Users },
  { id: 'attendance', label: 'غياب اليوم', hint: 'تحديد الغائبين', icon: CalendarX },
  { id: 'export', label: 'تصدير Excel', hint: 'إنشاء ملف الغياب', icon: FileSpreadsheet },
  { id: 'automation', label: 'الإدخال إلى الموقع', hint: 'تشغيل الأتمتة', icon: Bot },
  { id: 'settings', label: 'الإعدادات', hint: 'ضبط النظام', icon: Settings },
];

export const PAGE_TITLE: Record<PageId, string> = {
  dashboard: 'لوحة التحكم',
  import: 'استيراد كشف PDF',
  students: 'الطلاب',
  attendance: 'غياب اليوم',
  export: 'تصدير Excel',
  automation: 'الإدخال إلى الموقع (الأتمتة)',
  settings: 'الإعدادات',
};

export const PAGE_SUBTITLE: Record<PageId, string> = {
  dashboard: 'ملخّص البيانات الحقيقية وحالة النظام',
  import: 'قراءة كشف الحضور والغياب من ملف PDF ومراجعته قبل الحفظ',
  students: 'البحث في سجلات الطلاب وتعديل الأسماء مباشرة',
  attendance: 'تحديد الغائبين لكل صف في التاريخ المختار',
  export: 'إنشاء ملف Excel بالغائبين وتنزيله',
  automation: 'تشغيل الإدخال التلقائي إلى موقع الإدارة مع الدليل',
  settings: 'إعدادات الموقع والمتصفح ومجلد التصدير',
};
