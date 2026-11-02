import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { VerificationStatus } from '../types';
import { verificationLabel } from '../labels';

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

export function Badge({
  tone = 'muted',
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon}
      {children}
    </span>
  );
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return status === 'verified' ? (
    <Badge tone="ok" icon={<CircleCheck size={13} aria-hidden="true" />}>
      {verificationLabel(status)}
    </Badge>
  ) : (
    <Badge tone="warn" icon={<TriangleAlert size={13} aria-hidden="true" />}>
      {verificationLabel(status)}
    </Badge>
  );
}

export function StatusBanner({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'warning' | 'danger' | 'info';
  title: string;
  children?: ReactNode;
}) {
  const icons: Record<typeof tone, ReactNode> = {
    success: <CircleCheck size={18} aria-hidden="true" />,
    warning: <TriangleAlert size={18} aria-hidden="true" />,
    danger: <CircleAlert size={18} aria-hidden="true" />,
    info: <Info size={18} aria-hidden="true" />,
  };
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="banner-icon">{icons[tone]}</span>
      <div>
        <strong className="banner-title">{title}</strong>
        {children ? <div className="banner-text">{children}</div> : null}
      </div>
    </div>
  );
}
