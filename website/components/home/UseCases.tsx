import { USE_CASES, USE_CASES_HEADING, USE_CASES_LEAD } from '@/lib/home';

/**
 * Section 3 — jobs, not adjectives.
 *
 * This replaces the "why us" prose the old page carried. A visitor deciding
 * whether Kandryn is for them is trying to picture a ticket from their own
 * board, and four concrete ones do that faster than any paragraph about
 * competing proposals.
 */
export default function UseCases() {
  return (
    <section
      className="pad-x"
      style={{ padding: '76px 64px', borderBottom: '2px solid var(--color-divider)' }}
    >
      <h2 style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.025em' }}>{USE_CASES_HEADING}</h2>
      <p
        style={{
          marginTop: 12,
          maxWidth: 640,
          fontSize: 17,
          lineHeight: 1.5,
          color: 'var(--color-neutral-800)',
          textWrap: 'pretty',
        }}
      >
        {USE_CASES_LEAD}
      </p>

      <ul
        className="grid-2 stack-1"
        style={{
          marginTop: 36,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          borderTop: '2px solid var(--color-divider)',
          borderLeft: '2px solid var(--color-divider)',
        }}
      >
        {USE_CASES.map((c) => (
          <li
            key={c.title}
            style={{
              borderRight: '2px solid var(--color-divider)',
              borderBottom: '2px solid var(--color-divider)',
              padding: '26px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <span className="tag tag-outline" style={{ alignSelf: 'flex-start' }}>
              {c.tag}
            </span>
            <span style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.35, textWrap: 'pretty' }}>
              {c.title}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
