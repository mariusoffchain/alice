import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Modal,
  Animated,
  Easing,
  Linking,
  Platform,
  KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { ArkAddress } from '@arkade-os/sdk';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  getArkAddress,
  getBalance,
  addDiagnosticLog,
  canOfferNativeOnchainFallback,
  quoteNativeOnchainPayment,
  sendQuotedPayment,
  sendSats,
} from '@alice-wallet/wallet-core';
import { getFiatCurrency, priceApiUrl, CURRENCY_SYMBOL, type FiatCurrency } from '@alice-wallet/alice-ui';
import { PixelFill } from '@alice-wallet/alice-ui';
import { parsePaymentInput, selectPaymentRoute } from '@alice-wallet/wallet-core';
import { quoteArkToBitcoin, quoteArkToLightningForProvider } from '@alice-wallet/wallet-core';
import type { ParsedPaymentRequest, PaymentQuote } from '@alice-wallet/wallet-core';
import { getBalanceFormat, type BalanceFormat } from '@alice-wallet/alice-ui';
import { WalletAmount } from '@alice-wallet/alice-ui';
import { BitcoinIcon } from '@alice-wallet/alice-ui';
import { friendlyNetworkError } from '@alice-wallet/wallet-core';
import { resolveLightningRequestToBolt11 } from '@alice-wallet/wallet-core';
import {
  MEMPOOL_EXPLORER,
  resolveArkadeExplorer,
  PAYMENT_NETWORK,
  SWAP_PROVIDER,
} from '@alice-wallet/wallet-core';
import type { PaymentLayer, PaymentNetwork } from '@alice-wallet/wallet-core';

type Destination = { address: string; layer: PaymentLayer; network: string };
type PendingPayment = { destination: Destination; sats: number; quote?: PaymentQuote };
type NativeFallback = {
  destination: Destination;
  sats: number;
  request: ParsedPaymentRequest;
};
type SentPayment = PendingPayment & {
  txid?: string;
  paymentId?: string;
  fundedSwap?: boolean;
  nativeExit?: boolean;
  refundTestMode?: boolean;
};
type SuccessState = 'idle' | 'animating' | 'complete';

const MIN_ARKADE_SEND = 1;
const PAYMENT_NETWORK_LABEL = PAYMENT_NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet';
const PAYMENT_NETWORK_UPPER = PAYMENT_NETWORK_LABEL.toUpperCase();
const ARKADE_FUNDS_REFRESH_ERROR = [
  'YOUR ARKADE FUNDS NEED TO BE REFRESHED. RETURN TO THE WALLET AND WAIT FOR SYNC, THEN TRY AGAIN LATER.',
  'OR SEND VIA ARKADE OR LIGHTNING INSTEAD.',
].join('\n');

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function belongsToSameArkadeServer(address: string, ownAddress: string): boolean {
  try {
    return sameBytes(
      ArkAddress.decode(address).serverPubKey,
      ArkAddress.decode(ownAddress).serverPubKey,
    );
  } catch {
    return false;
  }
}

function friendlySendError(
  error: unknown,
  availableBalance: number | null,
  context: 'arkade' | 'boltz' | 'lightning' | 'bitcoin' = 'arkade',
): string {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error');
  const normalized = raw.toLowerCase();
  const dustLimitMatch = raw.match(/ARKADE_VTXO_DUST_LIMIT:(\d+)/);

  if (dustLimitMatch) {
    return `DUST LIMIT = ${dustLimitMatch[1]} SATS.`;
  }

  if (
    normalized.includes('insufficient')
    || normalized.includes('not enough')
    || normalized.includes('balance')
    || normalized.includes('no arkade funds')
  ) {
    return availableBalance === null
      ? 'INSUFFICIENT FUNDS FOR THIS PAYMENT.'
      : `INSUFFICIENT FUNDS. AVAILABLE: ${availableBalance.toLocaleString('en-US')} SATS.`;
  }
  if (normalized.includes('fetch') || normalized.includes('network') || normalized.includes('timeout') || normalized.includes('unreachable')) {
    return friendlyNetworkError(error, context);
  }
  if (normalized.includes('server') && (normalized.includes('key') || normalized.includes('mismatch'))) {
    return `ARKADE SERVER MISMATCH. USE AN ADDRESS FROM THE ${PAYMENT_NETWORK_UPPER} ARKADE WALLET.`;
  }
  if (normalized.includes('expired') || normalized.includes('vtxo')) {
    return ARKADE_FUNDS_REFRESH_ERROR;
  }
  if (normalized.includes('signingdescriptor') || normalized.includes('cannot sign input for default contract')) {
    return `THIS WALLET HAS OLD ARKADE TEST FUNDS THAT THIS BUILD CANNOT SIGN. FOR ${PAYMENT_NETWORK_UPPER} TESTING, RESET THE WALLET OR CREATE A FRESH TEST WALLET, THEN FUND IT AGAIN.`;
  }
  if (normalized.includes('onboarding') || normalized.includes('not initialized')) {
    return 'WALLET NOT READY. COMPLETE ONBOARDING OR REOPEN THE APP, THEN TRY AGAIN.';
  }
  if (normalized.includes('invoice') && normalized.includes('expired')) {
    return 'LIGHTNING INVOICE EXPIRED. ASK FOR A NEW INVOICE AND TRY AGAIN.';
  }
  if (normalized.includes('lnurl') || normalized.includes('lightning address')) {
    return raw.toUpperCase();
  }
  return `PAYMENT FAILED. ${friendlyNetworkError(error, context)}`;
}

type ParsedQR = { destination: Destination; amountSats: number | null };

function routeNetworkLabel(layer: PaymentLayer): string {
  if (layer === 'arkade') return 'Arkade';
  if (layer === 'lightning') return `Lightning ${PAYMENT_NETWORK_LABEL}`;
  return `Bitcoin ${PAYMENT_NETWORK_LABEL}`;
}

function parsePaymentQR(value: string): ParsedQR | null {
  const request = parsePaymentInput(value, PAYMENT_NETWORK);
  if (!request) return null;

  const route = selectPaymentRoute(request, ['arkade', 'lightning', 'onchain']);
  if (!route) return null;

  return {
    destination: {
      address: route.destination,
      layer: route.layer,
      network: routeNetworkLabel(route.layer),
    },
    amountSats: request.amountSats,
  };
}

function oppositePaymentNetwork(): PaymentNetwork {
  return PAYMENT_NETWORK === 'bitcoin' ? 'mutinynet' : 'bitcoin';
}

function networkLabel(network: PaymentNetwork): string {
  return network === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet';
}

function paymentNetworkMismatchError(value: string): string | null {
  const otherNetwork = oppositePaymentNetwork();
  const otherRequest = parsePaymentInput(value, otherNetwork);
  if (!otherRequest) return null;
  const otherRoute = selectPaymentRoute(otherRequest, ['arkade', 'lightning', 'onchain']);
  if (!otherRoute || otherRoute.layer === 'arkade') return null;
  return `NETWORK MISMATCH. THIS QR IS FOR ${networkLabel(otherNetwork).toUpperCase()}, BUT THIS BUILD IS ON ${PAYMENT_NETWORK_UPPER}.`;
}

export default function SendScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [permission, requestPermission] = useCameraPermissions();
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [currency, setCurrency] = useState<FiatCurrency>('USD');
  const [sending, setSending] = useState(false);
  const [loadingMax, setLoadingMax] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [ownAddress, setOwnAddress] = useState('');
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);
  const [totalBalance, setTotalBalance] = useState<number | null>(null);
  const [frozenBalance, setFrozenBalance] = useState(0);
  const [balanceFormat, setBalanceFormat] = useState<BalanceFormat>('symbol');
  const [formError, setFormError] = useState<string | null>(null);
  const [nativeFallback, setNativeFallback] = useState<NativeFallback | null>(null);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [sentPayment, setSentPayment] = useState<SentPayment | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [swapIdCopied, setSwapIdCopied] = useState(false);
  const [successState, setSuccessState] = useState<SuccessState>('idle');
  const [explorerHint, setExplorerHint] = useState<string | null>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const successProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Promise.all([getArkAddress(), getBalance()])
      .then(([walletAddress, wallet]) => {
        setOwnAddress(walletAddress);
        setAvailableBalance(wallet.offchainBalance);
        setTotalBalance(wallet.balance);
        setFrozenBalance(wallet.frozenBalance);
      })
      .catch(error => setFormError(friendlySendError(error, null)));
    getFiatCurrency().then(setCurrency).catch(() => {});
    getBalanceFormat().then(setBalanceFormat).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(priceApiUrl(currency))
      .then(r => r.json())
      .then(data => setBtcPrice(parseFloat(data.data.amount)))
      .catch(() => {});
  }, [currency]);

  function handleAddressChange(value: string) {
    setAddress(value);
    const parsed = parsePaymentInput(value, PAYMENT_NETWORK);
    if (parsed?.amountSats) setAmount(String(parsed.amountSats));
    setScanError(null);
    setFormError(null);
    setNativeFallback(null);
  }

  function handleScan({ data }: BarcodeScanningResult) {
    if (scanned) return;

    const parsed = parsePaymentQR(data);
    if (!parsed) {
      setScanError(paymentNetworkMismatchError(data) ?? `QR NOT RECOGNIZED. USE ARKADE, ${PAYMENT_NETWORK_UPPER} BITCOIN, ${PAYMENT_NETWORK_UPPER} LIGHTNING OR LNURL.`);
      return;
    }

    setAddress(parsed.destination.address);
    if (parsed.amountSats) setAmount(String(parsed.amountSats));
    setScanned(true);
    setScanError(null);
    setFormError(null);
  }

  async function handleMax() {
    if (loadingMax || sending) return;
    setLoadingMax(true);
    setFormError(null);
    try {
      const wallet = await getBalance();
      const maximum = wallet.offchainBalance;
      setAvailableBalance(maximum);
      setTotalBalance(wallet.balance);
      setFrozenBalance(wallet.frozenBalance);
      if (maximum < MIN_ARKADE_SEND) {
        setAmount('');
        setFormError(wallet.frozenBalance > 0
          ? 'YOUR ARKADE FUNDS ARE FROZEN. UNFREEZE A VTXO IN COIN CONTROL BEFORE SENDING.'
          : 'NO ARKADE FUNDS ARE CURRENTLY AVAILABLE TO SEND.');
        return;
      }
      setAmount(String(maximum));
    } catch (error) {
      setFormError(friendlySendError(error, availableBalance));
    } finally {
      setLoadingMax(false);
    }
  }

  // Started from PixelFill's onReady so the grid is mounted before progress
  // moves — otherwise the natively driven fill runs ahead of first paint.
  const startSuccessAnimation = () => {
    successProgress.setValue(0);
    Animated.timing(successProgress, {
      toValue: 1,
      duration: 900,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => setSuccessState('complete'));
  };

  async function send(destination: Destination, sats: number) {
    setSending(true);
    setFormError(null);
    try {
      // The screen can remain open while an earlier Arkade payment is being
      // preconfirmed. Never trust the balance captured on mount for a new
      // spend: the change may not be usable yet even though the home screen has
      // not refreshed.
      const currentWallet = await getBalance();
      const spendable = currentWallet.offchainBalance;
      setAvailableBalance(spendable);
      setTotalBalance(currentWallet.balance);
      setFrozenBalance(currentWallet.frozenBalance);
      if (sats > spendable) {
        void addDiagnosticLog(
          'warning',
          'Arkade send blocked by refreshed spendable balance',
          `requested_sats=${sats}; available_sats=${spendable}; total_sats=${currentWallet.balance}`,
        ).catch(() => {});
        setFormError(
          currentWallet.balance >= sats
            ? `FUNDS ARE STILL BECOMING SPENDABLE. AVAILABLE NOW: ${spendable.toLocaleString('en-US')} SATS. WAIT FOR THE PREVIOUS ARKADE PAYMENT TO PRECONFIRM, THEN TRY AGAIN.`
            : `INSUFFICIENT FUNDS. AVAILABLE TO SEND: ${spendable.toLocaleString('en-US')} SATS.`,
        );
        return;
      }
      const txid = await sendSats(destination.address, sats);
      setSentPayment({ destination, sats, txid });
      setSuccessState('animating');
      void getBalance()
        .then(wallet => {
          setAvailableBalance(wallet.offchainBalance);
          setTotalBalance(wallet.balance);
          setFrozenBalance(wallet.frozenBalance);
        })
        .catch(() => {});
    } catch (error) {
      const refreshedWallet = await getBalance().catch(() => null);
      if (refreshedWallet) {
        setAvailableBalance(refreshedWallet.offchainBalance);
        setTotalBalance(refreshedWallet.balance);
        setFrozenBalance(refreshedWallet.frozenBalance);
      }
      void addDiagnosticLog(
        'error',
        'Arkade send failed after refreshed balance check',
        `requested_sats=${sats}; available_sats=${refreshedWallet?.offchainBalance ?? availableBalance ?? 'unknown'}; total_sats=${refreshedWallet?.balance ?? 'unknown'}; error_class=${error instanceof Error ? error.name : 'unknown'}`,
      ).catch(() => {});
      const raw = error instanceof Error ? error.message : String(error || '');
      const reportsInsufficientFunds = /insufficient|not enough|balance|no arkade funds/i.test(raw);
      if (reportsInsufficientFunds && refreshedWallet && refreshedWallet.offchainBalance >= sats) {
        setFormError(
          `ARKADE HAS NOT FINALIZED THE PREVIOUS PAYMENT YET. ${refreshedWallet.offchainBalance.toLocaleString('en-US')} SATS ARE REPORTED, BUT THE CHANGE CANNOT BE SPENT RIGHT NOW. WAIT FOR PRECONFIRMATION, THEN TRY AGAIN.`,
        );
      } else {
        setFormError(friendlySendError(error, refreshedWallet?.offchainBalance ?? availableBalance));
      }
    } finally {
      setSending(false);
    }
  }

  function insufficientFundsMessage(required: number, includingFees = false): string {
    if (
      availableBalance !== null
      && frozenBalance > 0
      && required <= availableBalance + frozenBalance
    ) {
      return 'THIS PAYMENT NEEDS A FROZEN VTXO. UNFREEZE IT IN COIN CONTROL OR SEND A SMALLER AMOUNT.';
    }
    return includingFees
      ? `INSUFFICIENT FUNDS INCLUDING FEES. REQUIRED: ${required.toLocaleString('en-US')} SATS.`
      : `INSUFFICIENT FUNDS. AVAILABLE: ${(availableBalance ?? 0).toLocaleString('en-US')} SATS.`;
  }

  async function handleSend() {
    const paymentRequest = parsePaymentInput(address, PAYMENT_NETWORK);
    const parsed = parsePaymentQR(address);
    const destination = parsed?.destination ?? null;
    const sats = Number(amount || paymentRequest?.amountSats || 0);
    setNativeFallback(null);

    if (!destination) {
      setFormError(paymentNetworkMismatchError(address) ?? `INVALID RECIPIENT. USE ARKADE, ${PAYMENT_NETWORK_UPPER} BITCOIN OR ${PAYMENT_NETWORK_UPPER} LIGHTNING.`);
      return;
    }
    if (!Number.isSafeInteger(sats) || sats <= 0) {
      setFormError('INVALID AMOUNT. ENTER A WHOLE NUMBER OF SATS.');
      return;
    }
    if (destination.layer === 'arkade' && sats < MIN_ARKADE_SEND) {
      setFormError(`AMOUNT BELOW THE ${PAYMENT_NETWORK_UPPER} MINIMUM OF ${MIN_ARKADE_SEND} SATS.`);
      return;
    }
    if (destination.layer === 'arkade' && availableBalance !== null && sats > availableBalance) {
      setFormError(insufficientFundsMessage(sats));
      return;
    }
    if (destination.layer === 'arkade' && ownAddress && destination.address.toLowerCase() === ownAddress.toLowerCase()) {
      setFormError('YOU CANNOT SEND TO YOUR OWN ARKADE ADDRESS.');
      return;
    }
    if (destination.layer === 'arkade' && ownAddress && !belongsToSameArkadeServer(destination.address, ownAddress)) {
      setFormError(`ARKADE SERVER MISMATCH. USE AN ADDRESS FROM THE ${PAYMENT_NETWORK_UPPER} ARKADE WALLET.`);
      return;
    }

    if (destination.layer === 'onchain') {
      if (!paymentRequest) {
        setFormError(`INVALID ${PAYMENT_NETWORK_UPPER} BITCOIN PAYMENT REQUEST.`);
        return;
      }
      setQuoting(true);
      setFormError(null);
      try {
        if (PAYMENT_NETWORK === 'bitcoin' && SWAP_PROVIDER === 'satora') {
          const quote = await quoteNativeOnchainPayment(paymentRequest, sats);
          if (availableBalance !== null && quote.sendAmountSats > availableBalance) {
            setFormError(
              `INSUFFICIENT FUNDS INCLUDING NATIVE EXIT FEES. REQUIRED: ${quote.sendAmountSats.toLocaleString('en-US')} SATS.`,
            );
            return;
          }
          setPendingPayment({ destination, sats: quote.receiveAmountSats, quote });
          return;
        }
        const quote = await quoteArkToBitcoin(paymentRequest, sats);
        if (availableBalance !== null && quote.sendAmountSats > availableBalance) {
          setFormError(insufficientFundsMessage(quote.sendAmountSats, true));
          return;
        }
        setPendingPayment({ destination, sats, quote });
      } catch (error) {
        if (PAYMENT_NETWORK === 'bitcoin' && SWAP_PROVIDER === 'satora') {
          setFormError(friendlySendError(error, availableBalance, 'arkade'));
          return;
        }
        const message = friendlyNetworkError(error, 'boltz');
        setFormError(`BITCOIN QUOTE FAILED. ${message}`);
        if (canOfferNativeOnchainFallback({
          swapCreated: false,
          fundingAttempted: false,
        })) {
          setNativeFallback({ destination, sats, request: paymentRequest });
        }
      } finally {
        setQuoting(false);
      }
      return;
    }

    if (destination.layer === 'lightning') {
      if (!paymentRequest) {
        setFormError('INVALID LIGHTNING REQUEST.');
        return;
      }
      setQuoting(true);
      setFormError(null);
      try {
        const lightningRequest = await resolveLightningRequestToBolt11(paymentRequest, sats);
        const quote = await quoteArkToLightningForProvider(lightningRequest, sats);
        if (availableBalance !== null && quote.sendAmountSats > availableBalance) {
          setFormError(insufficientFundsMessage(quote.sendAmountSats, true));
          return;
        }
        setPendingPayment({ destination, sats: quote.receiveAmountSats, quote });
      } catch (error) {
        const message = friendlyNetworkError(error, 'lightning');
        setFormError(`LIGHTNING QUOTE FAILED. ${message}`);
      } finally {
        setQuoting(false);
      }
      return;
    }

    setFormError(null);
    setPendingPayment({ destination, sats });
  }

  async function handleNativeFallback() {
    if (!nativeFallback || quoting || sending) return;
    const fallback = nativeFallback;
    setQuoting(true);
    setFormError(null);
    try {
      const quote = await quoteNativeOnchainPayment(
        fallback.request,
        fallback.sats,
      );
      if (availableBalance !== null && quote.sendAmountSats > availableBalance) {
        setFormError(insufficientFundsMessage(quote.sendAmountSats, true));
        return;
      }
      setNativeFallback(null);
      setPendingPayment({
        destination: fallback.destination,
        sats: quote.receiveAmountSats,
        quote,
      });
    } catch (error) {
      setFormError(
        `NATIVE ARKADE EXIT UNAVAILABLE. ${friendlyNetworkError(error, 'arkade')}`,
      );
    } finally {
      setQuoting(false);
    }
  }

  async function confirmSend() {
    if (!pendingPayment || sending) return;
    const payment = pendingPayment;
    setPendingPayment(null);
    if (payment.quote) {
      setSending(true);
      setFormError(null);
      try {
        const currentWallet = await getBalance();
        const spendable = currentWallet.offchainBalance;
        setAvailableBalance(spendable);
        setTotalBalance(currentWallet.balance);
        setFrozenBalance(currentWallet.frozenBalance);
        if (payment.quote.sendAmountSats > spendable) {
          void addDiagnosticLog(
            'warning',
            'Quoted payment blocked by refreshed spendable balance',
            `quote_sats=${payment.quote.sendAmountSats}; available_sats=${spendable}; total_sats=${currentWallet.balance}; provider=${payment.quote.provider}`,
          ).catch(() => {});
          setFormError(
            currentWallet.balance >= payment.quote.sendAmountSats
              ? `FUNDS ARE STILL BECOMING SPENDABLE. AVAILABLE NOW: ${spendable.toLocaleString('en-US')} SATS. WAIT FOR THE PREVIOUS ARKADE PAYMENT TO PRECONFIRM, THEN TRY AGAIN.`
              : `INSUFFICIENT FUNDS INCLUDING FEES. AVAILABLE TO SEND: ${spendable.toLocaleString('en-US')} SATS.`,
          );
          return;
        }
        const result = await sendQuotedPayment(payment.quote);
        const providerData = (result.providerData ?? {}) as { refundTestMode?: boolean };
        setSentPayment({
          destination: payment.destination,
          sats: payment.sats,
          txid: result.txid,
          paymentId: result.id,
          // A successful return means the Arkade lockup was funded and stored.
          // The swap may already be settled on fast test networks, but it was
          // not shown as settled until the wallet status screen reports it.
          fundedSwap: result.provider !== 'arkade-native',
          nativeExit: result.provider === 'arkade-native',
          refundTestMode: providerData.refundTestMode === true,
        });
        setSuccessState('animating');
        void getBalance()
          .then(wallet => {
            setAvailableBalance(wallet.offchainBalance);
            setTotalBalance(wallet.balance);
            setFrozenBalance(wallet.frozenBalance);
          })
          .catch(() => {});
      } catch (error) {
        setFormError(friendlySendError(
          error,
          availableBalance,
          payment.quote?.provider === 'arkade-native'
            ? 'arkade'
            : payment.destination.layer === 'lightning'
            ? 'lightning'
            : payment.destination.layer === 'onchain'
              ? 'boltz'
              : 'arkade',
        ));
      } finally {
        setSending(false);
      }
      return;
    }
    await send(payment.destination, payment.sats);
  }

  async function copySentAddress() {
    if (!sentPayment) return;
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(sentPayment.destination.address);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 1800);
  }

  async function openTransactionExplorer() {
    if (!sentPayment?.txid) return;
    const usesMempool = sentPayment.destination.layer === 'onchain' && !sentPayment.nativeExit;
    const link = usesMempool
      ? { url: `${MEMPOOL_EXPLORER}/tx/${sentPayment.txid}`, direct: true }
      : resolveArkadeExplorer(sentPayment.txid);
    if (!link) {
      setExplorerHint('NO PUBLIC EXPLORER IS CONFIGURED FOR THIS ARKADE TRANSACTION.');
      return;
    }
    if (!link.direct) {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(sentPayment.txid);
      setExplorerHint('TRANSACTION ID COPIED. PASTE IT INTO ARK EXPLORER.');
    }
    await Linking.openURL(link.url);
  }

  function openPaymentStatus() {
    if (!sentPayment?.paymentId) return;
    router.replace({ pathname: '/transaction', params: { txId: sentPayment.paymentId, kind: 'payment' } });
  }

  async function copySwapId() {
    if (!sentPayment?.paymentId) return;
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(sentPayment.paymentId);
    setSwapIdCopied(true);
    setTimeout(() => setSwapIdCopied(false), 1800);
  }

  const satsToUsd = (sats: number) => {
    if (!btcPrice) return null;
    const symbol = CURRENCY_SYMBOL[currency];
    const amount = ((sats / 100_000_000) * btcPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return symbol.length > 1 ? `${symbol} ${amount}` : `${symbol}${amount}`;
  };
  const inputPaymentRequest = parsePaymentInput(address, PAYMENT_NETWORK);
  const hasInput = Boolean(address.trim() && (amount.trim() || inputPaymentRequest?.amountSats));
  const showSuccess = successState !== 'idle' && sentPayment !== null;
  const amountUnitLabel = balanceFormat === 'sats'
      ? 'SATS'
      : balanceFormat === 'btc'
        ? 'BTC'
        : currency;

  return (
    <SafeAreaView style={[s.safe, successState === 'complete' && s.safeSuccess]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace('/')} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.title}>SEND</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={s.kav} behavior="padding">
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={s.field}>
          <Text style={s.label}>SEND ON BITCOIN, LIGHTNING OR ARKADE</Text>
          <TextInput
            style={[s.textInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
            value={address}
            onChangeText={handleAddressChange}
            placeholder="address or invoice"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={s.scannerSection}>
          <Text style={s.label}>SCAN QR</Text>
          <View style={s.cameraFrame}>
            {scanned ? (
              <View style={s.scannedPanel}>
                <Text style={s.scannedIcon}>✓</Text>
                <Text style={s.scannedTitle}>QR SCANNED</Text>
                <Text style={s.scannedText}>PAYMENT DETAILS FILLED BELOW</Text>
              </View>
            ) : permission?.granted ? (
              <>
                <CameraView
                  style={s.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanned ? undefined : handleScan}
                />
                <View pointerEvents="none" style={s.scanGuide} />
              </>
            ) : (
              <View style={s.permissionPanel}>
                <Text style={s.permissionText}>CAMERA ACCESS IS NEEDED TO SCAN A PAYMENT QR.</Text>
                <TouchableOpacity style={s.permissionBtn} onPress={() => void requestPermission()}>
                  <Text style={s.permissionBtnText}>ENABLE CAMERA</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {scanError && <Text style={s.scanError}>{scanError}</Text>}
          {scanned && (
            <TouchableOpacity style={s.rescanBtn} onPress={() => { setScanned(false); setScanError(null); }}>
              <Text style={s.rescanText}>SCAN AGAIN</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.field}>
          <View style={s.amountLabelRow}>
            <Text style={s.label}>AMOUNT</Text>
            <Text style={s.label}>(</Text>
            {balanceFormat === 'symbol' ? (
              <BitcoinIcon size={14} color={colors.muted} />
            ) : (
              <Text style={s.label}>{amountUnitLabel}</Text>
            )}
            <Text style={s.label}>)</Text>
          </View>
          <View style={s.amountRow}>
            <TextInput
              style={[s.textInput, s.big, s.amountInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
              value={amount}
              onChangeText={value => {
                setAmount(value.replace(/\D/g, ''));
                setFormError(null);
                setNativeFallback(null);
              }}
              placeholder="0"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
            />
            <View style={s.amountUnitWrap}>
              {balanceFormat === 'symbol' ? (
                <BitcoinIcon size={24} color={colors.muted} />
              ) : (
                <Text style={s.amountUnit}>{amountUnitLabel}</Text>
              )}
            </View>
            <TouchableOpacity style={[s.maxBtn, (loadingMax || sending) && s.disabled]} onPress={() => void handleMax()} disabled={loadingMax || sending}>
              {loadingMax ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={s.maxText}>MAX</Text>}
            </TouchableOpacity>
          </View>
          <View style={s.amountMeta}>
            {availableBalance !== null && (
              <View style={s.metaAmount}>
                <Text style={s.available}>AVAILABLE TO SEND: </Text>
                <WalletAmount
                  sats={availableBalance}
                  format={balanceFormat}
                  btcPrice={btcPrice}
                  currencySymbol={CURRENCY_SYMBOL[currency]}
                  iconSize={14}
                  iconColor={colors.muted}
                  textStyle={s.available}
                  iconOffsetY={-2}
                  gap={2}
                />
              </View>
            )}
            {totalBalance !== null && totalBalance !== availableBalance && (
              <View style={s.metaAmount}>
                <Text style={s.available}>TOTAL WALLET: </Text>
                <WalletAmount
                  sats={totalBalance}
                  format={balanceFormat}
                  btcPrice={btcPrice}
                  currencySymbol={CURRENCY_SYMBOL[currency]}
                  iconSize={14}
                  iconColor={colors.muted}
                  textStyle={s.available}
                  iconOffsetY={-2}
                  gap={2}
                />
              </View>
            )}
          </View>
        </View>

        {formError && (
          <View style={s.errorCard} accessibilityRole="alert">
            <Text style={s.errorTitle}>PAYMENT ERROR</Text>
            <Text style={s.errorText}>{formError}</Text>
            {nativeFallback && (
              <TouchableOpacity
                style={[s.nativeFallbackBtn, (quoting || sending) && s.disabled]}
                onPress={() => void handleNativeFallback()}
                disabled={quoting || sending}
              >
                {quoting
                  ? <ActivityIndicator size="small" color={colors.onPrimary} />
                  : <Text style={s.nativeFallbackText}>USE ARKADE NATIVE EXIT</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}

        <TouchableOpacity style={[s.sendBtn, !hasInput && s.disabled]} onPress={() => void handleSend()} disabled={sending || quoting || !hasInput}>
          {sending || quoting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={s.sendText}>↑ CONFIRM</Text>}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={pendingPayment !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingPayment(null)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.confirmCard}>
            <Text style={s.confirmTitle}>CONFIRM PAYMENT</Text>
            {pendingPayment && (
              <WalletAmount
                sats={pendingPayment.quote?.receiveAmountSats ?? pendingPayment.sats}
                format={balanceFormat}
                btcPrice={btcPrice}
                currencySymbol={CURRENCY_SYMBOL[currency]}
                iconSize={32}
                iconColor={colors.primaryDark}
                textStyle={s.confirmAmount}
                containerStyle={s.centeredAmount}
              />
            )}
            {pendingPayment && satsToUsd(pendingPayment.sats) && (
              <Text style={s.confirmUsd}>≈ {satsToUsd(pendingPayment.sats)}</Text>
            )}
            <Text style={s.confirmNetwork}>
              {pendingPayment?.quote
                ? pendingPayment.quote.layer === 'lightning'
                  ? `LIGHTNING · ${PAYMENT_NETWORK_UPPER} · VIA ${pendingPayment.quote.provider.toUpperCase()}`
                  : pendingPayment.quote.provider === 'arkade-native'
                    ? `BITCOIN · ${PAYMENT_NETWORK_UPPER} · ARKADE NATIVE EXIT`
                    : `BITCOIN · ${PAYMENT_NETWORK_UPPER} · VIA ${pendingPayment.quote.provider.toUpperCase()}`
                : `ARKADE · ${PAYMENT_NETWORK_UPPER}`}
            </Text>
            {pendingPayment?.quote && (
              <View style={s.quoteDetails}>
                <View style={s.quoteRow}>
                  <Text style={s.quoteLabel}>{pendingPayment.quote.layer === 'lightning' ? 'INVOICE AMOUNT' : 'RECIPIENT GETS'}</Text>
                  <WalletAmount
                    sats={pendingPayment.quote.receiveAmountSats}
                    format={balanceFormat}
                    btcPrice={btcPrice}
                    currencySymbol={CURRENCY_SYMBOL[currency]}
                    iconSize={14}
                    iconColor={colors.primaryDark}
                    textStyle={s.quoteValue}
                  />
                </View>
                <View style={s.quoteRow}>
                  <Text style={s.quoteLabel}>ESTIMATED FEES</Text>
                  <WalletAmount
                    sats={pendingPayment.quote.feeSats}
                    format={balanceFormat}
                    btcPrice={btcPrice}
                    currencySymbol={CURRENCY_SYMBOL[currency]}
                    iconSize={14}
                    iconColor={colors.primaryDark}
                    textStyle={s.quoteValue}
                  />
                </View>
                <View style={s.quoteRow}>
                  <Text style={s.quoteLabel}>TOTAL FROM ARKADE</Text>
                  <WalletAmount
                    sats={pendingPayment.quote.sendAmountSats}
                    format={balanceFormat}
                    btcPrice={btcPrice}
                    currencySymbol={CURRENCY_SYMBOL[currency]}
                    iconSize={14}
                    iconColor={colors.primaryDark}
                    textStyle={s.quoteValue}
                  />
                </View>
                <View style={s.quoteRow}>
                  <Text style={s.quoteLabel}>QUOTE VALIDITY</Text>
                  <Text style={s.quoteValue}>60 SEC</Text>
                </View>
              </View>
            )}
            <Text style={s.confirmAddress} selectable>{pendingPayment?.destination.address}</Text>
            <View style={s.confirmActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setPendingPayment(null)}>
                <Text style={s.cancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.confirmBtn}
                onPress={() => void confirmSend()}
              >
                <Text style={s.confirmBtnText}>SEND</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Same reasoning as the receive overlay: full-bleed background, but
          padded content so nothing sits under the navigation bar. */}
      {showSuccess && (
        <View style={[
          s.successOverlay,
          successState === 'complete' && s.successComplete,
          { paddingBottom: insets.bottom },
        ]}>
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
              <Text style={s.successEyebrow}>
                {sentPayment.refundTestMode
                  ? 'REFUND TEST ARMED'
                  : sentPayment.fundedSwap
                    ? 'SWAP FUNDED'
                    : sentPayment.nativeExit
                      ? 'EXIT SUBMITTED'
                      : 'PAYMENT SUBMITTED'}
              </Text>
              {(sentPayment.fundedSwap || sentPayment.nativeExit) && (
                <Text style={s.safeToClose}>
                  {sentPayment.refundTestMode
                    ? 'CLOSE ALICE NOW'
                    : sentPayment.nativeExit
                      ? 'AWAITING ARKADE SETTLEMENT'
                      : 'SETTLEMENT NOT CONFIRMED'}
                </Text>
              )}
              <WalletAmount
                sats={sentPayment.sats}
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
              {satsToUsd(sentPayment.sats) && (
                <Text style={s.successUsd}>≈ {satsToUsd(sentPayment.sats)}</Text>
              )}

              <View style={s.successDivider} />

              <Text style={s.successLabel}>TO</Text>
              <TouchableOpacity style={s.successLink} onPress={() => void copySentAddress()}>
                <Text style={s.successAddress}>{sentPayment.destination.address}</Text>
                <Text style={s.successLinkHint}>{addressCopied ? 'COPIED' : 'TAP TO COPY'}</Text>
              </TouchableOpacity>

              {sentPayment.fundedSwap ? (
                <>
                  <Text style={s.successLabel}>STATUS</Text>
                  <TouchableOpacity style={s.successLink} onPress={sentPayment.refundTestMode ? () => void copySwapId() : openPaymentStatus}>
                    <Text style={s.successAddress}>{sentPayment.paymentId}</Text>
                    <Text style={s.successLinkHint}>
                      {sentPayment.refundTestMode
                        ? swapIdCopied ? 'COPIED · DO NOT REOPEN BEFORE SWAP.EXPIRED' : 'TAP TO COPY · DO NOT REOPEN BEFORE SWAP.EXPIRED'
                        : 'VIEW WALLET STATUS'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : sentPayment.txid ? (
                <>
                  <Text style={s.successLabel}>TRANSACTION</Text>
                  <TouchableOpacity style={s.successLink} onPress={() => void openTransactionExplorer()}>
                    <Text style={s.successAddress}>{sentPayment.txid}</Text>
                    <Text style={s.successLinkHint}>{explorerHint ?? 'OPEN EXPLORER'}</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>

            {sentPayment.refundTestMode ? (
              <Text style={s.refundCloseNotice}>COPY THE SWAP ID, THEN CLOSE THIS TAB</Text>
            ) : (
              <TouchableOpacity style={s.successBtn} onPress={() => router.replace('/')}>
                <Text style={s.successBtnText}>BACK TO WALLET</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  safeSuccess: { backgroundColor: colors.primary },
  kav: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', ...pixel, backgroundColor: colors.cardBg },
  backIcon: { fontFamily: typography.pixel, fontSize: 18, color: colors.primary },
  title: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 3 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl },
  errorCard: { ...pixel, backgroundColor: '#fff1f1', borderColor: '#e06060', padding: spacing.md, gap: spacing.sm },
  errorTitle: { fontFamily: typography.pixel, fontSize: 7, color: '#c84f4f', letterSpacing: 1 },
  errorText: { fontFamily: typography.pixel, fontSize: 6, color: '#9e4141', lineHeight: 13 },
  nativeFallbackBtn: { ...pixel, backgroundColor: colors.primary, borderColor: colors.primaryDark, paddingVertical: spacing.md, alignItems: 'center' },
  nativeFallbackText: { fontFamily: typography.pixel, fontSize: 7, color: colors.onPrimary, letterSpacing: 1 },
  field: { gap: spacing.sm },
  label: { fontFamily: typography.pixel, fontSize: 8, color: colors.muted, letterSpacing: 2 },
  amountLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  textInput: {
    ...pixel,
    height: 54,
    backgroundColor: colors.cardBg,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    fontFamily: typography.numbers,
    color: colors.primaryDark,
    fontSize: 16,
    textAlignVertical: 'center',
    includeFontPadding: true,
  },
  big: { fontSize: 28 },
  amountRow: { ...pixel, minHeight: 62, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg },
  amountInput: { flex: 1, height: 62, backgroundColor: 'transparent', borderWidth: 0 },
  amountUnitWrap: { minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  amountUnit: { fontFamily: typography.pixel, fontSize: 8, color: colors.muted, letterSpacing: 2 },
  maxBtn: { ...pixel, alignSelf: 'stretch', minWidth: 76, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderColor: colors.primaryDark },
  maxText: { fontFamily: typography.pixel, fontSize: 8, color: colors.onPrimary, letterSpacing: 1 },
  amountMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' },
  metaAmount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  usdEquiv: { fontFamily: typography.numbers, fontSize: 14, color: colors.muted },
  available: { fontFamily: typography.pixel, fontSize: 8, color: colors.muted, letterSpacing: 1, textAlign: 'right' },
  scannerSection: { gap: spacing.sm },
  cameraFrame: { ...pixel, height: 230, overflow: 'hidden', backgroundColor: colors.backgroundSoft, position: 'relative' },
  camera: { flex: 1 },
  scanGuide: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 150,
    height: 150,
    marginLeft: -75,
    marginTop: -75,
    borderWidth: 3,
    borderColor: colors.white,
    borderRadius: 2,
    opacity: 0.9,
  },
  scannedPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  scannedIcon: { fontFamily: typography.pixel, fontSize: 24, color: colors.primaryDark },
  scannedTitle: { fontFamily: typography.pixel, fontSize: 9, color: colors.primaryDark, letterSpacing: 2 },
  scannedText: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1, textAlign: 'center' },
  permissionPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  permissionText: { fontFamily: typography.pixel, fontSize: 7, color: colors.muted, lineHeight: 14, textAlign: 'center' },
  permissionBtn: { ...pixel, backgroundColor: colors.primary, borderColor: colors.primaryDark, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  permissionBtnText: { fontFamily: typography.pixel, fontSize: 7, color: colors.onPrimary, letterSpacing: 1 },
  scanError: { fontFamily: typography.pixel, fontSize: 6, color: '#e06060', lineHeight: 12, textAlign: 'center' },
  rescanBtn: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  rescanText: { fontFamily: typography.pixel, fontSize: 7, color: colors.primaryDark, letterSpacing: 1 },
  sendBtn: { ...pixel, backgroundColor: colors.primary, borderColor: colors.primaryDark, paddingVertical: spacing.lg, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  sendText: { fontFamily: typography.pixel, fontSize: 10, color: colors.onPrimary, letterSpacing: 2 },
  hint: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(48, 74, 112, 0.48)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  confirmCard: { ...pixel, width: '100%', maxWidth: 420, backgroundColor: colors.background, padding: spacing.xl, gap: spacing.lg },
  confirmTitle: { fontFamily: typography.pixel, fontSize: 9, color: colors.primaryDark, letterSpacing: 2, textAlign: 'center' },
  confirmAmount: { fontFamily: typography.numbers, fontSize: 32, color: colors.primaryDark, textAlign: 'center' },
  centeredAmount: { justifyContent: 'center', alignItems: 'center' },
  confirmUsd: { fontFamily: typography.numbers, fontSize: 16, color: colors.muted, textAlign: 'center' },
  confirmNetwork: { fontFamily: typography.pixel, fontSize: 7, color: colors.muted, letterSpacing: 1, textAlign: 'center' },
  quoteDetails: { gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.dotted },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  quoteLabel: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1 },
  quoteValue: { fontFamily: typography.numbers, fontSize: 13, color: colors.primaryDark },
  confirmAddress: { ...pixel, backgroundColor: colors.cardBg, padding: spacing.md, fontFamily: typography.numbers, fontSize: 13, lineHeight: 18, color: colors.primaryDark, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: spacing.md },
  cancelBtn: { ...pixel, flex: 1, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.cardBg },
  cancelText: { fontFamily: typography.pixel, fontSize: 7, color: colors.primaryDark, letterSpacing: 1 },
  confirmBtn: { ...pixel, flex: 1, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.primaryDark },
  confirmBtnText: { fontFamily: typography.pixel, fontSize: 7, color: colors.onPrimary, letterSpacing: 1 },
  successOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, overflow: 'hidden' },
  successComplete: { backgroundColor: colors.primary },
  successContent: { flex: 1 },
  successClose: { position: 'absolute', top: spacing.sm, left: spacing.md, zIndex: 2, width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  successCloseText: { fontFamily: typography.numbers, fontSize: 42, lineHeight: 46, color: colors.onPrimary },
  successReceipt: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl },
  successEyebrow: { fontFamily: typography.pixel, fontSize: 11, color: colors.onPrimary, letterSpacing: 3, textAlign: 'center' },
  safeToClose: { marginTop: spacing.md, marginBottom: spacing.sm, fontFamily: typography.pixel, fontSize: 8, color: colors.onPrimary, letterSpacing: 2, textAlign: 'center' },
  refundCloseNotice: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, fontFamily: typography.pixel, fontSize: 7, lineHeight: 16, color: colors.onPrimary, letterSpacing: 1, textAlign: 'center' },
  successAmount: { marginTop: spacing.xxl, fontFamily: typography.numbers, fontSize: 56, lineHeight: 62, color: colors.onPrimary, textAlign: 'center' },
  successAmountRow: { marginTop: spacing.xxl, justifyContent: 'center' },
  successUnit: { fontFamily: typography.pixel, fontSize: 9, color: colors.onPrimary, letterSpacing: 3 },
  successUsd: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 18, color: colors.onPrimary, opacity: 0.7, textAlign: 'center' },
  successDivider: { width: 44, height: 3, marginVertical: spacing.xxxl, backgroundColor: colors.onPrimary },
  successLabel: { marginTop: spacing.xxxl, fontFamily: typography.pixel, fontSize: 7, color: colors.onPrimary, letterSpacing: 2, textAlign: 'center' },
  successValue: { marginTop: spacing.sm, fontFamily: typography.pixel, fontSize: 8, color: colors.onPrimary, letterSpacing: 1, textAlign: 'center' },
  successAddress: { marginTop: spacing.sm, maxWidth: 460, fontFamily: typography.numbers, fontSize: 14, lineHeight: 19, color: colors.onPrimary, textAlign: 'center' },
  successLink: { alignItems: 'center', maxWidth: 460 },
  successLinkHint: { marginTop: spacing.xs, fontFamily: typography.pixel, fontSize: 6, color: colors.onPrimary, letterSpacing: 1, textAlign: 'center' },
  successBtn: { ...pixel, backgroundColor: colors.onPrimary, marginHorizontal: spacing.xxl, marginBottom: spacing.xxxl, paddingVertical: spacing.lg, alignItems: 'center' },
  successBtnText: { fontFamily: typography.pixel, fontSize: 9, color: colors.primary, letterSpacing: 2 },
  });
}
