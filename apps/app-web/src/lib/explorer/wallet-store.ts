// Saved wallets for the Home page's at-a-glance cards. Only the pasted public
// input (an extended *public* key or a descriptor) is stored, never private
// material, alongside a cached balance snapshot so a card can render instantly
// without re-scanning. Persisted in localStorage, client-only.
//
// An xpub does reveal every address of a wallet, so this is still sensitive:
// it lives only on the user's device, like the rest of Explorer's state.

const KEY = 'alice_explorer_wallets';

/** A cached headline of the last scan, for the card. */
export type WalletSnapshot = {
  balanceSats: number;
  usedCount: number;
  txTotal: number;
  scannedAt: number;
  /** A downsampled balance-over-time series for the card sparkline (sats). */
  sparkline?: number[];
  /** Block time of the wallet's most recent confirmed transaction (seconds). */
  lastMovementAt?: number;
  /** Signed net effect of that transaction on the wallet, in sats. */
  lastMovementSats?: number;
};

/** A saved item is either a whole wallet (xpub / descriptor) or a single
 *  watched address. Both show a balance card; they open different views. */
export type SavedKind = 'wallet' | 'address';

export type SavedWallet = {
  id: string;
  label: string;
  /** The raw pasted extended key, descriptor, or address; re-parsed on open. */
  input: string;
  /** What `input` is. Absent in older stored entries, treated as 'wallet'. */
  kind: SavedKind;
  networkId: string;
  addedAt: number;
  snapshot?: WalletSnapshot;
};

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isSavedWallet(v: unknown): v is Omit<SavedWallet, 'kind'> & { kind?: unknown } {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Record<string, unknown>;
  return typeof w.id === 'string'
    && typeof w.label === 'string'
    && typeof w.input === 'string'
    && typeof w.networkId === 'string'
    && typeof w.addedAt === 'number';
}

/** Every saved item, oldest first. Tolerant of a corrupt store (returns []).
 *  Older entries without a `kind` are read as whole wallets. */
export function loadWallets(): SavedWallet[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedWallet).map(w => ({
      ...w,
      kind: w.kind === 'address' ? 'address' : 'wallet',
    }));
  } catch {
    return [];
  }
}

function persist(wallets: SavedWallet[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(wallets));
}

/** Add a wallet or address (deduping on input+network), returning the full list. */
export function addWallet(
  label: string,
  input: string,
  networkId: string,
  kind: SavedKind = 'wallet',
): SavedWallet[] {
  const wallets = loadWallets();
  const existing = wallets.find(w => w.input === input.trim() && w.networkId === networkId);
  if (existing) {
    if (label.trim()) existing.label = label.trim();
    persist(wallets);
    return wallets;
  }
  wallets.push({
    id: newId(),
    label: label.trim() || (kind === 'address' ? 'Address' : 'Wallet'),
    input: input.trim(),
    kind,
    networkId,
    addedAt: Date.now(),
  });
  persist(wallets);
  return wallets;
}

export function removeWallet(id: string): SavedWallet[] {
  const wallets = loadWallets().filter(w => w.id !== id);
  persist(wallets);
  return wallets;
}

export function renameWallet(id: string, label: string): SavedWallet[] {
  const wallets = loadWallets();
  const w = wallets.find(x => x.id === id);
  if (w && label.trim()) { w.label = label.trim(); persist(wallets); }
  return wallets;
}

/** Store the latest scan headline against a wallet, for its card. MERGES into
 *  the existing snapshot: a caller that only refreshed the balance never wipes
 *  a previously cached sparkline or last-movement date. */
export function updateSnapshot(id: string, snapshot: WalletSnapshot): SavedWallet[] {
  const wallets = loadWallets();
  const w = wallets.find(x => x.id === id);
  if (w) { w.snapshot = { ...w.snapshot, ...snapshot }; persist(wallets); }
  return wallets;
}

export function getWallet(id: string): SavedWallet | undefined {
  return loadWallets().find(w => w.id === id);
}
