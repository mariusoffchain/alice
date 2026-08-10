import type { AliceMemoryCandidate } from './alice-memory-core.ts';
import type { AliceCapabilityId } from './alice-capabilities.ts';

export type AliceTurnKind = 'question' | 'personal-statement' | 'mixed' | 'conversation';

export type AliceTurnPlan = {
  kind: AliceTurnKind;
  retrievalQuery: string | null;
  asksAboutUserMemory: boolean;
  explicitMemoryCandidates: AliceMemoryCandidate[];
  hasExplicitLearningDeclaration: boolean;
  needsConversationContext: boolean;
  requestedCapability: AliceCapabilityId;
};

export function directPersonalAcknowledgement(language: 'en' | 'fr'): string {
  return language === 'fr'
    ? "Compris. J'en tiendrai compte."
    : "Got it. I'll take that into account.";
}

const QUESTION_START = /\b(what|why|how|when|where|which|who|explain|define|tell me about|can you|could you|qu(?:'|e )?est[- ]ce|c(?:'|e )?est quoi|pourquoi|comment|quand|ou|où|quel(?:le)?|explique|definis|définis|peux[- ]tu|pourrais[- ]tu)\b/i;
const GREETING_ONLY = /^(hi|hello|hey|bonjour|salut|bonsoir|merci|thanks|thank you)[.!?\s]*$/i;
const PERSONAL_STATEMENT = /\b(i am|i'm|i prefer|i like|i want|i need|i work|i build|i am building|my goal|my project|je suis|je prefere|je préfère|j aime|j'aime|je veux|j ai besoin|je travaille|je construis|mon objectif|mon projet)\b/i;
const LEARNING_DECLARATION = /\b(i am (?:a )?(?:beginner|new|learning|beginning)|i'm (?:a )?(?:beginner|new|learning|beginning)|i know|i understand|i am comfortable|je debute|je débute|j apprends|j'apprends|je connais|je comprends|je maitrise|je maîtrise|je suis a l aise|je suis à l aise)\b/i;
const SHORT_TOPIC = /\b(bitcoin|btc|utxos?|lightning|ark|arkade|vtxos?|mining|proof of work|privacy|coinjoin|payjoin|multisig|miniscript|taproot|covenants?)\b/i;
const IMAGE_REQUEST = /\b(create|generate|make|draw|show|cree|crée|generer|générer|dessine|montre)\b[\s\S]*\b(image|illustration|picture)\b/i;
const DIAGRAM_REQUEST = /\b(create|generate|make|draw|show|explain|cree|crée|generer|générer|dessine|montre|explique)\b[\s\S]*\b(diagram|schema|schéma|flowchart)\b/i;
const CONTINUATION_REQUEST = /\b(tell me more|go deeper|expand on (?:that|this)|explain (?:that|this) further|continue|dis[- ]m'en plus|approfondis|développe|continue)\b/i;
const CONTEXT_REFERENCE = /\b(that|this|it|those|these|them|its|the previous (?:answer|point)|ça|cela|ceci|ce point|cette réponse|la réponse précédente|le précédent)\b/i;
const FOLLOW_UP_START = /^(and|but|what about|and what about|et|mais|et pour|qu['’]en est[- ]il)\b/i;
const USER_MEMORY_QUESTION = /\b(?:what (?:do you (?:know|remember) about me|am i working on|are my (?:preferences|goals?|projects?|interests?))|how should you (?:answer|respond) (?:to )?me|que (?:sais|retiens)[- ]tu de moi|qu['’]est[- ]ce que tu (?:sais|retiens) de moi|sur quoi (?:est[- ]ce que )?je travaille|quels? sont mes (?:préférences|preferences|objectifs?|projets?|centres d['’]intérêt)|comment devrais[- ]tu me répondre)\b/i;

function cleanClause(value: string): string {
  return value.replace(/^[\s,;:.-]+/, '').replace(/[\s]+/g, ' ').trim();
}

function questionClause(message: string): string | null {
  const explicitQuestion = message.indexOf('?');
  const opener = QUESTION_START.exec(message);
  if (opener) return cleanClause(message.slice(opener.index));
  if (explicitQuestion >= 0) {
    const beforeQuestion = message.slice(0, explicitQuestion + 1);
    const boundary = Math.max(beforeQuestion.lastIndexOf('.'), beforeQuestion.lastIndexOf('!'), beforeQuestion.lastIndexOf(';'));
    return cleanClause(beforeQuestion.slice(boundary + 1));
  }

  const words = cleanClause(message).split(/\s+/);
  if (words.length <= 4 && SHORT_TOPIC.test(message) && !PERSONAL_STATEMENT.test(message)) {
    return cleanClause(message);
  }
  return null;
}

function boundedSubject(value: string): string {
  return value.replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function isContextualFollowUp(message: string): boolean {
  const trimmed = cleanClause(message);
  if (!trimmed) return false;
  if (CONTINUATION_REQUEST.test(trimmed) || CONTEXT_REFERENCE.test(trimmed) || FOLLOW_UP_START.test(trimmed)) {
    return true;
  }

  const words = trimmed.replace(/[.!?]+$/, '').split(/\s+/);
  return words.length <= 3 && /^(why|how|pourquoi|comment)\b/i.test(trimmed);
}

export function explicitMemoryCandidates(message: string): AliceMemoryCandidate[] {
  const candidates: AliceMemoryCandidate[] = [];
  if (/\b(i prefer|je prefere|je préfère)\b[\s\S]*\b(concise|short|brief|courte?s?|concis(?:e)?)\b/i.test(message)) {
    candidates.push({ category: 'preference', text: 'Prefers concise answers' });
  } else if (/\b(i prefer|je prefere|je préfère)\b[\s\S]*\b(detailed|in depth|long|detaillee?s?|détaillée?s?|approfondie?s?)\b/i.test(message)) {
    candidates.push({ category: 'preference', text: 'Prefers detailed answers' });
  }

  const factBoundary = String.raw`(?=[.!?](?:\s|$)|,\s+(?:and\s+)?(?:i|je)\b|\s+and\s+(?:i|je)\b|$)`;
  const project = new RegExp(
    String.raw`\b(?:i am building|i'm building|i build|i am working on|i'm working on|je construis|je travaille sur)\s+(.{3,100}?)${factBoundary}`,
    'i',
  ).exec(message);
  if (project) candidates.push({ category: 'project', text: `Working on ${boundedSubject(project[1])}` });

  const goal = new RegExp(
    String.raw`\b(?:my goal is|i want to|i would like to|mon objectif est|je veux|j aimerais|j'aimerais)\s+(.{3,100}?)${factBoundary}`,
    'i',
  ).exec(message);
  if (goal) candidates.push({ category: 'goal', text: boundedSubject(goal[1]) });

  return candidates.slice(0, 2);
}

export function planAliceTurn(message: string): AliceTurnPlan {
  const trimmed = cleanClause(message);
  const asksAboutUserMemory = USER_MEMORY_QUESTION.test(trimmed);
  const requestedCapability: AliceCapabilityId = DIAGRAM_REQUEST.test(trimmed)
    ? 'diagram-generation'
    : IMAGE_REQUEST.test(trimmed)
      ? 'image-generation'
      : 'text-generation';
  const retrievalQuery = GREETING_ONLY.test(trimmed) || asksAboutUserMemory
    ? null
    : questionClause(trimmed) ?? (requestedCapability === 'text-generation' ? null : trimmed);
  const personal = PERSONAL_STATEMENT.test(trimmed);
  const hasExplicitLearningDeclaration = LEARNING_DECLARATION.test(trimmed);

  return {
    kind: retrievalQuery && personal
      ? 'mixed'
      : retrievalQuery
        ? 'question'
        : personal || hasExplicitLearningDeclaration
          ? 'personal-statement'
          : 'conversation',
    retrievalQuery,
    asksAboutUserMemory,
    explicitMemoryCandidates: explicitMemoryCandidates(trimmed),
    hasExplicitLearningDeclaration,
    needsConversationContext: isContextualFollowUp(trimmed),
    requestedCapability,
  };
}

export function turnResponseDirective(plan: AliceTurnPlan, language: 'en' | 'fr'): string {
  if (plan.asksAboutUserMemory) {
    return language === 'fr'
      ? "Réponds uniquement à partir de la mémoire locale fournie. N'ajoute aucun sujet Bitcoin, aucune supposition et aucune information absente. Si la mémoire est vide, dis simplement que tu ne sais encore rien de pertinent sur l'utilisateur."
      : "Answer only from the provided local memory. Do not add a Bitcoin topic, make assumptions, or invent missing details. If memory is empty, simply say that you do not know anything relevant about the user yet.";
  }
  if (plan.kind === 'personal-statement') {
    return language === 'fr'
      ? "Réponds uniquement par un bref accusé de réception. Ne définis aucun terme, ne donne aucun cours et ne présente pas le projet de l'utilisateur sans question explicite."
      : "Reply only with a brief acknowledgement. Do not define any term, teach a topic, or introduce the user's project without an explicit question.";
  }
  if (plan.kind === 'mixed') {
    return language === 'fr'
      ? "Tiens compte de la déclaration personnelle, puis réponds uniquement à la question explicite."
      : 'Honor the personal statement, then answer only the explicit question.';
  }
  return '';
}
