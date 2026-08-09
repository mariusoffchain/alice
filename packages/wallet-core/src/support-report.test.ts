import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSupportReport } from './support-report.ts';

const context = {
  appVersion: '0.1.0',
  commit: 'abc1234',
  network: 'Bitcoin Mainnet',
  platform: 'Web',
  swapProvider: 'Satora',
};

test('buildSupportReport includes only the supplied safe build context', () => {
  const report = buildSupportReport({
    category: 'bug',
    context,
    summary: 'Receive failed',
    description: 'The invoice did not appear.',
  });

  assert.match(report, /Category: Bug report/);
  assert.match(report, /Network: Bitcoin Mainnet/);
  assert.match(report, /Swaps: Satora/);
  assert.doesNotMatch(report, /https?:\/\/|wallet balance|transaction history/i);
});

test('buildSupportReport falls back to useful non-empty fields', () => {
  const report = buildSupportReport({
    category: 'alice-response',
    context,
    summary: '   ',
    description: '   ',
  });

  assert.match(report, /Summary: Bad Alice response/);
  assert.match(report, /Description:\nNot provided/);
  assert.match(report, /Do not include recovery phrases/);
});
