'use client';

/**
 * Browser-side controller for the /playground page.
 *
 * The Playground is a pure on-chain Mutinynet practice wallet, fully
 * separate from any real wallet: its keys live in this app's localStorage
 * (sats on Mutinynet are valueless, so local protection is deliberately
 * light), and the public Mutinynet explorer is its only backend. This file
 * is the only bridge between the app and @alice-wallet/practice-wallet.
 */

import {
  PracticeEsploraClient,
  PracticeKeyring,
  PracticeWalletStore,
  PRACTICE_EXPLORER_URL,
  PRACTICE_FAUCET_URL,
  generatePracticeMnemonic,
  planPracticeTransaction,
  reviewPracticeTransaction,
  signPracticeTransaction,
  summarizePracticeHistory,
  type EsploraAddressTx,
  type PracticeHistoryEntry,
  type PracticeStorageBackend,
  type PracticeTxPlan,
  type PracticeTxReview,
  type PracticeUtxo,
} from '@alice-wallet/practice-wallet';

// Pre-rename prefix, kept so practice wallets created before the Playground
// rename keep working. Do not change without a data migration.
const STORAGE_PREFIX = 'alice.test-wallet.';
const MNEMONIC_KEY = `${STORAGE_PREFIX}mnemonic`;

// Bounds the address scan if state ever grows unchecked.
const MAX_ADDRESSES_PER_CHAIN = 50;

function browserBackend(): PracticeStorageBackend {
  const storage = () => {
    if (typeof window === 'undefined') {
      throw new Error('The Playground is only available in the browser.');
    }
    return window.localStorage;
  };
  return {
    getSecret: async () => storage().getItem(MNEMONIC_KEY),
    setSecret: async (value) => storage().setItem(MNEMONIC_KEY, value),
    removeSecret: async () => storage().removeItem(MNEMONIC_KEY),
    getValue: async (key) => storage().getItem(`${STORAGE_PREFIX}${key}`),
    setValue: async (key, value) => storage().setItem(`${STORAGE_PREFIX}${key}`, value),
    removeValue: async (key) => storage().removeItem(`${STORAGE_PREFIX}${key}`),
  };
}

let storeSingleton: PracticeWalletStore | null = null;
let clientSingleton: PracticeEsploraClient | null = null;

function getStore(): PracticeWalletStore {
  if (!storeSingleton) storeSingleton = new PracticeWalletStore(browserBackend());
  return storeSingleton;
}

function getClient(): PracticeEsploraClient {
  if (!clientSingleton) clientSingleton = new PracticeEsploraClient();
  return clientSingleton;
}

export async function hasPlayground(): Promise<boolean> {
  return getStore().hasWallet();
}

export async function createPlaygroundIfNeeded(): Promise<{ created: boolean }> {
  const { created } = await getStore().ensureWallet(generatePracticeMnemonic);
  return { created };
}

export async function deletePlayground(): Promise<void> {
  await getStore().clear();
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(`${STORAGE_PREFIX}backed-up`);
    window.localStorage.removeItem(`${STORAGE_PREFIX}faucet-claimed`);
    window.localStorage.removeItem(`${STORAGE_PREFIX}snapshot.v1`);
  }
}

/** The 12 recovery words, for the backup lesson. */
export async function getPlaygroundMnemonicWords(): Promise<string[]> {
  const mnemonic = await getStore().loadMnemonic();
  if (!mnemonic) throw new Error('No Playground wallet exists yet in this browser.');
  return mnemonic.trim().split(/\s+/);
}

// Backup ritual state, mirroring the mobile wallet's banner: shown until the
// user confirms having written the words down.
const BACKED_UP_KEY = `${STORAGE_PREFIX}backed-up`;

export async function isPlaygroundBackedUp(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(BACKED_UP_KEY) === 'true';
}

export async function markPlaygroundBackedUp(): Promise<void> {
  window.localStorage.setItem(BACKED_UP_KEY, 'true');
}

/**
 * The watch-only account key of the practice wallet, or null when none exists.
 *
 * This is what lets the Explorer show the practice wallet as one of its
 * cards: the xpub can list addresses and balances but signs nothing, so the
 * bridge between the two screens carries no spending power with it.
 */
export async function getPlaygroundAccountXpub(): Promise<string | null> {
  const mnemonic = await getStore().loadMnemonic();
  if (!mnemonic) return null;
  return new PracticeKeyring(mnemonic).accountXpub();
}

async function getKeyring(): Promise<PracticeKeyring> {
  const mnemonic = await getStore().loadMnemonic();
  if (!mnemonic) throw new Error('No Playground wallet exists yet in this browser.');
  return new PracticeKeyring(mnemonic);
}

export type PlaygroundAddressInfo = {
  address: string;
  index: number;
  change: boolean;
  used: boolean;
  balanceSats: number;
};

export type PlaygroundSnapshot = {
  balanceSats: number;
  pendingSats: number;
  utxos: PracticeUtxo[];
  history: PracticeHistoryEntry[];
  receiveAddress: string;
  /** Where change would come back, so a draft can be planned without I/O. */
  changeAddress: string;
  addresses: PlaygroundAddressInfo[];
};

// The last snapshot, kept so reopening the wallet shows balance and history
// at once instead of an empty screen while the explorer is queried. It is a
// cache, never a source of truth: a refresh always follows and overwrites it,
// and it holds nothing the wallet's own keys do not already hold locally.
const SNAPSHOT_KEY = `${STORAGE_PREFIX}snapshot.v1`;

export function readCachedPlaygroundSnapshot(): PlaygroundSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlaygroundSnapshot>;
    if (
      typeof parsed.balanceSats !== 'number'
      || typeof parsed.receiveAddress !== 'string'
      || !Array.isArray(parsed.utxos)
      || !Array.isArray(parsed.history)
      || !Array.isArray(parsed.addresses)
    ) return null;
    return parsed as PlaygroundSnapshot;
  } catch {
    return null;
  }
}

function cachePlaygroundSnapshot(snapshot: PlaygroundSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // A full quota only costs the instant-open shortcut.
  }
}

export async function loadPlaygroundSnapshot(): Promise<PlaygroundSnapshot> {
  const store = getStore();
  const client = getClient();
  const keyring = await getKeyring();
  let indexes = await store.getAddressIndexes();

  const scanOne = async (change: boolean, index: number) => {
    const info = keyring.addressAt(change, index);
    return {
      info,
      utxos: await client.getAddressUtxos(info.address),
      txs: await client.getAddressTxs(info.address),
    };
  };
  const scan = (change: boolean, count: number) =>
    Promise.all(
      Array.from({ length: Math.min(count, MAX_ADDRESSES_PER_CHAIN) }, (_, index) =>
        scanOne(change, index),
      ),
    );

  let external = await scan(false, indexes.external);
  const change = await scan(true, indexes.change);

  // Keep the receive address fresh: if the newest external address has been
  // used, move to the next one so every payment lands on its own address.
  while (
    external[external.length - 1].txs.length > 0 &&
    indexes.external < MAX_ADDRESSES_PER_CHAIN
  ) {
    indexes = { ...indexes, external: indexes.external + 1 };
    external = [...external, await scanOne(false, indexes.external - 1)];
  }
  await store.setAddressIndexes(indexes);

  const scanned = [...external, ...change];
  const owned = new Set(scanned.map((entry) => entry.info.address));
  const utxos: PracticeUtxo[] = scanned.flatMap((entry) =>
    entry.utxos.map((utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      valueSats: utxo.valueSats,
      address: entry.info.address,
      change: entry.info.change,
      index: entry.info.index,
      confirmed: utxo.confirmed,
    })),
  );

  const allTxs: EsploraAddressTx[] = scanned.flatMap((entry) => entry.txs);
  const history = summarizePracticeHistory(allTxs, owned).sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1;
    return (b.blockTime ?? 0) - (a.blockTime ?? 0);
  });

  const addresses: PlaygroundAddressInfo[] = scanned.map((entry) => ({
    address: entry.info.address,
    index: entry.info.index,
    change: entry.info.change,
    used: entry.txs.length > 0,
    balanceSats: entry.utxos.reduce((sum, utxo) => sum + utxo.valueSats, 0),
  }));

  const snapshot: PlaygroundSnapshot = {
    balanceSats: utxos.filter((u) => u.confirmed).reduce((sum, u) => sum + u.valueSats, 0),
    pendingSats: utxos.filter((u) => !u.confirmed).reduce((sum, u) => sum + u.valueSats, 0),
    utxos,
    history,
    receiveAddress: external[external.length - 1].info.address,
    changeAddress: keyring.addressAt(true, indexes.change).address,
    addresses,
  };
  cachePlaygroundSnapshot(snapshot);
  return snapshot;
}

export async function getPlaygroundReceiveAddress(): Promise<string> {
  const keyring = await getKeyring();
  const indexes = await getStore().getAddressIndexes();
  return keyring.addressAt(false, indexes.external - 1).address;
}

export async function rotatePlaygroundReceiveAddress(): Promise<string> {
  const store = getStore();
  const keyring = await getKeyring();
  const indexes = await store.getAddressIndexes();
  if (indexes.external >= MAX_ADDRESSES_PER_CHAIN) {
    return keyring.addressAt(false, indexes.external - 1).address;
  }
  const next = { ...indexes, external: indexes.external + 1 };
  await store.setAddressIndexes(next);
  return keyring.addressAt(false, next.external - 1).address;
}

function proxyBaseUrl(): string | null {
  const configured = (process.env.EXPO_PUBLIC_VENICE_PROXY_URL ?? '').trim();
  if (!configured) return null;
  return configured.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
}

// Alice hands out her test sats once per wallet; the public faucet stays
// available from the settings for anyone who wants more.
const FAUCET_CLAIMED_KEY = `${STORAGE_PREFIX}faucet-claimed`;

export async function hasClaimedPlaygroundFaucet(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(FAUCET_CLAIMED_KEY) === 'true';
}

export type PlaygroundFaucetClaim =
  | { kind: 'sent'; txid: string; sats: number }
  | { kind: 'error'; message: string; address: string; faucetUrl: string }
  | { kind: 'manual'; address: string; faucetUrl: string };

/**
 * One-click faucet claim through Alice's relay (the Mutinynet faucet blocks
 * browser origins, so the Worker forwards the claim with a small fixed
 * amount and daily caps). Without a configured relay, or when the relay
 * cannot serve, the flow degrades to the manual faucet page.
 */
export async function claimPlaygroundFaucet(): Promise<PlaygroundFaucetClaim> {
  const address = await getPlaygroundReceiveAddress();
  const base = proxyBaseUrl();
  if (!base) return { kind: 'manual', address, faucetUrl: PRACTICE_FAUCET_URL };
  // Who is claiming: Alice's installation identifier, the same one the rest
  // of the app already sends. It lives in this browser, survives an IP change,
  // and lets the faucet keep its one-per-learner rule without the server ever
  // needing to know anything about the person. The wallet's own identity (its
  // first receive address, stable across address rotation) rides along as a
  // fallback for clients that have no installation id.
  const { getInstallId } = await import('@alice-wallet/alice-ai');
  const [installId, keyring] = await Promise.all([getInstallId(), getKeyring()]);
  const walletId = keyring.addressAt(false, 0).address;
  try {
    // Pre-rename route name, like the storage prefix above: it is a deployed
    // contract with clients already in the wild (the Android APK, cached
    // PWAs), so it outlives the Playground rename on purpose.
    const response = await fetch(`${base}/test-wallet/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-alice-install-id': installId },
      body: JSON.stringify({ address, walletId }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { txid?: unknown; sats?: unknown; error?: { code?: unknown; message?: unknown } }
      | null;
    if (response.ok && payload && typeof payload.txid === 'string') {
      window.localStorage.setItem(FAUCET_CLAIMED_KEY, 'true');
      return { kind: 'sent', txid: payload.txid, sats: Number(payload.sats) || 0 };
    }
    // Already claimed is not a failure: it is the answer. Record it so the
    // button stops offering something this learner cannot have, even on a
    // device whose local flag was lost.
    if (payload?.error?.code === 'already_claimed') {
      window.localStorage.setItem(FAUCET_CLAIMED_KEY, 'true');
    }
    const message =
      payload && typeof payload.error?.message === 'string'
        ? payload.error.message
        : `The faucet relay failed (${response.status}).`;
    return { kind: 'error', message, address, faucetUrl: PRACTICE_FAUCET_URL };
  } catch {
    return { kind: 'manual', address, faucetUrl: PRACTICE_FAUCET_URL };
  }
}

/** The network's recommended fee rate, fetched once per send screen. */
export async function playgroundFeeRate(): Promise<number> {
  return getClient().recommendedFeeRate(2);
}

/**
 * Plans a payment without touching the network, so the send screen can show
 * the transaction being built on every keystroke. Throws with a readable
 * message when the payment cannot be built at all.
 */
export function planPlaygroundSend(params: {
  utxos: PracticeUtxo[];
  recipientAddress: string;
  amountSats: number;
  feeRateSatVb: number;
  changeAddress: string;
}): PracticeTxPlan {
  return planPracticeTransaction(params);
}

export type PlaygroundSendPreparation = {
  plan: PracticeTxPlan;
  feeRateSatVb: number;
};

export async function preparePlaygroundSend(params: {
  utxos: PracticeUtxo[];
  recipientAddress: string;
  amountSats: number;
}): Promise<PlaygroundSendPreparation> {
  const store = getStore();
  const keyring = await getKeyring();
  const feeRateSatVb = await getClient().recommendedFeeRate(2);
  const indexes = await store.getAddressIndexes();
  const changeAddress = keyring.addressAt(true, indexes.change).address;
  const plan = planPracticeTransaction({
    utxos: params.utxos,
    recipientAddress: params.recipientAddress,
    amountSats: params.amountSats,
    feeRateSatVb,
    changeAddress,
  });
  return { plan, feeRateSatVb };
}

export type PlaygroundSignedSend = {
  txHex: string;
  txid: string;
  review: PracticeTxReview;
};

export async function signPlaygroundSend(plan: PracticeTxPlan): Promise<PlaygroundSignedSend> {
  const keyring = await getKeyring();
  const signed = signPracticeTransaction(plan, keyring);
  const review = reviewPracticeTransaction(signed.txHex, plan);
  return { txHex: signed.txHex, txid: signed.txid, review };
}

export async function broadcastPlaygroundSend(
  signed: PlaygroundSignedSend,
  plan: PracticeTxPlan,
): Promise<string> {
  if (!signed.review.matchesPlan) {
    throw new Error(
      `This transaction failed verification and was not sent: ${signed.review.issues.join(' ')}`,
    );
  }
  const txid = await getClient().broadcastTx(signed.txHex);
  if (plan.changeSats > 0) {
    const store = getStore();
    const indexes = await store.getAddressIndexes();
    if (indexes.change < MAX_ADDRESSES_PER_CHAIN) {
      await store.setAddressIndexes({ ...indexes, change: indexes.change + 1 });
    }
  }
  return txid;
}

/** Kept for anything that genuinely needs the public explorer's URL. */
export function playgroundPublicExplorerTxUrl(txid: string): string {
  return `${PRACTICE_EXPLORER_URL}/tx/${txid}`;
}

/** Mobile wallet convention: thousands grouped with spaces, never commas. */
export function formatTestSats(sats: number): string {
  return `${sats.toLocaleString('en-US').replace(/,/g, ' ')} SATS`;
}

/** Mobile truncation rules: head + '...' + tail past a threshold. */
export function truncateMiddle(value: string, head: number, tail: number, threshold: number): string {
  return value.length > threshold ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;
}

/** BIP21 payment URI, amount in BTC with trailing zeros trimmed. */
export function playgroundPaymentUri(address: string, amountSats: number | null): string {
  if (!amountSats || amountSats <= 0) return `bitcoin:${address}`;
  const btc = (amountSats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return `bitcoin:${address}?amount=${btc}`;
}
