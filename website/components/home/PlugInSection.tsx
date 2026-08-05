import Btn from '@/components/ui/Btn';

const PLUG_ROWS = [
  ['Jira', 'Syncs the epic→story→task hierarchy into a board and writes items and test cases back on request.'],
  ['Azure DevOps', 'The same sync against Azure Boards, with Feature mapped onto epic.'],
  ['GitHub', 'Branch, commit and pull request, with stack detection on connect. The primary provider.'],
  ['Azure Repos', 'Commits and pull requests against an existing file tree.'],
  ['Raptia · Fovea · Synthesia · Veria', 'Four agents, one pipeline per run'],
];

const DONT = [
  ['We don’t hold shared credentials.', 'Every key is stored against your user record and tested the moment you save it. No pooled key, no environment fallback in production.'],
  ['We don’t merge anything.', 'Blue Mantis opens the pull request. Your review rules and your CI decide whether it lands.'],
  ['We don’t rewrite your board.', 'Items and test cases go upstream only when you ask. The single automatic write-back is a status change when an item closes.'],
  ['We don’t guess your stack.', 'Stack detection reads the bound repository so the agents write your framework, not generic pseudocode.'],
];

export default function PlugInSection() {
  return (
    <section
      className="stack-1"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        borderTop: '2px solid var(--color-divider)',
      }}
    >
      {/* LEFT — where it plugs in */}
      <div className="pad-x" style={{ padding: '56px 64px', borderRight: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 20 }}>
          Where it plugs in
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th>System</th>
              <th>What Blue Mantis does</th>
            </tr>
          </thead>
          <tbody>
            {PLUG_ROWS.map(([sys, what]) => (
              <tr key={sys}>
                <td style={{ fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>{sys}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 20 }}>
          <Btn variant="secondary" href="/integrations">All integrations</Btn>
        </div>
      </div>

      {/* RIGHT — what we don't do */}
      <div className="pad-x" style={{ padding: '56px 64px' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 20 }}>
          What we don&apos;t do
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {DONT.map(([lead, body]) => (
            <p
              key={lead}
              style={{
                fontSize: 15,
                lineHeight: 1.5,
                color: 'var(--color-neutral-800)',
                borderTop: '1px solid var(--color-neutral-300)',
                paddingTop: 14,
                textWrap: 'pretty',
              }}
            >
              <strong style={{ fontWeight: 800, color: 'var(--color-text)' }}>{lead}</strong> {body}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
