import { Menu, School, X } from 'lucide-react';
import { NAV_ITEMS } from '../nav';
import type { PageId } from '../types';

interface SidebarProps {
  current: PageId;
  onNavigate: (id: PageId) => void;
  open: boolean;
  onToggle: () => void;
  directorate?: string;
  administration?: string;
}

export function Sidebar({ current, onNavigate, open, onToggle, directorate, administration }: SidebarProps) {
  return (
    <>
      <button
        type="button"
        className="menu-btn"
        onClick={onToggle}
        aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
        aria-expanded={open}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`.trim()}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <School size={22} />
          </span>
          <div>
            <p className="brand-title">متابعة الغياب اليومي</p>
            <p className="brand-sub">{directorate || 'مديري التربية والتعليم بالشرقية'}</p>
          </div>
        </div>

        <nav className="nav" aria-label="التنقل الرئيسي">
          <ul>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.id === current;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`nav-item ${active ? 'nav-item-active' : ''}`.trim()}
                    onClick={() => onNavigate(item.id)}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span className="nav-text">
                      <span className="nav-label">{item.label}</span>
                      <span className="nav-hint">{item.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <footer className="sidebar-foot">
          <p>{administration || 'غـرب الزقازيق'}</p>
          <p className="sidebar-foot-small">البيانات كلها من الخادم المحلي — لا تُعرض أي بيانات تجريبية.</p>
        </footer>
      </aside>
    </>
  );
}
