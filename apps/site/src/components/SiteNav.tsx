import { NAV_LINKS } from '@/lib/site';
import { DownloadButton, OpenAliceButton } from '@/components/AppCtas';
import { MobileNavMenu } from '@/components/MobileNavMenu';
import { AliceMark } from '@/components/icons';

// Sitewide top navigation. Keeps the primary CTA (open the app) always reachable.
export function SiteNav() {
  return (
    <header className="nav-seam sticky top-0 z-50 bg-[var(--alice-bg)]">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5"
      >
        {/* Relative, not the hardcoded production domain, so this is always
            correct: the preview's own home today, alicebtc.com once launched. */}
        <a href="/" aria-label="Alice home">
          <AliceMark size={34} />
        </a>

        <div className="hidden items-center gap-7 text-sm md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[var(--alice-muted)] transition-colors hover:text-[var(--alice-primary)]"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          {/* Desktop: open the companion, or reach every install. Phone:
              everything folds into the single Menu button. */}
          <span className="hidden md:block">
            <DownloadButton size="sm" />
          </span>
          <span className="hidden md:block">
            <OpenAliceButton size="sm" />
          </span>
          <MobileNavMenu />
        </div>
      </nav>
    </header>
  );
}
