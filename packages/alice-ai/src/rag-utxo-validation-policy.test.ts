import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isUtxoValidationQuestion } from './rag-query-policy.ts';

describe('isUtxoValidationQuestion', () => {
  it('matches an English spend-twice paraphrase naming a transaction output', () => {
    assert.equal(isUtxoValidationQuestion('What stops someone from spending the same transaction output twice?'), true);
  });

  it('matches an English UTXO spent-more-than-once paraphrase', () => {
    assert.equal(isUtxoValidationQuestion('How does Bitcoin prevent a UTXO from being spent more than once?'), true);
  });

  it('matches a hyphenated already-spent-output paraphrase', () => {
    assert.equal(isUtxoValidationQuestion("Why isn't an already-spent output allowed to be spent again in a new transaction?"), true);
  });

  it('matches a plural unspent-transaction-outputs paraphrase', () => {
    assert.equal(isUtxoValidationQuestion("Why can't unspent transaction outputs be spent twice?"), true);
  });

  it('matches a two-transactions-same-input conflict paraphrase', () => {
    assert.equal(isUtxoValidationQuestion('Can two different transactions reference the same unspent transaction output?'), true);
  });

  it('matches a duplicate-transaction-inputs paraphrase', () => {
    assert.equal(isUtxoValidationQuestion('Why are duplicate transaction inputs rejected by the network?'), true);
  });

  it('matches a French accented double-spend paraphrase', () => {
    assert.equal(isUtxoValidationQuestion("Pourquoi ne peut-on pas dépenser deux fois la même sortie d'une transaction ?"), true);
  });

  it('matches a French reused-UTXO paraphrase', () => {
    assert.equal(isUtxoValidationQuestion("Comment Bitcoin empêche-t-il qu'un UTXO soit réutilisé ?"), true);
  });

  it('matches a French two-transactions-same-input paraphrase', () => {
    assert.equal(isUtxoValidationQuestion('Que se passe-t-il si deux transactions utilisent la même entrée ?'), true);
  });

  it('matches a French accented plural duplicated-inputs paraphrase', () => {
    assert.equal(isUtxoValidationQuestion('Pourquoi les entrées de transaction dupliquées sont-elles invalides ?'), true);
  });

  it('does not match a bare English UTXO definition', () => {
    assert.equal(isUtxoValidationQuestion('What is a UTXO?'), false);
  });

  it('does not match a bare French UTXO definition', () => {
    assert.equal(isUtxoValidationQuestion("Qu'est-ce qu'un UTXO ?"), false);
  });

  it('does not match an output-index definition', () => {
    assert.equal(isUtxoValidationQuestion('What is the output index in a transaction?'), false);
  });

  it('does not match a receiving-address definition', () => {
    assert.equal(isUtxoValidationQuestion('What is a receiving address?'), false);
  });

  it('does not match an ordinary fee question', () => {
    assert.equal(isUtxoValidationQuestion('Why did my transaction fee go up this week?'), false);
  });

  it('does not match an ordinary send question', () => {
    assert.equal(isUtxoValidationQuestion('How do I send bitcoin to a friend?'), false);
  });

  it('does not match a coin-control/privacy question even with UTXOs named', () => {
    assert.equal(isUtxoValidationQuestion('How does coin control improve privacy by choosing which UTXOs to spend?'), false);
  });

  it('does not match a consolidation question even with UTXOs named', () => {
    assert.equal(isUtxoValidationQuestion('Why would I consolidate multiple small UTXOs into one output?'), false);
  });

  it('does not match an RBF question even with same-input-twice wording', () => {
    assert.equal(isUtxoValidationQuestion('Can RBF let me spend the same input twice to cancel a pending transaction?'), false);
  });

  it('does not match a mempool/unconfirmed troubleshooting question', () => {
    assert.equal(isUtxoValidationQuestion('Why is my transaction stuck in the mempool with unconfirmed inputs?'), false);
  });

  it('does not match a reorg question even with same-output-twice wording', () => {
    assert.equal(isUtxoValidationQuestion("After a chain reorg, can the same output be spent twice before it's orphaned?"), false);
  });

  it('does not match a Lightning virtual-output question', () => {
    assert.equal(isUtxoValidationQuestion('In Lightning, can the same virtual output be spent twice across two channels?'), false);
  });

  it('does not match an Ark virtual-UTXO question', () => {
    assert.equal(isUtxoValidationQuestion('Does Ark allow spending the same virtual UTXO twice before settlement?'), false);
  });

  it('does not match an explicit comparison even naming double-spend prevention', () => {
    assert.equal(isUtxoValidationQuestion('Compare how UTXOs prevent double spending versus how Ethereum accounts work'), false);
  });

  it('distinguishes "two outputs" (output count) from "spending twice" (reuse)', () => {
    assert.equal(isUtxoValidationQuestion('What happens when a transaction creates two outputs?'), false);
  });

  it('does not match a generic computing same-output-twice question lacking a spend cue', () => {
    assert.equal(isUtxoValidationQuestion('Why does this function return the same output twice for different inputs?'), false);
  });

  it('does not match a generic computing input/output duplication question', () => {
    assert.equal(isUtxoValidationQuestion('Can a keyboard input be duplicated in this API?'), false);
  });

  it('remains false for a double-spend question that never names an output/input/UTXO', () => {
    // Ambiguous: conceptually a double-spend question, but the predicate is
    // intentionally narrow to a named transaction-output/input/UTXO subject.
    assert.equal(isUtxoValidationQuestion("Why can't I spend the same bitcoin twice?"), false);
  });
});

// Additional semantic boundaries found while reviewing the implementation.
it('recognizes single consumption and input-reference paraphrases in both languages', () => {
  for (const query of [
    'Why is an unspent output consumed only once?',
    'Une sortie non dépensée ne se consomme qu’une fois, pourquoi ?',
    'Why are two transaction inputs pointing to the same output invalid?',
    'Pourquoi plusieurs entrées visant la même sortie sont-elles rejetées ?',
    'Comment les UTXO évitent-ils les doubles dépenses ?',
  ]) assert.equal(isUtxoValidationQuestion(query), true, query);
});
it('leaves confirmation and programming questions to normal retrieval', () => {
  for (const query of [
    'After six confirmations can the same output be spent twice?',
    'Une réorganisation après confirmation permet-elle de dépenser deux fois le même UTXO ?',
    'Why does this program reuse the same output?',
    'Can my API reuse the same transaction input?',
  ]) assert.equal(isUtxoValidationQuestion(query), false, query);
});
