import Image from 'next/image';
import type { LogoContext, LogoVariant, LogoType } from '../lib/logo';
import { LOGO_CONTEXT_MAP } from '../lib/logo';

interface LogoProps {
  context: LogoContext; // determines variant automatically
  height?: number; // px height (width auto-scales)
  className?: string;
  // Override automatic selection if needed:
  variant?: LogoVariant;
  type?: LogoType;
}

/**
 * Context-aware Kandryn logo (marketing site / Next.js — next/image).
 * Picks the correct variant + full-vs-mark from LOGO_CONTEXT_MAP unless overridden.
 * SVGs are served from /logos/{logo|mark}-{variant}.svg (public/logos).
 */
export function Logo({
  context,
  height = 28,
  className,
  variant: variantOverride,
  type: typeOverride,
}: LogoProps) {
  const resolved = LOGO_CONTEXT_MAP[context];
  const variant = variantOverride ?? resolved.variant;
  const type = typeOverride ?? resolved.type;

  const prefix = type === 'mark' ? 'mark-' : 'logo-';
  const src = `/logos/${prefix}${variant}.svg`;

  // Width from original SVG viewBox ratios:
  // Full lockup 312×76 → 4.105 · Mark only 117×76 → 1.539
  const ratio = type === 'mark' ? 1.539 : 4.105;
  const width = Math.round(height * ratio);

  return (
    <Image
      src={src}
      alt="Kandryn"
      width={width}
      height={height}
      className={className}
      priority={context === 'nav-light' || context === 'nav-dark'}
    />
  );
}

// Named exports for common fixed usages — no context prop needed.
export const LogoNavLight = (p: Omit<LogoProps, 'context'>) => <Logo context="nav-light" {...p} />;
export const LogoNavDark = (p: Omit<LogoProps, 'context'>) => <Logo context="nav-dark" {...p} />;
export const LogoFooterDark = (p: Omit<LogoProps, 'context'>) => <Logo context="footer-dark" {...p} />;
export const LogoSignIn = (p: Omit<LogoProps, 'context'>) => <Logo context="signin" {...p} />;
