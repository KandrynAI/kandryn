import { ReviewClock } from '@/components/marketing/visuals';
import { IllustrativeTag } from '@/components/marketing/ui';

/**
 * The homepage example.
 *
 * Both controls are native <details>, so they open with a keyboard, survive
 * a failed script, and are announced as expandable without any aria of our
 * own. The rule and the result are plain HTML text above them: the point of
 * the section is lost if the number only exists inside a collapsed panel.
 */
export default function ClaimsExample() {
  return (
    <div className="panel panel-pad" style={{ marginTop: 32 }}>
      <IllustrativeTag />

      <dl className="kv" style={{ marginTop: 18 }}>
        <dt>Request</dt>
        <dd>Show the number of days a claim spent in review.</dd>
        <dt>Source</dt>
        <dd>Sample claims operations guide</dd>
        <dt>Operating rule</dt>
        <dd>Pause the review clock while requested documents are outstanding.</dd>
      </dl>

      <div style={{ marginTop: 26 }}>
        <ReviewClock
          caption="Two days in review, three waiting for documents, one more day in review."
          segments={[
            { days: 2, label: 'In review', counts: true },
            { days: 3, label: 'Waiting for documents', counts: false },
            { days: 1, label: 'In review', counts: true },
          ]}
        />
      </div>

      <p
        style={{
          marginTop: 22,
          paddingTop: 18,
          borderTop: '1px solid var(--color-divider)',
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-0.015em',
          color: 'var(--color-accent-700)',
        }}
      >
        3 review days across 6 elapsed days.
      </p>

      <div className="cols-2" style={{ marginTop: 24 }}>
        <div>
          <h3 className="h3" style={{ fontSize: 16 }}>Business review</h3>
          <p className="body-2" style={{ marginTop: 6 }}>
            Does this match how our claims team measures review time?
          </p>
        </div>
        <div>
          <h3 className="h3" style={{ fontSize: 16 }}>Engineering review</h3>
          <p className="body-2" style={{ marginTop: 6 }}>
            Does the calculation exclude waiting periods and resume when review restarts?
          </p>
        </div>
      </div>

      <div style={{ marginTop: 26 }}>
        <details className="disclose">
          <summary>See the source rule</summary>
          <blockquote
            style={{
              margin: 0,
              padding: '14px 18px',
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              borderLeft: '3px solid var(--color-accent-300)',
            }}
          >
            <p className="body-2" style={{ color: 'var(--color-text)' }}>
              &ldquo;A claim remains open while the carrier awaits requested documents. Time spent awaiting those
              documents is not counted as review time. The review clock resumes when the documents are received.&rdquo;
            </p>
            <footer className="body-2" style={{ marginTop: 10 }}>
              Sample claims operations guide. This excerpt is written for illustration. It is not a real carrier
              document, and a run records references to the material it used rather than storing passages like this.
            </footer>
          </blockquote>
        </details>

        <details className="disclose">
          <summary>Inspect the proposed change</summary>
          <div>
            <p className="body-2">
              The calculation accumulates the intervals a claim spent in a review state and ignores the rest, instead
              of subtracting the open date from today.
            </p>
            <pre
              style={{
                margin: '14px 0 0',
                padding: '16px 18px',
                background: 'var(--color-neutral-900)',
                color: '#e8efed',
                borderRadius: 'var(--radius-md)',
                overflowX: 'auto',
                fontSize: 13,
                lineHeight: 1.65,
              }}
            >
{`reviewDays(claim) =
  sum of (end - start) for each interval
  where interval.state is "in review"`}
            </pre>
            <p className="body-2" style={{ marginTop: 16, fontWeight: 600, color: 'var(--color-text)' }}>
              Acceptance test
            </p>
            <p className="body-2" style={{ marginTop: 6 }}>
              Given 2 days in review, then 3 days awaiting documents, then 1 day in review, the report shows 3 review
              days and 6 elapsed days.
            </p>
            <p className="body-2" style={{ marginTop: 10 }}>
              Illustrative. The shape of a real proposal depends on your repository.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
