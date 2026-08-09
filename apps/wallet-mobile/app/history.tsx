import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getCachedTransactionHistory,
  getPaymentHistory,
  getTransactionHistory,
  refreshPaymentHistory,
  refreshTransactionHistory,
  syncVtxosIfReady,
} from '@alice-wallet/wallet-core';
import type { TransactionStatus } from '@alice-wallet/wallet-core';
import type { PaymentRecord, PaymentStatus, Transaction } from '@alice-wallet/wallet-core';
import { buildHistoryEntries, type HistoryEntry } from '@alice-wallet/wallet-core';
import { getBalanceFormat, type BalanceFormat } from '@alice-wallet/alice-ui';
import { CURRENCY_SYMBOL, getFiatCurrency, priceApiUrl, type FiatCurrency } from '@alice-wallet/alice-ui';
import { WalletAmount } from '@alice-wallet/alice-ui';

const STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: 'PENDING',
  preconfirmed: 'PRECONFIRMED',
  settled: 'SETTLED',
  failed: 'FAILED',
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  created: 'CREATED',
  quoted: 'QUOTED',
  pending: 'PENDING',
  settled: 'SETTLED',
  failed: 'FAILED',
  expired: 'EXPIRED',
  refundable: 'REFUNDABLE',
  refunded: 'REFUNDED',
};

function statusColor(status: TransactionStatus, colors: Colors): string {
  switch (status) {
    case 'settled': return '#2ea043';
    case 'preconfirmed': return colors.primary;
    case 'pending': return '#d4a017';
    case 'failed': return '#e06060';
  }
}

function paymentStatusColor(status: PaymentStatus, colors: Colors): string {
  if (status === 'settled') return '#2ea043';
  if (status === 'refundable') return '#d4a017';
  if (status === 'failed' || status === 'expired') return '#e06060';
  if (status === 'refunded') return colors.primary;
  return '#d4a017';
}

function entryDescription(entry: HistoryEntry): string {
  const layer = entry.kind === 'transaction' ? entry.transaction.layer : entry.payment.layer;
  if (layer === 'lightning') return 'Lightning payment';
  if (layer === 'onchain') return 'On-chain transaction';
  return 'Arkade transaction';
}

const POLL_INTERVAL = 10_000;
const HISTORY_PAGE_SIZE = 25;

export default function HistoryScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const transactionsRef = useRef<Transaction[] | null>(getCachedTransactionHistory());
  const paymentsRef = useRef<PaymentRecord[] | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>(() => buildHistoryEntries(
    transactionsRef.current ?? [],
    [],
  ));
  const [loading, setLoading] = useState(transactionsRef.current === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balanceFormat, setBalanceFormat] = useState<BalanceFormat>('symbol');
  const [currency, setCurrency] = useState<FiatCurrency>('USD');
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshInFlightRef = useRef(false);

  const publishEntries = useCallback(() => {
    setEntries(buildHistoryEntries(
      transactionsRef.current ?? [],
      paymentsRef.current ?? [],
    ));
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (!silent) {
      setLoading(transactionsRef.current === null && paymentsRef.current === null);
      setError(null);
    }

    try {
      if (!silent) {
        const snapshotResults = await Promise.allSettled([
          getTransactionHistory().then(transactions => {
            transactionsRef.current = transactions;
            publishEntries();
          }),
          getPaymentHistory().then(payments => {
            paymentsRef.current = payments;
            publishEntries();
          }),
        ]);
        setLoading(false);

        if (
          snapshotResults.every(result => result.status === 'rejected')
          && transactionsRef.current === null
          && paymentsRef.current === null
        ) {
          const cause = snapshotResults[0]?.status === 'rejected'
            ? snapshotResults[0].reason
            : null;
          setError(cause instanceof Error ? cause.message : 'Unable to load history.');
        }
      }

      setRefreshing(true);
      await Promise.allSettled([
        syncVtxosIfReady()
          .catch(() => null)
          .then(() => refreshTransactionHistory())
          .then(transactions => {
            transactionsRef.current = transactions;
            publishEntries();
          }),
        refreshPaymentHistory().then(payments => {
          paymentsRef.current = payments;
          publishEntries();
        }),
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      refreshInFlightRef.current = false;
    }
  }, [publishEntries]);

  useFocusEffect(useCallback(() => {
    setVisibleCount(HISTORY_PAGE_SIZE);
    getBalanceFormat().then(setBalanceFormat).catch(() => {});
    getFiatCurrency().then(setCurrency).catch(() => {});
    refresh();
    pollRef.current = setInterval(() => refresh(true), POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]));

  useEffect(() => {
    fetch(priceApiUrl(currency))
      .then(response => response.json())
      .then(data => setBtcPrice(parseFloat(data.data.amount)))
      .catch(() => setBtcPrice(null));
  }, [currency]);

  const hasPending = entries.some(entry => entry.kind === 'transaction'
    ? entry.transaction.status !== 'settled'
    : !['settled', 'failed', 'expired', 'refunded'].includes(entry.payment.status));
  const visibleEntries = entries.slice(0, visibleCount);
  const hasMore = visibleEntries.length < entries.length;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.title}>HISTORY</Text>
        <View style={{ width: 36 }} />
      </View>
      {hasPending && (
        <View style={s.pollingBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={s.pollingText}>WATCHING FOR UPDATES...</Text>
        </View>
      )}
      <FlatList
        data={visibleEntries}
        keyExtractor={entry => `${entry.kind}:${entry.id}`}
        contentContainerStyle={s.list}
        initialNumToRender={HISTORY_PAGE_SIZE}
        onEndReached={() => {
          if (hasMore) setVisibleCount(count => Math.min(count + HISTORY_PAGE_SIZE, entries.length));
        }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          <>
            {entries.length > HISTORY_PAGE_SIZE && (
              <Text style={s.pageCount}>{visibleEntries.length} OF {entries.length}</Text>
            )}
            {refreshing && entries.length > 0 && (
              <View style={s.loadingMore}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={s.loadingMoreText}>LOADING RECENT ACTIVITY...</Text>
              </View>
            )}
          </>
        }
        ListEmptyComponent={loading
          ? <ActivityIndicator color={colors.primary} style={s.empty} />
          : <Text style={[s.emptyText, error && s.error]}>{error ?? 'NO TRANSACTIONS YET'}</Text>}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        renderItem={({ item }) => {
          const direction = item.kind === 'transaction' ? item.transaction.type : item.payment.direction;
          const amount = item.kind === 'transaction' ? item.transaction.amount : item.payment.amountSats;
          const isPending = item.kind === 'transaction'
            ? item.transaction.status === 'pending'
            : item.payment.status === 'pending';
          const color = item.kind === 'transaction'
            ? statusColor(item.transaction.status, colors)
            : paymentStatusColor(item.payment.status, colors);
          const statusLabel = item.kind === 'transaction'
            ? STATUS_LABELS[item.transaction.status]
            : PAYMENT_STATUS_LABELS[item.payment.status];
          return (
          <TouchableOpacity style={s.row} onPress={() => router.push({ pathname: '/transaction', params: { txId: item.id, kind: item.kind } })}>
            <Text style={s.arrow}>{direction === 'incoming' ? '↓' : '↑'}</Text>
            <View style={s.details}>
              <Text style={s.addr}>{entryDescription(item)}</Text>
              <Text style={s.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            <View style={s.rightCol}>
              <WalletAmount
                sats={amount}
                direction={direction}
                format={balanceFormat}
                btcPrice={btcPrice}
                currencySymbol={CURRENCY_SYMBOL[currency]}
                iconSize={18}
                iconColor={direction === 'incoming' ? colors.primaryDark : colors.muted}
                textStyle={direction === 'incoming' ? s.amtIn : s.amtOut}
              />
              <View style={[s.statusBadge, { borderColor: color }]}> 
                {isPending && <ActivityIndicator size={8} color={color} />}
                <Text style={[s.statusText, { color }]}> 
                  {statusLabel}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
          );
        }}
      />
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
    pollingBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.backgroundSoft },
    pollingText: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1 },
    list: { paddingHorizontal: spacing.lg },
    empty: { marginTop: spacing.xxxl },
    emptyText: { marginTop: spacing.xxxl, textAlign: 'center', fontFamily: typography.pixel, fontSize: 8, color: colors.muted },
    error: { color: '#e06060', fontFamily: typography.numbers, fontSize: 14 },
    pageCount: { paddingVertical: spacing.lg, textAlign: 'center', fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1 },
    loadingMore: { paddingVertical: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
    loadingMoreText: { fontFamily: typography.pixel, fontSize: 6, color: colors.muted, letterSpacing: 1 },
    sep: { height: 1, borderBottomWidth: 1, borderBottomColor: colors.dotted },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.md },
    arrow: { fontFamily: typography.pixel, fontSize: 16, color: colors.primary, width: 24, textAlign: 'center' },
    details: { flex: 1, gap: 3 },
    addr: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark },
    date: { fontFamily: typography.pixel, fontSize: 10, color: colors.muted },
    rightCol: { alignItems: 'flex-end', gap: 4 },
    amtIn: { fontFamily: typography.numbers, fontSize: 16, color: colors.primaryDark },
    amtOut: { fontFamily: typography.numbers, fontSize: 16, color: colors.muted },
    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderRadius: 2 },
    statusText: { fontFamily: typography.pixel, fontSize: 5, letterSpacing: 1 },
  });
}
