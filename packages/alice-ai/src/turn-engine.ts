import type { AIBackendType } from './ai-backend.ts';
import { answerRuleNoteIdsIn, answerRulesBlock } from './answer-rules.ts';
import { aliceMemoryRefusalMessage, type AliceMemory, type AliceMemoryCandidate, type AliceMemoryWrite } from './alice-memory-core.ts';
import { composeGenerationHistory } from './generation-context.ts';
import type { SupportedLanguage } from './language-policy.ts';
import type { Message } from './llm.ts';
import { inferPedagogicalConcepts, type PedagogicalProfile } from './pedagogical-profile-core.ts';
import { rewriteRetrievalQuery } from './rag-query-rewrite.ts';
import type { RagTurnContext, RagTimingMs } from './rag.ts';
import {
  directPersonalAcknowledgement,
  directRequestedNoteResponse,
  directWalletActionResponse,
  directWalletStateResponse,
  planAliceTurn,
  turnResponseDirective,
  type AliceTurnPlan,
} from './turn-planner.ts';
import { liveNetworkValueResponse } from './live-network-request.ts';

export type TurnPreparationDiagnostics = {
  kind: AliceTurnPlan['kind'];
  requestedCapability: AliceTurnPlan['requestedCapability'];
  retrieval: 'none' | 'lexical-or-semantic';
  retrievedChunkIds: string[];
  /** Rule notes (answer-rules.ts) present in the retrieved text of this turn. */
  answerRuleNoteIds: string[];
  ragTimingMs?: RagTimingMs;
  phaseMs: {
    plan: number;
    rewrite: number;
    compose: number;
    pedagogy: number;
    retrieval: number;
    memory: number;
    total: number;
  };
};

export type PreparedAliceTurn = {
  history: Message[];
  plan: AliceTurnPlan;
  directResponse: string | null;
  diagnostics: TurnPreparationDiagnostics;
  explicitMemoryCandidates: AliceMemoryCandidate[];
};

export type TurnPreparationServices = {
  recordPedagogicalSignal(message: string): Promise<PedagogicalProfile>;
  retrieveKnowledge(query: string): Promise<RagTurnContext>;
  getMemory(): Promise<AliceMemory>;
  rememberMemoryCandidates(candidates: AliceMemoryCandidate[]): Promise<AliceMemoryWrite>;
  pedagogicalContext(profile: PedagogicalProfile, message: string, language: SupportedLanguage): string;
  memoryContext(memory: AliceMemory, userMessage: string): string;
  memoryCaptureInstruction: string;
};

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function rounded(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

async function measured<T>(run: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const started = now();
  const value = await run();
  return { value, durationMs: rounded(now() - started) };
}

export async function prepareAliceTurn(input: {
  history: Message[];
  userMessage: string;
  backendType: AIBackendType;
  targetLanguage: SupportedLanguage;
  assistantHistoryDropped?: boolean;
}, services: TurnPreparationServices): Promise<PreparedAliceTurn> {
  const started = now();
  const planStarted = now();
  const plan = planAliceTurn(input.userMessage);
  const planMs = rounded(now() - planStarted);

  // No live wallet-state or payment-execution tool is wired into chat.
  // Explicit payment-execution requests are guarded alongside asks for
  // the user's actual balance, holdings or transaction history. They never
  // reach RAG or the model, which could fabricate amounts or actions; answers
  // are deterministic, before the rewrite below can pull a retrievable
  // topic back in from history (e.g. a guarded follow-up after a technical
  // discussion). A matched wallet request + educational message is also fully
  // short-circuited: the bounded response wins and the educational part goes
  // unanswered, a known limitation of this guard.
  if (plan.walletStateReason || plan.walletActionReason || plan.liveNetworkReason) {
    return {
      history: input.history,
      plan,
      directResponse: plan.walletActionReason
        ? directWalletActionResponse(input.targetLanguage)
        : plan.walletStateReason
          ? directWalletStateResponse(input.targetLanguage)
          : liveNetworkValueResponse(plan.liveNetworkReason!, input.targetLanguage),
      explicitMemoryCandidates: [],
      diagnostics: {
        kind: plan.kind,
        requestedCapability: plan.requestedCapability,
        retrieval: 'none',
        retrievedChunkIds: [],
        answerRuleNoteIds: [],
        phaseMs: {
          plan: planMs,
          rewrite: 0,
          compose: 0,
          pedagogy: 0,
          retrieval: 0,
          memory: 0,
          total: rounded(now() - started),
        },
      },
    };
  }

  // "Retiens que …" / "Remember that …" alone is the whole turn. A sentence
  // the filters refuse gets the reason back and is never written; an accepted
  // one is written first and confirmed only from a successful write. The
  // learning signal is recorded as on the usual path, so "souviens-toi que je
  // débute avec Lightning" still updates the profile. A request followed by a
  // question is not handled here: it takes the usual path below, the note
  // riding along as an explicit candidate.
  if (plan.requestedNote?.standalone) {
    const note = plan.requestedNote;
    const pedagogy = await measured(() => services.recordPedagogicalSignal(input.userMessage));
    const remembered = note.refusal
      ? null
      : await measured(() => services.rememberMemoryCandidates(plan.explicitMemoryCandidates));
    return {
      history: input.history,
      plan,
      directResponse: note.refusal
        ? aliceMemoryRefusalMessage(note.refusal, input.targetLanguage)
        : directRequestedNoteResponse(remembered!.value, note.text, input.targetLanguage),
      explicitMemoryCandidates: plan.explicitMemoryCandidates,
      diagnostics: {
        kind: plan.kind,
        requestedCapability: plan.requestedCapability,
        retrieval: 'none',
        retrievedChunkIds: [],
        answerRuleNoteIds: [],
        phaseMs: {
          plan: planMs,
          rewrite: 0,
          compose: 0,
          pedagogy: pedagogy.durationMs,
          retrieval: 0,
          memory: remembered?.durationMs ?? 0,
          total: rounded(now() - started),
        },
      },
    };
  }

  // A follow-up such as "Pourquoi ?" or "Développe" cannot be retrieved on its
  // own. The query, and only the query, is rewritten from the recent in-memory
  // history; the user message below stays raw (rag-query-rewrite.ts).
  const rewriteStarted = now();
  const retrievalQuery = rewriteRetrievalQuery({
    history: input.history,
    userMessage: input.userMessage,
    plan,
  });

  const rewriteMs = rounded(now() - rewriteStarted);

  const [pedagogy, retrieval, memory] = await Promise.all([
    measured(() => services.recordPedagogicalSignal(input.userMessage)),
    measured(() => retrievalQuery
      ? services.retrieveKnowledge(retrievalQuery)
      : Promise.resolve<RagTurnContext>({ ragContext: null, localContext: null, learnContext: null, diagnostics: [] })),
    measured(async () => plan.explicitMemoryCandidates.length > 0
      ? (await services.rememberMemoryCandidates(plan.explicitMemoryCandidates)).memory
      : services.getMemory()),
  ]);

  // The pedagogical context is keyed on concepts inferred from the message.
  // A follow-up like "so how do I actually do it?" carries no keywords, and a
  // profile that only speaks when the current sentence names a topic goes
  // silent exactly when continuity matters. When the message infers nothing,
  // fall back to the concepts of the recent user turns; the definition-question
  // heuristic still reads the real message, never the stitched history.
  const composeStarted = now();
  // The notes that carry answer rules are read from the retrieved text the
  // model will see, so a note dropped by the context fit brings no rule.
  const answerRuleNoteIds = answerRuleNoteIdsIn(retrieval.value.ragContext ?? '');
  const conceptSource = inferPedagogicalConcepts(input.userMessage).length > 0
    ? input.userMessage
    : input.history
      .filter(message => message.role === 'user')
      .slice(-3)
      .map(message => message.content)
      .concat(input.userMessage)
      .join('\n');

  const history = composeGenerationHistory(
    input.history,
    retrieval.value,
    plan.kind === 'personal-statement' || plan.asksAboutUserMemory
      ? ''
      : services.pedagogicalContext(pedagogy.value, conceptSource, input.targetLanguage),
    input.assistantHistoryDropped,
    // Memory rides on every backend since 2026-08-20. It used to be injected
    // on the local model only, while the capture instruction still went to the
    // cloud: Alice was asked to extract memories there that she would never be
    // shown again, which is why cloud answers read as if she had learned
    // nothing. The items were extracted from conversations that already
    // transit the same end-to-end encrypted enclave, so showing them back
    // adds no exposure a cloud conversation had not already accepted; they
    // remain on-device, inspectable and erasable in "What Alice knows".
    services.memoryContext(memory.value, input.userMessage),
    memory.value.enabled ? services.memoryCaptureInstruction : '',
    turnResponseDirective(plan, input.targetLanguage),
    plan.needsConversationContext,
    answerRulesBlock(answerRuleNoteIds, input.targetLanguage),
  );

  return {
    history,
    plan,
    directResponse: plan.kind === 'personal-statement'
      ? directPersonalAcknowledgement(input.targetLanguage)
      : null,
    explicitMemoryCandidates: plan.explicitMemoryCandidates,
    diagnostics: {
      kind: plan.kind,
      requestedCapability: plan.requestedCapability,
      retrieval: retrievalQuery ? 'lexical-or-semantic' : 'none',
      retrievedChunkIds: retrieval.value.diagnostics?.map(chunk => chunk.id) ?? [],
      answerRuleNoteIds,
      ...(retrieval.value.timingMs ? { ragTimingMs: retrieval.value.timingMs } : {}),
      phaseMs: {
        plan: planMs,
        rewrite: rewriteMs,
        compose: rounded(now() - composeStarted),
        pedagogy: pedagogy.durationMs,
        retrieval: retrieval.durationMs,
        memory: memory.durationMs,
        total: rounded(now() - started),
      },
    },
  };
}
