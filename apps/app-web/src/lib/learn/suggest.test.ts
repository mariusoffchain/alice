import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { suggestForMessage, takeSuggestion } from './suggest.ts';
import type {
  LearnCatalogCourse,
  LearnCatalogTutorial,
} from '@alice-wallet/alice-content/src/learn-types';

const course = (
  code: string,
  name: string,
  goal: string,
  objectives: string[] = [],
): LearnCatalogCourse => ({
  code,
  courseId: null,
  topic: 'bitcoin',
  level: 'beginner',
  type: 'theory',
  hours: 5,
  languages: ['fr', 'en'],
  i18n: { fr: { name, goal, objectives } },
  chapterCount: { fr: 10 },
  quizCount: {},
});

const tutorial = (
  category: string,
  slug: string,
  name: string,
  description: string,
): LearnCatalogTutorial => ({
  id: null,
  slug,
  category,
  subcategory: null,
  level: null,
  languages: ['fr', 'en'],
  i18n: { fr: { name, description } },
});

const COURSES = [
  course('lnp201', 'Le réseau Lightning', 'Comprendre les canaux de paiement du réseau Lightning', [
    'Ouvrir un canal',
    'Payer une facture Lightning',
  ]),
  course('btc101', 'Le parcours de Bitcoin', 'Découvrir les fondamentaux de Bitcoin'),
];
const TUTORIALS = [
  tutorial('node', 'umbrel', 'Installer Umbrel', 'Monter son nœud Bitcoin à la maison avec Umbrel'),
];

describe('suggestForMessage', () => {
  it('routes a Lightning question to the Lightning course', () => {
    const s = suggestForMessage(
      'Comment fonctionne le réseau Lightning et ses canaux de paiement ?',
      'fr',
      COURSES,
      TUTORIALS,
    );
    assert.equal(s?.code, 'lnp201');
  });

  it('routes a node question to the node tutorial', () => {
    const s = suggestForMessage(
      'Je veux installer un nœud Bitcoin à la maison avec Umbrel',
      'fr',
      COURSES,
      TUTORIALS,
    );
    assert.equal(s?.code, 'node/umbrel');
    assert.equal(s?.kind, 'tutorial');
  });

  it('stays silent on smalltalk', () => {
    assert.equal(suggestForMessage('Salut, comment ça va aujourd’hui ?', 'fr', COURSES, TUTORIALS), null);
  });

  it('stays silent on a lone generic word', () => {
    assert.equal(suggestForMessage('bitcoin', 'fr', COURSES, TUTORIALS), null);
  });

  it('is deterministic', () => {
    const message = 'Ouvrir un canal de paiement Lightning';
    assert.deepEqual(
      suggestForMessage(message, 'fr', COURSES, TUTORIALS),
      suggestForMessage(message, 'fr', COURSES, TUTORIALS),
    );
  });
});

describe('takeSuggestion', () => {
  it('never suggests the same content twice for one memory set', () => {
    const seen = new Set<string>();
    const message = 'Comment fonctionne le réseau Lightning et ses canaux ?';
    assert.ok(takeSuggestion(message, ['fr'], COURSES, TUTORIALS, seen));
    assert.equal(takeSuggestion(message, ['fr'], COURSES, TUTORIALS, seen), null);
  });

  it('matches a French question even when the Learn language is English', () => {
    const seen = new Set<string>();
    const message = 'Comment fonctionne le réseau Lightning et ses canaux ?';
    assert.equal(takeSuggestion(message, ['en'], COURSES, TUTORIALS, seen), null);
    assert.ok(takeSuggestion(message, ['en', 'fr'], COURSES, TUTORIALS, new Set()));
  });
});
