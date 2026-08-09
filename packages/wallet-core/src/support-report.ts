export type SupportReportCategory = 'bug' | 'alice-response' | 'knowledge';

export type SupportReportContext = {
  appVersion: string;
  commit: string;
  network: string;
  platform: string;
  swapProvider: string;
};

const CATEGORY_LABELS: Record<SupportReportCategory, string> = {
  bug: 'Bug report',
  'alice-response': 'Bad Alice response',
  knowledge: 'Knowledge suggestion',
};

export function buildSupportReport(input: {
  category: SupportReportCategory;
  context: SupportReportContext;
  description: string;
  summary: string;
}): string {
  const { category, context } = input;
  const summary = input.summary.trim() || CATEGORY_LABELS[category];
  const description = input.description.trim() || 'Not provided';

  return [
    `Category: ${CATEGORY_LABELS[category]}`,
    `Summary: ${summary}`,
    '',
    'Description:',
    description,
    '',
    'Context:',
    `- App: Alice Wallet ${context.appVersion}`,
    `- Build: ${context.commit}`,
    `- Platform: ${context.platform}`,
    `- Network: ${context.network}`,
    `- Swaps: ${context.swapProvider}`,
    '',
    'Safety reminder:',
    'Do not include recovery phrases, private keys, API keys, or sensitive screenshots.',
  ].join('\n');
}
