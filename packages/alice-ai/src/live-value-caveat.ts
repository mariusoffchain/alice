// Output guard: no fee, mempool or Lightning feed is wired into chat, so an
// answer that presents a present-tense network figure or state is invented.
// The measured small models did it even when told not to (SmolLM3 "around
// 20-40 sat/vB", Qwen3 0.6B "le mempool est saturé en ce moment"). The guard
// never blocks or rewrites the answer; it appends a localized caveat so the
// user sees the limit next to the claim. It is the second line behind the
// deterministic reply for detected present-value questions.

const LIVE_CUE = /\b(?:right now|currently|at the moment|as of (?:my last update|today|now)|today|current(?:ly)?|live|real[- ]time|en ce moment|actuellement|actuel(?:le)?s?|aujourd'hui|a l'instant|en temps reel|a ce jour)\b/;
// A figure with a network unit, a current rate wording or a present mempool
// state. Hypothetical examples ("if you choose 50 sat/vB") are excluded by
// the conditional check below, not by the unit.
const NETWORK_FIGURE = /\b\d+(?:[.,]\d+)?(?:\s*(?:-|to|a|à)\s*\d+(?:[.,]\d+)?)?\s*(?:sats?|satoshis?)\s*(?:\/|per|par)\s*(?:virtual\s+|v)?b(?:yte)?s?\b|\b\d+(?:[.,]\d+)?\s*sat\/vb\b|\b\d+(?:[.,]\d+)?\s*(?:million|millions|k)?\s*(?:unconfirmed )?transactions\s+(?:in|dans|en attente|waiting)\b/;
const MEMPOOL_STATE = /\b(?:mempool|network|reseau)\b[^.!?]{0,60}\b(?:is|is not|isn't|est|n'est pas)\s+(?:not\s+|pas\s+|generally\s+|relatively\s+|relativement\s+|globalement\s+|assez\s+)?(?:congested|saturated|busy|full|calm|quiet|stable|sature|saturee|charge|chargee|calme|stable|encombre)\b/;
const HYPOTHETICAL = /\b(?:if|for example|for instance|say|suppose|imagine|si|par exemple|supposons|imaginons|disons)\b/;

function normalized(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").toLowerCase();
}

/** True when a sentence asserts a present network figure or state as fact. */
export function assertsLiveNetworkValue(answer: string): boolean {
  for (const sentence of normalized(answer).split(/(?<=[.!?])\s+|\n+/)) {
    if (!LIVE_CUE.test(sentence)) continue;
    if (HYPOTHETICAL.test(sentence)) continue;
    if (NETWORK_FIGURE.test(sentence) || MEMPOOL_STATE.test(sentence)) return true;
  }
  return false;
}

export function liveValueCaveat(language: 'en' | 'fr'): string {
  return language === 'fr'
    ? "Attention : cette conversation n'a aucune donnée en direct sur le réseau Bitcoin, le mempool ou les frais. Tout chiffre ou état « actuel » ci-dessus n'est pas une observation réelle ; vérifie l'estimation affichée par ton portefeuille avant de confirmer."
    : "Note: this chat has no live data about the Bitcoin network, the mempool or fees. Any \"current\" figure or state above is not an actual observation; check the estimate shown in your wallet before confirming.";
}

/** Appends the caveat once when the answer asserts a live network value. */
/** The caveat an answer already carries, in either language, or null. */
export function liveValueCaveatIn(answer: string): string | null {
  for (const language of ['en', 'fr'] as const) {
    const caveat = liveValueCaveat(language);
    if (answer.includes(caveat)) return caveat;
  }
  return null;
}

export function withLiveValueCaveat(answer: string, language: 'en' | 'fr'): string {
  if (!answer.trim() || !assertsLiveNetworkValue(answer)) return answer;
  const caveat = liveValueCaveat(language);
  if (answer.includes(caveat)) return answer;
  return `${answer.trimEnd()}\n\n${caveat}`;
}
