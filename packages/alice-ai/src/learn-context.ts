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

export type LearnContextOptions = { targetLanguage?: 'fr' | 'en' };

export type LearnContextProvider = (query: string, options?: LearnContextOptions) => Promise<LearnTurnContext | null>;

const PROVIDER_TIMEOUT_MS = 1_500;
const MAX_EXCERPT_CHARS = 2_000;

let provider: LearnContextProvider | null = null;

export function registerLearnContextProvider(next: LearnContextProvider): void {
  provider = next;
}

export async function learnContextFor(query: string, options?: LearnContextOptions): Promise<LearnTurnContext | null> {
  if (!provider) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider(query, options),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), PROVIDER_TIMEOUT_MS); }),
    ]);
    if (!result) return null;
    // Keep a complete prefix. A character cut can remove a safety qualifier at
    // the end of the same paragraph. Scan only the bounded head of a pack.
    const head = result.excerpt.slice(0, MAX_EXCERPT_CHARS + 2);
    const boundary = head.lastIndexOf('\n\n');
    const excerpt = (result.excerpt.length <= MAX_EXCERPT_CHARS
      ? result.excerpt
      : boundary >= 0 ? head.slice(0, boundary) : '').trim();
    if (!excerpt) return null;
    return {
      label: result.label,
      excerpt,
    };
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
