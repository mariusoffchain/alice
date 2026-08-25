'use client';

import { useEffect, useState } from 'react';

type BackendStatusLike = { state?: string } | null | undefined;

interface UseQuestionParamArgs {
  send: (text?: string) => void | Promise<void>;
  setInput: (value: string) => void;
  backendStatus: BackendStatusLike;
  busy: boolean;
  chatReady: boolean;
}

export function useQuestionParam({
  send,
  setInput,
  backendStatus,
  busy,
  chatReady,
}: UseQuestionParamArgs) {
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('q');
    const question = raw?.trim().slice(0, 500) ?? '';
    if (!question) return;

    const shouldAutoSend = params.get('autosend') === '1';
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    url.searchParams.delete('autosend');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);

    setInput(question);
    if (shouldAutoSend) setPending(question);
    // The initial URL is the only hand-off signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pending == null || busy || !chatReady) return;

    if (backendStatus?.state === 'ready') {
      setPending(null);
      void send(pending);
    } else if (backendStatus?.state === 'error') {
      setPending(null);
    }
  }, [pending, backendStatus, busy, chatReady, send]);
}
