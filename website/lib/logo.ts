// The 8 contexts where a logo appears in Blue Mantis.
// The Logo component uses this to pick the right variant automatically.
export type LogoContext =
  | 'nav-light' // top nav on white/light backgrounds
  | 'nav-dark' // top nav on dark/navy backgrounds
  | 'footer-light' // footer on white/light backgrounds
  | 'footer-dark' // footer on dark/navy backgrounds
  | 'signin' // sign-in page (white background)
  | 'sidebar' // app CommandRail (white sidebar)
  | 'print' // PDF exports, reports
  | 'email'; // transactional emails (white bg)

export type LogoVariant =
  | 'signal-blue' // #076DF2 — primary brand
  | 'midnight-navy' // #0A1F44 — formal/dark
  | 'black' // #000000 — print
  | 'white' // #FFFFFF — on dark bg
  | 'slate-grey' // #64748B — muted
  | 'duo-blue-navy' // mark blue + wordmark navy
  | 'duo-cyan-white' // mark cyan + wordmark white (dark bg)
  | 'duo-orange-black'; // mark orange + wordmark black

export type LogoType = 'full' | 'mark';

// The decision table — context → variant.
export const LOGO_CONTEXT_MAP: Record<
  LogoContext,
  { variant: LogoVariant; type: LogoType; note: string }
> = {
  'nav-light': { variant: 'duo-blue-navy', type: 'full', note: 'White/light nav — blue mark, navy wordmark' },
  'nav-dark': { variant: 'duo-cyan-white', type: 'full', note: 'Dark/navy nav — cyan mark, white wordmark' },
  'footer-light': { variant: 'slate-grey', type: 'full', note: 'Light footer — muted, does not compete' },
  'footer-dark': { variant: 'duo-cyan-white', type: 'full', note: 'Dark footer — cyan mark, white wordmark' },
  signin: { variant: 'duo-blue-navy', type: 'full', note: 'Sign-in card on white — blue mark, navy wordmark' },
  sidebar: { variant: 'signal-blue', type: 'mark', note: 'App rail — mark only, brand blue' },
  print: { variant: 'midnight-navy', type: 'full', note: 'PDF/print — navy, no blue halftone risk' },
  email: { variant: 'duo-blue-navy', type: 'full', note: 'Email — blue mark, navy wordmark on white' },
};
