// Single source of truth for site-wide constants. Keeping URLs here avoids
// hardcoding them across pages, metadata, sitemap, and JSON-LD.

export const SITE_URL = 'https://alicebtc.com';
export const APP_URL = 'https://app.alicebtc.com';
export const WALLET_URL = 'https://wallet.alicebtc.com';
// The blind proxy. The pricing page quotes satoshi prices from its public
// /billing/plans endpoint, the same one the app checks out against, so the
// site can never advertise a different figure than the invoice asks for.
export const PROXY_URL = 'https://proxy.alicebtc.com';
export const SOURCE_URL = 'https://github.com/mariusoffchain/alice';
export const ANDROID_VERSION = '0.2.0';
export const ANDROID_RELEASE_URL = `${SOURCE_URL}/releases/tag/v${ANDROID_VERSION}`;
export const ANDROID_APK_URL = `${SOURCE_URL}/releases/download/v${ANDROID_VERSION}/Alice-Wallet-beta-${ANDROID_VERSION}-v8.apk`;
// Desktop installers ship on the same GitHub release as the APK. File names
// are what the release workflow emits (Tauri's naming), copied verbatim.
export const DESKTOP_VERSION = '0.2.0';
export const DESKTOP_RELEASE_URL = `${SOURCE_URL}/releases/tag/v${DESKTOP_VERSION}`;
const DESKTOP_DOWNLOAD_BASE = `${SOURCE_URL}/releases/download/v${DESKTOP_VERSION}`;
export const DESKTOP_MAC_URL = `${DESKTOP_DOWNLOAD_BASE}/Alice_${DESKTOP_VERSION}_universal.dmg`;
export const DESKTOP_WINDOWS_URL = `${DESKTOP_DOWNLOAD_BASE}/Alice_${DESKTOP_VERSION}_x64_en-US.msi`;
export const DESKTOP_LINUX_APPIMAGE_URL = `${DESKTOP_DOWNLOAD_BASE}/Alice_${DESKTOP_VERSION}_amd64.AppImage`;
export const DESKTOP_LINUX_DEB_URL = `${DESKTOP_DOWNLOAD_BASE}/Alice_${DESKTOP_VERSION}_amd64.deb`;

export const SITE_NAME = 'Alice';

// Drives noindex/robots.txt. Still false: the next release opens the public
// beta, and this flag flips on go-live day, as the last step of the release
// checklist, not before. Until then the site stays unlisted even though the
// source is already public.
export const SITE_IS_PUBLIC = false;

// Deep-link a question into the Alice app. `autosend=1` asks the app to submit
// the question immediately so Alice is already answering on arrival. Both params
// depend on app-web reading them (a small, separate change on the app side); the
// link opens the app either way, without that change the question just arrives
// prefilled rather than sent.
export function appQuestionUrl(question: string): string {
  return `${APP_URL}/?q=${encodeURIComponent(question)}&autosend=1`;
}

// Starter questions shown in the "try Alice" surfaces. Clicking one hands off to
// the app rather than answering on the marketing page.
export const SUGGESTED_QUESTIONS = [
  'What is self-custody, in plain words?',
  'How do I keep my Bitcoin private?',
  'Are my questions to Alice private?',
  'What is the Ark / Arkade model?',
] as const;
export const SITE_TAGLINE =
  'A private AI companion that helps you understand, hold, and use Bitcoin.';

// The slogan, in one place: the home hero, the shared link-preview card, and
// the alt text that describes that card all read it from here. Changing it
// also means rerunning scripts/generate-og.mjs, which carries its own copy.
export const HERO_TITLE = 'Your Bitcoin questions are nobody’s business.';
export const OG_ALT = HERO_TITLE;

export const NAV_LINKS = [
  { label: 'How it works', href: '/#sovereignty' },
  { label: 'Trust', href: '/trust/' },
  { label: 'Pricing', href: '/pricing/' },
  { label: 'vs ChatGPT', href: '/vs/chatgpt/' },
] as const;

// Pages that exist today, for the sitemap. Add entries here as pages ship.
export const SITE_ROUTES = ['/', '/pricing/', '/trust/', '/privacy/', '/credits/', '/vs/chatgpt/'] as const;
