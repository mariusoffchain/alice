import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyAttestationChain, type ChainPolicy } from './venice-attestation-chain.ts';
import { EMPTY_MEASUREMENT_POLICY, type MeasurementPolicy } from './venice-measurement-policy.ts';
import type { DcapVerifiedReport } from './venice-dcap.ts';
import { VeniceE2EEError } from './venice-e2ee-crypto.ts';

// Real production vectors.
const NONCE = '0d84d39fd11d91e2f86e8e28304191b6fb79d6e9fb15b5eeca6d4b908a89260a';
const SIGNING_PUBLIC_KEY =
  '04943cea0b4babf60f6e2031e9a00866a37c4ae696fb45895b3a9b38ab8cbb898f42c85b704aceaa0a396cf26f7fdf79d83205be7e11d3a5d70419a68277158c3d';
const REPORT_DATA =
  '79a5061efe5a46b0d1f33b11cf1c5adbedae6b790000000000000000000000000d84d39fd11d91e2f86e8e28304191b6fb79d6e9fb15b5eeca6d4b908a89260a';
const TD_ATTRIBUTES = '0000001000000000';
const MR_TD =
  'f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077';
const RT_MR3 =
  'b26c3df03e86de2c28c90bd9c85dcb57e78c54388d06c46af28106b56e20b8cb8a7257151f12aae9ef1bcbdfa6fb9399';

function td10(overrides: Partial<Record<string, string>> = {}, status = 'UpToDate'): DcapVerifiedReport {
  return {
    status,
    report: { type: 'td10', data: { reportData: REPORT_DATA, tdAttributes: TD_ATTRIBUTES, mrTd: MR_TD, rtMr3: RT_MR3, ...overrides } },
  };
}

function attestation(overrides: Record<string, unknown> = {}) {
  return { verified: true, nonce: NONCE, signing_public_key: SIGNING_PUBLIC_KEY, intel_quote: '04ab', ...overrides };
}

function basePolicy(over: Partial<ChainPolicy> = {}): ChainPolicy {
  return {
    dcap: { pccsUrl: 'https://pccs.test', getCollateral: async () => ({}), verify: async () => td10() },
    measurements: EMPTY_MEASUREMENT_POLICY,
    requireMeasurementPinning: false,
    requireNvidia: false,
    ...over,
  };
}

const ANCHORED: MeasurementPolicy = { references: [{ id: 'venice-gpt-oss', mrTd: MR_TD, rtMr3: RT_MR3 }] };

describe('verifyAttestationChain — success levels', () => {
  it('reaches attested-unpinned with no measurement policy', async () => {
    const r = await verifyAttestationChain(attestation(), NONCE, basePolicy());
    assert.equal(r.assurance, 'attested-unpinned');
    assert.equal(r.modelPublicKeyHex, SIGNING_PUBLIC_KEY);
    assert.equal(r.tcbStatus, 'UpToDate');
  });

  it('reaches full with an anchored policy and no NVIDIA payload', async () => {
    const r = await verifyAttestationChain(attestation(), NONCE, basePolicy({ measurements: ANCHORED }));
    assert.equal(r.assurance, 'full');
    assert.equal(r.measurementMatch?.id, 'venice-gpt-oss');
  });

  it('only reaches pinned (not full) when an unverified NVIDIA payload is present', async () => {
    const r = await verifyAttestationChain(
      attestation({ nvidia_payload: { some: 'gpu' } }),
      NONCE,
      basePolicy({ measurements: ANCHORED, requireNvidia: false }),
    );
    assert.equal(r.assurance, 'pinned');
    assert.equal(r.nvidiaVerified, false);
  });

  it('reaches full when NVIDIA is present and verified', async () => {
    const r = await verifyAttestationChain(
      attestation({ nvidia_payload: { some: 'gpu' } }),
      NONCE,
      basePolicy({ measurements: ANCHORED, requireNvidia: true, nvidiaVerify: async () => true }),
    );
    assert.equal(r.assurance, 'full');
    assert.equal(r.nvidiaVerified, true);
  });
});

describe('verifyAttestationChain — fail closed', () => {
  it('refuses an empty attestation', async () => {
    await assert.rejects(() => verifyAttestationChain(null, NONCE, basePolicy()), /empty/i);
  });

  it('refuses a nonce mismatch (replay)', async () => {
    await assert.rejects(() => verifyAttestationChain(attestation({ nonce: 'b'.repeat(64) }), NONCE, basePolicy()), /nonce mismatch/i);
  });

  it('refuses when JSON echoes the nonce but the verified quote binds another one', async () => {
    const replayedReportData = `${REPORT_DATA.slice(0, 64)}${'bb'.repeat(32)}`;
    const policy = basePolicy({
      dcap: {
        pccsUrl: 'x',
        getCollateral: async () => ({}),
        verify: async () => td10({ reportData: replayedReportData }),
      },
    });
    await assert.rejects(
      () => verifyAttestationChain(attestation(), NONCE, policy),
      /not bound to report_data/i,
    );
  });

  it('refuses when the signing public key is missing', async () => {
    const a = attestation(); delete (a as any).signing_public_key;
    await assert.rejects(() => verifyAttestationChain(a, NONCE, basePolicy()), /no signing public key/i);
  });

  it('refuses when the quote is missing', async () => {
    const a = attestation(); delete (a as any).intel_quote;
    await assert.rejects(() => verifyAttestationChain(a, NONCE, basePolicy()), /no TDX quote/i);
  });

  it('refuses when DCAP verification fails (tampered quote)', async () => {
    const policy = basePolicy({ dcap: { pccsUrl: 'x', getCollateral: async () => ({}), verify: async () => { throw new Error('bad sig'); } } });
    await assert.rejects(() => verifyAttestationChain(attestation(), NONCE, policy), /verification failed/i);
  });

  it('refuses when PCCS is unavailable', async () => {
    const policy = basePolicy({ dcap: { pccsUrl: 'x', getCollateral: async () => { throw new Error('down'); }, verify: async () => td10() } });
    await assert.rejects(() => verifyAttestationChain(attestation(), NONCE, policy), /collateral/i);
  });

  it('refuses a refused TCB status', async () => {
    const policy = basePolicy({ dcap: { pccsUrl: 'x', getCollateral: async () => ({}), verify: async () => td10({}, 'Revoked') } });
    await assert.rejects(() => verifyAttestationChain(attestation(), NONCE, policy), /TCB status/i);
  });

  it('refuses a debug-mode enclave', async () => {
    const policy = basePolicy({ dcap: { pccsUrl: 'x', getCollateral: async () => ({}), verify: async () => td10({ tdAttributes: '0100001000000000' }) } });
    await assert.rejects(() => verifyAttestationChain(attestation(), NONCE, policy), /debug/i);
  });

  it('refuses when report_data does not bind the key', async () => {
    const otherKey =
      '04d3b51dcb45d74434a76fc1b7e2bc152cf81190eab43bdbf5c2c624321232c76ac9122f8b93480663b987a38e2b3b1f42c7ca8e84736c9741175c07eeca62d382';
    await assert.rejects(() => verifyAttestationChain(attestation({ signing_public_key: otherKey }), NONCE, basePolicy()), /does not match/i);
  });

  it('refuses an unknown measurement under an anchored policy', async () => {
    const policy = basePolicy({ measurements: { references: [{ id: 'other', mrTd: MR_TD, rtMr3: 'cc'.repeat(48) }] } });
    await assert.rejects(() => verifyAttestationChain(attestation(), NONCE, policy), /approved reference/i);
  });

  it('refuses when pinning is required but no reference is configured', async () => {
    await assert.rejects(
      () => verifyAttestationChain(attestation(), NONCE, basePolicy({ requireMeasurementPinning: true })),
      /pinning is required/i,
    );
  });

  it('refuses when NVIDIA is required but cannot be verified', async () => {
    await assert.rejects(
      () => verifyAttestationChain(attestation({ nvidia_payload: {} }), NONCE, basePolicy({ measurements: ANCHORED, requireNvidia: true })),
      /NVIDIA/i,
    );
  });

  it('refuses when NVIDIA is required and verification returns false', async () => {
    await assert.rejects(
      () => verifyAttestationChain(attestation({ nvidia_payload: {} }), NONCE, basePolicy({ measurements: ANCHORED, requireNvidia: true, nvidiaVerify: async () => false })),
      /NVIDIA GPU attestation failed/i,
    );
  });
});
