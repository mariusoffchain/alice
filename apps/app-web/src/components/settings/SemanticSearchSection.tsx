'use client';

import { useEffect, useState } from 'react';
import {
  SEMANTIC_MODEL_DOWNLOAD_BYTES,
  SEMANTIC_SEARCH_STATE_EVENT,
  type SemanticSearchState,
  disableSemanticSearch,
  downloadSemanticSearchNow,
  formatSize,
  getSemanticSearchState,
} from '@alice-wallet/alice-ai';
import { btnBase, DANGER, SectionHint, SectionLabel, sectionStyle } from './ui';

const SIZE_LABEL = formatSize(SEMANTIC_MODEL_DOWNLOAD_BYTES);

// Inside an installed desktop build the model ships in the app bundle: no
// download happens, so no download may be promised. Same detection as the
// runtime (semantic-runtime.ts).
const isEmbeddedDesktopBuild = () =>
  typeof window !== 'undefined' && window.location.protocol.startsWith('tauri');

// The status line says what is true right now; the hint above it says what the
// feature is. Every state keeps the same honest frame: without the model Alice
// still answers, searching her knowledge by keywords instead of by meaning.
const STATUS_COPY: Record<SemanticSearchState['status'], string> = {
  unsupported: '',
  off: 'Off. Alice searches her knowledge by keywords only.',
  // "Loads", not "downloads": the model may already sit in the browser cache
  // from an earlier session, and this line must be true either way.
  idle: `Loads with your first question: a one-time ${SIZE_LABEL} download, kept on this device.`,
  'blocked-metered': 'Your connection asks to save data, so Alice will not download it by herself.',
  loading: 'Downloading the model. Alice keeps answering with keyword search meanwhile.',
  ready: 'Active. Alice matches questions to her knowledge by meaning, in any language.',
  failed: 'The download failed. Alice fell back to keyword search.',
};

/**
 * State and control for the semantic search model: the one download the app
 * used to start silently. The user sees whether it happened, can start it
 * now, and can remove it (which also stops it from coming back on its own).
 */
export function SemanticSearchSection() {
  const [state, setState] = useState<SemanticSearchState>({ status: 'idle', progress: null });

  useEffect(() => {
    const sync = () => setState(getSemanticSearchState());
    sync();
    window.addEventListener(SEMANTIC_SEARCH_STATE_EVENT, sync);
    return () => window.removeEventListener(SEMANTIC_SEARCH_STATE_EVENT, sync);
  }, []);

  // The Expo PWA has no semantic engine; a section made only of dead buttons
  // would be noise there.
  if (state.status === 'unsupported') return null;

  const embedded = isEmbeddedDesktopBuild();
  const progress = Math.round((state.progress ?? 0) * 100);
  const statusLine = embedded && state.status === 'idle'
    ? 'Included with the desktop app. Loads with your first question, nothing is downloaded.'
    : STATUS_COPY[state.status];

  return (
    <div style={sectionStyle}>
      <SectionLabel>SEMANTIC SEARCH</SectionLabel>
      <SectionHint>
        A small on-device model ({SIZE_LABEL}) that lets Alice find the right
        Bitcoin knowledge by meaning, not just matching words. It never sends
        your questions anywhere.
      </SectionHint>
      <p className="font-numbers m-0" style={{ fontSize: 14, opacity: 0.65, lineHeight: '18px' }}>
        {statusLine}
      </p>
      {state.status === 'loading' && (
        <div className="flex items-center gap-2 mt-2">
          <div style={{ height: 6, flex: 1, border: '1px solid var(--alice-border)' }}>
            <div style={{ height: '100%', width: `${progress}%`, backgroundColor: 'var(--alice-primary)' }} />
          </div>
          <span className="font-pixel" style={{ fontSize: 10, opacity: 0.7 }}>{progress}%</span>
        </div>
      )}
      <div className="flex gap-2 mt-3 flex-wrap">
        {(state.status === 'idle' || state.status === 'blocked-metered' || state.status === 'off' || state.status === 'failed') && (
          <button
            onClick={() => downloadSemanticSearchNow()}
            className="font-pixel tracking-widest"
            style={{ ...btnBase, backgroundColor: 'var(--alice-primary)', color: 'var(--alice-on-primary)' }}
          >
            {state.status === 'failed'
              ? embedded ? 'RETRY' : 'RETRY DOWNLOAD'
              : embedded ? 'LOAD NOW' : `DOWNLOAD ${SIZE_LABEL}`}
          </button>
        )}
        {(state.status === 'ready' || state.status === 'loading') && (
          <button
            onClick={() => void disableSemanticSearch()}
            className="font-pixel tracking-widest"
            style={{ ...btnBase, backgroundColor: 'transparent', color: DANGER, borderColor: DANGER }}
          >
            {state.status === 'loading'
              ? 'CANCEL AND TURN OFF'
              : embedded ? 'TURN OFF' : `REMOVE ${SIZE_LABEL}`}
          </button>
        )}
      </div>
    </div>
  );
}
