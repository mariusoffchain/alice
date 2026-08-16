import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findRawIdentifiersInText, route, type RouteAttachment } from './route.ts';
import type { AbstractSignal } from './audit-core.ts';

const signal: AbstractSignal = {
  abstractId: 'as_test',
  ruleId: 'ADDRESS_REUSE',
  ruleVersion: 1,
  severity: 'medium',
  confidence: 'certain',
  shape: { addresses: 1, txs: 3, utxos: 0 },
  flags: { historical: true, intraTransaction: false },
  redactionProfile: 'v1',
};

const signalAttachment: RouteAttachment = { id: 'a1', kind: 'signal', signal };
const ficheAttachment: RouteAttachment = { id: 'f1', kind: 'fiche', ficheId: 'FICHE_REUSE' };
const rawAttachment: RouteAttachment = { id: 'r1', kind: 'raw', subject: { kind: 'address', value: 'bc1qxyz' } };

function input(over: Partial<Parameters<typeof route>[0]> = {}) {
  return { attachments: [], questionText: '', prefs: {}, ...over };
}

describe('findRawIdentifiersInText', () => {
  it('detects a bech32 address in prose', () => {
    const got = findRawIdentifiersInText('is bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq safe?');
    assert.equal(got.length, 1);
    assert.equal(got[0].kind, 'address');
  });

  it('detects a base58 address', () => {
    const got = findRawIdentifiersInText('look at 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa please');
    assert.equal(got.some(r => r.kind === 'address'), true);
  });

  it('detects a txid but not a block hash', () => {
    const txid = 'a'.repeat(64);
    const blockHash = '00000000' + 'a'.repeat(56);
    const got = findRawIdentifiersInText(`tx ${txid} and block ${blockHash}`);
    const kinds = got.map(r => r.kind);
    assert.ok(kinds.includes('txid'));
    assert.equal(got.filter(r => r.value === blockHash.toLowerCase()).length, 0);
  });

  it('detects an outpoint and does not double-count its txid', () => {
    const op = `${'b'.repeat(64)}:0`;
    const got = findRawIdentifiersInText(`spend ${op} now`);
    assert.deepEqual(got.map(r => r.kind), ['outpoint']);
  });

  it('detects an xpub', () => {
    const xpub = 'xpub' + '6'.repeat(107);
    assert.equal(findRawIdentifiersInText(`wallet ${xpub}`)[0].kind, 'xpub');
  });

  it('ignores a bare block height', () => {
    assert.deepEqual(findRawIdentifiersInText('what happened at block 900000?'), []);
  });
});

describe('route classes', () => {
  it('A: no attachments, no on-chain data, cloud allowed', () => {
    const d = route(input({ questionText: 'what is a utxo?' }));
    assert.equal(d.class, 'A');
    assert.deepEqual(d.allowedBackends, ['local', 'cloud_attested']);
    assert.equal(d.cloudEligible, true);
  });

  it('C: setup intent with a description and no on-chain data', () => {
    const d = route(input({ questionText: 'I use Sparrow with a passphrase', prefs: { intent: 'setup' } }));
    assert.equal(d.class, 'C');
    assert.deepEqual(d.allowedBackends, ['local', 'cloud_attested']);
  });

  it('A: fiche-only attachments stay pedagogy even with setup intent', () => {
    const d = route(input({ attachments: [ficheAttachment], questionText: 'x', prefs: { intent: 'setup' } }));
    assert.equal(d.class, 'A');
    assert.deepEqual(d.payload.fiches, ['FICHE_REUSE']);
  });

  it('B: abstract signal, local only until consent', () => {
    const d = route(input({ attachments: [signalAttachment], questionText: 'how bad is this?' }));
    assert.equal(d.class, 'B');
    assert.deepEqual(d.allowedBackends, ['local']);
    assert.equal(d.cloudConsentRequired, true);
    assert.equal(d.cloudEligible, true);
  });

  it('B: with consent the attested cloud is allowed', () => {
    const d = route(input({ attachments: [signalAttachment], prefs: { cloudConsent: true } }));
    assert.deepEqual(d.allowedBackends, ['local', 'cloud_attested']);
    assert.equal(d.cloudConsentRequired, false);
  });

  it('D: a raw attachment forces local only, cloud not offered', () => {
    const d = route(input({ attachments: [rawAttachment], prefs: { cloudConsent: true } }));
    assert.equal(d.class, 'D');
    assert.deepEqual(d.allowedBackends, ['local']);
    assert.equal(d.cloudEligible, false);
    assert.equal(d.payload.rawSubjects.length, 1);
  });

  it('D: a raw identifier pasted in the text also forces D', () => {
    const d = route(input({ attachments: [signalAttachment], questionText: 'who owns bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }));
    assert.equal(d.class, 'D');
    assert.equal(d.cloudEligible, false);
    // No auto downgrade: the identifier is in the text, not a removable chip.
    assert.equal(d.downgradePath, undefined);
  });
});

describe('downgradePath', () => {
  it('offers removing raw chips to reach the class the rest would produce', () => {
    const d = route(input({ attachments: [rawAttachment, signalAttachment] }));
    assert.equal(d.class, 'D');
    assert.deepEqual(d.downgradePath, { removeAttachmentIds: ['r1'], resultingClass: 'B' });
  });

  it('resulting class is A when only fiches would remain', () => {
    const d = route(input({ attachments: [rawAttachment, ficheAttachment] }));
    assert.deepEqual(d.downgradePath, { removeAttachmentIds: ['r1'], resultingClass: 'A' });
  });
});

describe('forbidden', () => {
  it('blocks a message flagged by the injected detector, sends nothing', () => {
    const d = route(input({ questionText: 'my seed is ...' }), { detectForbidden: () => true });
    assert.equal(d.blocked, true);
    assert.deepEqual(d.allowedBackends, []);
    assert.equal(d.cloudEligible, false);
  });
});

describe('identified mode', () => {
  it('keeps class D local-only without identifiedConsent, cloud never offered', () => {
    const d = route({ attachments: [rawAttachment], questionText: 'q', prefs: { cloudConsent: true } });
    assert.equal(d.class, 'D');
    assert.deepEqual(d.allowedBackends, ['local']);
    assert.equal(d.cloudEligible, false);
    assert.equal(d.cloudConsentRequired, false);
  });

  it('makes class D cloud-eligible with identifiedConsent, still gated by cloudConsent', () => {
    const d = route({ attachments: [rawAttachment], questionText: 'q', prefs: { identifiedConsent: true } });
    assert.equal(d.class, 'D');
    assert.deepEqual(d.allowedBackends, ['local']);
    assert.equal(d.cloudEligible, true);
    assert.equal(d.cloudConsentRequired, true);
  });

  it('allows the attested cloud for class D only with BOTH consents', () => {
    const d = route({ attachments: [rawAttachment], questionText: 'q', prefs: { identifiedConsent: true, cloudConsent: true } });
    assert.deepEqual(d.allowedBackends, ['local', 'cloud_attested']);
    assert.equal(d.cloudConsentRequired, false);
  });

  it('never unblocks a seed or key, whatever the consents', () => {
    const d = route(
      { attachments: [rawAttachment], questionText: 'my seed is ...', prefs: { identifiedConsent: true, cloudConsent: true } },
      { detectForbidden: () => true },
    );
    assert.equal(d.blocked, true);
    assert.deepEqual(d.allowedBackends, []);
  });
});
