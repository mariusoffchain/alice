import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertNotDebug,
  assertPinnedMeasurements,
  assertReportDataBinding,
  assertReportDataNonce,
  deriveSigningAddress,
  hasPinnedMeasurements,
  tdFieldToHex,
  verifyTdReportBinding,
  type VerifiedTdReport,
} from './venice-attestation-verify.ts';
import { VeniceE2EEError } from './venice-e2ee-crypto.ts';

// Real vectors captured from a production Venice E2EE attestation and its
// DCAP-verified TDX quote (model e2ee-gpt-oss-120b-p).
const SIGNING_PUBLIC_KEY =
  '04943cea0b4babf60f6e2031e9a00866a37c4ae696fb45895b3a9b38ab8cbb898f42c85b704aceaa0a396cf26f7fdf79d83205be7e11d3a5d70419a68277158c3d';
const SIGNING_ADDRESS = '79a5061efe5a46b0d1f33b11cf1c5adbedae6b79';
const REPORT_DATA =
  '79a5061efe5a46b0d1f33b11cf1c5adbedae6b790000000000000000000000000d84d39fd11d91e2f86e8e28304191b6fb79d6e9fb15b5eeca6d4b908a89260a';
const NONCE = '0d84d39fd11d91e2f86e8e28304191b6fb79d6e9fb15b5eeca6d4b908a89260a';
const TD_ATTRIBUTES = '0000001000000000'; // debug bit clear
const MR_TD =
  'f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077';
const RT_MR0 =
  'd6118f0eeb30e9d9178d2b9106dddd002d979b6fa79bdec415051afae2021384c29a32d2f6454fa369617598378ffb5e';
const RT_MR3 =
  'b26c3df03e86de2c28c90bd9c85dcb57e78c54388d06c46af28106b56e20b8cb8a7257151f12aae9ef1bcbdfa6fb9399';

describe('deriveSigningAddress', () => {
  it('matches the real signing_address (keccak256 of the pubkey body)', () => {
    assert.equal(deriveSigningAddress(SIGNING_PUBLIC_KEY), SIGNING_ADDRESS);
  });

  it('accepts an uppercase key (attestation hex is bare, no 0x prefix)', () => {
    assert.equal(deriveSigningAddress(SIGNING_PUBLIC_KEY.toUpperCase()), SIGNING_ADDRESS);
  });

  it('rejects a compressed or malformed key', () => {
    assert.throws(() => deriveSigningAddress('02' + SIGNING_PUBLIC_KEY.slice(2, 66)), VeniceE2EEError);
  });
});

describe('assertNotDebug', () => {
  it('passes on the real (non-debug) TD attributes', () => {
    assert.doesNotThrow(() => assertNotDebug(TD_ATTRIBUTES));
  });

  it('refuses when the debug bit is set', () => {
    assert.throws(() => assertNotDebug('0100001000000000'), /debug mode/i);
    assert.throws(() => assertNotDebug('03'), /debug mode/i); // bit 0 set
  });

  it('refuses empty attributes', () => {
    assert.throws(() => assertNotDebug(''), VeniceE2EEError);
  });
});

describe('assertReportDataBinding', () => {
  it('passes: real report_data commits to the real signing key', () => {
    assert.doesNotThrow(() => assertReportDataBinding(REPORT_DATA, SIGNING_PUBLIC_KEY));
  });

  // The attack this stops: a relay swaps in a key it controls.
  it('refuses when the key does not match the address in report_data', () => {
    const otherKey =
      '04d3b51dcb45d74434a76fc1b7e2bc152cf81190eab43bdbf5c2c624321232c76ac9122f8b93480663b987a38e2b3b1f42c7ca8e84736c9741175c07eeca62d382';
    assert.throws(() => assertReportDataBinding(REPORT_DATA, otherKey), /does not match/i);
  });

  it('refuses a report_data too short to hold an address', () => {
    assert.throws(() => assertReportDataBinding('abcd', SIGNING_PUBLIC_KEY), VeniceE2EEError);
  });
});

describe('assertReportDataNonce', () => {
  it('passes when the fresh nonce is inside the DCAP-verified report_data', () => {
    assert.doesNotThrow(() => assertReportDataNonce(REPORT_DATA, NONCE));
  });

  it('refuses a nonce copied only into the surrounding JSON', () => {
    assert.throws(() => assertReportDataNonce(REPORT_DATA, 'aa'.repeat(32)), /not bound/i);
  });

  it('requires exact 64-byte report_data and a 32-byte nonce', () => {
    assert.throws(() => assertReportDataNonce('00'.repeat(63), NONCE), /64 bytes/i);
    assert.throws(() => assertReportDataNonce(REPORT_DATA, '00'.repeat(16)), /32 bytes/i);
  });
});

describe('verifyTdReportBinding', () => {
  const report: VerifiedTdReport = {
    status: 'UpToDate',
    tdAttributesHex: TD_ATTRIBUTES,
    reportDataHex: REPORT_DATA,
    measurements: { mrTd: MR_TD, rtMr0: '', rtMr1: '', rtMr2: '', rtMr3: '', mrConfigId: '' },
  };

  it('passes the full check on the real verified report', () => {
    assert.doesNotThrow(() => verifyTdReportBinding(report, SIGNING_PUBLIC_KEY, NONCE));
  });

  it('refuses an unacceptable TCB status', () => {
    assert.throws(() => verifyTdReportBinding({ ...report, status: 'OutOfDate' }, SIGNING_PUBLIC_KEY, NONCE), /TCB status/i);
  });

  it('refuses a debug enclave even if everything else is fine', () => {
    assert.throws(
      () => verifyTdReportBinding({ ...report, tdAttributesHex: '0100001000000000' }, SIGNING_PUBLIC_KEY, NONCE),
      /debug/i,
    );
  });

  it('refuses a mismatched key even with a good status and no debug', () => {
    const otherKey =
      '04d3b51dcb45d74434a76fc1b7e2bc152cf81190eab43bdbf5c2c624321232c76ac9122f8b93480663b987a38e2b3b1f42c7ca8e84736c9741175c07eeca62d382';
    assert.throws(() => verifyTdReportBinding(report, otherKey, NONCE), /does not match/i);
  });

  it('passes when pinned measurements match the real report', () => {
    const full: VerifiedTdReport = { ...report, measurements: { ...report.measurements, mrTd: MR_TD, rtMr0: RT_MR0, rtMr3: RT_MR3 } };
    assert.doesNotThrow(() => verifyTdReportBinding(full, SIGNING_PUBLIC_KEY, NONCE, { mrTd: MR_TD, rtMr0: RT_MR0, rtMr3: RT_MR3 }));
  });

  it('refuses when a pinned measurement does not match (wrong app version)', () => {
    const tampered = 'a'.repeat(96);
    assert.throws(
      () => verifyTdReportBinding({ ...report, measurements: { ...report.measurements, rtMr3: RT_MR3 } }, SIGNING_PUBLIC_KEY, NONCE, { rtMr3: tampered }),
      /rtMr3 does not match/i,
    );
  });
});

describe('measurement pinning', () => {
  const measurements = { mrTd: MR_TD, rtMr0: RT_MR0, rtMr1: '', rtMr2: '', rtMr3: RT_MR3, mrConfigId: '' };

  it('hasPinnedMeasurements reflects whether anything is actually pinned', () => {
    assert.equal(hasPinnedMeasurements(undefined), false);
    assert.equal(hasPinnedMeasurements({}), false);
    assert.equal(hasPinnedMeasurements({ mrTd: '' }), false);
    assert.equal(hasPinnedMeasurements({ mrTd: MR_TD }), true);
  });

  it('only checks the fields that are pinned', () => {
    assert.doesNotThrow(() => assertPinnedMeasurements(measurements, { mrTd: MR_TD }));
    assert.doesNotThrow(() => assertPinnedMeasurements(measurements, { rtMr3: RT_MR3 }));
  });

  it('is case-insensitive', () => {
    assert.doesNotThrow(() => assertPinnedMeasurements(measurements, { mrTd: MR_TD.toUpperCase() }));
  });

  it('fails when the report is missing a pinned field', () => {
    assert.throws(() => assertPinnedMeasurements({ ...measurements, rtMr3: '' }, { rtMr3: RT_MR3 }), /rtMr3/);
  });
});

describe('tdFieldToHex', () => {
  it('serializes a dcap-qvl byte-map field to hex', () => {
    assert.equal(tdFieldToHex({ 0: 0xf0, 1: 0x6d, 2: 0xfd }), 'f06dfd');
    assert.equal(tdFieldToHex(undefined), '');
  });
});
