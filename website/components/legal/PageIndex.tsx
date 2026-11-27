import type { ReactNode } from 'react';

export interface IndexItem {
  /** The id of the section this links to. Must already exist on the page. */
  id: string;
  label: string;
}

/**
 * The contents of a long reference page, twice.
 *
 * One component emits both a sticky desktop rail and a compact mobile index,
 * and CSS decides which is on screen. Two components would be two lists to
 * keep in step, and the one that drifts is always the mobile one.
 *
 * No JavaScript and no scroll-spy. These are anchors on a static page: they
 * work before hydration, they survive find-in-page, and a reader who lands on
 * /trust/#sub-processors from a questionnaire gets exactly where they asked
 * for. Highlighting the section currently in view would be nice and would
 * cost a client component on a page whose job is to be readable.
 */
export default function PageIndex({
  items,
  title = 'On this page',
}: {
  items: IndexItem[];
  title?: string;
}): ReactNode {
  const links = items.map((i) => (
    <li key={i.id}>
      <a href={`#${i.id}`}>{i.label}</a>
    </li>
  ));

  return (
    <>
      <nav className="doc-rail" aria-label={title}>
        <h2 className="doc-rail-title">{title}</h2>
        <ol className="doc-rail-list">{links}</ol>
      </nav>

      {/* Closed by default on a phone: an open fifteen-item list would push
          the first paragraph off the screen on the page people arrive at
          with one specific question. */}
      <details className="doc-index">
        <summary>{title}</summary>
        <ol className="doc-rail-list">{links}</ol>
      </details>
    </>
  );
}
