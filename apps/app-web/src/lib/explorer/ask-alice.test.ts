import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeAskAlice, splitAskAliceMessage, IDENTIFIED_BLOCK_MARKER, DEIDENTIFIED_BLOCK_MARKER } from './ask-alice.ts';
import type { PrivacySignal } from './signals.ts';

function reuseSignal(address: string): PrivacySignal {
  return {
    id: `ADDRESS_REUSE:${address}`,
    ruleId: 'ADDRESS_REUSE',
    severity: 'medium',
    confidence: 'certain',
    title: 'Address reuse',
    detail: 'reused',
    subjects: [address],
    evidence: { address, inInputs: 1, inOutputs: 1, intraTransaction: true, historical: true, txCount: 4 },
  };
}

describe('composeAskAlice', () => {
  it('projects signals and routes them as class B (abstracted, cloud on consent)', () => {
    const c = composeAskAlice({ signals: [reuseSignal('bc1qexample')], question: 'How exposed am I?' });
    assert.equal(c.abstractSignals.length, 1);
    assert.equal(c.decision.class, 'B');
    assert.equal(c.decision.cloudEligible, true);
    assert.equal(c.decision.cloudConsentRequired, true);
  });

  it('puts the rendered analysis in the message and never the raw address', () => {
    const c = composeAskAlice({ signals: [reuseSignal('bc1qsecretaddr000111')], question: 'What does this reveal?' });
    assert.match(c.userMessage, /What does this reveal\?/);
    assert.match(c.userMessage, /de-identified privacy analysis/);
    assert.match(c.userMessage, /address reuse/);
    assert.ok(!c.userMessage.includes('bc1qsecretaddr000111'), 'raw address must not be sent');
  });

  it('a raw identifier typed in the question forces class D (local only)', () => {
    const c = composeAskAlice({
      signals: [reuseSignal('bc1qexample')],
      question: 'who owns bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    });
    assert.equal(c.decision.class, 'D');
    assert.equal(c.decision.cloudEligible, false);
  });

  it('with consent, class B allows the attested cloud', () => {
    const c = composeAskAlice({ signals: [reuseSignal('bc1qexample')], question: 'help', prefs: { cloudConsent: true } });
    assert.deepEqual(c.decision.allowedBackends, ['local', 'cloud_attested']);
  });

  it('blocks a message the injected detector flags, via the decision', () => {
    const c = composeAskAlice(
      { signals: [reuseSignal('bc1qexample')], question: 'my seed is ...' },
      { detectForbidden: () => true },
    );
    assert.equal(c.decision.blocked, true);
    assert.deepEqual(c.decision.allowedBackends, []);
  });

  it('handles a question with no signals as a plain class A/C turn', () => {
    const c = composeAskAlice({ signals: [], question: 'what is a utxo?' });
    assert.equal(c.abstractSignals.length, 0);
    assert.equal(c.decision.class, 'A');
    assert.equal(c.userMessage, 'what is a utxo?');
  });

  it('carries the page note in the de-identified block, even without signals', () => {
    const c = composeAskAlice({
      signals: [],
      question: 'what am I looking at?',
      pageNote: 'The user is on the receive screen of their test wallet.',
    });
    assert.ok(c.userMessage.includes('The user is on the receive screen'));
    // The note is identity-free by contract, so the class stays A.
    assert.equal(c.decision.class, 'A');
  });

  it('drops the page note when identified mode already describes the page', () => {
    const c = composeAskAlice({
      signals: [],
      question: 'walk me through this page',
      prefs: { cloudConsent: true, identifiedConsent: true },
      pageNote: 'The user is on the receive screen of their test wallet.',
      fullContext: {
        description: 'Receive screen. Current receive address: tb1qexampleaddr.',
        subjects: [{ kind: 'address', value: 'tb1qexampleaddr' }],
      },
    });
    assert.ok(c.userMessage.includes('tb1qexampleaddr'));
    assert.ok(!c.userMessage.includes('The user is on the receive screen of their test wallet.'));
    assert.equal(c.decision.class, 'D');
  });
});

describe('splitAskAliceMessage', () => {
  it('splits question, identified block and de-identified block', () => {
    const txid = 'a'.repeat(59) + 'b9cc1';
    const content = [
      'what about this tx?',
      `${IDENTIFIED_BLOCK_MARKER}\nTransaction ${txid}\nStatus: confirmed.`,
      `${DEIDENTIFIED_BLOCK_MARKER}\nPrivacy signal: transaction shape.`,
    ].join('\n\n');
    const { question, attachments } = splitAskAliceMessage(content);
    assert.equal(question, 'what about this tx?');
    assert.equal(attachments.length, 2);
    assert.equal(attachments[0].kind, 'identified');
    assert.equal(attachments[0].label, 'Transaction ...b9cc1');
    assert.ok(attachments[0].text.includes('Status: confirmed.'));
    assert.equal(attachments[1].kind, 'deidentified');
    assert.ok(attachments[1].text.includes('transaction shape'));
  });

  it('returns a plain message untouched', () => {
    const r = splitAskAliceMessage('just a question');
    assert.equal(r.question, 'just a question');
    assert.deepEqual(r.attachments, []);
  });
});
