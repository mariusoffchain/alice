// Bridge between the chat turn and the Learn library. The AI core cannot
// depend on the app's Learn plumbing (packs live on the app side, with their
// own language and caching rules), so the app REGISTERS a provider and the
// turn pipeline asks it: "does a course speak to this question, and what does
// it say?". Surfaces without a Learn section simply never register one.
//
// Same posture as semantic search: a relevance nicety, never a gate. The
// provider is bounded in time and size, and every failure reads as "no course
// context", a broken pack can slow nothing and break nothing.

export type LearnTurnContext = {
  /** e.g. "The Bitcoin Journey · Wallets and self-custody (Plan ₿ Academy)" */
  label: string;
  /** Course text, already trimmed to a context-sized excerpt. */
  excerpt: string;
};

export type LearnContextProvider = (query: string) => Promise<LearnTurnContext | null>;

const PROVIDER_TIMEOUT_MS = 1_500;
const MAX_EXCERPT_CHARS = 2_000;

let provider: LearnContextProvider | null = null;

export function registerLearnContextProvider(next: LearnContextProvider): void {
  provider = next;
}

export async function learnContextFor(query: string): Promise<LearnTurnContext | null> {
  if (!provider) return null;
  try {
    const result = await Promise.race([
      provider(query),
      new Promise<null>(resolve => setTimeout(() => resolve(null), PROVIDER_TIMEOUT_MS)),
    ]);
    if (!result || !result.excerpt.trim()) return null;
    return {
      label: result.label,
      excerpt: result.excerpt.length > MAX_EXCERPT_CHARS
        ? `${result.excerpt.slice(0, MAX_EXCERPT_CHARS)}…`
        : result.excerpt,
    };
  } catch {
    return null;
  }
}
