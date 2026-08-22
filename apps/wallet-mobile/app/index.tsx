import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Keyboard, Platform, Animated, Easing, useWindowDimensions, Modal } from 'react-native';
import * as Network from 'expo-network';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { spacing, typography, PALETTES } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { useAccount, useChat } from '@alice-wallet/alice-ai';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ALL_PRESETS,
  CLOUD_MODELS,
  MODEL_CATALOG,
  formatSize,
  getActiveCloudModelId,
  getActiveModelId,
  getModelStatus,
  getPreset,
  PRIVATE_CLOUD_ENABLED,
  setActiveCloudModelId,
  setActiveModelId,
  setPreset,
  type AIPreset,
  type CloudModelId,
  type LocalModelId,
} from '@alice-wallet/alice-ai';
import {
  getBalance,
  getPaymentHistory,
  getTransactionHistory,
  getVtxos,
  isHdDescriptorMismatchError,
  maintainVtxosIfReady,
  NETWORK,
  rebuildLocalArkadeIndex,
  syncVtxosIfReady,
  type WalletState,
} from '@alice-wallet/wallet-core';
import { PixelFill, PixelWaveTransition, type PixelWavePhase } from '@alice-wallet/alice-ui';
import { BitcoinIcon } from '@alice-wallet/alice-ui';
import { SettingsIcon } from '@alice-wallet/alice-ui';
import { CornerButton } from '@alice-wallet/alice-ui';
import { AliceLogo } from '@alice-wallet/alice-ui';
import { AliceIcon } from '@alice-wallet/alice-ui';
import { ClockIcon } from '@alice-wallet/alice-ui';
import { getBalanceFormat, setBalanceFormat, formatBalance, balanceSuffix, formatSecondary, nextFormat, type BalanceFormat } from '@alice-wallet/alice-ui';
import { getFiatCurrency, priceApiUrl, CURRENCY_SYMBOL, type FiatCurrency } from '@alice-wallet/alice-ui';
import { isBackupComplete } from '../lib/onboarding';
import { WalletAmount } from '@alice-wallet/alice-ui';
import { buildHomeRecentHistoryEntries, type HistoryEntry } from '@alice-wallet/wallet-core';
// Alice opens as its own chat surface: the launch wave keeps the wallet accent
// color, then the conversation settles into the dark palette for readability.
const OFFLINE_MESSAGE = 'OFFLINE. YOUR WALLET IS READY, THE BALANCE REFRESHES ONCE CONNECTED.';
const VTXO_WARNING_MS = 3 * 24 * 60 * 60 * 1_000;
const LOCAL_WEB_MESSAGE = 'Local AI is not available in the web wallet. Install the Alice Wallet app to run models on this device.';
const CHAT_TRANSITION_MS = 600;
const WALLET_SNAPSHOT_KEY = 'alice_wallet_home_snapshot_v1';
// Typewriter pacing for streamed replies: a floor so short answers still visibly
// type, and a ceiling on how long the longest answer takes so a big one-shot
// reply types out briskly rather than crawling.
const TYPE_MIN_CPS = 45;
const TYPE_MAX_SECONDS = 2.5;

const PRESET_LABELS: Record<AIPreset, string> = {
  fast: 'Light',
  balanced: 'Normal',
  deep: 'High',
};

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*.+?\*\*)/g).map((part, index) => {
    const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    if (!bold) return <Text key={`${part}-${index}`}>{part}</Text>;

    return (
      <Text key={`${part}-${index}`} style={s.markdownStrong}>
        {part.slice(2, -2)}
      </Text>
    );
  });
}

function ChatMarkdownText({ content, style, color }: { content: string; style: any; color: string }) {
  const lines = content.split('\n');

  return (
    <View style={s.markdownWrap}>
      {lines.map((line, index) => {
        // Horizontal rule: a line that is only ---, ***, or ___ (3+ of the same
        // mark). The model emits these as section dividers; draw an actual line
        // instead of leaking the literal dashes into the bubble.
        const rule = line.match(/^\s*([-*_])\1{2,}\s*$/);
        if (rule) {
          return <View key={`hr-${index}`} style={[s.markdownHr, { backgroundColor: color }]} />;
        }

        // Headings: strip the leading #### markers the model emits and render the
        // title in bold. Without this the raw "## Title" hashes leak into the
        // bubble, the same bug that was already fixed on web.
        const heading = line.match(/^\s*(#{1,6})\s*(.+?)\s*#*$/);
        if (heading) {
          const level = heading[1].length;
          return (
            <Text
              key={`${line}-${index}`}
              style={[style, s.markdownHeading, level <= 2 && s.markdownHeadingLarge, { color }]}
            >
              {renderInlineMarkdown(heading[2])}
            </Text>
          );
        }

        const bullet = line.match(/^\s*[-*]\s+(.+)$/);
        if (bullet) {
          return (
            <View key={`${line}-${index}`} style={s.markdownBulletRow}>
              <Text style={[style, s.markdownBullet, { color }]}>•</Text>
              <Text style={[style, s.markdownBulletText, { color }]}>
                {renderInlineMarkdown(bullet[1])}
              </Text>
            </View>
          );
        }

        if (!line.trim()) return <View key={`${line}-${index}`} style={s.markdownSpacer} />;

        return (
          <Text key={`${line}-${index}`} style={[style, { color }]}>
            {renderInlineMarkdown(line)}
          </Text>
        );
      })}
    </View>
  );
}

type HomeWalletSnapshot = {
  wallet: WalletState;
  recentEntries: HistoryEntry[];
  expiringVtxos: number;
  savedAt: number;
};

function isWalletSnapshot(value: unknown): value is HomeWalletSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const wallet = record.wallet as Partial<WalletState> | undefined;
  return Boolean(
    wallet
    && typeof wallet.balance === 'number'
    && Array.isArray(record.recentEntries)
    && typeof record.expiringVtxos === 'number'
    && typeof record.savedAt === 'number',
  );
}

async function loadHomeWalletSnapshot(): Promise<HomeWalletSnapshot | null> {
  const raw = await AsyncStorage.getItem(WALLET_SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isWalletSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveHomeWalletSnapshot(snapshot: HomeWalletSnapshot): Promise<void> {
  await AsyncStorage.setItem(WALLET_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

// Reveals `target` progressively so a streamed answer reads as if it is being
// typed instead of landing in whole chunks. The backend still delivers the text
// in bursts (whole tokens/sentences); this is a pure display lag on top of it.
// The initial `shown` snaps to whatever content is present at mount, so a
// message that is ALREADY complete when it first renders, every message in a
// restored conversation, shows instantly and never replays the typing. Only a
// message that mounts empty (a live generation) and then grows animates. When
// the target shrinks (a variant switch) it snaps too.
function useTypewriter(target: string, enabled: boolean): string {
  const [shown, setShown] = useState(target.length);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (!enabled) {
      if (shownRef.current !== target.length) setShown(target.length);
      return;
    }
    if (target.length <= shownRef.current) {
      if (target.length < shownRef.current) setShown(target.length);
      return;
    }
    let raf = 0;
    let last = 0;
    const step = (ts: number) => {
      const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0;
      last = ts;
      const gap = target.length - shownRef.current;
      // Reveal at a steady, readable "typing" pace. The rate scales with the gap
      // so it keeps up with a fast stream and so a whole answer delivered at once
      // (buffered / E2EE, where nothing streams) still types out over a bounded
      // ~2.5s instead of flashing in complete. Earlier this used gap*3, which for
      // a long one-shot answer meant a near-instant pop, the bug that made the
      // reply appear all at once after the thinking dots.
      const rate = Math.max(TYPE_MIN_CPS, gap / TYPE_MAX_SECONDS);
      const next = Math.min(target.length, shownRef.current + Math.max(1, Math.round(rate * dt)));
      setShown(next);
      if (next < target.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);

  return enabled ? target.slice(0, shown) : target;
}

// The "Alice is thinking" indicator: three dots that pulse in sequence. Replaces
// the static "..." string that never moved while a reply was being generated.
function TypingDots({ color }: { color: string }) {
  const dots = useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]).current;

  useEffect(() => {
    // Each dot is a pure up/down timing loop (no Animated.delay node inside the
    // loop: a delay at the loop boundary needs the JS thread to re-arm the next
    // iteration, so it stalls while the reply is being generated/decrypted, the
    // "dots freeze until the message lands" bug). The sequential offset comes
    // from staggering the *start* instead, and isInteraction:false keeps the
    // loops off the InteractionManager so nothing pauses them.
    const loops = dots.map(value =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 1, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false }),
          Animated.timing(value, { toValue: 0.3, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false }),
        ]),
      ),
    );
    const timers = dots.map((_, i) => setTimeout(() => loops[i].start(), i * 200));
    return () => { timers.forEach(clearTimeout); loops.forEach(loop => loop.stop()); };
  }, [dots]);

  return (
    <View style={s.typingDots}>
      {dots.map((value, i) => (
        <Animated.View key={i} style={[s.typingDot, { opacity: value, backgroundColor: color }]} />
      ))}
    </View>
  );
}

// Assistant bubble body: pulsing dots while empty, then the typed-out markdown.
// A component (not inline in renderItem) so the typewriter hook is legal.
function AssistantText({ content, color, animate }: { content: string; color: string; animate: boolean }) {
  const displayed = useTypewriter(content, animate);
  if (!displayed) return <TypingDots color={color} />;
  return <ChatMarkdownText content={displayed} style={s.bubbleText} color={color} />;
}

function recentDescription(entry: HistoryEntry): string {
  const layer = entry.kind === 'transaction' ? entry.transaction.layer : entry.payment.layer;
  if (layer === 'lightning') return 'Lightning';
  if (layer === 'onchain') return 'On-chain';
  return 'Arkade';
}

export default function WalletScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, pixel, palette } = useTheme();
  const chatTheme = PALETTES[palette].dark;
  const chatBg = chatTheme.background;
  const chatSoft = chatTheme.backgroundSoft;
  const chatInk = chatTheme.text;
  const chatMuted = chatTheme.muted;
  const chatBorder = chatTheme.border;
  const chatFieldBg = chatSoft;
  const chatFieldBorder = chatBorder;
  const chatPlaceholder = chatMuted;
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [balFmt, setBalFmt] = useState<BalanceFormat>('symbol');
  const [walletError, setWalletError] = useState<string | null>(null);
  const [showIndexRepair, setShowIndexRepair] = useState(false);
  const [rebuildingIndex, setRebuildingIndex] = useState(false);
  const [indexRepairError, setIndexRepairError] = useState<string | null>(null);
  const [recentEntries, setRecentEntries] = useState<HistoryEntry[]>([]);
  const [backupComplete, setBackupComplete] = useState<boolean | null>(null);
  const [expiringVtxos, setExpiringVtxos] = useState(0);
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [currency, setCurrency] = useState<FiatCurrency>('USD');
  const [chatState, setChatState] = useState<PixelWavePhase>('closed');
  const [showHistory, setShowHistory] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [localPreset, setLocalPresetState] = useState<AIPreset>('balanced');
  const [cloudPreset, setCloudPresetState] = useState<AIPreset>('balanced');
  const [activeModelId, setActiveModelState] = useState<LocalModelId>('qwen3-0.6b');
  const [activeCloudModelId, setActiveCloudModelState] = useState<CloudModelId>('alice-cloud');
  const [installedModelIds, setInstalledModelIds] = useState<LocalModelId[]>([]);
  const { width: winW, height: winH } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Android reports the keyboard height measured from the top of the navigation
  // bar, but under edge-to-edge this surface extends behind that bar. Padding by
  // the reported height alone therefore leaves the composer exactly one
  // navigation bar too low, hidden under the bottom of the keyboard. Measured on
  // a Galaxy A15: true inset 1008px, reported 873px, navigation bar 135px.
  // iOS already measures from the screen edge, so adding there would overshoot.
  const keyboardInset = keyboardHeight > 0 && Platform.OS === 'android'
    ? keyboardHeight + insets.bottom
    : keyboardHeight;
  const chatInputBottomPadding = keyboardHeight > 0
    ? spacing.md
    : Platform.OS === 'web'
      ? spacing.xl
      : Math.max(spacing.xl, insets.bottom + spacing.lg);
  const chatHorizontalInset = Math.max(spacing.lg, ((winW || 0) - 896) / 2 + spacing.lg);
  const modelMenuTopOffset = insets.top + 60;
  const compactChatComposer = winW > 0 && winW < 768;
  const chat = useChat();
  const account = useAccount();
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  // A "jump to latest" arrow shown only once the user has scrolled up away from
  // the newest message. With an inverted list the newest message sits at scroll
  // offset 0 (the visual bottom), so "scrolled up" is a positive offset.
  const [showScrollDown, setShowScrollDown] = useState(false);
  const latestWalletRef = useRef<WalletState | null>(null);
  const latestRecentEntriesRef = useRef<HistoryEntry[]>([]);
  const latestExpiringVtxosRef = useRef(0);
  const walletRefreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  // Newest-first, for an inverted FlatList. The list renders bottom-to-top, so
  // the last message is anchored to the visual bottom and stays pinned above the
  // composer and keyboard on its own. This replaces the manual scroll-to-end,
  // which raced content growth (the reply typing in) and keyboard resizes and
  // kept leaving the last line hidden behind the composer.
  const invertedMessages = useMemo(() => [...chat.messages].reverse(), [chat.messages]);

  const scrollToLatest = useCallback((animated: boolean) => {
    listRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  // Track keyboard height so the chat input can sit just above it while the
  // wallet section collapses to make room (edge-to-edge ignores adjustResize).
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, e => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // Note: no manual scroll on keyboard open is needed. The inverted list keeps
  // the newest message at the visual bottom, so when the keyboard shrinks the
  // list the last line stays anchored just above the composer on its own.

  const walletCollapsed = chatState === 'open';
  const backendUnavailableSelected =
    (chat.backendType === 'cloud' && !chat.backendEnabled.cloud)
    || (chat.backendType === 'local' && (!chat.backendEnabled.local || Platform.OS === 'web' || chat.backendStatus.state === 'error'))
    || (chat.backendType === 'custom' && chat.backendStatus.state === 'error');
  const backendUnavailableMessage = chat.backendType === 'cloud' && !chat.backendEnabled.cloud
    ? 'Private Cloud is disabled. Enable it in settings or choose Local AI.'
    : chat.backendType === 'local' && !chat.backendEnabled.local
      ? 'Local AI is disabled. Enable it in settings or choose Private Cloud.'
    : chat.backendType === 'local' && Platform.OS === 'web'
    ? LOCAL_WEB_MESSAGE
    : chat.backendStatus.state === 'error'
      ? chat.backendStatus.message
      : 'This AI mode is unavailable.';
  const activePreset = chat.backendType === 'cloud' ? cloudPreset : localPreset;
  const activeModeLabel = chat.backendType === 'cloud'
    ? 'Private'
    : chat.backendType === 'custom'
      ? 'Custom'
      : 'Local';

  const params = useLocalSearchParams<{ intro?: string }>();
  const [introActive, setIntroActive] = useState(params.intro === 'pixel');
  const introProgress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (params.intro !== 'pixel') return;
    setIntroActive(true);
    introProgress.setValue(1);
    // Safety net: clear the intro even if PixelFill's onReady never fires.
    const done = setTimeout(() => {
      setIntroActive(false);
      router.setParams({ intro: '' });
    }, 2500);
    return () => clearTimeout(done);
  }, [params.intro]);

  // Started from PixelFill's onReady so the grid is mounted before progress
  // moves, otherwise the natively driven clear runs ahead of first paint.
  const startIntroAnimation = () => {
    introProgress.setValue(1);
    Animated.timing(introProgress, {
      toValue: 0,
      duration: 900,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => {
      setIntroActive(false);
      router.setParams({ intro: '' });
    });
  };

  // No auto-focus: let the user tap the input field when they want to type,
  // instead of forcing the keyboard open immediately after the animation.

  const refreshWallet = useCallback(() => {
    if (rebuildingIndex) return;
    if (walletRefreshInFlightRef.current) {
      // Asked while a pass is running (typically on regaining focus after a
      // renewal): run once more when it ends rather than drop the request.
      refreshQueuedRef.current = true;
      return;
    }
    walletRefreshInFlightRef.current = true;
    // One sequential pass and one snapshot write per cycle. Three parallel
    // chains used to race each other, re-render the screen several times and
    // write the same snapshot three times, enough to make a tap stutter.
    void (async () => {
      try {
        // Offline is a state, not a failure to wait out: say so at once instead
        // of letting the Ark connection time out while the balance sits blank.
        // The wallet itself is usable; only the balance and history need the
        // network.
        const net = Platform.OS === 'web' ? null : await Network.getNetworkStateAsync().catch(() => null);
        if (net?.isConnected === false) throw new Error(OFFLINE_MESSAGE);
        await syncVtxosIfReady().catch(cause => {
          console.warn('Unable to synchronize Arkade before refreshing the balance.', cause);
        });
        const nextWallet = await getBalance();
        setWalletError(null);
        latestWalletRef.current = nextWallet;
        setWallet(nextWallet);

        const [transactionsResult, paymentsResult] = await Promise.allSettled([getTransactionHistory(), getPaymentHistory()]);
        const transactions = transactionsResult.status === 'fulfilled' ? transactionsResult.value : [];
        const payments = paymentsResult.status === 'fulfilled' ? paymentsResult.value : [];
        const entries = buildHomeRecentHistoryEntries(transactions, payments, 2);
        latestRecentEntriesRef.current = entries;
        setRecentEntries(entries);

        const vtxos = await getVtxos().catch(() => null);
        if (vtxos) {
          const count = vtxos.filter(vtxo =>
            (vtxo.state === 'preconfirmed' || vtxo.state === 'settled')
            && vtxo.batchExpiry !== undefined
            && vtxo.batchExpiry > Date.now()
            && vtxo.batchExpiry - Date.now() <= VTXO_WARNING_MS
          ).length;
          latestExpiringVtxosRef.current = count;
          setExpiringVtxos(count);
        }

        await saveHomeWalletSnapshot({
          wallet: nextWallet,
          recentEntries: latestRecentEntriesRef.current,
          expiringVtxos: latestExpiringVtxosRef.current,
          savedAt: Date.now(),
        }).catch(() => {});

        // Maintenance is rate-limited to once every five minutes inside
        // wallet-core; it runs after the screen has its fresh numbers.
        void maintainVtxosIfReady().catch(cause => {
          console.warn('Unable to complete automatic VTXO maintenance.', cause);
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Wallet unavailable.';
        if (msg.includes('onboarding') || msg.includes('Complete wallet')) {
          router.replace('/onboarding');
          return;
        }
        setWalletError(msg);
      } finally {
        walletRefreshInFlightRef.current = false;
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false;
          refreshWalletRef.current?.();
        }
      }
    })();
  }, [rebuildingIndex, router]);
  const refreshWalletRef = useRef<(() => void) | null>(null);
  refreshWalletRef.current = refreshWallet;

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await loadHomeWalletSnapshot();
        if (cancelled) return;
        if (!snapshot) return;
        // The snapshot only fills an empty screen. Once live numbers exist,
        // a stale stored count (a VTXO renewed a minute ago) must not come
        // back on top of them when the screen regains focus.
        if (!latestWalletRef.current) {
          latestWalletRef.current = snapshot.wallet;
          latestRecentEntriesRef.current = snapshot.recentEntries;
          latestExpiringVtxosRef.current = snapshot.expiringVtxos;
          setWallet(snapshot.wallet);
          setRecentEntries(current => current.length ? current : snapshot.recentEntries);
          setExpiringVtxos(snapshot.expiringVtxos);
        }
      } catch {
      } finally {
        if (!cancelled) refreshWallet();
      }
    })();
    isBackupComplete().then(setBackupComplete).catch(() => setBackupComplete(false));
    getBalanceFormat().then(setBalFmt).catch(() => {});
    getFiatCurrency().then(setCurrency).catch(() => {});
    // Thirty seconds: a received payment still shows within the time it takes
    // to look up from the phone, and the JS thread is free far more often.
    pollRef.current = setInterval(refreshWallet, 30_000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshWallet]));

  useEffect(() => {
    fetch(priceApiUrl(currency))
      .then(r => r.json())
      .then(data => setBtcPrice(parseFloat(data.data.amount)))
      .catch(() => {});
  }, [currency]);

  const refreshAIModelState = useCallback(async () => {
    const [localId, cloudId, localQuality, cloudQuality] = await Promise.all([
      getActiveModelId(),
      getActiveCloudModelId(),
      getPreset('local'),
      getPreset('cloud'),
    ]);
    setActiveModelState(localId);
    setActiveCloudModelState(cloudId);
    setLocalPresetState(localQuality);
    setCloudPresetState(cloudQuality);

    if (Platform.OS === 'web') {
      setInstalledModelIds([]);
      return;
    }

    const statuses = await Promise.all(
      MODEL_CATALOG.map(async model => ({ id: model.id, status: await getModelStatus(model.id) })),
    );
    setInstalledModelIds(statuses.filter(model => model.status === 'installed').map(model => model.id));
  }, []);

  useEffect(() => {
    refreshAIModelState().catch(() => {});
  }, [refreshAIModelState]);

  async function choosePreset(preset: AIPreset) {
    if (chat.backendType === 'cloud') {
      setCloudPresetState(preset);
      await setPreset('cloud', preset);
    } else {
      setLocalPresetState(preset);
      await setPreset('local', preset);
    }
    setModelMenuOpen(false);
  }

  async function chooseLocalModel(id: LocalModelId) {
    if (!chat.backendEnabled.local) return;
    setActiveModelState(id);
    await setActiveModelId(id);
    chat.setBackendType('local');
    setModelMenuOpen(false);
    setShowHistory(false);
  }

  async function chooseCloudModel(id: CloudModelId) {
    if (!chat.backendEnabled.cloud) return;
    setActiveCloudModelState(id);
    await setActiveCloudModelId(id);
    chat.setBackendType('cloud');
    setModelMenuOpen(false);
    setShowHistory(false);
  }

  const balance = wallet?.offchainBalance ?? wallet?.balance ?? 0;
  const canRebuildLocalIndex = walletError !== null && isHdDescriptorMismatchError(walletError);

  const rebuildWalletIndex = useCallback(async () => {
    setRebuildingIndex(true);
    setIndexRepairError(null);
    setWalletError(null);
    let rebuilt = false;
    try {
      const recoveredWallet = await rebuildLocalArkadeIndex();
      latestWalletRef.current = recoveredWallet;
      setWallet(recoveredWallet);
      setRecentEntries([]);
      latestRecentEntriesRef.current = [];
      setShowIndexRepair(false);
      rebuilt = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet index rebuild failed.';
      setIndexRepairError(message);
      setWalletError(message);
    } finally {
      setRebuildingIndex(false);
      if (rebuilt) refreshWallet();
    }
  }, [refreshWallet]);

  function openChat() {
    chat.showGreeting();
    setChatState('opening');
  }

  function closeChat() {
    setModelMenuOpen(false);
    setShowHistory(false);
    inputRef.current?.blur();
    setChatState('closing');
  }

  async function send() {
    // Jump back to the newest message in case the user had scrolled up; the
    // inverted list keeps it pinned there while their message and the reply
    // type in, so no follow-up scrolling is needed.
    setShowScrollDown(false);
    scrollToLatest(true);
    await chat.send();
  }

  return (
    // Plain full-screen root: the pixel transition and the intro overlay must
    // be positioned from the physical screen origin, so they live outside the
    // SafeAreaView (whose padding would offset them out of the safe areas).
    <View style={[s.root, { backgroundColor: colors.background }]}>
    <SafeAreaView style={s.safe}>
      {/* Top wallet content, Alice opens as its own full-screen surface. */}
      {!walletCollapsed && (
      <View style={s.top}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.push('/settings')}>
            <SettingsIcon size={27} color={colors.primaryDark} />
          </TouchableOpacity>
          <View style={{ width: 36 }} />
        </View>

        {expiringVtxos > 0 && (
          <TouchableOpacity
            style={[s.vtxoBanner, pixel]}
            onPress={() => router.push('/coin-control')}
            accessibilityRole="alert"
          >
            <View style={s.vtxoCopy}>
              <Text style={[s.vtxoTitle, { color: colors.danger }]}>VTXO EXPIRING SOON</Text>
              <Text style={[s.vtxoDescription, { color: colors.dangerInk }]}>{expiringVtxos} coin{expiringVtxos === 1 ? '' : 's'} need{expiringVtxos === 1 ? 's' : ''} attention.</Text>
            </View>
            <Text style={[s.vtxoAction, { color: colors.danger }]}>REVIEW →</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={s.balanceArea}
          onPress={() => {
            const next = nextFormat(balFmt);
            setBalFmt(next);
            setBalanceFormat(next);
          }}
          activeOpacity={0.7}
        >
          <View style={s.balanceRow}>
            {balFmt === 'symbol' && (
              <View style={s.btcIconWrap}>
                <BitcoinIcon size={56} color={colors.primaryDark} />
              </View>
            )}
            <Text style={[s.balance, { color: colors.primaryDark }]}>{formatBalance(balance, balFmt, btcPrice, CURRENCY_SYMBOL[currency])}</Text>
            {balanceSuffix(balFmt) && (
              <Text style={[s.balanceSuffix, { color: colors.muted }]}>{balanceSuffix(balFmt)}</Text>
            )}
          </View>
          {(() => {
            const secondary = formatSecondary(balance, balFmt, btcPrice, CURRENCY_SYMBOL[currency]);
            return secondary ? <Text style={[s.fiat, { color: colors.muted }]}>{secondary}</Text> : null;
          })()}
          {walletError && (
            <TouchableOpacity onPress={refreshWallet}>
              <Text style={[s.walletError, { color: colors.danger }]}>{walletError}{'\n'}TAP TO RETRY</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        {canRebuildLocalIndex && (
          <View style={[s.indexRepairCard, { borderColor: colors.primaryDark }]}>
            <Text style={[s.indexRepairTitle, { color: colors.primaryDark }]}>LOCAL WALLET INDEX</Text>
            <Text style={[s.indexRepairDescription, { color: colors.muted }]}>This device has an Arkade index from a different wallet or network. Your recovery words and swap recovery data stay untouched.</Text>
            <TouchableOpacity
              style={[s.indexRepairButton, { backgroundColor: colors.primaryDark }]}
              onPress={() => setShowIndexRepair(true)}
              disabled={rebuildingIndex}
            >
              <Text style={[s.indexRepairButtonText, { color: colors.background }]}>REBUILD LOCAL INDEX</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={[s.testnetWarning, { color: colors.danger }]}>
          {NETWORK === 'bitcoin'
            ? 'MAINNET BETA · START WITH SMALL AMOUNTS'
            : 'This wallet is on Mutinynet, coins have no value'}
        </Text>

        <View style={s.actions}>
          <TouchableOpacity onPress={() => router.push('/receive')}>
            <CornerButton label="RECEIVE" color={colors.primaryDark} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/send')}>
            <CornerButton label="SEND" color={colors.primaryDark} />
          </TouchableOpacity>
        </View>

        {backupComplete === false && (
          <TouchableOpacity
            style={[s.backupBanner, { borderColor: colors.danger }]}
            onPress={() => router.push('/backup')}
          >
            <Text style={[s.backupDescription, { color: colors.danger }]}>Protect your Bitcoin with your 12 recovery words.</Text>
            <Text style={[s.backupAction, { color: colors.danger }]}>BACK UP YOUR WALLET NOW →</Text>
          </TouchableOpacity>
        )}

        {recentEntries.length > 0 && (
          <View style={s.recentTransactions}>
            {recentEntries.map((entry, index) => {
              const direction = entry.kind === 'transaction' ? entry.transaction.type : entry.payment.direction;
              const amount = entry.kind === 'transaction' ? entry.transaction.amount : entry.payment.amountSats;
              return (
                <TouchableOpacity
                  key={`${entry.kind}-${entry.id}-${index}`}
                  style={[s.transactionRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.dotted }]}
                  onPress={() => router.push({ pathname: '/transaction', params: { txId: entry.id, kind: entry.kind } })}
                >
                  <Text style={{ width: 20, fontFamily: typography.pixel, fontSize: 12, color: colors.primary, textAlign: 'center' as const }}>{direction === 'incoming' ? '↓' : '↑'}</Text>
                  <View style={s.transactionDetails}>
                    <Text style={[s.transactionType, { color: colors.primaryDark }]}>
                      {recentDescription(entry)}
                    </Text>
                    <Text style={[s.transactionDate, { color: colors.muted }]}>
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <WalletAmount
                    sats={amount}
                    direction={direction}
                    format={balFmt}
                    btcPrice={btcPrice}
                    currencySymbol={CURRENCY_SYMBOL[currency]}
                    iconSize={18}
                    iconColor={direction === 'incoming' ? colors.primaryDark : colors.muted}
                    textStyle={[s.transactionAmount, { color: direction === 'incoming' ? colors.primaryDark : colors.muted }]}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TouchableOpacity style={s.dashTrigger} onPress={() => router.push('/history')}>
          <View style={s.dashIcon}>
            <View style={[s.dash, { backgroundColor: colors.muted }]} />
            <View style={[s.dash, { backgroundColor: colors.muted }]} />
            <View style={[s.dash, { backgroundColor: colors.muted }]} />
          </View>
          <Text style={[s.historyLabel, { color: colors.muted }]}>HISTORY</Text>
        </TouchableOpacity>
      </View>
      )}

      {/* Chat zone, full width */}
      <View style={s.chatZone}>
        {/* Keep the launcher behind the transition so the bottom edge never
            loses or gains it on a single frame. */}
        {chatState !== 'open' && chat.aiEnabled && (
          <View
            style={s.bottomAnchor}
            pointerEvents={chatState === 'closed' ? 'auto' : 'none'}
          >
            <TouchableOpacity style={s.pill} onPress={openChat}>
              <AliceLogo size={44} color={colors.primaryDark} />
              <View style={s.pillTextWrap}>
                <Text style={[s.pillTextTop, { color: colors.primaryDark }]}>ASK</Text>
                <Text style={[s.pillTextBottom, { color: colors.primaryDark }]}>ALICE</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>

      {/* The live chat surface is revealed by the wave inside the transition:
          one Animated.Value drives both, so they can never drift apart. */}
      <PixelWaveTransition
        phase={chatState}
        color={colors.primary}
        waveWidth={0.32}
        durationMs={CHAT_TRANSITION_MS}
        onOpened={() => setChatState('open')}
        onClosed={() => setChatState('closed')}
      >
          <View style={[s.chatSurface, {
            backgroundColor: chatBg,
            paddingTop: insets.top,
            paddingBottom: keyboardInset,
          }]}>
            <View style={s.chatHeader}>
              <View style={s.chatHeaderSide}>
                <TouchableOpacity onPress={closeChat} style={s.chatHeaderBtn}>
                  <Text style={[s.chatHeaderBackIcon, { color: chatInk }]}>←</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={s.chatModelTitle}
                onPress={() => {
                  setShowHistory(false);
                  setModelMenuOpen(true);
                  refreshAIModelState().catch(() => {});
                }}
              >
                <Text style={[s.chatModelTitleText, { color: chatMuted }]} numberOfLines={1}>
                  {activeModeLabel}
                </Text>
                <View style={[s.chatModelChevron, { borderColor: chatMuted }]} />
              </TouchableOpacity>
              <View style={s.chatHeaderRight}>
                <TouchableOpacity onPress={() => { setModelMenuOpen(false); chat.refreshSessions(); setShowHistory(h => !h); }} style={s.chatHeaderBtn}>
                  <ClockIcon size={20} color={chatInk} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setModelMenuOpen(false); setShowHistory(false); chat.clearMessages(); }} style={s.chatHeaderBtn}>
                  <Text style={[s.chatHeaderBtnText, { color: chatInk }]}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {showHistory ? (
              <View style={s.historyPanel}>
                {chat.sessions.length === 0 ? (
                  <View style={s.historyEmpty}>
                    <Text style={[s.historyEmptyText, { color: chatInk }]}>NO PAST CONVERSATIONS</Text>
                  </View>
                ) : (
                  <FlatList
                    data={chat.sessions}
                    keyExtractor={item => item.id}
                    contentContainerStyle={s.historyList}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[s.historyRow, { borderBottomColor: chatBorder }]}
                        onPress={() => { setShowHistory(false); chat.openSession(item.id); }}
                      >
                        <View style={s.historyRowContent}>
                          <Text style={[s.historyTitle, { color: chatInk }]} numberOfLines={2}>{item.title}</Text>
                          <Text style={[s.historyMeta, { color: chatMuted }]}>
                            {new Date(item.updatedAt).toLocaleDateString()} · {item.messageCount} msg
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={s.historyDelete}
                          onPress={() => chat.removeSession(item.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={[s.historyDeleteText, { color: chatMuted }]}>×</Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    )}
                  />
                )}
              </View>
            ) : backendUnavailableSelected ? (
	              <View style={s.localNotice}>
	                <AliceIcon size={44} color={chatInk} />
	                <Text style={[s.localNoticeText, { color: chatInk }]}>
	                  {backendUnavailableMessage}
	                </Text>
	                {(chat.backendType === 'custom' || Platform.OS !== 'web') && (
	                  <TouchableOpacity style={[s.localNoticeBtn, { borderColor: chatInk }]} onPress={() => { closeChat(); router.push('/ai-settings'); }}>
	                    <Text style={[s.localNoticeBtnText, { color: chatInk }]}>GO TO SETTINGS</Text>
	                  </TouchableOpacity>
	                )}
	              </View>
	            ) : (
	              <View style={s.listWrap}>
	              <FlatList
	                ref={listRef}
	                inverted
	                // Android can leave transformed, recycled cells behind while a
	                // streamed answer grows. Keeping the small conversation list
	                // mounted trades a little memory for a stable chat surface.
	                removeClippedSubviews={false}
	                style={s.chatListFlex}
	                data={invertedMessages}
	                keyExtractor={m => m.id}
	                contentContainerStyle={s.chatList}
	                showsVerticalScrollIndicator={false}
	                keyboardShouldPersistTaps="handled"
	                scrollEventThrottle={16}
	                onScroll={e => {
	                  // Inverted list: offset 0 is the visual bottom (newest). A
	                  // positive offset means the user has scrolled up into history.
	                  const y = e.nativeEvent.contentOffset.y;
	                  const shouldShow = y > 220;
	                  setShowScrollDown(prev => (prev === shouldShow ? prev : shouldShow));
	                }}
	                renderItem={({ item }) => {
	                  if (item.role === 'system') {
	                    return (
	                      <View style={s.systemRow}>
	                        <Text style={[s.systemText, { color: chatMuted }]}>{item.content}</Text>
	                      </View>
	                    );
	                  }
	                  const isUser = item.role === 'user';
	                  return (
	                    <View style={[s.msgRow, isUser && s.msgRowUser]}>
	                      {!isUser && (
	                        <View style={s.assistantIcon}>
	                          <AliceIcon size={30} color={chatInk} />
	                        </View>
	                      )}
	                      <View style={[s.bubble, isUser ? [s.bubbleUser, { backgroundColor: colors.primary }] : s.bubbleAssistant]}>
	                        {isUser ? (
	                          <Text style={[s.bubbleText, s.bubbleTextUser, { color: chatBg }]}>
	                            {item.content || '...'}
	                          </Text>
	                        ) : (
	                          <>
	                            <AssistantText
                              content={item.content}
                              color={chatInk}
                              animate={item.id !== 'greeting'}
                            />
	                            {item.truncated && (
	                              <Text style={[s.truncatedNotice, { color: chatMuted }]}>
	                                Response may be incomplete. Try asking again with a shorter prompt.
	                              </Text>
	                            )}
	                          </>
	                        )}
	                      </View>
	                    </View>
	                  );
	                }}
	              />
	              {showScrollDown && (
	                <TouchableOpacity
	                  style={[s.scrollDownBtn, { backgroundColor: colors.primary }]}
	                  onPress={() => { setShowScrollDown(false); scrollToLatest(true); }}
	                  accessibilityLabel="Scroll to latest message"
	                >
	                  <Text style={[s.scrollDownIcon, { color: chatBg }]}>↓</Text>
	                </TouchableOpacity>
	              )}
	              </View>
	            )}

            {!showHistory && !backendUnavailableSelected && (
            <View style={[
              s.inputRow,
              compactChatComposer && s.inputRowCompact,
              {
                paddingBottom: chatInputBottomPadding,
                backgroundColor: compactChatComposer ? chatFieldBg : 'transparent',
                borderColor: chatFieldBorder,
              },
            ]}>
              <View style={[
                s.inputBox,
                compactChatComposer && s.inputBoxCompact,
                { backgroundColor: chatFieldBg, borderColor: chatFieldBorder },
              ]}>
                <TextInput
                  ref={inputRef}
                  style={[
                    s.input,
                    compactChatComposer && s.inputCompact,
                    { color: chatInk },
                    Platform.OS === 'web' && ({ outlineStyle: 'none', fontSize: 17, lineHeight: 24 } as any),
                  ]}
                  value={chat.input}
                  onChangeText={chat.setInput}
                  placeholder="Ask Alice something..."
                  placeholderTextColor={chatPlaceholder}
                  multiline
                  maxLength={500}
                  onSubmitEditing={() => send()}
                  blurOnSubmit
                />
                <View style={s.inputControlsRow}>
                  {!compactChatComposer && <View style={s.inputControlsSpacer} />}
	                <TouchableOpacity style={[s.sendBtn, { backgroundColor: colors.primary }]} onPress={() => send()} disabled={!chat.input.trim() || chat.busy || backendUnavailableSelected}>
                    <Text style={[s.sendIcon, { color: chatBg }]}>↑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            )}
          </View>
      </PixelWaveTransition>

      <Modal
        visible={modelMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModelMenuOpen(false)}
      >
        <TouchableOpacity
          style={[
            s.modelMenuBackdrop,
            {
              paddingTop: modelMenuTopOffset,
              paddingLeft: chatHorizontalInset,
              paddingRight: chatHorizontalInset,
            },
          ]}
          activeOpacity={1}
          onPress={() => setModelMenuOpen(false)}
        >
          <View style={[s.modelMenu, { backgroundColor: chatBg, borderColor: chatBorder }]}>
            <Text style={[s.modelMenuSection, { color: chatMuted }]}>REASONING</Text>
            <View style={s.modelReasoningRow}>
              {ALL_PRESETS.map(preset => {
                const active = preset === activePreset;
                return (
                  <TouchableOpacity
                    key={preset}
                    style={[s.modelReasoningChip, active && { backgroundColor: colors.primary }]}
                    onPress={() => void choosePreset(preset)}
                  >
                    <Text style={[s.modelReasoningText, { color: active ? chatBg : chatInk }]}>
                      {PRESET_LABELS[preset]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[s.modelMenuDivider, { backgroundColor: chatBorder }]} />
            <Text style={[s.modelMenuSection, { color: chatMuted }]}>LOCAL MODELS</Text>
            {!chat.backendEnabled.local ? (
              <TouchableOpacity
                style={s.modelMenuRow}
                onPress={() => { setModelMenuOpen(false); closeChat(); router.push('/ai-settings'); }}
              >
                <Text style={[s.modelMenuName, { color: chatMuted }]}>Local AI is disabled</Text>
                <Text style={[s.modelMenuMeta, { color: chatMuted }]}>SETTINGS</Text>
              </TouchableOpacity>
            ) : installedModelIds.length === 0 ? (
              <TouchableOpacity
                style={s.modelMenuRow}
                onPress={() => { setModelMenuOpen(false); closeChat(); router.push('/ai-settings'); }}
              >
                <Text style={[s.modelMenuName, { color: chatInk }]}>Add a local model</Text>
                <Text style={[s.modelMenuMeta, { color: chatMuted }]}>SETTINGS</Text>
              </TouchableOpacity>
            ) : installedModelIds.map(id => {
              const model = MODEL_CATALOG.find(m => m.id === id)!;
              const active = chat.backendType === 'local' && id === activeModelId;
              return (
                <TouchableOpacity
                  key={id}
                  style={[s.modelMenuRow, active && { backgroundColor: colors.primary }]}
                  onPress={() => void chooseLocalModel(id)}
                >
                  <Text style={[s.modelMenuName, { color: active ? chatBg : chatInk }]} numberOfLines={1}>
                    {model.name}
                  </Text>
                  <Text style={[s.modelMenuMeta, { color: active ? chatBg : chatMuted }]}>
                    {active ? 'ACTIVE' : formatSize(model.sizeBytes)}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {chat.backendEnabled.local && installedModelIds.length > 0 && (
              <TouchableOpacity
                style={s.modelMenuRow}
                onPress={() => { setModelMenuOpen(false); closeChat(); router.push('/ai-settings'); }}
              >
                <Text style={[s.modelMenuName, { color: chatInk }]}>Add a local model</Text>
                <Text style={[s.modelMenuMeta, { color: chatMuted }]}>SETTINGS</Text>
              </TouchableOpacity>
            )}

            <View style={[s.modelMenuDivider, { backgroundColor: chatBorder }]} />
            <Text style={[s.modelMenuSection, { color: chatMuted }]}>PRIVATE</Text>
            {!PRIVATE_CLOUD_ENABLED || !chat.backendEnabled.cloud ? (
              <View style={s.modelMenuRow}>
                <Text style={[s.modelMenuName, { color: chatMuted }]}>
                  {!PRIVATE_CLOUD_ENABLED ? 'Unavailable in this beta' : 'Private Cloud is disabled'}
                </Text>
                <TouchableOpacity onPress={() => { setModelMenuOpen(false); closeChat(); router.push('/ai-settings'); }}>
                  <Text style={[s.modelMenuMeta, { color: chatMuted }]}>SETTINGS</Text>
                </TouchableOpacity>
              </View>
            ) : CLOUD_MODELS.map(model => {
              const active = chat.backendType === 'cloud' && model.id === activeCloudModelId;
              // The section header already reads "Private" (the compact mode name,
              // matching web), and there is a single cloud model whose name is
              // the same words. Showing that name again stacked "PRIVATE /
              // Private Cloud" reads as a bug, so the row carries the model's
              // description instead, the header is the label, the row is detail.
              return (
                <TouchableOpacity
                  key={model.id}
                  style={[s.modelMenuRow, active && { backgroundColor: colors.primary }]}
                  onPress={() => void chooseCloudModel(model.id)}
                >
                  <Text style={[s.modelMenuName, { color: active ? chatBg : chatInk }]} numberOfLines={1}>
                    {model.description}
                  </Text>
                  {active && (
                    <Text style={[s.modelMenuMeta, { color: chatBg }]}>ACTIVE</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showIndexRepair}
        transparent
        animationType="fade"
        onRequestClose={() => !rebuildingIndex && setShowIndexRepair(false)}
      >
        <View style={s.indexRepairBackdrop}>
          <View style={[s.indexRepairModal, { backgroundColor: colors.background, borderColor: colors.primaryDark }]}>
            <Text style={[s.indexRepairModalTitle, { color: colors.primaryDark }]}>REBUILD LOCAL INDEX?</Text>
            <Text style={[s.indexRepairModalCopy, { color: colors.text }]}>Alice will delete only the local Arkade address and history index, then rebuild it from this wallet. It will not delete your recovery words, funds, or swap recovery data.</Text>
            {rebuildingIndex && (
              <Text style={[s.indexRepairModalStatus, { color: colors.muted }]}>Rebuilding wallet addresses and history. This can take several minutes.</Text>
            )}
            {indexRepairError && (
              <Text style={[s.indexRepairModalError, { color: colors.danger }]}>{indexRepairError}</Text>
            )}
            <View style={s.indexRepairActions}>
              <TouchableOpacity
                style={[s.indexRepairCancel, { borderColor: colors.dotted }]}
                onPress={() => setShowIndexRepair(false)}
                disabled={rebuildingIndex}
              >
                <Text style={[s.indexRepairCancelText, { color: colors.muted }]}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.indexRepairConfirm, { backgroundColor: colors.primaryDark }]}
                onPress={() => void rebuildWalletIndex()}
                disabled={rebuildingIndex}
              >
                <Text style={[s.indexRepairConfirmText, { color: colors.background }]}>{rebuildingIndex ? 'REBUILDING...' : 'REBUILD'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {introActive && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]} pointerEvents="none">
          <PixelFill progress={introProgress} width={winW} height={winH} color={colors.primary} origin="bottom-edge" mode="clear" onReady={startIntroAnimation} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  top: { paddingHorizontal: spacing.lg },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  settingsIcon: { width: 32, height: 32, resizeMode: 'contain' },

  balanceArea: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 56 },
  btcIconWrap: { width: 42, height: 56, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  btcIcon: { width: 48, height: 48, resizeMode: 'contain' },
  balance: { fontFamily: typography.numbers, fontSize: 48 },
  balanceSuffix: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 2, paddingTop: 14 },
  fiat: { fontFamily: typography.numbers, fontSize: 18 },
  testnetWarning: { marginTop: -spacing.lg, marginBottom: spacing.lg, paddingHorizontal: spacing.xl, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: '#e06060', textAlign: 'center' },
  walletError: { maxWidth: 300, fontFamily: typography.numbers, fontSize: 13, lineHeight: 18, color: '#e06060', textAlign: 'center' },
  indexRepairCard: { marginTop: spacing.sm, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  indexRepairTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  indexRepairDescription: { fontFamily: typography.numbers, fontSize: 14, lineHeight: 19 },
  indexRepairButton: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  indexRepairButtonText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  indexRepairBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0, 0, 0, 0.65)' },
  indexRepairModal: { width: '100%', maxWidth: 440, borderWidth: 2, padding: spacing.lg, gap: spacing.md },
  indexRepairModalTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  indexRepairModalCopy: { fontFamily: typography.numbers, fontSize: 16, lineHeight: 22 },
  indexRepairModalStatus: { fontFamily: typography.numbers, fontSize: 14, lineHeight: 20 },
  indexRepairModalError: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 19, color: '#e06060' },
  indexRepairActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  indexRepairCancel: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1 },
  indexRepairCancelText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  indexRepairConfirm: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  indexRepairConfirmText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  vtxoBanner: { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: '#fff1f1', borderColor: '#e06060' },
  vtxoCopy: { flex: 1, gap: spacing.xs },
  vtxoTitle: { fontFamily: typography.pixel, fontSize: 12, color: '#c84f4f', letterSpacing: 1 },
  vtxoDescription: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 17, color: '#9e4141' },
  vtxoAction: { fontFamily: typography.pixel, fontSize: 12, color: '#c84f4f', letterSpacing: 1 },

  actions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xxl },
  backupBanner: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: '#ff000012', borderWidth: 1, borderColor: '#ff0000', borderRadius: 2 },
  backupDescription: { flex: 1, fontFamily: typography.numbers, fontSize: 13, lineHeight: 17, color: '#ff0000' },
  // Phrase-action, pas un label court : en grotesque lisible plutot qu'en
  // pixel qui doublait le volume de la banniere.
  backupAction: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 17, color: '#ff0000', letterSpacing: 0.5, fontWeight: '600' },
  btnImg: { width: 140, height: 80, resizeMode: 'contain' },

  recentTransactions: { marginTop: spacing.md, paddingHorizontal: spacing.md },
  transactionRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  transactionDetails: { flex: 1, gap: 3 },
  transactionType: { fontFamily: typography.numbers, fontSize: 15, lineHeight: 19 },
  transactionDate: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 16 },
  transactionAmount: { fontFamily: typography.numbers, fontSize: 16 },

  dashTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  // The pixel font's glyphs sit high in their box: nudge the bars down to
  // the label's visual centre.
  dashIcon: { alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 2 },
  dash: { width: 24, height: 2, borderRadius: 1 },
  historyLabel: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, includeFontPadding: false },

  chatZone: { flex: 1, overflow: 'visible' },
  bottomAnchor: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: spacing.xl },

  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl },

  chatSurface: { flex: 1 },
  pillKey: { width: 44, height: 44, resizeMode: 'contain' },
  pillTextWrap: { alignItems: 'flex-start' },
  pillTextTop: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  pillTextBottom: { fontFamily: typography.pixel, fontSize: 14, letterSpacing: 2 },

  chatPanel: { flex: 1 },
  chatHeader: { width: '100%', maxWidth: 896, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  chatHeaderSide: { width: 108, flexDirection: 'row', alignItems: 'center' },
  chatHeaderBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  chatHeaderRight: { width: 108, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  chatHeaderBackIcon: { fontFamily: typography.pixel, fontSize: 18, lineHeight: 22 },
  chatHeaderBtnText: { fontFamily: typography.pixel, fontSize: 16 },
  chatModelTitle: { flex: 1, minWidth: 0, minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: spacing.xs },
  chatModelTitleText: { minWidth: 0, fontFamily: typography.numbers, fontSize: 18, lineHeight: 22, textAlign: 'center' },
  chatModelChevron: { width: 7, height: 7, borderRightWidth: 1, borderBottomWidth: 1, marginTop: -4, transform: [{ rotate: '45deg' }] },
  modelMenuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-start', alignItems: 'center' },
  modelMenu: { width: '100%', maxWidth: 360, borderWidth: 2, borderRadius: 4, padding: spacing.sm, gap: 2 },
  modelMenuSection: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 2, marginTop: spacing.xs, marginBottom: spacing.xs },
  modelReasoningRow: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
  modelReasoningChip: { flex: 1, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 4, paddingHorizontal: spacing.xs },
  modelReasoningText: { fontFamily: typography.numbers, fontSize: 16, lineHeight: 21 },
  modelMenuRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 4 },
  modelMenuName: { flex: 1, fontFamily: typography.numbers, fontSize: 17, lineHeight: 22 },
  modelMenuMeta: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  modelMenuDivider: { height: 1, marginVertical: spacing.sm },
  localNotice: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.lg },
  localNoticeText: { maxWidth: 420, fontFamily: typography.numbers, fontSize: 18, lineHeight: 26, textAlign: 'center' },
  localNoticeBtn: { borderWidth: 2, borderRadius: 2, paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
  localNoticeBtnText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  chatListFlex: { flex: 1 },
  listWrap: { flex: 1, position: 'relative' },
  scrollDownBtn: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  scrollDownIcon: { fontFamily: typography.pixel, fontSize: 14, lineHeight: 18 },
  // Inverted list: the container is flipped vertically, so paddingTop is the gap
  // at the visual BOTTOM (above the composer) and paddingBottom is the gap at the
  // visual TOP (under the header). The bottom gap keeps the newest message and
  // Alice's avatar clear of the composer while a reply writes in. No flexGrow /
  // justifyContent needed, an inverted list anchors content to the bottom on its
  // own, and that is also what pins the last line above the keyboard.
  chatList: { width: '100%', maxWidth: 896, alignSelf: 'center', paddingTop: spacing.lg, paddingBottom: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md },
  systemRow: { alignItems: 'center', paddingVertical: spacing.xs },
  systemText: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 17, opacity: 0.7 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  msgRowUser: { flexDirection: 'row-reverse' },
  // Lifted a few px off the row's baseline so the icon sits level with the text
  // line rather than sinking below it (the 30px icon is taller than the 24px
  // line height), keeping it fully visible next to the writing line.
  assistantIcon: { width: 30, height: 30, justifyContent: 'flex-end', marginBottom: 4 },
  aliceAvatar: { width: 24, height: 24, resizeMode: 'contain', marginBottom: 2 },
  bubble: { maxWidth: '75%', paddingVertical: 10, paddingHorizontal: 14 },
  bubbleAssistant: { paddingVertical: 0, paddingHorizontal: 0 },
  // backgroundColor is supplied inline from the palette accent (colors.primary).
  bubbleUser: { borderRadius: 4 },
  bubbleText: { fontFamily: typography.numbers, fontSize: 17, lineHeight: 24 },
  // Same size as Alice's text: a smaller user bubble made the two sides of the
  // conversation read as different weights.
  bubbleTextUser: { fontFamily: typography.numbers, fontSize: 17, lineHeight: 24 },
  truncatedNotice: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, opacity: 0.7, marginTop: spacing.xs },
  markdownWrap: { gap: 4 },
  markdownStrong: { fontWeight: '700' },
  markdownHr: { height: 1, alignSelf: 'stretch', marginVertical: spacing.sm, opacity: 0.25 },
  markdownHeading: { fontWeight: '700', marginTop: 2 },
  markdownHeadingLarge: { fontSize: 19, lineHeight: 26 },
  typingDots: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8 },
  typingDot: { width: 7, height: 7, borderRadius: 4 },
  markdownBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  markdownBullet: { width: 12, textAlign: 'center' },
  markdownBulletText: { flex: 1 },
  markdownSpacer: { height: 5 },

  inputRow: { width: '100%', maxWidth: 896, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.sm },
  inputRowCompact: {
    paddingHorizontal: 0,
    paddingTop: 0,
    borderTopWidth: 1,
  },
  inputBox: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 2,
    minHeight: 96,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  inputBoxCompact: {
    borderWidth: 0,
    borderRadius: 0,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  input: { width: '100%', minWidth: 0, minHeight: 44, maxHeight: 112, fontFamily: typography.numbers, fontSize: 17, lineHeight: 24, paddingVertical: 0, textAlignVertical: 'top', includeFontPadding: false },
  inputCompact: { flex: 1, width: 'auto', minHeight: 36 },
  inputControlsRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inputControlsSpacer: { flex: 1 },
  sendBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  sendIcon: { fontFamily: typography.pixel, fontSize: 12 },

  historyPanel: { flex: 1 },
  historyList: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  historyEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl },
  historyEmptyText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, opacity: 0.6 },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1 },
  historyRowContent: { flex: 1, gap: 4 },
  historyTitle: { fontFamily: typography.numbers, fontSize: 17, lineHeight: 22 },
  historyMeta: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  historyDelete: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  historyDeleteText: { fontSize: 22, fontWeight: '300' },
});
