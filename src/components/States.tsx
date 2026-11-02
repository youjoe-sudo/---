import type { ReactNode } from 'react';
import { LoaderCircle, RefreshCw, TriangleAlert, Inbox } from 'lucide-react';

export function Loading({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={26} aria-hidden="true" />
      <p className="state-title">{label}</p>
      <p className="state-hint">يرجى الانتظار حتى يتم جلب البيانات من الخادم.</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block state-error" role="alert">
      <TriangleAlert size={26} aria-hidden="true" />
      <p className="state-title">تعذّر تحميل البيانات</p>
      <p className="state-hint">{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-outline" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" />
          إعادة المحاولة
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state-block state-empty" role="status">
      <Inbox size={26} aria-hidden="true" />
      <p className="state-title">{title}</p>
      {hint ? <p className="state-hint">{hint}</p> : null}
    </div>
  );
}

export function Card({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {title ? (
        <header className="card-head">
          <h2 className="card-title">
            {icon}
            {title}
          </h2>
          {action ? <div className="card-action">{action}</div> : null}
        </header>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
