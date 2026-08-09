import {
  EsploraProvider,
  IndexedDBContractRepository,
  IndexedDBWalletRepository,
  MnemonicIdentity,
  RestArkProvider,
  RestDelegateProvider,
  RestIndexerProvider,
  TxType,
  Wallet,
  type DelegateInfo,
} from '@arkade-os/sdk';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadWebMnemonic } from './web-vault';
import type { PaymentRail } from './payment-rail';
import { createArkadeCacheRepositories } from './arkade-cache-repositories';
import { getWebStorageDiagnostics } from './web-vault';
import { NETWORK, ASP_URL, ESPLORA_URL, SWAP_PROVIDER, WEB_DB_NAME } from './network-config';
import { purgeLegacyBoltzSwapsOnce } from './legacy-boltz-purge';
import { addDiagnosticLog } from './diagnostic-log';
import { NativeOnchainPayment } from './native-onchain';
import type { ParsedPaymentRequest, PaymentQuote, PaymentRecord } from './payment-types';
import { createSatoraKeyValueStore } from './satora-key-value';
import { WalletStateStorage } from './wallet-state-storage';
import type { ReceiveAddressRecord } from './wallet-state-storage';
import { freezeAwareWallet, getFrozenSpendableAmount, sendBitcoinRespectingFreeze } from './frozen-vtxos';
import {
  RECEIVE_RESTORE_GAP_LIMIT,
  ReceiveAddressController,
} from './receive-addresses';
import {
  VTXO_RENEWAL_THRESHOLD_MS,
  VtxoLifecycleController,
} from './vtxo-lifecycle';
import { EmergencyExitController } from './emergency-exit';
import {
  DELEGATE_URL,
  isDelegateRenewalEnabled,
} from './delegate-settings';

function deriveStatus(tx: { settled: boolean; key: { arkTxid: string; commitmentTxid: string; boardingTxid: string } }): TransactionStatus {
  if (tx.settled) return 'settled';
  if (tx.key.arkTxid) return 'preconfirmed';
  return 'pending';
}

function deriveLayer(tx: { key: { arkTxid: string; boardingTxid: string } }): TransactionLayer {
  if (tx.key.arkTxid) return 'ark';
  return 'onchain';
}

export class ArkadeWebBackend implements WalletBackend {
  private wallet: Wallet | null = null;
  private cacheMnemonic: string | null = null;
  private walletMnemonic: string | null = null;
  private paymentRail: PaymentRail | null = null;
  private paymentRailPromise: Promise<PaymentRail> | null = null;
  private nativeOnchainPayment: NativeOnchainPayment | null = null;
  private stateStorage: WalletStateStorage | null = null;
  private lifecycle: VtxoLifecycleController | null = null;
  private emergencyExit: EmergencyExitController | null = null;
  private receiveAddresses: ReceiveAddressController | null = null;
  private delegateEnabled = false;
  private delegateInfo: DelegateInfo | null = null;

  async init(): Promise<void> {
    if (this.wallet) return;

    const mnemonic = await loadWebMnemonic();
    if (!mnemonic) {
      const networkLabel = NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet';
      throw new Error(`Complete wallet onboarding before connecting to ${networkLabel}.`);
    }
    this.walletMnemonic = mnemonic;
    this.delegateEnabled = await isDelegateRenewalEnabled();

    const storageDiagnostics = await getWebStorageDiagnostics();
    this.cacheMnemonic = storageDiagnostics.indexedDB.available ? null : mnemonic;
    const storage = storageDiagnostics.indexedDB.available
      ? {
          walletRepository: new IndexedDBWalletRepository(WEB_DB_NAME),
          contractRepository: new IndexedDBContractRepository(WEB_DB_NAME),
        }
      : createArkadeCacheRepositories(mnemonic);

    this.wallet = await Wallet.create({
      identity: MnemonicIdentity.fromMnemonic(mnemonic, { isMainnet: NETWORK === 'bitcoin' }),
      arkProvider: new RestArkProvider(ASP_URL),
      indexerProvider: new RestIndexerProvider(ASP_URL),
      onchainProvider: new EsploraProvider(ESPLORA_URL),
      delegateProvider: this.delegateEnabled
        ? new RestDelegateProvider(DELEGATE_URL)
        : undefined,
      storage,
      walletMode: 'hd',
      settlementConfig: {
        vtxoThreshold: 3 * 24 * 60 * 60,
        boardingUtxoSweep: true,
      },
    });
    if (this.delegateEnabled) {
      const manager = await this.wallet.getDelegateManager();
      this.delegateInfo = await manager?.getDelegateInfo() ?? null;
    }
    this.stateStorage = new WalletStateStorage(
      mnemonic,
      createSatoraKeyValueStore(),
    );
    this.receiveAddresses = new ReceiveAddressController(
      this.wallet as unknown as ConstructorParameters<typeof ReceiveAddressController>[0],
      this.stateStorage,
    );
    await this.receiveAddresses.initialize();
    this.lifecycle = new VtxoLifecycleController(this.wallet, this.stateStorage);
    this.emergencyExit = new EmergencyExitController(
      this.wallet,
      mnemonic,
      this.stateStorage,
    );
    this.nativeOnchainPayment = new NativeOnchainPayment(
      this.wallet,
      this.stateStorage,
    );
  }

  private requireWallet(): Wallet {
    if (!this.wallet) throw new Error('Wallet not initialized');
    return this.wallet;
  }

  async restore(): Promise<void> {
    await this.requireWallet().restore({ gapLimit: RECEIVE_RESTORE_GAP_LIMIT });
  }

  getAddress(): Promise<string> {
    return this.requireWallet().getAddress();
  }

  getBoardingAddress(): Promise<string> {
    return this.requireWallet().getBoardingAddress();
  }

  async getBalance(): Promise<Balance> {
    const balance = await this.requireWallet().getBalance();
    const frozen = this.stateStorage
      ? await getFrozenSpendableAmount(this.requireWallet(), this.stateStorage)
      : 0;
    return {
      available: Math.max(0, balance.available - frozen),
      frozen,
      settled: balance.settled,
      boarding: balance.boarding.total,
      total: balance.total,
    };
  }

  send(address: string, amountSats: number): Promise<string> {
    if (!this.stateStorage) throw new Error('Wallet not initialized');
    return sendBitcoinRespectingFreeze(
      this.requireWallet(),
      this.stateStorage,
      address,
      amountSats,
    );
  }

  async getTransactionHistory(): Promise<Transaction[]> {
    return (await this.requireWallet().getTransactionHistory()).map(transaction => ({
      id: transaction.key.arkTxid || transaction.key.commitmentTxid || transaction.key.boardingTxid,
      type: transaction.type === TxType.TxReceived ? 'incoming' as const : 'outgoing' as const,
      layer: deriveLayer(transaction),
      amount: transaction.amount,
      settled: transaction.settled,
      status: deriveStatus(transaction),
      createdAt: transaction.createdAt,
      arkTxid: transaction.key.arkTxid,
      commitmentTxid: transaction.key.commitmentTxid,
      boardingTxid: transaction.key.boardingTxid,
    }));
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
      backgroundSyncEnabled: false,
      backgroundSyncDetail: 'The PWA synchronizes and renews while unlocked and active. Browsers do not guarantee closed-app execution.',
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

  async getPaymentRail(): Promise<PaymentRail> {
    if (this.paymentRail) return this.paymentRail;
    if (!this.paymentRailPromise) {
      this.paymentRailPromise = (async () => {
        const {
          BoltzWebPaymentRail,
          clearLegacyWebBoltzState,
        } = await import('./boltz-rail.web');
        const legacyBoltzPurge = await purgeLegacyBoltzSwapsOnce({
          network: NETWORK,
          provider: SWAP_PROVIDER,
          storageScope: this.cacheMnemonic ? 'web-cache' : 'web-indexeddb',
          markerStore: AsyncStorage,
          clearLegacyState: () => clearLegacyWebBoltzState(
            this.cacheMnemonic ?? undefined,
          ),
        });
        if (legacyBoltzPurge !== 'skipped') {
          void addDiagnosticLog('info', `Legacy Boltz swap migration: ${legacyBoltzPurge}.`);
        }
        if (!this.stateStorage) throw new Error('Wallet state is unavailable.');
        const controlledWallet = freezeAwareWallet(this.requireWallet(), this.stateStorage);
        if (SWAP_PROVIDER === 'boltz') {
          return BoltzWebPaymentRail.create(
            controlledWallet,
            this.cacheMnemonic ?? undefined,
          );
        }
        if (!this.walletMnemonic) {
          throw new Error('Wallet recovery material is unavailable.');
        }
        const [
          { CompositePaymentRail },
          { createSatoraKeyValueStore },
          { SatoraPaymentRail },
        ] = await Promise.all([
          import('./composite-payment-rail'),
          import('./satora-key-value'),
          import('./satora-rail'),
        ]);
        const satoraRail = await SatoraPaymentRail.create(
          controlledWallet,
          this.walletMnemonic,
          createSatoraKeyValueStore(),
        );
        if (NETWORK === 'bitcoin') return satoraRail;
        const boltzRail = await BoltzWebPaymentRail.create(
          controlledWallet,
          this.cacheMnemonic ?? undefined,
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
      await this.paymentRail.dispose();
      this.paymentRail = null;
    }
    if (!this.wallet) return;
    await this.wallet.dispose();
    this.wallet = null;
    this.nativeOnchainPayment = null;
    this.lifecycle = null;
    this.emergencyExit = null;
    this.receiveAddresses = null;
    this.stateStorage = null;
    this.cacheMnemonic = null;
    this.walletMnemonic = null;
    this.delegateInfo = null;
  }
}
