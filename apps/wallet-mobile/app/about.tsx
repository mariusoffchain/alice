import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, typography } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  checkNetworkHealth,
  NETWORK,
  ASP_URL,
  SWAP_PROVIDER,
  type ServiceHealth,
} from '@alice-wallet/wallet-core';

export default function AboutScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const [connStatus, setConnStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [services, setServices] = useState<ServiceHealth[]>([]);

  useEffect(() => {
    let active = true;
    void checkNetworkHealth()
      .then(services => {
        if (active) {
          setServices(services);
          setConnStatus(services.every(service => service.ok) ? 'connected' : 'error');
        }
      })
      .catch(() => {
        if (active) setConnStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const connLabel = connStatus === 'connected' ? 'SERVICES ONLINE'
    : connStatus === 'checking' ? 'CHECKING...'
    : 'PARTIAL OUTAGE';
  const connColor = connStatus === 'connected' ? '#2ea043'
    : connStatus === 'checking' ? '#d4a017'
    : '#e06060';
  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const appCommit = process.env.EXPO_PUBLIC_APP_COMMIT_SHA ?? 'local-dev';

  const rows = [
    { label: 'STATUS', value: connLabel, color: connColor },
    { label: 'NETWORK', value: NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet' },
    { label: 'SWAPS', value: SWAP_PROVIDER === 'satora' ? 'Satora' : 'Boltz' },
    { label: 'ASP', value: ASP_URL },
    { label: 'VERSION', value: appVersion },
    { label: 'COMMIT', value: appCommit },
  ];

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')} style={[s.backBtn, pixel, { backgroundColor: colors.cardBg }]}>
          <Text style={[s.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.primaryDark }]}>ABOUT</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
        {rows.map((r, i) => (
          <View
            key={r.label}
            style={[s.row, i === rows.length - 1 && s.rowLast, { borderBottomColor: colors.dotted }]}
          >
            <Text style={[s.rowLabel, { color: colors.primaryDark }]}>{r.label}</Text>
            <View style={s.rowRight}>
              {'color' in r && r.color && <View style={[s.statusDot, { backgroundColor: r.color }]} />}
              <Text
                style={[s.rowValue, { color: 'color' in r && r.color ? r.color : colors.muted }]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {r.value}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {services.length > 0 && (
        <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
          <Text style={[s.sectionTitle, { color: colors.primaryDark }]}>NETWORK SERVICES</Text>
          {services.map((service, index) => (
            <View
              key={service.id}
              style={[s.row, index === services.length - 1 && s.rowLast, { borderBottomColor: colors.dotted }]}
            >
              <Text style={[s.rowLabel, { color: colors.primaryDark }]}>{service.label}</Text>
              <View style={s.rowRight}>
                <View style={[s.statusDot, { backgroundColor: service.ok ? '#2ea043' : '#e06060' }]} />
                <Text
                  style={[s.rowValue, { color: service.ok ? colors.muted : '#e06060' }]}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {service.ok ? 'REACHABLE' : service.detail}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* The SIL Open Font License asks that the notice travel with the font.
          This build embeds both typefaces, so the credit belongs in the app
          itself, not only in the repository. */}
      <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
        <Text style={[s.sectionTitle, { color: colors.primaryDark }]}>CREDITS</Text>
        {CREDITS.map((credit, index) => (
          <View
            key={credit.label}
            style={[s.row, index === CREDITS.length - 1 && s.rowLast, { borderBottomColor: colors.dotted }]}
          >
            <Text style={[s.rowLabel, { color: colors.primaryDark }]}>{credit.label}</Text>
            <Text style={[s.rowValue, { color: colors.muted }]} numberOfLines={2}>
              {credit.value}
            </Text>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const CREDITS = [
  { label: 'ALICE', value: 'AGPL-3.0-or-later' },
  { label: 'TERMINAL GROTESQUE', value: 'Raphaël Bastide, SIL OFL 1.1' },
  { label: 'PRESS START 2P', value: 'CodeMan38, SIL OFL 1.1' },
];

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontFamily: typography.pixel, fontSize: 18 },
  title: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 3 },
  section: { marginHorizontal: spacing.lg, marginTop: spacing.md },
  sectionTitle: { fontFamily: typography.pixel, fontSize: 8, letterSpacing: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, borderBottomWidth: 1 },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontFamily: typography.pixel, fontSize: 11, letterSpacing: 1 },
  rowValue: { flexShrink: 1, fontFamily: typography.pixel, fontSize: 11, textAlign: 'right' },
  rowRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.xs, marginLeft: spacing.md },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
});
