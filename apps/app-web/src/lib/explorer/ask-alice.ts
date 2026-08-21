// Compose an "Ask Alice" turn from the deterministic engine's output. This is the
// join of the three contracts: PrivacySignals are projected to AbstractSignals
// (contract 1), the attachments are classified by route() (contract 3), and the
// text handed to the model is exactly the rendered AbstractSignals plus the
// question, nothing more identifying. What the UI shows on the chips IS what is
// sent.
//
// Pure and dependency-free: the seed/key detector is injected (the app wires
// alice-ai's detectSensitiveInput), so this stays testable without the AI package.

import { renderAbstractSignal, toAbstractSignals, type AbstractSignal } from './audit-core.ts';
import { route, type RawSubjectKind, type RouteAttachment, type RouteDecision } from './route.ts';
import type { PrivacySignal } from './signals.ts';

export type AskAlicePrefs = {
  cloudConsent?: boolean;
  identifiedConsent?: boolean;
  intent?: 'question' | 'setup';
};

/** Identified-mode payload: the page's full deterministic description plus the
    raw identifiers it contains, declared so route() classifies honestly (D). */
export type FullContext = {
  description: string;
  subjects: { kind: RawSubjectKind; value: string }[];
};

export type AskAliceComposition = {
  /** The de-identified projection shown as attachment chips and sent to the model. */
  abstractSignals: AbstractSignal[];
  /** The routing decision: class, allowed backends, badge text. */
  decision: RouteDecision;
  /** The exact user message text the model will receive. */
  userMessage: string;
  /** Query used for fiche retrieval (the question, without the analysis block). */
  retrievalQuery: string;
};

export function composeAskAlice(
  input: {
    signals: readonly PrivacySignal[];
    question: string;
    prefs?: AskAlicePrefs;
    fullContext?: FullContext;
    /** One identity-free sentence naming the page the user is on (a fixed
        label from the surface, never built from user data). It rides in the
        de-identified block so Alice knows WHERE without knowing WHAT. */
    pageNote?: string;
  },
  deps: { detectForbidden?: (text: string) => boolean } = {},
): AskAliceComposition {
  const question = input.question.trim();
  const abstractSignals = toAbstractSignals(input.signals);
  const attachments: RouteAttachment[] = abstractSignals.map((signal, i) => ({
    id: `sig-${i}`,
    kind: 'signal',
    signal,
  }));
  // Identified mode: the raw identifiers inside the description are DECLARED
  // as raw attachments, so route() classifies the message D by construction,
  // never by hoping the text scan catches them.
  if (input.fullContext) {
    for (const [i, subject] of input.fullContext.subjects.entries()) {
      attachments.push({ id: `raw-${i}`, kind: 'raw', subject });
    }
  }

  const decision = route(
    { attachments, questionText: question, prefs: input.prefs ?? {} },
    { detectForbidden: deps.detectForbidden },
  );

  const signalText = abstractSignals.map(renderAbstractSignal).join('\n');
  const parts = [question];
  // Identified mode sends ONE block: the full description (which the tabs
  // already extend with the engine's findings in clear). The de-identified
  // projection would only duplicate it in weaker form, so it stays out.
  if (input.fullContext && !decision.blocked) {
    parts.push(`${IDENTIFIED_BLOCK_MARKER}\n${input.fullContext.description}`);
  } else {
    const deidentified = [input.pageNote, signalText].filter(Boolean).join('\n');
    if (deidentified) parts.push(`${DEIDENTIFIED_BLOCK_MARKER}\n${deidentified}`);
  }
  const userMessage = parts.join('\n\n');

  return { abstractSignals, decision, userMessage, retrievalQuery: question };
}

// The attachment blocks inside a sent user message are delimited by these
// markers, so the chat can render them as compact expandable chips while the
// stored message (and what the model received) stays the full text.
export const IDENTIFIED_BLOCK_MARKER = '[Attached on-chain context, identified mode]';
export const DEIDENTIFIED_BLOCK_MARKER = '[Attached de-identified privacy analysis]';

export type MessageAttachment = {
  kind: 'identified' | 'deidentified';
  /** Short human label, derived from the block's own first line. */
  label: string;
  /** The exact block text that was sent. */
  text: string;
};

function identifiedLabel(text: string): string {
  const first = text.split('\n')[0] ?? '';
  const tx = first.match(/^Transaction ([0-9a-f]{64})/i);
  if (tx) return `Transaction ...${tx[1].slice(-5)}`;
  const addr = first.match(/^Address (\S+)/);
  if (addr) return `Address ...${addr[1].slice(-5)}`;
  const block = first.match(/^Block (\d+)/);
  if (block) return `Block ${block[1]}`;
  return 'On-chain context';
}

/**
 * Split a sent user message back into the typed question and its attachment
 * blocks, for display. Pure string work on the markers composeAskAlice wrote;
 * a message without markers comes back unchanged with no attachments.
 */
export function splitAskAliceMessage(content: string): { question: string; attachments: MessageAttachment[] } {
  const iIdent = content.indexOf(IDENTIFIED_BLOCK_MARKER);
  const iDeid = content.indexOf(DEIDENTIFIED_BLOCK_MARKER);
  const indexes = [iIdent, iDeid].filter(i => i >= 0);
  if (indexes.length === 0) return { question: content, attachments: [] };

  const question = content.slice(0, Math.min(...indexes)).trim();
  const attachments: MessageAttachment[] = [];
  if (iIdent >= 0) {
    const end = iDeid > iIdent ? iDeid : content.length;
    const text = content.slice(iIdent + IDENTIFIED_BLOCK_MARKER.length, end).trim();
    attachments.push({ kind: 'identified', label: identifiedLabel(text), text });
  }
  if (iDeid >= 0) {
    const end = iIdent > iDeid ? iIdent : content.length;
    const text = content.slice(iDeid + DEIDENTIFIED_BLOCK_MARKER.length, end).trim();
    attachments.push({ kind: 'deidentified', label: 'De-identified analysis', text });
  }
  return { question, attachments };
}
