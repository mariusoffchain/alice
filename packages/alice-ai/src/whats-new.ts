// What each release wants the user to actually try, said inside the app the
// first time the new version opens. Feature highlights only: bug fixes and
// the full detail live in the release notes, one link away. Add an entry per
// release, newest first, the release checklist in BUILDING.md points here.

export type WhatsNewEntry = {
  version: string;
  highlights: string[];
};

export const RELEASE_NOTES_URL = 'https://github.com/mariusoffchain/alice/releases';

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '0.2.2',
    highlights: [
      'A refreshed interface with a pixel rabbit, calmer controls and colors that follow your theme.',
      'Cleaner navigation across Chat, Explorer, Learn and settings.',
      'The model name and reasoning level are easier to tell apart.',
      'Update details are now available from Settings → General, and appear after an upgrade.',
    ],
  },
  {
    version: '0.2.1',
    highlights: [
      'The Explorer works in the installed desktop app: it could not reach the chain at all before.',
      'Learn cover art loads in the desktop app.',
      'Private Cloud now says which of three things went wrong instead of always asking you to wait.',
      'macOS: the install steps match what macOS actually shows you.',
    ],
  },
  {
    version: '0.2.0',
    highlights: [
      'Explorer: blocks, transactions and addresses, explained by Alice.',
      'Learn: the Plan B Academy courses, with quizzes, in 29 languages.',
      'Playground: a practice wallet on a test network, learn to send and receive without risking anything.',
      'Alice now searches her knowledge by meaning, not just keywords.',
      'Accounts, plans, and a smoother chat throughout.',
    ],
  },
];

export function whatsNewFor(version: string): WhatsNewEntry | null {
  return WHATS_NEW.find(entry => entry.version === version) ?? null;
}
