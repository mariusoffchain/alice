import type { PaymentRail } from './payment-rail';
import type { ParsedPaymentRequest, PaymentQuote, PaymentRecord } from './payment-types';
import type { ReceiveAddressLayer, ReceiveAddressRecord } from './wallet-state-storage';

export interface Balance {
  available: number;
  frozen: number;
  settled: number;
  boarding: number;
  total: number;
}

export type TransactionStatus = 'pending' | 'preconfirmed' | 'settled' | 'failed';
export type TransactionLayer = 'ark' | 'onchain' | 'lightning';

export class TransactionTimeCache {
  private readonly detectedAtById = new Map<string, number>();

  resolve(id: string, createdAt: number, detectedAt = Date.now()): number {
    if (Number.isFinite(createdAt) && createdAt > 0) {
      this.detectedAtById.delete(id);
      return createdAt;
    }
    const firstSeen = this.detectedAtById.get(id) ?? detectedAt;
    this.detectedAtById.set(id, firstSeen);
    return firstSeen;
  }
}

export interface Transaction {
  id: string;
  type: 'incoming' | 'outgoing';
  layer: TransactionLayer;
  amount: number;
  settled: boolean;
  status: TransactionStatus;
  createdAt: number;
  arkTxid: string;
  commitmentTxid: string;
  boardingTxid: string;
}

export interface VtxoInfo {
  id: string;
  txid: string;
  vout: number;
  value: number;
  state: 'preconfirmed' | 'settled' | 'swept' | 'spent';
  batchExpiry?: number;
  createdAt: number;
  spendable: boolean;
  recoverable: boolean;
  expired: boolean;
  unrolled: boolean;
  needsRenewal: boolean;
  collaborativeEligible: boolean;
  excluded: boolean;
  exclusionReason?: string;
  excludedAt?: number;
  frozen: boolean;
  frozenAt?: number;
}

export interface VtxoOperationResult {
  txid: string;
  inputIds: string[];
  amountSats: number;
}

export interface VtxoSyncResult {
  syncedAt: number;
  inputIds: string[];
  removedExclusions: string[];
}

export interface VtxoAutomationStatus {
  renewalEnabled: boolean;
  renewalThresholdMs: number;
  delegateEnabled: boolean;
  delegateUrl: string;
  delegateFee: string | null;
  delegatePubkey: string | null;
  foregroundSyncEnabled: boolean;
  backgroundSyncEnabled: boolean;
  backgroundSyncDetail: string;
  lastSyncedAt: number | null;
}

export interface VtxoMaintenanceResult {
  sync: VtxoSyncResult;
  renewal: VtxoOperationResult | null;
}

export type EmergencyExitStage =
  | 'idle'
  | 'ready'
  | 'needs-fee-funding'
  | 'unrolling'
  | 'waiting-confirmation'
  | 'waiting-timelock'
  | 'completing'
  | 'completed'
  | 'failed';

export interface EmergencyExitState {
  version: 1;
  stage: EmergencyExitStage;
  destination: string;
  selectedIds: string[];
  selectedAmountSats: number;
  feeAddress: string;
  feeBalanceSats: number;
  completedVtxoIds: string[];
  currentVtxoId?: string;
  currentTxid?: string;
  finalTxid?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WalletBackend {
  init(): Promise<void>;
  restore(): Promise<void>;
  getAddress(): Promise<string>;
  getBoardingAddress(): Promise<string>;
  getBalance(): Promise<Balance>;
  send(address: string, amountSats: number): Promise<string>;
  getTransactionHistory(): Promise<Transaction[]>;
  getVtxos(): Promise<VtxoInfo[]>;
  syncVtxos(ids?: string[]): Promise<VtxoSyncResult>;
  maintainVtxos(): Promise<VtxoMaintenanceResult>;
  renewVtxos(ids: string[]): Promise<VtxoOperationResult>;
  recoverVtxos(ids: string[]): Promise<VtxoOperationResult>;
  retryExcludedVtxo(id: string): Promise<VtxoSyncResult>;
  setVtxoFrozen(id: string, frozen: boolean): Promise<void>;
  listReceiveAddresses(): Promise<ReceiveAddressRecord[]>;
  reserveArkadeReceiveAddress(): Promise<string>;
  reserveOnchainReceiveAddress(): Promise<string>;
  reserveUnifiedReceiveAddresses(): Promise<{ arkade: string; onchain: string }>;
  updateReceiveAddress(
    address: string,
    patch: Partial<Pick<ReceiveAddressRecord, 'label' | 'shared' | 'used' | 'archived'>>,
  ): Promise<ReceiveAddressRecord>;
  getVtxoAutomationStatus(): Promise<VtxoAutomationStatus>;
  getEmergencyExitState(): Promise<EmergencyExitState>;
  prepareEmergencyExit(ids: string[], destination: string): Promise<EmergencyExitState>;
  advanceEmergencyExit(): Promise<EmergencyExitState>;
  clearEmergencyExit(): Promise<void>;
  clearLifecycleData(): Promise<void>;
  getPaymentRail(): Promise<PaymentRail | null>;
  quoteNativeOnchain(request: ParsedPaymentRequest, amountSats: number): Promise<PaymentQuote>;
  sendNativeOnchain(quote: PaymentQuote): Promise<PaymentRecord>;
  dispose(): Promise<void>;
}
