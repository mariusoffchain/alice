import { walletActionGuardReason } from './wallet-action-guard.ts';
import { liveNetworkValueReason } from './live-network-request.ts';
import {
  aliceMemoryRefusalReason,
  isAliceMemoryCategoryPaused,
  normalizeAliceMemoryText,
  type AliceMemoryCandidate,
  type AliceMemoryRefusalReason,
  type AliceMemoryWrite,
} from './alice-memory-core.ts';
import type { AliceCapabilityId } from './alice-capabilities.ts';

export type AliceTurnKind = 'question' | 'personal-statement' | 'mixed' | 'conversation';

export type AliceWalletStateReason = 'balance' | 'transaction-history';

/**
 * Set when the message explicitly asks the assistant itself to execute a
 * Bitcoin payment ('send-payment': send, pay, sign or broadcast funds) or to
 * skip the wallet's own review step ('review-bypass': confirmation, fees or
 * destination check) around such a payment. There is no wallet-action tool
 * wired into chat: this field only flags the request so the caller can
 * answer deterministically instead of routing it into RAG or the model,
 * which could otherwise pretend to act on the user's funds.
 */
export type AliceWalletActionReason = 'send-payment' | 'review-bypass';

/**
 * Set when a question asks for a present network value: the fee or fee rate to
 * use now or for the next block, current Lightning routing fees or outbound
 * liquidity, the user's current inbound liquidity, or the current mempool. No
 * such feed is wired into chat, so the turn gets a deterministic reply like
 * the wallet guards, after them: the models measured on 2026-10-05 either
 * ignored a capability statement or invented a figure under it.
 */
export type AliceLiveNetworkReason = 'onchain-fee' | 'lightning-route' | 'lightning-inbound' | 'mempool';

/**
 * Set when the message asks Alice in so many words to remember a sentence
 * ("retiens que …", "remember that …", "can you remember this: …"). The
 * sentence is kept as it was said, in the 'requested-note' category, after
 * the same filters as any capture; `refusal` names the filter that stopped it.
 * Only the explicit request opens this path: a sentence sent on its own is
 * never a requested note.
 */
export type AliceRequestedNote = {
  text: string;
  refusal: AliceMemoryRefusalReason | null;
  /**
   * True when the whole message is the request. Only then is the turn
   * answered with the confirmation alone; a request followed by a question
   * takes the usual path, the note travelling as an explicit candidate.
   */
  standalone: boolean;
};

export type AliceTurnPlan = {
  kind: AliceTurnKind;
  retrievalQuery: string | null;
  asksAboutUserMemory: boolean;
  explicitMemoryCandidates: AliceMemoryCandidate[];
  hasExplicitLearningDeclaration: boolean;
  needsConversationContext: boolean;
  requestedCapability: AliceCapabilityId;
  /**
   * Set when the message explicitly asks for the user's actual live wallet
   * state (balance, holdings or transaction history/last transaction) rather
   * than a definition, a how-to, a hypothetical or a provided-example
   * calculation. There is no live wallet-state tool wired into chat: this
   * field only flags the request so the caller can answer deterministically
   * instead of routing it into RAG, where the model could fabricate amounts.
   */
  walletStateReason?: AliceWalletStateReason | null;
  walletActionReason?: AliceWalletActionReason | null;
  liveNetworkReason?: AliceLiveNetworkReason | null;
  requestedNote?: AliceRequestedNote | null;
};

export function directPersonalAcknowledgement(language: 'en' | 'fr'): string {
  return language === 'fr'
    ? "Compris. J'en tiendrai compte."
    : "Got it. I'll take that into account.";
}

export function directWalletStateResponse(language: 'en' | 'fr'): string {
  return language === 'fr'
    ? "Cette conversation n'a pas accès au solde ni à l'historique des transactions de ton portefeuille en temps réel. Consulte directement l'application de ton portefeuille pour voir ces informations à jour."
    : "This chat has no access to your wallet's current balance or transaction history. Please check your wallet app directly for that up-to-date information.";
}

export function directWalletActionResponse(language: 'en' | 'fr'): string {
  return language === 'fr'
    ? "Cette conversation ne peut pas accéder à tes comptes externes ni envoyer, signer ou diffuser des fonds en ton nom. Si tu souhaites effectuer ce paiement, utilise ton application de portefeuille et vérifie toi-même la destination, le montant et les frais avant de confirmer."
    : "This chat cannot access your external accounts or send, sign, or broadcast funds on your behalf. If you choose to make this payment, use your wallet app and review the destination, amount, and fees yourself before confirming.";
}

/**
 * The deterministic answer to a remember request that passed the filters.
 * The note is confirmed only when the write succeeded and it is in the store:
 * memory switched off, the category paused in Settings, or a keychain or file
 * failure all leave it out, and the answer says so instead of claiming a save
 * that did not happen.
 */
export function directRequestedNoteResponse(result: AliceMemoryWrite, text: string, language: 'en' | 'fr'): string {
  if (!result.memory.enabled) {
    return language === 'fr'
      ? "La mémoire d'Alice est désactivée dans les réglages, rien n'a été retenu."
      : "Alice's memory is turned off in Settings, nothing was kept.";
  }
  if (isAliceMemoryCategoryPaused(result.memory, 'requested-note')) {
    return language === 'fr'
      ? "Les notes demandées sont en pause dans les réglages, rien n'a été retenu."
      : 'Requested notes are paused in Settings, nothing was kept.';
  }
  const kept = normalizeAliceMemoryText(text);
  const stored = result.memory.items.some(item => item.category === 'requested-note' && item.text === kept);
  if (!result.saved || !stored) {
    return language === 'fr'
      ? "Alice n'a pas pu enregistrer cette note sur cet appareil, rien n'a été retenu. Réessayez plus tard."
      : 'Alice could not save this note on this device, nothing was kept. Please try again later.';
  }
  return language === 'fr' ? `Retenu : ${kept}` : `Noted: ${kept}`;
}

// An explicit request to remember a sentence, French and English, in the
// imperative or as a polite question, followed by "que", "that", or a colon:
// "retiens que", "souviens-toi que", "peux-tu retenir ceci :", "remember
// that", "please remember", "can you remember this:". "Note que", "note
// that" and "keep in mind that" are not triggers: they open ordinary
// statements and questions far more often than a request to keep a sentence.
// "Tu te souviens que … ?" and "Do you remember …?" ask about memory and are
// handled as recall questions elsewhere.
const NOTE_LEAD = String.raw`^(?:(?:alice|ok|okay|bon|s'il te pla[iî]t|stp|please)[,\s]+)*`;
const NOTE_REQUEST_PATTERNS = [
  new RegExp(NOTE_LEAD + String.raw`(?:retiens|retenez|souviens[- ]toi|souvenez[- ]vous|rappelle[- ]toi|rappelez[- ]vous)(?:[- ]bien|,? s'il te pla[iî]t|,? stp)?\s+(?:que\s+|qu['’])(.+)$`, 'i'),
  new RegExp(NOTE_LEAD + String.raw`(?:retiens|retenez|souviens[- ]toi de|rappelle[- ]toi de)\s+(?:ceci|cela|[cç]a)\s*:\s*(.+)$`, 'i'),
  new RegExp(NOTE_LEAD + String.raw`(?:peux[- ]tu|pourrais[- ]tu|pouvez[- ]vous|pourriez[- ]vous|tu peux|veux[- ]tu bien)\s+(?:retenir|te souvenir|te rappeler)(?:\s+(?:de\s+)?(?:ceci|cela|[cç]a))?\s*(?::\s*|,\s*|\s+(?:que\s+|qu['’]|de ce que\s+))(.+)$`, 'i'),
  new RegExp(NOTE_LEAD + String.raw`remember(?:,? please)?\s+(?:that\s+|this\s*:\s*|the following\s*:\s*)(.+)$`, 'i'),
  new RegExp(NOTE_LEAD + String.raw`please remember\s+(?:that\s+|this\s*:\s*)?(.+)$`, 'i'),
  new RegExp(NOTE_LEAD + String.raw`(?:can|could|will|would)\s+you\s+(?:please\s+)?remember(?:\s+(?:this|that|the following))?\s*(?::\s*|,\s*|\s+that\s+)(.+)$`, 'i'),
];
// A requested note is a fact about the user. "Remember that the halving
// happens every four years" asks nothing personal and stays an ordinary turn.
// An interrogative opening a clause inside the sentence ("retiens que je
// débute, mais comment fonctionne un UTXO"). Narrower than QUESTION_START on
// purpose: "explain" or "ou" inside a note do not make it a question.
const INNER_QUESTION = /(?:^|[,;:]\s*|\b(?:mais|but|et|and|alors|donc|so|then)\s+)(?:what|why|how|when|where|which|who|can you|could you|should i|do i|is it|comment|pourquoi|quand|o[uù] est|quel(?:le)?s? (?:est|sont)|est[- ]ce|peux[- ]tu|pourrais[- ]tu|puis[- ]je|dois[- ]je)\b/i;
const FIRST_PERSON = /\b(?:i|i'm|i’m|i've|i’ve|i'd|i’d|i'll|i’ll|my|me|mine|myself|je|moi|mon|ma|mes)\b|\b[jm]['’]/i;

function trimNoteText(value: string): string {
  return normalizeAliceMemoryText(
    value
      .replace(/^[\s"'«“‘]+/, '')
      .replace(/[\s"'»”’]+$/, '')
      .replace(/\s*[.!?;:,]+$/, '')
      .replace(/^[\s"'«“‘]+/, '')
      .replace(/[\s"'»”’]+$/, ''),
  );
}

export function requestedNoteInMessage(message: string): AliceRequestedNote | null {
  const trimmed = cleanClause(message);
  for (const pattern of NOTE_REQUEST_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    // The note ends with its sentence: what follows is a separate clause.
    const [firstSentence, ...rest] = match[1].split(/(?<=[.!?;])\s+(?=\S)/);
    const text = trimNoteText(firstSentence ?? '');
    if (!text || !FIRST_PERSON.test(text)) return null;
    // A question inside the sentence means the user is asking, not dictating
    // a note: nothing is kept from it and the turn goes the usual way.
    if (INNER_QUESTION.test(text) || text.includes('?')) return null;
    const standalone = rest.join(' ').trim().length === 0;
    return { text, refusal: aliceMemoryRefusalReason(text), standalone };
  }
  return null;
}

// "Puis-je", "Can I" and "Should I" open a question too. Without them the
// first interrogative word found further in ("quand" in "Puis-je quand même
// vérifier…") was taken as the start, and the real opener, with its "je",
// was stripped as a personal prefix.
const QUESTION_START = /\b(what|why|how|when|where|which|who|explain|define|tell me about|can you|could you|can i|could i|should i|do i|is it|does (?:that|this|it)|qu(?:'|e )?est[- ]ce|c(?:'|e )?est quoi|pourquoi|comment|quand|ou|où|quel(?:le)?|explique|definis|définis|peux[- ]tu|pourrais[- ]tu|puis[- ]je|dois[- ]je|peut[- ]on|est[- ]il|est[- ]elle)\b/i;
const GREETING_ONLY = /^(hi|hello|hey|bonjour|salut|coucou|bonsoir|merci|thanks|thank you)[.!?\s]*$/i;
const PERSONAL_STATEMENT = /\b(i am|i'm|i prefer|i like|i want|i need|i work|i build|i am building|my goal|my project|je suis|je prefere|je préfère|j aime|j'aime|je veux|j ai besoin|je travaille|je construis|mon objectif|mon projet)\b/i;
const LEARNING_DECLARATION = /\b(i am (?:a )?(?:beginner|new|learning|beginning)|i'm (?:a )?(?:beginner|new|learning|beginning)|i know|i understand|i am comfortable|je debute|je débute|j apprends|j'apprends|je connais|je comprends|je maitrise|je maîtrise|je suis a l aise|je suis à l aise)\b/i;
const SHORT_TOPIC = /\b(bitcoin|btc|utxos?|lightning|ark|arkade|vtxos?|mining|proof of work|privacy|coinjoin|payjoin|multisig|miniscript|taproot|covenants?)\b/i;
const IMAGE_REQUEST = /\b(create|generate|make|draw|show|cree|crée|generer|générer|dessine|montre)\b[\s\S]*\b(image|illustration|picture)\b/i;
const DIAGRAM_REQUEST = /\b(create|generate|make|draw|show|explain|cree|crée|generer|générer|dessine|montre|explique)\b[\s\S]*\b(diagram|schema|schéma|flowchart)\b/i;
const CONTINUATION_REQUEST = /\b(tell me more|say more|go deeper|dig deeper|expand on (?:that|this)|elaborate|explain (?:that|this) further|explain (?:more|further)|continue|dis[- ]m['’]en plus|donne m['’]en plus|en savoir plus|approfondi[sr]|développe|developpe|explique (?:davantage|plus|encore)|(?:peux[- ]tu )?expliquer davantage|montre[- ]moi comment|show me how|(?:donne(?:[- ]moi)?|give me) (?:un |an? )?(?:exemple|example))\b/i;
const CONTEXT_REFERENCE = /\b(that|this|it|those|these|them|its|the previous (?:answer|point)|(?:the )?(?:first|second|third|other) (?:case|one|point)|cela|ceci|ce point|cette reponse|la reponse precedente|le precedent|(?:premier|second|deuxieme|troisieme|autre) (?:cas|point)|par rapport|quelle difference avec)\b/i;
// An acknowledgement may precede the connector ("Oui, mais pourquoi ?",
// "Ok, but how?"); it does not make the question stand on its own.
const FOLLOW_UP_START = /^(?:(?:oui|yes|yeah|ok|okay|d['’]accord|bon|bien|right|sure|hmm|ah)[,\s]+)?(and|but|what about|and what about|et|mais|et pour|qu['’]en est[- ]il)\b/i;
// A bare request for an example or for the practical side of the previous
// answer has no subject of its own.
const ADVERBIAL_FOLLOW_UP = /^(?:(?:and|et|ok|okay|oui|yes)[,\s]+)?(?:par exemple|for example|for instance|like what|comme quoi|concretement|in practice|en pratique|in detail|plus precisement|more precisely|specifically|precisement|exactement)\s*[?.!]*$/i;
// "ça" refers to the previous answer only when it is the subject of the
// question ("Comment ça fonctionne avec le multisig ?", "Ça marche avec Ark ?").
// After a clause of its own ("Quand j'envoie des bitcoins, est-ce que ça passe
// par une banque ?") it is an expletive pronoun and the question stands alone.
const FRENCH_SUBJECT_REFERENCE = /^(?:(?:et|mais|alors|donc|ok|bon)[, ]+)?(?:(?:comment|pourquoi|quand|ou|est[- ]ce que|est[- ]ce qu')\s+)?(?:ca|cela)\b/i;
const USER_MEMORY_QUESTION = /\b(?:what (?:do you (?:know|remember) about me|am i working on|are my (?:preferences|goals?|projects?|interests?))|how should you (?:answer|respond) (?:to )?me|que (?:sais|retiens)[- ]tu de moi|qu['’]est[- ]ce que tu (?:sais|retiens) de moi|sur quoi (?:est[- ]ce que )?je travaille|quels? sont mes (?:préférences|preferences|objectifs?|projets?|centres d['’]intérêt)|comment devrais[- ]tu me répondre)\b/i;
// A conditional premise belongs to its question. Treat it as a hypothesis,
// never as a new personal fact or learning declaration.
const CONDITIONAL_OPENER = /^(?:if|when|si|lorsque|quand)\b/i;

// Recognize explicit state requests clause by clause. Anchors keep quoted
// examples and educational descriptions from being treated as live requests.
// This is a bounded FR/EN intent guard, not exhaustive intent understanding.
const WALLET_BALANCE_HOLDINGS = /^(?:(?:what(?:'s| is| are)|quel(?:le)?s? (?:est|sont)|c'est quoi) (?:my|mon|ma|mes) (?:(?:current|actual|wallet|btc|bitcoin) )?(?:balance|holdings|solde|avoirs)\b|what(?:'s| is) (?:my wallet's (?:current )?balance|the (?:current )?balance (?:of|in) my wallet)\b|quel est le solde (?:de|dans) mon (?:portefeuille|wallet)\b|(?:my|mon) (?:balance|solde)\s*\?|how much (?:bitcoins?|btc) do i (?:(?:currently|actually) )?(?:have|hold|own)\b(?! to\b)|combien de (?:bitcoins?|btc) (?:j'ai|ai[- ]je|est[- ]ce que j'ai|je possede|possede[- ]je)\b(?! besoin)|j'ai combien de (?:bitcoins?|btc)\b|what(?:'s| is) in my wallet\b(?! (?:file|app|settings|folder))|what do i have in my wallet\b(?! (?:file|app|settings|folder)))/i;
const WALLET_TRANSACTION_HISTORY = /^(?:what (?:was|is) my (?:last|latest|most recent) transaction\b|what(?:'s| is) my transaction history\b|what are my (?:last|latest|recent|most recent) transactions\b|quelle (?:est|etait) ma derniere transaction\b|quelles sont mes (?:dernieres|recentes) transactions\b)/i;
const WALLET_STATE_COMMAND = /^(?:(?:can|could|would) you |(?:peux|pourrais)[- ]tu |tu peux )?(?:show(?: me)?|check|tell me|give me|list|display|verifie(?:r)?|montre(?:r)?(?:[- ]moi)?|donne[- ]moi|dis[- ]moi|affiche(?:r)?(?:[- ]moi)?|liste(?:r)?(?:[- ]moi)?)\s+/i;
// A balance inside a hypothesis ("what is my balance if I hold 2 BTC") is an
// arithmetic question, not a request for the wallet's live figure.
const WALLET_HYPOTHETICAL = /\b(?:if|suppose|supposing|imagine|hypothetically|si|supposons|imaginons)\b/i;
const WALLET_MEMORY_PREFIX = /^(?:based on what you remember about me|d'apres ce (?:que tu te souviens|dont tu te souviens) de moi)[,\s]+/i;

function walletStateGuardReason(message: string): AliceWalletStateReason | null {
  for (const clause of message.split(/(?<=[.!?;])\s+/)) {
    const normalized = normalizedFollowUp(withoutGreeting(clause))
      .replace(WALLET_MEMORY_PREFIX, '').replace(/^(?:and|et)[, ]+/i, '');
    if (WALLET_HYPOTHETICAL.test(normalized)) continue;
    if (WALLET_TRANSACTION_HISTORY.test(normalized)) return 'transaction-history';
    if (WALLET_BALANCE_HOLDINGS.test(normalized)) return 'balance';
    const command = normalized.replace(WALLET_STATE_COMMAND, '');
    if (command === normalized) continue;
    if (/^(?:my (?:(?:current|wallet|bitcoin|btc) )?balance|mon solde)\b/i.test(command)) return 'balance';
    if (/^(?:my transaction history|my (?:last|latest) transaction|my (?:last|latest|recent )?transactions|l'historique de mes transactions|mes (?:dernieres )?transactions|ma derniere transaction)\b/i.test(command)) return 'transaction-history';
    if (WALLET_BALANCE_HOLDINGS.test(command) || /^how much (?:bitcoin|btc) i (?:(?:currently|actually) )?(?:have|hold|own)\b/i.test(command)) return 'balance';
  }
  return null;
}

function cleanClause(value: string): string {
  return value.replace(/^[\s,;:.-]+/, '').replace(/[\s]+/g, ' ').trim();
}

// Match complete social clauses, never arbitrary "how are" inside a
// technical question. Mixed turns are classified one sentence at a time.
const SOCIAL_CLAUSE = /^(?:(?:au fait|by the way)[, ]+)?(?:(?:hi|hello|hey|bonjour|salut|coucou|bonsoir|merci|thanks|thank you)[,! .]*)?(?:(?:how are you|how are you doing|how are you feeling|how's it going|how's your day going|how was your day|comment s'est passee ta journee|comment vas[- ]tu|comment allez[- ]vous|comment te sens[- ]tu|comment se passe ta journee|tu vas bien|ca va(?: bien)?)(?: today| aujourd'hui)?)?[.!?\s]*$/i;
const MEMORY_RETENTION_REQUEST = /^(?:(?:can|could|will|would|do) you |(?:peux|pourrais|vas)[- ]tu |tu peux )?(?:remember|recall|save|retain|memorise|memorize|retiens?|retenir|memoriser|te souvenir de|te rappelles[- ]tu|tu te souviens de|te souviens[- ]tu de) (?:my (?:name|preferences?|goals?|projects?)|mon (?:nom|prenom)|mes (?:preferences|objectifs?|projets?))(?: for next time| pour la prochaine fois)?[.!?\s]*$/i;

function withoutGreeting(value: string): string {
  const content = value.replace(/^(?:(?:au fait|by the way|anyway|switching topics|quick question|petite question|autre sujet)[,\s—:-]+)+/i, '');
  return cleanClause(content.replace(/^(?:(?:au fait|by the way)[, ]+)?(?:hi|hello|hey|bonjour|salut|coucou|bonsoir|merci|thanks|thank you)[,! ]+/i, ''));
}

function isMemoryClause(value: string): boolean {
  const normalized = normalizedFollowUp(value);
  const personalRecall = /^(?:(?:do|can|could) you remember|tu te souviens|te souviens[- ]tu|te rappelles[- ]tu)\b/i.test(normalized)
    && /\b(?:i|my|je|mon|ma|mes)\b|\bj['’]/i.test(normalized);
  const personalAttribute = /^(?:what(?:'s| is| are)|quel(?:le)?(?:s)? (?:est|sont)) (?:my|mon|ma|mes) (?:favou?rite|name|preferences?|goals?|projects?|nom|prenom|preferences?|objectifs?|projets?)\b/i.test(normalized);
  return USER_MEMORY_QUESTION.test(value) || USER_MEMORY_QUESTION.test(normalized) || MEMORY_RETENTION_REQUEST.test(normalized) || personalRecall || personalAttribute;
}

function questionClause(message: string): string | null {
  const opener = QUESTION_START.exec(message);
  if (opener) {
    const prefix = message.slice(0, opener.index);
    const isConditionalPrefix = CONDITIONAL_OPENER.test(prefix.replace(/^[\s,;:.-]+/, ''));
    // Keep a named subject before the interrogative ("Et sur Ark, ...").
    // An if/when/si/lorsque premise is part of the question, not a personal
    // statement, even when it names the user ("If I run a full node...").
    // Only a real personal/learning prefix is stripped out of a mixed clause.
    const isPersonalPrefix = !isConditionalPrefix && (PERSONAL_STATEMENT.test(prefix)
      || LEARNING_DECLARATION.test(prefix) || /\b(?:i|my|je|mon|ma|mes)\b|\bj['’]/i.test(prefix));
    return cleanClause(isPersonalPrefix ? message.slice(opener.index) : message);
  }
  if (message.includes('?')) return cleanClause(message);
  const words = cleanClause(message).split(/\s+/);
  if (words.length <= 4 && SHORT_TOPIC.test(message) && !PERSONAL_STATEMENT.test(message) && !LEARNING_DECLARATION.test(message)) {
    return cleanClause(message);
  }
  return null;
}

function boundedSubject(value: string): string {
  return value.replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function normalizedFollowUp(message: string): string {
  return cleanClause(message).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/’/g, "'");
}

export function isContextualFollowUp(message: string): boolean {
  const trimmed = normalizedFollowUp(message);
  if (!trimmed) return false;
  if (CONTINUATION_REQUEST.test(trimmed) || CONTEXT_REFERENCE.test(trimmed) || FOLLOW_UP_START.test(trimmed) || ADVERBIAL_FOLLOW_UP.test(trimmed)) {
    return true;
  }

  // French typography puts a space before "?": drop it with the punctuation
  // so "Comment ça marche ?" counts three words, not four.
  const words = trimmed.replace(/\s*[.!?]+$/, '').trim().split(/\s+/);
  // A short question whose subject is "ça" points back ("Comment ça fonctionne
  // avec le multisig ?"); a longer one names its own subject after it
  // ("Est-ce que ça coûte cher d'envoyer des bitcoins ?").
  if (FRENCH_SUBJECT_REFERENCE.test(trimmed) && words.length <= 6) return true;
  return words.length <= 3 && /^(why|how|pourquoi|comment)\b/i.test(trimmed);
}

/**
 * An explicit request to continue the previous answer, with or without a
 * question mark ("Développe", "Tell me more"). The retrieval rewrite needs to
 * tell such an imperative from a plain acknowledgement, which also refers to
 * the previous answer but asks for nothing (rag-query-rewrite.ts).
 */
export function isExplicitContinuationRequest(message: string): boolean {
  return CONTINUATION_REQUEST.test(normalizedFollowUp(message));
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
  // An explicit remember request that is the whole message is answered on
  // its own: nothing is retrieved and no other pattern reads the sentence.
  // The learning declaration it may carry ("souviens-toi que je débute avec
  // Lightning") is still recorded, by the caller and through the flag below.
  const requestedNote = requestedNoteInMessage(trimmed);
  const noteCandidates: AliceMemoryCandidate[] = requestedNote && !requestedNote.refusal
    ? [{ category: 'requested-note', text: requestedNote.text }]
    : [];
  if (requestedNote?.standalone) {
    return {
      kind: 'personal-statement',
      retrievalQuery: null,
      asksAboutUserMemory: false,
      explicitMemoryCandidates: noteCandidates,
      hasExplicitLearningDeclaration: LEARNING_DECLARATION.test(requestedNote.text),
      needsConversationContext: false,
      requestedCapability: 'text-generation',
      walletStateReason: null,
      walletActionReason: null,
      liveNetworkReason: null,
      requestedNote,
    };
  }
  const clauses = trimmed.split(/(?<=[.!?;])\s+/).map(withoutGreeting).filter(Boolean);
  const contentClauses = clauses.filter(clause => !SOCIAL_CLAUSE.test(normalizedFollowUp(clause)) && !GREETING_ONLY.test(clause));
  const knowledgeClauses = contentClauses.filter(clause => !isMemoryClause(clause));
  const questions = knowledgeClauses.map(questionClause).filter((clause): clause is string => Boolean(clause));
  const walletStateReason = walletStateGuardReason(trimmed);
  const walletActionReason = walletActionGuardReason(trimmed);
  const asksAboutUserMemory = !walletStateReason && !walletActionReason && contentClauses.some(isMemoryClause) && questions.length === 0;
  const requestedCapability: AliceCapabilityId = DIAGRAM_REQUEST.test(trimmed)
    ? 'diagram-generation'
    : IMAGE_REQUEST.test(trimmed)
      ? 'image-generation'
      : 'text-generation';
  // A statement that sets up the question travels with it to retrieval:
  // "Someone sent me 300 sats. Why does my wallet say it may be uneconomic to
  // spend?" is about dust only because of its first sentence, and the second
  // one alone retrieves nothing useful. What the user says about themself as a
  // learner ("I'm a beginner.", "I prefer short answers.") stays out: it is
  // kept as a declaration, not as a search term.
  const premises = questions.length === 0 ? [] : knowledgeClauses.filter(clause => (
    !questionClause(clause)
    && !PERSONAL_STATEMENT.test(clause)
    && !LEARNING_DECLARATION.test(clause)
    && cleanClause(clause).split(/\s+/).length >= 3
  ));
  const askedQuery = asksAboutUserMemory || walletStateReason || walletActionReason ? null
    : [...premises, ...questions].join(' ') || (requestedCapability === 'text-generation' ? null : knowledgeClauses.join(' ') || null);
  // Wallet guards keep precedence; a present-value request is then answered
  // directly, so it never reaches retrieval or the model. It is read from the
  // knowledge clauses, not from the question clauses only: "Tell me the
  // current fee rate" has no question shape and is still a value request.
  const liveNetworkReason = asksAboutUserMemory || walletStateReason || walletActionReason
    ? null
    : liveNetworkValueReason(knowledgeClauses.join(' '));
  const guarded = Boolean(walletStateReason || walletActionReason || liveNetworkReason);
  const retrievalQuery = liveNetworkReason ? null : askedQuery;
  const declarations = knowledgeClauses
    .filter(clause => !CONDITIONAL_OPENER.test(normalizedFollowUp(clause))).join(' ');
  const personal = PERSONAL_STATEMENT.test(declarations);
  const hasExplicitLearningDeclaration = LEARNING_DECLARATION.test(declarations);

  return {
    kind: asksAboutUserMemory || guarded ? 'conversation' : retrievalQuery && personal
      ? 'mixed'
      : retrievalQuery
        ? 'question'
        : personal || hasExplicitLearningDeclaration
          ? 'personal-statement'
          : 'conversation',
    retrievalQuery,
    asksAboutUserMemory,
    // Recall questions are not new facts; separate declarations still are.
    // A conditional clause ("if I...", "si je...") is a hypothesis, not a
    // declaration, so it never seeds a memory candidate.
    explicitMemoryCandidates: guarded ? [] : [...explicitMemoryCandidates(declarations), ...noteCandidates],
    hasExplicitLearningDeclaration,
    needsConversationContext: !guarded && isContextualFollowUp(retrievalQuery ?? trimmed),
    requestedCapability,
    walletStateReason,
    walletActionReason,
    liveNetworkReason,
    requestedNote: guarded ? null : requestedNote,
  };
}

export function turnResponseDirective(plan: AliceTurnPlan, language: 'en' | 'fr'): string {
  if (plan.asksAboutUserMemory) {
    return language === 'fr'
      ? "Réponds uniquement à partir de la mémoire locale fournie. N'ajoute aucun sujet Bitcoin, aucune supposition et aucune information absente. Si la mémoire est vide, dis simplement que tu ne sais encore rien de pertinent sur l'utilisateur. Une demande de mémorisation n'est pas une confirmation de sauvegarde. Ne prétends pas avoir enregistré un nom ou un fait absent de la mémoire fournie."
      : "Answer only from the provided local memory. Do not add a Bitcoin topic, make assumptions, or invent missing details. If memory is empty, simply say that you do not know anything relevant about the user yet. A request to remember is not confirmation of a save. Do not claim to have stored a name or fact absent from the provided memory.";
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
