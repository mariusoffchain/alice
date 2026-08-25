// The "I did not get this" hand-off: user selects a passage in a chapter and
// asks Alice about it in the main chat. The passage is quoted in the reading
// language (what is on screen); Alice answers in her own response-language
// setting. No summarize-the-chapter button by design: help triggers on real
// friction only, and Alice explains and points back to the source instead of
// replacing it (CC BY-SA pushes the same way).

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;


// ---------------------------------------------------------------------------
// Ask-panel hand-off: quiz debriefs and selection rescues open the Learn
// Ask-Alice sidebar with their context as the attachment (the reader keeps
// the course or quiz in view), instead of navigating to the full chat page.

export interface LearnAskRequest {
  /** Short chip label ("QUIZ BTC101", chapter title…). */
  label: string;
  /** The exact context prefix that rides along with the question. */
  text: string;
  /** Prefilled composer draft the user can edit before sending. */
  draft: string;
}

export const LEARN_ASK_EVENT = 'alice-learn-ask';
let pendingAsk: LearnAskRequest | null = null;

export function requestLearnAsk(request: LearnAskRequest): void {
  pendingAsk = request;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LEARN_ASK_EVENT));
}

export function consumeLearnAsk(): LearnAskRequest | null {
  const request = pendingAsk;
  pendingAsk = null;
  return request;
}

export function buildSelectionAsk(
  lang: string,
  courseCode: string,
  chapterTitle: string,
  selection: string,
): LearnAskRequest {
  const passage = clip(selection.replace(/\s+/g, ' ').trim(), 600);
  const chapter = clip(chapterTitle, 80);
  return lang === 'fr'
    ? {
        label: `${courseCode.toUpperCase()} · ${chapter}`,
        text: `Contexte : cours ${courseCode.toUpperCase()}, chapitre « ${chapter} » (Plan B Academy). Passage sélectionné : « ${passage} ». `,
        draft: 'Je n’ai pas compris ce passage, explique-le moi simplement.',
      }
    : {
        label: `${courseCode.toUpperCase()} · ${chapter}`,
        text: `Context: course ${courseCode.toUpperCase()}, chapter "${chapter}" (Plan B Academy). Selected passage: "${passage}". `,
        draft: 'I did not understand this passage, explain it to me simply.',
      };
}

export function buildQuizAsk(
  lang: string,
  courseCode: string,
  question: string,
  pickedWrong: string,
  correct: string,
): LearnAskRequest {
  const q = clip(question, 240);
  const wrong = clip(pickedWrong, 160);
  const right = clip(correct, 160);
  return lang === 'fr'
    ? {
        label: `QUIZ ${courseCode.toUpperCase()}`,
        text: `Contexte : quiz du cours ${courseCode.toUpperCase()} (Plan B Academy). Question : « ${q} » Ma réponse (fausse) : « ${wrong} ». Bonne réponse : « ${right} ». `,
        draft: 'Pourquoi ma réponse était-elle tentante mais fausse ?',
      }
    : {
        label: `QUIZ ${courseCode.toUpperCase()}`,
        text: `Context: quiz from course ${courseCode.toUpperCase()} (Plan B Academy). Question: "${q}" My (wrong) answer: "${wrong}". Correct answer: "${right}". `,
        draft: 'Why was my answer tempting but wrong?',
      };
}
