export {
  type AIBackendType,
  type AIBackendStatus,
  type AIBackend,
  type Message,
  type TokenUsage,
  type AIResponse,
  type SendMessageOptions,
} from './ai-backend';
export { createBackend, canUseLocal, isTauriDesktop } from './ai-backend-factory';
export {
  PRIVATE_CLOUD_ENABLED,
  PRIVATE_CLOUD_DISABLED_MESSAGE,
  assertPrivateCloudEnabled,
} from './private-cloud-config';
export {
  getDesktopModelPath,
  setDesktopModelPath,
  getDesktopModelStatus,
  getDesktopInstalledModelPath,
  installDesktopModel,
  deleteDesktopModel,
  deleteAllDesktopModels,
} from './ai-backend-local-desktop';
export {
  type AIPreset,
  type LocalModelId,
  type PresetParams,
  type ModelEntry,
  type ModelStatus,
  type CloudModelId,
  type CloudModelEntry,
  type CustomServerConfig,
  PRESETS,
  CLOUD_PRESETS,
  ALL_PRESETS,
  MODEL_CATALOG,
  CLOUD_MODELS,
  getPreset,
  setPreset,
  getActiveModelId,
  getActiveCloudModelId,
  setActiveCloudModelId,
  getCloudVeniceId,
  setActiveModelId,
  getAliceInstructions,
  setAliceInstructions,
  getResponseLanguagePreference,
  setResponseLanguagePreference,
  getModelEntry,
  formatSize,
  getModelStatus,
  getModelPath,
  installModel,
  deleteModel,
  deleteAllModels,
  hasAnyInstalledModel,
  isAIEnabled,
  setAIEnabled,
  type AIBackendEnabledState,
  getAIBackendEnabledState,
  isAIBackendEnabled,
  setAIBackendEnabled,
  isLocalAIEnabled,
  setLocalAIEnabled,
  isCloudAIEnabled,
  setCloudAIEnabled,
  getCustomServer,
  setCustomServer,
} from './ai-preferences';
export {
  type SupportedLanguage,
  type ResponseLanguagePreference,
  type LanguageDecision,
  detectExplicitResponseLanguage,
  detectTextLanguage,
  resolveResponseLanguage,
  isResponseLanguageAcceptable,
} from './language-policy';
export { buildAliceSystemPrompt } from './ai-system-prompt';
export { generateLanguageChecked, WrongResponseLanguageError } from './language-generation';
export {
  type AliceCapability,
  type AliceCapabilityId,
  ALICE_CAPABILITIES,
  getAliceCapability,
} from './alice-capabilities';
export { planAliceTurn, turnResponseDirective, type AliceTurnKind, type AliceTurnPlan } from './turn-planner';
export {
  prepareAliceTurn,
  type PreparedAliceTurn,
  type TurnPreparationDiagnostics,
  type TurnPreparationServices,
} from './turn-engine';
export { composeGenerationHistory } from './generation-context';
export {
  type AliceMemoryCategory,
  type AliceMemoryCandidate,
  type AliceMemoryItem,
  type AliceMemory,
  ALICE_MEMORY_CAPTURE_INSTRUCTION,
  createAliceMemory,
  getAliceMemory,
  forgetAliceMemoryItem,
  setAliceMemoryEnabled,
  clearAliceMemory,
  aliceMemoryContext,
} from './alice-memory';
export {
  type KnowledgeConcept,
  type FamiliarityState,
  type ConceptProgress,
  type PedagogicalProfile,
  createPedagogicalProfile,
  getPedagogicalProfile,
  recordPedagogicalSignal,
  recordCourseStudySignal,
  recordCourseCompletionSignal,
  clearPedagogicalProfile,
  inferPedagogicalConcepts,
  isDefinitionQuestion,
  familiarityFor,
  declaredFamiliarityInMessage,
  KNOWLEDGE_CONCEPT_LABELS,
  forgetPedagogicalConcept,
} from './pedagogical-profile';
export { type SensitiveInputBlock, detectSensitiveInput } from './ai-sensitive-input';
export { type ChatMsg, type MessageVariant, ChatProvider, useChat } from './chat-context';
export {
  MAX_CHAT_SESSIONS,
  type ChatSession,
  type ChatCleanupMode,
  type ChatCleanupResult,
  type ChatCleanupPlan,
  type ChatStorageSummary,
  type ChatStorageCipher,
  listSessions,
  saveSession,
  loadSession,
  deleteSession,
  cleanupSessions,
  planSessionCleanup,
  getChatStorageSummary,
  encodeChatStorageValue,
  decodeChatStorageValue,
  isEncryptedChatStorageValue,
} from './chat-storage';
export { type InferenceParams, sendMessage } from './llm';
export {
  retrieveContext,
  retrieveContextHybrid,
  retrieveContextHybridWithDiagnostics,
  augmentQuery,
  augmentQueryWithLocalData,
  buildRagTurnContext,
  isTechnicalRagQuery,
  type RagRetrievalOptions,
  type RagTurnContext,
  type RagChunkDiagnostic,
} from './rag';
export {
  preloadSemanticSearch,
  isSemanticSearchReady,
  getSemanticSearchState,
  downloadSemanticSearchNow,
  disableSemanticSearch,
} from './semantic-runtime';
export {
  NATIVE_SEMANTIC_MODEL_DOWNLOAD_BYTES,
  SEMANTIC_MODEL_DOWNLOAD_BYTES,
  SEMANTIC_SEARCH_STATE_EVENT,
  type SemanticSearchState,
  type SemanticSearchStatus,
} from './semantic-policy';
export {
  APP_UPDATE_EVENT,
  checkForAppUpdate,
  currentAppVersion,
  takeWhatsNew,
  type UpdateStateStore,
} from './app-update';
export { isNewerVersion } from './app-update-format';
export { RELEASE_NOTES_URL, WHATS_NEW, whatsNewFor, type WhatsNewEntry } from './whats-new';
export { registerLearnContextProvider, type LearnTurnContext } from './learn-context';
export {
  registerPack,
  unregisterPack,
  getRegisteredPacks,
  getAllChunks,
  setKnowledgePackEnabled,
  isKnowledgePackEnabled,
  getKnowledgePackRevision,
  preferKnowledgeLocale,
  type KnowledgePack,
  type KnowledgeChunk,
  type KnowledgeLevel,
  type KnowledgeLocale,
  type TranslationStatus,
} from './knowledge-packs';
export {
  downloadPack,
  deletePack,
  listDownloadedPackIds,
  restoreDownloadedPacks,
  checkForPackUpdates,
  PackIntegrityError,
  type PackDescriptor,
  type PackUpdateResult,
} from './pack-downloader';
export { KNOWLEDGE_PACK_CATALOG } from './knowledge-pack-catalog';
export {
  AccountProvider,
  useAccount,
  type AliceCloudUsage,
  type AliceSignInReason,
} from './account-context';
export {
  isCheckoutSettled,
  PENDING_CHECKOUT_TTL_MS,
  type AlicePendingCheckout,
} from './billing-checkout';
export {
  AliceAccountError,
  type AliceAccount,
  type AliceAccountIdentity,
  type AliceAccountSession,
  type AliceBilling,
  type AliceCheckout,
  type AlicePaidPlan,
  type AlicePlan,
  type AlicePlanQuote,
  type AlicePlanQuotes,
  getPlanQuotes,
  type UsernameSuggestion,
  getInstallId,
  loadAccountSession,
  startEmailLogin,
  verifyEmailLogin,
  suggestAccountUsernames,
  loginWithPassword,
  setPassword,
  updateAccountProfile,
  startEmailIdentityLink,
  verifyEmailIdentityLink,
  revokeAccountIdentity,
  getAccount,
  logoutAccount,
  requestAccountDeletion,
  redeemPromoCode,
  privateCloudAccountHeaders,
} from './account-client';
export {
  alicePlatform,
  aliceAppVersion,
  aliceClientHeaders,
  type AlicePlatform,
} from './client-info';
export {
  ALICE_PRODUCT_EVENTS,
  trackProductEvent,
  flushProductEvents,
  setProductEventsEnabled,
  type AliceProductEvent,
} from './product-events';
