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

// Brand mark (signal-blue mantis) embedded as a data URI for Satori.
const MARK = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMTcgNzYiIHdpZHRoPSIxMTciIGhlaWdodD0iNzYiIHJvbGU9ImltZyIgYXJpYS1sYWJlbD0iYmx1ZSBtYW50aXMgbWFyayI+PHBhdGggZmlsbD0iIzA3NkRGMiIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNIDU5Ljk3LDc0LjQwIEMgNjAuNzcsNzMuNTggNjIuMTQsNzIuMjUgNjMuMDAsNzEuNDMgQyA2My44Niw3MC42MSA2NS43Miw2OC44NCA2Ny4xMyw2Ny41MCBDIDcwLjAxLDY0Ljc2IDcyLjcyLDYyLjE2IDczLjM3LDYxLjUwIEMgNzMuNjEsNjEuMjYgNzUuMDIsNTkuOTEgNzYuNTAsNTguNTEgQyA3Ny45OCw1Ny4xMSA4MC4wNiw1NS4xMSA4MS4xMyw1NC4wOCBDIDgyLjE5LDUzLjA0IDg0LjMzLDUwLjk4IDg1Ljg4LDQ5LjUxIEMgODcuNDIsNDguMDMgODkuODEsNDUuNzUgOTEuMTksNDQuNDQgQyA5Mi41Niw0My4xMyA5NS4wOCw0MC43MSA5Ni43OSwzOS4wNiBDIDEwMC44OSwzNS4xMCAxMDEuMjMsMzQuODQgMTAxLjYxLDM1LjI5IEMgMTAxLjcxLDM1LjQxIDEwMS43NCw0MC45MCAxMDEuNzQsNTQuOTIgQyAxMDEuNzQsNjUuNjIgMTAxLjc3LDc0LjQzIDEwMS44MSw3NC41MCBDIDEwMS44Niw3NC41NyAxMDIuMDQsNzQuNjIgMTAyLjIxLDc0LjYyIEMgMTAyLjQ2LDc0LjYyIDEwMi44Myw3NC4zMyAxMDMuNzQsNzMuMzkgQyAxMDUuMDIsNzIuMDYgMTEwLjM0LDY2Ljk1IDExMy44Miw2My43MSBDIDExNS41MCw2Mi4xMyAxMTUuOTksNjEuNjAgMTE2LjIyLDYxLjEwIEwgMTE2LjUwLDYwLjQ3IEwgMTE2LjUwLDMwLjY3IEMgMTE2LjUwLDQuNjcgMTE2LjQ4LDAuODYgMTE2LjMyLDAuODAgQyAxMTUuOTUsMC42NiAxMTUuMjQsMS4wMSAxMTQuOTIsMS41MSBDIDExNC43NCwxLjc3IDExNC4zOSwyLjE1IDExNC4xNCwyLjM0IEMgMTEzLjcwLDIuNjcgMTExLjA0LDUuMjEgMTA0LjAwLDEyLjAwIEMgMTAwLjAzLDE1LjgzIDk1LjUxLDIwLjE3IDkxLjk0LDIzLjU2IEMgODcuODcsMjcuNDQgODAuMjIsMzQuNzggNzcuOTQsMzcuMDAgQyA3NC45NiwzOS44OCA3My4xMCw0MS42OCA3MC4wNyw0NC41NyBDIDYyLjQzLDUxLjg0IDYxLjIwLDUzLjAyIDU5LjkyLDU0LjMzIEMgNTkuMTUsNTUuMTEgNTguNDYsNTUuNzUgNTguNDAsNTUuNzUgQyA1OC4yMyw1NS43NSA1Ni44OCw1NC42NCA1Ni44OCw1NC41MCBDIDU2Ljg4LDU0LjQ0IDU2LjU4LDU0LjE2IDU2LjIyLDUzLjg3IEMgNTUuODYsNTMuNTkgNTQuOTIsNTIuNzIgNTQuMTIsNTEuOTYgQyA1MC45OSw0OC45MSA0Mi41NSw0MC44MCA0MC4yNSwzOC42MiBDIDM4LjkxLDM3LjM1IDM3LjI5LDM1Ljc5IDM2LjY2LDM1LjE1IEMgMzYuMDIsMzQuNTEgMzUuMjAsMzMuNzMgMzQuODQsMzMuNDEgQyAzNC40OCwzMy4wOSAzMS40MCwzMC4xNSAyOC4wMCwyNi44NyBDIDI0LjYwLDIzLjYwIDIwLjg4LDIwLjAyIDE5Ljc1LDE4LjkzIEMgMTguNjEsMTcuODMgMTYuNTMsMTUuODQgMTUuMTIsMTQuNTAgQyAxMy43MSwxMy4xNiAxMS44NiwxMS4zOSAxMS4wMCwxMC41NiBDIDEwLjE0LDkuNzQgOC43OSw4LjQ1IDguMDAsNy43MCBDIDcuMjEsNi45NSA1LjkxLDUuNzEgNS4xMiw0Ljk1IEMgNC4zMyw0LjE5IDMuMjYsMy4xNyAyLjc2LDIuNjkgQyAyLjI1LDIuMjEgMS42MSwxLjUzIDEuMzQsMS4xOSBDIDAuNjgsMC4zNSAwLjUxLDAuMjcgMC4yMywwLjYyIEMgMC4wMSwwLjg5IC0wLjAwLDIuMDMgMC4wMCwzMC44MyBDIDAuMDAsNTYuNjUgMC4wMiw2MC44MSAwLjE4LDYxLjExIEMgMC4zNyw2MS40NyAxMS42NSw3Mi40MCAxMi4yMyw3Mi43OCBDIDEyLjQxLDcyLjkwIDEyLjkzLDczLjQyIDEzLjM4LDczLjkzIEMgMTQuMTUsNzQuODMgMTQuNjAsNzUuMDkgMTQuODEsNzQuNzUgQyAxNC44NSw3NC42OCAxNC44OCw2NS44MSAxNC44OCw1NS4wMiBDIDE0Ljg3LDM1LjczIDE0Ljg3LDM1LjQyIDE1LjExLDM1LjIwIEMgMTUuNDMsMzQuOTIgMTUuODIsMzUuMDMgMTYuMDUsMzUuNDggQyAxNi4xNSwzNS42NiAxNi43MCwzNi4yMyAxNy4yNywzNi43NSBDIDE4LjM5LDM3Ljc2IDIyLjA1LDQxLjI2IDI5LjYzLDQ4LjU4IEMgMzIuMjgsNTEuMTMgMzQuNjksNTMuNDMgMzQuOTksNTMuNjggQyAzNS4yOSw1My45MyAzNS45Niw1NC41NyAzNi40OCw1NS4xMSBDIDM3LjAxLDU1LjY0IDM4LjExLDU2LjczIDM4Ljk0LDU3LjUxIEMgNDAuODgsNTkuMzUgNDQuNjAsNjIuOTEgNDguNjIsNjYuNzYgQyA1MC4zOCw2OC40NCA1Mi41Nyw3MC41NCA1My41MCw3MS40MiBDIDU0LjQzLDcyLjMxIDU1LjY3LDczLjUwIDU2LjI2LDc0LjA3IEMgNTcuMzksNzUuMTggNTguMjIsNzUuODggNTguMzksNzUuODggQyA1OC40NSw3NS44OCA1OS4xNiw3NS4yMSA1OS45Nyw3NC40MCBaIE0gNTguODQsMzMuNzQgQyA1OC45NiwzMy41OSA1OS40MywzMy4xMyA1OS44NywzMi43MSBDIDYzLjY0LDI5LjExIDcwLjgwLDIyLjIzIDc1LjcxLDE3LjQ4IEMgNzcuMDgsMTYuMTUgNzcuMzksMTUuNzIgNzcuMTYsMTUuNDggQyA3Ny4wMywxNS4zNiAzOS41NywxNS4zMiAzOS4zNywxNS40NCBDIDM5LjAxLDE1LjY2IDM5LjQ2LDE2LjI1IDQxLjMxLDE4LjAwIEMgNDUuNDMsMjEuODggNTIuNTQsMjguNzAgNTYuMTMsMzIuMjIgQyA1OC4wOCwzNC4xMiA1OC4zOCwzNC4yOSA1OC44NCwzMy43NCBaIi8+PC9zdmc+';

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK} width={40} height={26} alt="" />
          Blue Mantis
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: TEXT, fontSize: 76, fontWeight: 800, lineHeight: 1.0, letterSpacing: '-0.035em', maxWidth: 1000 }}>
            The backlog writes the code back to you.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 40 }}>
            <div style={{ width: 10, height: 10, background: BLUE }} />
            <div style={{ color: DIM, fontSize: 26 }}>Two models, one ranked shortlist, and the pull request · kandryn.com</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
