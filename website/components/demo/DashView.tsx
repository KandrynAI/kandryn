import { DEMO_DASH_STATS, DEMO_RECENT_RUNS } from '@/lib/site';

export default function DashView({
  phase,
  committedCount,
}: {
  phase: 'running' | 'done' | 'committed';
  committedCount: number;
}) {
  return (
    <div style={{ padding: '22px 24px 28px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', paddingBottom: 16, borderBottom: '2px solid var(--color-divider)' }}>
        This week
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '2px solid var(--color-divider)' }}>
        {DEMO_DASH_STATS.map((s) => {
          const value = s.label === 'SUGGESTIONS COMMITTED' ? String(committedCount) : s.value;
          return (
            <div key={s.label} style={{ padding: '26px 24px 26px 0' }}>
              <div style={{ fontSize: 46, fontWeight: 900, letterSpacing: '-0.03em' }}>{value}</div>
              <div style={{ fontSize: 12, letterSpacing: '0.08em', color: 'var(--color-neutral-700)', marginTop: 6 }}>{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Recent runs */}
      <table className="table" style={{ marginTop: 20 }}>
        <thead>
          <tr>
            <th>Run</th>
            <th>Work item</th>
            <th>Trigger</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {DEMO_RECENT_RUNS.map((r, i) => (
            <tr key={r.id}>
              <td style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.id}</td>
              <td>{r.item}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{r.trigger}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {i === 0 && phase === 'committed' ? 'Committed · PR #318' : r.result}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
