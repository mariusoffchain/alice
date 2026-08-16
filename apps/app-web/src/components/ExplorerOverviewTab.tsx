'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { classifySearch } from '@/lib/explorer/search';
import { getNetwork } from '@/lib/explorer/networks';
import { remoteEntitiesConfigured } from '@/lib/explorer/entity-remote';
import type { ChainDataProvider } from '@/lib/explorer/provider';
import { ExplorerWalletCards } from '@/components/ExplorerWalletCards';
import { ArkadeAspInfo, ArkadeLiveSettlements } from '@/components/ExplorerArkade';
import { EXPLORE_ADDRESSES, EXPLORE_BLOCKS, EXPLORE_TXS, type ExploreExample } from '@/lib/explorer/explore-examples';

// Overview / home tab: the universal search (transaction, address, block or
// xpub) with clickable examples, a preview of what the explorer can show, and
// the data-source notice. The section intro lives in ExplorerIntroModal; the
// live block ribbon lives above, in the workspace, on every page.

// Miniature previews of the explorer views, in the visual language of the real
// components (bowtie flow, block treemap, UTXO bubbles, signal rows).
function FlowGlyph() {
  return (
    <svg width={48} height={32} viewBox="0 0 48 32" aria-hidden="true">
      <path d="M11 8 L21 14 M11 24 L21 18" stroke="var(--alice-border)" strokeWidth={1.5} />
      <path d="M27 14 L37 8 M27 18 L37 24" stroke="var(--alice-border)" strokeWidth={1.5} />
      <circle cx={8} cy={8} r={4} fill="var(--alice-muted)" />
      <circle cx={8.5} cy={24} r={2.5} fill="var(--alice-muted)" />
      <rect x={21} y={12} width={6} height={8} fill="var(--alice-primary)" />
      <circle cx={40} cy={8} r={3} fill="var(--alice-primary-dark)" />
      <circle cx={40} cy={24} r={4} fill="var(--alice-primary)" />
    </svg>
  );
}

function BlockMapGlyph() {
  return (
    <svg width={48} height={32} viewBox="0 0 48 32" aria-hidden="true">
      <rect x={4} y={4} width={17} height={24} fill="var(--alice-primary)" opacity={0.9} />
      <rect x={23} y={4} width={12} height={13} fill="var(--alice-muted)" />
      <rect x={37} y={4} width={7} height={13} fill="var(--alice-muted)" opacity={0.55} />
      <rect x={23} y={19} width={9} height={9} fill="var(--alice-primary-dark)" opacity={0.85} />
      <rect x={34} y={19} width={10} height={5} fill="var(--alice-muted)" opacity={0.4} />
      <rect x={34} y={26} width={6} height={2} fill="var(--alice-muted)" opacity={0.3} />
    </svg>
  );
}

function BubblesGlyph() {
  return (
    <svg width={48} height={32} viewBox="0 0 48 32" aria-hidden="true">
      <circle cx={14} cy={17} r={10} fill="var(--alice-primary)" opacity={0.9} />
      <circle cx={30} cy={11} r={6} fill="var(--alice-primary-dark)" opacity={0.8} />
      <circle cx={40} cy={22} r={4.5} fill="var(--alice-muted)" />
      <circle cx={31} cy={25} r={2.5} fill="var(--alice-muted)" opacity={0.6} />
    </svg>
  );
}

function SignalsGlyph() {
  return (
    <svg width={48} height={32} viewBox="0 0 48 32" aria-hidden="true">
      <rect x={5} y={4} width={5} height={5} fill="var(--alice-primary)" />
      <rect x={14} y={6} width={26} height={1.5} fill="var(--alice-border)" />
      <rect x={5} y={13} width={5} height={5} fill="var(--alice-primary-dark)" />
      <rect x={14} y={15} width={19} height={1.5} fill="var(--alice-border)" />
      <rect x={5} y={22} width={5} height={5} fill="var(--alice-muted)" />
      <rect x={14} y={24} width={23} height={1.5} fill="var(--alice-border)" />
    </svg>
  );
}

function FeatureCard({ glyph, title, text }: { glyph: ReactNode; title: string; text: string }) {
  return (
    <div
      className="flex flex-col gap-2 px-4 py-4"
      style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
    >
      <div style={{ height: 32 }}>{glyph}</div>
      <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-text)', marginTop: 4 }}>
        {title}
      </span>
      <p className="font-numbers m-0" style={{ fontSize: 12.5, lineHeight: '18px', color: 'var(--alice-muted)' }}>
        {text}
      </p>
    </div>
  );
}

const KIND_LABEL: Record<'tx' | 'block' | 'address' | 'xpub', string> = {
  tx: 'TX',
  block: 'BLOCK',
  address: 'ADDRESS',
  xpub: 'WALLET',
};

// One clickable chip per curated chain item (see explore-examples.ts).
function ExampleChip({ example, onOpen }: { example: ExploreExample; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
      style={{
        padding: '7px 10px',
        border: '1px solid var(--alice-border)',
        borderRadius: 2,
        backgroundColor: 'var(--alice-bg-soft)',
      }}
      title={example.note}
    >
      <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-text)' }}>
        {example.label}
      </span>
    </button>
  );
}

// A curated group of examples: transactions, blocks, or addresses.
function ExploreGroup({ title, items, onOpen }: {
  title: string;
  items: ExploreExample[];
  onOpen: (kind: 'tx' | 'block' | 'address', value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-pixel tracking-widest" style={{ fontSize: 6, color: 'var(--alice-muted)' }}>{title}</span>
      <div className="flex flex-wrap gap-2">
        {items.map((ex) => (
          <ExampleChip key={ex.value} example={ex} onOpen={() => onOpen(ex.kind, ex.value)} />
        ))}
      </div>
    </div>
  );
}

export function ExplorerOverviewTab({
  activeNetworkId,
  getProvider,
  onOpenTx,
  onOpenBlock,
  onOpenAddress,
  onOpenXpub,
  arkade,
}: {
  activeNetworkId: string;
  getProvider: (networkId: string) => ChainDataProvider;
  onOpenTx: (txid: string) => void;
  onOpenBlock: (heightOrHash: string) => void;
  onOpenAddress: (address: string) => void;
  onOpenXpub: (input: string, label?: string) => void;
  /** Set on the Arkade network: the search also recognises ark1… addresses,
   *  and the curated Bitcoin history gives way to the live settlements feed
   *  and the ASP's parameters. */
  arkade?: { apiBaseUrl: string };
}) {
  const [raw, setRaw] = useState('');
  // Mirrors exactly what triggers the remote entity lookup (see ExplorerPanel's
  // remoteEntities prop), so the disclosure below never claims a request the
  // build does not actually make.
  const showsRemoteEntities = activeNetworkId === 'mainnet' && remoteEntitiesConfigured();
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus without scrolling, so the hero above the field stays in view on load.
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);
  const trimmed = raw.trim();
  const result = classifySearch(trimmed, {
    arkAddresses: !!arkade,
    liquidAddresses: getNetwork(activeNetworkId).kind === 'liquid',
  });
  // A pasted xpub now opens the wallet view; unknown is a plain format error.
  const routable = result.kind === 'tx' || result.kind === 'block' || result.kind === 'address' || result.kind === 'xpub';
  const showError = trimmed.length > 0 && !routable;

  function errorMessage(): string {
    return arkade
      ? 'Not recognised as a transaction id, address (bc1… or ark1…), block or extended key.'
      : 'Not recognised as a transaction id, address, block or extended key.';
  }

  function open(kind: 'tx' | 'block' | 'address' | 'xpub', value: string) {
    if (kind === 'tx') onOpenTx(value);
    else if (kind === 'block') onOpenBlock(value);
    else if (kind === 'xpub') onOpenXpub(value);
    else onOpenAddress(value);
  }

  function submit() {
    if (result.kind === 'unknown') return;
    open(result.kind, result.value);
    setRaw('');
  }

  return (
    <div className="flex flex-col gap-8">
      {/* The universal search, centrepiece of the page. */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={raw}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={arkade ? 'Search a transaction, block, or address (bc1… or ark1…)' : 'Search a transaction, address or block'}
            className="w-full font-numbers outline-none"
            style={{
              height: 46,
              fontSize: 14.5,
              padding: '0 12px',
              paddingRight: routable ? 96 : 12,
              color: 'var(--alice-text)',
              backgroundColor: 'var(--alice-bg)',
              border: `1px solid ${showError ? '#e06060' : routable ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
              borderRadius: 2,
            }}
          />
          {/* Live badge: what the pasted string was recognised as. */}
          {(result.kind === 'tx' || result.kind === 'block' || result.kind === 'address' || result.kind === 'xpub') && (
            <span
              className="font-pixel tracking-widest absolute"
              style={{
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 6,
                padding: '4px 6px',
                color: 'var(--alice-primary)',
                border: '1px solid var(--alice-primary)',
                borderRadius: 2,
              }}
            >
              {KIND_LABEL[result.kind]}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3" style={{ minHeight: 20 }}>
          <span
            className="font-numbers"
            style={{ fontSize: 12, color: showError ? '#e06060' : 'var(--alice-muted)', opacity: showError ? 1 : 0.6 }}
          >
            {showError
              ? errorMessage()
              : routable
                ? 'Press Enter to open it in a new tab.'
                : 'Paste anything, Explorer recognises the format.'}
          </span>
          <button
            type="button"
            disabled={!routable}
            onClick={submit}
            className="font-pixel tracking-widest cursor-pointer disabled:cursor-not-allowed"
            style={{
              fontSize: 7,
              padding: '10px 18px',
              border: `2px solid ${routable ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
              borderRadius: 2,
              backgroundColor: routable ? 'var(--alice-primary)' : 'transparent',
              color: routable ? 'var(--alice-on-primary)' : 'var(--alice-muted)',
              opacity: routable ? 1 : 0.5,
            }}
          >
            SEARCH
          </button>
        </div>

      </div>

      {/* Saved wallets first, right under the search: balance, trend and last
          movement per saved xpub / descriptor / address. */}
      <ExplorerWalletCards
        activeNetworkId={activeNetworkId}
        getProvider={getProvider}
        onOpenXpub={onOpenXpub}
        onOpenAddress={onOpenAddress}
      />

      {arkade ? (
        // Arkade's own live layer: the settlements feed (each round opening its
        // on-chain transaction) and the service provider's parameters.
        <>
          <ArkadeLiveSettlements apiBaseUrl={arkade.apiBaseUrl} onOpenTx={onOpenTx} />
          <ArkadeAspInfo apiBaseUrl={arkade.apiBaseUrl} />
        </>
      ) : (
        // Curated history: famous transactions, milestone blocks and notorious
        // addresses, so the first dive needs zero knowledge. Hover for the story.
        <div className="flex flex-col gap-4">
          <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
            EXPLORE BITCOIN HISTORY
          </span>
          <ExploreGroup title="FAMOUS TRANSACTIONS" items={EXPLORE_TXS} onOpen={open} />
          <ExploreGroup title="MILESTONE BLOCKS" items={EXPLORE_BLOCKS} onOpen={open} />
          <ExploreGroup title="NOTORIOUS ADDRESSES" items={EXPLORE_ADDRESSES} onOpen={open} />
        </div>
      )}

      {/* What is down the hole: one card per explorer view. */}
      <div className="flex flex-col gap-3">
        <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
          WHAT YOU CAN EXPLORE
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FeatureCard
            glyph={<FlowGlyph />}
            title="TRANSACTION FLOW"
            text="Follow the coins through a transaction with a visual flow of its inputs and outputs."
          />
          <FeatureCard
            glyph={<BlockMapGlyph />}
            title="BLOCK MAP"
            text="See a whole block as a map, every transaction sized by the fees it pays."
          />
          <FeatureCard
            glyph={<BubblesGlyph />}
            title="ADDRESS INSIGHTS"
            text="Balance history and live UTXOs for any address, drawn as bubbles you can compare at a glance."
          />
          <FeatureCard
            glyph={<SignalsGlyph />}
            title="PRIVACY SIGNALS"
            text="Deterministic heuristics flag what a transaction exposes: reused addresses, round amounts, traceable change."
          />
        </div>
      </div>

      {/* Where the data comes from, and what that means for privacy. */}
      <div
        className="flex flex-col gap-1 px-4 py-3"
        style={{
          border: '1px solid var(--alice-border)',
          borderLeft: '3px solid var(--alice-primary)',
          borderRadius: 2,
          backgroundColor: 'var(--alice-bg-soft)',
        }}
      >
        <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
          DATA SOURCE
        </span>
        <p className="font-numbers m-0" style={{ fontSize: 12.5, lineHeight: '18px', color: 'var(--alice-muted)' }}>
          {arkade
            ? 'Arkade settles on Bitcoin mainnet, so on-chain data comes from the same source as the Bitcoin view (mempool.space); off-chain VTXO data comes from the public Arkade gateway. Both servers can see which item is looked up and the network address it is requested from.'
            : 'Blockchain data is fetched from mempool.space. That server can see which transaction is looked up and the network address it is requested from. Connecting a personal node is planned for a later version.'}
        </p>
        {/* The entity lookup is a second server, so it gets its own sentence: the
            bundled dataset alone never leaves the device, but the giant packs are
            queried on demand and that request carries the address being viewed. */}
        {showsRemoteEntities ? (
          <p className="font-numbers m-0" style={{ fontSize: 12.5, lineHeight: '18px', color: 'var(--alice-muted)' }}>
            Naming a known address (an exchange, a sanctioned entity) uses a dataset bundled in the app, plus a
            lookup on Alice&rsquo;s own server for the large sets the app cannot ship. That lookup sends the address
            you are viewing, and nothing else. It is never sent to a third party, and no request body is logged.
          </p>
        ) : null}
      </div>
    </div>
  );
}
