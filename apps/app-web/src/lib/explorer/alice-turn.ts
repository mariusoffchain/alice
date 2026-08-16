// The send path for an Ask-Alice turn. It reuses Alice's own building blocks:
// RAG retrieval over the registered fiche corpus, the generation-history
// composition, and a backend chosen by the caller. Routing (which backend is
// even allowed) is decided upstream by route(); this module only runs the chosen
// backend, so the local-only guarantee for identifying data is enforced before
// we get here.
//
// Every backend prepends Alice's base system prompt itself, so we do not add it.
// The privacy posture is injected as the turn directive, so mixers and the like
// are explained but never recommended.

import {
  buildRagTurnContext,
  composeGenerationHistory,
  createBackend,
  type AIBackendType,
  type Message,
  type SupportedLanguage,
} from '@alice-wallet/alice-ai';
import { POSTURE_POLICY } from './fiche.ts';

export type AliceTurnResult = {
  text: string;
  citedChunkIds: string[];
  truncated: boolean;
};

export async function runAliceTurn(input: {
  /** The full user message (question plus the rendered de-identified analysis). */
  userMessage: string;
  /** What to retrieve fiches against (the question alone, no analysis block). */
  retrievalQuery: string;
  backendType: AIBackendType;
  targetLanguage: SupportedLanguage;
  onChunk?: (chunk: string) => void;
}): Promise<AliceTurnResult> {
  const rag = await buildRagTurnContext(input.retrievalQuery, undefined, { maxChunks: 6 });
  const history: Message[] = [{ role: 'user', content: input.userMessage }];
  const messages = composeGenerationHistory(
    history,
    rag,
    '',              // no pedagogical context in this slice
    false,           // assistant history not dropped (no prior turns)
    '',              // no personal memory
    '',              // no memory-capture instruction
    POSTURE_POLICY,  // the turn directive: explain, never recommend mixers, cite fiches
    false,
  );

  const backend = createBackend(input.backendType);
  try {
    await backend.init();
    const res = await backend.sendMessage(messages, input.onChunk, {
      responseLanguage: input.targetLanguage,
    });
    return {
      text: res.content,
      citedChunkIds: rag.diagnostics?.map(d => d.id) ?? [],
      truncated: res.truncated === true,
    };
  } finally {
    await backend.dispose().catch(() => {});
  }
}
