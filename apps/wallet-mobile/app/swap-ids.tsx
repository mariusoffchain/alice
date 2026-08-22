import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  getSwapHistory,
  refreshSwapHistory,
  type PaymentRecord,
  type PaymentStatus,
} from '@alice-wallet/wallet-core';

type Filter = 'all' | 'confirmed' | 'pending' | 'expired';

const FILTERS: Array<[Filter, string]> = [
  ['all', 'ALL'],
  ['confirmed', 'CONFIRMED'],
  ['pending', 'PENDING'],
  ['expired', 'EXPIRED'],
];

function filterForStatus(status: PaymentStatus): Exclude<Filter, 'all'> {
  if (status === 'settled' || status === 'refunded') return 'confirmed';
  if (status === 'expired' || status === 'failed') return 'expired';
  return 'pending';
}

function statusLabel(status: PaymentStatus): string {
  if (status === 'settled') return 'CONFIRMED';
  if (status === 'refundable') return 'REFUND AVAILABLE';
  return status.toUpperCase();
}

function statusColor(status: PaymentStatus, colors: Colors): string {
  if (status === 'settled' || status === 'refunded') return colors.success;
  if (status === 'expired' || status === 'failed') return colors.danger;
  if (status === 'refundable') return colors.warning;
  return colors.primary;
}

function shortId(value: string): string {
  return value.length > 24
    ? `${value.slice(0, 12)}...${value.slice(-8)}`
    : value;
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString();
}

type Metadata = {
  destination?: string;
  invoice?: string;
  fundingAddress?: string;
  fundingTxid?: string;
  arkadeFundingTxid?: string;
  completionTxid?: string;
  refundTxid?: string;
  providerStatus?: string;
  sendAmountSats?: number;
};

export default function SwapIdsScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const next = refresh ? await refreshSwapHistory() : await getSwapHistory();
      setRecords(next.sort((a, b) => b.createdAt - a.createdAt));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load swap records.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load(false);
  }, [load]));

  const counts = useMemo(() => {
    const result = { all: records.length, confirmed: 0, pending: 0, expired: 0 };
    records.forEach(record => { result[filterForStatus(record.status)] += 1; });
    return result;
  }, [records]);

  const visible = useMemo(
    () => filter === 'all'
      ? records
      : records.filter(record => filterForStatus(record.status) === filter),
    [filter, records],
  );

  async function copySwapId(record: PaymentRecord) {
    const id = record.swapId ?? record.id;
    if (Platform.OS === 'web') await navigator.clipboard.writeText(id);
    else await (await import('expo-clipboard')).setStringAsync(id);
    setCopied(record.id);
    setTimeout(() => setCopied(current => current === record.id ? null : current), 2_000);
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>SWAP IDs</Text>
        <TouchableOpacity onPress={() => void load(true)} style={s.backBtn} disabled={refreshing}>
          {refreshing
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="refresh" size={18} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      <Text style={s.notice}>
        LOCAL SWAP RECORDS FOR PAYMENT RECOVERY AND AUDITING. NO RECOVERY PHRASE OR PRIVATE KEY IS SHOWN.
      </Text>

      <View style={s.filters}>
        {FILTERS.map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[s.filterBtn, filter === value && s.filterActive]}
            onPress={() => setFilter(value)}
          >
            <Text style={[s.filterText, filter === value && s.filterTextActive]}>
              {label} {counts[value]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && <Text style={[s.error, { color: colors.danger }]}>{error}</Text>}

      <FlatList
        data={visible}
        keyExtractor={item => `${item.provider}:${item.id}`}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />
        }
        ListEmptyComponent={loading
          ? <ActivityIndicator color={colors.primary} style={s.empty} />
          : <Text style={s.emptyText}>NO SWAPS IN THIS VIEW</Text>}
        renderItem={({ item }) => {
          const id = item.swapId ?? item.id;
          const open = expanded === item.id;
          const metadata = (item.providerData ?? {}) as Metadata;
          const details = [
            ['SWAP ID', id],
            ['PROVIDER STATUS', metadata.providerStatus],
            ['CREATED', formatDate(item.createdAt)],
            ['EXPIRES', item.expiresAt ? formatDate(item.expiresAt) : undefined],
            ['DIRECTION', item.direction.toUpperCase()],
            ['LAYER', item.layer.toUpperCase()],
            ['AMOUNT', `${item.amountSats.toLocaleString('en-US')} SATS`],
            ['FEES', `${item.feeSats.toLocaleString('en-US')} SATS`],
            ['DESTINATION', metadata.destination],
            ['INVOICE', metadata.invoice],
            ['FUNDING ADDRESS', metadata.fundingAddress],
            ['FUNDING TXID', metadata.fundingTxid],
            ['ARKADE FUNDING TXID', metadata.arkadeFundingTxid],
            ['COMPLETION TXID', metadata.completionTxid],
            ['REFUND TXID', metadata.refundTxid],
          ].filter((row): row is [string, string] => Boolean(row[1]));
          const color = statusColor(item.status, colors);

          return (
            <View style={s.card}>
              <TouchableOpacity
                style={s.row}
                onPress={() => setExpanded(open ? null : item.id)}
                activeOpacity={0.75}
              >
                <View style={s.rowBody}>
                  <View style={s.rowTop}>
                    <Text style={s.provider}>{item.provider.toUpperCase()} · {item.layer.toUpperCase()}</Text>
                    <View style={[s.badge, { borderColor: color }]}>
                      <Text style={[s.badgeText, { color }]}>{statusLabel(item.status)}</Text>
                    </View>
                  </View>
                  <Text style={s.id}>{shortId(id)}</Text>
                  <Text style={s.date}>{formatDate(item.createdAt)}</Text>
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
              </TouchableOpacity>

              {open && (
                <View style={s.details}>
                  {details.map(([label, value]) => (
                    <View key={label} style={s.detailRow}>
                      <Text style={s.detailLabel}>{label}</Text>
                      <Text selectable style={s.detailValue}>{value}</Text>
                    </View>
                  ))}
                  <TouchableOpacity style={s.copyBtn} onPress={() => void copySwapId(item)}>
                    <Ionicons name="copy-outline" size={16} color={colors.onPrimary} />
                    <Text style={s.copyText}>{copied === item.id ? 'COPIED' : 'COPY SWAP ID'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
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
    backBtn: { ...pixel, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg },
    backIcon: { fontFamily: typography.pixel, fontSize: 18, color: colors.primary },
    title: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 3 },
    notice: { marginHorizontal: spacing.xl, marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg },
    filterBtn: { ...pixel, minHeight: 38, flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, backgroundColor: colors.cardBg },
    filterActive: { backgroundColor: colors.primary },
    filterText: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted },
    filterTextActive: { color: colors.onPrimary },
    error: { marginHorizontal: spacing.lg, marginBottom: spacing.md, fontFamily: typography.numbers, fontSize: 14, color: '#e06060' },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
    empty: { marginTop: spacing.xxxl },
    emptyText: { marginTop: spacing.xxxl, textAlign: 'center', fontFamily: typography.pixel, fontSize: 12, color: colors.muted },
    card: { ...pixel, marginBottom: spacing.md, backgroundColor: colors.cardBg },
    row: { minHeight: 92, flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md },
    rowBody: { flex: 1 },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    provider: { flexShrink: 1, fontFamily: typography.numbers, fontSize: 15, lineHeight: 19, color: colors.primaryDark },
    badge: { borderWidth: 1, borderRadius: 2, paddingHorizontal: spacing.xs, paddingVertical: 3, alignItems: 'center', justifyContent: 'center' },
    badgeText: { fontFamily: typography.pixel, fontSize: 9, lineHeight: 12, letterSpacing: 1, includeFontPadding: false, textAlignVertical: 'center' },
    id: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 15, color: colors.primaryDark },
    date: { marginTop: spacing.xs, fontFamily: typography.numbers, fontSize: 13, color: colors.muted },
    details: { borderTopWidth: 1, borderTopColor: colors.dotted, padding: spacing.md },
    detailRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.dotted },
    detailLabel: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted },
    detailValue: { marginTop: spacing.xs, fontFamily: typography.numbers, fontSize: 14, lineHeight: 19, color: colors.primaryDark },
    copyBtn: { ...pixel, marginTop: spacing.lg, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderColor: colors.primaryDark },
    copyText: { fontFamily: typography.pixel, fontSize: 12, color: colors.onPrimary },
  });
}
