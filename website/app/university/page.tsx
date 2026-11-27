import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero, Section, CtaBlock } from '@/components/marketing/ui';
import { LESSONS } from '@/lib/content/lessons';

export const metadata: Metadata = {
  alternates: { canonical: '/university/' },
  title: 'Kandryn University',
  description:
    'Follow one request from its source rule to a proposed implementation. Three lessons with an exercise and a sample answer, each finishable on this page.',
};

export default function UniversityPage() {
  return (
    <>
      <PageHero
        eyebrow="Kandryn University"
        h1="Learn Kandryn on a real business change."
        lead="Follow one request from its source rule to a proposed implementation. Choose the lesson that fits your role, then use the exercise to prepare for your own pilot."
      />
      <Section>
        <ol style={{ display: 'grid', gap: 18 }}>
          {LESSONS.map((l) => (
            <li key={l.slug}>
              <Link href={`/university/${l.slug}`} className="card-link">
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--color-accent)',
                  }}
                >
                  Lesson {l.n} &middot; {l.minutes}
                </span>
                <span className="h3" style={{ display: 'block', marginTop: 8 }}>{l.title}</span>
                <span className="body-2" style={{ display: 'block', marginTop: 8 }}>For {l.audience.toLowerCase()}.</span>
                <span className="arrowlink" style={{ display: 'block', marginTop: 14 }}>Start the lesson &rarr;</span>
              </Link>
            </li>
          ))}
        </ol>
      </Section>
      <CtaBlock
        h2="Ready to try it on your own work?"
        body="The pilot guide sets out what to bring, how to run it, and how to decide together whether the result was worth it."
        primary={{ label: 'See the pilot guide', href: '/pilot-guide' }}
        secondary={{ label: 'Request a walkthrough', href: '/contact' }}
      />
    </>
  );
}
