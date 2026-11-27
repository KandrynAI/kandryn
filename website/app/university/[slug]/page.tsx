import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHero, Section, LinkRow } from '@/components/marketing/ui';
import { LESSONS, lessonBySlug } from '@/lib/content/lessons';
import PilotScorecard from '@/components/marketing/PilotScorecard';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return LESSONS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const lesson = lessonBySlug(slug);
  if (!lesson) return {};
  return {
    alternates: { canonical: `/university/${lesson.slug}/` },
    title: `Lesson ${lesson.n}: ${lesson.title.replace(/\.$/, '')}`,
    description: lesson.metaDescription,
  };
}

export default async function LessonPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const lesson = lessonBySlug(slug);
  if (!lesson) notFound();

  const index = LESSONS.findIndex((l) => l.slug === lesson.slug);
  const prev = index > 0 ? LESSONS[index - 1] : null;
  const next = index < LESSONS.length - 1 ? LESSONS[index + 1] : null;

  return (
    <>
      <PageHero eyebrow={`Kandryn University · Lesson ${lesson.n}`} h1={lesson.title}>
        <p className="body-2" style={{ marginTop: 18 }}>
          For {lesson.audience.toLowerCase()}. About {lesson.minutes}.
        </p>
        <p style={{ marginTop: 14 }}>
          <Link href="/university" className="arrowlink">All lessons &rarr;</Link>
        </p>
      </PageHero>

      <Section h2="The lesson">
        <p className="lead-2">{lesson.lesson}</p>
      </Section>

      <Section quiet h2="Your exercise">
        <p className="lead-2">{lesson.exercise}</p>

        <details className="disclose" style={{ marginTop: 26 }}>
          <summary>Show a sample answer</summary>
          <div>
            {lesson.sampleAnswer ? (
              <p className="body-2">{lesson.sampleAnswer}</p>
            ) : (
              <PilotScorecard />
            )}
          </div>
        </details>
      </Section>

      {lesson.related && (
        <Section h2="Go deeper">
          <LinkRow links={lesson.related} />
        </Section>
      )}

      <Section>
        <nav
          aria-label="Lessons"
          style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}
        >
          {prev ? (
            <Link href={`/university/${prev.slug}`} className="arrowlink">
              &larr; Lesson {prev.n}: {prev.title.replace(/\.$/, '')}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/university/${next.slug}`} className="arrowlink">
              Lesson {next.n}: {next.title.replace(/\.$/, '')} &rarr;
            </Link>
          ) : (
            <Link href="/pilot-guide" className="arrowlink">
              Next: the pilot guide &rarr;
            </Link>
          )}
        </nav>
      </Section>
    </>
  );
}
