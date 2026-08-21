import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { friendlyRefundError, getPaymentDetails, getTransactionHistory, refundPayment } from '@alice-wallet/wallet-core';
import { getConfirmations } from '@alice-wallet/wallet-core';
import { getFiatCurrency, priceApiUrl, CURRENCY_SYMBOL, type FiatCurrency } from '@alice-wallet/alice-ui';
import type { Transaction, TransactionStatus, TransactionLayer } from '@alice-wallet/wallet-core';
import type { PaymentRecord, PaymentStatus } from '@alice-wallet/wallet-core';
import { getBalanceFormat, type BalanceFormat } from '@alice-wallet/alice-ui';
import { WalletAmount } from '@alice-wallet/alice-ui';
import { resolvePaymentExplorer, resolveTransactionExplorer } from '@alice-wallet/wallet-core';

const LAYER_LABELS: Record<TransactionLayer, string> = {
  ark: 'Ark',
  onchain: 'On-chain',
  lightning: 'Lightning',
};
const POLL_INTERVAL = 8_000;

function statusConfig(status: TransactionStatus, colors: Colors): { label: string; color: string } {
  switch (status) {
    case 'pending': return { label: 'Pending', color: colors.warning };
    case 'preconfirmed': return { label: 'Preconfirmed', color: colors.primary };
    case 'settled': return { label: 'Settled', color: colors.success };
    case 'failed': return { label: 'Failed', color: colors.danger };
  }
}

function paymentStatusConfig(status: PaymentStatus, colors: Colors): { label: string; color: string } {
  switch (status) {
    case 'settled': return { label: 'Settled', color: colors.success };
    case 'refundable': return { label: 'Refund available', color: colors.warning };
    case 'refunded': return { label: 'Refunded', color: colors.primary };
    case 'failed': return { label: 'Failed', color: colors.danger };
    case 'expired': return { label: 'Expired', color: colors.danger };
    case 'created': return { label: 'Created', color: colors.warning };
    case 'quoted': return { label: 'Quoted', color: colors.warning };
    case 'pending': return { label: 'Pending', color: colors.warning };
  }
}

function fmtDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    + ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function fmtRelative(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncate(s: string) {
  return s.length > 16 ? s.slice(0, 8) + '...' + s.slice(-8) : s;
}

function primaryTxid(tx: Transaction): string {
  return tx.arkTxid || tx.commitmentTxid || tx.boardingTxid;
}

export default function TransactionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ txId: string; kind?: 'transaction' | 'payment' }>();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [tx, setTx] = useState<Transaction | null>(null);
  const [payment, setPayment] = useState<PaymentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [currency, setCurrency] = useState<FiatCurrency>('USD');
  const [balanceFormat, setBalanceFormat] = useState<BalanceFormat>('symbol');
  const [copied, setCopied] = useState(false);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const findTx = useCallback(() => {
    const request = params.kind === 'payment'
      ? getPaymentDetails(params.txId).then(found => { if (found) setPayment(found); })
      : getTransactionHistory().then(list => {
          const found = list.find(t => t.id === params.txId);
          if (found) setTx(found);
        });
    request.catch(() => {}).finally(() => setLoading(false));
  }, [params.kind, params.txId]);

  useEffect(() => {
    findTx();
    pollRef.current = setInterval(findTx, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [findTx]);

  useEffect(() => {
    const isFinal = payment
      ? ['settled', 'failed', 'expired', 'refunded'].includes(payment.status)
      : tx?.status === 'settled';
    if (isFinal && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [payment?.status, tx?.status]);

  useEffect(() => {
    getFiatCurrency().then(setCurrency).catch(() => {});
    getBalanceFormat().then(setBalanceFormat).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(priceApiUrl(currency))
      .then(r => r.json())
      .then(data => setBtcPrice(parseFloat(data.data.amount)))
      .catch(() => {});
  }, [currency]);

  // Fetch confirmations for on-chain transactions
  useEffect(() => {
    if (!tx || tx.layer !== 'onchain') return;
    const onchainTxid = tx.boardingTxid || tx.commitmentTxid;
    if (!onchainTxid) return;

    const fetchConf = () => getConfirmations(onchainTxid).then(setConfirmCount).catch(() => {});
    fetchConf();
    const id = setInterval(fetchConf, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [tx?.id, tx?.layer]);

  async function copyTxid() {
    const id = payment ? (payment.txid ?? payment.swapId ?? payment.id) : tx ? primaryTxid(tx) : null;
    if (!id) return;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(id); } catch {}
    } else {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(id);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function requestRefund() {
    if (!payment?.refundable || refunding) return;
    setActionError(null);
    setRefunding(true);
    try {
      setPayment(await refundPayment(payment.id));
    } catch (cause) {
      setActionError(friendlyRefundError(cause, payment.provider));
    } finally {
      setRefunding(false);
    }
  }

  const itemFound = params.kind === 'payment' ? payment !== null : tx !== null;
  if (loading || !itemFound) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
          <Text style={s.title}>TRANSACTION</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.center}>
          {loading ? <ActivityIndicator color={colors.primary} /> : <Text style={s.notFound}>TRANSACTION NOT FOUND</Text>}
        </View>
      </SafeAreaView>
    );
  }


  if (payment) {
    const statusConf = paymentStatusConfig(payment.status, colors);
    const paymentData = (payment.providerData ?? {}) as {
      destination?: string;
      fundingTxid?: string;
      arkadeFundingTxid?: string;
      completionTxid?: string;
      invoice?: string;
      providerStatus?: string;
      refundTxid?: string;
      sendAmountSats?: number;
    };
    const total = paymentData.sendAmountSats ?? payment.amountSats + payment.feeSats;
    const providerLabel = payment.provider.charAt(0).toUpperCase() + payment.provider.slice(1);
    const currencySymbol = CURRENCY_SYMBOL[currency];
    const paymentExplorer = resolvePaymentExplorer(payment);
    type PaymentRow = { label: string; value?: string; amountSats?: number };
    const paymentRows: PaymentRow[] = [
      { label: 'Swap ID', value: truncate(payment.swapId ?? payment.id) },
      { label: 'Provider', value: providerLabel },
      { label: 'Direction', value: payment.direction === 'incoming' ? 'Received' : 'Sent' },
      { label: 'Type', value: payment.layer === 'onchain' ? 'On-chain via Arkade' : payment.layer },
      ...(paymentData.destination ? [{ label: 'Destination', value: truncate(paymentData.destination) }] : []),
      ...(paymentData.invoice ? [{ label: 'Lightning invoice', value: truncate(paymentData.invoice) }] : []),
      ...(payment.preimage ? [{ label: 'Preimage', value: truncate(payment.preimage) }] : []),
      { label: 'When', value: fmtRelative(payment.createdAt) },
      { label: 'Date', value: fmtDate(payment.createdAt) },
      { label: payment.direction === 'incoming' ? 'Received by Arkade' : 'Recipient gets', amountSats: payment.amountSats },
      { label: `${providerLabel} + network fees`, amountSats: payment.feeSats },
      { label: payment.direction === 'incoming' ? 'Paid by sender' : 'Total from Arkade', amountSats: total },
      ...(paymentData.fundingTxid ? [{
        label: payment.layer === 'onchain' ? 'Bitcoin funding' : 'Arkade funding',
        value: truncate(paymentData.fundingTxid),
      }] : []),
      ...(paymentData.arkadeFundingTxid && paymentData.arkadeFundingTxid !== paymentData.fundingTxid ? [{
        label: 'Arkade funding',
        value: truncate(paymentData.arkadeFundingTxid),
      }] : []),
      ...(paymentData.completionTxid ? [{
        label: 'Arkade claim',
        value: truncate(paymentData.completionTxid),
      }] : []),
      ...(paymentData.refundTxid ? [{
        label: payment.layer === 'onchain' ? 'Bitcoin refund' : 'Arkade refund',
        value: truncate(paymentData.refundTxid),
      }] : []),
      ...(paymentData.providerStatus ? [{
        label: `${providerLabel} status`,
        value: paymentData.providerStatus,
      }] : []),
      ...(payment.txid && payment.txid !== paymentData.fundingTxid ? [{
        label: 'Bitcoin transaction',
        value: truncate(payment.txid),
      }] : []),
    ];

    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
          <Text style={s.title}>PAYMENT DETAILS</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.body}
          showsVerticalScrollIndicator
        >
          <View style={s.hero}>
            <WalletAmount
              sats={payment.amountSats}
              direction={payment.direction}
              format={balanceFormat}
              btcPrice={btcPrice}
              currencySymbol={currencySymbol}
              iconSize={48}
              iconColor={payment.direction === 'incoming' ? colors.success : colors.primaryDark}
              textStyle={[s.heroAmount, { color: payment.direction === 'incoming' ? colors.success : colors.primaryDark }]}
            />
            <View style={[s.statusPill, { backgroundColor: statusConf.color }]}>
              {payment.status === 'pending' && <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.5 }] }} />}
              <Text style={s.statusPillText}>{statusConf.label.toUpperCase()}</Text>
            </View>
          </View>

          <View style={s.card}>
            {paymentRows.map((row, index) => (
              <View key={row.label} style={[s.row, index < paymentRows.length - 1 && s.rowBorder]}>
                <Text style={s.rowLabel}>{row.label}</Text>
                {row.amountSats !== undefined ? (
                  <WalletAmount
                    sats={row.amountSats}
                    format={balanceFormat}
                    btcPrice={btcPrice}
                    currencySymbol={currencySymbol}
                    iconSize={18}
                    iconColor={colors.primaryDark}
                    textStyle={s.rowValue}
                  />
                ) : <Text style={s.rowValue}>{row.value}</Text>}
              </View>
            ))}
          </View>

          <View style={s.actions}>
            <TouchableOpacity style={s.actionBtn} onPress={copyTxid}>
              <Text style={s.actionBtnText}>{copied ? 'COPIED' : payment.txid ? 'COPY BTC TXID' : 'COPY SWAP ID'}</Text>
            </TouchableOpacity>
            {paymentExplorer && (
              <TouchableOpacity style={s.actionBtn} onPress={() => Linking.openURL(paymentExplorer.url)}>
                <Text style={s.actionBtnText}>{paymentExplorer.direct ? 'OPEN EXPLORER' : 'OPEN ARK EXPLORER'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {payment.refundable && (
            <TouchableOpacity
              style={[s.refundBtn, refunding && s.disabled]}
              onPress={() => confirmRefund ? void requestRefund() : setConfirmRefund(true)}
              disabled={refunding}
            >
              <Text style={s.refundBtnText}>
                {refunding
                  ? 'REFUNDING...'
                  : confirmRefund
                    ? 'CONFIRM REFUND'
                    : payment.layer === 'onchain'
                      ? 'REFUND TO WALLET'
                      : 'REFUND TO ARKADE'}
              </Text>
            </TouchableOpacity>
          )}
          {actionError && <Text style={[s.actionError, { color: colors.danger }]}>{actionError}</Text>}
          {!['settled', 'failed', 'expired', 'refunded'].includes(payment.status) && (
            <View style={s.updateBanner}>
              <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.5 }] }} />
              <Text style={s.updateText}>SWAP STATUS UPDATES AUTOMATICALLY</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!tx) return null;
  const statusConf = statusConfig(tx.status, colors);
  const currencySymbol = CURRENCY_SYMBOL[currency];
  const explorer = resolveTransactionExplorer(tx);
  const url = explorer?.url ?? null;

  type Row = { label: string; value?: string; amountSats?: number; color?: string; action?: () => void; actionLabel?: string };
  const rows: Row[] = [
    {
      label: 'Transaction ID',
      value: truncate(primaryTxid(tx)),
      action: url ? () => Linking.openURL(url) : undefined,
      actionLabel: explorer?.direct ? '>' : undefined,
    },
    { label: 'Direction', value: tx.type === 'incoming' ? 'Received' : 'Sent' },
    { label: 'Type', value: LAYER_LABELS[tx.layer] },
    ...(tx.layer === 'onchain' ? [{
      label: 'Confirmations',
      value: confirmCount === null ? '...' : confirmCount === 0 ? 'Unconfirmed' : `${confirmCount}`,
      color: confirmCount === null ? undefined : confirmCount === 0 ? colors.warning : confirmCount >= 6 ? colors.success : colors.primaryDark,
    }] : []),
    { label: 'When', value: fmtRelative(tx.createdAt) },
    { label: 'Date', value: fmtDate(tx.createdAt) },
    { label: 'Amount', amountSats: tx.amount },
    tx.layer === 'ark' ? { label: 'Network fees', amountSats: 0 } : { label: 'Network fees', value: 'N/A' },
    { label: 'Total', amountSats: tx.amount },
  ];

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.title}>TRANSACTION</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.body}
        showsVerticalScrollIndicator
      >
        {/* Hero */}
        <View style={s.hero}>
          <WalletAmount
            sats={tx.amount}
            direction={tx.type}
            format={balanceFormat}
            btcPrice={btcPrice}
            currencySymbol={currencySymbol}
            iconSize={48}
            iconColor={tx.type === 'incoming' ? colors.success : colors.primaryDark}
            textStyle={[s.heroAmount, { color: tx.type === 'incoming' ? colors.success : colors.primaryDark }]}
          />
          <View style={[s.statusPill, { backgroundColor: statusConf.color }]}>
            {tx.status === 'pending' && <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.5 }] }} />}
            <Text style={s.statusPillText}>{statusConf.label.toUpperCase()}</Text>
          </View>
        </View>

        {/* Detail rows */}
        <View style={s.card}>
          {rows.map((row, i) => (
            <View key={row.label} style={[s.row, i < rows.length - 1 && s.rowBorder]}>
              <Text style={s.rowLabel}>{row.label}</Text>
              <View style={s.rowRight}>
                {row.amountSats !== undefined ? (
                  <WalletAmount
                    sats={row.amountSats}
                    format={balanceFormat}
                    btcPrice={btcPrice}
                    currencySymbol={currencySymbol}
                    iconSize={18}
                    iconColor={row.color ?? colors.primaryDark}
                    textStyle={[s.rowValue, row.color ? { color: row.color } : undefined]}
                  />
                ) : row.action ? (
                  <TouchableOpacity style={s.rowLink} onPress={row.action}>
                    <Text style={[s.rowValue, row.color ? { color: row.color } : undefined]}>{row.value}</Text>
                    {row.actionLabel && <Text style={s.rowActionIcon}>{row.actionLabel}</Text>}
                  </TouchableOpacity>
                ) : (
                  <Text style={[s.rowValue, row.color ? { color: row.color } : undefined]}>{row.value}</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Copy + Explorer buttons */}
        <View style={s.actions}>
          <TouchableOpacity style={s.actionBtn} onPress={copyTxid}>
            <Text style={s.actionBtnText}>{copied ? 'COPIED' : 'COPY ID'}</Text>
          </TouchableOpacity>
          {url && (
            <TouchableOpacity style={s.actionBtn} onPress={() => Linking.openURL(url)}>
              <Text style={s.actionBtnText}>{explorer?.direct ? 'EXPLORER' : 'ARK EXPLORER'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {tx.status !== 'settled' && (
          <View style={s.updateBanner}>
            <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.5 }] }} />
            <Text style={s.updateText}>STATUS UPDATES AUTOMATICALLY</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', ...pixel, backgroundColor: colors.cardBg },
    backIcon: { fontFamily: typography.pixel, fontSize: 18, color: colors.primary },
    title: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 3 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    notFound: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted },
    scroll: { flex: 1 },
    body: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxxl },

    hero: { alignItems: 'center', gap: spacing.xs, paddingBottom: spacing.xxl },
    heroAmount: { fontFamily: typography.numbers, fontSize: 44 },
    heroUnit: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 3 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 2 },
    statusPillText: { fontFamily: typography.pixel, fontSize: 12, color: '#ffffff', letterSpacing: 1 },

    card: { ...pixel, backgroundColor: colors.cardBg },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 44 },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.dotted },
    rowLabel: { fontFamily: typography.numbers, fontSize: 14, color: colors.muted },
    rowRight: { flex: 1, alignItems: 'flex-end' },
    rowValue: { fontFamily: typography.numbers, fontSize: 14, color: colors.primaryDark, textAlign: 'right', flexShrink: 1 },
    rowLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    rowActionIcon: { fontFamily: typography.numbers, fontSize: 14, color: colors.primary },

    actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl, justifyContent: 'center' },
    actionBtn: { ...pixel, backgroundColor: colors.primary, borderColor: colors.primaryDark, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
    actionBtnText: { fontFamily: typography.pixel, fontSize: 12, color: colors.onPrimary, letterSpacing: 1 },

    updateBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl },
    updateText: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 1 },
    refundBtn: { ...pixel, marginTop: spacing.lg, alignSelf: 'center', backgroundColor: '#d4a017', borderColor: '#8f6d0a', paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
    refundBtnText: { fontFamily: typography.pixel, fontSize: 12, color: '#ffffff', letterSpacing: 1 },
    refundNotice: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, fontFamily: typography.pixel, fontSize: 12, lineHeight: 13, color: '#8f6d0a', textAlign: 'center' },
    actionError: { marginTop: spacing.md, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: '#e06060', textAlign: 'center' },
    disabled: { opacity: 0.4 },
  });
}
