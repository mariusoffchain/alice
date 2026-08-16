import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
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

const SWITCHER_OPTIONS: { value: BalanceFormat; label: string; icon?: boolean }[] = [
  { value: 'symbol', label: '₿', icon: true },
  { value: 'sats', label: 'sats' },
  { value: 'btc', label: 'BTC' },
  { value: 'usd', label: '$' },
];

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

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={[s.backBtn, pixel, { backgroundColor: colors.cardBg }]}>
          <Text style={[s.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.primaryDark }]}>SETTINGS</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
        <TouchableOpacity
          style={[s.row, { borderBottomColor: colors.dotted }]}
          onPress={() => router.push('/appearance')}
        >
          <Text style={[s.rowLabel, { color: colors.primaryDark }]}>APPEARANCE</Text>
          <Text style={[s.rowValue, { color: colors.muted }]}>
            {PALETTES[palette].label} · {mode === 'dark' ? 'Dark' : 'Light'} ›
          </Text>
        </TouchableOpacity>
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
        <TouchableOpacity
          style={[s.row, { borderBottomColor: colors.dotted }]}
          onPress={() => router.push('/ai-settings')}
        >
          <Text style={[s.rowLabel, { color: colors.primaryDark }]}>Customize Alice</Text>
          <Text style={[s.rowValue, { color: colors.muted }]}>{'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.row, { borderBottomColor: colors.dotted }]}
          onPress={account.requestSignIn}
        >
          <Text style={[s.rowLabel, { color: colors.primaryDark }]}>ALICE ACCOUNT</Text>
          <Text style={[s.rowValue, { color: colors.muted }]}>
            {account.cloudQuota
              ? `${account.cloudQuota.remaining}/${account.cloudQuota.limit} ›`
              : 'SIGN IN ›'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.row, { borderBottomColor: colors.dotted }]}
          onPress={() => router.push('/security')}
        >
          <Text style={[s.rowLabel, { color: colors.primaryDark }]}>APP LOCK</Text>
          <View style={s.rowRight}>
            <Text style={[s.rowValue, { color: colors.muted }]}>{lockEnabled ? 'ON' : 'OFF'}</Text>
            <Text style={[s.rowValue, { color: colors.muted }]}>›</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.row, { borderBottomColor: colors.dotted }]}
          onPress={account.requestSignIn}
        >
          <Text style={[s.rowLabel, { color: colors.primaryDark }]}>ALICE ACCOUNT</Text>
          <Text style={[s.rowValue, { color: colors.muted }]}>
            {account.account
              ? `${account.account.cloud_requests_remaining}/${account.account.cloud_requests_limit} ›`
              : 'SIGN IN ›'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.row, { borderBottomColor: colors.dotted }]}
          onPress={() => router.push('/about')}
        >
          <Text style={[s.rowLabel, { color: colors.primaryDark }]}>ABOUT</Text>
          <Text style={[s.rowValue, { color: colors.muted }]}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.row, { borderBottomColor: colors.dotted }]}
          onPress={() => router.push('/support' as Href)}
        >
          <Text style={[s.rowLabel, { color: colors.primaryDark }]}>REPORT A PROBLEM</Text>
          <Text style={[s.rowValue, { color: colors.muted }]}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.row, s.rowLast]}
          onPress={() => router.push('/advanced')}
        >
          <Text style={[s.rowLabel, { color: colors.primaryDark }]}>ADVANCED</Text>
          <Text style={[s.rowValue, { color: colors.muted }]}>›</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[s.recoveryBtn, pixel, { backgroundColor: colors.primary, borderColor: colors.primaryDark }]}
        onPress={() => router.push('/backup')}
      >
        <Text style={[s.recoveryText, { color: colors.onPrimary }]}>
          {backupComplete === false ? 'BACK UP WALLET' : 'RECOVERY PHRASE'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontFamily: typography.pixel, fontSize: 18 },
  title: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 3 },
  section: { marginHorizontal: spacing.lg, marginTop: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, borderBottomWidth: 1 },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontFamily: typography.pixel, fontSize: 11, letterSpacing: 1 },
  rowValue: { fontFamily: typography.pixel, fontSize: 11 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  balanceRow: { alignItems: 'center' },
  switcher: { flexDirection: 'row', borderWidth: 2, borderRadius: 2, overflow: 'hidden' },
  switchOption: { minWidth: 40, paddingHorizontal: spacing.xs, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
  switchLabel: { fontFamily: typography.pixel, fontSize: 9 },
  recoveryBtn: { marginHorizontal: spacing.lg, marginTop: spacing.xxl, paddingVertical: spacing.lg, alignItems: 'center' },
  recoveryText: { fontFamily: typography.pixel, fontSize: 9, letterSpacing: 1 },
});
