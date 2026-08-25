import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  ADVANCED_GROUP_ORDER,
  advancedSectionsInGroup,
  type AdvancedGroup,
} from '../lib/advanced-sections';

const GROUP_TITLES: Record<AdvancedGroup, string> = {
  connection: 'CONNECTION',
  coins: 'YOUR COINS',
  recovery: 'RECOVERY',
  developer: 'DEVELOPER',
};

export default function AdvancedSettingsScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.title}>ADVANCED</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {ADVANCED_GROUP_ORDER.map((group) => {
          const sections = advancedSectionsInGroup(group);
          if (sections.length === 0) return null;
          return (
            <View key={group}>
              <Text style={s.groupTitle}>{GROUP_TITLES[group]}</Text>
              <View style={s.section}>
                {sections.map((section, index) => (
                  <TouchableOpacity
                    key={section.id}
                    style={[s.row, index === sections.length - 1 && s.rowLast]}
                    onPress={() => router.push(section.route)}
                  >
                    <Text style={s.rowLabel}>{section.label}</Text>
                    <Text style={s.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}

        <TouchableOpacity style={[s.resetBtn, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]} onPress={() => router.push('/reset-wallet')}>
          <Text style={[s.resetText, { color: colors.danger }]}>RESET WALLET</Text>
        </TouchableOpacity>
      </ScrollView>
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
    scroll: { paddingBottom: spacing.xxl },
    groupTitle: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 2, marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xs },
    section: { ...pixel, marginHorizontal: spacing.lg, backgroundColor: colors.cardBg },
    row: { minHeight: 72, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.dotted },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 1 },
    chevron: { fontFamily: typography.numbers, fontSize: 28, color: colors.muted },
    resetBtn: { ...pixel, marginHorizontal: spacing.lg, marginTop: spacing.xxl, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: '#fff1f1', borderColor: '#e06060' },
    resetText: { fontFamily: typography.pixel, fontSize: 12, color: '#c84f4f', letterSpacing: 1 },
  });
}
