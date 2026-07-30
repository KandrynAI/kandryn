import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const alt = 'Blue Mantis — the backlog writes the code back to you';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Static OG image in the marketing design system: white ground, black text,
// one blue accent. Sharp corners, flush left.
const BG = '#ffffff';
const TEXT = '#161b24';
const DIM = '#586373';
const BLUE = '#1a4fd6';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BG,
          padding: '72px 80px',
          borderBottom: `12px solid ${BLUE}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: TEXT, fontSize: 34, fontWeight: 800 }}>
          <div style={{ width: 26, height: 26, background: BLUE }} />
          Blue Mantis
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: TEXT, fontSize: 76, fontWeight: 800, lineHeight: 1.0, letterSpacing: '-0.035em', maxWidth: 1000 }}>
            The backlog writes the code back to you.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 40 }}>
            <div style={{ width: 10, height: 10, background: BLUE }} />
            <div style={{ color: DIM, fontSize: 26 }}>Two models, one ranked shortlist, and the pull request · getbluemantis.com</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
