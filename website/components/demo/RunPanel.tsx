export default function RunPanel({
  autoCommit,
  setAutoCommit,
  scheduleOn,
  setScheduleOn,
  onRunNow,
  onClose,
}: {
  autoCommit: boolean;
  setAutoCommit: (v: boolean) => void;
  scheduleOn: boolean;
  setScheduleOn: (v: boolean) => void;
  onRunNow: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(22,27,36,0.35)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 5,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: '100%',
          background: '#ffffff',
          borderLeft: '2px solid var(--color-text)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '2px solid var(--color-divider)' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Run agents on PAY-214</div>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 4 }}>
            Idempotency keys on the refund endpoint
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
          <div className="field">
            <label htmlFor="demo-refine">Refinement prompt</label>
            <textarea
              id="demo-refine"
              className="input"
              rows={4}
              style={{ resize: 'none' }}
              defaultValue=""
              placeholder="Follow the existing Drizzle transaction helper; keep the response shape unchanged."
            />
          </div>

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoCommit}
              onChange={(e) => setAutoCommit(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              <strong style={{ fontWeight: 700 }}>Auto-commit the top suggestion</strong>
              <br />
              <span style={{ color: 'var(--color-neutral-700)' }}>Opens the PR without waiting for you.</span>
            </span>
          </label>

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={scheduleOn}
              onChange={(e) => setScheduleOn(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              <strong style={{ fontWeight: 700 }}>Schedule for later</strong>
              <br />
              <span style={{ color: 'var(--color-neutral-700)' }}>
                The dispatcher picks it up within five minutes of the time you set.
              </span>
            </span>
          </label>

          {scheduleOn && (
            <div className="field">
              <label htmlFor="demo-when">Run at</label>
              <input id="demo-when" className="input" type="datetime-local" defaultValue="2026-07-30T21:00" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '16px 20px',
            borderTop: '2px solid var(--color-divider)',
          }}
        >
          <button className="btn btn-primary" onClick={onRunNow}>
            {scheduleOn ? 'Schedule run' : 'Run now'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
