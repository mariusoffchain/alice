import { useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  clearDiagnosticLogs,
  getDiagnosticLogs,
  NETWORK,
  SWAP_PROVIDER,
  type DiagnosticLog,
} from '@alice-wallet/wallet-core';

export default function AdvancedLogsScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [logs, setLogs] = useState<DiagnosticLog[]>([]);
  const [copied, setCopied] = useState(false);

  useFocusEffect(useCallback(() => { getDiagnosticLogs().then(setLogs); }, []));

  function buildDiagText() {
    return [
      'Alice Wallet diagnostics',
      `Platform: ${Platform.OS}`,
      `Network: ${NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet'}`,
      `Swap provider: ${SWAP_PROVIDER === 'satora' ? 'Satora' : 'Boltz'}`,
      'Arkade SDK: 0.4.39',
      `Date: ${new Date().toISOString()}`,
      `Entries: ${logs.length}`,
      '',
      ...logs.map(log => `${new Date(log.createdAt).toISOString()} [${log.level}] ${log.message}${log.detail ? ` - ${log.detail}` : ''}`),
    ].join('\n');
  }

  async function copyLogs() {
    const text = buildDiagText();
    if (Platform.OS === 'web') await navigator.clipboard.writeText(text);
    else await (await import('expo-clipboard')).setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  async function shareLogs() {
    try { await Share.share({ message: buildDiagText() }); } catch {}
  }

  async function clearLogs() {
    await clearDiagnosticLogs();
    setLogs([]);
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.title}>LOGS</Text><View style={{ width: 36 }} />
      </View>
      <Text style={s.notice}>Diagnostic logs never include your recovery phrase or PIN.</Text>
      <FlatList
        data={logs}
        keyExtractor={item => item.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={s.empty}>NO DIAGNOSTIC EVENTS YET</Text>}
        renderItem={({ item }) => (
          <View style={s.logCard}>
            <View style={s.logHeader}>
              <Text style={[s.level, item.level === 'error' && [s.errorLevel, { color: colors.danger }]]}>{item.level.toUpperCase()}</Text>
              <Text style={s.date}>{new Date(item.createdAt).toLocaleString()}</Text>
            </View>
            <Text style={s.message}>{item.message}</Text>
            {item.detail && <Text style={s.detail}>{item.detail}</Text>}
          </View>
        )}
      />
      <View style={s.actions}>
        <TouchableOpacity style={s.primaryBtn} onPress={() => void copyLogs()}><Text style={s.primaryText}>{copied ? 'COPIED' : 'COPY'}</Text></TouchableOpacity>
        {Platform.OS !== 'web' && (
          <TouchableOpacity style={s.primaryBtn} onPress={() => void shareLogs()}><Text style={s.primaryText}>EXPORT</Text></TouchableOpacity>
        )}
        <TouchableOpacity style={s.clearBtn} onPress={() => void clearLogs()}><Text style={s.clearText}>CLEAR</Text></TouchableOpacity>
      </View>
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
    notice: { marginHorizontal: spacing.xl, marginTop: spacing.md, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
    list: { padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
    empty: { marginTop: spacing.xxxl, fontFamily: typography.pixel, fontSize: 12, color: colors.muted, textAlign: 'center' },
    logCard: { ...pixel, marginBottom: spacing.md, padding: spacing.md, backgroundColor: colors.cardBg },
    logHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
    level: { fontFamily: typography.pixel, fontSize: 12, color: colors.primary },
    errorLevel: { color: '#e06060' },
    date: { fontFamily: typography.numbers, fontSize: 13, color: colors.muted },
    message: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 14, color: colors.primaryDark },
    detail: { marginTop: spacing.xs, fontFamily: typography.numbers, fontSize: 13, color: colors.muted },
    actions: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, flexDirection: 'row', gap: spacing.md },
    primaryBtn: { ...pixel, flex: 1, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.primaryDark },
    primaryText: { fontFamily: typography.pixel, fontSize: 12, color: colors.onPrimary },
    clearBtn: { ...pixel, flex: 1, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: colors.cardBg },
    clearText: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted },
  });
}
