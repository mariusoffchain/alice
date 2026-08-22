export {
  type WalletState,
  type ConnectionStatus,
  getConnectionStatus,
  initWallet,
  getBalance,
  getArkAddress,
  getReceiveAddress,
  getCachedTransactionHistory,
  getTransactionHistory,
  refreshTransactionHistory,
  getVtxos,
  restoreWallet,
  setVtxoFrozen,
  listReceiveAddresses,
  reserveArkadeReceiveAddress,
  reserveOnchainReceiveAddress,
  reserveUnifiedReceiveAddresses,
  updateReceiveAddress,
  syncVtxos,
  syncVtxosIfReady,
  maintainVtxosIfReady,
  renewVtxos,
  recoverVtxos,
  retryExcludedVtxo,
  getVtxoAutomationStatus,
  setDelegateRenewalEnabled,
  getEmergencyExitState,
  prepareEmergencyExit,
  advanceEmergencyExit,
  clearEmergencyExit,
  sendSats,
  sendQuotedPayment,
  quoteNativeOnchainPayment,
  getPaymentHistory,
  refreshPaymentHistory,
  getPaymentDetails,
  getSwapHistory,
  refreshSwapHistory,
  getSwapDetails,
  refundPayment,
  createReceivePayment,
  isWalletReady,
  rebuildLocalArkadeIndex,
  clearWalletBackendData,
} from './ark';
export { isHdDescriptorMismatchError } from './wallet-index-recovery';
export { ArkadeBackend } from './arkade-backend';
export { ArkadeWebBackend } from './arkade-web-backend';
export { quoteArkToBitcoin, quoteArkToLightning } from './boltz-quote';
export {
  NativeOnchainPayment,
  canOfferNativeOnchainFallback,
} from './native-onchain';
export {
  quoteArkToLightningWithSatora,
  type SatoraQuoteOptions,
} from './satora-quote';
export { friendlySatoraLimitError } from './satora-error-message';
export { settledIncomingAmount } from './receive-completion';
export {
  findNewIncomingTransaction,
  findNewReceivedVtxo,
} from './receive-detection';
export { quoteArkToLightningForProvider } from './swap-quote';
export { getConfirmations } from './confirmations';
export {
  type ExplorerLink,
  resolveBitcoinExplorer,
  resolveTransactionExplorer,
  resolvePaymentExplorer,
  resolveArkadeExplorer,
} from './transaction-explorer';
export { type DiagnosticLog, getDiagnosticLogs, addDiagnosticLog, clearDiagnosticLogs } from './diagnostic-log';
export {
  buildSupportReport,
  type SupportReportCategory,
  type SupportReportContext,
} from './support-report';
export {
  type HistoryEntry,
  filterPaymentBackingTransactions,
  buildHistoryEntries,
  buildHomeRecentHistoryEntries,
  isHomeRecentHistoryEntry,
} from './history-entries';
export { type ResolvedLnurlPay, lnurlPayUrlFromInput, resolveLnurlPay, resolveLightningRequestToBolt11 } from './lnurl';
export {
  ARKADE_INFO_URL,
  BOLTZ_HEALTH_URL,
  ESPLORA_TIP_URL,
  type ServiceHealth,
  friendlyNetworkError,
  checkNetworkHealth,
} from './network-errors';
export { friendlyRefundError } from './refund-errors';
export {
  NETWORK,
  ASP_URL,
  ESPLORA_URL,
  BOLTZ_URL,
  SATORA_URL,
  SATORA_HEALTH_URL,
  SWAP_PROVIDER,
  type SwapProvider,
  ALICE_APP_URL,
  ARKADE_EXPLORER,
  MEMPOOL_EXPLORER,
  WEB_DB_NAME,
  PAYMENT_NETWORK,
  type PaymentNetwork as PaymentNetworkConfig,
} from './network-config';
export {
  DELEGATE_URL,
  isDelegateRenewalEnabled,
} from './delegate-settings';
export { parsePaymentInput, selectPaymentRoute } from './payment-parser';
export { type PaymentRail } from './payment-rail';
export {
  type PaymentNetwork,
  type PaymentLayer,
  type PaymentInputKind,
  type LightningFormat,
  type PaymentRoute,
  type ParsedPaymentRequest,
  type PaymentQuote,
  type PaymentRecord,
  type ReceivePaymentRequest,
  type ReceivePaymentResponse,
  type PaymentStatus,
} from './payment-types';
export { isRefundTestArmed, armRefundTest, disarmRefundTest, consumeRefundTest } from './refund-test';
export { saveMnemonic, loadMnemonic, savePublicKey, loadPublicKey, clearWallet, forgetWalletForNewSeed } from './storage';
export {
  type Balance,
  type TransactionStatus,
  type TransactionLayer,
  type Transaction,
  type VtxoInfo,
  type VtxoOperationResult,
  type VtxoSyncResult,
  type VtxoMaintenanceResult,
  type VtxoAutomationStatus,
  type EmergencyExitStage,
  type EmergencyExitState,
  type WalletBackend,
} from './wallet-backend';
export {
  type ReceiveAddressLayer,
  type ReceiveAddressRecord,
} from './wallet-state-storage';
export {
  VTXO_RENEWAL_THRESHOLD_MS,
  classifyVtxo,
  parseOutpoint,
} from './vtxo-lifecycle';
export { ARKADE_BACKGROUND_TASK_NAME } from './background-lifecycle';
export { clearLocalWalletRepository } from './wallet-data';
export {
  WebStorageError,
  type WebStorageErrorCode,
  type WebStorageDiagnostics,
  diagnoseWebStorage,
  getWebStorageDiagnostics,
  saveWebMnemonic,
  loadWebMnemonic,
  hasWebMnemonic,
  setWebVaultPin,
  unlockWebVault,
  deriveWebPinVerifier,
  clearWebVaultPin,
  lockWebVault,
  clearWebVault,
  isWebOnboarded,
  markWebOnboarded,
} from './web-vault';
export {
  type LockConfig,
  loadLockConfig,
  getPinLength,
  createPin,
  verifyPin,
  isLockEnabled,
  setBiometricEnabled,
  clearAppLock,
} from './app-lock';
