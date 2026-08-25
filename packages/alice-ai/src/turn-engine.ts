import type { AIBackendType } from './ai-backend.ts';
import type { AliceMemory, AliceMemoryCandidate } from './alice-memory-core.ts';
import { composeGenerationHistory } from './generation-context.ts';
import type { SupportedLanguage } from './language-policy.ts';
import type { Message } from './llm.ts';
import { inferPedagogicalConcepts, type PedagogicalProfile } from './pedagogical-profile-core.ts';
import type { RagTurnContext } from './rag.ts';
import {
  directPersonalAcknowledgement,
  planAliceTurn,
  turnResponseDirective,
  type AliceTurnPlan,
} from './turn-planner.ts';

export type TurnPreparationDiagnostics = {
  kind: AliceTurnPlan['kind'];
  requestedCapability: AliceTurnPlan['requestedCapability'];
  retrieval: 'none' | 'lexical-or-semantic';
  retrievedChunkIds: string[];
  phaseMs: {
    plan: number;
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
  rememberMemoryCandidates(candidates: AliceMemoryCandidate[]): Promise<AliceMemory>;
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

function retrievalQueryForTurn(
  history: Message[],
  plan: AliceTurnPlan,
): string | null {
  if (!plan.retrievalQuery || !plan.needsConversationContext) return plan.retrievalQuery;

  const followUpSubject = plan.retrievalQuery
    .replace(/\b(can|could|would|will|you|please|explain|expand|elaborate|tell|me|more|further|that|this|it|and|but|what|about|why|how|peux|pourrais|pourriez|tu|vous|expliquer|explique|approfondir|approfondis|développe|dis|m['’]en|plus|ça|cela|ceci|et|mais|quoi|pourquoi|comment)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (let index = history.length - 2; index >= 0; index--) {
    const message = history[index];
    if (message?.role === 'user' && message.content.trim()) {
      return followUpSubject
        ? `${message.content.trim()}\nFollow-up topic: ${followUpSubject}`
        : message.content.trim();
    }
  }
  return plan.retrievalQuery;
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
  const retrievalQuery = retrievalQueryForTurn(input.history, plan);

  const [pedagogy, retrieval, memory] = await Promise.all([
    measured(() => services.recordPedagogicalSignal(input.userMessage)),
    measured(() => retrievalQuery
      ? services.retrieveKnowledge(retrievalQuery)
      : Promise.resolve({ ragContext: null, localContext: null, learnContext: null, diagnostics: [] })),
    measured(() => plan.explicitMemoryCandidates.length > 0
      ? services.rememberMemoryCandidates(plan.explicitMemoryCandidates)
      : services.getMemory()),
  ]);

  // The pedagogical context is keyed on concepts inferred from the message.
  // A follow-up like "so how do I actually do it?" carries no keywords, and a
  // profile that only speaks when the current sentence names a topic goes
  // silent exactly when continuity matters. When the message infers nothing,
  // fall back to the concepts of the recent user turns; the definition-question
  // heuristic still reads the real message, never the stitched history.
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
      phaseMs: {
        plan: planMs,
        pedagogy: pedagogy.durationMs,
        retrieval: retrieval.durationMs,
        memory: memory.durationMs,
        total: rounded(now() - started),
      },
    },
  };
}
