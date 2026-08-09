import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BETA_ACCEPTABLE_TCB_STATUSES,
  assertTcbStatus,
  extractTdReport,
  verifyTdxQuote,
  type DcapVerifiedReport,
} from './venice-dcap.ts';
import { VeniceE2EEError } from './venice-e2ee-crypto.ts';

// Real production vectors (hex).
const REPORT_DATA =
  '79a5061efe5a46b0d1f33b11cf1c5adbedae6b790000000000000000000000000d84d39fd11d91e2f86e8e28304191b6fb79d6e9fb15b5eeca6d4b908a89260a';
const TD_ATTRIBUTES = '0000001000000000';
const MR_TD =
  'f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077';

function td10(overrides: Partial<Record<string, string>> = {}, status = 'UpToDate'): DcapVerifiedReport {
  return {
    status,
    advisoryIds: [],
    report: {
      type: 'td10',
      data: {
        reportData: REPORT_DATA,
        tdAttributes: TD_ATTRIBUTES,
        mrTd: MR_TD,
        rtMr0: 'aa'.repeat(48),
        rtMr3: 'bb'.repeat(48),
        ...overrides,
      },
    },
  };
}

describe('assertTcbStatus', () => {
  it('accepts UpToDate for beta', () => {
    assert.doesNotThrow(() => assertTcbStatus('UpToDate'));
    assert.ok(BETA_ACCEPTABLE_TCB_STATUSES.has('UpToDate'));
  });

  it('refuses OutOfDate, Revoked and anything unlisted', () => {
    for (const s of ['OutOfDate', 'Revoked', 'ConfigurationNeeded', 'SWHardeningNeeded', 'Unknown']) {
      assert.throws(() => assertTcbStatus(s), /TCB status not accepted/);
    }
  });
});

describe('extractTdReport', () => {
  it('reduces a td10 report to hex fields', () => {
    const r = extractTdReport(td10());
    assert.equal(r.status, 'UpToDate');
    assert.equal(r.reportDataHex, REPORT_DATA);
    assert.equal(r.tdAttributesHex, TD_ATTRIBUTES);
    assert.equal(r.measurements.mrTd, MR_TD);
  });

  it('accepts a byte-map report.data (dcap-qvl native shape)', () => {
    const report: DcapVerifiedReport = {
      status: 'UpToDate',
      report: { type: 'td10', data: { reportData: { 0: 0x79, 1: 0xa5 }, tdAttributes: { 0: 0, 1: 0 }, mrTd: { 0: 0xf0 } } },
    };
    const r = extractTdReport(report);
    assert.equal(r.reportDataHex, '79a5');
    assert.equal(r.measurements.mrTd, 'f0');
  });

  it('refuses a non-TDX report type', () => {
    assert.throws(() => extractTdReport({ status: 'UpToDate', report: { type: 'sgx', data: {} } }), /not a TDX report/);
  });

  it('refuses a report missing report_data or td_attributes', () => {
    assert.throws(() => extractTdReport({ status: 'UpToDate', report: { type: 'td10', data: { tdAttributes: TD_ATTRIBUTES } } }), /report_data/);
    assert.throws(() => extractTdReport({ status: 'UpToDate', report: { type: 'td10', data: { reportData: REPORT_DATA } } }), /TD attributes/);
  });
});

describe('verifyTdxQuote (injected collateral + verify)', () => {
  const okOptions = {
    pccsUrl: 'https://pccs.test',
    getCollateral: async () => ({ collateral: true }),
    verify: async () => td10(),
  };

  it('returns the reduced report on success', async () => {
    const r = await verifyTdxQuote('04ab', okOptions);
    assert.equal(r.status, 'UpToDate');
    assert.equal(r.measurements.mrTd, MR_TD);
  });

  it('fails closed when collateral fetch throws (PCCS down)', async () => {
    await assert.rejects(
      () => verifyTdxQuote('04ab', { ...okOptions, getCollateral: async () => { throw new Error('pccs 503'); } }),
      /Could not fetch DCAP collateral/,
    );
  });

  it('fails closed when verification throws (tampered quote)', async () => {
    await assert.rejects(
      () => verifyTdxQuote('04ab', { ...okOptions, verify: async () => { throw new Error('signature invalid'); } }),
      /DCAP quote verification failed/,
    );
  });

  it('fails closed on a refused TCB status', async () => {
    await assert.rejects(
      () => verifyTdxQuote('04ab', { ...okOptions, verify: async () => td10({}, 'OutOfDate') }),
      /TCB status not accepted/,
    );
  });

  it('refuses a non-hex quote', async () => {
    await assert.rejects(() => verifyTdxQuote('zzzz', okOptions), VeniceE2EEError);
  });
});
