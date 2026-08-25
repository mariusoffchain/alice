import { Platform } from 'react-native';
import type {
  WalletBackend,
  Balance,
  EmergencyExitState,
  Transaction,
  VtxoAutomationStatus,
  VtxoInfo,
  VtxoMaintenanceResult,
  VtxoOperationResult,
  VtxoSyncResult,
} from './wallet-backend';
import { addDiagnosticLog } from './diagnostic-log';
import { clearLocalSwapRepository, clearLocalWalletRepository } from './wallet-data';
import { seedGeneration } from './seed-generation';
import { createBackendSlot, WalletReplacedError } from './backend-slot';

export { WalletReplacedError };
import { isRecoveryScanPending } from './storage';
import type {
  ParsedPaymentRequest,
  PaymentQuote,
  PaymentRecord,
  ReceivePaymentRequest,
  ReceivePaymentResponse,
} from './payment-types';
import type { ReceiveAddressRecord } from './wallet-state-storage';
import { getUnsafeResetPayments, pendingResetWarning } from './reset-wallet-safety';
import { NETWORK } from './network-config';
import {
  closeArkadeBackgroundDatabase,
  unregisterArkadeBackgroundSync,
} from './background-lifecycle';
import {
  isDelegateRenewalEnabled,
  saveDelegateRenewalEnabled,
} from './delegate-settings';

export type { Balance, Transaction, VtxoInfo };

export type WalletState = {
  address: string;
  balance: number;
  offchainBalance: number;
  frozenBalance: number;
  onchainBalance: number;
};

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

let maintenancePromise: Promise<VtxoMaintenanceResult> | null = null;
let syncPromise: Promise<VtxoSyncResult> | null = null;
let paymentRefreshPromise: Promise<void> | null = null;
let transactionHistoryPromise: Promise<Transaction[]> | null = null;
let transactionHistoryCache: Transaction[] | null = null;
let lastMaintenanceStartedAt = 0;
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1_000;
const WALLET_REFRESH_TIMEOUT_MS = 8_000;

const slot = createBackendSlot<WalletBackend>({
  create: async () => Platform.OS === 'web'
    ? new (await import('./arkade-web-backend')).ArkadeWebBackend()
    : new (await import('./arkade-backend')).ArkadeBackend(),
  generation: seedGeneration,
  initTimeoutMs: 15_000,
  initTimeoutMessage: `Connection to ${NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet'} timed out. Check your internet connection.`,
  isTransient: isTransientConnectionError,
  log: (level, title, detail) => { void addDiagnosticLog(level, title, detail).catch(() => {}); },
});

export function getConnectionStatus(): { status: ConnectionStatus; error: string | null } {
  return { status: slot.status(), error: slot.error() };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

function isTransientConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /fetch|network|timeout|timed out|abort|unreachable|socket|connection/i.test(message);
}

export { isHdDescriptorMismatchError } from './wallet-index-recovery';

function runMaintenance(
  walletBackend: WalletBackend,
  force = false,
): Promise<VtxoMaintenanceResult | null> {
  if (maintenancePromise) return maintenancePromise;
  if (!force && Date.now() - lastMaintenanceStartedAt < MAINTENANCE_INTERVAL_MS) {
    return Promise.resolve(null);
  }
  lastMaintenanceStartedAt = Date.now();
  maintenancePromise = walletBackend.maintainVtxos().finally(() => {
    maintenancePromise = null;
  });
  return maintenancePromise;
}

function ensureBackend(): Promise<WalletBackend> {
  return slot.ensure();
}

export async function initWallet(): Promise<WalletState> {
  const walletBackend = await ensureBackend();
  return readWalletState(walletBackend);
}

async function readWalletState(walletBackend: WalletBackend): Promise<WalletState> {
  const balance = await walletBackend.getBalance();
  const address = await walletBackend.getAddress();
  return {
    address,
    balance: balance.total,
    offchainBalance: balance.available,
    frozenBalance: balance.frozen,
    onchainBalance: balance.boarding,
  };
}

export async function getBalance(): Promise<WalletState> {
  const walletBackend = await ensureBackend();
  return withTimeout(
    readWalletState(walletBackend),
    WALLET_REFRESH_TIMEOUT_MS,
    'Wallet balance refresh timed out.',
  );
}

export async function getReceiveAddress(): Promise<string> {
  return (await ensureBackend()).getBoardingAddress();
}

export async function getArkAddress(): Promise<string> {
  return (await ensureBackend()).getAddress();
}

export async function sendSats(address: string, amountSats: number): Promise<string> {
  return (await ensureBackend()).send(address, amountSats);
}

function startTransactionHistoryRefresh(walletBackend: WalletBackend): Promise<Transaction[]> {
  transactionHistoryPromise ??= walletBackend.getTransactionHistory()
    .then(history => {
      transactionHistoryCache = history;
      return history;
    })
    .catch(cause => {
      if (transactionHistoryCache) return transactionHistoryCache;
      throw cause;
    })
    .finally(() => {
      transactionHistoryPromise = null;
    });
  return transactionHistoryPromise;
}

export function getCachedTransactionHistory(): Transaction[] | null {
  return transactionHistoryCache;
}

export async function getTransactionHistory(): Promise<Transaction[]> {
  const walletBackend = await ensureBackend();
  const refresh = startTransactionHistoryRefresh(walletBackend);
  if (transactionHistoryCache) return transactionHistoryCache;
  return withTimeout(
    refresh,
    WALLET_REFRESH_TIMEOUT_MS,
    'Arkade transaction history timed out.',
  );
}

export async function refreshTransactionHistory(): Promise<Transaction[]> {
  const walletBackend = await ensureBackend();
  return withTimeout(
    startTransactionHistoryRefresh(walletBackend),
    15_000,
    'Arkade transaction history refresh timed out.',
  );
}

export async function getVtxos(): Promise<VtxoInfo[]> {
  return (await ensureBackend()).getVtxos();
}

export async function restoreWallet(): Promise<void> {
  await (await ensureBackend()).restore();
}

export type RecoveryScanStatus = 'complete' | 'running' | 'incomplete';

/**
 * Where the deep recovery pass stands for the current seed. "incomplete"
 * means a pass was interrupted and funds beyond the first 20 addresses may
 * not be listed yet; the home screen says so and offers a retry.
 */
export async function getRecoveryScanStatus(): Promise<RecoveryScanStatus> {
  if (!(await isRecoveryScanPending())) return 'complete';
  return recoveryScanPromise ? 'running' : 'incomplete';
}

let recoveryScanPromise: Promise<void> | null = null;

/** Runs the deep recovery pass to completion; clears the pending flag on success. */
export function runRecoveryScan(): Promise<void> {
  if (recoveryScanPromise) return recoveryScanPromise;
  // Owned by the phrase it started for, like an initialisation: a pass that
  // outlives a seed change reports nothing to the next wallet.
  const startedFor = seedGeneration.current();
  const run = (async () => {
    await (await ensureBackend()).deepScan();
    if (seedGeneration.current() !== startedFor) throw new WalletReplacedError();
  })();
  recoveryScanPromise = run;
  void run.catch(() => {}).finally(() => {
    if (recoveryScanPromise === run) recoveryScanPromise = null;
  });
  return run;
}

/** Resumes an interrupted deep recovery pass, if any, without blocking the caller. */
export async function resumeRecoveryScanIfPending(): Promise<void> {
  if (!(await isRecoveryScanPending())) return;
  void runRecoveryScan().catch(() => {});
}

export async function setVtxoFrozen(id: string, frozen: boolean): Promise<void> {
  await (await ensureBackend()).setVtxoFrozen(id, frozen);
}

export async function listReceiveAddresses(): Promise<ReceiveAddressRecord[]> {
  return (await ensureBackend()).listReceiveAddresses();
}

export async function reserveArkadeReceiveAddress(): Promise<string> {
  return (await ensureBackend()).reserveArkadeReceiveAddress();
}

export async function reserveOnchainReceiveAddress(): Promise<string> {
  return (await ensureBackend()).reserveOnchainReceiveAddress();
}

export async function reserveUnifiedReceiveAddresses(): Promise<{
  arkade: string;
  onchain: string;
}> {
  return (await ensureBackend()).reserveUnifiedReceiveAddresses();
}

export async function updateReceiveAddress(
  address: string,
  patch: Partial<Pick<ReceiveAddressRecord, 'label' | 'shared' | 'used' | 'archived'>>,
): Promise<ReceiveAddressRecord> {
  return (await ensureBackend()).updateReceiveAddress(address, patch);
}

export async function syncVtxos(ids?: string[]): Promise<VtxoSyncResult> {
  return (await ensureBackend()).syncVtxos(ids);
}

export async function syncVtxosIfReady(): Promise<VtxoSyncResult | null> {
  const walletBackend = await ensureBackend();
  syncPromise ??= walletBackend.syncVtxos().finally(() => {
    syncPromise = null;
  });
  return withTimeout(
    syncPromise,
    WALLET_REFRESH_TIMEOUT_MS,
    'Arkade synchronization timed out.',
  );
}

export async function maintainVtxosIfReady(): Promise<VtxoMaintenanceResult | null> {
  const backend = slot.current();
  if (!backend || seedGeneration.stale()) return null;
  return runMaintenance(backend);
}

export async function renewVtxos(ids: string[]): Promise<VtxoOperationResult> {
  return (await ensureBackend()).renewVtxos(ids);
}

export async function recoverVtxos(ids: string[]): Promise<VtxoOperationResult> {
  return (await ensureBackend()).recoverVtxos(ids);
}

export async function retryExcludedVtxo(id: string): Promise<VtxoSyncResult> {
  return (await ensureBackend()).retryExcludedVtxo(id);
}

export async function getVtxoAutomationStatus(): Promise<VtxoAutomationStatus> {
  return (await ensureBackend()).getVtxoAutomationStatus();
}

async function restartBackend(): Promise<void> {
  await maintenancePromise?.catch(() => {});
  maintenancePromise = null;
  syncPromise = null;
  paymentRefreshPromise = null;
  transactionHistoryPromise = null;
  transactionHistoryCache = null;
  lastMaintenanceStartedAt = 0;
  await slot.restart();
}

/**
 * Forgets the wallet currently loaded in memory and on disk so that a
 * different seed can be saved. Onboarding calls this before writing a new
 * phrase: a backend already initialised with the previous seed (an import
 * whose restore failed, then "Create wallet") would otherwise keep serving
 * that previous wallet while the stored phrase, and the backup screen, say
 * something else. No network call: this must work offline.
 */
export async function discardWalletForNewSeed(): Promise<void> {
  recoveryScanPromise = null;
  await restartBackend();
  await unregisterArkadeBackgroundSync().catch(() => {});
  await closeArkadeBackgroundDatabase();
  await clearLocalWalletRepository();
  await clearLocalSwapRepository();
}

/**
 * Rebuilds only Arkade's local HD index after an initialization mismatch.
 * The recovery phrase and the separate swap recovery database are not touched.
 */
export async function rebuildLocalArkadeIndex(): Promise<WalletState> {
  await restartBackend();
  await unregisterArkadeBackgroundSync().catch(() => {});
  await closeArkadeBackgroundDatabase();
  await clearLocalWalletRepository();

  await initWallet();
  await restoreWallet();
  return getBalance();
}

export async function setDelegateRenewalEnabled(
  enabled: boolean,
): Promise<VtxoAutomationStatus> {
  const previous = await isDelegateRenewalEnabled();
  if (previous === enabled) return getVtxoAutomationStatus();

  await saveDelegateRenewalEnabled(enabled);
  await restartBackend();
  try {
    return await getVtxoAutomationStatus();
  } catch (cause) {
    await saveDelegateRenewalEnabled(previous);
    await restartBackend().catch(() => {});
    await ensureBackend().catch(() => {});
    throw cause;
  }
}

export async function getEmergencyExitState(): Promise<EmergencyExitState> {
  return withTimeout(
    ensureBackend().then(walletBackend => walletBackend.getEmergencyExitState()),
    16_000,
    'Emergency exit state could not be loaded. Check the Bitcoin connection and retry.',
  );
}

export async function prepareEmergencyExit(
  ids: string[],
  destination: string,
): Promise<EmergencyExitState> {
  return (await ensureBackend()).prepareEmergencyExit(ids, destination);
}

export async function advanceEmergencyExit(): Promise<EmergencyExitState> {
  return (await ensureBackend()).advanceEmergencyExit();
}

export async function clearEmergencyExit(): Promise<void> {
  await (await ensureBackend()).clearEmergencyExit();
}

export async function sendQuotedPayment(quote: PaymentQuote): Promise<PaymentRecord> {
  const walletBackend = await ensureBackend();
  if (quote.provider === 'arkade-native') {
    return walletBackend.sendNativeOnchain(quote);
  }
  const paymentRail = await walletBackend.getPaymentRail();
  if (!paymentRail) throw new Error('This payment rail is not available on the current platform yet.');
  return paymentRail.send(quote);
}

export async function quoteNativeOnchainPayment(
  request: ParsedPaymentRequest,
  amountSats: number,
): Promise<PaymentQuote> {
  return (await ensureBackend()).quoteNativeOnchain(request, amountSats);
}

export async function getPaymentHistory(): Promise<PaymentRecord[]> {
  const paymentRail = await (await ensureBackend()).getPaymentRail();
  if (!paymentRail) return [];
  paymentRefreshPromise ??= paymentRail.refresh().finally(() => {
    paymentRefreshPromise = null;
  });
  void withTimeout(
    paymentRefreshPromise,
    WALLET_REFRESH_TIMEOUT_MS,
    'Payment status refresh timed out.',
  ).catch(() => {});
  return withTimeout(
    paymentRail.listPayments(),
    WALLET_REFRESH_TIMEOUT_MS,
    'Payment history timed out.',
  );
}

export async function refreshPaymentHistory(): Promise<PaymentRecord[]> {
  const paymentRail = await (await ensureBackend()).getPaymentRail();
  if (!paymentRail) return [];
  paymentRefreshPromise ??= paymentRail.refresh().finally(() => {
    paymentRefreshPromise = null;
  });
  await withTimeout(
    paymentRefreshPromise,
    15_000,
    'Payment status refresh timed out.',
  );
  return withTimeout(
    paymentRail.listPayments(),
    WALLET_REFRESH_TIMEOUT_MS,
    'Payment history timed out.',
  );
}

export async function getPaymentDetails(paymentId: string): Promise<PaymentRecord | null> {
  const paymentRail = await (await ensureBackend()).getPaymentRail();
  if (!paymentRail) return null;
  await paymentRail.refresh().catch(() => {});
  return paymentRail.getPayment(paymentId);
}

export async function getSwapHistory(): Promise<PaymentRecord[]> {
  const paymentRail = await (await ensureBackend()).getPaymentRail();
  if (!paymentRail) return [];
  return withTimeout(
    paymentRail.listSwapRecords?.() ?? paymentRail.listPayments(),
    WALLET_REFRESH_TIMEOUT_MS,
    'Swap history timed out.',
  );
}

export async function refreshSwapHistory(): Promise<PaymentRecord[]> {
  const paymentRail = await (await ensureBackend()).getPaymentRail();
  if (!paymentRail) return [];
  await withTimeout(
    paymentRail.refresh(),
    15_000,
    'Swap status refresh timed out.',
  );
  return withTimeout(
    paymentRail.listSwapRecords?.() ?? paymentRail.listPayments(),
    WALLET_REFRESH_TIMEOUT_MS,
    'Swap history timed out.',
  );
}

export async function getSwapDetails(swapId: string): Promise<PaymentRecord | null> {
  return (await getSwapHistory()).find(
    record => record.swapId === swapId || record.id === swapId,
  ) ?? null;
}

export async function refundPayment(paymentId: string): Promise<PaymentRecord> {
  const paymentRail = await (await ensureBackend()).getPaymentRail();
  if (!paymentRail) throw new Error('Refunds are not available on the current platform yet.');
  return paymentRail.refund(paymentId);
}

export async function createReceivePayment(request: ReceivePaymentRequest): Promise<ReceivePaymentResponse> {
  const walletBackend = await ensureBackend();
  const prepared = request.targetArkadeAddress
    ? request
    : {
        ...request,
        targetArkadeAddress: await walletBackend.getAddress(),
      };
  const paymentRail = await walletBackend.getPaymentRail();
  if (!paymentRail) throw new Error('Receive payments are not available on the current platform yet.');
  return paymentRail.createReceiveRequest(prepared);
}

export function isWalletReady(): boolean {
  return slot.current() !== null;
}

export async function clearWalletBackendData(): Promise<void> {
  const activeBackend = await ensureBackend();
  await maintenancePromise?.catch(() => {});
  const paymentRail = await activeBackend.getPaymentRail();
  if (paymentRail) {
    await paymentRail.refresh().catch(() => {});
    const unsafePayments = getUnsafeResetPayments(await paymentRail.listPayments());
    if (unsafePayments.length > 0) {
      throw new Error(pendingResetWarning(unsafePayments.length));
    }
    await paymentRail.clear();
  }
  await activeBackend.clearLifecycleData();
  await unregisterArkadeBackgroundSync().catch(() => {});
  // dispose() can hang closing network/indexer connections (notably offline);
  // never let it block the reset.
  await Promise.race([
    activeBackend.dispose().catch(() => {}),
    new Promise<void>(resolve => setTimeout(resolve, 3000)),
  ]);
  slot.forget();
  maintenancePromise = null;
  syncPromise = null;
  paymentRefreshPromise = null;
  transactionHistoryPromise = null;
  transactionHistoryCache = null;
  lastMaintenanceStartedAt = 0;
  await clearLocalWalletRepository();
}
