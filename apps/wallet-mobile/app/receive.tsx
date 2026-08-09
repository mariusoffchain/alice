import { View, Text, StyleSheet, TouchableOpacity, Share, Platform, ActivityIndicator, TextInput, ScrollView, Animated, Easing, Linking, KeyboardAvoidingView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  createReceivePayment,
  findNewReceivedVtxo,
  getArkAddress,
  getBalance,
  getPaymentDetails,
  getReceiveAddress,
  getTransactionHistory,
  getVtxos,
  settledIncomingAmount,
  syncVtxosIfReady,
} from '@alice-wallet/wallet-core';
import { getConfirmations } from '@alice-wallet/wallet-core';
import { PixelFill } from '@alice-wallet/alice-ui';
import type { Transaction } from '@alice-wallet/wallet-core';
import { encodeUnifiedBip21 } from '@alice-wallet/shared-types';
import { getBalanceFormat, type BalanceFormat } from '@alice-wallet/alice-ui';
import { CURRENCY_SYMBOL, getFiatCurrency, priceApiUrl, type FiatCurrency } from '@alice-wallet/alice-ui';
import { WalletAmount } from '@alice-wallet/alice-ui';
import { BitcoinIcon } from '@alice-wallet/alice-ui';
import { friendlyNetworkError, friendlySatoraLimitError } from '@alice-wallet/wallet-core';
import { NETWORK, resolveTransactionExplorer } from '@alice-wallet/wallet-core';

const POLL_INTERVAL = 5_000;

type ReceiveMode = 'unified' | 'lightning';

function friendlyLightningReceiveError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '');
  const minimumMatch = raw.match(/Lightning amount too small\. Minimum: ([\d,]+) sats\./i);
  if (minimumMatch) {
    return `AMOUNT TOO SMALL. MINIMUM: ${minimumMatch[1]} SATS.`;
  }
  const satoraLimit = friendlySatoraLimitError(raw);
  if (satoraLimit) return satoraLimit;
  return friendlyNetworkError(error, 'lightning');
}

function primaryTxid(tx: Transaction): string {
  return tx.boardingTxid || tx.commitmentTxid || tx.arkTxid || tx.id;
}

export default function ReceiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [arkAddress, setArkAddress] = useState('');
  const [boardingAddress, setBoardingAddress] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [receiveMode, setReceiveMode] = useState<ReceiveMode>('lightning');
  const [lightningInvoice, setLightningInvoice] = useState('');
  const [lightningPaymentId, setLightningPaymentId] = useState<string | null>(null);
  const [lightningLoading, setLightningLoading] = useState(false);
  const [lightningError, setLightningError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'unified' | 'ark' | 'bitcoin' | 'lightning' | null>(null);
  const [QRCode, setQRCode] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [balanceFormat, setBalanceFormat] = useState<BalanceFormat>('symbol');
  const [currency, setCurrency] = useState<FiatCurrency>('USD');
  const [btcPrice, setBtcPrice] = useState<number | null>(null);

  // Payment detection
  const [initialBalance, setInitialBalance] = useState<number | null>(null);
  const [receivedAmount, setReceivedAmount] = useState<number | null>(null);
  const [receivedTx, setReceivedTx] = useState<Transaction | null>(null);
  const [explorerHint, setExplorerHint] = useState('OPEN EXPLORER');
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const successProgress = useRef(new Animated.Value(0)).current;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const receiveStartedAtRef = useRef(Date.now());
  const initialVtxoIdsRef = useRef<Set<string>>(new Set());
  const vtxoBaselineReadyRef = useRef(false);
  const invoiceAttemptedForAmountRef = useRef<number | null>(null);
  const latestAmountSatsRef = useRef<number | null>(null);
  const successShownRef = useRef(false);

  // Started from PixelFill's onReady so the grid is mounted before progress
  // moves — otherwise the natively driven fill runs ahead of first paint.
  const startSuccessAnimation = () => {
    successProgress.setValue(0);
    Animated.timing(successProgress, {
      toValue: 1,
      duration: 900,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    if (receiveMode !== 'unified' || (arkAddress && boardingAddress)) return;
    Promise.all([getArkAddress(), getReceiveAddress()])
      .then(([arkade, onchain]) => {
        setArkAddress(arkade);
        setBoardingAddress(onchain);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load address.'));
  }, [arkAddress, boardingAddress, receiveMode]);

  useEffect(() => {
    import('react-native-qrcode-svg')
      .then(mod => setQRCode(() => mod.default))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getBalanceFormat().then(setBalanceFormat).catch(() => {});
    getFiatCurrency().then(setCurrency).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(priceApiUrl(currency))
      .then(r => r.json())
      .then(data => setBtcPrice(parseFloat(data.data.amount)))
      .catch(() => {});
  }, [currency]);

  // Capture initial balance and start polling
  useEffect(() => {
    void getBalance()
      .then(wallet => setInitialBalance(wallet.balance))
      .catch(() => {});
    void getVtxos()
      .then(vtxos => {
        initialVtxoIdsRef.current = new Set(vtxos.map(vtxo => vtxo.id));
        vtxoBaselineReadyRef.current = true;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const canWatchForPayment = receiveMode === 'unified' || Boolean(lightningInvoice);
    if (receivedAmount !== null || !canWatchForPayment) return;

    const checkForPayment = async () => {
      if (pollInFlightRef.current || successShownRef.current) return;
      pollInFlightRef.current = true;
      try {
        await syncVtxosIfReady().catch(() => null);
        const [vtxoResult, balanceResult] = await Promise.allSettled([
          getVtxos(),
          getBalance(),
        ]);

        if (vtxoResult.status === 'fulfilled') {
          if (!vtxoBaselineReadyRef.current) {
            initialVtxoIdsRef.current = new Set(vtxoResult.value.map(vtxo => vtxo.id));
            vtxoBaselineReadyRef.current = true;
          } else {
            const received = findNewReceivedVtxo(
              vtxoResult.value,
              initialVtxoIdsRef.current,
              receiveStartedAtRef.current,
            );
            if (received) {
              await completeReceive(received.value);
              return;
            }
          }
        }

        if (balanceResult.status === 'fulfilled') {
          if (initialBalance === null) {
            setInitialBalance(balanceResult.value.balance);
          } else if (balanceResult.value.balance > initialBalance) {
            await completeReceive(balanceResult.value.balance - initialBalance);
          }
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void checkForPayment();
    pollRef.current = setInterval(() => void checkForPayment(), POLL_INTERVAL);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [initialBalance, receivedAmount, receiveMode, lightningInvoice]);

  useEffect(() => {
    if (!lightningPaymentId || receivedAmount !== null) return;
    const refreshPayment = () => {
      void getPaymentDetails(lightningPaymentId).catch(() => {});
    };
    refreshPayment();
    const id = setInterval(refreshPayment, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [lightningPaymentId, receivedAmount]);

  useEffect(() => {
    if (!receivedAmount || receivedTx) return;
    const id = setInterval(() => {
      findMatchingIncomingTransaction(receivedAmount)
        .then(latest => { if (latest) setReceivedTx(latest); })
        .catch(() => {});
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [receivedAmount, receivedTx?.id]);

  // Fetch confirmations for on-chain received tx
  useEffect(() => {
    if (!receivedTx || receivedTx.layer !== 'onchain') return;
    const onchainTxid = primaryTxid(receivedTx);
    if (!onchainTxid) return;

    const fetchConf = () => getConfirmations(onchainTxid).then(setConfirmCount).catch(() => {});
    fetchConf();
    const id = setInterval(fetchConf, 8_000);
    return () => clearInterval(id);
  }, [receivedTx?.id]);

  const amountSats = amountInput ? parseInt(amountInput, 10) || null : null;
  latestAmountSatsRef.current = amountSats;
  const unifiedQrValue = arkAddress && boardingAddress
    ? encodeUnifiedBip21({ bitcoinAddress: boardingAddress, arkAddress, amountSats })
    : '';
  const qrValue = receiveMode === 'lightning' ? lightningInvoice : unifiedQrValue;
  const shareText = qrValue;
  const amountUnitLabel = balanceFormat === 'sats'
      ? 'SATS'
      : balanceFormat === 'btc'
        ? 'BTC'
        : currency;

  async function findMatchingIncomingTransaction(received: number): Promise<Transaction | null> {
    const history = await getTransactionHistory();
    return history
      .filter(t => t.type === 'incoming')
      .filter(t => t.createdAt >= receiveStartedAtRef.current)
      .sort((a, b) => {
        const aExact = a.amount === received ? 1 : 0;
        const bExact = b.amount === received ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return b.createdAt - a.createdAt;
      })[0] ?? null;
  }

  async function completeReceive(received: number, transaction?: Transaction) {
    if (successShownRef.current || received <= 0) return;
    successShownRef.current = true;
    setReceivedAmount(received);
    if (transaction) setReceivedTx(transaction);

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setShowSuccess(true);
    if (!transaction) {
      void findMatchingIncomingTransaction(received)
        .then(latest => {
          if (latest) setReceivedTx(latest);
        })
        .catch(() => {});
    }
  }
  useEffect(() => {
    if (receiveMode !== 'lightning' || !amountSats || amountSats <= 0) return;
    if (lightningInvoice || lightningLoading) return;
    if (invoiceAttemptedForAmountRef.current === amountSats) return;

    const timer = setTimeout(() => {
      invoiceAttemptedForAmountRef.current = amountSats;
      void generateLightningInvoice(amountSats);
    }, 450);

    return () => clearTimeout(timer);
  }, [amountSats, lightningInvoice, lightningLoading, receiveMode]);

  async function generateLightningInvoice(sats = amountSats) {
    if (!sats || sats <= 0) {
      setLightningError('ENTER AN AMOUNT TO CREATE A LIGHTNING INVOICE.');
      return;
    }
    setLightningLoading(true);
    setLightningError(null);
    try {
      const response = await createReceivePayment({
        layer: 'lightning',
        amountSats: sats,
        description: 'Alice Bitcoin payment',
      });
      if (latestAmountSatsRef.current !== sats) return;
      setLightningInvoice(response.request);
      setLightningPaymentId(response.paymentId ?? null);
    } catch (cause) {
      setLightningError(friendlyLightningReceiveError(cause));
    } finally {
      setLightningLoading(false);
    }
  }

  function switchMode(nextMode: ReceiveMode) {
    setReceiveMode(nextMode);
    setCopied(null);
    setLightningError(null);
  }

  async function copyValue(value = shareText, target: 'unified' | 'ark' | 'bitcoin' | 'lightning' = 'unified') {
    if (!value) return;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(value); } catch {}
    } else {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(value);
    }
    setCopied(target);
    setTimeout(() => setCopied(null), 2000);
  }

  async function shareValue() {
    if (!shareText) return;
    try { await Share.share({ message: shareText }); } catch {}
  }

  async function openReceivedTransactionExplorer() {
    if (!receivedTx) return;
    const link = resolveTransactionExplorer(receivedTx);
    if (!link) return;

    if (!link.direct) {
      await copyValue(primaryTxid(receivedTx));
      setExplorerHint('ID COPIED. SEARCH IN ARK EXPLORER');
    }

    await Linking.openURL(link.url);
  }

  const shorten = (value: string) => value.length > 24
    ? value.slice(0, 14) + '...' + value.slice(-10)
    : value;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace('/')} style={s.backBtn}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>RECEIVE</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={s.kav} behavior="padding">
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.modeTabs}>
          <TouchableOpacity
            style={[s.modeTab, receiveMode === 'unified' && s.modeTabActive]}
            onPress={() => switchMode('unified')}
          >
            <Text style={[s.modeTabText, receiveMode === 'unified' && s.modeTabTextActive]}>ARK + BTC</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.modeTab, receiveMode === 'lightning' && s.modeTabActive]}
            onPress={() => switchMode('lightning')}
          >
            <Text style={[s.modeTabText, receiveMode === 'lightning' && s.modeTabTextActive]}>LIGHTNING</Text>
          </TouchableOpacity>
        </View>

        {/* Amount input */}
        <View style={s.amountSection}>
          <View style={s.amountLabelRow}>
            <Text style={s.amountLabel}>{receiveMode === 'lightning' ? 'AMOUNT REQUIRED' : 'AMOUNT OPTIONAL'}</Text>
            <Text style={s.amountLabel}>(</Text>
            {balanceFormat === 'symbol' ? (
              <BitcoinIcon size={14} color={colors.muted} />
            ) : (
              <Text style={s.amountLabel}>{amountUnitLabel}</Text>
            )}
            <Text style={s.amountLabel}>)</Text>
          </View>
          <View style={s.amountRow}>
            <View style={s.amountInputWrap}>
              <TextInput
                style={[s.amountInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
                value={amountInput}
                onChangeText={value => {
                  setAmountInput(value.replace(/\D/g, ''));
                  setLightningInvoice('');
                  setLightningPaymentId(null);
                  setLightningError(null);
                  invoiceAttemptedForAmountRef.current = null;
                }}
                placeholder="0"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                maxLength={12}
              />
            </View>
            <View style={s.amountUnitWrap}>
              {balanceFormat === 'symbol' ? (
                <BitcoinIcon size={24} color={colors.muted} />
              ) : (
                <Text style={s.amountUnit}>{amountUnitLabel}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Waiting indicator — stays visible until the success overlay covers it */}
        {qrValue && !showSuccess && (
          <View style={s.waitingBanner}>
            <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.5 }] }} />
            <Text style={s.waitingText}>{receivedAmount ? 'PAYMENT RECEIVED' : 'WAITING FOR PAYMENT...'}</Text>
          </View>
        )}

        {/* QR code */}
        <TouchableOpacity
          style={s.qrTapWrap}
          onPress={() => void copyValue()}
          disabled={!qrValue}
          activeOpacity={0.9}
        >
        <View style={s.qrContainer}>
          {QRCode && qrValue ? (
            <QRCode
              value={qrValue}
              size={220}
              color={colors.qrColor}
              backgroundColor="#ffffff"
              quietZone={12}
              ecl="M"
            />
          ) : error || lightningError ? (
            <View style={s.qrPlaceholder}><Text style={s.error}>{lightningError ?? error}</Text></View>
          ) : (
            <View style={s.qrPlaceholder}>
              {receiveMode === 'lightning' && !lightningInvoice ? (
                <Text style={s.placeholderText}>
                  {amountSats ? 'CREATING LIGHTNING INVOICE...' : 'ENTER AN AMOUNT FIRST TO CREATE A LIGHTNING INVOICE'}
                </Text>
              ) : (
                <ActivityIndicator color={colors.primary} />
              )}
            </View>
          )}
        </View>
        {!error && !lightningError && qrValue ? (
          <Text style={s.qrHint}>{copied === 'unified' ? 'COPIED !' : 'Tap QR to copy'}</Text>
        ) : null}
        </TouchableOpacity>

        {!error && Platform.OS !== 'web' && (
          <View style={s.actions}>
            <TouchableOpacity style={s.actionBtn} onPress={shareValue}>
              <Text style={s.actionBtnText}>SHARE</Text>
            </TouchableOpacity>
          </View>
        )}

        {!error && receiveMode === 'unified' && (
          <View style={s.methods}>
            <TouchableOpacity style={s.methodRow} onPress={() => void copyValue(arkAddress, 'ark')}>
              <View style={s.methodDetails}>
                <Text style={s.methodName}>ARKADE</Text>
                <Text style={s.methodAddress}>{shorten(arkAddress)}</Text>
              </View>
              <Text style={s.methodAction}>{copied === 'ark' ? 'COPIED' : 'COPY'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.methodRow, s.methodBorder]} onPress={() => void copyValue(boardingAddress, 'bitcoin')}>
              <View style={s.methodDetails}>
                <Text style={s.methodName}>
                  {NETWORK === 'bitcoin' ? 'BITCOIN MAINNET' : 'BITCOIN MUTINYNET'}
                </Text>
                <Text style={s.methodAddress}>{shorten(boardingAddress)}</Text>
              </View>
              <Text style={s.methodAction}>{copied === 'bitcoin' ? 'COPIED' : 'COPY'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!error && receiveMode === 'lightning' && lightningInvoice && (
          <View style={s.methods}>
            <Text style={s.methodsTitle}>PAYMENT METHOD</Text>
            <TouchableOpacity style={s.methodRow} onPress={() => void copyValue(lightningInvoice, 'lightning')}>
              <View style={s.methodDetails}>
                <Text style={s.methodName}>LIGHTNING</Text>
                <Text style={s.methodAddress}>{shorten(lightningInvoice)}</Text>
              </View>
              <Text style={s.methodAction}>{copied === 'lightning' ? 'COPIED' : 'COPY'}</Text>
            </TouchableOpacity>
            {lightningPaymentId && <Text style={s.lightningMeta}>SWAP {shorten(lightningPaymentId)}</Text>}
          </View>
        )}

        <Text style={s.hint}>
          {receiveMode === 'lightning'
            ? 'Keep Alice open until the payment is confirmed. If Alice is closed, the payer may see Processing until you reopen it.'
            : 'Compatible wallets automatically choose the best available payment method.'}
        </Text>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Payment received overlay. It fills the screen on purpose, including
          behind the system bars, so the colour goes edge to edge. Its content
          must not: pad it here rather than on each child, or the next thing
          added at the bottom lands under the navigation bar too. */}
      {showSuccess && receivedAmount && (
        <View style={[s.successOverlay, { paddingBottom: insets.bottom }]}>
          <PixelFill
            progress={successProgress}
            width={screenW}
            height={screenH}
            color={colors.primary}
            origin="bottom-edge"
            onReady={startSuccessAnimation}
          />
          <Animated.View
            style={[
              s.successContent,
              {
                opacity: successProgress.interpolate({
                  inputRange: [0.62, 1],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <View style={s.successReceipt}>
              <Text style={s.successEyebrow}>PAYMENT RECEIVED</Text>
              <WalletAmount
                sats={receivedAmount}
                direction="incoming"
                format={balanceFormat}
                btcPrice={btcPrice}
                currencySymbol={CURRENCY_SYMBOL[currency]}
                iconSize={58}
                iconColor={colors.onPrimary}
                iconTight
                iconOffsetY={12}
                textStyle={s.successAmount}
                containerStyle={s.successAmountRow}
                gap={8}
              />

              <View style={s.successDivider} />

              {receivedTx && receivedTx.layer === 'onchain' && (
                <>
                  <Text style={s.successLabel}>CONFIRMATIONS</Text>
                  <Text style={[s.successValue, {
                    color: confirmCount === null ? colors.onPrimary
                      : confirmCount === 0 ? '#d4a017'
                      : confirmCount >= 6 ? '#2ea043'
                      : colors.onPrimary
                  }]}>
                    {confirmCount === null ? '...' : confirmCount === 0 ? 'Unconfirmed' : `${confirmCount}`}
                  </Text>
                </>
              )}

              {receivedTx?.id && (
                <>
                  <Text style={s.successLabel}>TRANSACTION</Text>
                  <TouchableOpacity
                    style={s.successLink}
                    onPress={() => void openReceivedTransactionExplorer()}
                  >
                    <Text style={s.successAddress}>{primaryTxid(receivedTx)}</Text>
                    <Text style={s.successLinkHint}>{explorerHint}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <TouchableOpacity
              style={s.successBtn}
              onPress={() => router.replace('/')}
            >
              <Text style={s.successBtnText}>BACK TO WALLET</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    kav: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', ...pixel, backgroundColor: colors.cardBg },
    backIcon: { fontFamily: typography.pixel, fontSize: 12, color: colors.primary },
    title: { fontFamily: typography.pixel, fontSize: 10, color: colors.primaryDark, letterSpacing: 3 },
    body: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
    unifiedTitle: { fontFamily: typography.pixel, fontSize: 10, color: colors.primaryDark, letterSpacing: 2, textAlign: 'center' },
    label: { fontFamily: typography.pixel, fontSize: 7, color: colors.muted, letterSpacing: 2 },
    modeTabs: { flexDirection: 'row', gap: spacing.sm, width: '100%', maxWidth: 320 },
    modeTab: { ...pixel, flex: 1, alignItems: 'center', paddingVertical: spacing.md, backgroundColor: colors.cardBg },
    modeTabActive: { backgroundColor: colors.primary, borderColor: colors.primaryDark },
    modeTabText: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1 },
    modeTabTextActive: { color: colors.onPrimary },

    amountSection: { width: '100%', maxWidth: 320, gap: spacing.xs },
    amountLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    amountLabel: { fontFamily: typography.pixel, fontSize: 7, color: colors.muted, letterSpacing: 2 },
    amountRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, ...pixel, backgroundColor: colors.cardBg, paddingHorizontal: spacing.md },
    amountInputWrap: { flex: 1, height: 44, justifyContent: 'center' },
    amountInput: {
      flex: 1,
      height: 44,
      fontFamily: typography.numbers,
      fontSize: 28,
      color: colors.primaryDark,
      paddingVertical: 0,
      textAlignVertical: 'center',
      includeFontPadding: true,
    },
    amountUnitWrap: { minWidth: 48, paddingLeft: spacing.sm, alignItems: 'center', justifyContent: 'center' },
    amountUnit: { fontFamily: typography.pixel, fontSize: 8, color: colors.muted, letterSpacing: 2 },
    waitingBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    waitingText: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1 },

    qrTapWrap: { alignItems: 'center' },
    qrContainer: { ...pixel, backgroundColor: '#ffffff', padding: spacing.sm },
    qrPlaceholder: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundSoft },
    qrHint: { marginTop: spacing.sm, fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1 },
    placeholderText: { padding: spacing.lg, fontFamily: typography.pixel, fontSize: 7, color: colors.muted, lineHeight: 16, textAlign: 'center' },
    error: { fontFamily: typography.numbers, fontSize: 13, color: '#e06060', textAlign: 'center', paddingHorizontal: spacing.md },
    actions: { flexDirection: 'row', gap: spacing.lg },
    actionBtn: { ...pixel, backgroundColor: colors.primary, borderColor: colors.primaryDark, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl },
    actionBtnText: { fontFamily: typography.pixel, fontSize: 8, color: colors.onPrimary, letterSpacing: 2 },
    methods: { width: '100%', maxWidth: 420, marginTop: spacing.sm },
    methodsTitle: { marginBottom: spacing.sm, fontFamily: typography.pixel, fontSize: 7, color: colors.muted, letterSpacing: 2 },
    methodRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
    methodBorder: { borderTopWidth: 1, borderTopColor: colors.dotted },
    methodDetails: { flex: 1, gap: spacing.xs },
    methodName: { fontFamily: typography.pixel, fontSize: 7, color: colors.primaryDark, letterSpacing: 1 },
    methodAddress: { fontFamily: typography.numbers, fontSize: 13, color: colors.muted },
    methodAction: { fontFamily: typography.pixel, fontSize: 6, color: colors.primary, letterSpacing: 1 },
    lightningMeta: { marginTop: spacing.sm, fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1 },
    hint: { fontFamily: typography.numbers, fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20, marginTop: spacing.md, paddingHorizontal: spacing.lg },

    // Success overlay
    successOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, overflow: 'hidden' },
    successContent: { flex: 1 },
    successReceipt: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl },
    successEyebrow: { fontFamily: typography.pixel, fontSize: 11, color: colors.onPrimary, letterSpacing: 3, textAlign: 'center' },
    successAmount: { marginTop: spacing.xxl, fontFamily: typography.numbers, fontSize: 56, lineHeight: 62, color: colors.onPrimary, textAlign: 'center' },
    successAmountRow: { marginTop: spacing.xxl, justifyContent: 'center', alignItems: 'center' },
    successUnit: { fontFamily: typography.pixel, fontSize: 9, color: colors.onPrimary, letterSpacing: 3 },
    successDivider: { width: 44, height: 3, marginVertical: spacing.xxxl, backgroundColor: colors.onPrimary },
    successLabel: { marginTop: spacing.xxxl, fontFamily: typography.pixel, fontSize: 7, color: colors.onPrimary, letterSpacing: 2, textAlign: 'center' },
    successValue: { marginTop: spacing.xs, fontFamily: typography.numbers, fontSize: 18, textAlign: 'center' },
    successAddress: { marginTop: spacing.sm, maxWidth: 460, fontFamily: typography.numbers, fontSize: 14, lineHeight: 19, color: colors.onPrimary, textAlign: 'center' },
    successLink: { alignItems: 'center', maxWidth: 460 },
    successLinkHint: { marginTop: spacing.xs, fontFamily: typography.pixel, fontSize: 6, color: colors.onPrimary, letterSpacing: 1, textAlign: 'center' },
    successBtn: { ...pixel, backgroundColor: colors.onPrimary, marginHorizontal: spacing.xxl, marginBottom: spacing.xxxl, paddingVertical: spacing.lg, alignItems: 'center' },
    successBtnText: { fontFamily: typography.pixel, fontSize: 9, color: colors.primary, letterSpacing: 2 },
  });
}
