/**
 * The marketing site's origin.
 *
 * The app and the marketing site are two Vercel projects on two hosts:
 * app.kandryn.com serves this SPA, kandryn.com serves the Next.js site. A
 * root-relative link like href="/contact/" therefore resolves against
 * app.kandryn.com, where no such route exists — it falls through the router
 * to the catch-all, which is wrapped in RequireAuth, and Clerk bounces an
 * anonymous visitor to /sign-in?redirect_url=… That is how the sign-in page's
 * own "Request access" link sent people back to sign-in.
 *
 * Any link from the app to a marketing page must be absolute. This constant
 * exists so that is stated once rather than remembered twice.
 */
export const MARKETING_ORIGIN = 'https://kandryn.com';

/** Absolute URL for a marketing path, e.g. marketingUrl('/contact/'). */
export function marketingUrl(path: string): string {
  return `${MARKETING_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}
