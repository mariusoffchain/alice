import { ExpoWallet } from '@arkade-os/sdk/wallet/expo';
import { ExpoArkProvider, ExpoIndexerProvider } from '@arkade-os/sdk/adapters/expo';
import { AsyncStorageTaskQueue } from '@arkade-os/sdk/worker/expo';
import {
  EsploraProvider,
  MnemonicIdentity,
  RestDelegateProvider,
  TxType,
  Wallet,
  type DelegateInfo,
} from '@arkade-os/sdk';
import { SQLiteWalletRepository, SQLiteContractRepository } from '@arkade-os/sdk/repositories/sqlite';
import type { SQLExecutor } from '@arkade-os/sdk/repositories/sqlite';
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type {
  WalletBackend,
  Balance,
  EmergencyExitState,
  Transaction,
  TransactionStatus,
  TransactionLayer,
  VtxoAutomationStatus,
  VtxoInfo,
  VtxoMaintenanceResult,
  VtxoOperationResult,
  VtxoSyncResult,
} from './wallet-backend';
import { TransactionTimeCache } from './wallet-backend';
import type { PaymentRail } from './payment-rail';
import {
  BoltzNativePaymentRail,
  clearLegacyNativeBoltzState,
} from './boltz-rail.native';
import { CompositePaymentRail } from './composite-payment-rail';
import { addDiagnosticLog } from './diagnostic-log';
import { clearRecoveryScanPending, loadRecoveryScanToken, markRecoveryScanPending } from './storage';
import { isRecoverableArkadeSettlementLog } from './arkade-settlement-log';
import { purgeLegacyBoltzSwapsOnce } from './legacy-boltz-purge';
import {
  ASP_URL,
  ESPLORA_URL,
  NETWORK,
  SWAP_PROVIDER,
} from './network-config';
import { createSatoraKeyValueStore } from './satora-key-value';
import { SatoraPaymentRail } from './satora-rail';
import { NativeOnchainPayment } from './native-onchain';
import type { ParsedPaymentRequest, PaymentQuote, PaymentRecord } from './payment-types';
import { WalletStateStorage } from './wallet-state-storage';
import type { ReceiveAddressRecord } from './wallet-state-storage';
import { freezeAwareWallet, getFrozenSpendableAmount, sendBitcoinRespectingFreeze } from './frozen-vtxos';
import {
  RECEIVE_RESTORE_GAP_LIMIT, RESTORE_FIRST_PASS_GAP_LIMIT,
  ReceiveAddressController,
} from './receive-addresses';
import {
  VTXO_RENEWAL_THRESHOLD_MS,
  VtxoLifecycleController,
} from './vtxo-lifecycle';
import { EmergencyExitController } from './emergency-exit';
import { registerArkadeBackgroundSync } from './background-lifecycle';
import {
  DELEGATE_URL,
  isDelegateRenewalEnabled,
} from './delegate-settings';

const MNEMONIC_KEY = 'alice_wallet_mnemonic';

let arkadeWatcherLogFilterInstalled = false;
let lastArkadeWatcherDiagnosticAt = 0;
let lastArkadeSettlementDiagnosticAt = 0;

type ManagedSQLExecutor = SQLExecutor & {
  drain(): Promise<void>;
};

function describeLogArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name} ${arg.message}`;
  if (typeof arg === 'string') return arg;
  if (!arg || typeof arg !== 'object') return String(arg ?? '');

  const record = arg as Record<string, unknown>;
  return [
    record.name,
    record.message,
    record.type,
    record.target,
    record.defaultPrevented !== undefined ? `defaultPrevented:${String(record.defaultPrevented)}` : undefined,
    record.timeStamp !== undefined ? `timeStamp:${String(record.timeStamp)}` : undefined,
    record.timestamp !== undefined ? `timestamp:${String(record.timestamp)}` : undefined,
  ].filter(Boolean).join(' ');
}

function isWebSocketEventLike(arg: unknown): boolean {
  if (!arg || typeof arg !== 'object') return false;

  const record = arg as Record<string, unknown>;
  return (record.defaultPrevented !== undefined && (record.timeStamp !== undefined || record.timestamp !== undefined))
    || record.type === 'error';
}

function isBenignContractWatcherLog(args: unknown[]): boolean {
  const message = args
    .map(describeLogArg)
    .join(' ')
    .toLowerCase();

  return message.includes('contractwatcher connection failed')
    || message.includes('contractwatcher: max reconnection attempts')
    || message.includes('failed subscribe to script')
    || message.includes('subscription not found')
    || message.includes('subscription error')
    || message.includes('software caused connection abort')
    || message.includes('network request failed')
    || message.includes('fetch failed')
    || message.includes('eventsourceerror eventsource error')
    || (
      (message.includes('websocket') || message.includes('subscription') || message.includes('eventsource'))
      && args.some(isWebSocketEventLike)
    );
}

function recordArkadeWatcherDiagnostic(): void {
  const now = Date.now();
  if (now - lastArkadeWatcherDiagnosticAt < 60_000) return;
  lastArkadeWatcherDiagnosticAt = now;

  void addDiagnosticLog(
    'warning',
    'Arkade realtime watcher unavailable',
    `Falling back to wallet polling. This is usually a temporary ${
      NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet'
    } indexer subscription issue.`,
  ).catch(() => {});
}

function recordArkadeSettlementDiagnostic(): void {
  const now = Date.now();
  if (now - lastArkadeSettlementDiagnosticAt < 5 * 60_000) return;
  lastArkadeSettlementDiagnosticAt = now;

  void addDiagnosticLog(
    'warning',
    'Arkade settlement retry scheduled',
    'The current intent round was incomplete or already reconciled. Alice will retry automatically with SDK backoff.',
  ).catch(() => {});
}

function installArkadeWatcherLogFilter(): void {
  if (arkadeWatcherLogFilterInstalled) return;
  arkadeWatcherLogFilterInstalled = true;

  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    if (isRecoverableArkadeSettlementLog(args)) {
      recordArkadeSettlementDiagnostic();
      return;
    }
    if (isBenignContractWatcherLog(args)) {
      recordArkadeWatcherDiagnostic();
      return;
    }
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (isRecoverableArkadeSettlementLog(args)) {
      recordArkadeSettlementDiagnostic();
      return;
    }
    originalWarn(...args);
  };
}

function createSQLExecutor(db: SQLite.SQLiteDatabase): ManagedSQLExecutor {
  let queue = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.then(() => {}, () => {});
    return result;
  }

  return {
    run: (sql, params) => enqueue(() => db.runAsync(sql, (params ?? []) as any[]).then(() => {})),
    get: (sql, params) => enqueue(() => db.getFirstAsync(sql, (params ?? []) as any[]) as Promise<any>),
    all: (sql, params) => enqueue(() => db.getAllAsync(sql, (params ?? []) as any[]) as Promise<any>),
    drain: () => queue,
  };
}

function deriveStatus(tx: { settled: boolean; key: { arkTxid: string; commitmentTxid: string; boardingTxid: string } }): TransactionStatus {
  if (tx.settled) return 'settled';
  if (tx.key.arkTxid) return 'preconfirmed';
  return 'pending';
}

function deriveLayer(tx: { key: { arkTxid: string; boardingTxid: string } }): TransactionLayer {
  if (tx.key.arkTxid) return 'ark';
  return 'onchain';
}

export class ArkadeBackend implements WalletBackend {
  private readonly transactionTimes = new TransactionTimeCache();
  private wallet: ExpoWallet | null = null;
  private db: SQLite.SQLiteDatabase | null = null;
  private swapDb: SQLite.SQLiteDatabase | null = null;
  private arkExecutor: ManagedSQLExecutor | null = null;
  private swapExecutor: ManagedSQLExecutor | null = null;
  private paymentRail: PaymentRail | null = null;
  private paymentRailPromise: Promise<PaymentRail> | null = null;
  private nativeOnchainPayment: NativeOnchainPayment | null = null;
  private walletMnemonic: string | null = null;
  private stateStorage: WalletStateStorage | null = null;
  private lifecycle: VtxoLifecycleController | null = null;
  private emergencyExit: EmergencyExitController | null = null;
  private receiveAddresses: ReceiveAddressController | null = null;
  private backgroundSyncEnabled = false;
  private delegateEnabled = false;
  private delegateInfo: DelegateInfo | null = null;

  async init(): Promise<void> {
    if (this.wallet) return;

    installArkadeWatcherLogFilter();

    const mnemonic = await SecureStore.getItemAsync(MNEMONIC_KEY);
    if (!mnemonic) {
      const networkLabel = NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet';
      throw new Error(`Complete wallet onboarding before connecting to ${networkLabel}.`);
    }
    this.walletMnemonic = mnemonic;
    this.delegateEnabled = await isDelegateRenewalEnabled();

    this.db = await SQLite.openDatabaseAsync('alice-ark.db');
    const executor = createSQLExecutor(this.db);
    this.arkExecutor = executor;

    const identity = MnemonicIdentity.fromMnemonic(mnemonic, {
      isMainnet: NETWORK === 'bitcoin',
    });

    this.swapDb = await SQLite.openDatabaseAsync('alice-swaps.db');
    this.swapExecutor = createSQLExecutor(this.swapDb);

    this.wallet = await ExpoWallet.setup({
      identity,
      arkProvider: new ExpoArkProvider(ASP_URL),
      indexerProvider: new ExpoIndexerProvider(ASP_URL),
      onchainProvider: new EsploraProvider(ESPLORA_URL),
      delegateProvider: this.delegateEnabled
        ? new RestDelegateProvider(DELEGATE_URL)
        : undefined,
      storage: {
        walletRepository: new SQLiteWalletRepository(executor),
        contractRepository: new SQLiteContractRepository(executor),
      },
      walletMode: 'hd',
      background: {
        taskQueue: new AsyncStorageTaskQueue(AsyncStorage),
        foregroundIntervalMs: 30_000,
      },
      settlementConfig: {
        vtxoThreshold: 3 * 24 * 60 * 60,
        boardingUtxoSweep: true,
      },
      watcherConfig: {
        maxReconnectAttempts: 1,
        failsafePollIntervalMs: 60_000,
      },
    });
    const concreteWallet = this.requireConcreteWallet();
    if (this.delegateEnabled) {
      const manager = await concreteWallet.getDelegateManager();
      this.delegateInfo = await manager?.getDelegateInfo() ?? null;
    }
    this.stateStorage = new WalletStateStorage(
      mnemonic,
      createSatoraKeyValueStore(executor),
    );
    this.receiveAddresses = new ReceiveAddressController(
      concreteWallet as unknown as ConstructorParameters<typeof ReceiveAddressController>[0],
      this.stateStorage,
    );
    await this.receiveAddresses.initialize();
    this.lifecycle = new VtxoLifecycleController(concreteWallet, this.stateStorage);
    this.emergencyExit = new EmergencyExitController(
      concreteWallet,
      mnemonic,
      this.stateStorage,
    );
    this.nativeOnchainPayment = new NativeOnchainPayment(
      this.wallet,
      this.stateStorage,
    );
    this.backgroundSyncEnabled = await registerArkadeBackgroundSync().catch(cause => {
      console.warn('Unable to register Arkade OS background synchronization.', cause);
      return false;
    });
  }

  async getAddress(): Promise<string> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    return this.wallet.getAddress();
  }

  async restore(): Promise<void> {
    // Two passes. The SDK scans N unused indexes in a row before stopping,
    // probing every contract type at each over the network, ten indexes at
    // a time: at 100 that is hundreds of requests and minutes on mobile
    // data. Almost every wallet sits within the SDK's default window of 20,
    // so that runs first; the deep window only runs when the quick one found
    // nothing at all, which is exactly the wallet that may need it.
    await this.scanWithRetries(RESTORE_FIRST_PASS_GAP_LIMIT);
    if (!(await this.hasAnyActivity())) {
      // Nothing at all within 20: this is the wallet that may need the deep
      // window, and it has nothing to show yet, so the wait is worth it.
      await this.scanWithRetries(RECEIVE_RESTORE_GAP_LIMIT);
      return;
    }
    // Something was found: the wallet is usable now. The deep window still
    // runs, in the background, so funds sitting beyond a gap of more than 20
    // unused addresses are never missed; the scan is idempotent and only
    // adds what it finds. Until it completes, the wallet is recorded as
    // partially recovered: an interrupted pass is retried at the next
    // launch and shown in the interface, never mistaken for a full one.
    const token = await markRecoveryScanPending();
    void this.runDeepScan(token).catch(() => {});
  }

  async deepScan(): Promise<void> {
    // A retry (next launch, or the banner) clears the token it found stored,
    // which is the one set by the pass it is finishing on behalf of.
    return this.runDeepScan(await loadRecoveryScanToken());
  }

  private runDeepScan(token: string | null): Promise<void> {
    this.deepScanPromise ??= this.scanWithRetries(RECEIVE_RESTORE_GAP_LIMIT)
      .then(() => (token ? clearRecoveryScanPending(token) : undefined))
      .catch(error => {
        void addDiagnosticLog('warning', 'Deep recovery scan did not finish', error instanceof Error ? error.message : String(error)).catch(() => {});
        throw error;
      })
      .finally(() => { this.deepScanPromise = null; });
    return this.deepScanPromise;
  }

  isDeepScanRunning(): boolean {
    return this.deepScanPromise !== null;
  }

  private deepScanPromise: Promise<void> | null = null;

  private async hasAnyActivity(): Promise<boolean> {
    const wallet = this.requireConcreteWallet();
    const vtxos = await wallet.getVtxos({ withRecoverable: true, withUnrolled: true });
    if (vtxos.length > 0) return true;
    const history = await this.getTransactionHistory().catch(() => []);
    return history.length > 0;
  }

  private async scanWithRetries(gapLimit: number): Promise<void> {
    // A probe that fails (a timeout on mobile data is enough) counts as
    // "nothing here", so the gap window can close before the real funds are
    // reached; the SDK then reports the failed probes. The scan is
    // idempotent, so failed probes simply mean: scan again, a few times.
    const attempts = 3;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.requireConcreteWallet().restore({ gapLimit });
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!/discovery handlers? failed/i.test(message) || attempt === attempts) break;
        void addDiagnosticLog('warning', 'Wallet recovery scan retrying', message).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1_500 * attempt));
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    if (/discovery handlers? failed/i.test(message)) {
      throw new Error(
        `Recovery scanned the network but some lookups failed after ${attempts} attempts. Check the connection and try again: retrying is safe.`,
        { cause: lastError },
      );
    }
    throw lastError;
  }

  async getBoardingAddress(): Promise<string> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    return this.wallet.getBoardingAddress();
  }

  async getBalance(): Promise<Balance> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    const b = await this.wallet.getBalance();
    const frozen = this.stateStorage
      ? await getFrozenSpendableAmount(this.requireConcreteWallet(), this.stateStorage)
      : 0;
    return {
      available: Math.max(0, b.available - frozen),
      frozen,
      settled: b.settled,
      boarding: b.boarding.total,
      total: b.total,
    };
  }

  async send(address: string, amountSats: number): Promise<string> {
    if (!this.stateStorage) throw new Error('Wallet not initialized');
    return sendBitcoinRespectingFreeze(
      this.requireConcreteWallet(),
      this.stateStorage,
      address,
      amountSats,
    );
  }

  async getTransactionHistory(): Promise<Transaction[]> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    const history = await this.wallet.getTransactionHistory();
    return history.map(tx => {
      const id = tx.key.arkTxid || tx.key.commitmentTxid || tx.key.boardingTxid;
      return {
        id,
        type: tx.type === TxType.TxReceived ? 'incoming' as const : 'outgoing' as const,
        layer: deriveLayer(tx),
        amount: tx.amount,
        settled: tx.settled,
        status: deriveStatus(tx),
        createdAt: this.transactionTimes.resolve(id, tx.createdAt),
        arkTxid: tx.key.arkTxid,
        commitmentTxid: tx.key.commitmentTxid,
        boardingTxid: tx.key.boardingTxid,
      };
    });
  }

  async getVtxos(): Promise<VtxoInfo[]> {
    if (!this.lifecycle) throw new Error('Wallet not initialized');
    return this.lifecycle.list();
  }

  async syncVtxos(ids?: string[]): Promise<VtxoSyncResult> {
    if (!this.lifecycle) throw new Error('Wallet not initialized');
    return this.lifecycle.sync(ids);
  }

  async maintainVtxos(): Promise<VtxoMaintenanceResult> {
    if (!this.lifecycle) throw new Error('Wallet not initialized');
    return this.lifecycle.maintain();
  }

  async renewVtxos(ids: string[]): Promise<VtxoOperationResult> {
    if (!this.lifecycle) throw new Error('Wallet not initialized');
    return this.lifecycle.renew(ids);
  }

  async recoverVtxos(ids: string[]): Promise<VtxoOperationResult> {
    if (!this.lifecycle) throw new Error('Wallet not initialized');
    return this.lifecycle.recover(ids);
  }

  async retryExcludedVtxo(id: string): Promise<VtxoSyncResult> {
    if (!this.lifecycle) throw new Error('Wallet not initialized');
    return this.lifecycle.retryExcluded(id);
  }

  async setVtxoFrozen(id: string, frozen: boolean): Promise<void> {
    if (!this.stateStorage) throw new Error('Wallet not initialized');
    const input = (await this.getVtxos()).find(item => item.id === id);
    if (!input?.spendable) throw new Error('Only a spendable VTXO can be frozen.');
    await this.stateStorage.setVtxoFrozen(id, frozen);
  }

  listReceiveAddresses(): Promise<ReceiveAddressRecord[]> {
    if (!this.receiveAddresses) throw new Error('Wallet not initialized');
    return this.receiveAddresses.list();
  }

  reserveArkadeReceiveAddress(): Promise<string> {
    if (!this.receiveAddresses) throw new Error('Wallet not initialized');
    return this.receiveAddresses.reserveArkade();
  }

  reserveOnchainReceiveAddress(): Promise<string> {
    if (!this.receiveAddresses) throw new Error('Wallet not initialized');
    return this.receiveAddresses.reserveOnchain();
  }

  reserveUnifiedReceiveAddresses(): Promise<{ arkade: string; onchain: string }> {
    if (!this.receiveAddresses) throw new Error('Wallet not initialized');
    return this.receiveAddresses.reserveUnified();
  }

  updateReceiveAddress(
    address: string,
    patch: Partial<Pick<ReceiveAddressRecord, 'label' | 'shared' | 'used' | 'archived'>>,
  ): Promise<ReceiveAddressRecord> {
    if (!this.receiveAddresses) throw new Error('Wallet not initialized');
    return this.receiveAddresses.update(address, patch);
  }

  async getVtxoAutomationStatus(): Promise<VtxoAutomationStatus> {
    return {
      renewalEnabled: true,
      renewalThresholdMs: VTXO_RENEWAL_THRESHOLD_MS,
      delegateEnabled: this.delegateEnabled,
      delegateUrl: DELEGATE_URL,
      delegateFee: this.delegateInfo?.fee ?? null,
      delegatePubkey: this.delegateInfo?.pubkey ?? null,
      foregroundSyncEnabled: true,
      backgroundSyncEnabled: this.backgroundSyncEnabled,
      backgroundSyncDetail: this.backgroundSyncEnabled
        ? 'The OS refreshes wallet state in the background. Alice checks and signs required renewals only while unlocked and active; iOS or Android controls wake timing.'
        : 'OS background state synchronization is not registered. Alice still synchronizes and renews while unlocked and active.',
      lastSyncedAt: this.lifecycle?.getLastSyncedAt() ?? null,
    };
  }

  async getEmergencyExitState(): Promise<EmergencyExitState> {
    if (!this.emergencyExit) throw new Error('Wallet not initialized');
    return this.emergencyExit.getState();
  }

  async prepareEmergencyExit(
    ids: string[],
    destination: string,
  ): Promise<EmergencyExitState> {
    if (!this.lifecycle || !this.emergencyExit) throw new Error('Wallet not initialized');
    await this.lifecycle.sync(ids);
    return this.emergencyExit.prepare(ids, destination);
  }

  async advanceEmergencyExit(): Promise<EmergencyExitState> {
    if (!this.emergencyExit) throw new Error('Wallet not initialized');
    return this.emergencyExit.advance();
  }

  async clearEmergencyExit(): Promise<void> {
    if (!this.emergencyExit) throw new Error('Wallet not initialized');
    await this.emergencyExit.clear();
  }

  async clearLifecycleData(): Promise<void> {
    await this.stateStorage?.clear();
  }

  async quoteNativeOnchain(
    request: ParsedPaymentRequest,
    amountSats: number,
  ): Promise<PaymentQuote> {
    if (!this.nativeOnchainPayment) throw new Error('Wallet not initialized');
    return this.nativeOnchainPayment.quote(request, amountSats);
  }

  async sendNativeOnchain(quote: PaymentQuote): Promise<PaymentRecord> {
    if (!this.nativeOnchainPayment) throw new Error('Wallet not initialized');
    return this.nativeOnchainPayment.send(quote);
  }

  async getPaymentRail(): Promise<PaymentRail | null> {
    if (this.paymentRail) return this.paymentRail;
    if (!this.wallet || !this.swapExecutor) return null;
    if (!this.paymentRailPromise) {
      const wallet = this.wallet;
      const swapExecutor = this.swapExecutor;
      const walletMnemonic = this.walletMnemonic;
      this.paymentRailPromise = (async () => {
        if (!this.stateStorage) throw new Error('Wallet state is unavailable.');
        const controlledWallet = freezeAwareWallet(wallet, this.stateStorage);
        const legacyBoltzPurge = await purgeLegacyBoltzSwapsOnce({
          network: NETWORK,
          provider: SWAP_PROVIDER,
          storageScope: 'native-sqlite',
          markerStore: AsyncStorage,
          clearLegacyState: () => clearLegacyNativeBoltzState(swapExecutor),
        });
        if (legacyBoltzPurge !== 'skipped') {
          void addDiagnosticLog('info', `Legacy Boltz swap migration: ${legacyBoltzPurge}.`);
        }
        if (SWAP_PROVIDER === 'boltz') {
          return BoltzNativePaymentRail.create(
            controlledWallet,
            swapExecutor,
          );
        }
        if (!walletMnemonic) {
          throw new Error('Wallet recovery material is unavailable.');
        }
        const satoraRail = await SatoraPaymentRail.create(
          controlledWallet,
          walletMnemonic,
          createSatoraKeyValueStore(swapExecutor),
        );
        if (NETWORK === 'bitcoin') return satoraRail;
        const boltzRail = await BoltzNativePaymentRail.create(
          controlledWallet,
          swapExecutor,
        );
        return new CompositePaymentRail(satoraRail, boltzRail);
      })()
        .then(rail => {
          this.paymentRail = rail;
          return rail;
        })
        .finally(() => {
          this.paymentRailPromise = null;
        });
    }
    return this.paymentRailPromise;
  }

  async dispose(): Promise<void> {
    if (this.paymentRail) {
      await this.paymentRail.dispose().catch(() => {});
      this.paymentRail = null;
    }
    this.paymentRailPromise = null;
    if (this.wallet) {
      await this.wallet.dispose();
      this.wallet = null;
    }
    this.nativeOnchainPayment = null;
    this.lifecycle = null;
    this.emergencyExit = null;
    this.receiveAddresses = null;
    this.stateStorage = null;
    this.walletMnemonic = null;
    this.delegateInfo = null;
    if (this.arkExecutor) {
      await this.arkExecutor.drain().catch(() => {});
      this.arkExecutor = null;
    }
    if (this.swapExecutor) {
      await this.swapExecutor.drain().catch(() => {});
      this.swapExecutor = null;
    }
    if (this.swapDb) {
      await this.swapDb.closeAsync();
      this.swapDb = null;
    }
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
    }
  }

  private requireConcreteWallet(): Wallet {
    if (!this.wallet) throw new Error('Wallet not initialized');
    const concrete = (this.wallet as unknown as { wallet?: Wallet }).wallet;
    if (!concrete || typeof concrete.getVtxoManager !== 'function') {
      throw new Error('This Arkade SDK build does not expose the native wallet lifecycle.');
    }
    return concrete;
  }
}
