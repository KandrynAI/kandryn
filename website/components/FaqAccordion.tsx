import { FAQS } from '@/lib/site';

/**
 * FAQ disclosure list.
 *
 * This was a client accordion that rendered only the open answer. Three
 * problems followed from that: find-in-page could not reach a closed answer
 * on the one page people search rather than read, assistive tech could not
 * either, and the FAQPage JSON-LD declared every answer while the document
 * contained one.
 *
 * Native <details> fixes all three and needs no JavaScript, so the page ships
 * as static markup. The shared `name` keeps one open at a time where the
 * browser supports exclusive disclosure, and degrades to multi-open where it
 * does not — which is a fine outcome for an FAQ.
 */
export default function FaqAccordion() {
  return (
    <div className="pad-x" style={{ padding: '0 64px 56px' }}>
      {FAQS.map((f) => (
        <details key={f.q} name="faq" className="faq-item">
          <summary className="faq-q">{f.q}</summary>
          <p className="faq-a">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
