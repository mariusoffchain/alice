// The greeting is UI chrome, not conversation. It is shown on a fresh chat but
// is never saved into a session and never replayed to the model, including
// sessions saved by earlier versions, which did store it. These pure helpers
// are the single place that rule is enforced, so it can be tested directly
// (chat-context.tsx cannot: it pulls in React and react-native).

export const GREETING = 'Hi! What would you like to learn about today?';
export const GREETING_ID = 'greeting';

export const isGreeting = (m: { id: string }) => m.id === GREETING_ID;

// The greeting bubble shown at the start of a new conversation. Starts empty;
// the animation fills it in. Every path below strips it back out.
export function createGreetingMessage(now: Date = new Date()) {
  return { id: GREETING_ID, role: 'assistant' as const, content: '', time: now };
}

// Remove the greeting before a list is saved or replayed.
export function stripGreeting<T extends { id: string }>(messages: T[]): T[] {
  return messages.filter(m => !isGreeting(m));
}

// A conversation with no real user turn is not a session, and the greeting
// alone never makes one, it is dropped before the check. This is the guard
// that keeps an untouched "New Chat" from becoming a ghost session on disk.
export function isPersistableSession(messages: { id: string; role: string }[]): boolean {
  return stripGreeting(messages).some(m => m.role === 'user');
}

// The model history: greeting removed, only user/assistant turns, reduced to
// role + content.
export function toHistory<T extends { id: string; role: string; content: string }>(
  messages: T[],
): { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter(m => !isGreeting(m) && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}
