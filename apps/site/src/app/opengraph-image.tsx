import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERO_TITLE, OG_ALT } from '@/lib/site';

// Link-preview card, generated at build time from the same fonts and colors
// as the site itself. Next picks this file up by convention and adds the
// og:image / twitter:image tags on every page.

export const dynamic = 'force-static';
export const alt = OG_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const GRID = 78;
const BG = '#0d1117';
const GRID_LINE = '#1a2333';
const PRIMARY = '#8bb8ff';
const HEADING = '#eaf1ff';

export default async function OpengraphImage() {
  const publicDir = join(process.cwd(), 'public');
  const [pixelFont, bodyFont, logo] = await Promise.all([
    readFile(join(publicDir, 'fonts', 'PressStart2P-Regular.ttf')),
    readFile(join(publicDir, 'fonts', 'terminal-grotesque.ttf')),
    readFile(join(publicDir, 'alice-logo.svg')),
  ]);
  const logoSrc = `data:image/svg+xml;base64,${logo.toString('base64')}`;

  const verticals = Array.from({ length: Math.floor(size.width / GRID) }, (_, i) => (i + 1) * GRID);
  const horizontals = Array.from({ length: Math.floor(size.height / GRID) }, (_, i) => (i + 1) * GRID);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          backgroundColor: BG,
        }}
      >
        {verticals.map((x) => (
          <div
            key={`v${x}`}
            style={{
              position: 'absolute',
              left: x,
              top: 0,
              width: 1,
              height: size.height,
              backgroundColor: GRID_LINE,
            }}
          />
        ))}
        {horizontals.map((y) => (
          <div
            key={`h${y}`}
            style={{
              position: 'absolute',
              top: y,
              left: 0,
              height: 1,
              width: size.width,
              backgroundColor: GRID_LINE,
            }}
          />
        ))}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 72px',
            width: 880,
          }}
        >
          <div
            style={{
              fontFamily: 'PressStart2P',
              fontSize: 16,
              color: PRIMARY,
              letterSpacing: 3,
            }}
          >
            PRIVATE AI · BITCOIN · SELF-CUSTODY
          </div>
          <div
            style={{
              fontFamily: 'TerminalGrotesque',
              fontSize: 62,
              lineHeight: 1.18,
              color: HEADING,
              marginTop: 40,
            }}
          >
            {HERO_TITLE}
          </div>
          <div
            style={{
              fontFamily: 'TerminalGrotesque',
              fontSize: 28,
              color: PRIMARY,
              marginTop: 40,
            }}
          >
            alicebtc.com
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={230} height={230} alt="" />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'PressStart2P', data: pixelFont, style: 'normal' },
        { name: 'TerminalGrotesque', data: bodyFont, style: 'normal' },
      ],
    },
  );
}
