import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  advanceEmergencyExit,
  clearEmergencyExit,
  getEmergencyExitState,
  prepareEmergencyExit,
  type EmergencyExitState,
} from '@alice-wallet/wallet-core';

function fmt(value: number) {
  return value.toLocaleString('en-US').replace(/,/g, ' ');
}

function shortId(id?: string) {
  if (!id) return '';
  return id.length > 22 ? `${id.slice(0, 12)}...${id.slice(-8)}` : id;
}

function stageLabel(stage: EmergencyExitState['stage']) {
  switch (stage) {
    case 'idle': return 'NOT PREPARED';
    case 'ready': return 'READY';
    case 'needs-fee-funding': return 'FUND FEES';
    case 'unrolling': return 'UNROLLING';
    case 'waiting-confirmation': return 'WAITING FOR CONFIRMATION';
    case 'waiting-timelock': return 'WAITING FOR TIMELOCK';
    case 'completing': return 'COMPLETING EXIT';
    case 'completed': return 'COMPLETED';
    case 'failed': return 'ACTION REQUIRED';
  }
}

export default function EmergencyExitScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ids?: string }>();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const selectedIds = useMemo(
    () => (typeof params.ids === 'string' ? params.ids.split(',').filter(Boolean) : []),
    [params.ids],
  );
  const [state, setState] = useState<EmergencyExitState | null>(null);
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getEmergencyExitState();
      setState(next);
      if (next.stage !== 'idle') setDestination(next.destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load emergency exit state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function prepare() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setState(await prepareEmergencyExit(selectedIds, destination.trim()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare the emergency exit.');
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await advanceEmergencyExit();
      setState(next);
      if (next.error) setError(next.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to advance the emergency exit.');
    } finally {
      setBusy(false);
    }
  }

  async function clearDraft() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await clearEmergencyExit();
      setDestination('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to clear the exit draft.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1600);
  }

  const prepared = state && state.stage !== 'idle';
  const completedCount = state?.completedVtxoIds.length ?? 0;
  const canClear = state?.stage === 'ready'
    || state?.stage === 'needs-fee-funding'
    || state?.stage === 'completed';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="arrow-back" size={19} color={colors.primary} />
        </TouchableOpacity>
        <Text style={s.title}>EMERGENCY EXIT</Text>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={[s.warningBand, { borderColor: colors.danger }]}>
          <Ionicons name="warning-outline" size={22} color={colors.danger} />
          <View style={s.warningBody}>
            <Text style={[s.warningTitle, { color: colors.danger }]}>UNILATERAL ON-CHAIN EXIT</Text>
            <Text style={[s.warningCopy, { color: colors.dangerInk }]}>
              This bypasses the Arkade server. It requires on-chain fee funds, confirmations and the VTXO timelock. Broadcast steps cannot be undone.
            </Text>
          </View>
        </View>

        {loading && <ActivityIndicator color={colors.primary} style={s.loader} />}
        {!loading && !state && error && (
          <View style={[s.errorBand, { borderColor: colors.danger }]}>
            <Text style={[s.error, { color: colors.danger }]}>{error}</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => void load()}>
              <Text style={s.primaryText}>RETRY</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loading && state && (
          <>
            <View style={s.statusSection}>
              <Text style={s.sectionLabel}>STATUS</Text>
              <Text style={[
                s.stage,
                state.stage === 'completed' && [s.good, { color: colors.success }],
                (state.stage === 'failed' || state.stage === 'needs-fee-funding') && [s.danger, { color: colors.danger }],
              ]}>
                {stageLabel(state.stage)}
              </Text>
              {prepared && (
                <Text style={s.progress}>
                  {completedCount}/{state.selectedIds.length} VTXO CHAINS UNROLLED
                </Text>
              )}
            </View>

            {!prepared && selectedIds.length === 0 && (
              <View style={s.emptySelection}>
                <Text style={s.emptyTitle}>NO VTXOS SELECTED</Text>
                <Text style={s.bodyCopy}>Choose the exact inputs from Coin Control first.</Text>
                <TouchableOpacity style={s.primaryBtn} onPress={() => router.replace('/coin-control')}>
                  <Ionicons name="options-outline" size={18} color={colors.onPrimary} />
                  <Text style={s.primaryText}>OPEN COIN CONTROL</Text>
                </TouchableOpacity>
              </View>
            )}

            {(!prepared && selectedIds.length > 0) && (
              <View style={s.formSection}>
                <View style={s.selectionLine}>
                  <Text style={s.sectionLabel}>SELECTED INPUTS</Text>
                  <Text style={s.selectionValue}>{selectedIds.length} VTXO{selectedIds.length === 1 ? '' : 'S'}</Text>
                </View>
                <Text style={s.inputLabel}>BITCOIN DESTINATION</Text>
                <TextInput
                  value={destination}
                  onChangeText={setDestination}
                  placeholder="bc1..."
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={s.input}
                />
                <TouchableOpacity
                  style={[s.dangerBtn, (!destination.trim() || busy) && s.disabled]}
                  onPress={() => void prepare()}
                  disabled={!destination.trim() || busy}
                >
                  {busy
                    ? <ActivityIndicator color="#ffffff" />
                    : <>
                        <Ionicons name="shield-checkmark-outline" size={18} color="#ffffff" />
                        <Text style={s.dangerBtnText}>PREPARE EXIT</Text>
                      </>}
                </TouchableOpacity>
              </View>
            )}

            {prepared && (
              <>
                <View style={s.dataSection}>
                  <DataRow label="VTXO AMOUNT" value={`${fmt(state.selectedAmountSats)} SATS`} styles={s} />
                  <DataRow label="INPUTS" value={`${state.selectedIds.length}`} styles={s} />
                  <DataRow label="DESTINATION" value={shortId(state.destination)} styles={s} />
                  <TouchableOpacity
                    style={s.copyLine}
                    onPress={() => void copy(state.destination, 'DESTINATION COPIED')}
                  >
                    <Text style={s.copyText}>{copied === 'DESTINATION COPIED' ? copied : 'COPY DESTINATION'}</Text>
                    <Ionicons name="copy-outline" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </View>

                <View style={s.feeSection}>
                  <View style={s.feeTitleLine}>
                    <Text style={s.sectionLabel}>P2A FEE WALLET</Text>
                    <Text style={[s.feeBalance, state.feeBalanceSats <= 0 && [s.danger, { color: colors.danger }]]}>
                      {fmt(state.feeBalanceSats)} SATS
                    </Text>
                  </View>
                  <Text style={s.feeAddress}>{state.feeAddress}</Text>
                  <TouchableOpacity
                    style={s.copyLine}
                    onPress={() => void copy(state.feeAddress, 'FEE ADDRESS COPIED')}
                  >
                    <Text style={s.copyText}>{copied === 'FEE ADDRESS COPIED' ? copied : 'COPY FEE ADDRESS'}</Text>
                    <Ionicons name="copy-outline" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </View>

                {state.currentVtxoId && (
                  <View style={s.currentBand}>
                    <Text style={s.sectionLabel}>CURRENT VTXO</Text>
                    <Text style={s.currentValue}>{shortId(state.currentVtxoId)}</Text>
                    {state.currentTxid && (
                      <Text style={s.currentTxid}>TX {shortId(state.currentTxid)}</Text>
                    )}
                  </View>
                )}

                {state.finalTxid && (
                  <View style={[s.completeBand, { borderColor: colors.success }]}>
                    <Ionicons name="checkmark-circle" size={24} color={colors.success} />
                    <View style={s.completeBody}>
                      <Text style={[s.completeTitle, { color: colors.success }]}>BITCOIN EXIT BROADCAST</Text>
                      <Text style={s.completeTxid}>{shortId(state.finalTxid)}</Text>
                    </View>
                  </View>
                )}

                {error && <Text style={[s.error, { color: colors.danger }]}>{error}</Text>}

                {state.stage !== 'completed' && (
                  <TouchableOpacity
                    style={[s.dangerBtn, busy && s.disabled]}
                    onPress={() => void advance()}
                    disabled={busy}
                  >
                    {busy
                      ? <ActivityIndicator color="#ffffff" />
                      : <>
                          <Ionicons
                            name={state.stage === 'needs-fee-funding' ? 'wallet-outline' : 'play'}
                            size={18}
                            color="#ffffff"
                          />
                          <Text style={s.dangerBtnText}>
                            {state.stage === 'needs-fee-funding'
                              ? 'CHECK FEE BALANCE'
                              : state.stage === 'waiting-confirmation' || state.stage === 'waiting-timelock'
                                ? 'CHECK STATUS'
                                : 'CONTINUE EXIT'}
                          </Text>
                        </>}
                  </TouchableOpacity>
                )}

                {canClear && (
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => void clearDraft()} disabled={busy}>
                    <Text style={s.secondaryText}>
                      {state.stage === 'completed' ? 'CLOSE COMPLETED EXIT' : 'CANCEL BEFORE BROADCAST'}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {!prepared && error && <Text style={[s.error, { color: colors.danger }]}>{error}</Text>}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DataRow({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    iconBtn: { ...pixel, width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg },
    headerSpacer: { width: 38 },
    title: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 2 },
    content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
    warningBand: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.lg, borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#e06060' },
    warningBody: { flex: 1 },
    warningTitle: { fontFamily: typography.pixel, fontSize: 12, color: '#c84f4f' },
    warningCopy: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: '#9e4141' },
    loader: { marginTop: spacing.xxxl },
    errorBand: { ...pixel, marginTop: spacing.lg, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.cardBg, borderColor: '#c84f4f' },
    statusSection: { alignItems: 'center', paddingVertical: spacing.xl },
    sectionLabel: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 1 },
    stage: { marginTop: spacing.sm, fontFamily: typography.pixel, fontSize: 12, lineHeight: 18, color: colors.primaryDark, textAlign: 'center' },
    progress: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 13, color: colors.muted },
    good: { color: '#2ea043' },
    danger: { color: '#c84f4f' },
    emptySelection: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xl },
    emptyTitle: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark },
    bodyCopy: { fontFamily: typography.numbers, fontSize: 15, lineHeight: 21, color: colors.muted, textAlign: 'center' },
    formSection: { gap: spacing.md },
    selectionLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    selectionValue: { fontFamily: typography.numbers, fontSize: 15, color: colors.primaryDark },
    inputLabel: { marginTop: spacing.md, fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark },
    input: { ...pixel, minHeight: 64, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: typography.numbers, fontSize: 16, color: colors.primaryDark, backgroundColor: colors.cardBg },
    dataSection: { ...pixel, backgroundColor: colors.cardBg },
    dataRow: { minHeight: 58, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.dotted },
    dataLabel: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted },
    dataValue: { flexShrink: 1, fontFamily: typography.numbers, fontSize: 15, color: colors.primaryDark, textAlign: 'right' },
    copyLine: { minHeight: 44, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
    copyText: { fontFamily: typography.pixel, fontSize: 12, color: colors.primary },
    feeSection: { marginTop: spacing.lg, padding: spacing.lg, borderTopWidth: 2, borderBottomWidth: 2, borderColor: colors.border, backgroundColor: colors.cardBg },
    feeTitleLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
    feeBalance: { fontFamily: typography.numbers, fontSize: 15, color: colors.primaryDark },
    feeAddress: { marginTop: spacing.md, fontFamily: typography.numbers, fontSize: 13, lineHeight: 19, color: colors.primaryDark },
    currentBand: { marginTop: spacing.lg, paddingVertical: spacing.lg, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.dotted },
    currentValue: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 15, color: colors.primaryDark },
    currentTxid: { marginTop: spacing.xs, fontFamily: typography.numbers, fontSize: 13, color: colors.muted },
    completeBand: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg, borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#2ea043' },
    completeBody: { flex: 1 },
    completeTitle: { fontFamily: typography.pixel, fontSize: 12, color: '#2ea043' },
    completeTxid: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 13, color: colors.primaryDark },
    error: { marginTop: spacing.lg, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: '#c84f4f', textAlign: 'center' },
    primaryBtn: { ...pixel, width: '100%', minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.primary, borderColor: colors.primaryDark },
    primaryText: { fontFamily: typography.pixel, fontSize: 12, color: colors.onPrimary },
    dangerBtn: { ...pixel, width: '100%', minHeight: 58, marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: '#c84f4f', borderColor: '#8f3030' },
    dangerBtnText: { fontFamily: typography.pixel, fontSize: 12, color: '#ffffff' },
    secondaryBtn: { minHeight: 52, marginTop: spacing.md, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted },
    disabled: { opacity: 0.45 },
  });
}
