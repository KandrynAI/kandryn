import type { LogoContext, LogoVariant, LogoType } from '../../../../shared/types/logo';
import { LOGO_CONTEXT_MAP } from '../../../../shared/types/logo';

interface LogoProps {
  context: LogoContext;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  variant?: LogoVariant;
  type?: LogoType;
}

/**
 * Context-aware Blue Mantis logo (app / Vite build — plain <img>).
 * Picks the correct variant + full-vs-mark from LOGO_CONTEXT_MAP unless overridden.
 * SVGs are served from /logos/{logo|mark}-{variant}.svg (BASE_URL-prefixed for /app).
 */
export function Logo({
  context,
  height = 28,
  className,
  style,
  variant: variantOverride,
  type: typeOverride,
}: LogoProps) {
  const resolved = LOGO_CONTEXT_MAP[context];
  const variant = variantOverride ?? resolved.variant;
  const type = typeOverride ?? resolved.type;

  const prefix = type === 'mark' ? 'mark-' : 'logo-';
  const src = `${import.meta.env.BASE_URL}logos/${prefix}${variant}.svg`;

  // Width from original SVG viewBox ratios:
  // Full lockup 312×76 → 4.105 · Mark only 117×76 → 1.539
  const ratio = type === 'mark' ? 1.539 : 4.105;
  const width = Math.round(height * ratio);

  return (
    <img
      src={src}
      alt="Blue Mantis"
      width={width}
      height={height}
      className={className}
      style={style}
      draggable={false}
    />
  );
}
