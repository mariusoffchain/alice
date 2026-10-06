'use client';

import { useCallback, useEffect, useState } from 'react';
import { SvgIcon } from '@/components/SvgIcon';
import { CHEVRON_LEFT_ICON, DELETE_ICON } from '@/lib/atelier-icons';
import {
  ALICE_MEMORY_CATEGORIES,
  ALICE_MEMORY_CATEGORY_LABELS,
  ALICE_MEMORY_RECENT_LIMIT,
  ALICE_MEMORY_WARNING,
  KNOWLEDGE_CONCEPT_LABELS,
  MAX_TEXT_LENGTH,
  aliceMemoryRefusalMessage,
  clearAliceMemory,
  clearAliceMemoryCategory,
  clearPedagogicalProfile,
  editAliceMemoryItem,
  familiarityFor,
  forgetAliceMemoryItem,
  forgetPedagogicalConcept,
  getAliceMemory,
  getPedagogicalProfile,
  isAliceMemoryCategoryPaused,
  setAliceMemoryCategoryPaused,
  setAliceMemoryEnabled,
  type AliceMemory,
  type AliceMemoryCategory,
  type AliceMemoryItem,
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
//
// Since 2026-10-06 the facts are laid out as one field per category, every
// field shown even when empty. Each fact can be edited in place (the new text
// goes through the capture filters, and a refusal says why) or deleted; each
// field can be cleared or paused. Past the fifty most recent facts, the older
// ones fold into a section of their own, still editable and deletable.

const CATEGORY_LABELS = ALICE_MEMORY_CATEGORY_LABELS.en;

const sectionStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--alice-border)',
  marginTop: 12,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  minHeight: 72,
  padding: '16px 0',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
};

function familiarityLabel(state: FamiliarityState, declared: boolean): string {
  if (declared) return `DECLARED ${state.toUpperCase()}`;
  if (state === 'introduced') return 'DISCUSSED';
  return state.toUpperCase();
}

function MemoryFactRow({
  item,
  showCategory,
  divided,
  onChange,
}: {
  item: AliceMemoryItem;
  showCategory?: boolean;
  divided: boolean;
  onChange: (memory: AliceMemory) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [refusal, setRefusal] = useState<string | null>(null);

  const startEditing = () => {
    setDraft(item.text);
    setRefusal(null);
    setEditing(true);
  };

  const save = () => {
    void editAliceMemoryItem(item.id, draft).then(result => {
      if (result.refusal) {
        setRefusal(aliceMemoryRefusalMessage(result.refusal, 'en'));
        return;
      }
      setRefusal(null);
      setEditing(false);
      onChange(result.memory);
    });
  };

  return (
    <div style={{ ...rowStyle, alignItems: editing ? 'flex-start' : 'center', borderTop: divided ? '1px solid var(--alice-border)' : undefined }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {showCategory && (
          <div className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>{CATEGORY_LABELS[item.category].toUpperCase()}</div>
        )}
        {editing ? (
          <div style={{ marginTop: showCategory ? 8 : 0 }}>
            <label className="alice-field-label" htmlFor={`memory-edit-${item.id}`}>Edit this fact</label>
            <input
              id={`memory-edit-${item.id}`}
              className="alice-field font-numbers"
              style={{ width: '100%' }}
              value={draft}
              maxLength={MAX_TEXT_LENGTH}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); save(); }
                if (event.key === 'Escape') { event.preventDefault(); setEditing(false); }
              }}
              aria-invalid={refusal ? true : undefined}
              aria-describedby={refusal ? `memory-edit-${item.id}-refusal` : undefined}
            />
            {refusal && (
              <p id={`memory-edit-${item.id}-refusal`} role="alert" style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '22px', color: 'var(--alice-danger)' }}>{refusal}</p>
            )}
            <div style={{ ...actionsStyle, marginTop: 8 }}>
              <button type="button" className="alice-control alice-control--primary font-numbers" onClick={save}>Save</button>
              <button type="button" className="alice-control alice-control--quiet font-numbers" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: showCategory ? 8 : 0, fontSize: 17, overflowWrap: 'anywhere' }}>{item.text}</div>
        )}
      </div>
      {!editing && (
        <div style={actionsStyle}>
          <button type="button" className="alice-control alice-control--quiet font-numbers" onClick={startEditing} aria-label={`Edit: ${item.text}`}>Edit</button>
          <button type="button" className="alice-control alice-control--danger font-numbers" onClick={() => void forgetAliceMemoryItem(item.id).then(onChange)} aria-label={`Delete: ${item.text}`}>
            <SvgIcon svg={DELETE_ICON} size={16} color="currentColor" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// A confirmation step rendered in place, in the style of the inline edit:
// one sentence, then the action and Cancel. No browser dialog.
function InlineConfirm({
  id,
  message,
  action,
  onConfirm,
  onCancel,
}: {
  id: string;
  message: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="group" aria-labelledby={id} style={{ padding: '12px 0' }}>
      <p id={id} style={{ margin: 0, fontSize: 14, lineHeight: '22px' }}>{message}</p>
      <div style={{ ...actionsStyle, marginTop: 8 }}>
        <button type="button" className="alice-control alice-control--danger font-numbers" onClick={onConfirm}>
          <SvgIcon svg={DELETE_ICON} size={16} color="currentColor" /> {action}
        </button>
        <button type="button" className="alice-control alice-control--quiet font-numbers" onClick={onCancel} autoFocus>Cancel</button>
      </div>
    </div>
  );
}

function MemoryCategoryField({
  category,
  items,
  totalCount,
  paused,
  onChange,
}: {
  category: AliceMemoryCategory;
  items: AliceMemoryItem[];
  /** Every fact in the category, the older ones folded below included. */
  totalCount: number;
  paused: boolean;
  onChange: (memory: AliceMemory) => void;
}) {
  const label = CATEGORY_LABELS[category];
  const [confirming, setConfirming] = useState(false);
  const clearHere = () => {
    setConfirming(false);
    void clearAliceMemoryCategory(category).then(onChange);
  };

  return (
    <section style={sectionStyle} aria-labelledby={`memory-field-${category}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h4 id={`memory-field-${category}`} className="font-pixel" style={{ fontSize: 10, margin: 0 }}>
          {label.toUpperCase()}{items.length > 0 ? ` (${items.length})` : ''}
        </h4>
        <div style={actionsStyle}>
          <button
            type="button"
            className="alice-control alice-control--quiet font-numbers"
            aria-pressed={paused}
            aria-label={paused ? `Resume capture for ${label}` : `Pause capture for ${label}`}
            onClick={() => void setAliceMemoryCategoryPaused(category, !paused).then(onChange)}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          {totalCount > 0 && !confirming && (
            <button type="button" className="alice-control alice-control--danger font-numbers" onClick={() => setConfirming(true)} aria-label={`Delete everything under ${label}`}>
              <SvgIcon svg={DELETE_ICON} size={16} color="currentColor" /> Delete all here
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <InlineConfirm
          id={`memory-clear-${category}`}
          message={`Delete everything under ${label}? This removes all ${totalCount} ${totalCount === 1 ? 'fact' : 'facts'} in this field, including older ones not shown here.`}
          action="Delete"
          onConfirm={clearHere}
          onCancel={() => setConfirming(false)}
        />
      )}
      {paused && (
        <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '22px', color: 'var(--alice-muted)' }}>Paused: Alice no longer adds facts here. What is already here stays until you delete it.</p>
      )}
      {items.length === 0 ? (
        <p style={{ padding: '16px 0', margin: 0, color: 'var(--alice-muted)' }}>Nothing here yet.</p>
      ) : items.map((item, index) => (
        <MemoryFactRow key={item.id} item={item} divided={index > 0} onChange={onChange} />
      ))}
    </section>
  );
}

export function AliceMemoryPanel({ onBack }: { onBack?: () => void }) {
  const [memory, setMemory] = useState<AliceMemory | null>(null);
  const [learning, setLearning] = useState<PedagogicalProfile | null>(null);
  const [olderOpen, setOlderOpen] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);

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
    setConfirmErase(false);
    void Promise.all([clearAliceMemory(), clearPedagogicalProfile()]).then(refresh);
  };

  // Items are stored oldest first. The fifty most recent fill the fields;
  // anything older folds into its own section below.
  const items = memory?.items ?? [];
  const recent = items.slice(-ALICE_MEMORY_RECENT_LIMIT);
  const older = items.slice(0, Math.max(0, items.length - ALICE_MEMORY_RECENT_LIMIT));

  return (
    <div className="font-numbers" style={{ color: 'var(--alice-text)' }}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="alice-control alice-control--quiet font-numbers cursor-pointer"
        >
          <SvgIcon svg={CHEVRON_LEFT_ICON} size={16} color="currentColor" /> Back
        </button>
      )}

      <h2 className="font-pixel" style={{ fontSize: 14, lineHeight: '22px', marginTop: onBack ? 16 : 0 }}>WHAT ALICE REMEMBERS</h2>

      <p role="note" style={{ margin: '12px 0 0', fontSize: 14, lineHeight: '22px', color: 'var(--alice-text)' }}>
        {ALICE_MEMORY_WARNING.en}
      </p>

      <section style={{ ...sectionStyle, ...rowStyle }}>
        <div>
          <div className="font-numbers" style={{ fontSize: 13 }}>MEMORY</div>
          <p style={{ margin: '8px 0 0', color: 'var(--alice-muted)', lineHeight: '22px' }}>
            Useful details stay in this browser. When you use Private Cloud, the
            relevant ones travel inside the same end-to-end encrypted envelope as
            your messages, readable only by the attested enclave.
          </p>
        </div>
        <button
          type="button"
          className="alice-control alice-control--choice font-numbers"
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
      {ALICE_MEMORY_CATEGORIES.map(category => (
        <MemoryCategoryField
          key={category}
          category={category}
          items={recent.filter(item => item.category === category)}
          totalCount={items.filter(item => item.category === category).length}
          paused={memory ? isAliceMemoryCategoryPaused(memory, category) : false}
          onChange={setMemory}
        />
      ))}

      {older.length > 0 && (
        <section style={sectionStyle} aria-labelledby="memory-older">
          <button
            type="button"
            id="memory-older"
            className="alice-control alice-control--quiet font-numbers"
            aria-expanded={olderOpen}
            onClick={() => setOlderOpen(open => !open)}
          >
            {olderOpen ? 'Hide' : 'Show'} older facts ({older.length})
          </button>
          {olderOpen && older.map((item, index) => (
            <MemoryFactRow key={item.id} item={item} showCategory divided={index > 0} onChange={setMemory} />
          ))}
        </section>
      )}

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
                <div className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-muted)', marginTop: 8 }}>
                  {familiarityLabel(familiarityFor(progress), Boolean(progress?.declaredFamiliarity))}
                </div>
              </div>
              <button type="button" className="alice-control alice-control--danger font-numbers" onClick={() => void forgetPedagogicalConcept(concept).then(setLearning)}><SvgIcon svg={DELETE_ICON} size={16} color="currentColor" /> Forget</button>
            </div>
          );
        })}
      </section>

      <p style={{ fontSize: 14, lineHeight: '22px', color: 'var(--alice-muted)', marginTop: 28 }}>
        Alice never saves message text, seeds, private keys, addresses, balances, amounts, transactions, exchange accounts, direct identifiers, precise location, or sensitive personal attributes in this memory, even when asked to.
      </p>

      <div className="mt-8 pt-4" style={{ borderTop: '1px solid var(--alice-border)' }}>
        <p className="text-sm" style={{ color: 'var(--alice-muted)' }}>Forget all local memories and learning signals on this device. Your conversations and wallet remain.</p>
        {confirmErase ? (
          <InlineConfirm
            id="memory-forget-everything"
            message="Forget all of Alice's local memories and learning signals on this device? Your conversations and wallet remain."
            action="Forget everything"
            onConfirm={erase}
            onCancel={() => setConfirmErase(false)}
          />
        ) : (
          <button type="button" className="alice-control alice-control--danger font-numbers" onClick={() => setConfirmErase(true)}>Forget everything</button>
        )}
      </div>
    </div>
  );
}
