/**
 * Display logic for the UI style tab, kept out of the .tsx so it can be
 * tested — the dev-copilot runner strips types but does not compile JSX.
 */

export interface StyleToken {
  name: string;
  value: string;
  scope?: string;
  source: { file: string; line: number };
}

export interface StyleComponent {
  name: string;
  path: string;
  group: 'primitive' | 'composed';
  importPath: string;
  usedBy: number | null;
  hasVariants?: boolean;
}

export type StyleStatus = 'none' | 'pending' | 'extracting' | 'ready' | 'not_applicable' | 'failed';

/** The chip a status plus staleness reads as. */
export function statusLabel(status: StyleStatus, stale: boolean): string {
  if (status === 'ready') return stale ? 'Out of date' : 'Ready';
  if (status === 'pending' || status === 'extracting') return 'Analyzing';
  if (status === 'not_applicable') return 'Not applicable';
  if (status === 'failed') return 'Failed';
  return 'Not analyzed';
}

/** Whether the tab should keep polling. */
export function isSettling(status: StyleStatus): boolean {
  return status === 'pending' || status === 'extracting';
}

/**
 * Split colour tokens into the light and dark sets a reader expects.
 *
 * A token declared under `.dark` is the dark value of the same name, so
 * showing them in one list would put two different colours under one label
 * and leave the reader to guess which is which.
 */
export function groupColorsByScheme(tokens: StyleToken[]): {
  light: StyleToken[];
  dark: StyleToken[];
} {
  const dark: StyleToken[] = [];
  const light: StyleToken[] = [];
  for (const t of tokens) {
    const scope = (t.scope ?? '').toLowerCase();
    if (scope.includes('.dark') || scope.includes('dark"') || scope.includes("dark'")) dark.push(t);
    else light.push(t);
  }
  return { light, dark };
}

/** A CSS value that a swatch can render as a colour, or null. */
export function swatchColor(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^(rgb|rgba|hsl|hsla|oklch|lab|lch|color)\s*\(/i.test(v)) return v;
  // A bare "0 0% 100%" is a Tailwind-style HSL triplet, meaningless alone.
  return null;
}

/** Components grouped for the table, primitives first, order preserved. */
export function orderComponents(components: StyleComponent[]): StyleComponent[] {
  return [...components].sort((a, b) => {
    if (a.group !== b.group) return a.group === 'primitive' ? -1 : 1;
    if (a.usedBy != null && b.usedBy != null && a.usedBy !== b.usedBy) return b.usedBy - a.usedBy;
    return a.name.localeCompare(b.name);
  });
}

/** "src/index.css:14" — the evidence line shown on hover. */
export function evidenceLabel(source: { file: string; line: number }): string {
  return source.line > 0 ? `${source.file}:${source.line}` : source.file;
}

/** A short commit for the status row. */
export function shortRef(ref: string | null | undefined): string {
  return ref ? ref.slice(0, 7) : '—';
}
