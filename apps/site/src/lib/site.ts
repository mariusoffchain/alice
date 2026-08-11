// Single source of truth for site-wide constants. Keeping URLs here avoids
// hardcoding them across pages, metadata, sitemap, and JSON-LD.

export const SITE_URL = 'https://alicebtc.com';
export const APP_URL = 'https://app.alicebtc.com';
export const WALLET_URL = 'https://wallet.alicebtc.com';
export const SOURCE_URL = 'https://github.com/mariusoffchain/alice';
export const ANDROID_VERSION = '0.1.0';
export const ANDROID_RELEASE_URL = `${SOURCE_URL}/releases/tag/v${ANDROID_VERSION}`;
export const ANDROID_APK_URL = `${SOURCE_URL}/releases/download/v${ANDROID_VERSION}/Alice-Wallet-beta-${ANDROID_VERSION}-v11.apk`;

export const SITE_NAME = 'Alice';

// Drives noindex/robots.txt. Deliberately false: the beta is closed and has
// not been shared beyond a handful of people, so the site stays unlisted even
// though the source is now public. Being open source and being announced are
// two different decisions. Flip this the day the beta opens, not before.
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
// the alt text that describes that card all read it from here.
export const HERO_TITLE =
  'Meet Alice. Your private companion, all the way down the Bitcoin rabbit hole.';
export const OG_ALT = HERO_TITLE;

// Marketing status. Alice is a private beta on Bitcoin mainnet, the site
// must say so plainly rather than imply a finished product — and must never
// let a tester believe real sats are test coins.
export const BETA_NOTICE =
  'Alice is in private beta on Bitcoin mainnet, small amounts only. A Mutinynet (test coins) build is available to practice safely.';

export const NAV_LINKS = [
  { label: 'How it works', href: '/#sovereignty' },
  { label: 'Mission', href: '/#missions' },
  { label: 'vs ChatGPT', href: '/vs/chatgpt/' },
] as const;

// Pages that exist today, for the sitemap. Add entries here as pages ship.
export const SITE_ROUTES = ['/', '/trust/', '/privacy/', '/credits/', '/vs/chatgpt/'] as const;
