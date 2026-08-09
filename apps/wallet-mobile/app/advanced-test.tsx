import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  SWAP_PROVIDER,
  armRefundTest,
  disarmRefundTest,
  isRefundTestArmed,
} from '@alice-wallet/wallet-core';

export default function AdvancedTestScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [refundTestArmed, setRefundTestArmed] = useState(false);

  useEffect(() => {
    isRefundTestArmed().then(setRefundTestArmed).catch(() => {});
  }, []);

  async function toggleRefundTest() {
    if (refundTestArmed) {
      await disarmRefundTest();
      setRefundTestArmed(false);
    } else {
      await armRefundTest();
      setRefundTestArmed(true);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.title}>TEST</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Removing the menu entry is not enough: the route stays reachable
          through a deep link. Refuse to arm anything outside a dev build. */}
      {!__DEV__ ? (
        <View style={s.testCard}>
          <Text style={s.testTitle}>NOT AVAILABLE</Text>
          <Text style={s.testDescription}>
            This developer tool is not part of distributed builds.
          </Text>
        </View>
      ) : SWAP_PROVIDER !== 'boltz' ? (
        <View style={s.testCard}>
          <Text style={s.testTitle}>NOT AVAILABLE</Text>
          <Text style={s.testDescription}>
            This legacy test only supports Boltz swaps.
          </Text>
        </View>
      ) : Platform.OS === 'web' ? (
        <View style={s.testCard}>
          <Text style={s.testTitle}>REFUND TEST</Text>
          <Text style={s.testDescription}>
            Arms the next on-chain swap once. Automatic claim is paused after funding so the swap can expire and be refunded.
          </Text>
          <TouchableOpacity
            style={[s.testBtn, refundTestArmed && s.testBtnArmed]}
            onPress={() => void toggleRefundTest()}
          >
            <Text style={s.testBtnText}>{refundTestArmed ? 'ARMED · TAP TO CANCEL' : 'ARM NEXT SWAP'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.testCard}>
          <Text style={s.testTitle}>NO WEB TESTS</Text>
          <Text style={s.testDescription}>Refund test mode is only available in the PWA for now.</Text>
        </View>
      )}
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
    testCard: { ...pixel, marginHorizontal: spacing.lg, marginTop: spacing.xl, padding: spacing.lg, backgroundColor: colors.cardBg, borderColor: '#d4a017' },
    testTitle: { fontFamily: typography.pixel, fontSize: 9, color: '#d4a017', letterSpacing: 1 },
    testDescription: { marginTop: spacing.md, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.muted },
    testBtn: { ...pixel, marginTop: spacing.lg, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.primaryDark },
    testBtnArmed: { backgroundColor: '#d4a017', borderColor: '#8f6d0a' },
    testBtnText: { fontFamily: typography.pixel, fontSize: 7, color: colors.onPrimary, letterSpacing: 1 },
  });
}
