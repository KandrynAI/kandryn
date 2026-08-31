// The 8 contexts where a logo appears in Kandryn.
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

// The brand ships three colourways and its guidelines forbid recolouring, so
// these are the only variants that exist as files.
export type LogoVariant =
  | 'slate' // #1D4E76 — primary brand colour, light backgrounds
  | 'ink' // #141821 — single-colour print
  | 'white'; // #FFFFFF — on dark backgrounds

export type LogoType = 'full' | 'mark';

// The decision table — context → variant.
export const LOGO_CONTEXT_MAP: Record<
  LogoContext,
  { variant: LogoVariant; type: LogoType; note: string }
> = {
  'nav-light': { variant: 'slate', type: 'full', note: 'White/light nav — primary slate lockup' },
  'nav-dark': { variant: 'white', type: 'full', note: 'Dark/navy nav — white lockup' },
  'footer-light': { variant: 'slate', type: 'full', note: 'Light footer — primary slate lockup' },
  'footer-dark': { variant: 'white', type: 'full', note: 'Dark footer — white lockup' },
  signin: { variant: 'slate', type: 'full', note: 'Sign-in card on white — primary slate lockup' },
  sidebar: { variant: 'slate', type: 'mark', note: 'App rail — mark only, brand slate' },
  print: { variant: 'ink', type: 'full', note: 'PDF/print — single-colour ink' },
  email: { variant: 'slate', type: 'full', note: 'Email — primary slate lockup on white' },
};
