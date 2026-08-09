import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, TextInput, Modal } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { PixelToggle, useTheme } from '@alice-wallet/alice-ui';
import {
  getChatStorageSummary,
  MAX_CHAT_SESSIONS,
  useChat,
  type ChatCleanupMode,
  type ChatStorageSummary,
} from '@alice-wallet/alice-ai';
import {
  MODEL_CATALOG,
  formatSize,
  setPreset,
  getActiveModelId,
  setActiveModelId,
  getModelStatus,
  installModel,
  deleteModel,
  deleteAllModels,
  getModelEntry,
  getCustomServer,
  PRIVATE_CLOUD_ENABLED,
  setCustomServer,
  setActiveCloudModelId,
  getAliceInstructions,
  setAliceInstructions,
  getResponseLanguagePreference,
  setResponseLanguagePreference,
  type ResponseLanguagePreference,
  type LocalModelId,
  type ModelStatus,
} from '@alice-wallet/alice-ai';

type ModelState = {
  status: ModelStatus;
  downloadProgress: number | null;
};

export default function AISettingsScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const chat = useChat();

  const [activeModelId, setActiveModelState] = useState<LocalModelId>('qwen3-0.6b');
  const defaultModelStates = Object.fromEntries(
    MODEL_CATALOG.map(m => [m.id, { status: 'not-installed' as ModelStatus, downloadProgress: null }]),
  ) as Record<LocalModelId, ModelState>;
  const [modelStates, setModelStates] = useState<Record<LocalModelId, ModelState>>(defaultModelStates);
  const [selectedModel, setSelectedModel] = useState<LocalModelId | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LocalModelId | 'all' | null>(null);
  const [confirmActivate, setConfirmActivate] = useState<LocalModelId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [downloadDropdownOpen, setDownloadDropdownOpen] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [customSaved, setCustomSaved] = useState(false);
  const [aliceInstructions, setAliceInstructionsState] = useState('');
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [responseLanguage, setResponseLanguageState] = useState<ResponseLanguagePreference>('auto');
  const [chatStorage, setChatStorage] = useState<ChatStorageSummary | null>(null);
  const [confirmChatCleanup, setConfirmChatCleanup] = useState<ChatCleanupMode | null>(null);
  const [cleaningChat, setCleaningChat] = useState(false);

  const refreshState = useCallback(async () => {
    const [amid, instructions, storageSummary, languagePreference] = await Promise.all([
      getActiveModelId(),
      getAliceInstructions(),
      getChatStorageSummary(),
      getResponseLanguagePreference(),
    ]);
    setActiveModelState(amid);
    setAliceInstructionsState(instructions);
    setChatStorage(storageSummary);
    setResponseLanguageState(languagePreference);

    const statuses = await Promise.all(
      MODEL_CATALOG.map(async m => ({ id: m.id, status: await getModelStatus(m.id) })),
    );
    setModelStates(prev => {
      const next = { ...prev };
      for (const { id, status } of statuses) {
        if (next[id]?.status !== 'downloading') next[id] = { ...next[id], status };
      }
      return next;
    });

    const custom = await getCustomServer();
    if (custom) {
      setCustomUrl(custom.url);
      setCustomModel(custom.model);
      setCustomKey(custom.apiKey ?? '');
    }
  }, []);

  useEffect(() => { refreshState(); }, [refreshState]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleActivate(id: LocalModelId) {
    setActiveModelState(id);
    await setActiveModelId(id);
    chat.setBackendType('local');
    showToast(`${getModelEntry(id).name} is now active`);
  }

  async function handleInstall(id: LocalModelId) {
    setModelStates(prev => ({ ...prev, [id]: { status: 'downloading', downloadProgress: 0 } }));
    try {
      await installModel(id, fraction => {
        setModelStates(prev => ({ ...prev, [id]: { status: 'downloading', downloadProgress: fraction } }));
      });
      setModelStates(prev => ({ ...prev, [id]: { status: 'installed', downloadProgress: null } }));
      showToast(`${getModelEntry(id).name} downloaded and ready`);
    } catch (err) {
      console.warn('[ai-settings] install failed:', err);
      setModelStates(prev => ({ ...prev, [id]: { status: 'not-installed', downloadProgress: null } }));
      showToast(err instanceof Error ? err.message : `Download failed for ${getModelEntry(id).name}`);
    }
  }

  async function handleDelete(id: LocalModelId) {
    try {
      await deleteModel(id);
      await refreshState();
      showToast(`${getModelEntry(id).name} deleted`);
    } catch (err) {
      console.warn('[ai-settings] delete failed:', err);
    }
  }

  async function handleDeleteAll() {
    try {
      await deleteAllModels();
      await refreshState();
      showToast('All models deleted');
    } catch (err) {
      console.warn('[ai-settings] delete all failed:', err);
    }
  }

  async function handleResetDefaults() {
    await Promise.all([
      setPreset('local', 'balanced'),
      setPreset('cloud', 'balanced'),
      setActiveModelId('qwen3-0.6b'),
      setActiveCloudModelId('alice-cloud'),
      setAliceInstructions(''),
      setResponseLanguagePreference('auto'),
      setCustomServer(null),
    ]);

    setActiveModelState('qwen3-0.6b');
    setAliceInstructionsState('');
    setInstructionsSaved(false);
    setResponseLanguageState('auto');
    setCustomUrl('');
    setCustomModel('');
    setCustomKey('');
    setCustomSaved(false);
    setDownloadDropdownOpen(false);
    chat.setAiEnabled(true);
    chat.setLocalAiEnabled(true);
    chat.setCloudAiEnabled(true);
    chat.clearMessages();
    chat.setBackendType(PRIVATE_CLOUD_ENABLED ? 'cloud' : 'custom');
  }

  async function handleChatCleanup(mode: ChatCleanupMode) {
    setCleaningChat(true);
    try {
      const result = await chat.cleanSessionHistory(mode);
      setChatStorage(await getChatStorageSummary());
      showToast(`${result.deletedCount} conversation${result.deletedCount === 1 ? '' : 's'} deleted`);
    } catch (err) {
      console.warn('[ai-settings] chat cleanup failed:', err);
      showToast('Unable to clean discussion history');
    } finally {
      setCleaningChat(false);
      setConfirmChatCleanup(null);
    }
  }

  const chatCleanupCount = confirmChatCleanup === 'all'
    ? (chatStorage?.count ?? 0)
    : confirmChatCleanup === 'oldest-10'
      ? Math.min(10, chatStorage?.count ?? 0)
      : Math.max(0, (chatStorage?.count ?? 0) - 10);

	  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>Customize Alice</Text>
        <View style={{ width: 36 }} />
      </View>

      {toast && (
        <View style={[s.toast, { backgroundColor: colors.primary }]}>
          <Text style={[s.toastText, { color: colors.onPrimary }]}>{toast}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={[s.section, s.toggleRow]}>
          <Text style={s.toggleLabel}>ALICE AI</Text>
          <PixelToggle
            value={chat.aiEnabled}
            onValueChange={chat.setAiEnabled}
            accessibilityLabel="Enable Alice AI"
          />
        </View>

        <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>AI MODES</Text>
        <View style={s.section}>
          <View style={s.modeRow}>
            <View style={s.modeCopy}>
              <Text style={s.toggleLabel}>PRIVATE CLOUD</Text>
              <Text style={s.modeHint}>Encrypted cloud answers and 21 free requests.</Text>
            </View>
            <PixelToggle
              value={chat.cloudAIEnabled}
              onValueChange={chat.setCloudAiEnabled}
              disabled={!PRIVATE_CLOUD_ENABLED}
              accessibilityLabel="Enable Private Cloud"
            />
          </View>
          <View style={[s.modeRow, s.modeRowBorder]}>
            <View style={s.modeCopy}>
              <Text style={s.toggleLabel}>LOCAL AI</Text>
              <Text style={s.modeHint}>Runs entirely on this device.</Text>
            </View>
            <PixelToggle
              value={chat.localAIEnabled}
              onValueChange={chat.setLocalAiEnabled}
              disabled={!chat.localAvailable}
              accessibilityLabel="Enable Local AI"
            />
          </View>
        </View>

        <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>PERSONALIZATION</Text>
        <TouchableOpacity
          style={[s.section, s.profileRow]}
          onPress={() => router.push('/what-alice-knows' as Href)}
        >
          <View style={s.modeCopy}>
            <Text style={s.toggleLabel}>ALICE MEMORY</Text>
            <Text style={s.modeHint}>See and control what Alice remembers locally.</Text>
          </View>
          <Text style={s.profileChevron}>›</Text>
        </TouchableOpacity>

        <View style={[s.section, { marginTop: spacing.sm }]}>
          <Text style={s.toggleLabel}>RESPONSE LANGUAGE</Text>
          <Text style={s.modeHint}>Auto follows your latest message. A fixed choice overrides automatic detection.</Text>
          <View style={s.languageOptions}>
            {([
              ['auto', 'AUTO'],
              ['fr', 'FRANCAIS'],
              ['en', 'ENGLISH'],
            ] as const).map(([value, label]) => (
              <TouchableOpacity
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: responseLanguage === value }}
                style={[
                  s.languageOption,
                  { borderColor: colors.primary },
                  responseLanguage === value && { backgroundColor: colors.primary },
                ]}
                onPress={async () => {
                  setResponseLanguageState(value);
                  await setResponseLanguagePreference(value);
                  chat.clearMessages();
                }}
              >
                <Text style={[
                  s.languageOptionText,
                  { color: responseLanguage === value ? colors.onPrimary : colors.primary },
                ]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>ALICE INSTRUCTIONS</Text>
        <View style={s.section}>
          <Text style={s.customHint}>Tell Alice how she should answer. These instructions apply to cloud, local, and custom AI.</Text>
          <TextInput
            style={[s.customInput, s.instructionsInput, { borderColor: colors.border, color: colors.primaryDark }]}
            value={aliceInstructions}
            onChangeText={value => {
              setAliceInstructionsState(value);
              setInstructionsSaved(false);
            }}
            placeholder="Example: Explain things simply, use short answers, and ask me one question when I seem unsure."
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            maxLength={800}
          />
          <View style={s.customActions}>
            <TouchableOpacity
              style={[s.actionBtn, { borderColor: colors.primary }]}
	              onPress={async () => {
	                await setAliceInstructions(aliceInstructions);
	                setAliceInstructionsState(aliceInstructions.trim());
	                setInstructionsSaved(true);
	                chat.clearMessages();
	              }}
            >
              <Text style={[s.actionBtnText, { color: colors.primary }]}>{instructionsSaved ? 'SAVED' : 'SAVE INSTRUCTIONS'}</Text>
            </TouchableOpacity>
            {aliceInstructions.trim() !== '' && (
              <TouchableOpacity
                style={[s.actionBtn, { borderColor: '#e06060' }]}
                onPress={async () => {
	                  await setAliceInstructions('');
	                  setAliceInstructionsState('');
	                  setInstructionsSaved(false);
	                  chat.clearMessages();
	                }}
              >
                <Text style={[s.actionBtnText, { color: '#e06060' }]}>CLEAR</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {Platform.OS !== 'web' && (() => {
          const installedModels = MODEL_CATALOG.filter(m => {
            const st = modelStates[m.id].status;
            return st === 'installed' || st === 'downloading';
          });
          const downloadableModels = MODEL_CATALOG.filter(m => modelStates[m.id].status === 'not-installed');

          return (
            <>
              <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>LOCAL MODEL</Text>
              <View style={s.section}>
                <TouchableOpacity
                  style={s.dropdownTrigger}
                  onPress={() => { setDownloadDropdownOpen(open => !open); }}
                  disabled={downloadableModels.length === 0}
                >
                  <Text style={s.dropdownLabel}>
                    {downloadableModels.length === 0 ? 'ALL MODELS DOWNLOADED' : 'CHOOSE A MODEL TO DOWNLOAD'}
                  </Text>
                  {downloadableModels.length > 0 && <Text style={s.dropdownChevron}>{downloadDropdownOpen ? '^' : 'v'}</Text>}
                </TouchableOpacity>

                {downloadDropdownOpen && downloadableModels.length > 0 && (
                  <View style={s.dropdownMenu}>
                    {downloadableModels.map((model, i) => (
                      <TouchableOpacity
                        key={model.id}
                        style={[s.dropdownOption, i > 0 && s.modelRowBorder]}
                        onPress={() => { setDownloadDropdownOpen(false); setSelectedModel(model.id); }}
                      >
                        <View style={s.modelNameRow}>
                          <Text style={s.modelName} numberOfLines={1}>{model.name}</Text>
                          <Text style={s.modelSize}>{formatSize(model.sizeBytes)}</Text>
                        </View>
                        <Text style={s.dropdownDescription}>{model.description}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <View style={s.divider} />
                <Text style={s.subsectionLabel}>INSTALLED MODELS</Text>
                {installedModels.map((model, i) => {
                  const state = modelStates[model.id];
                  const isActive = model.id === activeModelId;
                  const activeLoadFailed = isActive
                    && chat.backendType === 'local'
                    && chat.backendStatus.state === 'error';
                  const activeLoading = isActive
                    && chat.backendType === 'local'
                    && chat.backendStatus.state === 'loading';
                  return (
                    <TouchableOpacity
                      key={model.id}
                      style={[s.modelCard, i > 0 && s.modelRowBorder]}
                      onPress={() => { if (state.status === 'installed') setSelectedModel(model.id); }}
                      disabled={state.status === 'downloading'}
                    >
                      <View style={s.modelNameRow}>
                        <Text style={s.modelName} numberOfLines={1}>{model.name}</Text>
                        <Text style={s.modelSize}>{formatSize(model.sizeBytes)}</Text>
                      </View>
                      <View style={s.modelMeta}>
                        {isActive && !activeLoadFailed && !activeLoading && (
                          <Text style={[s.modelBadge, { color: colors.primary }]}>Active</Text>
                        )}
                        {activeLoading && <Text style={s.modelBadgeSecondary}>Loading...</Text>}
                        {activeLoadFailed && <Text style={[s.modelBadge, { color: '#e06060' }]}>Unavailable</Text>}
                        {state.status === 'installed' && <Text style={s.modelBadgeSecondary}>Installed</Text>}
                        {state.status === 'downloading' && <Text style={s.modelBadgeSecondary}>Downloading...</Text>}
                      </View>
                      {state.status === 'downloading' && (
                        <View style={s.modelActions}>
                          <View style={s.progressBar}>
                            <View style={[s.progressFill, { width: `${Math.round((state.downloadProgress ?? 0) * 100)}%`, backgroundColor: colors.primary }]} />
                          </View>
                          <Text style={s.progressText}>{Math.round((state.downloadProgress ?? 0) * 100)}%</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {installedModels.length === 0 && (
                  <Text style={s.modelBadgeSecondary}>No model installed. Download one above.</Text>
                )}
              </View>

              {installedModels.some(m => modelStates[m.id].status === 'installed') && (
                <TouchableOpacity
                  style={[s.deleteAllBtn, { borderColor: '#e06060' }]}
                  onPress={() => setConfirmDelete('all')}
                >
                  <Text style={[s.deleteAllText, { color: '#e06060' }]}>DELETE ALL DOWNLOADED MODELS</Text>
                </TouchableOpacity>
              )}
            </>
          );
        })()}

        {selectedModel && (() => {
          const model = MODEL_CATALOG.find(m => m.id === selectedModel)!;
          const state = modelStates[selectedModel];
          const installed = state.status === 'installed';
          const isActive = selectedModel === activeModelId;
          return (
            <Modal transparent animationType="fade" visible onRequestClose={() => setSelectedModel(null)}>
              <View style={s.modalOverlay}>
                <View style={[s.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[s.modalTitle, { color: colors.primaryDark }]}>{model.name}</Text>
                  <Text style={s.modalSize}>{formatSize(model.sizeBytes)}</Text>

                  <Text style={[s.modalDescription, { color: colors.primaryDark }]}>{model.description}</Text>

                  <View style={s.modalStats}>
                    <View style={s.modalStat}>
                      <Text style={s.modalStatLabel}>SPEED</Text>
                      <Text style={[s.modalStatValue, { color: colors.primaryDark }]}>{model.speed}</Text>
                    </View>
                    <View style={s.modalStat}>
                      <Text style={s.modalStatLabel}>RAM NEEDED</Text>
                      <Text style={[s.modalStatValue, { color: colors.primaryDark }]}>{model.ramNeeded}</Text>
                    </View>
                  </View>

                  <View style={[s.modalRecommendation, { backgroundColor: colors.cardBg }]}>
                    <Text style={[s.modalRecommendationText, { color: colors.muted }]}>{model.recommendation}</Text>
                  </View>

                  <View style={s.modalActions}>
                    {!installed && (
                      <TouchableOpacity
                        style={[s.modalBtn, { backgroundColor: colors.primary }]}
                        onPress={() => { setSelectedModel(null); handleInstall(selectedModel); }}
                      >
                        <Text style={[s.modalBtnText, { color: colors.onPrimary }]}>
                          {`DOWNLOAD (${formatSize(model.sizeBytes)})`}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {installed && !isActive && (
                      <TouchableOpacity
                        style={[s.modalBtn, { backgroundColor: colors.primary }]}
                        onPress={() => { setSelectedModel(null); setConfirmActivate(selectedModel); }}
                      >
                        <Text style={[s.modalBtnText, { color: colors.onPrimary }]}>ACTIVATE</Text>
                      </TouchableOpacity>
                    )}
                    {installed && (
                      <TouchableOpacity
                        style={[s.modalBtn, { backgroundColor: '#e06060' }]}
                        onPress={() => { setSelectedModel(null); setConfirmDelete(selectedModel); }}
                      >
                        <Text style={[s.modalBtnText, { color: '#ffffff' }]}>DELETE</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={s.modalCancel} onPress={() => setSelectedModel(null)}>
                      <Text style={[s.modalCancelText, { color: colors.muted }]}>CANCEL</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          );
        })()}

        {confirmDelete && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setConfirmDelete(null)}>
            <View style={s.modalOverlay}>
              <View style={[s.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[s.modalTitle, { color: '#e06060' }]}>
                  {confirmDelete === 'all' ? 'DELETE ALL MODELS' : 'DELETE MODEL'}
                </Text>
                <Text style={[s.modalDescription, { color: colors.primaryDark, marginTop: spacing.lg }]}>
                  {confirmDelete === 'all'
                    ? 'This will delete every downloaded model from your device. You can download one again at any time.'
                    : `Delete ${MODEL_CATALOG.find(m => m.id === confirmDelete)?.name ?? 'this model'} from your device? You can re-install it anytime.`}
                </Text>
                <View style={s.modalActions}>
                  <TouchableOpacity
                    style={[s.modalBtn, { backgroundColor: '#e06060' }]}
                    onPress={async () => {
                      if (confirmDelete === 'all') {
                        await handleDeleteAll();
                      } else {
                        await handleDelete(confirmDelete);
                      }
                      setConfirmDelete(null);
                    }}
                  >
                    <Text style={[s.modalBtnText, { color: '#ffffff' }]}>
                      {confirmDelete === 'all' ? 'DELETE ALL' : 'DELETE'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.modalCancel} onPress={() => setConfirmDelete(null)}>
                    <Text style={[s.modalCancelText, { color: colors.muted }]}>CANCEL</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        )}

        {confirmActivate && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setConfirmActivate(null)}>
            <View style={s.modalOverlay}>
              <View style={[s.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[s.modalTitle, { color: colors.primaryDark }]}>ACTIVATE MODEL</Text>
                <Text style={[s.modalDescription, { color: colors.primaryDark, marginTop: spacing.lg }]}>
                  Use {MODEL_CATALOG.find(m => m.id === confirmActivate)?.name ?? 'this model'} for local AI?
                </Text>
                <View style={s.modalActions}>
                  <TouchableOpacity
                    style={[s.modalBtn, { backgroundColor: colors.primary }]}
                    onPress={async () => { const id = confirmActivate; setConfirmActivate(null); await handleActivate(id); }}
                  >
                    <Text style={[s.modalBtnText, { color: colors.onPrimary }]}>ACTIVATE</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.modalCancel} onPress={() => setConfirmActivate(null)}>
                    <Text style={[s.modalCancelText, { color: colors.muted }]}>CANCEL</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        )}

        {Platform.OS === 'web' && (
          <>
            <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>LOCAL MODELS</Text>
            <View style={s.section}>
              <Text style={s.webNotice}>Install the Alice Wallet app to download and use local AI models on your device.</Text>
            </View>
          </>
        )}

        <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>CUSTOM SERVER</Text>
        <View style={s.section}>
          <Text style={s.customHint}>Connect to any compatible local or remote server.</Text>
          <TextInput
            style={[s.customInput, { borderColor: colors.border, color: colors.primaryDark }]}
            value={customUrl}
            onChangeText={v => { setCustomUrl(v); setCustomSaved(false); }}
            placeholder="http://192.168.0.100:11434"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[s.customInput, { borderColor: colors.border, color: colors.primaryDark }]}
            value={customModel}
            onChangeText={v => { setCustomModel(v); setCustomSaved(false); }}
            placeholder="Model name (e.g. llama3)"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[s.customInput, { borderColor: colors.border, color: colors.primaryDark }]}
            value={customKey}
            onChangeText={v => { setCustomKey(v); setCustomSaved(false); }}
            placeholder="API key (optional)"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={s.customActions}>
            <TouchableOpacity
              style={[s.actionBtn, { borderColor: colors.primary }]}
              onPress={async () => {
                if (customUrl.trim() && customModel.trim()) {
                  await setCustomServer({ url: customUrl.trim(), model: customModel.trim(), apiKey: customKey.trim() || undefined });
                  setCustomSaved(true);
                  chat.setBackendType('custom');
                } else {
                  await setCustomServer(null);
                  setCustomSaved(true);
                }
              }}
            >
              <Text style={[s.actionBtnText, { color: colors.primary }]}>{customSaved ? 'SAVED' : 'SAVE AND CONNECT'}</Text>
            </TouchableOpacity>
            {customUrl.trim() !== '' && (
              <TouchableOpacity
                style={[s.actionBtn, { borderColor: '#e06060' }]}
                onPress={async () => {
                  await setCustomServer(null);
                  setCustomUrl('');
                  setCustomModel('');
                  setCustomKey('');
                  setCustomSaved(false);
                  if (chat.backendType === 'custom' && PRIVATE_CLOUD_ENABLED) {
                    chat.setBackendType('cloud');
                  }
                }}
              >
                <Text style={[s.actionBtnText, { color: '#e06060' }]}>DISCONNECT</Text>
              </TouchableOpacity>
            )}
	          </View>
		        </View>

        <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>CLEAN YOUR DISCUSSION HISTORY</Text>
        <View style={s.section}>
          <View style={s.storageSummary}>
            <Text style={s.storageCount}>
              {chatStorage?.count ?? 0} / {MAX_CHAT_SESSIONS} CONVERSATIONS
            </Text>
            <Text style={s.storageSize}>
              {formatStorageSize(chatStorage?.estimatedBytes ?? 0)}
            </Text>
          </View>
          <Text style={s.customHint}>
            Conversations stay on this device. Alice keeps at most 50 and automatically removes the oldest when the limit is reached.
          </Text>
          <View style={s.cleanupActions}>
            <TouchableOpacity
              style={[s.actionBtn, { borderColor: colors.primary }, (chatStorage?.count ?? 0) === 0 && s.disabledBtn]}
              disabled={(chatStorage?.count ?? 0) === 0 || cleaningChat}
              onPress={() => setConfirmChatCleanup('oldest-10')}
            >
              <Text style={[s.actionBtnText, { color: colors.primary }]}>DELETE 10 OLDEST</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.actionBtn, { borderColor: colors.primary }, (chatStorage?.count ?? 0) <= 10 && s.disabledBtn]}
              disabled={(chatStorage?.count ?? 0) <= 10 || cleaningChat}
              onPress={() => setConfirmChatCleanup('keep-newest-10')}
            >
              <Text style={[s.actionBtnText, { color: colors.primary }]}>KEEP ONLY 10 NEWEST</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.actionBtn, { borderColor: '#e06060' }, (chatStorage?.count ?? 0) === 0 && s.disabledBtn]}
              disabled={(chatStorage?.count ?? 0) === 0 || cleaningChat}
              onPress={() => setConfirmChatCleanup('all')}
            >
              <Text style={[s.actionBtnText, { color: '#e06060' }]}>DELETE ALL</Text>
            </TouchableOpacity>
          </View>
        </View>

        {confirmChatCleanup && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setConfirmChatCleanup(null)}>
            <View style={s.modalOverlay}>
              <View style={[s.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[s.modalTitle, { color: '#e06060' }]}>DELETE CONVERSATIONS</Text>
                <Text style={[s.modalDescription, { color: colors.primaryDark }]}>
                  Delete {chatCleanupCount} conversation{chatCleanupCount === 1 ? '' : 's'} from this device? This cannot be undone.
                </Text>
                <View style={s.modalActions}>
                  <TouchableOpacity
                    style={[s.modalBtn, { backgroundColor: '#e06060' }]}
                    disabled={cleaningChat}
                    onPress={() => handleChatCleanup(confirmChatCleanup)}
                  >
                    <Text style={[s.modalBtnText, { color: '#ffffff' }]}>
                      {cleaningChat ? 'DELETING...' : 'DELETE'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.modalCancel}
                    disabled={cleaningChat}
                    onPress={() => setConfirmChatCleanup(null)}
                  >
                    <Text style={[s.modalCancelText, { color: colors.muted }]}>CANCEL</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        )}

        <TouchableOpacity style={[s.resetBtn, { borderColor: '#e06060' }]} onPress={handleResetDefaults}>
          <Text style={[s.resetBtnText, { color: '#e06060' }]}>RESET TO DEFAULT</Text>
        </TouchableOpacity>
	      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    backBtn: { ...pixel, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg },
    backIcon: { fontFamily: typography.pixel, fontSize: 18, color: colors.primary },
    title: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 3 },
    body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
    sectionTitle: { fontFamily: typography.pixel, fontSize: 8, color: colors.muted, letterSpacing: 2, marginBottom: spacing.sm, marginTop: spacing.lg },
    section: { ...pixel, backgroundColor: colors.cardBg, padding: spacing.lg },
    subsectionLabel: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1, marginBottom: spacing.sm },
    divider: { height: 1, backgroundColor: colors.dotted, marginVertical: spacing.md },

    presetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    presetLabel: { fontFamily: typography.pixel, fontSize: 8, color: colors.primaryDark, letterSpacing: 1 },
    presetSwitcher: { flexDirection: 'row', borderWidth: 2, borderColor: colors.border, borderRadius: 2, overflow: 'hidden' },
    presetOption: { paddingVertical: 6, paddingHorizontal: spacing.md },
    presetOptionBorder: { borderLeftWidth: 2, borderLeftColor: colors.border },
    presetOptionText: { fontFamily: typography.pixel, fontSize: 6, letterSpacing: 1 },

    modelRow: { paddingVertical: spacing.md },
    modelCard: { paddingVertical: spacing.md },
    modelRowBorder: { borderTopWidth: 1, borderTopColor: colors.dotted },
    toast: { marginHorizontal: spacing.lg, marginTop: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 2 },
    toastText: { fontFamily: typography.pixel, fontSize: 7, letterSpacing: 1, textAlign: 'center' },
    modelInfo: { marginBottom: spacing.sm },
    modelNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    modelName: { fontFamily: typography.pixel, fontSize: 9, color: colors.primaryDark, letterSpacing: 1 },
    modelSize: { fontFamily: typography.pixel, fontSize: 7, color: colors.muted },
    modelMeta: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    modelBadge: { fontFamily: typography.pixel, fontSize: 6, letterSpacing: 1 },
	    modelBadgeSecondary: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1 },
	    dropdownDescription: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1, lineHeight: 12, marginTop: spacing.xs },
	    modelActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },

	    dropdownTrigger: { ...pixel, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.background },
	    dropdownLabel: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1, marginBottom: spacing.xs },
	    dropdownChevron: { fontFamily: typography.pixel, fontSize: 12, color: colors.primary, width: 24, textAlign: 'center' },
	    dropdownMenu: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.dotted },
	    dropdownOption: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
	    dropdownOptionActive: { backgroundColor: colors.background },

    actionBtn: { ...pixel, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
    actionBtnText: { fontFamily: typography.pixel, fontSize: 7, letterSpacing: 1 },
    disabledBtn: { opacity: 0.4 },

    progressBar: { flex: 1, height: 8, backgroundColor: colors.dotted, borderRadius: 2, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 2 },
    progressText: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, width: 32, textAlign: 'right' },

    cloudRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    webNotice: { fontFamily: typography.numbers, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center' },

    cloudModelRow: { paddingVertical: spacing.md },
    radioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    radioFill: { width: 10, height: 10, borderRadius: 5 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: spacing.xl },
    modalContent: { borderWidth: 2, borderRadius: 2, padding: spacing.xl },
    modalTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 2, textAlign: 'center' },
    modalSize: { fontFamily: typography.pixel, fontSize: 8, color: colors.muted, textAlign: 'center', marginTop: spacing.xs },
    modalDescription: { fontFamily: typography.numbers, fontSize: 15, lineHeight: 22, marginTop: spacing.lg, textAlign: 'center' },
    modalStats: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.lg },
    modalStat: { alignItems: 'center' },
    modalStatLabel: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1, marginBottom: spacing.xs },
    modalStatValue: { fontFamily: typography.pixel, fontSize: 9 },
    modalRecommendation: { marginTop: spacing.lg, padding: spacing.md, borderRadius: 2 },
    modalRecommendationText: { fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    modalActions: { marginTop: spacing.xl, gap: spacing.sm },
    modalBtn: { paddingVertical: spacing.lg, alignItems: 'center', borderRadius: 2 },
    modalBtnText: { fontFamily: typography.pixel, fontSize: 8, letterSpacing: 1 },
    modalCancel: { paddingVertical: spacing.md, alignItems: 'center' },
    modalCancelText: { fontFamily: typography.pixel, fontSize: 7, letterSpacing: 1 },

	    toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    toggleLabel: { fontFamily: typography.pixel, fontSize: 10, color: colors.primaryDark, letterSpacing: 1 },
    modeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
    modeRowBorder: { borderTopWidth: 1, borderTopColor: colors.dotted, marginTop: spacing.sm, paddingTop: spacing.lg },
    modeCopy: { flex: 1 },
    modeHint: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: spacing.xs },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    profileChevron: { fontFamily: typography.pixel, fontSize: 18, color: colors.primary },
    languageOptions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
    languageOption: { borderWidth: 2, borderRadius: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    languageOptionText: { fontFamily: typography.pixel, fontSize: 7, letterSpacing: 1 },
    deleteAllBtn: { ...pixel, marginTop: spacing.lg, paddingVertical: spacing.md, alignItems: 'center' },
    deleteAllText: { fontFamily: typography.pixel, fontSize: 7, letterSpacing: 1 },

    customHint: { fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.muted, marginBottom: spacing.md },
	    customInput: { ...pixel, fontFamily: typography.numbers, fontSize: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm, backgroundColor: colors.background },
	    instructionsInput: { minHeight: 112, lineHeight: 20 },
	    customActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
    storageSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    storageCount: { fontFamily: typography.pixel, fontSize: 7, color: colors.primaryDark, letterSpacing: 1 },
    storageSize: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted },
    cleanupActions: { gap: spacing.sm },
	    resetBtn: { ...pixel, marginTop: spacing.xxl, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.cardBg },
	    resetBtnText: { fontFamily: typography.pixel, fontSize: 8, letterSpacing: 1 },
	  });
	}

function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
