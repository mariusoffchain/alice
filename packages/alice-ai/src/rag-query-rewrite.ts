import type { Message } from './llm.ts';
import { isExplicitContinuationRequest, planAliceTurn, type AliceTurnPlan } from './turn-planner.ts';

/**
 * Deterministic retrieval-query rewriting for multi-turn follow-ups.
 *
 * "Pourquoi ?", "Développe", "Tell me more" carry no retrievable subject:
 * searching the knowledge base with them returns noise, and the answer drifts
 * away from the topic the user is still asking about. The rewrite is local,
 * pure and bounded. It reuses the question clause of a recent user turn taken
 * from the in-memory history: no stored state, no extra model or network call,
 * never an assistant answer, never a personal declaration, never a memory
 * question, and never a previously rewritten query. The user message itself
 * stays raw in the outbound history; only the retrieval query is rewritten.
 */

/**
 * Continuity is short-lived: never walk back further than the last six
 * exchanges, whatever the conversation length.
 */
const MAX_SCANNED_MESSAGES = 12;
/** Hard caps, so a rewritten query cannot grow with the conversation. */
const MAX_ANCHOR_CHARS = 160;
const MAX_FOLLOW_UP_TOPIC_WORDS = 6;
const MAX_FOLLOW_UP_TOPIC_CHARS = 60;
const FOLLOW_UP_TOPIC_LABEL = 'Follow-up topic: ';

/** Upper bound of a rewritten query; autonomous queries pass through unchanged. */
export const MAX_REWRITTEN_QUERY_CHARS =
  MAX_ANCHOR_CHARS + 1 + FOLLOW_UP_TOPIC_LABEL.length + MAX_FOLLOW_UP_TOPIC_CHARS;

// Generic follow-up vocabulary: pronouns, auxiliaries, determiners and the few
// continuation verbs that carry no retrieval signal on their own. This is
// deliberately a stopword list, not a topic dictionary: whatever survives it is
// treated as a named subject, so the module needs no inventory of Bitcoin
// topics to recognize one.
const FOLLOW_UP_NOISE = new RegExp(
  String.raw`\b(?:${[
    // Hyphenated and multi-word openers come first: a global replace scans left
    // to right and would otherwise consume only the first word of these.
    "qu'en est[- ]il", 'est[- ]ce que', 'est[- ]il', 'peux[- ]tu', 'pourrais[- ]tu',
    'tell me', 'dis[- ]moi', "dis[- ]m'en", "donne[- ]m'en", 'what about', 'how about',
    'can', 'could', 'would', 'will', 'do', 'does', 'did', 'is', 'are', 'you', 'please',
    'explain', 'expand', 'elaborate', 'tell', 'say', 'give', 'me', 'us', 'more', 'further',
    'deeper', 'go', 'dig', 'example', 'show', 'detail', 'details', 'that', 'this', 'it', 'its', 'them', 'those', 'these', 'they',
    'and', 'but', 'what', 'about', 'why', 'how', 'so', 'then', 'again', 'also', 'too', 'bit',
    'the', 'a', 'an', 'of', 'for', 'with', 'on',
    'peux', 'pourrais', 'pourriez', 'tu', 'vous', 'expliquer', 'explique', 'expliques',
    'approfondir', 'approfondis', 'developpe', 'developper', 'detaille', 'detailler',
    'precise', 'continue', 'continuer', 'dis', "m'en", 'plus', 'davantage',
    'montre', 'moi', 'donne', 'exemple', 'ca', 'cela', 'ceci', 'et', 'mais', 'quoi', 'pourquoi', 'comment', 'alors', 'donc',
    'aussi', 'encore', 'concretement', 'pratique', 'precisement', 'exactement', 'vraiment', 'justement',
    'simplement', 'reellement', 'concretely', 'practically', 'precisely', 'exactly', 'really', 'simply',
    'basically', 'specifically', 'practice', 'in', 'le', 'la', 'les', 'un', 'une', 'du', 'de', 'des', 'en', 'y',
    'est', 'sont', 'il', 'elle', 'ils', 'elles', 'avec', 'pour', 'sur',
    'moi', 'toi', 'peu', 'merci', 'svp', 'stp', 'ok', 'thanks',
  ].join('|')})\b`,
  'gi',
);

// An explicit reference back to what Alice just said. It is what separates
// "Et ça marche avec Ark ?" (still the previous subject, seen through Ark) from
// "Et les CoinJoin alors ?" (a new named subject of its own).
const PREVIOUS_ANSWER_REFERENCE = new RegExp(
  String.raw`\b(?:${[
    'that', 'this', 'it', 'its', 'they', 'them', 'those', 'these',
    'the previous (?:answer|point|one)', 'your answer',
    '(?:first|second|third|other) (?:case|one|point)',
    '(?:premier|second|deuxieme|troisieme|autre) (?:cas|point)',
    'par rapport', 'quelle difference avec',
    'ca', 'cela', 'ceci', 'celui', 'celle', 'ceux', 'celles',
    'ce point', 'cette reponse', 'la reponse precedente', 'le precedent', 'ton explication',
  ].join('|')})\b`,
  'i',
);

const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Lowercase and drop diacritics so the rules above stay ASCII and readable. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What a follow-up adds to the subject it refers to, if anything: the words
 * left once the generic follow-up vocabulary is removed.
 */
function followUpTopic(message: string): string {
  return fold(message)
    .replace(FOLLOW_UP_NOISE, ' ')
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .map(word => word.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .slice(0, MAX_FOLLOW_UP_TOPIC_WORDS)
    .join(' ')
    .slice(0, MAX_FOLLOW_UP_TOPIC_CHARS)
    .trim();
}

/**
 * A follow-up that names a subject of its own without pointing back at the
 * previous answer is a topic change: it must be retrieved on its own terms,
 * or the autonomous topic it names gets contaminated by the former one.
 */
function isTopicChange(message: string): boolean {
  const folded = fold(message);
  // A named subject before a comma owns a subsequent pronoun. In contrast,
  // "Et ça marche avec Ark ?" points to the previous subject before naming Ark.
  const prefix = folded.split(',')[0];
  if (folded.includes(',') && !PREVIOUS_ANSWER_REFERENCE.test(prefix) && followUpTopic(prefix)) return true;
  // An autonomous question naming its subject before a later pronoun is
  // complete without history ("How does RBF work when it ...?").
  const reference = PREVIOUS_ANSWER_REFERENCE.exec(folded);
  if (reference && /^(?:what|how|why|comment|pourquoi|qu['’]est)/.test(folded)) {
    const beforeReference = folded.slice(0, reference.index);
    if (/^(?:what is|what does|how does|how do|why does|why is|comment fonctionne|pourquoi)\s+\S/.test(beforeReference)
      && followUpTopic(beforeReference).split(' ').filter(Boolean).length >= 2) return true;
  }
  if (reference) return false;
  return followUpTopic(message).length > 0;
}

function topicChangeQuery(message: string): string {
  const topic = followUpTopic(message);
  // Keep compact topic-only switches stable, but retain question syntax for
  // substantive questions so the downstream intent classifiers can read it.
  return boundedAnchor(topic.split(' ').length <= 2 ? topic : message);
}

function boundedAnchor(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_ANCHOR_CHARS).trim();
}

/**
 * The most recent user turn that can legitimately be searched again.
 *
 * Assistant text is never a retrieval source. Personal declarations and
 * questions about user memory end the knowledge context. Greetings and
 * acknowledgements with no query are skipped. A mixed turn contributes
 * only its question clause, never the personal sentence next to it. A turn that
 * was itself a bare follow-up is skipped too, so repeated follow-ups keep
 * reaching the subject instead of quoting each other; a turn that changed the
 * topic stops the walk, since it is the subject now under discussion.
 */
function anchorSubject(history: Message[], userMessage: string): string | null {
  const current = fold(userMessage);
  let start = history.length - 1;
  const latest = history[start];
  // The caller appends the current message to the history it passes in.
  if (latest?.role === 'user' && fold(latest.content) === current) start -= 1;

  for (let index = start; index >= 0 && start - index < MAX_SCANNED_MESSAGES; index--) {
    const message = history[index];
    if (message?.role !== 'user' || !message.content.trim()) continue;

    const candidate = planAliceTurn(message.content);
    if (candidate.kind === 'personal-statement' || candidate.asksAboutUserMemory || candidate.walletStateReason || candidate.walletActionReason) return null;
    if (!candidate.retrievalQuery) continue;
    if (candidate.needsConversationContext) {
      if (!isTopicChange(candidate.retrievalQuery)) continue;
      return topicChangeQuery(candidate.retrievalQuery);
    }
    return boundedAnchor(candidate.retrievalQuery);
  }
  return null;
}

/**
 * The query to search the knowledge base with for the current turn, or null
 * when this turn must not search at all.
 */
export function rewriteRetrievalQuery(input: {
  history: Message[];
  userMessage: string;
  plan: AliceTurnPlan;
}): string | null {
  const { history, userMessage, plan } = input;

  // Autonomous questions, greetings, personal statements and memory questions
  // keep the plan exactly as it is: this rewrite only ever speaks for turns
  // that cannot be retrieved on their own.
  if (plan.walletStateReason || plan.walletActionReason) return null;
  if (plan.asksAboutUserMemory || plan.kind === 'personal-statement') return plan.retrievalQuery;
  if (!plan.needsConversationContext) return plan.retrievalQuery;

  // A turn with no question shape of its own is promoted to retrieval only when
  // it explicitly asks for more ("Développe", "Tell me more"). An
  // acknowledgement such as "That makes sense." also refers to the previous
  // answer, and must stay a conversation turn without retrieval.
  if (!plan.retrievalQuery && !isExplicitContinuationRequest(userMessage)) return null;

  // Read the question clause when the turn has one, never the raw sentence next
  // to it: a mixed turn such as "I'm new to this. What about Lightning?" must
  // not feed its personal declaration back into the search.
  const followUpSource = plan.retrievalQuery ?? userMessage;
  // Only a question-shaped turn can change the topic. "Développe un peu" names
  // nothing retrievable, so an imperative always keeps the inherited subject
  // rather than searching for whatever word happens to follow the verb.
  if (plan.retrievalQuery && isTopicChange(followUpSource)) return topicChangeQuery(followUpSource);

  const anchor = anchorSubject(history, userMessage);
  if (!anchor) return plan.retrievalQuery;

  const topic = followUpTopic(followUpSource);
  return topic ? `${anchor}\n${FOLLOW_UP_TOPIC_LABEL}${topic}` : anchor;
}
