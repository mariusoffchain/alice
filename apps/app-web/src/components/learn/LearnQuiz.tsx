'use client';

import { useEffect, useMemo, useState } from 'react';
import { recordPedagogicalSignal } from '@alice-wallet/alice-ai';
import type { LearnCoursePack, LearnQuizQuestion } from '@alice-wallet/alice-content/src/learn-types';
import { buildQuizAsk, requestLearnAsk } from '@/lib/learn/ask';
import type { LearnLang } from '@/lib/learn/language';
import { fetchCoursePack, fetchQuizPack } from '@/lib/learn/packs';
import { questionsForChapters, shuffledChoices } from '@/lib/learn/quiz';
import type { LearnView } from '@/lib/learn/route';

const QUESTIONS_PER_QUIZ = 8;

export function LearnQuiz({
  code,
  partId,
  lang,
  onNavigate,
}: {
  code: string;
  partId: string;
  lang: LearnLang;
  onNavigate: (view: LearnView) => void;
}) {
  const [pack, setPack] = useState<LearnCoursePack | null>(null);
  const [allQuestions, setAllQuestions] = useState<LearnQuizQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCoursePack(lang, code), fetchQuizPack(lang, code)])
      .then(([coursePack, quiz]) => {
        if (cancelled) return;
        setPack(coursePack);
        setAllQuestions(quiz);
      })
      .catch(() => { if (!cancelled) setAllQuestions([]); });
    return () => { cancelled = true; };
  }, [lang, code]);

  const questions = useMemo(() => {
    if (!pack || !allQuestions) return [];
    const part = pack.parts.find((p) => p.partId === partId);
    if (!part) return [];
    return questionsForChapters(
      allQuestions,
      part.chapters.map((c) => c.chapterId),
      QUESTIONS_PER_QUIZ,
    );
  }, [pack, allQuestions, partId]);

  const partTitle = pack?.parts.find((p) => p.partId === partId)?.title ?? '';

  if (allQuestions === null || !pack) {
    return (
      <div style={{ width: 'min(100% - 32px, 680px)', margin: '0 auto', padding: '48px 0' }}>
        <p className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-muted)' }}>LOADING…</p>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div style={{ width: 'min(100% - 32px, 680px)', margin: '0 auto', padding: '48px 0' }}>
        <p className="font-numbers" style={{ color: 'var(--alice-muted)' }}>
          {lang === 'fr' ? 'Pas de quiz pour cette partie.' : 'No quiz for this part.'}
        </p>
        <button
          className="font-pixel cursor-pointer"
          style={{ marginTop: 16, fontSize: 8, padding: '10px 14px', background: 'transparent', color: 'var(--alice-text)', border: '2px solid var(--alice-border)', borderRadius: 2 }}
          onClick={() => onNavigate({ kind: 'course', code })}
        >
          {lang === 'fr' ? '← RETOUR AU COURS' : '← BACK TO COURSE'}
        </button>
      </div>
    );
  }

  const finished = index >= questions.length;
  if (finished) {
    return (
      <div style={{ width: 'min(100% - 32px, 680px)', margin: '0 auto', padding: '48px 0', color: 'var(--alice-text)' }}>
        <h1 className="font-pixel" style={{ fontSize: 14 }}>
          {lang === 'fr' ? 'QUIZ TERMINÉ' : 'QUIZ COMPLETE'}
        </h1>
        <p className="font-numbers" style={{ fontSize: 18, margin: '18px 0 0' }}>
          {score}/{questions.length}
          {score === questions.length ? ' · 🎉' : ''}
        </p>
        <div className="flex gap-3" style={{ marginTop: 24 }}>
          <button
            className="font-pixel cursor-pointer"
            style={{ fontSize: 8, padding: '10px 14px', background: 'transparent', color: 'var(--alice-text)', border: '2px solid var(--alice-border)', borderRadius: 2 }}
            onClick={() => { setIndex(0); setScore(0); setPicked(null); }}
          >
            {lang === 'fr' ? 'REFAIRE' : 'RETRY'}
          </button>
          <button
            className="font-pixel cursor-pointer"
            style={{ fontSize: 8, padding: '10px 14px', background: 'var(--alice-primary)', color: 'var(--alice-on-primary)', border: 0, borderRadius: 2 }}
            onClick={() => onNavigate({ kind: 'course', code })}
          >
            {lang === 'fr' ? 'RETOUR AU COURS' : 'BACK TO COURSE'}
          </button>
        </div>
      </div>
    );
  }

  const question = questions[index];
  const choices = shuffledChoices(question);
  const answered = picked !== null;
  const pickedChoice = choices.find((c) => c.text === picked);

  return (
    <div style={{ width: 'min(100% - 32px, 680px)', margin: '0 auto', padding: '24px 0 72px', color: 'var(--alice-text)' }}>
      <div className="font-pixel flex items-center justify-between" style={{ fontSize: 8, color: 'var(--alice-muted)' }}>
        <span>{code.toUpperCase()} · {partTitle.toUpperCase()}</span>
        <span>{index + 1}/{questions.length}</span>
      </div>

      <h1 className="font-numbers" style={{ fontSize: 19, lineHeight: '29px', margin: '18px 0 20px' }}>
        {question.question}
      </h1>

      <div className="flex flex-col" style={{ gap: 10 }}>
        {choices.map((choice) => {
          const isPicked = picked === choice.text;
          const showState = answered && (choice.correct || isPicked);
          const border = showState
            ? choice.correct
              ? '2px solid #3f9d63'
              : '2px solid #c74f4f'
            : '2px solid var(--alice-border)';
          return (
            <button
              key={choice.text}
              disabled={answered}
              onClick={() => {
                setPicked(choice.text);
                if (choice.correct) {
                  setScore((s) => s + 1);
                } else {
                  // A wrong pick is the densest learning signal there is: feed
                  // the existing pedagogical profile (concepts inferred from
                  // the question text), first brick of the mastery map.
                  void recordPedagogicalSignal(question.question).catch(() => {});
                }
              }}
              className="font-numbers text-left cursor-pointer transition-colors hover:bg-white/5 disabled:cursor-default"
              style={{ background: 'transparent', color: 'var(--alice-text)', border, borderRadius: 2, padding: '12px 14px', fontSize: 15, lineHeight: '23px' }}
            >
              {choice.text}
            </button>
          );
        })}
      </div>

      {answered && (
        <div style={{ marginTop: 20, border: '2px solid var(--alice-border)', borderRadius: 2, background: 'var(--alice-bg-soft)', padding: '14px 16px' }}>
          <div className="font-pixel" style={{ fontSize: 8, color: pickedChoice?.correct ? '#3f9d63' : '#c74f4f' }}>
            {pickedChoice?.correct
              ? lang === 'fr' ? 'BONNE RÉPONSE' : 'CORRECT'
              : lang === 'fr' ? 'MAUVAISE RÉPONSE' : 'INCORRECT'}
          </div>
          {question.explanation && (
            <p className="font-numbers" style={{ margin: '10px 0 0', fontSize: 14, lineHeight: '23px', color: 'var(--alice-muted)' }}>
              {question.explanation}
            </p>
          )}
          <div className="flex gap-3 flex-wrap" style={{ marginTop: 14 }}>
            <button
              className="font-pixel cursor-pointer"
              style={{ fontSize: 8, padding: '10px 14px', background: 'var(--alice-primary)', color: 'var(--alice-on-primary)', border: 0, borderRadius: 2 }}
              onClick={() => { setIndex((i) => i + 1); setPicked(null); }}
            >
              {index + 1 < questions.length
                ? lang === 'fr' ? 'QUESTION SUIVANTE →' : 'NEXT QUESTION →'
                : lang === 'fr' ? 'VOIR LE SCORE →' : 'SEE SCORE →'}
            </button>
            {!pickedChoice?.correct && picked && (
              <button
                className="font-pixel cursor-pointer"
                style={{ fontSize: 8, padding: '10px 14px', background: 'transparent', color: 'var(--alice-primary)', border: '2px solid var(--alice-primary)', borderRadius: 2 }}
                onClick={() =>
                  // Opens the Ask-Alice sidebar with the quiz context attached:
                  // the quiz stays on screen and can be resumed after.
                  requestLearnAsk(buildQuizAsk(lang, code, question.question, picked, question.answer))
                }
              >
                {lang === 'fr' ? 'DEMANDER À ALICE POURQUOI' : 'ASK ALICE WHY'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
