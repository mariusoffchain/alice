import type { Metadata } from 'next';
import { SOURCE_URL } from '@/lib/site';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { externalLinkProps } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Credits and licenses',
  description:
    'The typefaces Alice uses, who made them, and under which license. Alice itself is AGPL-3.0-or-later.',
  alternates: { canonical: '/credits/' },
};

// The SIL Open Font License asks that the copyright notice and the license
// travel with the font wherever it is redistributed. This site serves the
// font files themselves, so the notice belongs here, next to them, not only
// in the source repository.
const FONTS = [
  {
    name: 'Terminal Grotesque',
    designer: 'Raphaël Bastide, with the contribution of Jérémy Landes',
    home: 'https://velvetyne.fr/fonts/terminal-grotesque/',
    homeLabel: 'velvetyne.fr',
    license: '/licenses/OFL-TerminalGrotesque.txt',
    role: 'Body text and numbers across the site and the apps.',
  },
  {
    name: 'Press Start 2P',
    designer: 'CodeMan38',
    home: 'https://fonts.google.com/specimen/Press+Start+2P',
    homeLabel: 'fonts.google.com',
    license: '/licenses/OFL-PressStart2P.txt',
    role: 'Pixel display type: labels, eyebrows and small caps.',
  },
];

export default function CreditsPage() {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-16">
        <p className="font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-primary)]">
          Credits
        </p>
        <h1 className="mt-5 text-4xl font-semibold leading-[1.12] sm:text-5xl">
          Built on other people’s work.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-[var(--alice-text)]">
          Alice’s look comes from two libre typefaces, released by their
          designers under a license that lets anyone use them. Naming them is
          the least we can do, and the license asks for it.
        </p>

        <h2 className="mt-12 text-2xl font-semibold sm:text-3xl">Typefaces</h2>
        <dl className="mt-6 divide-y divide-[var(--alice-border)]">
          {FONTS.map((font) => (
            <div key={font.name} className="py-5">
              <dt className="text-lg font-semibold text-[var(--alice-heading)]">{font.name}</dt>
              <dd className="mt-2 leading-relaxed text-[var(--alice-text)]">
                {font.role} Designed by {font.designer}, and released under the{' '}
                <a
                  href={font.license}
                  {...externalLinkProps(font.license)}
                  className="text-[var(--alice-primary)] hover:underline"
                >
                  SIL Open Font License 1.1
                </a>
                .{' '}
                <a
                  href={font.home}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--alice-primary)] hover:underline"
                >
                  {font.homeLabel} →
                </a>
              </dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-12 text-2xl font-semibold sm:text-3xl">Alice itself</h2>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">
          Alice’s own source is released under the GNU Affero General Public
          License, version 3 or later. You can read all of it, run it, change
          it and share it.{' '}
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--alice-primary)] hover:underline"
          >
            Read the code →
          </a>
        </p>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">
          The Alice name, logo and visual identity are not covered by that
          license. A fork is free to exist, it simply needs its own name.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
