import { useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  buildSupportReport,
  NETWORK,
  SWAP_PROVIDER,
  type SupportReportCategory,
} from '@alice-wallet/wallet-core';

const FEEDBACK_EMAIL = 'report@alicebtc.com';
const FEEDBACK_REPO = 'mariusoffchain/alice-support-contribute';

const CATEGORIES: { id: SupportReportCategory; label: string }[] = [
  { id: 'bug', label: 'BUG' },
  { id: 'alice-response', label: 'ALICE' },
  { id: 'knowledge', label: 'KNOWLEDGE' },
];

export default function SupportScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [category, setCategory] = useState<SupportReportCategory>('bug');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [copied, setCopied] = useState(false);

  function reportText() {
    return buildSupportReport({
      category,
      summary,
      description,
      context: {
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        commit: process.env.EXPO_PUBLIC_APP_COMMIT_SHA ?? 'local-dev',
        network: NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet',
        platform: Platform.OS === 'web' ? 'Web' : Platform.OS,
        swapProvider: SWAP_PROVIDER === 'satora' ? 'Satora' : 'Boltz',
      },
    });
  }

  async function copyReport() {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(reportText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function emailReport() {
    const subject = encodeURIComponent(`[Alice beta report] ${summary.trim() || 'Report'}`);
    const body = encodeURIComponent(reportText());
    await Linking.openURL(`mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`);
  }

  async function openGitHubReport() {
    const title = encodeURIComponent(summary.trim() || 'Alice beta report');
    const body = encodeURIComponent(reportText());
    const labels = encodeURIComponent(`${category},private-beta`);
    await Linking.openURL(`https://github.com/${FEEDBACK_REPO}/issues/new?title=${title}&body=${body}&labels=${labels}`);
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')}
          style={s.backBtn}
        >
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>REPORT</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={[s.warning, { borderColor: colors.danger }]}>
          <Text style={[s.warningTitle, { color: colors.danger }]}>KEEP YOUR WALLET PRIVATE</Text>
          <Text style={s.warningText}>
            Never include your recovery phrase, private keys, API keys, or sensitive screenshots.
          </Text>
        </View>

        <View style={s.segmented}>
          {CATEGORIES.map((item, index) => {
            const active = category === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  s.segment,
                  index > 0 && s.segmentBorder,
                  active && s.segmentActive,
                ]}
                onPress={() => setCategory(item.id)}
              >
                <Text style={[s.segmentText, active && s.segmentTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TextInput
          style={s.input}
          value={summary}
          onChangeText={setSummary}
          placeholder="Short summary"
          placeholderTextColor={colors.muted}
          maxLength={120}
        />
        <TextInput
          style={[s.input, s.description]}
          value={description}
          onChangeText={setDescription}
          placeholder="What happened, and what did you expect instead?"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={1200}
          textAlignVertical="top"
        />

        <Text style={s.contextNote}>
          The report includes only app version, build, platform, network, and swap provider.
        </Text>

        <TouchableOpacity style={s.primaryButton} onPress={emailReport}>
          <Text style={s.primaryButtonText}>EMAIL REPORT</Text>
        </TouchableOpacity>
        <View style={s.secondaryActions}>
          <TouchableOpacity style={s.secondaryButton} onPress={copyReport}>
            <Text style={s.secondaryButtonText}>{copied ? 'COPIED' : 'COPY REPORT'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryButton} onPress={openGitHubReport}>
            <Text style={s.secondaryButtonText}>OPEN GITHUB</Text>
          </TouchableOpacity>
        </View>
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
    backBtn: {
      ...pixel,
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardBg,
    },
    backIcon: { fontFamily: typography.pixel, fontSize: 18, color: colors.primary },
    title: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 3 },
    body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
    warning: {
      ...pixel,
      marginTop: spacing.md,
      padding: spacing.lg,
      backgroundColor: colors.cardBg,
      borderColor: '#e06060',
    },
    warningTitle: { fontFamily: typography.pixel, fontSize: 12, color: '#e06060', letterSpacing: 1 },
    warningText: {
      marginTop: spacing.sm,
      fontFamily: typography.numbers,
      fontSize: 15,
      lineHeight: 21,
      color: colors.primaryDark,
    },
    segmented: {
      ...pixel,
      flexDirection: 'row',
      marginTop: spacing.xl,
      overflow: 'hidden',
      backgroundColor: colors.cardBg,
    },
    segment: {
      flex: 1,
      minHeight: 42,
      paddingHorizontal: spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentBorder: { borderLeftWidth: 2, borderLeftColor: colors.border },
    segmentActive: { backgroundColor: colors.primary },
    segmentText: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.muted,
      letterSpacing: 1,
      textAlign: 'center',
    },
    segmentTextActive: { color: colors.onPrimary },
    input: {
      ...pixel,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      backgroundColor: colors.cardBg,
      borderColor: colors.border,
      color: colors.primaryDark,
      fontFamily: typography.numbers,
      fontSize: 15,
    },
    description: { minHeight: 132, lineHeight: 21 },
    contextNote: {
      marginTop: spacing.md,
      fontFamily: typography.numbers,
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
    },
    primaryButton: {
      ...pixel,
      marginTop: spacing.xl,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderColor: colors.primaryDark,
    },
    primaryButtonText: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.onPrimary,
      letterSpacing: 1,
    },
    secondaryActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    secondaryButton: {
      ...pixel,
      flex: 1,
      minHeight: 44,
      paddingHorizontal: spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardBg,
      borderColor: colors.border,
    },
    secondaryButtonText: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.primary,
      letterSpacing: 1,
      textAlign: 'center',
    },
  });
}
