import { isDefinitionQuestion } from './pedagogical-profile-core.ts';
import { ragContextChunkLimit } from './rag-context-budget.ts';

/**
 * Shared RAG query shape classification, used by both production wiring
 * (chat-context.tsx) and evaluation tooling, so the two never drift apart.
 */
export type RagQueryShape = 'definition' | 'comparison' | 'ordinary';

const DIACRITICS = new RegExp('[̀-ͯ]', 'g');

function fold(message: string): string {
  return message.toLowerCase().normalize('NFD').replace(DIACRITICS, '');
}

// Explicit comparison/relationship/compatibility vocabulary, FR and EN. This
// is deliberately a short, literal word list rather than a generic "with"
// heuristic: an arbitrary "with" clause ("explain Bitcoin with examples")
// must not be mistaken for a two-subject comparison.
const COMPARISON_WORDS = [
  'compare', 'compares', 'compared', 'comparing', 'comparison', 'comparisons',
  'comparer', 'comparee', 'comparees', 'compares', 'comparaison', 'comparaisons',
  'versus', 'vs',
  'difference', 'differences',
  'differe', 'differente', 'differentes', 'differents', 'differer',
  'compatible', 'compatibles', 'compatibility', 'compatibilite', 'compatibilites',
  'better than', 'mieux que', 'plutot que',
  'par rapport',
];

const COMPARISON_PATTERN = new RegExp(
  `\\b(${COMPARISON_WORDS.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
);

/** A comparison, relationship, or compatibility question naming (or implying) a second subject. */
export function isComparisonRagQuery(message: string): boolean {
  const value = fold(message);
  // The rewrite only adds this line when a follow-up retains its previous
  // subject and names an additional relationship/topic. Its original
  // definition prefix must not shrink that relationship back to one note.
  return /\nfollow-up topic:\s*\S/.test(value)
    || COMPARISON_PATTERN.test(value)
    || /\b(?:work|works|fonctionne|fonctionnent|marche|marchent)\s+(?:together\s+)?(?:with|avec)\s+(?!(?:examples?|exemples?)\b)\S/.test(value);
}

/** Only an overview of Bitcoin itself, never mining/fees/privacy or an L2. */
export function isBroadBitcoinDefinition(message: string): boolean {
  const value = fold(message).replace(/[’'\-?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:please )?(?:explain(?: what is)?|define|tell me about|what is|what s|explique(?: moi)?|definis|c est quoi|qu est ce que) (?:le )?bitcoin(?: (?:simply|in simple terms|simplement|en termes simples|pour debutants))?$/.test(value);
}

/** General L1 fee education, excluding other rails, products/services and transaction troubleshooting. */
export function isGeneralBitcoinFeeQuestion(message: string): boolean {
  const value = fold(message);
  if (isComparisonRagQuery(message)) return false;
  if (/\b(?:lightning|ark|arkade|spark|liquid|ecash|cashu|fedimint|lnurl|swap|provider|exchange|plateforme|prestataire|retrait|withdrawal|ethereum|solana|credit|carte|rbf|cpfp|mempool|stuck|pending|unconfirmed|bloquee?|attente|confirmee?|bump|accelerat\w*|augmenter|consolidat\w*|batch\w*|regroup\w*|utxo|dust|coinjoin|payjoin|mining|minage|subsid(?:y|ies)|rewards?|subventions?|recompenses?|weight|poids|halving|demi[ -]?reduction|subscription|abonnement|alice)\b/.test(value)) return false;
  const explicitFee = /\b(?:fees?|frais)\b/.test(value);
  const onChain = /\b(?:bitcoins?|on[ -]?chain|en chaine|transactions?|miners?|mineurs?)\b/.test(value);
  // A fee/congestion question in this Bitcoin assistant has an L1 meaning;
  // a cost question without "fees" still needs an explicit on-chain transfer.
  const congestion = /\b(?:network|reseau)\b/.test(value)
    && /\b(?:busy|congest\w*|charg[eé]|satur\w*)\b/.test(value);
  const transferCost = /\b(?:on[ -]?chain|en chaine|bitcoins?)\b/.test(value)
    && /\b(?:send|sending|transfer|envoyer|envoie|envoi|transferer)\b/.test(value)
    && /\b(?:paying|costs?|expensive|payer|coute|cher)\b/.test(value);
  // A larger-amount-changes-the-fee question names its own on-chain context
  // (a bigger transfer) without necessarily saying "bitcoin" or "network".
  const amountSizeChangesFee =
    /\b(?:larger|bigger|greater|more)\s+(?:amount|btc|bitcoin|sum)\b/.test(value)
    || /\bsend(?:ing)?\s+more\b/.test(value)
    || /\bmontant\s+plus\s+(?:important|gros|grand|eleve)e?s?\b/.test(value)
    || /\bsomme\s+plus\s+(?:importante|grande|elevee)\b/.test(value)
    || /\benvoyer?\s+plus\b/.test(value);
  if (!(explicitFee && (onChain || congestion || amountSizeChangesFee)) && !transferCost) return false;
  // Besides the usual question-word prefixes, accept English yes/no
  // auxiliaries and French subject-first phrasing (inverted "-t-il/-elle"
  // questions or a leading "si" clause), not only a Why/What/How start.
  return /^(?:please\s+)?(?:how|why|what|explain|tell me|comment|pourquoi|combien|quels?|quelles?|qu['’]|c['’]est|explique|a quoi|does|do|is|are|will|would|can|could|should|si)\b/.test(value)
    || /\best[ -]ce que\b/.test(value)
    || /\b\w+-(?:t-)?(?:ils?|elles?)\b/.test(value);
}

// Small-output cue: the output/amount itself is described as tiny/dust,
// in English or French.
const SMALL_OUTPUT_PATTERN = /\b(?:tiny|very small|dust|small)\s+(?:outputs?|utxos?|amounts?|coins?|change)\b|\b(?:sorties?|montants?|sommes?|utxos?)\s+(?:tres\s+)?(?:petit(?:e)?s?|minuscules?|infimes?)\b|\b(?:tres\s+)?(?:petit(?:e)?s?|minuscules?|infimes?)\s+(?:sorties?|montants?|sommes?|utxos?)\b|\bpoussieres?\b/;

const SMALL_OUTPUT_SPEND_PATTERN = /\b(?:uneconomic\w*|not\s+worth\s+spending|too\s+expensive\s+to\s+spend|refuse\w*\s+to\s+spend|(?:cannot|can['’]t)\s+(?:be\s+spent|spend)|costs?\s+more\s+to\s+spend|not\s+economical)\b|\b(?:non|pas)\s+(?:rentable|economique)\b|\brefus\w*\s+(?:de\s+)?(?:depenser|utiliser)\b|\bcoute\s+plus\s+cher\s+a\s+(?:depenser|utiliser)\b|\bne\s+(?:peut|peuvent)\s+(?:pas\s+)?(?:etre\s+)?depens\w*\b/;

/**
 * A tiny/dust bitcoin output described as uneconomic or refused to spend.
 * Requires both a small-output/amount cue and a spending/economic/refusal
 * cue, so first-payment onboarding or unit definitions (sat/BTC) that only
 * mention a small amount, without any spend/economic/refusal language,
 * do not qualify.
 */
export function isSmallOutputSpendingQuestion(message: string): boolean {
  const value = fold(message).replace(/-(?:t-)?(?:ils?|elles?)\b/g, '');
  if (isComparisonRagQuery(message) || /\b(?:lightning|ark|arkade|spark|liquid|cashu|ecash|fedimint|ethereum|solana)\b/.test(value)) return false;
  return SMALL_OUTPUT_PATTERN.test(value) && SMALL_OUTPUT_SPEND_PATTERN.test(value);
}

const MULTISIG_PATTERN = /\b(?:multisig\w*|multi[ -]signature\w*|multi[ -]sig\w*)\b/;
const MULTISIG_RECOVERY_CUE_PATTERN = /\bback\s*up\w*\b|\bbacked\s*up\b|\b(?:backups?|sauvegard\w*|recover\w*|recuper\w*|restaur\w*|descriptor\w*|descripteurs?|configuration\w*|configur\w*|cosigners?|cosignataires?|quorum|threshold|seuil)\b/;

/**
 * A multisig setup paired with its backup/recovery/descriptor/configuration
 * concern, not a bare "what is multisig" definition or a seed-only
 * (single-sig) wallet recovery question.
 */
export function isMultisigRecoveryQuestion(message: string): boolean {
  if (isComparisonRagQuery(message)) return false;
  const value = fold(message);
  return MULTISIG_PATTERN.test(value) && MULTISIG_RECOVERY_CUE_PATTERN.test(value);
}

/** An explicit protocol acronym must not be displaced by generic risk words. */
export function isExplicitRbfQuestion(message: string): boolean {
  return !isComparisonRagQuery(message) && /\b(?:rbf|replace[ -]by[ -]fee)\b/.test(fold(message));
}

// A transaction-output/input subject cue, FR/EN: UTXO itself, an explicit
// "transaction output/input", an already-spent or "same" output/input, or
// the FR "sortie/entree (de transaction)". Deliberately excludes a bare
// "output"/"input" with no transaction/UTXO/spent qualifier, so unrelated
// computing inputs/outputs and output-index/address definitions don't match.
const UTXO_IO_SUBJECT_PATTERN =
  /\butxos?\b|\bunspent\s+(?:transaction\s+)?outputs?\b|\bsorties?\s+non[ -]depensees?\b|\b(?:tx|transaction)s?\s*(?:outputs?|inputs?)\b|\b(?:outputs?|inputs?)\s+(?:of|from)\s+(?:a|the|an)\s+transaction\b|\b(?:already[ -]spent|spent)\s+outputs?\b|\bsame\s+(?:\w+\s+){0,2}(?:outputs?|utxos?|inputs?)\b|\bmeme\s+(?:\w+\s+){0,2}(?:sorties?|utxos?|entrees?)\b|\bsorties?\s+(?:de\s+)?transactions?\b|\bentrees?\s+(?:de\s+)?transactions?\b/;

// A spending-validity/double-spend cue, FR/EN: the literal "double spend"
// term, a spend verb paired with "twice/again/more than once" (either
// order), an explicit reuse/duplicate/already-spent phrase, or two
// transactions described as referencing the same output/input.
const DOUBLE_SPEND_VALIDITY_PATTERN =
  /\bdouble[ -]?spend\w*\b|\bdouble\s+spending\b|\bdoubles?[ -]depens\w*\b|\bdepense\s+double\b|\b(?:spend|spent|spending|depens\w*)\w*(?:[^.?!]{0,30})\b(?:again|twice|a\s+second\s+time|more\s+than\s+once|once\s+more|encore|deux\s+fois|une\s+(?:seconde|deuxieme)\s+fois)\b|\b(?:again|twice|deux\s+fois|encore)\b(?:[^.?!]{0,30})\b(?:spend|spent|spending|depens\w*)\w*\b|\breuse\w*\b|\breutilis\w*\b|\balready[ -]spent\b|\bdeja\s+depens[eé]\w*\b|\bduplicate\s+(?:transaction\s+)?inputs?\b|\bentrees?\s+(?:de\s+transaction\s+)?dupliquees?\b|\bentrees?\s+en\s+double\b|\b(?:two|second|multiple|another)\s+(?:\w+\s+){0,2}(?:transactions?|tx)\w*\b(?:[^.?!]{0,40})\bsame\s+(?:\w+\s+){0,2}(?:outputs?|utxos?|inputs?)\b|\bsame\s+(?:\w+\s+){0,2}(?:outputs?|utxos?|inputs?)\b(?:[^.?!]{0,40})\b(?:two|second|multiple|another)\s+(?:\w+\s+){0,2}(?:transactions?|tx)\w*\b|\b(?:deux|plusieurs|une\s+autre)\s+transactions?\b(?:[^.?!]{0,40})\bmeme\s+(?:\w+\s+){0,2}(?:sorties?|utxos?|entrees?)\b|\bmeme\s+(?:\w+\s+){0,2}(?:sorties?|utxos?|entrees?)\b(?:[^.?!]{0,40})\b(?:deux|plusieurs|une\s+autre)\s+transactions?\b/;

// Consuming an output only once and two inputs referencing the same output
// express the same validation need without the literal "double spend" term.
const OUTPUT_SINGLE_USE_PATTERN =
  /\b(?:consum\w*|consomm\w*|spen[dt]\w*|depens\w*)\b[^.?!]{0,30}\b(?:only\s+once|just\s+once|qu[ '’]+une\s+fois|une\s+seule\s+fois)\b/;
const DUPLICATE_INPUT_REFERENCE_PATTERN =
  /\b(?:two|multiple|deux|plusieurs)\s+(?:transaction\s+)?(?:inputs?|entrees?)\b[^.?!]{0,50}\b(?:same|meme)\s+(?:\w+\s+){0,2}(?:outputs?|utxos?|sorties?)\b/;

// Adjacent topics that reuse UTXO/input/output or spend-twice vocabulary for
// a different question: L2/virtual outputs, RBF/CPFP/mempool replacement,
// chain reorganizations, and consolidation/coin-control/privacy.
const UTXO_VALIDATION_EXCLUDE_PATTERN =
  /\b(?:lightning|ark|arkade|spark|liquid|ecash|cashu|fedimint|lnurl|channel|canal|canaux)\b|\b(?:rbf|replace[ -]by[ -]fee|cpfp|mempool|unconfirmed|pending)\b|\b(?:reorg\w*|reorganization\w*|orphan\w*|confirm\w*|attente)\b|\b(?:consolidat\w*|coin[ -]?control|batch\w*|regroup\w*|coinjoin|payjoin|privacy|confidentialite|anonymat)\b|\b(?:api|keyboard|clavier|function|fonction|program\w*|software|logiciel)\b/;

/**
 * A narrow evidence-intent predicate: an educational question connecting
 * UTXOs/transaction inputs/outputs to why the same already-spent output (or
 * a duplicated transaction input) can't be spent/accepted again. Requires
 * both a transaction-output/input subject cue and a spending-validity/
 * double-spend cue, so a bare UTXO definition, an output-index/address
 * definition, or an ordinary spend/fee question does not qualify. Excludes
 * explicit comparisons and adjacent topics (Lightning/Ark virtual outputs,
 * RBF/CPFP/mempool conflicts, reorg/confirmations, consolidation/coin
 * control/privacy) that reuse the same vocabulary for a different question.
 */
export function isUtxoValidationQuestion(message: string): boolean {
  if (isComparisonRagQuery(message)) return false;
  const value = fold(message);
  if (UTXO_VALIDATION_EXCLUDE_PATTERN.test(value)) return false;
  return UTXO_IO_SUBJECT_PATTERN.test(value)
    && (DOUBLE_SPEND_VALIDITY_PATTERN.test(value)
      || OUTPUT_SINGLE_USE_PATTERN.test(value)
      || DUPLICATE_INPUT_REFERENCE_PATTERN.test(value));
}

export function classifyRagQuery(message: string): RagQueryShape {
  if (isComparisonRagQuery(message)) return 'comparison';
  if (isBroadBitcoinDefinition(message) || isDefinitionQuestion(message)) return 'definition';
  return 'ordinary';
}

/**
 * Retrieval chunk budget for a turn. A true single-definition question stays
 * at 1 note. A comparison needs both subjects: 2 locally (still a small
 * local prompt), 3 remotely (already Private Cloud's existing bound, so
 * unchanged there). An ordinary question keeps the existing local/remote
 * sizing. `isTechnical` is a lazy callback: it is only invoked for an
 * ordinary local question, never for a cloud turn or a true definition,
 * since the result is not needed there.
 */
export function ragQueryChunkBudget(
  message: string,
  isLocal: boolean,
  isTechnical: () => boolean,
): number {
  const shape = classifyRagQuery(message);
  if (shape === 'definition') return 1;
  if (shape === 'comparison') return isLocal ? 2 : 3;
  return ragContextChunkLimit(isLocal, isLocal ? isTechnical() : false);
}
