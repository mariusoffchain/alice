import { APP_URL, NAV_LINKS } from '@/lib/site';
import { AliceMark } from '@/components/icons';

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--alice-border)] px-5 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <AliceMark size={24} />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[var(--alice-muted)] hover:text-[var(--alice-primary)]"
            >
              {link.label}
            </a>
          ))}
          <a href="/trust/" className="text-[var(--alice-muted)] hover:text-[var(--alice-primary)]">
            Trust
          </a>
          <a href="/privacy/" className="text-[var(--alice-muted)] hover:text-[var(--alice-primary)]">
            Privacy
          </a>
          <a href="/credits/" className="text-[var(--alice-muted)] hover:text-[var(--alice-primary)]">
            Credits
          </a>
          <a href={APP_URL} className="text-[var(--alice-muted)] hover:text-[var(--alice-primary)]">
            Open Alice
          </a>
        </nav>
      </div>
      <div className="mx-auto mt-6 flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--alice-muted)]">
          Alice is educational software, not financial advice. Bitcoin involves risk;
          you are responsible for your own keys and funds.
        </p>
        <p className="shrink-0 font-pixel text-[9px] uppercase tracking-widest text-[var(--alice-muted)]">
          No tracking · No cookies
        </p>
      </div>
    </footer>
  );
}
