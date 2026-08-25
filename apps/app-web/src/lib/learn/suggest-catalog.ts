import {
  LEARN_COURSES,
  LEARN_TUTORIALS,
} from '@alice-wallet/alice-content/src/generated/planb-learn-catalog';
import {
  CHAT_EXPLORER_SUGGESTIONS,
  LEARN_CHAPTER_LINKS,
  type LearnExplorerAnchor,
} from '@alice-wallet/alice-content/src/learn-anchors';
import { matchChatAnchors } from './explorer-suggest';
import { playgroundSuggestionFor } from './playground-suggest';
import type { PlaygroundView } from '../playground-signals';
import { takeSuggestion, type LearnSuggestion } from './suggest';

// App-side binding of the deterministic resource engines (course/tutorial
// scorer + Explorer anchor matcher) to the generated catalog, feeding the
// "Pour aller plus loin" block under Alice's reply.
// Two idempotence layers, both battle-earned:
//  - per-message memo: the same message must always get the SAME answer,
//    not a null from the no-repeat filter;
//  - session-scoped no-repeat: a content suggested once never comes back
//    before an app reload, whatever the conversation.
const suggestedThisSession = new Set<string>();
const anchorsThisSession = new Set<string>();
const byMessage = new Map<string, LearnChatResources>();
// The Playground invitation appears once per session: an invite, not a nag.
let playgroundSuggested = false;

export interface LearnChatResources {
  learn: LearnSuggestion | null;
  /** Chapter tied to a matched anchor (from LEARN_CHAPTER_LINKS), when the
      scorer itself found no course: "read the chapter behind this subject". */
  chapter: { courseCode: string; chapterId: string; title: string } | null;
  anchors: LearnExplorerAnchor[];
  /** Practical question → "try it with training sats", opening this
      Playground view. Once per session. */
  playground: PlaygroundView | null;
}

function chapterForAnchor(anchor: LearnExplorerAnchor, lang: string) {
  const link = LEARN_CHAPTER_LINKS.find((l) =>
    l.anchors?.some((a) => a.type === anchor.type && a.id === anchor.id),
  );
  if (!link) return null;
  const course = LEARN_COURSES.find((c) => c.code === link.courseCode);
  const title = course?.i18n[lang]?.name ?? course?.i18n.en?.name ?? link.courseCode;
  return { courseCode: link.courseCode, chapterId: link.chapterId, title };
}

export function takeChatResources(
  memoKey: string,
  message: string,
  lang: string,
): LearnChatResources {
  const memo = byMessage.get(memoKey);
  if (memo !== undefined) {
    rememberChatResources(memoKey, lang, memo);
    return memo;
  }
  // The Learn language first (its titles win at equal score), then both packed
  // languages: the question's own language is what actually matches.
  const learn = takeSuggestion(message, [lang, 'fr', 'en'], LEARN_COURSES, LEARN_TUTORIALS, suggestedThisSession);
  const anchors = matchChatAnchors(message, CHAT_EXPLORER_SUGGESTIONS).filter((a) => {
    const key = `${a.type}:${a.id}`;
    if (anchorsThisSession.has(key)) return false;
    anchorsThisSession.add(key);
    return true;
  });
  // A matched anchor always has a chapter that tells its story; offer it when
  // the scorer found no course of its own, so the subject gets both the
  // reading and the on-chain proof.
  const chapter = !learn && anchors.length > 0 ? chapterForAnchor(anchors[0], lang) : null;
  const playground = playgroundSuggested ? null : playgroundSuggestionFor(message);
  if (playground) playgroundSuggested = true;
  const resources = { learn, chapter, anchors, playground };
  byMessage.set(memoKey, resources);
  rememberChatResources(memoKey, lang, resources);
  return resources;
}

// The block survives leaving the chat (Explorer round-trip included): the last
// computed resources are kept for the session and re-adopted on mount, gated
// by the question they answered still being the conversation's latest.
let lastResources: { question: string; lang: string; resources: LearnChatResources } | null = null;

function rememberChatResources(question: string, lang: string, resources: LearnChatResources): void {
  lastResources = { question, lang, resources };
}

export function loadChatResources() {
  return lastResources;
}
