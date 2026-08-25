// Fiche: the unit of the RAG corpus, CONTRAT 2 of CONTRATS_AUDIT_ALICE.md.
//
// The local model does not know Bitcoin; it retrieves what was written and
// reviewed. A Fiche is a retrievable, versioned, guarded knowledge unit. The
// main danger is not inventing a fact, it is retrieving a correct fact and
// applying it to the wrong situation, so the guards are structured data enforced
// by code, never prose folded into a prompt:
//  - legalPosture is applied by code: an `explain_never_recommend` Fiche is
//    structurally ineligible for any action list.
//  - preconditions / contraindications gate applicability; a hard contraindication
//    removes the Fiche, it does not merely nuance it.
//
// A Fiche projects to alice-ai's KnowledgeChunk for retrieval (text + keywords),
// but the guard fields stay in this layer: the RAG retrieves, our engine gates.

import type { KnowledgeChunk, KnowledgeLocale } from '@alice-wallet/alice-ai';
import type { RuleId } from './signals.ts';

export type FicheId = string;

export type FicheKind =
  | 'concept'      // what it is
  | 'remediation'  // how to act
  | 'threat'       // who you defend against
  | 'tool'         // a specific piece of software
  | 'legal';       // framing

/**
 * The legal/ethical line, encoded in the data, not the prompt. The renderer
 * mechanically refuses to list an `explain_never_recommend` Fiche as an action.
 */
export type LegalPosture =
  | 'safe_to_recommend'        // Silent Payments, coin control, no reuse
  | 'educational_only'         // explained on request, never proposed spontaneously
  | 'explain_never_recommend'; // mixers: explained, never pushed

export interface Precondition {
  expr: string;       // e.g. 'utxoCount >= 2'
  humanLabel: string; // e.g. "at least two spendable UTXOs"
}

export interface Contraindication {
  expr: string;
  humanLabel: string;
  hard: boolean;      // true = the Fiche is dropped; false = flagged as a reservation
}

export interface FicheSource {
  url: string;
  label: string;
  checkedAt: string;  // ISO date the source was last verified
}

export interface Fiche {
  id: FicheId;
  version: number;
  updatedAt: string;
  reviewedBy: string;

  kind: FicheKind;
  locale: 'fr' | 'en';
  title: string;
  summary: string;    // one or two sentences, also used for retrieval
  body: string;       // the full content

  appliesTo: RuleId[];      // the join between findings and advice
  retrievalHints: string[]; // terms for hybrid retrieval

  preconditions: Precondition[];
  contraindications: Contraindication[];

  effort: 'trivial' | 'low' | 'medium' | 'high';
  cost: 'none' | 'fees_only' | 'significant';
  reversibility: 'reversible' | 'irreversible';

  legalPosture: LegalPosture;
  disclaimer?: string;

  sources: FicheSource[];
  supersedes?: FicheId;
  stability: 'stable' | 'volatile'; // 'volatile' = review every quarter
}

// The disclaimer a Fiche must carry, derived from its legalPosture, so the same
// posture always produces the same wording and no Fiche can quietly omit it.
// The topic is never censored: Alice may explain any technique fully, including
// how it is used, when the user asks. The line is on initiative, not on subject:
// an explain_never_recommend technique is never proposed by Alice and always
// carries the regulatory-risk note.
export function disclaimerFor(posture: LegalPosture): string | undefined {
  switch (posture) {
    case 'safe_to_recommend':
      return undefined;
    case 'educational_only':
      return 'Shared to explain, not as a recommendation.';
    case 'explain_never_recommend':
      return 'Advanced, expert-level option that carries regulatory risk in some jurisdictions. Explained on request, never a recommendation.';
  }
}

/**
 * The behaviour policy the Ask-Alice turn injects into the system prompt, so the
 * model's latitude is set by data, not improvised. It mirrors exactly what the
 * code already enforces around legalPosture.
 */
export const POSTURE_POLICY =
  'When discussing Bitcoin privacy techniques: explain any technique factually and neutrally, ' +
  'including how it works and, if the user asks, how it is used. The subject is never off-limits. ' +
  'Never propose, endorse, or rank a technique that is marked not-recommendable on your own initiative: ' +
  'raise it only if the user asks about it, and always include its stated disclaimer. ' +
  'Only techniques marked safe-to-recommend may appear in proactive suggestions or best-practice lists. ' +
  'Ground every factual claim in a cited fiche; if no fiche supports it, say so rather than guess.';

/**
 * Whether a Fiche may appear in a spontaneous action/recommendation list. Only
 * `safe_to_recommend` qualifies: `educational_only` is explained on request but
 * never proposed on its own, `explain_never_recommend` is never proposed at all.
 * This is CONTRAT 2 rule 4, enforced in code.
 */
export function isRecommendable(fiche: Fiche): boolean {
  return fiche.legalPosture === 'safe_to_recommend';
}

export interface GuardEvaluation {
  /** All preconditions hold. */
  applicable: boolean;
  unmetPreconditions: Precondition[];
  /** A hard contraindication fired: the Fiche is dropped, not nuanced. */
  dropped: boolean;
  /** Soft contraindications: shown as reservations, the Fiche stays. */
  reservations: Contraindication[];
  /** applicable AND not dropped: the Fiche may be used for this context. */
  eligible: boolean;
}

/**
 * Evaluate a Fiche's guards against the current situation. `evalExpr` is injected
 * so this stays pure and testable: the caller owns how an expression like
 * 'utxoCount >= 2' is resolved from the live signals. An expression that cannot
 * be evaluated is treated as false (fail-closed for preconditions, and a hard
 * contraindication whose expression is unknown does not fire).
 */
export function evaluateFicheGuards(fiche: Fiche, evalExpr: (expr: string) => boolean): GuardEvaluation {
  const unmetPreconditions = fiche.preconditions.filter(p => !safeEval(evalExpr, p.expr));
  const firedContra = fiche.contraindications.filter(c => safeEval(evalExpr, c.expr));
  const dropped = firedContra.some(c => c.hard);
  const reservations = firedContra.filter(c => !c.hard);
  const applicable = unmetPreconditions.length === 0;
  return { applicable, unmetPreconditions, dropped, reservations, eligible: applicable && !dropped };
}

function safeEval(evalExpr: (expr: string) => boolean, expr: string): boolean {
  try {
    return evalExpr(expr) === true;
  } catch {
    return false;
  }
}

const KIND_TO_LEVEL: Record<FicheKind, KnowledgeChunk['level']> = {
  concept: 'beginner',
  remediation: 'intermediate',
  threat: 'intermediate',
  tool: 'advanced',
  legal: 'intermediate',
};

/**
 * Project a Fiche into an alice-ai KnowledgeChunk so it feeds the existing RAG.
 * Only the retrievable surface crosses (title, hints, summary + body); the guards
 * (legalPosture, contraindications) stay in this layer and are enforced by code,
 * not by the retriever. The Fiche id is reused verbatim so a retrieved chunk maps
 * straight back to its Fiche for citation and gating.
 */
export function ficheToKnowledgeChunk(fiche: Fiche): KnowledgeChunk {
  const titleWords = fiche.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const keywords = Array.from(new Set([...fiche.retrievalHints, ...titleWords]));
  return {
    id: fiche.id,
    // conceptId ties this source chunk to its translated variants so the RAG
    // keeps one per concept and prefers the reader's language (preferKnowledgeLocale).
    conceptId: fiche.id,
    title: fiche.title,
    keywords,
    level: KIND_TO_LEVEL[fiche.kind],
    content: `${fiche.summary}\n\n${fiche.body}`,
    theme: 'privacy',
    locale: fiche.locale,
    sourceLocale: fiche.locale,
    translationStatus: 'source',
    retrievalWeight: fiche.stability === 'volatile' ? 0.9 : 1,
  };
}

/** The reviewed translation of a Fiche's retrievable surface into another
 *  language. The guards stay on the source Fiche; only retrievable text crosses. */
export interface FicheTranslation {
  locale: KnowledgeLocale;
  title: string;
  summary: string;
  body: string;
  /** Extra language-specific retrieval terms, merged with the source hints. */
  retrievalHints: string[];
}

/**
 * Project a Fiche plus a reviewed translation into a second KnowledgeChunk that
 * shares the source's conceptId, so `preferKnowledgeLocale` serves it to a reader
 * in that language. The chunk id is suffixed with the locale (`FICHE_X:fr`); the
 * base Fiche id is recoverable by stripping that suffix for citation and gating.
 */
export function ficheTranslationToChunk(fiche: Fiche, tr: FicheTranslation): KnowledgeChunk {
  const titleWords = tr.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const keywords = Array.from(new Set([...fiche.retrievalHints, ...tr.retrievalHints, ...titleWords]));
  return {
    id: `${fiche.id}:${tr.locale}`,
    conceptId: fiche.id,
    title: tr.title,
    keywords,
    level: KIND_TO_LEVEL[fiche.kind],
    content: `${tr.summary}\n\n${tr.body}`,
    theme: 'privacy',
    locale: tr.locale,
    sourceLocale: fiche.locale,
    translationStatus: 'reviewed',
    retrievalWeight: fiche.stability === 'volatile' ? 0.9 : 1,
  };
}
