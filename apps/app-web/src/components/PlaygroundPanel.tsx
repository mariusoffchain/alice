'use client';

// The /playground page: a Padawan-style practice environment on Mutinynet,
// styled after the mobile wallet's home (big pixel balance with the wallet's ₿
// glyph, corner-bracket buttons, inline history) plus a settings view holding
// the unit switcher, coin control, the address book and wallet deletion.
// Real Bitcoin mechanics, valueless coins, Alice teaching at every step.
// Keys live in localStorage under alice.test-wallet.* (the pre-rename prefix,
// kept so existing practice wallets survive) and never touch the
// real wallet or the AI modules; the "Ask Alice" buttons only prefill the
// chat with a plain-text question. Faucet claims go through Alice's relay,
// which fixes the amount to 1,000 sats and rate limits per IP and per day.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'react-qr-code';
import { PRACTICE_LESSONS, type PracticeLesson } from '@alice-wallet/alice-content';
import { isTauriDesktop, useChat } from '@alice-wallet/alice-ai';
import {
  PRACTICE_DUST_SATS,
  PRACTICE_FAUCET_URL,
  PRACTICE_WORDLIST,
  maxPracticeSendable,
  type PracticeTxPlan,
} from '@alice-wallet/practice-wallet';
import { formatWalletAmount, type BalanceFormat } from '@alice-wallet/alice-ui/balance-format';
import { CORNER_SVG } from '@alice-wallet/alice-ui/components/corner-svg';
import { BITCOIN_ICON_SVG } from '@alice-wallet/alice-ui/components/bitcoin-icon-svg';
import { SETTINGS_SVG } from '@alice-wallet/alice-ui/components/settings-icon-svg';
import { EmptyState, FieldLabel } from '@/components/ExplorerUI';
import { PlaygroundIntroModal, wasPlaygroundIntroDismissed } from '@/components/PlaygroundIntroModal';
import { AskAliceDock } from '@/components/AskAliceDock';
import { AskAliceFab } from '@/components/AskAliceFab';
import { ExplorerQrScanner } from '@/components/ExplorerQrScanner';
import { Sidebar, SIDEBAR_ICON_SVG } from '@/components/Sidebar';
import { SvgIcon } from '@/components/SvgIcon';
import { ExplorerBalanceChart } from '@/components/ExplorerBalanceChart';
import { setAmountFormat, useAmountState, type AmountState } from '@/components/AmountDisplay';
import type { BalancePoint } from '@/lib/explorer/balance-history';
import { openPlaygroundTxInExplorer } from '@/lib/playground-explorer';
import { ASK_WIDTH_DEFAULT, clampAskWidth, loadAskWidth, saveAskWidth } from '@/lib/ask-width';
import { consumePendingPlaygroundView } from '@/lib/playground-open';
import {
  buildPlaygroundFullContext,
  buildPlaygroundSignals,
  playgroundPageName,
} from '@/lib/playground-signals';
import {
  broadcastPlaygroundSend,
  claimPlaygroundFaucet,
  createPlaygroundIfNeeded,
  deletePlayground,
  formatTestSats,
  getPlaygroundMnemonicWords,
  hasClaimedPlaygroundFaucet,
  hasPlayground,
  isPlaygroundBackedUp,
  markPlaygroundBackedUp,
  loadPlaygroundSnapshot,
  planPlaygroundSend,
  readCachedPlaygroundSnapshot,
  playgroundFeeRate,
  rotatePlaygroundReceiveAddress,
  signPlaygroundSend,
  playgroundPaymentUri,
  truncateMiddle,
  type PlaygroundSignedSend,
  type PlaygroundSnapshot,
} from '@/lib/playground';

const BADGE_BG = '#E03131';
const BADGE_TEXT = '#FFFFFF';

// The mobile wallet's own settings cog, same asset as the app's other icons.

// The wallet's pixel-art ₿, painted with the surrounding colour and scaled to
// the surrounding font, exactly like the mobile balance and the Explorer.
const BITCOIN_GLYPH_HTML = BITCOIN_ICON_SVG
  .replaceAll('{{COLOR}}', 'currentColor')
  .replace('<svg ', '<svg style="height:1.05em;width:auto;display:block" ');

// Sats have no market value here, so fiat is not an option: the shared unit
// preference is coerced to the ₿ symbol whenever it says USD.
const TEST_UNITS: BalanceFormat[] = ['symbol', 'sats', 'btc'];

function coerceTestUnit(s: AmountState): AmountState {
  return s.format === 'usd' ? { ...s, format: 'symbol' } : s;
}

function cycleTestUnit(current: AmountState): void {
  const format = coerceTestUnit(current).format;
  const index = TEST_UNITS.indexOf(format);
  setAmountFormat(TEST_UNITS[(index + 1) % TEST_UNITS.length]);
}

function BitcoinGlyph() {
  return (
    <span
      aria-hidden
      style={{ display: 'inline-flex', alignItems: 'center', marginRight: '0.3em' }}
      dangerouslySetInnerHTML={{ __html: BITCOIN_GLYPH_HTML }}
    />
  );
}

/** An amount in the selected unit, with the real pixel ₿ glyph. */
function TestAmount({
  sats,
  state,
  signed = false,
  fontSize,
  color,
}: {
  sats: number;
  state: AmountState;
  signed?: boolean;
  fontSize: number;
  color: string;
}) {
  const s = coerceTestUnit(state);
  const body = formatWalletAmount(Math.abs(sats), s.format, s.price);
  return (
    <span className="font-pixel" style={{ display: 'inline-flex', alignItems: 'center', fontSize, color }}>
      {signed && (sats < 0 ? '-' : '+')}
      {s.format === 'symbol' && <BitcoinGlyph />}
      {body}
    </span>
  );
}

function MutinynetBadge() {
  return (
    <span
      className="font-pixel tracking-widest inline-flex items-center px-2 py-1"
      style={{ fontSize: 9, backgroundColor: BADGE_BG, color: BADGE_TEXT, borderRadius: 2 }}
    >
      MUTINYNET · TEST FUNDS
    </span>
  );
}

/** Mobile-wallet card: 2px pixel border on the soft card background. */
function PixelCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '2px solid var(--alice-border)',
        borderRadius: 2,
        backgroundColor: 'var(--alice-card-bg)',
      }}
    >
      {children}
    </div>
  );
}

/** Web replica of the mobile wallet's corner-bracket action button. */
function CornerButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  // The source SVG carries an intrinsic 1000px size; pin it to the corner box.
  const corner = useMemo(
    () => CORNER_SVG
      .replaceAll('{{COLOR}}', 'currentColor')
      .replace('width="1000"', 'width="20" style="display:block"')
      .replace('height="1000"', 'height="20"'),
    [],
  );
  const cornerStyle = (rotate: number, pos: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    width: 20,
    height: 20,
    transform: `rotate(${rotate}deg)`,
    ...pos,
  });
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="relative cursor-pointer disabled:opacity-40 disabled:cursor-default bg-transparent"
      style={{ width: 140, height: 70, color: 'var(--alice-primary-dark)' }}
    >
      <span aria-hidden style={cornerStyle(90, { top: 0, left: 0 })} dangerouslySetInnerHTML={{ __html: corner }} />
      <span aria-hidden style={cornerStyle(180, { top: 0, right: 0 })} dangerouslySetInnerHTML={{ __html: corner }} />
      <span aria-hidden style={cornerStyle(0, { bottom: 0, left: 0 })} dangerouslySetInnerHTML={{ __html: corner }} />
      <span aria-hidden style={cornerStyle(270, { bottom: 0, right: 0 })} dangerouslySetInnerHTML={{ __html: corner }} />
      <span className="font-pixel tracking-widest" style={{ fontSize: 11 }}>{label}</span>
    </button>
  );
}

// The Playground → Learn bridge, symmetric to the chapters' "try it" button:
// a lesson card can carry a discreet link to the course that explains the
// concept in depth. Course-level for now, chapter-level once the mapping in
// learn/playground-suggest grows per-chapter targets.
function Lesson({ lesson, learnCourse }: { lesson: PracticeLesson; learnCourse?: string }) {
  const router = useRouter();
  return (
    <div className="px-3 py-3" style={{ border: `1px dashed ${BADGE_BG}` }}>
      <div className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-primary-dark)' }}>
        {lesson.title}
      </div>
      <p className="font-numbers mt-2" style={{ fontSize: 14, lineHeight: '20px', color: 'var(--alice-muted)' }}>
        {lesson.body}
      </p>
      {learnCourse && (
        <button
          type="button"
          className="font-pixel tracking-widest cursor-pointer mt-2"
          style={{ fontSize: 8, color: 'var(--alice-primary)', background: 'transparent', border: 0, padding: 0 }}
          onClick={() => router.push(`/learn/?course=${learnCourse}`)}
        >
          LEARN WHY →
        </button>
      )}
    </div>
  );
}


function PrimaryButton({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="font-pixel tracking-widest w-full py-3 cursor-pointer disabled:opacity-50 disabled:cursor-default"
      style={{
        fontSize: 10,
        backgroundColor: danger ? BADGE_BG : 'var(--alice-primary)',
        color: danger ? BADGE_TEXT : 'var(--alice-on-primary)',
        borderRadius: 2,
      }}
    >
      {label}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between py-2"
      style={{ borderBottom: '1px dotted var(--alice-border)' }}
    >
      <span className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-muted)' }}>{label}</span>
      <span className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-text)' }}>{value}</span>
    </div>
  );
}

/**
 * Settings list row, mobile settings style. A div rather than a button so a
 * row can carry interactive content (the unit switcher) without nesting
 * buttons, which is invalid HTML and breaks hydration.
 */
function SettingsRow({
  label,
  right,
  onClick,
  danger,
  last,
}: {
  label: string;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      className="flex w-full items-center justify-between px-4 py-4 text-left"
      style={{
        borderBottom: last ? 'none' : '1px dotted var(--alice-border)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span
        className="font-pixel tracking-wider"
        style={{ fontSize: 11, color: danger ? BADGE_BG : 'var(--alice-primary-dark)' }}
      >
        {label}
      </span>
      <span className="font-pixel flex items-center gap-2" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>
        {right}
      </span>
    </div>
  );
}

/** The mobile settings unit switcher: ₿ | sats | BTC. */
function UnitSwitcher({ state }: { state: AmountState }) {
  const active = coerceTestUnit(state).format;
  return (
    <span className="inline-flex overflow-hidden" style={{ border: '2px solid var(--alice-border)', borderRadius: 2 }}>
      {TEST_UNITS.map((unit, index) => {
        const isActive = unit === active;
        return (
          <button
            key={unit}
            onClick={() => setAmountFormat(unit)}
            className="font-pixel cursor-pointer flex items-center justify-center"
            style={{
              fontSize: 9,
              minWidth: 44,
              padding: '7px 8px',
              borderLeft: index > 0 ? '2px solid var(--alice-border)' : 'none',
              backgroundColor: isActive ? 'var(--alice-primary)' : 'transparent',
              color: isActive ? 'var(--alice-on-primary)' : 'var(--alice-muted)',
            }}
          >
            {unit === 'symbol' ? <BitcoinGlyph /> : unit === 'sats' ? 'sats' : 'BTC'}
          </button>
        );
      })}
    </span>
  );
}

/** Confirmed history as a cumulative balance series, oldest first. */
function buildBalancePoints(snapshot: PlaygroundSnapshot): BalancePoint[] {
  const confirmed = snapshot.history
    .filter((entry) => entry.confirmed && entry.blockTime)
    .sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
  let balance = 0;
  const points: BalancePoint[] = confirmed.map((entry) => {
    balance += entry.direction === 'incoming' ? entry.amountSats : -entry.amountSats;
    return { t: entry.blockTime ?? 0, balanceSats: balance };
  });
  if (points.length > 0) {
    points.push({ t: Math.floor(Date.now() / 1000), balanceSats: snapshot.balanceSats });
  }
  return points;
}

// Sparrow-style: one screen, the whole transaction laid bare and colour
// coded, updating as the amount is typed. No wizard, no repetition: the
// anatomy IS the lesson, and the two buttons underneath lead to the course
// and to Alice for anything the labels do not answer.
type SendPhase = 'building' | 'signed' | 'sent';

/** One colour per part of a transaction, reused by the legend and the rows. */
const TX_COLORS = {
  input: 'var(--alice-primary)',
  recipient: 'var(--alice-success)',
  change: 'var(--alice-warning)',
  fee: 'var(--alice-danger)',
} as const;

/**
 * The question the send screen hands to Alice, written from what is actually
 * on screen. Deliberately not a link to a course: an answer costs one
 * keystroke, a course costs an evening, and Alice can recommend the lesson
 * herself once she knows what the person is stuck on.
 */
function draftQuestion(plan: PracticeTxPlan | null): string {
  if (!plan) return 'Walk me through how a Bitcoin transaction is built.';
  const change = plan.changeSats > 0
    ? `sends ${plan.changeSats} sats back to me as change`
    : 'creates no change output at all';
  return (
    'Explain the transaction I am about to send, in simple terms: '
    + `it spends ${plan.inputs.length} coin(s) worth ${plan.totalInputSats} sats to pay `
    + `${plan.amountSats} sats, ${change}, and leaves ${plan.feeSats} sats of fee. `
    + 'Why is it built this way?'
  );
}

function TxPartRow({
  color,
  label,
  detail,
  value,
  strong,
}: {
  color: string;
  label: string;
  detail?: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2" style={{ borderBottom: '1px dotted var(--alice-border)' }}>
      <span aria-hidden style={{ width: 4, alignSelf: 'stretch', backgroundColor: color, borderRadius: 1 }} />
      <span className="flex flex-col flex-1 min-w-0">
        <span className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-primary-dark)' }}>{label}</span>
        {detail && (
          <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>{detail}</span>
        )}
      </span>
      <span
        className="font-pixel shrink-0"
        style={{ fontSize: strong ? 11 : 9, color: strong ? 'var(--alice-primary-dark)' : 'var(--alice-text)' }}
      >
        {value}
      </span>
    </div>
  );
}

function SendFlow({
  snapshot,
  onDone,
  onExit,
  onPlanChange,
  onAskAlice,
}: {
  snapshot: PlaygroundSnapshot;
  onDone: () => void;
  onExit: () => void;
  onPlanChange: (plan: PracticeTxPlan | null) => void;
  onAskAlice: (question: string) => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<SendPhase>('building');
  const [address, setAddress] = useState('');
  const [amountText, setAmountText] = useState('');
  const [feeRate, setFeeRate] = useState<number | null>(null);
  const [signed, setSigned] = useState<PlaygroundSignedSend | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [receiptCopied, setReceiptCopied] = useState(false);

  // The network's own fee rate, fetched once: the breakdown is only honest if
  // it prices the transaction the way the network will.
  useEffect(() => {
    let cancelled = false;
    void playgroundFeeRate()
      .then((rate) => { if (!cancelled) setFeeRate(rate); })
      .catch(() => { if (!cancelled) setFeeRate(1); });
    return () => { cancelled = true; };
  }, []);

  // Accepts a bare address or a bip21 URI (bitcoin:tb1...?amount=0.0001).
  // Memoized on purpose: the scanner keys its camera effect on this callback,
  // so a fresh identity each render would reopen the camera each render.
  const applyScannedPayment = useCallback((text: string) => {
    let value = text.trim();
    if (/^bitcoin:/i.test(value)) {
      const [addr, query] = value.slice('bitcoin:'.length).split('?');
      value = addr;
      const amountBtc = Number(new URLSearchParams(query ?? '').get('amount'));
      if (Number.isFinite(amountBtc) && amountBtc > 0) {
        setAmountText(String(Math.round(amountBtc * 1e8)));
      }
    }
    setAddress(value);
    setScanOpen(false);
  }, []);

  // Emptying the wallet. The fee has to come out of the same coins, so the
  // most that can be sent is the balance minus the fee for spending every
  // coin into a single output. Offering the balance itself, as this screen
  // used to, asks for an amount the wallet can never afford: the wallet
  // answered "insufficient funds" about its own balance.
  const sweep = useMemo(() => {
    if (feeRate === null) return null;
    const spendable = snapshot.utxos.filter((coin) => coin.confirmed);
    if (spendable.length === 0) return null;
    // The recipient's address decides the size of the only output, so MAX is
    // exact once one is typed and priced as our own until then.
    return maxPracticeSendable({
      utxos: spendable,
      feeRateSatVb: feeRate,
      recipientAddress: address.trim() || undefined,
    });
  }, [address, feeRate, snapshot.utxos]);

  // The plan is derived, not stored: every keystroke re-plans, so what the
  // screen shows is always what would actually be signed.
  const { plan, planError } = useMemo(() => {
    const amountSats = Number(amountText);
    if (!address.trim() || !amountText || !Number.isFinite(amountSats) || feeRate === null) {
      return { plan: null, planError: null };
    }
    try {
      return {
        plan: planPlaygroundSend({
          utxos: snapshot.utxos,
          recipientAddress: address.trim(),
          amountSats,
          feeRateSatVb: feeRate,
          changeAddress: snapshot.changeAddress,
        }),
        planError: null,
      };
    } catch (cause) {
      return { plan: null, planError: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [address, amountText, feeRate, snapshot.utxos, snapshot.changeAddress]);

  // Publish the draft upward so Alice's attachment describes what is on screen.
  useEffect(() => { onPlanChange(plan); }, [plan, onPlanChange]);
  useEffect(() => () => onPlanChange(null), [onPlanChange]);

  // Editing after signing invalidates the signature: drop it rather than let
  // the screen show bytes that no longer match the plan.
  useEffect(() => {
    setSigned(null);
    setPhase((current) => (current === 'signed' ? 'building' : current));
  }, [address, amountText]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 14,
    color: 'var(--alice-text)',
    backgroundColor: 'var(--alice-bg-soft)',
    border: '2px solid var(--alice-border)',
    borderRadius: 2,
  };

  if (phase === 'sent' && txid && plan) {
    return (
      <PixelCard>
        <div
          className="flex flex-col items-center gap-3 p-6"
          style={{ backgroundColor: 'var(--alice-primary)', borderRadius: 2 }}
        >
          <span className="font-pixel tracking-widest pt-2" style={{ fontSize: 12, color: 'var(--alice-on-primary)' }}>
            PAYMENT SUBMITTED
          </span>
          <span className="font-numbers" style={{ fontSize: 48, lineHeight: '54px', color: 'var(--alice-on-primary)' }}>
            -{formatTestSats(plan.amountSats)}
          </span>
          <span aria-hidden className="my-4" style={{ width: 44, height: 3, backgroundColor: 'var(--alice-on-primary)' }} />
          <span className="font-pixel tracking-widest" style={{ fontSize: 11, color: 'var(--alice-on-primary)' }}>TO</span>
          <button
            className="flex flex-col items-center gap-1 cursor-pointer bg-transparent"
            onClick={() => {
              void navigator.clipboard.writeText(plan.recipientAddress).then(() => {
                setReceiptCopied(true);
                setTimeout(() => setReceiptCopied(false), 1800);
              });
            }}
          >
            <span className="font-numbers break-all text-center" style={{ fontSize: 14, lineHeight: '19px', color: 'var(--alice-on-primary)', maxWidth: 460 }}>
              {plan.recipientAddress}
            </span>
            <span className="font-pixel tracking-wider" style={{ fontSize: 9, color: 'var(--alice-on-primary)' }}>
              {receiptCopied ? 'COPIED' : 'TAP TO COPY'}
            </span>
          </button>
          <span className="font-pixel tracking-widest mt-4" style={{ fontSize: 11, color: 'var(--alice-on-primary)' }}>
            TRANSACTION
          </span>
          <button
            onClick={() => openPlaygroundTxInExplorer(txid, (path) => router.push(path), 'Test sats sent')}
            className="flex flex-col items-center gap-1 cursor-pointer bg-transparent"
          >
            <span className="font-numbers break-all text-center" style={{ fontSize: 13, lineHeight: '18px', color: 'var(--alice-on-primary)', maxWidth: 460 }}>
              {txid}
            </span>
            <span className="font-pixel tracking-wider" style={{ fontSize: 9, color: 'var(--alice-on-primary)' }}>
              OPEN IN THE EXPLORER
            </span>
          </button>
          <button
            onClick={onDone}
            className="font-pixel tracking-widest w-full py-3 mt-4 cursor-pointer"
            style={{ fontSize: 11, backgroundColor: 'var(--alice-on-primary)', color: 'var(--alice-primary)', borderRadius: 2 }}
          >
            BACK TO WALLET
          </button>
        </div>
      </PixelCard>
    );
  }

  return (
    <PixelCard>
      <div className="flex flex-col gap-4 p-3">
        {error && <ErrorCard message={error} />}

        {/* What to send, and to whom. */}
        <div className="flex flex-col gap-3">
          <div>
            <FieldLabel>SEND ON BITCOIN</FieldLabel>
            <input
              className="font-numbers w-full mt-1 px-3 outline-none"
              style={{ ...inputStyle, height: 54 }}
              value={address}
              onChange={(e) => { setAddress(e.target.value); setError(null); }}
              placeholder="address"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              className="font-pixel tracking-widest cursor-pointer mt-2 opacity-80 hover:opacity-100"
              style={{ fontSize: 9, color: 'var(--alice-primary)' }}
              onClick={() => setScanOpen(true)}
            >
              SCAN QR →
            </button>
          </div>
          {scanOpen && (
            <ExplorerQrScanner onResult={applyScannedPayment} onClose={() => setScanOpen(false)} />
          )}
          <div>
            <FieldLabel>AMOUNT (SATS)</FieldLabel>
            {/* The amount field is the one row with three rigid parts. Without
                min-w-0 the input refuses to shrink below the width of what is
                typed in it, so on a narrow screen it pushes SATS and MAX past
                the border instead of giving up space. */}
            <div
              className="flex items-stretch mt-1 overflow-hidden"
              style={{ minHeight: 62, border: '2px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
            >
              <input
                className="font-numbers flex-1 min-w-0 bg-transparent px-3 outline-none"
                style={{ fontSize: 26, color: 'var(--alice-primary-dark)' }}
                value={amountText}
                onChange={(e) => { setAmountText(e.target.value.replace(/\D/g, '')); setError(null); }}
                placeholder="0"
                inputMode="numeric"
              />
              <span
                className="font-pixel flex shrink-0 items-center justify-center"
                style={{ minWidth: 48, fontSize: 10, color: 'var(--alice-muted)', letterSpacing: 2 }}
              >
                SATS
              </span>
              <button
                className="font-pixel tracking-wider shrink-0 cursor-pointer"
                style={{ minWidth: 76, fontSize: 10, backgroundColor: 'var(--alice-primary)', color: 'var(--alice-on-primary)' }}
                onClick={() => {
                  if (!sweep || sweep.amountSats < PRACTICE_DUST_SATS) {
                    setError(
                      snapshot.balanceSats === 0 && snapshot.pendingSats > 0
                        ? 'These sats have not confirmed yet. Alice waits for the next block, '
                          + 'about thirty seconds on Mutinynet.'
                        : 'There is not enough here to pay a fee and still send something.',
                    );
                    return;
                  }
                  setAmountText(String(sweep.amountSats));
                  setError(null);
                }}
              >
                MAX
              </button>
            </div>
            <div className="font-pixel text-right mt-1" style={{ fontSize: 9, color: 'var(--alice-muted)' }}>
              {sweep && amountText === String(sweep.amountSats) ? (
                // The lesson MAX teaches: a wallet is emptied by the coins it
                // holds minus what the miners take, never by its balance.
                <>EVERY COIN, LESS THE {formatTestSats(sweep.feeSats)} OF FEE</>
              ) : (
                <>
                  AVAILABLE TO SEND: {formatTestSats(snapshot.balanceSats)}
                  {snapshot.pendingSats > 0 && (
                    <> · TOTAL WALLET: {formatTestSats(snapshot.balanceSats + snapshot.pendingSats)}</>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* The transaction, laid bare. */}
        <div style={{ borderTop: '2px solid var(--alice-border)', paddingTop: 12 }}>
          <div className="flex items-center justify-between">
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
              THE TRANSACTION
            </span>
            {plan && (
              <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
                {plan.estimatedVbytes} vbytes · {plan.feeRateSatVb} sat/vB
              </span>
            )}
          </div>

          {!plan && (
            <p className="font-numbers mt-3" style={{ fontSize: 14, lineHeight: '20px', color: planError ? 'var(--alice-danger)' : 'var(--alice-muted)' }}>
              {planError
                ?? 'Enter an address and an amount, and Alice builds the transaction here, '
                  + 'piece by piece, before anything is signed or sent.'}
            </p>
          )}

          {plan && (
            <div className="flex flex-col mt-2">
              <span className="font-pixel mt-2 mb-1" style={{ fontSize: 9, color: TX_COLORS.input }}>
                COINS SPENT · {plan.inputs.length} INPUT{plan.inputs.length === 1 ? '' : 'S'}
              </span>
              {plan.inputs.map((input) => (
                <TxPartRow
                  key={`${input.txid}:${input.vout}`}
                  color={TX_COLORS.input}
                  label={truncateMiddle(`${input.txid}:${input.vout}`, 8, 6, 20)}
                  detail={input.confirmed ? 'confirmed coin' : 'unconfirmed coin'}
                  value={formatTestSats(input.valueSats)}
                />
              ))}
              <TxPartRow
                color={TX_COLORS.input}
                label="TOTAL SPENT"
                value={formatTestSats(plan.totalInputSats)}
                strong
              />

              <span className="font-pixel mt-4 mb-1" style={{ fontSize: 9, color: TX_COLORS.recipient }}>
                WHERE IT GOES
              </span>
              <TxPartRow
                color={TX_COLORS.recipient}
                label="TO THE RECIPIENT"
                detail={truncateMiddle(plan.recipientAddress, 14, 10, 28)}
                value={formatTestSats(plan.amountSats)}
              />
              {plan.changeSats > 0 ? (
                <TxPartRow
                  color={TX_COLORS.change}
                  label="CHANGE, BACK TO YOU"
                  detail="a new address of your wallet"
                  value={formatTestSats(plan.changeSats)}
                />
              ) : (
                <TxPartRow
                  color={TX_COLORS.change}
                  label="NO CHANGE"
                  detail={
                    // Two different lessons wear the same empty change row: a
                    // sweep leaves nothing over by construction, while a
                    // near-exact payment has a leftover so small that paying
                    // it to the miners costs less than spending it later.
                    plan.feeDonationSats > 0
                      ? 'the leftover was too small to be worth an output'
                      : 'this empties the wallet, so nothing is left over'
                  }
                  value="0 SATS"
                />
              )}
              <TxPartRow
                color={TX_COLORS.fee}
                label="MINING FEE"
                detail={`${plan.estimatedVbytes} vbytes × ${plan.feeRateSatVb} sat/vB`}
                value={formatTestSats(plan.feeSats)}
              />
            </div>
          )}

          {/* The legend is the lesson: one line per colour. */}
          <div className="flex flex-col gap-1 mt-3">
            {[
              [TX_COLORS.input, 'Coins you already own are spent whole. Bitcoin has no partial coins.'],
              [TX_COLORS.recipient, 'What the recipient actually receives.'],
              [TX_COLORS.change, 'The leftover comes back to you, on a fresh address.'],
              [TX_COLORS.fee, 'Miners are paid for size in vbytes, never for the amount.'],
            ].map(([color, text]) => (
              <span key={text} className="flex items-start gap-2">
                <span aria-hidden style={{ width: 8, height: 8, marginTop: 4, backgroundColor: color, borderRadius: 1, flexShrink: 0 }} />
                <span className="font-numbers" style={{ fontSize: 12, lineHeight: '17px', color: 'var(--alice-muted)' }}>{text}</span>
              </span>
            ))}
          </div>

          <button
            className="font-pixel tracking-wider cursor-pointer bg-transparent mt-3 text-left"
            style={{ fontSize: 9, color: 'var(--alice-primary)' }}
            onClick={() => onAskAlice(draftQuestion(plan))}
          >
            ASK ALICE ABOUT THIS TRANSACTION →
          </button>
        </div>

        {/* Signing, then broadcasting: two deliberate acts, not five screens. */}
        {signed && (
          <div className="flex flex-col gap-1" style={{ borderTop: '2px solid var(--alice-border)', paddingTop: 12 }}>
            <FieldLabel>ALICE RE-READ THE SIGNED BYTES</FieldLabel>
            {[
              'Spends exactly the coins listed above',
              'Pays the recipient the amount shown',
              `Leaves ${formatTestSats(signed.review.feeSats)} to the miners, as planned`,
            ].map((line) => (
              <span key={line} className="font-numbers" style={{ fontSize: 13, lineHeight: '19px', color: 'var(--alice-text)' }}>
                {signed.review.matchesPlan ? '✓' : '✗'} {line}
              </span>
            ))}
            {!signed.review.matchesPlan && (
              <p className="font-pixel" style={{ fontSize: 9, color: BADGE_BG }}>{signed.review.issues.join(' ')}</p>
            )}
            <span className="font-numbers break-all mt-1" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
              txid {signed.txid}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {!signed ? (
            <PrimaryButton
              label={busy ? 'SIGNING…' : 'SIGN THIS TRANSACTION'}
              disabled={busy || !plan}
              onClick={() => void run(async () => {
                if (!plan) return;
                setSigned(await signPlaygroundSend(plan));
                setPhase('signed');
              })}
            />
          ) : (
            <PrimaryButton
              danger
              label={busy ? 'BROADCASTING…' : 'BROADCAST TO MUTINYNET'}
              disabled={busy || !signed.review.matchesPlan}
              onClick={() => void run(async () => {
                if (!plan || !signed) return;
                setTxid(await broadcastPlaygroundSend(signed, plan));
                setPhase('sent');
              })}
            />
          )}
          <button
            className="font-pixel tracking-widest cursor-pointer opacity-60 hover:opacity-100"
            style={{ fontSize: 9, color: 'var(--alice-muted)' }}
            onClick={onExit}
          >
            BACK TO THE PLAYGROUND
          </button>
        </div>
      </div>
    </PixelCard>
  );
}

function BackupFlow({
  backedUp,
  onBackedUp,
  onExit,
}: {
  backedUp: boolean;
  onBackedUp: () => void;
  onExit: () => void;
}) {
  type BackupStep = 'intro' | 'seed' | 'verify' | 'complete';
  const [step, setStep] = useState<BackupStep>('intro');
  const [words, setWords] = useState<string[]>([]);
  const [visibleWordIndex, setVisibleWordIndex] = useState<number | null>(null);
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifyAnswers, setVerifyAnswers] = useState<(string | null)[]>([null, null, null]);
  const [verifyError, setVerifyError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setError(null);
    try {
      setVisibleWordIndex(null);
      setWords(await getPlaygroundMnemonicWords());
      setStep('seed');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function toggleWord(index: number) {
    // Keep the phrase glance-resistant: revealing one word masks every other.
    setVisibleWordIndex((current) => (current === index ? null : index));
  }

  function startVerification() {
    const indices: number[] = [];
    while (indices.length < 3) {
      const index = Math.floor(Math.random() * words.length);
      if (!indices.includes(index)) indices.push(index);
    }
    indices.sort((a, b) => a - b);
    setVerifyIndices(indices);
    setVerifyAnswers([null, null, null]);
    setVerifyError(false);
    setStep('verify');
  }

  const choicesPerQuestion = useMemo(
    () =>
      verifyIndices.map((correctIndex) => {
        const correct = words[correctIndex];
        const alternatives: string[] = [];
        while (alternatives.length < 3) {
          const candidate = PRACTICE_WORDLIST[Math.floor(Math.random() * PRACTICE_WORDLIST.length)];
          if (candidate !== correct && !alternatives.includes(candidate)) alternatives.push(candidate);
        }
        const choices = [correct, ...alternatives];
        for (let index = choices.length - 1; index > 0; index--) {
          const swapIndex = Math.floor(Math.random() * (index + 1));
          [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
        }
        return choices;
      }),
    [verifyIndices, words],
  );

  function selectWord(questionIndex: number, word: string) {
    const answers = [...verifyAnswers];
    answers[questionIndex] = word;
    setVerifyAnswers(answers);
    setVerifyError(false);
  }

  async function confirmVerification() {
    const correct = verifyIndices.every(
      (wordIndex, questionIndex) => verifyAnswers[questionIndex] === words[wordIndex],
    );
    if (!correct) {
      setVerifyError(true);
      return;
    }
    try {
      await markPlaygroundBackedUp();
      onBackedUp();
      setWords([]);
      setStep('complete');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const title =
    step === 'intro' ? (backedUp ? 'RECOVERY PHRASE' : 'BACK UP YOUR WALLET')
    : step === 'seed' ? 'WRITE DOWN THESE 12 WORDS'
    : step === 'verify' ? 'VERIFY YOUR BACKUP'
    : 'BACKUP VERIFIED';

  return (
    <PixelCard>
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <div className="font-pixel tracking-widest" style={{ fontSize: 12, lineHeight: '20px', color: 'var(--alice-primary-dark)' }}>
          {title}
        </div>

        {error && <p className="font-pixel" style={{ fontSize: 9, color: BADGE_BG }}>{error}</p>}

        {step === 'intro' && (
          <>
            <p className="font-numbers" style={{ fontSize: 15, lineHeight: '22px', color: 'var(--alice-muted)', maxWidth: 520 }}>
              {backedUp
                ? 'Reveal your recovery phrase only in a private place.'
                : 'Your wallet is ready, but it is not backed up yet. Write down the 12 words and verify them to protect your test sats.'}
              {' '}This phrase controls only this Playground wallet on Mutinynet.
            </p>
            <p className="font-pixel tracking-wider" style={{ fontSize: 11, color: BADGE_BG }}>
              NEVER SHARE THESE WORDS
            </p>
            <div className="w-full max-w-xs">
              <PrimaryButton label={backedUp ? 'REVEAL PHRASE' : 'START BACKUP'} onClick={() => void reveal()} />
            </div>
          </>
        )}

        {step === 'seed' && (
          <>
            <p className="font-numbers" style={{ fontSize: 15, lineHeight: '22px', color: 'var(--alice-muted)', maxWidth: 520 }}>
              Keep them offline and in order. Anyone with these words can access this wallet.
            </p>
            <div className="grid grid-cols-2 gap-2 w-full" style={{ maxWidth: 520 }}>
              {words.map((word, index) => {
                const revealed = visibleWordIndex === index;
                return (
                  <button
                    key={`${index}-${word}`}
                    onClick={() => toggleWord(index)}
                    aria-label={`Recovery word ${index + 1}. ${revealed ? 'Hide' : 'Reveal'}`}
                    className="flex items-center gap-2 px-3 cursor-pointer text-left"
                    style={{
                      minHeight: 48,
                      border: '2px solid var(--alice-border)',
                      borderRadius: 2,
                      backgroundColor: revealed ? 'var(--alice-bg)' : 'var(--alice-card-bg)',
                    }}
                  >
                    <span className="font-numbers" style={{ width: 24, fontSize: 13, color: 'var(--alice-muted)' }}>
                      {index + 1}
                    </span>
                    {revealed ? (
                      <span className="font-numbers" style={{ fontSize: 16, color: 'var(--alice-primary-dark)' }}>{word}</span>
                    ) : (
                      <span
                        aria-hidden
                        className="relative overflow-hidden"
                        style={{ width: 92, height: 16, borderRadius: 3, backgroundColor: 'var(--alice-border)', opacity: 0.75 }}
                      >
                        <span className="absolute" style={{ top: 0, bottom: 0, left: 5, right: 5, backgroundColor: 'var(--alice-muted)', opacity: 0.32 }} />
                        <span className="absolute" style={{ top: 4, bottom: 4, left: 0, right: 0, backgroundColor: 'var(--alice-card-bg)', opacity: 0.38 }} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="font-pixel tracking-wider" style={{ fontSize: 11, color: BADGE_BG }}>
              ALICE WILL NEVER ASK YOU FOR THESE WORDS
            </p>
            <div className="w-full max-w-xs">
              {backedUp ? (
                <PrimaryButton label="DONE" onClick={onExit} />
              ) : (
                <PrimaryButton label="I WROTE THEM DOWN" onClick={startVerification} />
              )}
            </div>
          </>
        )}

        {step === 'verify' && (
          <>
            <p className="font-numbers" style={{ fontSize: 15, lineHeight: '22px', color: 'var(--alice-muted)' }}>
              Select the correct word for each position.
            </p>
            {verifyIndices.map((wordIndex, questionIndex) => (
              <div key={wordIndex} className="w-full text-left" style={{ maxWidth: 440 }}>
                <div className="font-pixel mb-2" style={{ fontSize: 11, color: 'var(--alice-primary-dark)' }}>
                  WORD #{wordIndex + 1}
                </div>
                <div className="flex flex-wrap gap-2">
                  {choicesPerQuestion[questionIndex].map((word) => {
                    const selected = verifyAnswers[questionIndex] === word;
                    const wrong = verifyError && selected && word !== words[wordIndex];
                    return (
                      <button
                        key={word}
                        onClick={() => selectWord(questionIndex, word)}
                        className="font-numbers cursor-pointer px-4 py-2"
                        style={{
                          fontSize: 14,
                          border: `2px solid ${wrong ? '#c04040' : selected ? 'var(--alice-primary-dark)' : 'var(--alice-border)'}`,
                          borderRadius: 2,
                          backgroundColor: wrong ? '#e06060' : selected ? 'var(--alice-primary)' : 'var(--alice-card-bg)',
                          color: selected || wrong ? 'var(--alice-on-primary)' : 'var(--alice-primary-dark)',
                        }}
                      >
                        {word}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {verifyError && (
              <p className="font-numbers" style={{ fontSize: 14, color: '#e06060' }}>
                Some words are wrong. Try again.
              </p>
            )}
            <div className="w-full max-w-xs">
              <PrimaryButton
                label="CONFIRM BACKUP"
                disabled={verifyAnswers.includes(null)}
                onClick={() => void confirmVerification()}
              />
            </div>
          </>
        )}

        {step === 'complete' && (
          <>
            <p className="font-numbers" style={{ fontSize: 15, lineHeight: '22px', color: 'var(--alice-muted)' }}>
              Your recovery phrase is safely backed up. Alice will no longer show the
              backup reminder.
            </p>
            <div className="w-full max-w-xs">
              <PrimaryButton label="BACK TO WALLET" onClick={onExit} />
            </div>
          </>
        )}
      </div>
    </PixelCard>
  );
}

/** Mobile wallet's error card: PAYMENT ERROR title on a danger-tinted box. */
function ErrorCard({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 p-3"
      style={{ border: '2px solid #c23838', borderRadius: 2, backgroundColor: '#c2383815' }}
    >
      <span className="font-pixel tracking-wider" style={{ fontSize: 11, color: '#c23838' }}>
        PAYMENT ERROR
      </span>
      <span className="font-pixel" style={{ fontSize: 9, lineHeight: '13px', color: '#c23838' }}>
        {message.toUpperCase()}
      </span>
    </div>
  );
}

type ReceivedPayment = {
  amountSats: number;
  txid: string | null;
  confirmed: boolean;
};

/**
 * Receive, mirroring the mobile screen: optional amount folded into a BIP21
 * QR, tap-the-QR-to-copy with the "Tap QR to copy" hint, a WAITING FOR
 * PAYMENT row, the payment-method row with its COPY flash, and the full-bleed
 * PAYMENT RECEIVED receipt once the payment lands (polled every 5 seconds).
 */
function ReceiveView({
  snapshot,
  amountState,
  onRotate,
  onExit,
  onError,
}: {
  snapshot: PlaygroundSnapshot;
  amountState: AmountState;
  onRotate: () => void;
  onExit: () => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [amountText, setAmountText] = useState('');
  const [copied, setCopied] = useState<'qr' | 'row' | null>(null);
  const [received, setReceived] = useState<ReceivedPayment | null>(null);

  const amountSats = amountText ? Number(amountText) : null;
  const payload = playgroundPaymentUri(snapshot.receiveAddress, amountSats);

  // Payment detection, mobile-style: poll while the screen is open, fire once
  // on a balance rise or a new incoming transaction, then keep polling for
  // the confirmation.
  const baseline = useMemo(
    () => ({
      total: snapshot.balanceSats + snapshot.pendingSats,
      txids: new Set(snapshot.history.map((entry) => entry.txid)),
    }),
    // The baseline is captured when the screen opens, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      loadPlaygroundSnapshot()
        .then((fresh) => {
          const incoming = fresh.history.find(
            (entry) => entry.direction === 'incoming' && !baseline.txids.has(entry.txid),
          );
          setReceived((current) => {
            if (current) {
              const entry = fresh.history.find((e) => e.txid === current.txid);
              return entry ? { ...current, confirmed: entry.confirmed } : current;
            }
            const total = fresh.balanceSats + fresh.pendingSats;
            if (incoming) {
              return { amountSats: incoming.amountSats, txid: incoming.txid, confirmed: incoming.confirmed };
            }
            if (total > baseline.total) {
              return { amountSats: total - baseline.total, txid: null, confirmed: false };
            }
            return null;
          });
        })
        .catch(() => { /* next tick retries */ })
        .finally(() => { inFlight = false; });
    }, 5000);
    return () => clearInterval(timer);
  }, [baseline]);

  function copy(target: 'qr' | 'row', value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(target);
      setTimeout(() => setCopied((current) => (current === target ? null : current)), 2000);
    }).catch(() => onError('Unable to copy.'));
  }

  if (received) {
    return (
      <div
        className="flex flex-col items-center justify-between gap-4 p-6"
        style={{ backgroundColor: 'var(--alice-primary)', borderRadius: 2, minHeight: 480 }}
      >
        <div className="flex flex-col items-center gap-2 pt-6">
          <span className="font-pixel tracking-widest" style={{ fontSize: 12, color: 'var(--alice-on-primary)' }}>
            PAYMENT RECEIVED
          </span>
          <span className="font-numbers mt-4" style={{ fontSize: 48, lineHeight: '54px', color: 'var(--alice-on-primary)' }}>
            +{formatWalletAmount(received.amountSats, coerceTestUnit(amountState).format, amountState.price)}
          </span>
          <span aria-hidden className="my-6" style={{ width: 44, height: 3, backgroundColor: 'var(--alice-on-primary)' }} />
          <span className="font-pixel tracking-widest" style={{ fontSize: 11, color: 'var(--alice-on-primary)' }}>
            CONFIRMATIONS
          </span>
          <span
            className="font-numbers mt-1"
            style={{ fontSize: 18, color: received.confirmed ? '#3fb950' : '#e0b34b' }}
          >
            {received.confirmed ? 'Confirmed' : 'Unconfirmed'}
          </span>
          {received.txid && (
            <>
              <span className="font-pixel tracking-widest mt-6" style={{ fontSize: 11, color: 'var(--alice-on-primary)' }}>
                TRANSACTION
              </span>
              <button
                onClick={() => openPlaygroundTxInExplorer(received.txid!, (path) => router.push(path), 'Test sats received')}
                className="flex flex-col items-center gap-1 cursor-pointer bg-transparent"
              >
                <span className="font-numbers break-all text-center" style={{ fontSize: 13, lineHeight: '18px', color: 'var(--alice-on-primary)', maxWidth: 460 }}>
                  {received.txid}
                </span>
                <span className="font-pixel tracking-wider" style={{ fontSize: 9, color: 'var(--alice-on-primary)' }}>
                  OPEN IN THE EXPLORER
                </span>
              </button>
            </>
          )}
        </div>
        <button
          onClick={onExit}
          className="font-pixel tracking-widest w-full py-3 cursor-pointer"
          style={{ fontSize: 11, backgroundColor: 'var(--alice-on-primary)', color: 'var(--alice-primary)', borderRadius: 2 }}
        >
          BACK TO WALLET
        </button>
      </div>
    );
  }

  return (
    <PixelCard>
      <div className="flex flex-col items-center gap-4 p-4">
        <Lesson lesson={PRACTICE_LESSONS.receive} learnCourse="btc101" />

        {/* Amount request, optional: folds into the BIP21 URI. */}
        <div className="w-full" style={{ maxWidth: 320 }}>
          <FieldLabel>AMOUNT OPTIONAL (SATS)</FieldLabel>
          <div
            className="flex items-center mt-1 px-3"
            style={{ minHeight: 56, border: '2px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-card-bg)' }}
          >
            <input
              className="font-numbers flex-1 bg-transparent outline-none"
              style={{ fontSize: 26, color: 'var(--alice-primary-dark)' }}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value.replace(/\D/g, '').slice(0, 12))}
              placeholder="0"
              inputMode="numeric"
            />
            <span className="font-pixel" style={{ fontSize: 10, color: 'var(--alice-muted)', letterSpacing: 2 }}>SATS</span>
          </div>
        </div>

        {/* Waiting row, mobile-style. */}
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block animate-spin"
            style={{ width: 10, height: 10, border: '2px solid var(--alice-primary)', borderTopColor: 'transparent', borderRadius: '50%' }}
          />
          <span className="font-pixel tracking-wider" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
            WAITING FOR PAYMENT...
          </span>
        </div>

        {/* The QR: tap to copy the payload. */}
        <button
          onClick={() => copy('qr', payload)}
          className="cursor-pointer"
          style={{ border: '2px solid var(--alice-border)', borderRadius: 2, backgroundColor: '#ffffff', padding: 8 }}
          aria-label="Copy the payment request"
        >
          <QRCode value={payload} size={220} bgColor="#ffffff" fgColor="#1c2533" />
        </button>
        <span className="font-pixel tracking-wider" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
          {copied === 'qr' ? 'COPIED !' : 'Tap QR to copy'}
        </span>

        {/* Payment method row, mobile anatomy. */}
        <button
          onClick={() => copy('row', snapshot.receiveAddress)}
          className="flex w-full items-center gap-3 py-2 cursor-pointer text-left"
          style={{ maxWidth: 420, minHeight: 54 }}
        >
          <span className="flex flex-col flex-1 min-w-0 gap-1">
            <span className="font-pixel tracking-wider" style={{ fontSize: 10, color: 'var(--alice-primary-dark)' }}>
              BITCOIN MUTINYNET
            </span>
            <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>
              {truncateMiddle(snapshot.receiveAddress, 14, 10, 24)}
            </span>
          </span>
          <span className="font-pixel tracking-wider" style={{ fontSize: 10, color: 'var(--alice-primary)' }}>
            {copied === 'row' ? 'COPIED' : 'COPY'}
          </span>
        </button>

        <div className="w-full" style={{ maxWidth: 420 }}>
          <PrimaryButton label="NEW ADDRESS" onClick={onRotate} />
        </div>
      </div>
    </PixelCard>
  );
}

type FaucetState =
  | { stage: 'confirm' }
  | { stage: 'busy' }
  | { stage: 'sent'; txid: string; sats: number }
  | { stage: 'fallback'; message: string | null; address: string; faucetUrl: string };

type View = 'home' | 'send' | 'receive' | 'settings' | 'coins' | 'addresses' | 'backup' | 'faucet';

const VIEW_TITLES: Record<View, string> = {
  home: 'PLAYGROUND',
  send: 'PLAYGROUND',
  receive: 'RECEIVE',
  settings: 'SETTINGS',
  coins: 'COIN CONTROL',
  addresses: 'ADDRESSES',
  backup: 'RECOVERY PHRASE',
  faucet: 'FREE TEST SATS',
};

function PlaygroundWorkspace({
  onStateChange,
  onAskAlice,
}: {
  onStateChange?: (state: {
    view: View;
    snapshot: PlaygroundSnapshot | null;
    exists: boolean;
    draft: PracticeTxPlan | null;
  }) => void;
  onAskAlice?: (question: string) => void;
}) {
  const router = useRouter();
  const amountState = useAmountState();
  const [exists, setExists] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<PlaygroundSnapshot | null>(null);
  const [view, setView] = useState<View>('home');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faucet, setFaucet] = useState<FaucetState | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [backedUp, setBackedUp] = useState(true);
  const [faucetClaimed, setFaucetClaimed] = useState(true);
  // The transaction currently being composed on the send screen, published so
  // Alice's attachment describes exactly what the user is looking at.
  const [draft, setDraft] = useState<PracticeTxPlan | null>(null);

  // Show the last known wallet at once, then reconcile with the network. A
  // wallet that takes seconds to appear reads as broken, and every number here
  // is refreshed a moment later anyway.
  useEffect(() => {
    const cached = readCachedPlaygroundSnapshot();
    if (cached) {
      setSnapshot(cached);
      setExists(true);
    }
    // A Learn chapter (or a chat suggestion) may have asked for a specific
    // view; land there directly instead of on home.
    const pending = consumePendingPlaygroundView();
    if (pending) setView(pending);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const present = await hasPlayground();
      setExists(present);
      setBackedUp(await isPlaygroundBackedUp());
      setFaucetClaimed(await hasClaimedPlaygroundFaucet());
      if (present) setSnapshot(await loadPlaygroundSnapshot());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // First-open welcome, shown until dismissed for good (same mechanics as the
  // Explorer's). Deferred to an effect so the server render stays stable.
  const [showIntro, setShowIntro] = useState(false);
  useEffect(() => {
    setShowIntro(!wasPlaygroundIntroDismissed());
  }, []);

  // One create path for the intro modal's CTA and the create card's button.
  const startCreate = useCallback(() => {
    setCreating(true);
    setError(null);
    void createPlaygroundIfNeeded()
      .then(() => refresh())
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setCreating(false));
  }, [refresh]);

  // Auto-refresh while the wallet is on screen. Mutinynet mines every 30
  // seconds, so a payment or a confirmation lands on its own without the user
  // hunting for a refresh button. Paused during the guided send and whenever
  // the tab is hidden, so a background tab never polls the explorer.
  useEffect(() => {
    if (!exists || view === 'send') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 20_000);
    return () => clearInterval(timer);
  }, [exists, view, refresh]);

  const balancePoints = useMemo(
    () => (snapshot ? buildBalancePoints(snapshot) : []),
    [snapshot],
  );

  // The shell owns the docked Ask-Alice panel; it follows this state.
  useEffect(() => {
    onStateChange?.({ view, snapshot, exists: exists === true, draft });
  }, [view, snapshot, exists, draft, onStateChange]);

  async function confirmFaucetClaim() {
    setFaucet({ stage: 'busy' });
    setError(null);
    try {
      const claim = await claimPlaygroundFaucet();
      if (claim.kind === 'sent') {
        setFaucet({ stage: 'sent', txid: claim.txid, sats: claim.sats });
        setFaucetClaimed(true);
        void refresh();
      } else {
        setFaucet({
          stage: 'fallback',
          message: claim.kind === 'error' ? claim.message : null,
          address: claim.address,
          faucetUrl: claim.faucetUrl,
        });
      }
    } catch (cause) {
      setFaucet(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function openFaucetManually(address: string, faucetUrl: string) {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // Copy is best-effort; the page still opens.
    }
    window.open(faucetUrl, '_blank', 'noopener');
  }

  // Settings children go back to settings; receive and settings go home.
  const inSubView = view !== 'home' && view !== 'send';
  const backTarget: View = view === 'coins' || view === 'addresses' || view === 'backup' || view === 'faucet'
    ? 'settings'
    : 'home';

  return (
    <div className="mx-auto w-full max-w-2xl flex flex-col gap-4 px-4 py-6">
      {showIntro && (
        <PlaygroundIntroModal
          hasWallet={exists === true}
          onClose={() => setShowIntro(false)}
          onCreate={() => {
            setShowIntro(false);
            startCreate();
          }}
        />
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {exists && (
            <button
              onClick={() => {
                setDeleteArmed(false);
                setView(inSubView ? backTarget : 'settings');
              }}
              aria-label={inSubView ? 'Back' : 'Playground settings'}
              className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
              style={{ border: '2px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-card-bg)' }}
            >
              {inSubView
                ? <span className="font-pixel" style={{ fontSize: 12, color: 'var(--alice-primary)' }}>←</span>
                : <SvgIcon svg={SETTINGS_SVG} size={16} color="var(--alice-primary)" />}
            </button>
          )}
          <h1 className="font-pixel tracking-widest" style={{ fontSize: 13, color: 'var(--alice-primary-dark)' }}>
            {VIEW_TITLES[view]}
          </h1>
        </div>
        <MutinynetBadge />
      </div>
      <p
        className="font-pixel tracking-widest text-center px-3 py-2"
        style={{ fontSize: 8, color: 'var(--alice-muted)', border: `1px dashed ${BADGE_BG}` }}
      >
        A PLACE TO LEARN AND EXPERIMENT. THESE SATS HAVE NO REAL VALUE.
      </p>

      {error && <p className="font-pixel" style={{ fontSize: 9, lineHeight: '14px', color: BADGE_BG }}>{error}</p>}

      {exists === false && (
        <PixelCard>
          <div className="flex flex-col gap-3 p-3">
            <Lesson lesson={PRACTICE_LESSONS.intro} />
            <PrimaryButton
              label={creating ? 'CREATING…' : 'CREATE PRACTICE WALLET'}
              disabled={creating}
              onClick={startCreate}
            />
          </div>
        </PixelCard>
      )}

      {exists && view === 'settings' && (
        <PixelCard>
          <SettingsRow label="BALANCE" right={<UnitSwitcher state={amountState} />} />
          <SettingsRow
            label="COIN CONTROL"
            right={<>{snapshot ? String(snapshot.utxos.length) : '…'} ›</>}
            onClick={() => setView('coins')}
          />
          <SettingsRow
            label="ADDRESSES"
            right={<>{snapshot ? String(snapshot.addresses.length) : '…'} ›</>}
            onClick={() => setView('addresses')}
          />
          <SettingsRow
            label="FREE TEST SATS"
            right={<>{faucetClaimed ? 'CLAIMED' : 'AVAILABLE'} ›</>}
            onClick={() => setView('faucet')}
          />
          <SettingsRow
            label="RECOVERY PHRASE"
            right={<>›</>}
            onClick={() => setView('backup')}
          />
          <SettingsRow
            label={deleteArmed ? 'CLICK AGAIN TO DELETE THE PRACTICE WALLET' : 'DELETE PRACTICE WALLET'}
            danger
            last
            onClick={() => {
              if (!deleteArmed) {
                setDeleteArmed(true);
                return;
              }
              void deletePlayground()
                .then(() => {
                  setSnapshot(null);
                  setExists(false);
                  setDeleteArmed(false);
                  setFaucet(null);
                    setView('home');
                })
                .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
            }}
          />
        </PixelCard>
      )}

      {exists && view === 'faucet' && (
        <PixelCard>
          <div className="flex flex-col gap-3 p-3">
            <p className="font-numbers" style={{ fontSize: 14, lineHeight: '20px', color: 'var(--alice-muted)' }}>
              {faucetClaimed
                ? 'You received your free 2,100 test sats from Alice. For more test sats, '
                  + 'head to the Mutinynet faucet: it hands them out whenever you need more.'
                : 'Alice hands out 2,100 test sats, once. Enough to practice a few payments '
                  + 'and watch the change come back to you.'}
            </p>
            {faucetClaimed ? (
              <PrimaryButton
                label="OPEN THE MUTINYNET FAUCET"
                onClick={() => {
                  void navigator.clipboard.writeText(snapshot?.receiveAddress ?? '').catch(() => {});
                  window.open(PRACTICE_FAUCET_URL, '_blank', 'noopener');
                }}
              />
            ) : (
              <PrimaryButton
                label="CLAIM 2,100 TEST SATS"
                onClick={() => {
                  setView('home');
                  setFaucet({ stage: 'confirm' });
                }}
              />
            )}
          </div>
        </PixelCard>
      )}

      {exists && view === 'backup' && (
        <>
          <Lesson lesson={PRACTICE_LESSONS.backup} learnCourse="btc101" />
          <BackupFlow
            backedUp={backedUp}
            onBackedUp={() => setBackedUp(true)}
            onExit={() => setView('home')}
          />
        </>
      )}

      {exists && view === 'receive' && snapshot && (
        <ReceiveView
          snapshot={snapshot}
          amountState={amountState}
          onRotate={() =>
            void rotatePlaygroundReceiveAddress()
              .then((address) => setSnapshot((prev) => (prev ? { ...prev, receiveAddress: address } : prev)))
              .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
          }
          onExit={() => {
            setView('home');
            void refresh();
          }}
          onError={setError}
        />
      )}

      {exists && view === 'coins' && (
        <PixelCard>
          <div className="flex flex-col gap-3 p-3">
            <Lesson lesson={PRACTICE_LESSONS.coins} learnCourse="btc101" />
            {snapshot !== null && (
              <div className="flex flex-col items-center gap-1 py-2 text-center">
                <span className="font-pixel tracking-wider" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
                  TOTAL COIN BALANCE
                </span>
                <span className="font-numbers" style={{ fontSize: 24, color: 'var(--alice-primary-dark)' }}>
                  {formatTestSats(snapshot.balanceSats + snapshot.pendingSats)}
                </span>
                <span className="font-pixel tracking-wider" style={{ fontSize: 9, color: 'var(--alice-muted)' }}>
                  {snapshot.utxos.length} COIN{snapshot.utxos.length === 1 ? '' : 'S'}
                  {' · '}
                  {snapshot.utxos.filter((u) => !u.confirmed).length} PENDING
                </span>
              </div>
            )}
            {snapshot === null || snapshot.utxos.length === 0 ? (
              <EmptyState title="NO COINS IN THIS VIEW" hint="Claim free test sats to receive your first coin." />
            ) : (
              snapshot.utxos.map((utxo) => (
                <div
                  key={`${utxo.txid}:${utxo.vout}`}
                  className="flex items-center justify-between gap-3 py-3 px-3"
                  style={{ border: '2px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-card-bg)' }}
                >
                  <span className="flex flex-col min-w-0 gap-1">
                    <span className="font-numbers" style={{ fontSize: 16, color: 'var(--alice-primary-dark)' }}>
                      {formatTestSats(utxo.valueSats)}
                    </span>
                    <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>
                      {truncateMiddle(`${utxo.txid}:${utxo.vout}`, 8, 6, 20)}
                      {utxo.change ? ' · change' : ''}
                    </span>
                  </span>
                  <span
                    className="font-pixel text-right"
                    style={{ fontSize: 10, color: utxo.confirmed ? '#2ea043' : '#e0b34b' }}
                  >
                    {utxo.confirmed ? 'CONFIRMED' : 'PENDING'}
                  </span>
                </div>
              ))
            )}
          </div>
        </PixelCard>
      )}

      {exists && view === 'addresses' && (
        <PixelCard>
          <div className="flex flex-col gap-3 p-3">
            <Lesson lesson={PRACTICE_LESSONS.receive} learnCourse="btc101" />
            <p className="font-numbers" style={{ fontSize: 12, lineHeight: '17px', color: 'var(--alice-muted)' }}>
              This list grows with your wallet: every payment you receive uses a fresh
              address, and change from your payments comes back on change addresses. Ask
              for a new one anytime from the receive screen.
            </p>
            {snapshot === null ? (
              <EmptyState title="No addresses yet" />
            ) : (
              <>
                {/* Current-address card, mobile anatomy. */}
                <div
                  className="flex flex-col gap-2 p-3"
                  style={{ border: '2px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-card-bg)' }}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-pixel tracking-wider" style={{ fontSize: 11, color: 'var(--alice-primary-dark)' }}>BITCOIN</span>
                    <span className="font-pixel tracking-wider" style={{ fontSize: 11, color: '#2ea043' }}>CURRENT</span>
                  </span>
                  <span className="font-numbers select-all" style={{ fontSize: 14, color: 'var(--alice-primary-dark)' }}>
                    {truncateMiddle(snapshot.receiveAddress, 18, 12, 34)}
                  </span>
                  <PrimaryButton
                    label="GENERATE NEW BITCOIN ADDRESS"
                    onClick={() =>
                      void rotatePlaygroundReceiveAddress()
                        .then(() => refresh())
                        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
                    }
                  />
                </div>

                {/* Previous addresses, dotted-ruled rows. */}
                {snapshot.addresses.filter((info) => info.address !== snapshot.receiveAddress).map((info) => (
                  <div
                    key={info.address}
                    className="flex flex-col gap-1 py-3"
                    style={{ borderBottom: '1px dotted var(--alice-border)' }}
                  >
                    <span className="flex items-center justify-between">
                      <span className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-primary-dark)' }}>
                        {info.change ? 'CHANGE' : 'RECEIVE'} #{info.index}
                        {info.used ? '' : ' · FRESH'}
                      </span>
                      {info.balanceSats > 0 && (
                        <TestAmount sats={info.balanceSats} state={amountState} fontSize={9} color="var(--alice-text)" />
                      )}
                    </span>
                    <span className="font-numbers select-all" style={{ fontSize: 14, color: 'var(--alice-muted)' }}>
                      {truncateMiddle(info.address, 18, 12, 34)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </PixelCard>
      )}

      {exists && view === 'send' && snapshot && (
        <SendFlow
          snapshot={snapshot}
          onDone={() => {
            setView('home');
            void refresh();
          }}
          onExit={() => setView('home')}
          onPlanChange={setDraft}
          onAskAlice={(question) => onAskAlice?.(question)}
        />
      )}

      {exists && view === 'home' && (
        <>
          {/* Balance, mobile-wallet style: big pixel amount, click to change unit. */}
          <div className="flex flex-col items-center gap-1 py-2">
            <button
              className="cursor-pointer bg-transparent"
              title="Click to change the unit"
              onClick={() => cycleTestUnit(amountState)}
            >
              <TestAmount
                sats={snapshot?.balanceSats ?? 0}
                state={amountState}
                fontSize={30}
                color="var(--alice-primary-dark)"
              />
            </button>
            {snapshot !== null && snapshot.pendingSats > 0 && (
              <span className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-muted)' }}>
                +{formatTestSats(snapshot.pendingSats)} INCOMING
              </span>
            )}
            <button
              className="font-pixel tracking-widest cursor-pointer mt-1 opacity-60 hover:opacity-100"
              style={{ fontSize: 8, color: 'var(--alice-muted)' }}
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? 'CHECKING MUTINYNET…' : 'REFRESH'}
            </button>
          </div>

          {/* The three actions, corner-bracket style like the mobile wallet. */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <CornerButton
              label="SEND"
              disabled={!snapshot || snapshot.utxos.length === 0}
              onClick={() => setView('send')}
            />
            <CornerButton
              label="RECEIVE"
              onClick={() => setView('receive')}
            />
            {!faucetClaimed && (
              <CornerButton label="FREE SATS" onClick={() => setFaucet({ stage: 'confirm' })} />
            )}
          </div>

          {/* The mobile wallet's backup banner, verbatim: red, insistent,
              gone once the ritual is done. */}
          {!backedUp && (
            <button
              onClick={() => setView('backup')}
              className="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer text-left"
              style={{
                backgroundColor: '#ff000012',
                border: '1px solid #ff0000',
                borderRadius: 2,
              }}
            >
              <span className="font-numbers" style={{ fontSize: 13, lineHeight: '17px', color: '#ff0000' }}>
                Protect your test sats with your 12 recovery words.
              </span>
              <span className="font-pixel shrink-0" style={{ fontSize: 6, letterSpacing: 1, color: '#ff0000' }}>
                BACK UP YOUR WALLET NOW →
              </span>
            </button>
          )}

          {faucet && (
            /* The mobile wallet's confirm modal: centred card over a
               translucent navy backdrop, dismissed by the backdrop or CANCEL. */
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ backgroundColor: 'rgba(48, 74, 112, 0.48)' }}
              onClick={() => { if (faucet.stage !== 'busy') setFaucet(null); }}
              role="dialog"
              aria-modal="true"
              aria-label="Free test sats"
            >
              <div
                className="flex flex-col gap-4 w-full p-5"
                style={{
                  maxWidth: 420,
                  border: '2px solid var(--alice-border)',
                  borderRadius: 2,
                  backgroundColor: 'var(--alice-bg)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {faucet.stage === 'confirm' && (
                  <>
                    <div
                      className="font-pixel tracking-widest text-center"
                      style={{ fontSize: 12, color: 'var(--alice-primary-dark)' }}
                    >
                      FREE TEST SATS
                    </div>
                    <div className="flex items-center justify-center">
                      <TestAmount
                        sats={2100}
                        state={amountState}
                        fontSize={30}
                        color="var(--alice-primary-dark)"
                      />
                    </div>
                    <p
                      className="font-numbers text-center"
                      style={{ fontSize: 15, lineHeight: '22px', color: 'var(--alice-muted)' }}
                    >
                      Alice sends these straight to your Playground wallet, once. Enough to practice a
                      few payments and watch the change come back to you.
                    </p>
                    <div className="flex gap-3">
                      <PrimaryButton label="CANCEL" onClick={() => setFaucet(null)} />
                      <PrimaryButton label="RECEIVE" onClick={() => void confirmFaucetClaim()} />
                    </div>
                  </>
                )}

                {faucet.stage === 'busy' && (
                  <p
                    className="font-pixel tracking-widest text-center py-6"
                    style={{ fontSize: 10, color: 'var(--alice-muted)' }}
                  >
                    ASKING THE FAUCET...
                  </p>
                )}

                {faucet.stage === 'sent' && (
                  <>
                    <div
                      className="font-pixel tracking-widest text-center"
                      style={{ fontSize: 12, color: 'var(--alice-primary-dark)' }}
                    >
                      ON THE WAY
                    </div>
                    <div className="flex items-center justify-center">
                      <TestAmount
                        sats={faucet.sats}
                        state={amountState}
                        signed
                        fontSize={30}
                        color="var(--alice-primary-dark)"
                      />
                    </div>
                    <p
                      className="font-numbers text-center"
                      style={{ fontSize: 15, lineHeight: '22px', color: 'var(--alice-muted)' }}
                    >
                      They land with the next block, within about 30 seconds.
                    </p>
                    <button
                      className="font-pixel tracking-wider text-center cursor-pointer bg-transparent"
                      style={{ fontSize: 9, color: 'var(--alice-primary)' }}
                      onClick={() => openPlaygroundTxInExplorer(faucet.txid, (path) => router.push(path), 'Free test sats')}
                    >
                      OPEN IN THE EXPLORER →
                    </button>
                    <PrimaryButton label="DONE" onClick={() => { setFaucet(null); void refresh(); }} />
                  </>
                )}

                {faucet.stage === 'fallback' && (
                  <>
                    <div
                      className="font-pixel tracking-widest text-center"
                      style={{ fontSize: 12, color: 'var(--alice-primary-dark)' }}
                    >
                      FREE TEST SATS
                    </div>
                    <p
                      className="font-numbers text-center"
                      style={{ fontSize: 15, lineHeight: '22px', color: 'var(--alice-muted)' }}
                    >
                      {faucet.message ?? 'Alice cannot hand out test sats right now.'} You can still
                      claim by hand: your address gets copied, paste it on the faucet page.
                    </p>
                    <div className="flex gap-3">
                      <PrimaryButton label="CLOSE" onClick={() => setFaucet(null)} />
                      <PrimaryButton
                        label="OPEN THE FAUCET"
                        onClick={() => void openFaucetManually(faucet.address, faucet.faucetUrl)}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Balance over time, in the selected unit. */}
          {balancePoints.length >= 2 && (
            <PixelCard>
              <div className="p-3">
                <ExplorerBalanceChart points={balancePoints} partial={false} noFiat />
              </div>
            </PixelCard>
          )}

          {/* Full history, inline on the same page. */}
          <div className="flex flex-col">
            {snapshot === null || snapshot.history.length === 0 ? (
              <EmptyState
                title="No transactions yet"
                hint="Grab free test sats from the faucet to make your first one."
              />
            ) : (
              snapshot.history.map((entry) => (
                <button
                  key={entry.txid}
                  onClick={() => openPlaygroundTxInExplorer(
                    entry.txid,
                    (path) => router.push(path),
                    entry.direction === 'incoming' ? 'Test sats received' : 'Test sats sent',
                  )}
                  className="flex w-full items-center gap-3 py-3 text-left cursor-pointer hover:opacity-80"
                  style={{ borderTop: '1px dotted var(--alice-border)' }}
                >
                  <span
                    className="font-pixel"
                    style={{ width: 20, fontSize: 12, textAlign: 'center', color: 'var(--alice-primary)' }}
                  >
                    {entry.direction === 'incoming' ? '↓' : '↑'}
                  </span>
                  <span className="flex flex-col flex-1 min-w-0">
                    <span className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-primary-dark)' }}>
                      {entry.direction === 'incoming' ? 'RECEIVED' : 'SENT'}
                      {entry.confirmed ? '' : ' · PENDING'}
                    </span>
                    <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
                      {entry.blockTime
                        ? new Date(entry.blockTime * 1000).toLocaleString()
                        : 'Waiting for a block confirmation'}
                    </span>
                  </span>
                  <TestAmount
                    sats={entry.direction === 'incoming' ? entry.amountSats : -entry.amountSats}
                    state={amountState}
                    signed
                    fontSize={9}
                    color={entry.direction === 'incoming' ? 'var(--alice-primary-dark)' : 'var(--alice-muted)'}
                  />
                </button>
              ))
            )}
          </div>
        </>
      )}

    </div>
  );
}

type PlaygroundAskState = {
  view: View;
  snapshot: PlaygroundSnapshot | null;
  exists: boolean;
  draft: PracticeTxPlan | null;
};

// Open/closed is a per-section choice; the WIDTH is Alice's place and is
// shared with Explorer and Learn through lib/ask-width.
const ASK_OPEN_KEY = 'alice.playground.ask-open';
const LEGACY_ASK_OPEN_KEY = 'alice.test-wallet.ask-open';

export function PlaygroundPanel() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askWidth, setAskWidth] = useState(ASK_WIDTH_DEFAULT);
  const [walletState, setWalletState] = useState<PlaygroundAskState>({
    view: 'home',
    snapshot: null,
    exists: false,
    draft: null,
  });
  const onStateChange = useCallback((state: PlaygroundAskState) => setWalletState(state), []);
  const { setInput } = useChat();
  // Opening Alice from the send screen arrives with the question already
  // written: the point is an answer about THIS transaction, one keystroke
  // away, not an empty composer the user has to fill in themselves.
  const askAliceWith = useCallback((question: string) => {
    setInput(question);
    setAskOpen(true);
  }, [setInput]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ASK_OPEN_KEY)
        ?? window.localStorage.getItem(LEGACY_ASK_OPEN_KEY);
      setAskOpen(stored === 'true');
    } catch { /* defaults */ }
    setAskWidth(loadAskWidth());
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(ASK_OPEN_KEY, String(askOpen)); } catch { /* best effort */ }
  }, [askOpen]);
  useEffect(() => {
    saveAskWidth(askWidth);
  }, [askWidth]);

  // Drag the panel's left edge to resize it (desktop only).
  function startAskResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = askWidth;
    const move = (ev: PointerEvent) => {
      setAskWidth(clampAskWidth(startW - (ev.clientX - startX)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Ask-Alice context, following the Explorer contract: de-identified counts
  // by default, the full page (addresses, coins, transactions) only in the
  // explicit identified mode. The recovery phrase never rides along.
  const askSignals = useMemo(
    () => buildPlaygroundSignals(walletState.snapshot, walletState.draft),
    [walletState.snapshot, walletState.draft],
  );
  const askFullContext = useMemo(
    () => buildPlaygroundFullContext(walletState.view, walletState.snapshot, walletState.draft),
    [walletState.view, walletState.snapshot, walletState.draft],
  );

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
              <SvgIcon svg={SIDEBAR_ICON_SVG} size={18} color="var(--alice-primary)" />
            </button>
          </div>
          <div className="flex min-w-0 items-center justify-center">
            <span className="font-pixel" style={{ fontSize: 11, color: 'var(--alice-text)' }}>
              Playground
            </span>
          </div>
          <div />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <PlaygroundWorkspace onStateChange={onStateChange} onAskAlice={askAliceWith} />
        </div>
      </div>

      {/* Alice, docked exactly like in the Explorer: a real layout column on
          md and up (the wallet shrinks to the remaining space), an overlay
          below md, and the bubble reopens it when closed. */}
      {walletState.exists && (askOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setAskOpen(false)}
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
          />
          <div
            className="fixed inset-y-0 right-0 z-50 flex md:relative md:z-auto md:shrink-0 w-[min(420px,100vw)] md:w-[var(--ask-w,420px)]"
            style={{
              ['--ask-w' as string]: `${askWidth}px`,
              borderLeft: '1px solid var(--alice-border)',
              backgroundColor: 'var(--alice-bg)',
            } as React.CSSProperties}
          >
            <div
              onPointerDown={startAskResize}
              className="hidden md:block absolute left-0 inset-y-0 z-10"
              style={{ width: 5, cursor: 'col-resize' }}
              aria-hidden="true"
            />
            <AskAliceDock
              signals={askSignals}
              fullContext={askFullContext}
              contextId={`test-wallet:${walletState.view}`}
              contextLabel={playgroundPageName(walletState.view)}
              pageNote={`The user is on ${playgroundPageName(walletState.view)} of the Playground, Alice's Mutinynet practice environment whose coins have no real value.`}
              defaultQuestions={
                walletState.draft
                  ? [
                    'Why does this transaction spend a coin bigger than what I am sending?',
                    'Where does my change go, and is that safe?',
                    'Why is the fee what it is here?',
                  ]
                  : [
                    'What is a UTXO exactly?',
                    'Why do Bitcoin fees depend on size, not amount?',
                    'How does a signature prove the coins are mine?',
                  ]
              }
              onClose={() => setAskOpen(false)}
            />
          </div>
        </>
      ) : (
        <AskAliceFab onOpen={() => setAskOpen(true)} />
      ))}
    </div>
  );
}
