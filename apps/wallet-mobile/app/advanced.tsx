import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';

export default function AdvancedSettingsScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);

  const rows = [
    { label: 'LOGS', route: '/advanced-logs' as const },
    { label: 'SERVER', route: '/advanced-server' as const },
    { label: 'DELEGATED RENEWAL', route: '/delegates' as const },
    { label: 'COIN CONTROL', route: '/coin-control' as const },
    { label: 'ADDRESSES', route: '/addresses' as const },
    { label: 'SWAP IDs', route: '/swap-ids' as const },
    { label: 'EMERGENCY EXIT', route: '/emergency-exit' as const },
    // A developer tool that deliberately lets a swap expire so it can be
    // refunded. It was hidden by the swap provider, which made its visibility
    // an accident of configuration: a Boltz build would have shipped it to
    // testers. Gate it on the build type instead, so no distributed build can
    // show it whatever the provider is.
    ...(__DEV__
      ? [{ label: 'TEST', route: '/advanced-test' as const }]
      : []),
  ];

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.title}>ADVANCED</Text>
        <View style={{ width: 36 }} />
      </View>
      <View style={s.section}>
        {rows.map((row, index) => (
          <TouchableOpacity key={row.label} style={[s.row, index === rows.length - 1 && s.rowLast]} onPress={() => router.push(row.route as never)}>
            <Text style={s.rowLabel}>{row.label}</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={s.resetBtn} onPress={() => router.push('/reset-wallet')}>
        <Text style={s.resetText}>RESET WALLET</Text>
      </TouchableOpacity>
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
    section: { ...pixel, marginHorizontal: spacing.lg, marginTop: spacing.xl, backgroundColor: colors.cardBg },
    row: { minHeight: 72, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.dotted },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { fontFamily: typography.pixel, fontSize: 9, color: colors.primaryDark, letterSpacing: 1 },
    rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rowValue: { fontFamily: typography.pixel, fontSize: 7, color: colors.muted },
    chevron: { fontFamily: typography.numbers, fontSize: 28, color: colors.muted },
    resetBtn: { ...pixel, marginHorizontal: spacing.lg, marginTop: spacing.xxl, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: '#fff1f1', borderColor: '#e06060' },
    resetText: { fontFamily: typography.pixel, fontSize: 8, color: '#c84f4f', letterSpacing: 1 },
  });
}
