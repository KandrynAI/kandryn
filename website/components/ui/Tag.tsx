import type { ReactNode } from 'react';

export default function Tag({
  variant = 'outline',
  children,
}: {
  variant?: 'accent' | 'outline';
  children: ReactNode;
}) {
  return <span className={`tag tag-${variant}`}>{children}</span>;
}
