import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  getVtxoAutomationStatus,
  getVtxos,
  recoverVtxos,
  renewVtxos,
  retryExcludedVtxo,
  setVtxoFrozen,
  syncVtxos,
  type VtxoAutomationStatus,
  type VtxoInfo,
} from '@alice-wallet/wallet-core';

type Filter = 'all' | 'attention';
type ConfirmedAction = 'renew' | 'recover';

function fmt(value: number) {
  return value.toLocaleString('en-US').replace(/,/g, ' ');
}

function shortId(id: string) {
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function expiryLabel(expiry?: number) {
  if (!expiry) return 'NO EXPIRY DATA';
  const remaining = expiry - Date.now();
  if (remaining <= 0) return 'EXPIRED';
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours < 48) return `${hours}H REMAINING`;
  return `${Math.ceil(hours / 24)}D REMAINING`;
}

function lifecycleLabel(item: VtxoInfo) {
  if (item.unrolled) return 'UNROLLED';
  if (!item.spendable) return 'SPENT';
  if (item.excluded) return 'EXCLUDED';
  if (item.frozen) return 'FROZEN';
  if (item.recoverable) return 'RECOVERABLE';
  if (item.expired) return 'EXPIRED';
  if (item.needsRenewal) return 'RENEW SOON';
  return item.state.toUpperCase();
}

export default function CoinControlScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [vtxos, setVtxos] = useState<VtxoInfo[]>([]);
  const [automation, setAutomation] = useState<VtxoAutomationStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConfirmedAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextVtxos, nextAutomation] = await Promise.all([
        getVtxos(),
        getVtxoAutomationStatus(),
      ]);
      setVtxos(nextVtxos);
      setAutomation(nextAutomation);
      setSelected(current => new Set([...current].filter(id =>
        nextVtxos.some(item => item.id === id && (item.spendable || item.unrolled))
      )));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load VTXOs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const active = vtxos.filter(item => item.spendable || item.unrolled);
  const attention = active.filter(item =>
    item.needsRenewal || item.recoverable || item.expired || item.excluded || item.frozen
  );
  const visible = filter === 'attention'
    ? attention
    : vtxos;
  const selectedVtxos = active.filter(item => selected.has(item.id));
  const selectedAmount = selectedVtxos.reduce((sum, item) => sum + item.value, 0);
  const total = active.reduce((sum, item) => sum + item.value, 0);
  const frozenTotal = active
    .filter(item => item.frozen)
    .reduce((sum, item) => sum + item.value, 0);
  const canRenew = selectedVtxos.length > 0
    && selectedVtxos.every(item => item.needsRenewal && !item.excluded);
  const canRecover = selectedVtxos.length > 0
    && selectedVtxos.every(item =>
      item.spendable && (item.recoverable || item.expired) && !item.excluded
    );
  const canEmergencyExit = selectedVtxos.length > 0
    && selectedVtxos.every(item => item.spendable || item.unrolled);
  const canFreeze = selectedVtxos.length > 0
    && selectedVtxos.every(item => item.spendable && !item.frozen);
  const canUnfreeze = selectedVtxos.length > 0
    && selectedVtxos.every(item => item.frozen);

  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSuccess(null);
    setError(null);
  }

  async function runSync(ids?: string[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await syncVtxos(ids);
      setSuccess(
        result.removedExclusions.length > 0
          ? `SYNCED. ${result.removedExclusions.length} RESOLVED EXCLUSION${result.removedExclusions.length === 1 ? '' : 'S'} REMOVED.`
          : 'VTXO STATE SYNCHRONIZED.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to synchronize VTXOs.');
    } finally {
      setBusy(false);
    }
  }

  async function runOperation(action: ConfirmedAction) {
    if (busy) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const ids = selectedVtxos.map(item => item.id);
      const result = action === 'renew'
        ? await renewVtxos(ids)
        : await recoverVtxos(ids);
      setSelected(new Set());
      setSuccess(
        `${action === 'renew' ? 'RENEWED' : 'RECOVERED'} ${fmt(result.amountSats)} SATS FROM ${result.inputIds.length} VTXO${result.inputIds.length === 1 ? '' : 'S'}.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${action} VTXOs.`);
    } finally {
      setBusy(false);
    }
  }

  async function retryInput(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await retryExcludedVtxo(id);
      setSuccess('INPUT SYNCHRONIZED AND RETURNED TO ELIGIBILITY CHECKS.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to recheck this input.');
    } finally {
      setBusy(false);
    }
  }

  async function changeFreeze(frozen: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await Promise.all(selectedVtxos.map(item => setVtxoFrozen(item.id, frozen)));
      setSelected(new Set());
      setSuccess(
        frozen
          ? 'SELECTED VTXOS FROZEN LOCALLY. ALICE WILL NOT USE THEM FOR PAYMENTS.'
          : 'SELECTED VTXOS UNFROZEN.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update frozen VTXOs.');
    } finally {
      setBusy(false);
    }
  }

  function openEmergencyExit() {
    router.push({
      pathname: '/emergency-exit',
      params: { ids: selectedVtxos.map(item => item.id).join(',') },
    });
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="arrow-back" size={19} color={colors.primary} />
        </TouchableOpacity>
        <Text style={s.title}>COIN CONTROL</Text>
        <TouchableOpacity
          onPress={() => void runSync()}
          style={s.iconBtn}
          disabled={busy}
          accessibilityLabel="Synchronize VTXOs"
        >
          {busy
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="sync" size={19} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      <View style={s.summary}>
        <Text style={s.summaryLabel}>TOTAL VTXO BALANCE</Text>
        <Text style={s.summaryAmount}>{fmt(total)} SATS</Text>
        <Text style={s.summaryMeta}>
          {active.length} ACTIVE · {fmt(frozenTotal)} FROZEN · {attention.length} NEED ATTENTION
        </Text>
      </View>

      {automation && (
        <View style={s.statusBand}>
          <View style={s.statusTop}>
            <Text style={s.statusTitle}>AUTOMATIC RENEWAL</Text>
            <Text style={[s.statusValue, automation.renewalEnabled && [s.good, { color: colors.success }]]}>
              {automation.renewalEnabled ? 'ON' : 'OFF'}
            </Text>
          </View>
          <Text style={s.statusCopy}>
            3-DAY RENEWAL THRESHOLD · {automation.backgroundSyncEnabled
              ? 'BACKGROUND STATE SYNC'
              : 'FOREGROUND STATE SYNC'}
          </Text>
          <Text style={s.statusDetail}>{automation.backgroundSyncDetail}</Text>
        </View>
      )}

      <View style={s.freezeNotice}>
        <Ionicons name="snow-outline" size={17} color={colors.primary} />
        <Text style={s.freezeNoticeText}>
          FROZEN VTXOS STAY IN YOUR TOTAL BALANCE BUT CANNOT FUND PAYMENTS. RENEWING A FROZEN VTXO REPLACES IT AND CLEARS THE FREEZE.
        </Text>
      </View>

      <View style={s.filters}>
        {([
          ['all', `ALL ${vtxos.length}`],
          ['attention', `ATTENTION ${attention.length}`],
        ] as Array<[Filter, string]>).map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[s.filterBtn, filter === value && s.filterActive]}
            onPress={() => setFilter(value)}
          >
            <Text style={[s.filterText, filter === value && s.filterTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {success && <Text style={[s.success, { color: colors.success }]}>{success}</Text>}
      {error && <Text style={[s.error, { color: colors.danger }]}>{error}</Text>}

      <FlatList
        data={visible}
        keyExtractor={item => item.id}
        contentContainerStyle={[s.list, selectedVtxos.length > 0 && s.listSelected]}
        ListEmptyComponent={loading
          ? <ActivityIndicator color={colors.primary} style={s.empty} />
          : <Text style={s.emptyText}>NO VTXOS IN THIS VIEW</Text>}
        renderItem={({ item }) => {
          const selectable = item.spendable || item.unrolled;
          const checked = selected.has(item.id);
          const danger = item.expired || item.recoverable || item.excluded;
          return (
            <TouchableOpacity
              style={[s.row, checked && s.rowSelected]}
              onPress={() => selectable && toggle(item.id)}
              disabled={!selectable}
              activeOpacity={0.75}
            >
              <View style={s.check}>
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={21}
                  color={selectable ? colors.primary : colors.muted}
                />
              </View>
              <View style={s.rowBody}>
                <View style={s.rowTop}>
                  <Text style={s.amount}>{fmt(item.value)} SATS</Text>
                  <Text style={[s.state, danger && [s.danger, { color: colors.danger }]]}>{lifecycleLabel(item)}</Text>
                </View>
                <Text style={s.id}>{shortId(item.id)}</Text>
                <Text style={[s.expiry, (item.needsRenewal || item.expired) && [s.danger, { color: colors.danger }]]}>
                  {expiryLabel(item.batchExpiry)}
                </Text>
                {item.frozen && (
                  <Text style={s.frozenCopy}>LOCAL FREEZE · EXCLUDED FROM PAYMENTS</Text>
                )}
                {item.excluded && (
                  <View style={s.exclusion}>
                    <Text style={[s.exclusionReason, { color: colors.danger }]}>{item.exclusionReason}</Text>
                    <TouchableOpacity onPress={() => void retryInput(item.id)} disabled={busy}>
                      <Text style={s.retryInput}>SYNC & RETRY INPUT</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {selectedVtxos.length > 0 && (
        <View style={s.actionBar}>
          <View style={s.selectionSummary}>
            <Text style={s.selectionTitle}>{selectedVtxos.length} SELECTED</Text>
            <Text style={s.selectionAmount}>{fmt(selectedAmount)} SATS</Text>
          </View>
          <View style={s.actionRow}>
            <TouchableOpacity
              style={s.smallAction}
              onPress={() => void runSync(selectedVtxos.map(item => item.id))}
              disabled={busy}
            >
              <Ionicons name="sync" size={17} color={colors.primaryDark} />
              <Text style={s.smallActionText}>SYNC</Text>
            </TouchableOpacity>
            {canRenew && (
              <TouchableOpacity style={s.smallAction} onPress={() => setConfirming('renew')}>
                <Ionicons name="refresh" size={17} color={colors.primaryDark} />
                <Text style={s.smallActionText}>RENEW</Text>
              </TouchableOpacity>
            )}
            {canRecover && (
              <TouchableOpacity style={s.smallAction} onPress={() => setConfirming('recover')}>
                <Ionicons name="return-down-back" size={17} color={colors.primaryDark} />
                <Text style={s.smallActionText}>RECOVER</Text>
              </TouchableOpacity>
            )}
            {canEmergencyExit && (
              <TouchableOpacity style={[s.emergencyAction, { backgroundColor: colors.danger, borderColor: colors.dangerInk }]} onPress={openEmergencyExit}>
                <Ionicons name="exit-outline" size={17} color="#ffffff" />
                <Text style={s.emergencyActionText}>EXIT</Text>
              </TouchableOpacity>
            )}
            {canFreeze && (
              <TouchableOpacity style={s.smallAction} onPress={() => void changeFreeze(true)}>
                <Ionicons name="snow-outline" size={17} color={colors.primaryDark} />
                <Text style={s.smallActionText}>FREEZE</Text>
              </TouchableOpacity>
            )}
            {canUnfreeze && (
              <TouchableOpacity style={s.smallAction} onPress={() => void changeFreeze(false)}>
                <Ionicons name="sunny-outline" size={17} color={colors.primaryDark} />
                <Text style={s.smallActionText}>UNFREEZE</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <Modal
        visible={confirming !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirming(null)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              {confirming === 'recover' ? 'RECOVER VTXOS?' : 'RENEW VTXOS?'}
            </Text>
            <Text style={s.modalAmount}>{fmt(selectedAmount)} SATS</Text>
            <Text style={s.modalDescription}>
              {selectedVtxos.length} explicitly selected input{selectedVtxos.length === 1 ? '' : 's'} will be settled into a fresh Arkade output. Fees may apply.
            </Text>
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirming(null)}>
                <Text style={s.cancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.confirmBtn}
                onPress={() => confirming && void runOperation(confirming)}
              >
                <Text style={s.confirmText}>CONFIRM</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    iconBtn: { ...pixel, width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg },
    title: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 2 },
    summary: { alignItems: 'center', paddingVertical: spacing.lg },
    summaryLabel: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 1 },
    summaryAmount: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 27, color: colors.primaryDark },
    summaryMeta: { marginTop: spacing.xs, fontFamily: typography.numbers, fontSize: 14, color: colors.muted },
    statusBand: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.dotted, backgroundColor: colors.cardBg },
    statusTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    statusTitle: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark },
    statusValue: { fontFamily: typography.pixel, fontSize: 12, color: '#c84f4f' },
    good: { color: '#2ea043' },
    statusCopy: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.muted },
    statusDetail: { marginTop: spacing.xs, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.muted },
    freezeNotice: { marginHorizontal: spacing.lg, marginTop: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    freezeNoticeText: { flex: 1, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.muted },
    filters: { flexDirection: 'row', marginHorizontal: spacing.lg, marginVertical: spacing.md, borderWidth: 2, borderColor: colors.border },
    filterBtn: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, backgroundColor: colors.cardBg },
    filterActive: { backgroundColor: colors.primary },
    filterText: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, textAlign: 'center' },
    filterTextActive: { color: colors.onPrimary },
    success: { marginHorizontal: spacing.lg, marginBottom: spacing.md, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: '#2ea043', textAlign: 'center' },
    error: { marginHorizontal: spacing.lg, marginBottom: spacing.md, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: '#c84f4f', textAlign: 'center' },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
    listSelected: { paddingBottom: 150 },
    empty: { marginTop: spacing.xxxl },
    emptyText: { marginTop: spacing.xxxl, fontFamily: typography.pixel, fontSize: 12, color: colors.muted, textAlign: 'center' },
    row: { ...pixel, minHeight: 112, marginBottom: spacing.md, padding: spacing.md, flexDirection: 'row', backgroundColor: colors.cardBg },
    rowSelected: { borderColor: colors.primary, backgroundColor: colors.cardBg },
    check: { width: 34, paddingTop: 1 },
    rowBody: { flex: 1, minWidth: 0 },
    rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    amount: { flexShrink: 1, fontFamily: typography.numbers, fontSize: 17, color: colors.primaryDark },
    state: { fontFamily: typography.pixel, fontSize: 12, color: '#2ea043', textAlign: 'right' },
    id: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 13, color: colors.muted },
    expiry: { marginTop: spacing.sm, fontFamily: typography.pixel, fontSize: 12, color: colors.muted },
    danger: { color: '#c84f4f' },
    frozenCopy: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.primary },
    exclusion: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.dotted, gap: spacing.sm },
    exclusionReason: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 16, color: '#c84f4f' },
    retryInput: { fontFamily: typography.pixel, fontSize: 12, color: colors.primary },
    actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, borderTopWidth: 2, borderTopColor: colors.border, backgroundColor: colors.background },
    selectionSummary: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
    selectionTitle: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark },
    selectionAmount: { fontFamily: typography.numbers, fontSize: 15, color: colors.primaryDark },
    actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    smallAction: { ...pixel, flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: spacing.xs, backgroundColor: colors.cardBg },
    smallActionText: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark },
    emergencyAction: { ...pixel, flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: spacing.xs, backgroundColor: '#c84f4f', borderColor: '#8f3030' },
    emergencyActionText: { fontFamily: typography.pixel, fontSize: 12, color: '#ffffff' },
    modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(48, 74, 112, 0.48)' },
    modalCard: { ...pixel, width: '100%', maxWidth: 420, padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.background },
    modalTitle: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 1, textAlign: 'center' },
    modalAmount: { fontFamily: typography.numbers, fontSize: 28, color: colors.primaryDark, textAlign: 'center' },
    modalDescription: { fontFamily: typography.numbers, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center' },
    modalActions: { flexDirection: 'row', gap: spacing.md },
    cancelBtn: { ...pixel, flex: 1, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.cardBg },
    cancelText: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark },
    confirmBtn: { ...pixel, flex: 1, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.primaryDark },
    confirmText: { fontFamily: typography.pixel, fontSize: 12, color: colors.onPrimary },
  });
}
