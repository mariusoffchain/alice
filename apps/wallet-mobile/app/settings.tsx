import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { spacing, typography, PALETTES } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { getBalanceFormat, setBalanceFormat, type BalanceFormat } from '@alice-wallet/alice-ui';
import { getFiatCurrency, setFiatCurrency, ALL_CURRENCIES, type FiatCurrency } from '@alice-wallet/alice-ui';
import { isBackupComplete } from '../lib/onboarding';
import { isLockEnabled } from '@alice-wallet/wallet-core';
import { BitcoinIcon } from '@alice-wallet/alice-ui';
import { useAccount } from '@alice-wallet/alice-ai';
import {
  SETTINGS_GROUP_ORDER,
  sectionsInGroup,
  type SettingsGroup,
} from '../lib/settings-sections';

const SWITCHER_OPTIONS: { value: BalanceFormat; label: string; icon?: boolean }[] = [
  { value: 'symbol', label: '₿', icon: true },
  { value: 'sats', label: 'sats' },
  { value: 'btc', label: 'BTC' },
  { value: 'usd', label: '$' },
];

const GROUP_TITLES: Record<SettingsGroup, string> = {
  alice: 'ALICE',
  wallet: 'THIS DEVICE',
  about: 'ABOUT ALICE',
};

export default function SettingsScreen() {
  const router = useRouter();
  const { mode, palette, colors, pixel } = useTheme();
  const [balFmt, setBalFmt] = useState<BalanceFormat>('symbol');
  const [currency, setCurrency] = useState<FiatCurrency>('USD');
  const [backupComplete, setBackupComplete] = useState<boolean | null>(null);
  const [lockEnabled, setLockEnabled] = useState(false);
  const account = useAccount();

  useEffect(() => {
    getBalanceFormat().then(setBalFmt);
    getFiatCurrency().then(setCurrency);
    isBackupComplete().then(setBackupComplete).catch(() => setBackupComplete(false));
  }, []);

  useFocusEffect(useCallback(() => {
    isLockEnabled().then(setLockEnabled).catch(() => setLockEnabled(false));
  }, []));

  /** The trailing hint on a row, when the row has live state worth previewing. */
  const valueFor = (id: string): string => {
    if (id === 'appearance') {
      return `${PALETTES[palette].label} · ${mode === 'dark' ? 'Dark' : 'Light'} ›`;
    }
    if (id === 'lock') return `${lockEnabled ? 'ON' : 'OFF'} ›`;
    if (id === 'account') {
      // A paid plan is metered in bytes, so the request counter would be a lie
      // there: the row shows the estimated percentage instead, like every
      // metered AI product does.
      if (!account.cloudUsage) return 'SIGN IN ›';
      return account.cloudUsage.kind === 'paid'
        ? `${account.cloudUsage.percentUsed}% USED ›`
        : `${account.cloudUsage.remaining}/${account.cloudUsage.limit} ›`;
    }
    return '›';
  };

  const renderGroup = (group: SettingsGroup) => (
    <View key={group}>
      <Text style={[s.groupTitle, { color: colors.muted }]}>{GROUP_TITLES[group]}</Text>
      <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
        {group === 'alice' && (
          <>
            <View style={[s.row, s.balanceRow, { borderBottomColor: colors.dotted }]}>
              <Text style={[s.rowLabel, { color: colors.primaryDark }]}>BALANCE</Text>
              <View style={[s.switcher, { borderColor: colors.border }]}>
                {SWITCHER_OPTIONS.map((opt, i) => {
                  const active = opt.value === balFmt;
                  const tint = active ? colors.onPrimary : colors.muted;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={async () => { setBalFmt(opt.value); await setBalanceFormat(opt.value); }}
                      style={[
                        s.switchOption,
                        i > 0 && { borderLeftWidth: 2, borderLeftColor: colors.border },
                        active && { backgroundColor: colors.primary },
                      ]}
                    >
                      {opt.icon ? (
                        <BitcoinIcon size={16} color={tint} />
                      ) : (
                        <Text style={[s.switchLabel, { color: tint }]}>{opt.label}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={[s.row, s.balanceRow, { borderBottomColor: colors.dotted }]}>
              <Text style={[s.rowLabel, { color: colors.primaryDark }]}>CURRENCY</Text>
              <View style={[s.switcher, { borderColor: colors.border }]}>
                {ALL_CURRENCIES.map((cur, i) => {
                  const active = cur === currency;
                  return (
                    <TouchableOpacity
                      key={cur}
                      onPress={async () => { setCurrency(cur); await setFiatCurrency(cur); }}
                      style={[
                        s.switchOption,
                        i > 0 && { borderLeftWidth: 2, borderLeftColor: colors.border },
                        active && { backgroundColor: colors.primary },
                      ]}
                    >
                      <Text style={[s.switchLabel, { color: active ? colors.onPrimary : colors.muted }]}>{cur}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {sectionsInGroup(group).map((section, index, all) => (
          <TouchableOpacity
            key={section.id}
            style={[
              s.row,
              index === all.length - 1 ? s.rowLast : { borderBottomColor: colors.dotted },
            ]}
            onPress={() => router.push(section.route)}
          >
            <Text style={[s.rowLabel, { color: colors.primaryDark }]}>{section.label}</Text>
            <Text style={[s.rowValue, { color: colors.muted }]}>{valueFor(section.id)}</Text>
          </TouchableOpacity>
        ))}

      </View>
    </View>
  );

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={[s.backBtn, pixel, { backgroundColor: colors.cardBg }]}>
          <Text style={[s.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.primaryDark }]}>SETTINGS</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {SETTINGS_GROUP_ORDER.map(renderGroup)}

        <TouchableOpacity
          style={[s.recoveryBtn, pixel, { backgroundColor: colors.primary, borderColor: colors.primaryDark }]}
          onPress={() => router.push('/backup')}
        >
          <Text style={[s.recoveryText, { color: colors.onPrimary }]}>
            {backupComplete === false ? 'BACK UP WALLET' : 'RECOVERY PHRASE'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontFamily: typography.pixel, fontSize: 18 },
  title: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 3 },
  scroll: { paddingBottom: spacing.xxl },
  groupTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 2, marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xs },
  section: { marginHorizontal: spacing.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, borderBottomWidth: 1 },
  rowLast: { borderBottomWidth: 0 },
  // The label keeps its place and the value takes what is left, right
  // aligned: APPEARANCE's value is long enough to collide otherwise.
  // 12px: plancher pixel du lot refonte; flexShrink absorbe la largeur.
  rowLabel: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, flexShrink: 0, marginRight: spacing.md },
  rowValue: { fontFamily: typography.pixel, fontSize: 12, flexShrink: 1, textAlign: 'right' },
  balanceRow: { alignItems: 'center' },
  switcher: { flexDirection: 'row', borderWidth: 2, borderRadius: 2, overflow: 'hidden' },
  switchOption: { minWidth: 40, paddingHorizontal: spacing.xs, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
  switchLabel: { fontFamily: typography.pixel, fontSize: 12 },
  recoveryBtn: { marginHorizontal: spacing.lg, marginTop: spacing.xxl, paddingVertical: spacing.lg, alignItems: 'center' },
  recoveryText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
});
