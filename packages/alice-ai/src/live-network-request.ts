import type { AliceLiveNetworkReason } from './turn-planner.ts';

// Narrow intent routing for requests about present network values. It only
// selects a turn-scoped capability statement; it never answers on its own and
// never fetches anything. No fee, mempool or Lightning-route feed is wired
// into chat, so the statement is true for every turn it could match.
const NOW = /\b(?:right now|now|currently|at the moment|at this moment|today|current|live|real[- ]time|en ce moment|maintenant|actuellement|aujourd'hui|actuel(?:le)?s?|en temps reel|en direct|a l'instant)\b/;
const NEXT_BLOCK = /\b(?:next block|prochain bloc)\b/;
const ONCHAIN_FEE = /\b(?:fees?|fee ?rates?|feerates?|sat(?:s|oshis?)?\s*(?:\/|per)\s*v?b(?:yte)?s?|frais|taux de frais)\b/;
const LIGHTNING_ROUTE = /\b(?:routing fees?|frais de routage|liquidity|liquidite|outbound capacity|capacite sortante)\b/;
const LIGHTNING_INBOUND = /\b(?:inbound (?:capacity|liquidity)|liquidit[ey] entrante|capacite entrante|receive(?:d|r)? capacity|capacite de reception)\b/;
const MEMPOOL = /\bmempool\b/;
// Rules, policies and mechanisms are documentation, not present values,
// even when phrased with "current" (the current RBF policy).
const DOCUMENTATION = /\b(?:replace[- ]by[- ]fee|rbf|polic(?:y|ies)|politiques?|rules?|regles?|bips?|consensus|definition|definir)\b/;
// Explanations asked next to a time cue: what a fee or the mempool is, how
// estimation works, whether a fee applies at all, what a word means, which
// methods exist. "What is the fee right now?" (definite article) still asks
// for the figure; "What is a fee rate?" and "What are fees?" do not.
const CONCEPTUAL = /\b(?:what(?:'s| is| are) (?:(?:a|an) )?(?:fee ?rates?|fees|frais|mempool)\b|(?:c'est quoi|qu'est-ce qu(?:e|')) ?(?:(?:un|une|des|les|le|la) )?(?:frais|taux de frais|mempool|liquidite)\b|(?:is|are) there (?:a|an|any|some) (?:routing )?fees?\b|y a-t-il des frais\b|\bdifference\b|\b(?:methods?|methodes?|techniques?|algorithms?|algorithmes?|approach(?:es)?|approches?)\b|\bmeans?\b|\bsignifie\b|veut dire|\bhow\b[^?]*\b(?:works?|working|calculated|computed|estimated|determined|chosen)\b|\bcomment (?:fonctionne|marche|sont (?:calcules|estimes|determines)|est (?:calcule|estime|determine))\b|\bresearch\b|\brecherches?\b)/;
// A present value is asked for, not merely mentioned: the sentence must ask
// for a value. "How does the mempool work today compared to 2017?" and
// "J'ai payé des frais aujourd'hui, est-ce normal ?" carry a time cue and a
// fee word but request an explanation or a judgement, never a figure.
const VALUE_REQUEST = /\b(?:what(?:'s)?|which|how (?:much|many|high|low|full|busy|congested|expensive|cheap)|is (?:the|it|there)|are (?:the|they|there)|can you (?:tell|give|show)|could you (?:tell|give|show)|tell me|give me|show me|do you know|will (?:my|it|this|the)|quel(?:le|s|les)?|combien|est-ce qu(?:e|'il|'elle)|est-il|est-elle|sont-ils|sont-elles|y a-t-il|c'est quoi|peux-tu|pouvez-vous|dis-moi|dites-moi|donne-moi|donnez-moi|va-t-elle|va-t-il|sera-t-elle|sera-t-il|ai-je|avez-vous)\b/;

function normalized(message: string): string {
  return message.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'").toLowerCase();
}

// "Next block" without a time cue marks a conceptual question ("If I pay a
// higher fee, will my transaction be in the next block?") unless the sentence
// asks which fee or how much to pay; only the latter is a present value.
const FEE_VALUE_REQUEST = /\b(?:what|which|how (?:much|many|high)|quel(?:le|s|les)?|combien)\b/;

function asksForValue(sentence: string, nextBlockOnly: boolean): boolean {
  if (nextBlockOnly) return FEE_VALUE_REQUEST.test(sentence);
  if (VALUE_REQUEST.test(sentence)) return true;
  // A terse question such as "Current fee rate?" has no interrogative word.
  return /\?\s*$/.test(sentence) && sentence.trim().split(/\s+/).length <= 4;
}

export function liveNetworkValueReason(message: string): AliceLiveNetworkReason | null {
  for (const sentence of normalized(message).split(/(?<=[.!?;])\s+/)) {
    if (DOCUMENTATION.test(sentence) || CONCEPTUAL.test(sentence)) continue;
    const nextBlock = NEXT_BLOCK.test(sentence);
    const now = NOW.test(sentence);
    if (!nextBlock && !now) continue;
    if (!asksForValue(sentence, nextBlock && !now)) continue;
    if (LIGHTNING_INBOUND.test(sentence)) return 'lightning-inbound';
    if (LIGHTNING_ROUTE.test(sentence)) return 'lightning-route';
    if (ONCHAIN_FEE.test(sentence)) return 'onchain-fee';
    if (MEMPOOL.test(sentence)) return 'mempool';
  }
  return null;
}

/**
 * Deterministic reply for a present-value request. No model turn: every
 * local model that was measured either ignored the capability statement or
 * invented a figure under it (paired generation of 2026-10-05, docs/RAG_EVALUATION.md).
 * The text states the boundary, the mechanism from the static notes and the
 * wallet referral, and never contains a figure.
 */
export function liveNetworkValueResponse(reason: AliceLiveNetworkReason, language: 'en' | 'fr'): string {
  const french = language === 'fr';
  switch (reason) {
    case 'onchain-fee':
      return french
        ? "Cette conversation n'a aucune donnée en direct sur le réseau Bitcoin ni sur le mempool, et ne voit pas ton portefeuille : elle ne peut pas te donner un taux de frais actuel. Les frais on-chain dépendent de la taille virtuelle de la transaction (entrées, sorties, scripts) multipliée par le taux choisi en sat/vB, pas du montant envoyé ; la demande d'espace de bloc fait varier ce taux. Ton portefeuille affiche une estimation ou un devis basé sur ses observations actuelles : vérifie-le, ainsi que le total des frais, avant de confirmer. Un taux plus élevé augmente la priorité, mais aucun niveau de frais ne garantit l'inclusion dans le prochain bloc."
        : "This chat has no live data about the Bitcoin network or the mempool and cannot see your wallet, so it cannot give you a current fee rate. On-chain fees depend on the transaction's virtual size (inputs, outputs, scripts) multiplied by the fee rate you choose in sat/vB, not on the amount sent; demand for block space moves that rate. Your wallet shows an estimate or quote based on its current observations: review it, and the total fee, before confirming. A higher rate improves priority, but no fee level guarantees inclusion in the next block.";
    case 'mempool':
      return french
        ? "Cette conversation n'a aucune observation en direct du mempool : elle ne peut pas dire s'il est chargé en ce moment. Chaque nœud garde son propre mempool de transactions valides non confirmées, et sa charge change en permanence ; quand la demande d'espace de bloc monte, les mineurs choisissent d'abord les transactions qui paient le plus. Pour l'état actuel, regarde une vue du mempool ou l'estimation de frais affichée par ton portefeuille, à vérifier avant de confirmer. Aucun niveau de frais ne garantit l'inclusion dans le prochain bloc."
        : "This chat has no live view of the mempool, so it cannot say how busy it is right now. Each node keeps its own mempool of valid unconfirmed transactions and its load changes constantly; when demand for block space rises, miners pick the transactions that pay the most first. For the current state, check a mempool view or the fee estimate shown in your wallet, and review it before confirming. No fee level guarantees inclusion in the next block.";
    case 'lightning-route':
      return french
        ? "Cette conversation n'a aucune donnée en direct sur les routes Lightning ni sur la liquidité des canaux, et ne voit pas ton portefeuille : elle ne peut pas te donner les frais de routage ni la liquidité disponibles en ce moment. Les frais de routage dépendent des politiques des nœuds intermédiaires (une base fixe plus une part proportionnelle au montant), du montant transféré et de la route trouvée au moment du paiement ; la liquidité disponible limite les routes utilisables. Ton portefeuille affiche le devis de la route qu'il trouve : vérifie-le avant de confirmer le paiement."
        : "This chat has no live data about Lightning routes or channel liquidity and cannot see your wallet, so it cannot give you the routing fee or the liquidity available right now. Routing fees depend on the forwarding nodes' policies (a fixed base plus a share proportional to the amount), on the amount forwarded and on the route found at payment time; available liquidity limits which routes can be used. Your wallet shows the quote for the route it finds: review it before confirming the payment.";
    case 'lightning-inbound':
      return french
        ? "Cette conversation ne voit ni ton portefeuille ni tes canaux Lightning, et n'a aucune donnée en direct : elle ne peut pas te dire ta liquidité entrante actuelle. La liquidité entrante limite le montant que tu peux recevoir par tes canaux ou ton fournisseur. La valeur actuelle se lit sur l'écran Lightning de ton portefeuille."
        : "This chat cannot see your wallet or your Lightning channels and has no live data, so it cannot tell you your current inbound liquidity. Inbound liquidity limits the amount you can receive through your channels or your provider. The current value is shown on your wallet's Lightning screen.";
  }
}
