'use client';

import { SvgIcon } from '@/components/SvgIcon';
import { BACK_ICON, NEXT_ICON, CHECK_ICON, CLOSE_ICON, REFRESH_ICON, HELP_ICON } from '@/lib/atelier-icons';

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
        <p className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }} role="status">{lang === 'fr' ? 'Chargement…' : 'Loading…'}</p>
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
          className="alice-control alice-control--quiet"
          style={{ marginTop: 16, padding: '10px 14px' }}
          onClick={() => onNavigate({ kind: 'course', code })}
        >
          <SvgIcon svg={BACK_ICON} size={16} /> {lang === 'fr' ? 'Retour au cours' : 'Back to course'}
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
          {score === questions.length && <span style={{ display: 'inline-flex', marginLeft: 8 }}><SvgIcon svg={CHECK_ICON} size={20} /></span>}
        </p>
        <div className="flex gap-3" style={{ marginTop: 24 }}>
          <button
            className="alice-control alice-control--quiet"
            style={{ padding: '10px 14px' }}
            onClick={() => { setIndex(0); setScore(0); setPicked(null); }}
          >
            <SvgIcon svg={REFRESH_ICON} size={20} /> {lang === 'fr' ? 'Réessayer' : 'Retry'}
          </button>
          <button
            className="alice-control alice-control--primary"
            style={{ padding: '10px 14px' }}
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
      <div className="font-numbers flex items-center justify-between" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
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
              ? '2px solid var(--alice-success)'
              : '2px solid var(--alice-danger)'
            : '1px solid var(--alice-border)';
          return (
            <button
              key={choice.text}
              disabled={answered}
              aria-pressed={isPicked}
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
              className="alice-control alice-control--row disabled:cursor-default"
              style={{ background: 'transparent', color: 'var(--alice-text)', border, borderRadius: 'var(--alice-radius-control)', padding: '12px 14px', fontSize: 15, lineHeight: '23px', opacity: 1 }}
            >
              <span style={{ flex: 1 }}>{choice.text}</span>
              {showState && <span className="flex items-center gap-2" style={{ color: choice.correct ? 'var(--alice-success)' : 'var(--alice-danger)', fontSize: 12 }}>
                <SvgIcon svg={choice.correct ? CHECK_ICON : CLOSE_ICON} size={20} />
                {choice.correct ? (lang === 'fr' ? 'Correcte' : 'Correct') : (lang === 'fr' ? 'Votre réponse' : 'Your answer')}
              </span>}
            </button>
          );
        })}
      </div>

      {answered && (
        <div role="status" style={{ marginTop: 20, border: '1px solid var(--alice-border)', borderRadius: 'var(--alice-radius-control)', background: 'var(--alice-bg-soft)', padding: '14px 16px' }}>
          <div className="font-numbers" style={{ fontSize: 12, color: pickedChoice?.correct ? 'var(--alice-success)' : 'var(--alice-danger)' }}>
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
              className="alice-control alice-control--primary"
              style={{ padding: '10px 14px' }}
              onClick={() => { setIndex((i) => i + 1); setPicked(null); }}
            >
              {index + 1 < questions.length
                ? lang === 'fr' ? 'Question suivante' : 'Next question'
                : lang === 'fr' ? 'Voir le score' : 'See score'} <SvgIcon svg={NEXT_ICON} size={16} />
            </button>
            {!pickedChoice?.correct && picked && (
              <button
                className="alice-control alice-control--quiet"
                style={{ padding: '10px 14px' }}
                onClick={() =>
                  // Opens the Ask-Alice sidebar with the quiz context attached:
                  // the quiz stays on screen and can be resumed after.
                  requestLearnAsk(buildQuizAsk(lang, code, question.question, picked, question.answer))
                }
              >
                <SvgIcon svg={HELP_ICON} size={20} /> {lang === 'fr' ? 'Demander à Alice pourquoi' : 'Ask Alice why'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
