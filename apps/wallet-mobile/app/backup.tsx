import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
let usePreventScreenCapture: (tag?: string) => void = () => {};
if (Platform.OS !== 'web') {
  try { usePreventScreenCapture = require('expo-screen-capture').usePreventScreenCapture; } catch {}
}
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { loadMnemonic, NETWORK } from '@alice-wallet/wallet-core';
import { isBackupComplete, markBackupComplete } from '../lib/onboarding';

type Step = 'intro' | 'seed' | 'verify' | 'complete';

export default function BackupScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [step, setStep] = useState<Step>('intro');
  const [backupComplete, setBackupComplete] = useState<boolean | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifyAnswers, setVerifyAnswers] = useState<(string | null)[]>([null, null, null]);
  const [verifyError, setVerifyError] = useState(false);
  const [visibleWordIndex, setVisibleWordIndex] = useState<number | null>(null);
  usePreventScreenCapture('alice-recovery-phrase');

  useEffect(() => {
    isBackupComplete().then(setBackupComplete).catch(() => setBackupComplete(false));
  }, []);

  // Expo keeps screens mounted in the navigation stack. Clear words whenever
  // this screen loses focus so a return to the wallet never leaves a revealed
  // phrase in memory or on a recently viewed screen.
  useFocusEffect(useCallback(() => () => {
    setMnemonic(null);
    setVisibleWordIndex(null);
  }, []));

  const words = useMemo(() => mnemonic?.split(' ').filter(Boolean) ?? [], [mnemonic]);

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      if (Platform.OS !== 'web') {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Enter your phone PIN or use biometrics to view your recovery phrase',
          cancelLabel: 'Cancel',
          disableDeviceFallback: false,
        });
        if (!result.success) {
          setError('Authentication required.');
          return;
        }
      }

      const value = await loadMnemonic();
      if (!value) throw new Error('Recovery phrase not found.');
      setVisibleWordIndex(null);
      setMnemonic(value);
      setStep('seed');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to unlock recovery phrase.');
    } finally {
      setLoading(false);
    }
  }

  function startVerification() {
    const indices: number[] = [];
    while (indices.length < 3) {
      const index = Math.floor(Math.random() * words.length);
      if (!indices.includes(index)) indices.push(index);
    }
    indices.sort((a, b) => a - b);
    setVerifyIndices(indices);
    setVerifyAnswers([null, null, null]);
    setVerifyError(false);
    setStep('verify');
  }

  function toggleWord(index: number) {
    // Keep the phrase glance-resistant: revealing one word masks every other.
    setVisibleWordIndex(current => current === index ? null : index);
  }

  function leaveScreen() {
    setMnemonic(null);
    setVisibleWordIndex(null);
    router.back();
  }

  function selectWord(questionIndex: number, word: string) {
    const answers = [...verifyAnswers];
    answers[questionIndex] = word;
    setVerifyAnswers(answers);
    setVerifyError(false);
  }

  function getChoices(correctIndex: number): string[] {
    const correct = words[correctIndex];
    const alternatives: string[] = [];
    while (alternatives.length < 3) {
      const candidate = wordlist[Math.floor(Math.random() * wordlist.length)];
      if (candidate !== correct && !alternatives.includes(candidate)) alternatives.push(candidate);
    }
    const choices = [correct, ...alternatives];
    for (let index = choices.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
    }
    return choices;
  }

  const choicesPerQuestion = useMemo(
    () => verifyIndices.map(index => getChoices(index)),
    [verifyIndices, words],
  );

  async function confirmVerification() {
    const correct = verifyIndices.every((wordIndex, questionIndex) => verifyAnswers[questionIndex] === words[wordIndex]);
    if (!correct) {
      setVerifyError(true);
      return;
    }
    await markBackupComplete();
    setBackupComplete(true);
    setMnemonic(null);
    setStep('complete');
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={leaveScreen} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>{backupComplete ? 'RECOVERY' : 'BACKUP'}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {step === 'intro' && (
          <>
            <Text style={s.title}>{backupComplete ? 'RECOVERY PHRASE' : 'BACK UP YOUR WALLET'}</Text>
            <Text style={s.description}>
              {backupComplete
                ? 'Reveal your recovery phrase only in a private place.'
                : 'Your wallet is ready, but it is not backed up yet. Write down the 12 words and verify them to protect your Bitcoin.'}
              {Platform.OS === 'web'
                ? `\n\nThis phrase controls only this browser wallet on ${
                  NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet'
                }.`
                : ''}
            </Text>
            <Text style={s.warning}>NEVER SHARE THESE WORDS</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => void reveal()} disabled={loading || backupComplete === null}>
              <Text style={s.primaryText}>{loading ? 'UNLOCKING...' : backupComplete ? 'REVEAL PHRASE' : 'START BACKUP'}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'seed' && (
          <>
            <Text style={s.title}>WRITE DOWN THESE 12 WORDS</Text>
            <Text style={s.description}>Keep them offline and in order. Anyone with these words can access your Bitcoin.</Text>
            <View style={s.seedGrid}>
              {words.map((word, index) => {
                const revealed = visibleWordIndex === index;
                return (
                <TouchableOpacity
                  key={`${index}-${word}`}
                  style={[s.seedWord, revealed && s.seedWordRevealed]}
                  onPress={() => toggleWord(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Recovery word ${index + 1}. ${revealed ? 'Hide' : 'Reveal'}`}
                >
                  <Text style={s.seedNumber}>{index + 1}</Text>
                  {revealed ? (
                    <Text style={s.seedText}>{word}</Text>
                  ) : (
                    <View style={s.seedMask} accessibilityElementsHidden>
                      <View style={s.seedMaskFill} />
                      <View style={s.seedMaskHighlight} />
                    </View>
                  )}
                </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.warning}>ALICE WILL NEVER ASK YOU FOR THESE WORDS</Text>
            {backupComplete ? (
              <TouchableOpacity style={s.primaryBtn} onPress={leaveScreen}>
                <Text style={s.primaryText}>DONE</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.primaryBtn} onPress={startVerification}>
                <Text style={s.primaryText}>I WROTE THEM DOWN</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {step === 'verify' && (
          <>
            <Text style={s.title}>VERIFY YOUR BACKUP</Text>
            <Text style={s.description}>Select the correct word for each position.</Text>
            {verifyIndices.map((wordIndex, questionIndex) => (
              <View key={wordIndex} style={s.verifyBlock}>
                <Text style={s.verifyLabel}>WORD #{wordIndex + 1}</Text>
                <View style={s.choiceRow}>
                  {choicesPerQuestion[questionIndex].map(word => {
                    const selected = verifyAnswers[questionIndex] === word;
                    const wrong = verifyError && selected && word !== words[wordIndex];
                    return (
                      <TouchableOpacity
                        key={word}
                        style={[s.choice, selected && s.choiceSelected, wrong && s.choiceWrong]}
                        onPress={() => selectWord(questionIndex, word)}
                      >
                        <Text style={[s.choiceText, selected && s.choiceTextSelected]}>{word}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
            {verifyError && <Text style={s.error}>Some words are wrong. Try again.</Text>}
            <TouchableOpacity
              style={[s.primaryBtn, verifyAnswers.includes(null) && s.disabled]}
              onPress={() => void confirmVerification()}
              disabled={verifyAnswers.includes(null)}
            >
              <Text style={s.primaryText}>CONFIRM BACKUP</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'complete' && (
          <>
            <Text style={s.title}>BACKUP VERIFIED</Text>
            <Text style={s.description}>Your recovery phrase is safely backed up. Alice will no longer show the backup reminder.</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => router.replace('/')}>
              <Text style={s.primaryText}>BACK TO WALLET</Text>
            </TouchableOpacity>
          </>
        )}

        {error && <Text style={s.error}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', ...pixel, backgroundColor: colors.cardBg },
    backIcon: { fontFamily: typography.pixel, fontSize: 18, color: colors.primary },
    headerTitle: { fontFamily: typography.pixel, fontSize: 11, color: colors.primaryDark, letterSpacing: 2 },
    body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.xxxl },
    title: { maxWidth: 480, fontFamily: typography.pixel, fontSize: 13, lineHeight: 22, color: colors.primaryDark, letterSpacing: 2, textAlign: 'center' },
    description: { marginTop: spacing.lg, maxWidth: 520, fontFamily: typography.numbers, fontSize: 16, lineHeight: 23, color: colors.muted, textAlign: 'center' },
    warning: { marginTop: spacing.xl, fontFamily: typography.pixel, fontSize: 7, lineHeight: 14, color: '#e06060', letterSpacing: 1, textAlign: 'center' },
    primaryBtn: { ...pixel, marginTop: spacing.xxl, paddingHorizontal: spacing.xxl, paddingVertical: spacing.lg, backgroundColor: colors.primary, borderColor: colors.primaryDark },
    primaryText: { fontFamily: typography.pixel, fontSize: 8, color: colors.onPrimary, letterSpacing: 1, textAlign: 'center' },
    disabled: { opacity: 0.4 },
    seedGrid: { width: '100%', maxWidth: 520, marginTop: spacing.xxl, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    seedWord: { ...pixel, width: '48%', minHeight: 52, flexDirection: 'row', alignItems: 'center', padding: spacing.md, backgroundColor: colors.cardBg },
    seedWordRevealed: { backgroundColor: colors.background },
    seedNumber: { width: 28, fontFamily: typography.numbers, fontSize: 13, color: colors.muted },
    seedText: { fontFamily: typography.numbers, fontSize: 17, color: colors.primaryDark },
    seedMask: { width: 92, height: 16, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.dotted, opacity: 0.75 },
    seedMaskFill: { position: 'absolute', top: 0, bottom: 0, left: 5, right: 5, backgroundColor: colors.muted, opacity: 0.32 },
    seedMaskHighlight: { position: 'absolute', top: 4, bottom: 4, left: 0, right: 0, backgroundColor: colors.cardBg, opacity: 0.38 },
    verifyBlock: { marginTop: spacing.xl, width: '100%', maxWidth: 440 },
    verifyLabel: { marginBottom: spacing.sm, fontFamily: typography.pixel, fontSize: 8, color: colors.primaryDark },
    choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    choice: { ...pixel, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.cardBg },
    choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primaryDark },
    choiceWrong: { backgroundColor: '#e06060', borderColor: '#c04040' },
    choiceText: { fontFamily: typography.numbers, fontSize: 14, color: colors.primaryDark },
    choiceTextSelected: { color: colors.onPrimary },
    error: { marginTop: spacing.lg, fontFamily: typography.numbers, fontSize: 14, color: '#e06060', textAlign: 'center' },
  });
}
