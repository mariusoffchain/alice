import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { addDiagnosticLog } from '@alice-wallet/wallet-core';
import { checkNetworkHealth, type ServiceHealth } from '@alice-wallet/wallet-core';
import { NETWORK, ASP_URL, ESPLORA_URL } from '@alice-wallet/wallet-core';

export default function ServerSettingsScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [status, setStatus] = useState<'idle' | 'checking' | 'connected' | 'degraded' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceHealth[]>([]);

  async function checkConnection() {
    setStatus('checking');
    setError(null);
    try {
      const nextServices = await checkNetworkHealth();
      setServices(nextServices);
      const failed = nextServices.filter(service => !service.ok);
      if (failed.length > 0) {
        const detail = failed.map(service => `${service.label}: ${service.detail}`).join(' | ');
        const hasWorkingService = nextServices.some(service => service.ok);
        setStatus(hasWorkingService ? 'degraded' : 'error');
        setError(detail);
        await addDiagnosticLog(
          hasWorkingService ? 'warning' : 'error',
          hasWorkingService ? 'Network health check partially succeeded' : 'Network health check failed',
          detail,
        );
        return;
      }
      setStatus('connected');
      await addDiagnosticLog('info', 'Network health check succeeded');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Server unavailable';
      setStatus('error');
      setError(message);
      await addDiagnosticLog('error', 'Server connection check failed', message);
    }
  }

  const rows = [
    ['NETWORK', NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet'],
    ['ARKADE SERVER', ASP_URL],
    ['BITCOIN EXPLORER', ESPLORA_URL],
    ['SDK', '0.4.39'],
  ];

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.title}>SERVER</Text><View style={{ width: 36 }} />
      </View>
      <View style={s.body}>
        <View style={s.section}>
          {rows.map(([label, value], index) => (
            <View key={label} style={[s.row, index === rows.length - 1 && s.rowLast]}>
              <Text style={s.rowLabel}>{label}</Text><Text style={s.rowValue}>{value}</Text>
            </View>
          ))}
        </View>
        {services.length > 0 && (
          <View style={s.serviceList}>
            {services.map(service => (
              <View key={service.id} style={s.serviceRow}>
                <Text style={s.serviceName}>{service.label}</Text>
                <Text style={[s.serviceStatus, service.ok ? [s.connected, { color: colors.success }] : [s.failed, { color: colors.danger }]]}>
                  {service.ok ? 'OK' : service.detail}
                </Text>
              </View>
            ))}
          </View>
        )}
        <View style={s.statusRow}>
          {status === 'checking' && <ActivityIndicator color={colors.primary} />}
          <Text style={[
            s.status,
            status === 'connected' && [s.connected, { color: colors.success }],
            status === 'degraded' && [s.degraded, { color: colors.warning }],
            status === 'error' && [s.failed, { color: colors.danger }],
          ]}>
            {status === 'idle'
              ? 'NOT CHECKED'
              : status === 'checking'
                ? 'CHECKING...'
                : status === 'connected'
                  ? '● CONNECTED'
                  : status === 'degraded'
                    ? '● PARTIAL CONNECTION'
                    : '● SERVICES UNAVAILABLE'}
          </Text>
        </View>
        {error && <Text style={[s.error, status === 'degraded' && [s.degraded, { color: colors.warning }]]}>{error}</Text>}
        <TouchableOpacity style={s.primaryBtn} onPress={() => void checkConnection()} disabled={status === 'checking'}>
          <Text style={s.primaryText}>{status === 'error' ? 'RETRY' : 'CHECK CONNECTION'}</Text>
        </TouchableOpacity>
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
    body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, alignItems: 'center' },
    section: { ...pixel, width: '100%', maxWidth: 560, backgroundColor: colors.cardBg },
    row: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.dotted, gap: spacing.sm },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 1 },
    rowValue: { fontFamily: typography.numbers, fontSize: 15, color: colors.primaryDark },
    statusRow: { marginTop: spacing.xl, minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    status: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted },
    connected: { color: '#2ea043' },
    degraded: { color: '#d4a017' },
    failed: { color: '#e06060' },
    error: { marginTop: spacing.md, fontFamily: typography.numbers, fontSize: 14, color: '#e06060', textAlign: 'center' },
    serviceList: { ...pixel, width: '100%', maxWidth: 560, marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.cardBg },
    serviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm },
    serviceName: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 1 },
    serviceStatus: { flex: 1, textAlign: 'right', fontFamily: typography.numbers, fontSize: 13, color: colors.muted },
    primaryBtn: { ...pixel, width: '100%', maxWidth: 360, marginTop: spacing.xl, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.primaryDark },
    primaryText: { fontFamily: typography.pixel, fontSize: 12, color: colors.onPrimary, letterSpacing: 1 },
  });
}
