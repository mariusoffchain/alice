'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  KNOWLEDGE_CONCEPT_LABELS,
  clearAliceMemory,
  clearPedagogicalProfile,
  familiarityFor,
  forgetAliceMemoryItem,
  forgetPedagogicalConcept,
  getAliceMemory,
  getPedagogicalProfile,
  setAliceMemoryEnabled,
  type AliceMemory,
  type AliceMemoryCategory,
  type FamiliarityState,
  type KnowledgeConcept,
  type PedagogicalProfile,
} from '@alice-wallet/alice-ai';

// The body of "What Alice knows", with no page chrome of its own. It renders
// the same in two frames: inside the settings dialog as a sub-screen of the AI
// tab, and inside the standalone /what-alice-knows route. The move that
// prompted this was the settings entry opening the full page: a settings item
// must stay in the settings frame, so the screen lives here and the route is a
// thin wrapper around it.

const CATEGORY_LABELS: Record<AliceMemoryCategory, string> = {
  preference: 'PREFERENCE',
  goal: 'GOAL',
  project: 'PROJECT',
  interest: 'INTEREST',
  background: 'BACKGROUND',
  constraint: 'CONSTRAINT',
};

const sectionStyle: React.CSSProperties = {
  border: '2px solid var(--alice-border)',
  borderRadius: 2,
  marginTop: 12,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  minHeight: 72,
  padding: 16,
};

function familiarityLabel(state: FamiliarityState, declared: boolean): string {
  if (declared) return `DECLARED ${state.toUpperCase()}`;
  if (state === 'introduced') return 'DISCUSSED';
  return state.toUpperCase();
}

export function AliceMemoryPanel({ onBack }: { onBack?: () => void }) {
  const [memory, setMemory] = useState<AliceMemory | null>(null);
  const [learning, setLearning] = useState<PedagogicalProfile | null>(null);

  const refresh = useCallback(() => {
    void Promise.all([getAliceMemory(), getPedagogicalProfile()])
      .then(([nextMemory, nextLearning]) => {
        setMemory(nextMemory);
        setLearning(nextLearning);
      })
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const activeConcepts = learning
    ? (Object.keys(learning.concepts) as KnowledgeConcept[])
        .filter(concept => familiarityFor(learning.concepts[concept]) !== 'unseen')
    : [];

  const erase = () => {
    if (!window.confirm('Forget all of Alice\'s local memories and learning signals?')) return;
    void Promise.all([clearAliceMemory(), clearPedagogicalProfile()]).then(refresh);
  };

  return (
    <div className="font-numbers" style={{ color: 'var(--alice-text)' }}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="font-pixel cursor-pointer bg-transparent"
          style={{ color: 'var(--alice-muted)', fontSize: 10, border: 'none', padding: 0 }}
        >
          ‹ BACK
        </button>
      )}

      <h2 className="font-pixel" style={{ fontSize: 14, lineHeight: '22px', marginTop: onBack ? 16 : 0 }}>WHAT ALICE REMEMBERS</h2>

      <section style={{ ...sectionStyle, ...rowStyle }}>
        <div>
          <div className="font-pixel" style={{ fontSize: 10 }}>MEMORY</div>
          <p style={{ margin: '8px 0 0', color: 'var(--alice-muted)', lineHeight: '22px' }}>
            Useful details stay in this browser. When you use Private Cloud, the
            relevant ones travel inside the same end-to-end encrypted envelope as
            your messages, readable only by the attested enclave.
          </p>
        </div>
        <button
          type="button"
          className="account-secondary-button"
          aria-pressed={memory?.enabled ?? true}
          onClick={() => {
            const enabled = !(memory?.enabled ?? true);
            setMemory(current => current ? { ...current, enabled } : current);
            void setAliceMemoryEnabled(enabled).then(setMemory);
          }}
        >
          {(memory?.enabled ?? true) ? 'ON' : 'OFF'}
        </button>
      </section>

      <h3 className="font-pixel" style={{ fontSize: 10, marginTop: 36 }}>ABOUT YOU</h3>
      <section style={sectionStyle}>
        {!memory || memory.items.length === 0 ? (
          <p style={{ padding: 16, color: 'var(--alice-muted)' }}>Alice has not saved any useful details about you yet.</p>
        ) : memory.items.map((item, index) => (
          <div key={item.id} style={{ ...rowStyle, borderTop: index > 0 ? '1px solid var(--alice-border)' : undefined }}>
            <div>
              <div className="font-pixel" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>{CATEGORY_LABELS[item.category]}</div>
              <div style={{ marginTop: 8, fontSize: 17 }}>{item.text}</div>
            </div>
            <button type="button" className="account-danger-button" onClick={() => void forgetAliceMemoryItem(item.id).then(setMemory)}>FORGET</button>
          </div>
        ))}
      </section>

      <h3 className="font-pixel" style={{ fontSize: 10, marginTop: 36 }}>LEARNING</h3>
      <section style={sectionStyle}>
        {activeConcepts.length === 0 ? (
          <p style={{ padding: 16, color: 'var(--alice-muted)' }}>No Bitcoin learning signals yet.</p>
        ) : activeConcepts.map((concept, index) => {
          const progress = learning!.concepts[concept];
          return (
            <div key={concept} style={{ ...rowStyle, borderTop: index > 0 ? '1px solid var(--alice-border)' : undefined }}>
              <div>
                <div style={{ fontSize: 17 }}>{KNOWLEDGE_CONCEPT_LABELS[concept]}</div>
                <div className="font-pixel" style={{ fontSize: 10, color: 'var(--alice-muted)', marginTop: 8 }}>
                  {familiarityLabel(familiarityFor(progress), Boolean(progress?.declaredFamiliarity))}
                </div>
              </div>
              <button type="button" className="account-danger-button" onClick={() => void forgetPedagogicalConcept(concept).then(setLearning)}>FORGET</button>
            </div>
          );
        })}
      </section>

      <p style={{ fontSize: 14, lineHeight: '22px', color: 'var(--alice-muted)', marginTop: 28 }}>
        Alice never saves message text, seeds, private keys, addresses, balances, transactions, direct identifiers, precise location, or sensitive personal attributes in this memory.
      </p>

      <button type="button" className="account-danger-button" style={{ marginTop: 32, width: '100%' }} onClick={erase}>FORGET EVERYTHING</button>
    </div>
  );
}
