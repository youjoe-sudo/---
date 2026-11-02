import { useState } from 'react';
import { apiGet } from './api';
import { Sidebar } from './components/Sidebar';
import { useResource } from './hooks';
import { Attendance } from './pages/Attendance';
import { Automation } from './pages/Automation';
import { Dashboard } from './pages/Dashboard';
import { ExportPage } from './pages/ExportPage';
import { PdfImport } from './pages/PdfImport';
import { SettingsPage } from './pages/SettingsPage';
import { Students } from './pages/Students';
import type { MetaResponse, PageId } from './types';

export default function App() {
  const [page, setPage] = useState<PageId>('dashboard');
  const [navOpen, setNavOpen] = useState(false);

  const meta = useResource<MetaResponse>(() => apiGet<MetaResponse>('/meta'), []);

  function navigate(next: PageId) {
    setPage(next);
    setNavOpen(false);
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }

  function renderPage() {
    switch (page) {
      case 'dashboard':
        return <Dashboard meta={meta} onNavigate={navigate} />;
      case 'import':
        return <PdfImport meta={meta} />;
      case 'students':
        return <Students meta={meta} />;
      case 'attendance':
        return <Attendance />;
      case 'export':
        return <ExportPage meta={meta} />;
      case 'automation':
        return <Automation meta={meta} />;
      case 'settings':
        return <SettingsPage />;
      default:
        return null;
    }
  }

  return (
    <div className="app">
      <Sidebar
        current={page}
        onNavigate={navigate}
        open={navOpen}
        onToggle={() => setNavOpen((v) => !v)}
        directorate={meta.data?.directorate}
        administration={meta.data?.administration}
      />
      <div className="main">
        <div className="topbar">
          <span className="topbar-org">{meta.data?.directorate || 'مديري التربية والتعليم بالشرقية'}</span>
          <span className="topbar-sep" aria-hidden="true">
            •
          </span>
          <span className="topbar-org">{meta.data?.administration || 'غـرب الزقازيق'}</span>
        </div>
        <main className="content" id="main-content">
          {renderPage()}
        </main>
        <footer className="page-foot">
          تطبيق متابعة الغياب اليومي — جميع البيانات المعروضة تصل من الخادم المحلي ولا تُعرض أي بيانات تجريبية.
        </footer>
      </div>
    </div>
  );
}
