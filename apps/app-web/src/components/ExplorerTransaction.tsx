'use client';

import { ExplorerTxGraph } from '@/components/ExplorerTxGraph';
import { Amount } from '@/components/AmountDisplay';
import { formatDateTime } from '@/lib/explorer/blocks';
import type {
  NormalizedInput,
  NormalizedOutput,
  NormalizedOutspend,
  NormalizedTransaction,
} from '@/lib/explorer/types';

// Fees deliberately stay in sats whatever the user's display unit: sat and
// sat/vB are the native language of fee talk.
function formatSats(sats: number): string {
  return `${sats.toLocaleString('en-US')} sats`;
}

function shortAddr(addr: string): string {
  return addr.length > 20 ? `${addr.slice(0, 10)}...${addr.slice(-6)}` : addr;
}

function Chip({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'warn' | 'ok' }) {
  const color = tone === 'warn' ? '#e0a060' : tone === 'ok' ? 'var(--alice-primary)' : 'var(--alice-muted)';
  return (
    <span
      className="font-pixel tracking-widest"
      style={{
        fontSize: 7,
        padding: '4px 7px',
        border: `1px solid ${color}`,
        borderRadius: 2,
        color,
      }}
    >
      {label}
    </span>
  );
}

function IoRow({ io, onOpenAddress }: { io: NormalizedInput | NormalizedOutput; onOpenAddress?: (a: string) => void }) {
  const isInput = 'prevTxid' in io;
  const coinbase = isInput && (io as NormalizedInput).isCoinbase;
  const addr = io.address;
  const rawValue = isInput ? (io as NormalizedInput).valueSats : (io as NormalizedOutput).valueSats;
  // A Liquid confidential in/output has a real amount we cannot read (an output
  // even carries a placeholder 0): show "unknown", never a bogus number.
  const value = io.amountKnown === false ? undefined : rawValue;
  const clickable = !!addr && !!onOpenAddress;

  // Primary label priority: coinbase, then a real address, then the script type
  // for address-less scripts (P2PK, bare multisig, OP_RETURN), then a last
  // resort. Only show the type as a subtitle when an address is on the line, so
  // it never reads "Unknown script / P2PK" for a script we actually recognised.
  let primary: string;
  if (coinbase) primary = 'Coinbase (newly minted)';
  else if (addr) primary = shortAddr(addr);
  else if (io.scriptType && io.scriptType !== 'unknown') primary = `No address (${io.scriptType.toUpperCase()})`;
  else primary = 'Unknown script';

  return (
    <div
      className="flex items-start justify-between gap-3 px-3 py-2"
      style={{ borderTop: '1px solid var(--alice-border)' }}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        {clickable ? (
          <button
            type="button"
            onClick={() => onOpenAddress?.(addr as string)}
            className="font-numbers truncate text-left cursor-pointer bg-transparent border-none p-0"
            style={{ fontSize: 13, color: 'var(--alice-primary)' }}
            title={`Open address ${addr}`}
          >
            {primary}
          </button>
        ) : (
          <span
            className="font-numbers truncate"
            style={{ fontSize: 13, color: 'var(--alice-text)' }}
            title={coinbase ? 'Coinbase' : addr ?? io.scriptType ?? 'Unknown script'}
          >
            {primary}
          </span>
        )}
        {addr && io.scriptType && (
          <span className="font-pixel tracking-widest" style={{ fontSize: 6, color: 'var(--alice-muted)' }}>
            {io.scriptType.toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end shrink-0">
        {typeof value === 'number' ? (
          <Amount sats={value} style={{ fontSize: 13, color: 'var(--alice-text)' }} />
        ) : (
          <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-text)' }}>unknown</span>
        )}
      </div>
    </div>
  );
}

function IoColumn({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-0" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: 'var(--alice-bg-soft)' }}>
        <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
          {title}
        </span>
        <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

export function ExplorerTransaction({
  tx,
  flaggedAddresses,
  outspends,
  onOpenTx,
  onOpenAddress,
}: {
  tx: NormalizedTransaction;
  flaggedAddresses?: ReadonlySet<string>;
  outspends?: readonly NormalizedOutspend[];
  onOpenTx?: (txid: string) => void;
  onOpenAddress?: (address: string) => void;
}) {
  const status = tx.status.confirmed
    ? `Confirmed - block ${tx.status.blockHeight?.toLocaleString('en-US')}${tx.status.blockTime ? ` - ${formatDateTime(tx.status.blockTime)}` : ''}`
    : 'In mempool - unconfirmed';

  return (
    <div className="flex flex-col gap-4">
      {/* Flow diagram: the visual centrepiece. */}
      <ExplorerTxGraph tx={tx} flaggedAddresses={flaggedAddresses} outspends={outspends} onOpenTx={onOpenTx} onOpenAddress={onOpenAddress} />

      {/* Summary */}
      <div
        className="flex flex-col gap-3 px-4 py-3"
        style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
      >
        <p className="font-numbers m-0 break-all" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
          {tx.txid}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Chip label={tx.status.confirmed ? 'CONFIRMED' : 'UNCONFIRMED'} tone={tx.status.confirmed ? 'ok' : 'warn'} />
          {tx.isCoinbase && <Chip label="COINBASE" />}
          {tx.rbfSignaled && <Chip label="RBF" tone="warn" />}
          <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>{status}</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Metric label="Fee" value={tx.feeSats !== null ? formatSats(tx.feeSats) : 'n/a'} />
          <Metric label="Fee rate" value={tx.feeRateSatVb !== null ? `${tx.feeRateSatVb} sat/vB` : 'n/a'} />
          <Metric label="Size" value={`${tx.vsize} vB`} />
          <Metric label="Inputs" value={String(tx.inputs.length)} />
          <Metric label="Outputs" value={String(tx.outputs.length)} />
        </div>
      </div>

      {/* Inputs and outputs */}
      <div className="flex flex-col md:flex-row gap-3">
        <IoColumn title="INPUTS" count={tx.inputs.length}>
          {tx.inputs.map((input, i) => <IoRow key={`${input.prevTxid}:${input.prevVout}:${i}`} io={input} onOpenAddress={onOpenAddress} />)}
        </IoColumn>
        <IoColumn title="OUTPUTS" count={tx.outputs.length}>
          {tx.outputs.map((output) => <IoRow key={output.index} io={output} onOpenAddress={onOpenAddress} />)}
        </IoColumn>
      </div>

      <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.6 }}>
        Data from {tx.source.name}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-pixel tracking-widest" style={{ fontSize: 6, color: 'var(--alice-muted)' }}>
        {label.toUpperCase()}
      </span>
      <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-text)' }}>
        {value}
      </span>
    </div>
  );
}
