'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isTauriDesktop, registerPack, useChat } from '@alice-wallet/alice-ai';
import { buildExplorerKnowledgePack } from '@/lib/explorer/fiche-corpus';
import { Sidebar, SIDEBAR_ICON_SVG } from '@/components/Sidebar';
import { SvgIcon } from '@/components/SvgIcon';
import { ExplorerTabBar } from '@/components/ExplorerTabBar';
import { ExplorerOverviewTab } from '@/components/ExplorerOverviewTab';
import { ExplorerTxTab } from '@/components/ExplorerTxTab';
import { ExplorerBlockTab } from '@/components/ExplorerBlockTab';
import { ExplorerAddressTab } from '@/components/ExplorerAddressTab';
import { ExplorerXpubTab } from '@/components/ExplorerXpubTab';
import { ARKADE_ACCENT_SOFT, ExplorerArkadeAddressTab } from '@/components/ExplorerArkade';
import { ExplorerBlocks } from '@/components/ExplorerBlocks';
import { ExplorerIntroModal, wasIntroDismissed } from '@/components/ExplorerIntroModal';
import { ExplorerAskAlice } from '@/components/ExplorerAskAlice';
import { ExplorerAskFab } from '@/components/ExplorerAskFab';
import { MempoolProvider } from '@/lib/explorer/mempool';
import { CachingProvider } from '@/lib/explorer/caching-provider';
import { FailoverProvider } from '@/lib/explorer/failover-provider';
import { createIdbCache } from '@/lib/explorer/idb-cache';
import type { ChainDataProvider } from '@/lib/explorer/provider';
import { effectiveBaseUrl, isUsingCustomNode } from '@/lib/explorer/node-config';
import type { PrivacySignal } from '@/lib/explorer/signals';
import type { FullContext } from '@/lib/explorer/ask-alice';
import { addTab, closeTab, makeTab, overviewTab, type Tab } from '@/lib/explorer/tabs';
import { loadTabs, saveTabs } from '@/lib/explorer/tab-storage';
import { getSessionTabs, saveSessionTabs } from '@/lib/explorer/session-links';
import { DEFAULT_NETWORK_ID, getNetwork } from '@/lib/explorer/networks';
import { looksLikeArkadeAddress } from '@/lib/explorer/arkade';
import { settlementRegistry } from '@/lib/explorer/arkade-onchain';
import { useArkadeSettlements } from '@/lib/explorer/use-arkade-settlements';
import type { RibbonFocus } from '@/lib/explorer/types';

const ASK_OPEN_KEY = 'alice.explorer.ask-open';
const ASK_WIDTH_KEY = 'alice.explorer.ask-width';
const ASK_WIDTH_MIN = 320;
const ASK_WIDTH_MAX = 680;

// Register the Explorer fiche corpus into Alice's RAG once, so any Ask-Alice
// turn can retrieve and cite it. Idempotent across remounts.
let fichePackRegistered = false;
function ensureFichePack() {
  if (fichePackRegistered) return;
  fichePackRegistered = true;
  registerPack(buildExplorerKnowledgePack());
}

function ExplorerWorkspace() {
  // Start from the default so the server and the first client render match; the
  // saved tabs are pulled in on mount, after hydration.
  const [tabs, setTabs] = useState<Tab[]>(() => [overviewTab(DEFAULT_NETWORK_ID)]);
  const [activeId, setActiveId] = useState<string>('');
  const hydrated = useRef(false);
  // The ribbon focus a transaction tab resolves once loaded (its block, or the
  // projected block while unconfirmed), kept per tab so switching tabs restores
  // the right spotlight without a refetch.
  const [focusByTab, setFocusByTab] = useState<Record<string, RibbonFocus | null>>({});
  // The welcome dialog shows on every mount of the section until the user asks
  // not to see it again; decided after hydration since it reads localStorage.
  const [showIntro, setShowIntro] = useState(false);
  // The Ask-Alice sidebar is persistent: docked on the right, it survives tab
  // and page changes; whether it is open survives leaving the section too.
  const [askOpen, setAskOpen] = useState(false);
  const [askWidth, setAskWidth] = useState(420);
  // Privacy signals published by each tab once analysed, so the sidebar always
  // proposes the ACTIVE page's de-identified context as attachments.
  const [signalsByTab, setSignalsByTab] = useState<Record<string, PrivacySignal[]>>({});
  // The identified-mode full description each tab publishes alongside them.
  const [fullByTab, setFullByTab] = useState<Record<string, FullContext | null>>({});

  // Session-to-tabs linkage. A conversation touched from the Ask-Alice sidebar
  // records the tabs open alongside it; opening such a session from history
  // restores them. recording: the active session belongs to this exploration,
  // keep its snapshot fresh. pendingRecord: a message went out before the
  // provider created the session; adopt the id as soon as it appears.
  const { activeSessionId } = useChat();
  const recordingRef = useRef(false);
  const pendingRecordRef = useRef(false);
  const lastSessionRef = useRef<string | null>(null);

  useEffect(() => {
    ensureFichePack();
    const stored = loadTabs();
    if (stored) { setTabs(stored.tabs); setActiveId(stored.activeId); }
    hydrated.current = true;
    setShowIntro(!wasIntroDismissed());
    try { setAskOpen(window.localStorage.getItem(ASK_OPEN_KEY) === 'true'); } catch { /* default closed */ }
    try {
      const w = parseInt(window.localStorage.getItem(ASK_WIDTH_KEY) ?? '', 10);
      if (Number.isFinite(w)) setAskWidth(Math.min(ASK_WIDTH_MAX, Math.max(ASK_WIDTH_MIN, w)));
    } catch { /* default width */ }
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try { window.localStorage.setItem(ASK_OPEN_KEY, String(askOpen)); } catch { /* best effort */ }
  }, [askOpen]);

  useEffect(() => {
    if (!hydrated.current) return;
    try { window.localStorage.setItem(ASK_WIDTH_KEY, String(askWidth)); } catch { /* best effort */ }
  }, [askWidth]);

  // Drag the sidebar's left edge to resize it (desktop only).
  function startAskResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = askWidth;
    const move = (ev: PointerEvent) => {
      setAskWidth(Math.min(ASK_WIDTH_MAX, Math.max(ASK_WIDTH_MIN, startW + (startX - ev.clientX))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const active = tabs.find(t => t.id === activeId) ?? tabs[0];
  const activeNetworkId = active.networkId;

  // Persist open tabs (and which is active) once hydrated, so leaving and coming
  // back keeps every exploration in place.
  useEffect(() => {
    if (hydrated.current) saveTabs(tabs, active.id);
  }, [tabs, active.id]);

  // React to the active session changing (a send created one, or the user
  // opened one from history). A session linked to tabs restores them and opens
  // the sidebar; an unlinked one just loads in the chat and stops recording.
  useEffect(() => {
    if (activeSessionId === lastSessionRef.current) return;
    const prev = lastSessionRef.current;
    lastSessionRef.current = activeSessionId;
    if (!activeSessionId) { recordingRef.current = false; return; }
    if (pendingRecordRef.current && prev === null) {
      // First save of a conversation started in the sidebar: adopt it.
      pendingRecordRef.current = false;
      recordingRef.current = true;
      saveSessionTabs(activeSessionId, tabs, active.id);
      return;
    }
    pendingRecordRef.current = false;
    const snap = getSessionTabs(activeSessionId);
    if (snap) {
      recordingRef.current = true;
      setTabs(snap.tabs);
      setActiveId(snap.activeId);
      setAskOpen(true);
    } else {
      recordingRef.current = false;
    }
  }, [activeSessionId, tabs, active.id]);

  // While a linked session is active, keep its snapshot in step with the tabs.
  useEffect(() => {
    if (recordingRef.current && activeSessionId) saveSessionTabs(activeSessionId, tabs, active.id);
  }, [activeSessionId, tabs, active.id]);

  // Called by the sidebar on every send: from now on this exploration's tabs
  // belong to the active conversation.
  function recordConversationActivity() {
    if (activeSessionId) {
      recordingRef.current = true;
      saveSessionTabs(activeSessionId, tabs, active.id);
    } else {
      pendingRecordRef.current = true;
    }
  }

  // Arkade IS Bitcoin mainnet plus an off-chain overlay: its on-chain data
  // (ribbon, blocks, transactions, addresses) comes from the very same
  // provider and caches as the Bitcoin network, so the two views can never
  // drift apart; switching networks only adds or removes the Arkade layer.
  function dataNetworkId(id: string): string {
    return getNetwork(id).kind === 'arkade' ? DEFAULT_NETWORK_ID : id;
  }

  // One provider per data network, cached, so switching back and forth is free.
  // Every tab talks to the ChainDataProvider interface, never to a URL. The
  // Mempool provider is wrapped in a CachingProvider that de-duplicates and
  // rate-limits the request burst a single analysis produces. The endpoint
  // comes from the node config, so a user-set node override is honoured.
  const providers = useRef(new Map<string, ChainDataProvider>());
  function providerFor(rawId: string): ChainDataProvider {
    const id = dataNetworkId(rawId);
    let p = providers.current.get(id);
    if (!p) {
      const net = getNetwork(id);
      const primary = new MempoolProvider(effectiveBaseUrl(id), net.label);
      // On the default public endpoint, rate-limiting fails over to public
      // stand-ins (and only then: the happy path never spreads queries). A
      // user-configured node is authoritative: no silent fallback to a third
      // party they did not choose.
      const base = !isUsingCustomNode(id) && net.fallbacks?.length
        ? new FailoverProvider([
            { provider: primary },
            ...net.fallbacks.map(f => ({
              provider: new MempoolProvider(f.baseUrl, f.name),
              esploraOnly: f.esploraOnly,
            })),
          ])
        : primary;
      // Immutable chain data (blocks, confirmed txs) persists across sessions,
      // namespaced by network so chains never mix.
      p = new CachingProvider(base, { persistent: createIdbCache(id) });
      providers.current.set(id, p);
    }
    return p;
  }
  const provider = providerFor(activeNetworkId);

  // A new tab inherits the active tab's network, so exploring from a mainnet tab
  // opens mainnet tabs, and from a testnet tab opens testnet tabs. One nuance:
  // a known settlement opened from the Arkade view is an ON-CHAIN transaction,
  // so it opens as a Bitcoin tab; violet stays for the off-chain subjects.
  function openTx(txid: string) {
    const networkId = getNetwork(activeNetworkId).kind === 'arkade' && settlementRegistry.has(txid)
      ? DEFAULT_NETWORK_ID
      : activeNetworkId;
    const tab = makeTab('tx', txid, networkId);
    setTabs(prev => addTab(prev, tab, activeId));
    setActiveId(tab.id);
  }

  function openBlock(heightOrHash: string) {
    const tab = makeTab('block', heightOrHash, activeNetworkId);
    setTabs(prev => addTab(prev, tab, activeId));
    setActiveId(tab.id);
  }

  function openAddress(address: string) {
    const tab = makeTab('address', address, activeNetworkId);
    setTabs(prev => addTab(prev, tab, activeId));
    setActiveId(tab.id);
  }

  function openXpub(input: string, label?: string) {
    const tab = makeTab('xpub', input, activeNetworkId);
    if (label) tab.label = label;
    setTabs(prev => addTab(prev, tab, activeId));
    setActiveId(tab.id);
  }

  // A subject tab (a block, transaction, address or wallet) is bound to the
  // network it was opened on, exactly like a block or a transaction: its data is
  // meaningless on another chain, and re-scanning a Bitcoin wallet on Liquid
  // would make it look emptied. So only the Home tab's network is switchable in
  // place; picking a network from a subject tab focuses Home on that network
  // instead, leaving the subject tab untouched on its own chain.
  function selectNetwork(id: string) {
    const activeTab = tabs.find(t => t.id === activeId);
    if (activeTab?.kind === 'overview') {
      setTabs(prev => prev.map(t => t.id === activeId ? { ...t, networkId: id } : t));
      return;
    }
    const home = tabs.find(t => t.kind === 'overview');
    if (home) {
      setTabs(prev => prev.map(t => t.id === home.id ? { ...t, networkId: id } : t));
      setActiveId(home.id);
    }
  }

  function handleClose(id: string) {
    // The Home tab is permanent; ignore any attempt to close it.
    if (tabs.find(t => t.id === id)?.kind === 'overview') return;
    setTabs(prev => {
      const { tabs: next, fallbackId } = closeTab(prev, id, DEFAULT_NETWORK_ID);
      if (id === activeId) setActiveId(fallbackId);
      return next;
    });
    setFocusByTab(m => { const n = { ...m }; delete n[id]; return n; });
    setSignalsByTab(m => { const n = { ...m }; delete n[id]; return n; });
    setFullByTab(m => { const n = { ...m }; delete n[id]; return n; });
  }

  // One publisher for every tab kind: signals feed the de-identified
  // attachments, the full description feeds the explicit identified mode.
  function publishTabContext(s: PrivacySignal[], full?: FullContext) {
    setSignalsByTab(m => ({ ...m, [active.id]: s }));
    setFullByTab(m => ({ ...m, [active.id]: full ?? null }));
  }

  // Reorder by drag and drop: the moved tab lands before the drop target, or
  // just after Home when dropped on it. Home itself never moves from the head.
  function reorderTabs(fromId: string, toId: string) {
    setTabs(prev => {
      const from = prev.find(t => t.id === fromId);
      if (!from || from.kind === 'overview' || fromId === toId) return prev;
      const rest = prev.filter(t => t.id !== fromId);
      const idx = rest.findIndex(t => t.id === toId);
      if (idx < 0) return prev;
      const insertAt = rest[idx].kind === 'overview' ? idx + 1 : idx;
      return [...rest.slice(0, insertAt), from, ...rest.slice(insertAt)];
    });
  }

  // A block tab spotlights its own block; a transaction tab spotlights whatever
  // it resolved; addresses and Home spotlight nothing (centre on the divider).
  const focus = useMemo<RibbonFocus | undefined>(() => {
    if (active.kind === 'block' && active.query) return { kind: 'height', height: Number(active.query) };
    if (active.kind === 'tx') return focusByTab[active.id] ?? undefined;
    return undefined;
  }, [active.kind, active.query, active.id, focusByTab]);

  // Arkade settles on Bitcoin mainnet, read through the ASP's Esplora mirror:
  // it reuses the whole Bitcoin explorer, with the blocks and transactions
  // carrying a settlement highlighted in the network's accent.
  const activeNetwork = getNetwork(activeNetworkId);
  const isArkade = activeNetwork.kind === 'arkade';

  // Arkade settles on Bitcoin mainnet, so its settlements are mainnet facts:
  // the Bitcoin view marks them too (block header, pinned row, block map).
  // Only the ribbon highlight and the ark1/virtual searches stay Arkade-only.
  const arkApiUrl = getNetwork('arkade').arkApiUrl;
  function onArkChain(id: string): boolean {
    return getNetwork(id).kind === 'arkade' || id === DEFAULT_NETWORK_ID;
  }

  // The settlements identified on-chain (walked from a known commitment along
  // the ASP's funding chain, and fed by the live stream). The walk runs while
  // the active network sees that chain; the registry persists across sessions.
  const arkSettlements = useArkadeSettlements(onArkChain(activeNetworkId) ? provider : null, arkApiUrl);

  // Settlements land every hour or two, so the chain tip alone rarely shows
  // one: ask the ribbon to keep the window deep enough to cover the last few
  // settlement blocks (the auto-paging is bounded on the ribbon side).
  const arkEnsureHeight = useMemo(() => {
    if (!isArkade) return undefined;
    const sorted = [...arkSettlements.heights].sort((a, b) => b - a);
    return sorted.length > 0 ? sorted[Math.min(2, sorted.length - 1)] : undefined;
  }, [isArkade, arkSettlements.heights]);

  // A transaction tab living on the Arkade network whose txid turns out to be
  // an on-chain settlement is re-homed to the Bitcoin network: the subject IS
  // an on-chain transaction, and the tab colour should say so. This also
  // migrates tabs persisted before the settlement was identified.
  useEffect(() => {
    setTabs(prev => {
      let changed = false;
      const next = prev.map(t => {
        if (t.kind === 'tx' && t.query && getNetwork(t.networkId).kind === 'arkade' && settlementRegistry.has(t.query)) {
          changed = true;
          return { ...t, networkId: DEFAULT_NETWORK_ID };
        }
        return t;
      });
      return changed ? next : prev;
    });
  }, [arkSettlements.byTxid]);

  // Block height -> settlement txid, for the block view's header badge and
  // its pinned commitment row.
  const arkSettlementsByHeight = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of arkSettlements.byTxid.values()) {
      if (s.height !== undefined) m.set(s.height, s.txid);
    }
    return m;
  }, [arkSettlements.byTxid]);

  // Every tab kind renders inside one shared scroll container, so a freshly
  // opened (or switched-to) tab must start at the top, not wherever the
  // previous tab left the scroll.
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollAreaRef.current?.scrollTo({ top: 0 });
  }, [active.id]);

  return (
    <div className="flex flex-row flex-1 min-w-0 min-h-0">
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {showIntro && <ExplorerIntroModal onClose={() => setShowIntro(false)} />}

      {/* The live blockchain ribbon sits at the very top, persistent across
          every view; on a block page it centres on the current block. On Arkade
          it is the SAME Bitcoin mainnet ribbon (same provider, same data,
          keyed by data network so switching does not even remount it) with the
          settlement blocks marked on top. */}
      <div className="shrink-0 pt-3">
        <ExplorerBlocks
          key={dataNetworkId(activeNetworkId)}
          provider={provider}
          onOpenBlock={openBlock}
          focus={focus}
          highlight={isArkade ? {
            heights: arkSettlements.heights,
            color: activeNetwork.color,
            textColor: ARKADE_ACCENT_SOFT,
            ensureHeight: arkEnsureHeight,
          } : undefined}
        />
      </div>

      {/* The tabs sit just below the ribbon. A standalone network button on the
          left switches explorer; the tabs, colour-coded by network, follow. */}
      <ExplorerTabBar
        tabs={tabs}
        activeId={active.id}
        onSelect={setActiveId}
        onClose={handleClose}
        onReorder={reorderTabs}
        activeNetworkId={activeNetworkId}
        onSelectNetwork={selectNetwork}
      />

      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto">
        {active.kind === 'overview' && (
          <div className="max-w-3xl mx-auto flex flex-col gap-6 px-5 pt-6 pb-8">
            <ExplorerOverviewTab
              key={active.id}
              activeNetworkId={activeNetworkId}
              getProvider={providerFor}
              onOpenTx={openTx}
              onOpenBlock={openBlock}
              onOpenAddress={openAddress}
              onOpenXpub={openXpub}
              arkade={isArkade && activeNetwork.arkApiUrl ? { apiBaseUrl: activeNetwork.arkApiUrl } : undefined}
            />
          </div>
        )}
        {active.kind === 'tx' && active.query && (
          <div className="max-w-3xl mx-auto flex flex-col gap-6 px-5 pt-6 pb-8">
            <ExplorerTxTab
              txid={active.query}
              provider={provider}
              onOpenTx={openTx}
              onOpenAddress={openAddress}
              onFocus={(f) => setFocusByTab(m => ({ ...m, [active.id]: f }))}
              onSignals={publishTabContext}
              arkadeApiUrl={onArkChain(active.networkId) ? arkApiUrl : undefined}
              arkadeProbeKnownOnly={getNetwork(active.networkId).kind !== 'arkade'}
            />
          </div>
        )}
        {active.kind === 'block' && active.query && (
          <div className="max-w-5xl mx-auto flex flex-col gap-6 px-5 pt-6 pb-8">
            <ExplorerBlockTab
              height={active.query}
              provider={provider}
              onOpenTx={openTx}
              onSignals={publishTabContext}
              settlementTxids={onArkChain(active.networkId) ? new Set(arkSettlements.byTxid.keys()) : undefined}
              settlementsByHeight={onArkChain(active.networkId) ? arkSettlementsByHeight : undefined}
            />
          </div>
        )}
        {active.kind === 'address' && active.query && (
          <div className="max-w-3xl mx-auto flex flex-col gap-6 px-5 pt-6 pb-8">
            {/* An ark1… address is an off-chain (VTXO) subject: it opens the
                Arkade address view; any on-chain address gets the regular tab. */}
            {looksLikeArkadeAddress(active.query) && getNetwork(active.networkId).arkApiUrl ? (
              <ExplorerArkadeAddressTab
                apiBaseUrl={getNetwork(active.networkId).arkApiUrl!}
                address={active.query}
                onOpenTx={openTx}
              />
            ) : (
              <ExplorerAddressTab
                address={active.query}
                provider={provider}
                onOpenTx={openTx}
                onOpenAddress={openAddress}
                onSignals={publishTabContext}
                confidentialAmounts={getNetwork(active.networkId).kind === 'liquid'}
                remoteEntities={active.networkId === 'mainnet'}
              />
            )}
          </div>
        )}
        {active.kind === 'xpub' && active.query && (
          <div className="max-w-3xl mx-auto flex flex-col gap-6 px-5 pt-6 pb-8">
            <ExplorerXpubTab
              key={active.id}
              input={active.query}
              networkId={active.networkId}
              provider={provider}
              onOpenAddress={openAddress}
              onOpenTx={openTx}
              onSignals={publishTabContext}
            />
          </div>
        )}
      </div>
      </div>

      {/* Optional Alice companion, docked on the right like the left sidebar
          and persistent across tabs and pages; an overlay below md. The bubble
          reopens it when closed. */}
      {askOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setAskOpen(false)}
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
          />
          <div
            className="fixed inset-y-0 right-0 z-50 flex md:relative md:z-auto md:shrink-0 w-[min(420px,100vw)] md:w-[var(--ask-w,420px)]"
            style={{ ['--ask-w' as string]: `${askWidth}px`, borderLeft: '1px solid var(--alice-border)' } as React.CSSProperties}
          >
            <div
              onPointerDown={startAskResize}
              className="hidden md:block absolute left-0 inset-y-0 z-10"
              style={{ width: 5, cursor: 'col-resize' }}
              aria-hidden="true"
            />
            <ExplorerAskAlice
              signals={signalsByTab[active.id] ?? []}
              fullContext={fullByTab[active.id] ?? null}
              contextId={active.id}
              contextLabel={
                // A short, human-readable name for the attachment. Displayed
                // locally only, never part of what is sent: a txid or address
                // keeps its last five characters, enough for a human to
                // recognise it; a block height is harmless in full (thousands
                // of transactions share it).
                active.kind === 'tx' && active.query ? `Transaction ...${active.query.slice(-5)}`
                  : active.kind === 'address' && active.query ? `Address ...${active.query.slice(-5)}`
                    : active.kind === 'block' && active.query ? `Block ${active.query}`
                      : 'This page'
              }
              onActivity={recordConversationActivity}
              onClose={() => setAskOpen(false)}
            />
          </div>
        </>
      ) : (
        <ExplorerAskFab onOpen={() => setAskOpen(true)} />
      )}
    </div>
  );
}

export function ExplorerPanel() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: 'var(--alice-bg)' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
        mobileOpen={sidebarMobileOpen}
        onMobileClose={() => setSidebarMobileOpen(false)}
      />

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {isTauriDesktop() && (
          <div data-tauri-drag-region className="shrink-0" style={{ height: 28 }} />
        )}
        <div
          className="grid shrink-0 grid-cols-[108px_minmax(0,1fr)_108px] items-center px-3 md:hidden"
          style={{
            height: 'calc(52px + env(safe-area-inset-top))',
            paddingTop: 'env(safe-area-inset-top)',
          }}
        >
          <div className="flex items-center">
            <button
              onClick={() => setSidebarMobileOpen(true)}
              className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Open menu"
            >
              <SvgIcon svg={SIDEBAR_ICON_SVG} size={18} color="var(--alice-text)" />
            </button>
          </div>
          <div className="flex min-w-0 items-center justify-center">
            <span className="font-pixel" style={{ fontSize: 11, color: 'var(--alice-text)' }}>
              Explorer
            </span>
          </div>
          <div />
        </div>

        <ExplorerWorkspace />
      </div>
    </div>
  );
}
