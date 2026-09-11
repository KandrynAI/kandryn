/**
 * Strings Kandryn stamps onto a customer's repository.
 *
 * These are the product's externally visible identity — a pull request title a
 * reviewer reads, and a commit status context a branch protection rule is
 * configured against. They live here, shared, because the API server writes
 * them and the app's setup instructions tell people what to type: two literals
 * that must agree, in two packages that cannot import each other's internals.
 *
 * Renaming SECURITY_CHECK_CONTEXT is a breaking change for any repository whose
 * branch protection already requires the old name — that rule silently stops
 * being satisfiable. Any change here needs a re-configuration step for every
 * repository already relying on it.
 */

/** Prefix on every pull request Kandryn opens. */
export const PR_TITLE_PREFIX = '[Kandryn]';

/** GitHub commit status context for the Aegis security gate. */
export const SECURITY_CHECK_CONTEXT = 'kandryn/security';

/**
 * The same identifier in the shape Azure DevOps wants it.
 *
 * ADO models a status identifier as a {genre, name} pair and renders it back to
 * the user as "genre/name" — the string they type into a branch policy. Derived
 * from the one constant above rather than written out again, so the two
 * providers can never end up advertising different check names.
 */
export function securityCheckGenreName(): { genre: string; name: string } {
  const slash = SECURITY_CHECK_CONTEXT.indexOf('/');
  return {
    genre: SECURITY_CHECK_CONTEXT.slice(0, slash),
    name: SECURITY_CHECK_CONTEXT.slice(slash + 1),
  };
}
