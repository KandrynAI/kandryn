import Link from 'next/link';
import type { ReactNode, CSSProperties } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

interface BtnProps {
  variant?: Variant;
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

/** Flush-left button. Renders a Next Link when `href` is set, else a <button>. */
export default function Btn({
  variant = 'primary',
  href,
  onClick,
  type = 'button',
  children,
  className = '',
  style,
  ariaLabel,
}: BtnProps) {
  const cls = `btn btn-${variant} ${className}`.trim();
  if (href) {
    const external = href.startsWith('/app') || href.startsWith('http');
    if (external) {
      return (
        <a className={cls} href={href} style={style} aria-label={ariaLabel}>
          {children}
        </a>
      );
    }
    return (
      <Link className={cls} href={href} style={style} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} type={type} onClick={onClick} style={style} aria-label={ariaLabel}>
      {children}
    </button>
  );
}
