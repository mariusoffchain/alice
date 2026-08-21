import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { PixelToggle, useTheme } from '@alice-wallet/alice-ui';
import {
  getVtxoAutomationStatus,
  setDelegateRenewalEnabled,
  type VtxoAutomationStatus,
} from '@alice-wallet/wallet-core';

function shortKey(value: string | null) {
  if (!value) return 'UNAVAILABLE';
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export default function DelegatesScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [status, setStatus] = useState<VtxoAutomationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await getVtxoAutomationStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load delegate settings.');
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function toggle(enabled: boolean) {
    if (busy || !status) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await setDelegateRenewalEnabled(enabled));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update delegated renewal.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="arrow-back" size={19} color={colors.primary} />
        </TouchableOpacity>
        <Text style={s.title}>DELEGATED RENEWAL</Text>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {!status && !error && <ActivityIndicator color={colors.primary} />}

        {status && (
          <>
            <View style={s.setting}>
              <View style={s.settingCopy}>
                <Text style={s.settingTitle}>USE ARKADE DEFAULT DELEGATE</Text>
                <Text style={s.settingDescription}>
                  Let Arkade&apos;s delegate manage eligible VTXO renewals automatically.
                </Text>
              </View>
              <PixelToggle
                value={status.delegateEnabled}
                onValueChange={value => void toggle(value)}
                disabled={busy}
                accessibilityLabel="Use Arkade default delegate"
              />
            </View>

            <View style={s.notice}>
              <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
              <Text style={s.noticeText}>
                The delegate can only renew eligible VTXOs. It cannot spend your funds or control your wallet.
              </Text>
            </View>

            <View style={s.section}>
              <View style={s.row}>
                <Text style={s.rowLabel}>STATUS</Text>
                <Text style={[s.rowValue, status.delegateEnabled && [s.good, { color: colors.success }]]}>
                  {status.delegateEnabled ? 'ACTIVE' : 'INACTIVE'}
                </Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowLabel}>FEE</Text>
                <Text style={s.rowValue}>
                  {status.delegateEnabled
                    ? status.delegateFee === '0' ? 'FREE' : status.delegateFee ?? 'UNAVAILABLE'
                    : 'N/A'}
                </Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowLabel}>PUBLIC KEY</Text>
                <Text style={s.rowValue}>{shortKey(status.delegatePubkey)}</Text>
              </View>
              <View style={[s.row, s.rowLast]}>
                <Text style={s.rowLabel}>SERVICE</Text>
                <Text style={s.serviceValue}>{status.delegateUrl}</Text>
              </View>
            </View>

            <Text style={s.detail}>
              Changing this setting reconnects the wallet and changes the Arkade address used for future receipts. Existing funds remain discoverable. Alice renews older non-delegated VTXOs locally while the wallet is unlocked.
            </Text>
          </>
        )}

        {busy && (
          <View style={s.busy}>
            <ActivityIndicator color={colors.primary} />
            <Text style={s.busyText}>RECONNECTING WALLET...</Text>
          </View>
        )}
        {error && <Text style={[s.error, { color: colors.danger, backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    iconBtn: {
      ...pixel,
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardBg,
    },
    headerSpacer: { width: 36 },
    title: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.primaryDark,
      letterSpacing: 2,
      textAlign: 'center',
    },
    body: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xl,
      paddingBottom: spacing.xxl,
      gap: spacing.lg,
    },
    setting: {
      ...pixel,
      minHeight: 96,
      padding: spacing.lg,
      backgroundColor: colors.cardBg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
    },
    settingCopy: { flex: 1, gap: spacing.sm },
    settingTitle: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.primaryDark,
      letterSpacing: 1,
      lineHeight: 15,
    },
    settingDescription: {
      fontFamily: typography.numbers,
      fontSize: 16,
      color: colors.muted,
      lineHeight: 22,
    },
    notice: {
      ...pixel,
      padding: spacing.lg,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: colors.cardBg,
    },
    noticeText: {
      flex: 1,
      fontFamily: typography.numbers,
      fontSize: 16,
      color: colors.primaryDark,
      lineHeight: 23,
    },
    section: { ...pixel, backgroundColor: colors.cardBg },
    row: {
      minHeight: 64,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.dotted,
    },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.muted,
      letterSpacing: 1,
    },
    rowValue: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.primaryDark,
      textAlign: 'right',
    },
    serviceValue: {
      flex: 1,
      fontFamily: typography.numbers,
      fontSize: 14,
      color: colors.primaryDark,
      textAlign: 'right',
    },
    good: { color: '#28a745' },
    detail: {
      fontFamily: typography.numbers,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 22,
    },
    busy: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    busyText: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.muted,
      letterSpacing: 1,
    },
    error: {
      ...pixel,
      padding: spacing.md,
      fontFamily: typography.numbers,
      fontSize: 15,
      color: '#c84f4f',
      backgroundColor: '#fff1f1',
      borderColor: '#e06060',
    },
  });
}
