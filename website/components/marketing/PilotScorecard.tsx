/**
 * The pilot scorecard, as a usable artifact.
 *
 * Two tables rather than one. The blank one is what a team fills in; the
 * worked one is an invented illustration. Merging them would put a sample
 * number in the row a reader is about to write a measured number into, and
 * the two would become indistinguishable the moment anyone screenshots it.
 */

const ROWS: [string, string][] = [
  ['Baseline', 'How this kind of request is handled today, and how long it usually takes.'],
  ['Time to a reviewable proposal', 'From the work item being ready to a proposed change your team can read.'],
  ['Clarification effort', 'Time your engineers spent working out what the request actually meant.'],
  ['Reviewer corrections', 'What the business and engineering reviewers asked to change, and why.'],
  ['Checks performed', 'Which checks ran, who triggered them, and what they reported.'],
  ['Acceptance decision', 'Accepted, accepted with changes, or not accepted. Name the owner of the decision.'],
];

const SAMPLE: [string, string][] = [
  ['Baseline', 'Report changes of this size usually take about a week of elapsed time, mostly waiting on clarification.'],
  ['Time to a reviewable proposal', 'Same working day.'],
  ['Clarification effort', 'One question, about whether weekends count.'],
  ['Reviewer corrections', 'Operations asked for the waiting period to be shown as its own column.'],
  ['Checks performed', 'Security scan, run by the engineering lead. No high findings.'],
  ['Acceptance decision', 'Accepted with changes. Owner: the claims operations lead.'],
];

const TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-neutral-600)',
  width: '34%',
};
const TD: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: 14.5,
  lineHeight: 1.5,
  borderTop: '1px solid var(--color-divider)',
  verticalAlign: 'top',
};

function Card({ title, note, rows, blank }: { title: string; note: string; rows: [string, string][]; blank?: boolean }) {
  return (
    <div className="panel panel-pad">
      <h3 className="h3">{title}</h3>
      <p className="body-2" style={{ marginTop: 8 }}>{note}</p>
      <div className="scroll-x" style={{ overflowX: 'auto', marginTop: 18 }}>
        <table style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row" style={{ ...TH, borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)', textTransform: 'none', fontSize: 14.5, letterSpacing: 0 }}>
                  {k}
                </th>
                <td style={{ ...TD, color: blank ? 'var(--color-neutral-600)' : 'var(--color-text)' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PilotScorecard() {
  return (
    <div className="cols-2" style={{ marginTop: 4 }}>
      <Card
        title="Your scorecard"
        note="Copy these six rows. Agree the baseline before the pilot starts, not after."
        rows={ROWS}
        blank
      />
      <Card
        title="A worked row, invented for illustration"
        note="These values are made up. They show the shape of a useful answer, not a result anyone measured."
        rows={SAMPLE}
      />
    </div>
  );
}
