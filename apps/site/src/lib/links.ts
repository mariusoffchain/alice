// How a link leaves the site.
//
// One rule, applied everywhere so no surface decides on its own: anything
// that leaves alicebtc.com opens in a new tab, and carries no referrer. The
// site is a reading surface; sending someone to the app, to GitHub or to a
// third party should add a tab, not replace the page they were on.
//
// `rel="noreferrer"` also covers `noopener`, so the opened page can never
// reach back into this one through `window.opener`.

const EXTERNAL_SCHEMES = /^(https?:|mailto:)/i;

// Files the browser saves instead of displaying. A download does not navigate
// the current page anywhere, so a new tab would only flash and close itself.
const DOWNLOAD_FILE = /\.(apk|dmg|msi|exe|deb|rpm|appimage|zip|tar\.gz|txt|asc|sig)$/i;

export function isExternalHref(href: string): boolean {
  return EXTERNAL_SCHEMES.test(href);
}

export function isDownloadHref(href: string): boolean {
  return DOWNLOAD_FILE.test(new URL(href, 'https://alicebtc.com').pathname);
}

/**
 * Spread on any `<a>` whose destination comes from data or config. Returns
 * nothing for internal links and for direct file downloads, so a single call
 * site can serve both without a condition of its own.
 */
export function externalLinkProps(href: string): { target?: '_blank'; rel?: string } {
  if (!isExternalHref(href) || isDownloadHref(href)) return {};
  return { target: '_blank', rel: 'noreferrer' };
}
