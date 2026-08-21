import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPedagogicalProfileFromStorage,
  createPedagogicalProfile,
  familiarityFor,
  getPedagogicalProfileFromStorage,
  inferPedagogicalConcepts,
  isDefinitionQuestion,
  pedagogicalContext,
  recordCourseCompletion,
  recordCourseStudy,
  recordPedagogicalSignalInStorage,
  updatePedagogicalProfile,
  declaredFamiliarityInMessage,
  forgetPedagogicalConceptInStorage,
  type PedagogicalProfileStorage,
} from './pedagogical-profile-core.ts';

function createStorage(values: { secure?: string; legacy?: string } = {}) {
  let secure = values.secure ?? null;
  let legacy = values.legacy ?? null;
  const storage: PedagogicalProfileStorage = {
    read: async () => secure,
    write: async value => { secure = value; },
    remove: async () => { secure = null; },
    readLegacy: async () => legacy,
    removeLegacy: async () => { legacy = null; },
  };
  return { storage, secure: () => secure, legacy: () => legacy };
}

test('maps a question onto stable maintained concepts instead of a generic topic', () => {
  const concepts = inferPedagogicalConcepts('How do VTXOs and covenants help Ark scale Bitcoin?');
  assert.deepEqual(concepts, ['bitcoin-basics', 'scaling-ark', 'scaling-covenants']);
  assert.equal(isDefinitionQuestion('Qu’est-ce qu’Ark ?'), true);
});

test('does not create persistent categories for unrecognized conversation', () => {
  const profile = updatePedagogicalProfile(createPedagogicalProfile(), 'Can you help me write a polite email?');
  assert.deepEqual(profile, createPedagogicalProfile());
});

test('moves a concept cautiously from introduced to exploring without inferring mastery', () => {
  let profile = createPedagogicalProfile();
  profile = updatePedagogicalProfile(profile, 'What is Lightning?');
  assert.equal(familiarityFor(profile.concepts['lightning-basics']), 'introduced');

  profile = updatePedagogicalProfile(profile, 'How does Lightning routing work?');
  profile = updatePedagogicalProfile(profile, 'Go deeper into Lightning routing and channel liquidity.');
  assert.equal(familiarityFor(profile.concepts['lightning-routing']), 'exploring');

  for (let index = 0; index < 3; index += 1) {
    profile = updatePedagogicalProfile(profile, 'How exactly does Lightning routing manage channel liquidity?');
  }
  assert.equal(familiarityFor(profile.concepts['lightning-routing']), 'exploring');
});

test('trusts explicit user declarations about their own knowledge', () => {
  let profile = updatePedagogicalProfile(
    createPedagogicalProfile(),
    'Je suis à l’aise avec les UTXOs, le Proof of Work et Lightning routing.',
  );
  assert.equal(declaredFamiliarityInMessage('Je maîtrise les UTXOs.'), 'familiar');
  assert.equal(familiarityFor(profile.concepts['transactions-utxo']), 'familiar');
  assert.equal(familiarityFor(profile.concepts['mining-proof-of-work']), 'familiar');
  assert.equal(familiarityFor(profile.concepts['lightning-routing']), 'familiar');

  profile = updatePedagogicalProfile(profile, 'Je débute avec les UTXOs.');
  assert.equal(familiarityFor(profile.concepts['transactions-utxo']), 'introduced');
});

test('treats beginning with a concept as an authoritative beginner declaration', () => {
  const profile = updatePedagogicalProfile(createPedagogicalProfile(), 'I am beginning with UTXOs.');
  assert.equal(familiarityFor(profile.concepts['transactions-utxo']), 'introduced');
  assert.equal(profile.concepts['transactions-utxo']?.declaredFamiliarity, 'introduced');
});

test('repetition alone never turns curiosity into familiarity', () => {
  let profile = createPedagogicalProfile();
  for (let index = 0; index < 10; index += 1) {
    profile = updatePedagogicalProfile(profile, 'What is a UTXO?');
  }
  assert.equal(familiarityFor(profile.concepts['transactions-utxo']), 'introduced');
});

test('a broad definition remains accessible even for a familiar concept', () => {
  let profile = createPedagogicalProfile();
  for (let index = 0; index < 5; index += 1) {
    profile = updatePedagogicalProfile(profile, 'How exactly does Ark use VTXOs and an ASP?');
  }
  const context = pedagogicalContext(profile, 'What is Ark?');
  assert.match(context, /plain-language definition/);
  assert.doesNotMatch(context, /appears familiar/);
});

test('the derived prompt receives familiarity guidance, never a profile document', () => {
  let profile = createPedagogicalProfile();
  for (let index = 0; index < 3; index += 1) {
    profile = updatePedagogicalProfile(profile, 'How does Bitcoin mining difficulty work?');
  }
  const context = pedagogicalContext(profile, 'How does Bitcoin mining difficulty adjust?');
  assert.match(context, /already exploring/);
  assert.doesNotMatch(context, /explorationSignals/);
  assert.doesNotMatch(context, /lastActiveDay/);
  assert.doesNotMatch(context, new RegExp(JSON.stringify(profile)));
});

test('versions 1 and 2 are reset rather than mapped onto the new concept model', async () => {
  const v2 = JSON.stringify({
    version: 2,
    totalQuestions: 99,
    preferences: { level: 'advanced', detail: 'detailed', language: 'fr' },
    topics: { bitcoin: { questions: 99 } },
  });
  const fixture = createStorage({ secure: v2, legacy: JSON.stringify({ version: 1 }) });
  const profile = await getPedagogicalProfileFromStorage(fixture.storage);
  assert.deepEqual(profile, createPedagogicalProfile());
  assert.equal(fixture.legacy(), null);
  assert.equal(JSON.parse(fixture.secure()!).version, 3);
});

test('stored profile contains only fixed concept counters and a local date', async () => {
  const fixture = createStorage();
  const revealingQuestion = 'Why is my 0.0042 BTC payment from Revolut to bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq blocked?';
  await recordPedagogicalSignalInStorage(revealingQuestion, fixture.storage);
  const stored = fixture.secure()!;
  for (const secret of ['0.0042', 'Revolut', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq']) {
    assert.equal(stored.includes(secret), false, secret);
  }
  const parsed = JSON.parse(stored);
  assert.deepEqual(Object.keys(parsed).sort(), ['concepts', 'updatedDay', 'version']);
  for (const progress of Object.values(parsed.concepts) as Array<Record<string, unknown>>) {
    assert.deepEqual(Object.keys(progress).sort(), ['declaredFamiliarity', 'explorationSignals', 'lastActiveDay', 'signals']);
  }
});

test('forgets one pedagogical concept without clearing the rest', async () => {
  const fixture = createStorage();
  await recordPedagogicalSignalInStorage('How do UTXOs and Proof of Work relate?', fixture.storage);
  const profile = await forgetPedagogicalConceptInStorage('transactions-utxo', fixture.storage);
  assert.equal(profile.concepts['transactions-utxo'], undefined);
  assert.notEqual(profile.concepts['mining-proof-of-work'], undefined);
});

test('clearing the profile removes both new and legacy storage', async () => {
  const fixture = createStorage({ secure: '{}', legacy: '{}' });
  await clearPedagogicalProfileFromStorage(fixture.storage);
  assert.equal(fixture.secure(), null);
  assert.equal(fixture.legacy(), null);
});

test('reading a chapter bumps the counters without touching familiarity', () => {
    const profile = createPedagogicalProfile();
    const next = recordCourseStudy(profile, ['sidechains']);
    assert.equal(next.concepts['sidechains']?.signals, 1);
    assert.equal(next.concepts['sidechains']?.explorationSignals, 1);
    assert.equal(next.concepts['sidechains']?.declaredFamiliarity, null);
  });

test('finishing a beginner course reaches exploring, an advanced one familiar', () => {
    const profile = createPedagogicalProfile();
    const afterBeginner = recordCourseCompletion(profile, ['bitcoin-basics'], 'beginner');
    assert.equal(afterBeginner.concepts['bitcoin-basics']?.declaredFamiliarity, 'exploring');
    const afterAdvanced = recordCourseCompletion(profile, ['bitcoin-cryptography'], 'advanced');
    assert.equal(afterAdvanced.concepts['bitcoin-cryptography']?.declaredFamiliarity, 'familiar');
  });

test('never downgrades: a familiar concept survives a later beginner course', () => {
    // Someone who worked through the advanced material and then skims the
    // beginner course out of curiosity has not become a beginner again.
    const profile = createPedagogicalProfile();
    const familiar = recordCourseCompletion(profile, ['privacy'], 'advanced');
    const revisited = recordCourseCompletion(familiar, ['privacy'], 'beginner');
    assert.equal(revisited.concepts['privacy']?.declaredFamiliarity, 'familiar');
  });

test('sidechains is a first-class concept the message inference can reach', () => {
    // Liquid questions used to be filed under covenants, which is a different
    // idea. The split is only real if inference routes them to the new home.
    assert.deepEqual(inferPedagogicalConcepts('How does a peg-out work on Liquid?'), ['sidechains']);
  });
