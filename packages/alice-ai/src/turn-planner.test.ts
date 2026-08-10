import assert from 'node:assert/strict';
import test from 'node:test';
import { planAliceTurn } from './turn-planner.ts';

test('a response preference is remembered without invoking the RAG', () => {
  const plan = planAliceTurn('I prefer concise answers.');
  assert.equal(plan.kind, 'personal-statement');
  assert.equal(plan.retrievalQuery, null);
  assert.deepEqual(plan.explicitMemoryCandidates, [
    { category: 'preference', text: 'Prefers concise answers' },
  ]);
});

test('separates multiple explicit memories instead of merging the rest of the message', () => {
  const plan = planAliceTurn('I am building Alice Wallet. I prefer concise answers.');
  assert.deepEqual(plan.explicitMemoryCandidates, [
    { category: 'preference', text: 'Prefers concise answers' },
    { category: 'project', text: 'Working on Alice Wallet' },
  ]);
});

test('a learning declaration updates the profile without becoming a knowledge query', () => {
  const plan = planAliceTurn('I am beginning with UTXOs.');
  assert.equal(plan.kind, 'personal-statement');
  assert.equal(plan.retrievalQuery, null);
  assert.equal(plan.hasExplicitLearningDeclaration, true);
});

test('a mixed statement retrieves only the actual question', () => {
  const plan = planAliceTurn("I'm new to UTXOs. What is a change output?");
  assert.equal(plan.kind, 'mixed');
  assert.equal(plan.retrievalQuery, 'What is a change output?');
});

test('ordinary questions and short topic prompts remain retrievable', () => {
  const standalone = planAliceTurn('How does Lightning routing work?');
  assert.equal(standalone.retrievalQuery, 'How does Lightning routing work?');
  assert.equal(standalone.needsConversationContext, false);
  assert.equal(planAliceTurn('Ark').retrievalQuery, 'Ark');
});

test('distinguishes real follow-ups from autonomous questions', () => {
  for (const message of [
    'Can you explain that further?',
    'Pourquoi ?',
    'Et Lightning ?',
    'Qu’en est-il des frais ?',
  ]) {
    assert.equal(planAliceTurn(message).needsConversationContext, true, message);
  }

  for (const message of [
    'Explain what is Bitcoin?',
    'Why is Bitcoin scarce?',
    'How does Lightning routing work?',
  ]) {
    assert.equal(planAliceTurn(message).needsConversationContext, false, message);
  }
});

test('greetings and unrelated conversation do not search the knowledge base', () => {
  assert.equal(planAliceTurn('Hello!').retrievalQuery, null);
  assert.equal(planAliceTurn('That makes sense.').retrievalQuery, null);
});

test('questions about Alice Memory never search the Bitcoin knowledge base', () => {
  for (const message of [
    'What do you know about me?',
    'What am I working on and how should you answer me?',
    'Que sais-tu de moi ?',
    'Sur quoi est-ce que je travaille ?',
  ]) {
    const plan = planAliceTurn(message);
    assert.equal(plan.asksAboutUserMemory, true, message);
    assert.equal(plan.retrievalQuery, null, message);
  }
});

test('future visual requests are classified without adding a second model call', () => {
  const diagram = planAliceTurn('Create a diagram explaining a UTXO transaction');
  assert.equal(diagram.requestedCapability, 'diagram-generation');
  assert.equal(diagram.retrievalQuery, 'Create a diagram explaining a UTXO transaction');

  const image = planAliceTurn('Generate an image about Bitcoin mining');
  assert.equal(image.requestedCapability, 'image-generation');
});
