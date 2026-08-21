import { Text, View, StyleSheet, TouchableOpacity, Image, ActivityIndicator, TextInput, Platform, ScrollView, Animated, Easing, useWindowDimensions, LayoutChangeEvent, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { PixelFill } from '@alice-wallet/alice-ui';
import { AliceAvatar } from '@alice-wallet/alice-ui';
import { initWallet, NETWORK, restoreWallet, saveMnemonic } from '@alice-wallet/wallet-core';
import { markBackupComplete, markOnboarded } from '../lib/onboarding';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

type Step = 'welcome' | 'import' | 'creating' | 'ready';

const READY_MESSAGE = "Your wallet is ready. You can now send and receive Bitcoin (on-chain, on Ark, and over Lightning). And I'm here to guide you at every step of your journey into Bitcoin.";
function normalizeBip39Phrase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => {
      if (wordlist.includes(word)) return word;
      if (word.length >= 4) {
        const matches = wordlist.filter(candidate => candidate.startsWith(word));
        return matches.length === 1 ? matches[0] : word;
      }
      return word;
    })
    .join(' ');
}

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState<string | null>(null);
  const [importPhrase, setImportPhrase] = useState('');
  const { width: screenW, height: screenH } = useWindowDimensions();
  const readyProgress = useRef(new Animated.Value(0)).current;
  const [readyComplete, setReadyComplete] = useState(false);
  const [typed, setTyped] = useState('');
  const [cursorOn, setCursorOn] = useState(true);
  const [bubbleWidth, setBubbleWidth] = useState(0);

  useEffect(() => {
    if (step !== 'ready') return;
    setReadyComplete(false);
    setTyped('');
    readyProgress.setValue(0);
  }, [step]);

  // Started from PixelFill's onReady so the grid is mounted before progress
  // moves, otherwise the natively driven fill runs ahead of first paint.
  const startReadyAnimation = () => {
    readyProgress.setValue(0);
    Animated.timing(readyProgress, {
      toValue: 1,
      duration: 900,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => setReadyComplete(true));
  };

  useEffect(() => {
    if (!readyComplete) return;
    let i = 0;
    let advance: ReturnType<typeof setTimeout> | undefined;
    const charsPerTick = Platform.OS === 'web' ? 1 : 3;
    const interval = Platform.OS === 'web' ? 24 : 40;
    const id = setInterval(() => {
      i = Math.min(i + charsPerTick, READY_MESSAGE.length);
      setTyped(READY_MESSAGE.slice(0, i));
      if (i >= READY_MESSAGE.length) {
        clearInterval(id);
        advance = setTimeout(() => router.replace('/?intro=pixel'), 10_000);
      }
    }, interval);
    return () => { clearInterval(id); if (advance) clearTimeout(advance); };
  }, [readyComplete]);

  useEffect(() => {
    if (step !== 'ready') return;
    const id = setInterval(() => setCursorOn(v => !v), 480);
    return () => clearInterval(id);
  }, [step]);

  async function initializeWallet(mnemonic: string, failureStep: 'welcome' | 'import', alreadyBackedUp = false) {
    setStep('creating');
    setError(null);
    try {
      await saveMnemonic(mnemonic);
      await markOnboarded();
      if (alreadyBackedUp) await markBackupComplete();
      await initWallet();
      if (alreadyBackedUp) await restoreWallet();
      setStep('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save keys.');
      setStep(failureStep);
    }
  }

  async function createWallet() {
    await initializeWallet(generateMnemonic(wordlist, 128), 'welcome');
  }

  async function importWallet() {
    const normalized = normalizeBip39Phrase(importPhrase);
    const wordCount = normalized ? normalized.split(' ').length : 0;
    if (![12, 24].includes(wordCount) || !validateMnemonic(normalized, wordlist)) {
      setError('Enter a valid English BIP39 recovery phrase with 12 or 24 words.');
      return;
    }
    setImportPhrase(normalized);
    await initializeWallet(normalized, 'import', true);
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.kav} behavior="padding">
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Image source={require('../assets/lock3-icon.png')} style={s.logo} />

        {step === 'welcome' && (
          <>
            <Text style={s.title}>ALICE</Text>
            <Text style={s.subtitle}>Your Bitcoin companion</Text>
            <Text style={s.desc}>
              Alice creates a secure wallet on your device.{`\n`}
              Your keys never leave your phone.
            </Text>
            {NETWORK === 'bitcoin' && (
              <Text style={[s.warning, { color: colors.danger }]}>MAINNET BETA · REAL BITCOIN · START WITH SMALL AMOUNTS</Text>
            )}
            {error && <Text style={[s.error, { color: colors.danger }]}>{error}</Text>}
            <TouchableOpacity style={s.btn} onPress={() => void createWallet()}>
              <Text style={s.btnText}>CREATE WALLET</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={() => { setError(null); setStep('import'); }}
            >
              <Text style={s.secondaryText}>IMPORT WALLET</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'import' && (
          <>
            <Text style={s.title}>IMPORT</Text>
            <Text style={s.subtitle}>Restore an existing wallet</Text>
            <Text style={s.desc}>Enter your 12- or 24-word English BIP39 recovery phrase in the correct order.</Text>
            {NETWORK === 'bitcoin' && (
              <Text style={[s.warning, { color: colors.danger }]}>MAINNET BETA · REAL BITCOIN · START WITH SMALL AMOUNTS</Text>
            )}
            <TextInput
              style={[s.seedInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
              value={importPhrase}
              onChangeText={value => { setImportPhrase(value); setError(null); }}
              placeholder="word1 word2 word3 ..."
              placeholderTextColor={colors.muted}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
            />
            <Text style={[s.warning, { color: colors.danger }]}>NEVER PASTE YOUR PHRASE INTO A WEBSITE YOU DO NOT TRUST</Text>
            {error && <Text style={[s.error, { color: colors.danger }]}>{error}</Text>}
            <TouchableOpacity
              style={[s.btn, !importPhrase.trim() && s.disabled]}
              onPress={() => void importWallet()}
              disabled={!importPhrase.trim()}
            >
              <Text style={s.btnText}>IMPORT WALLET</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.backLink}
              onPress={() => { setError(null); setStep('welcome'); }}
            >
              <Text style={s.backLinkText}>← BACK</Text>
            </TouchableOpacity>
          </>
        )}

        {(step === 'creating' || step === 'ready') && (
          <>
            <Text style={s.title}>CREATING</Text>
            <Text style={s.subtitle}>Generating your keys...</Text>
            <ActivityIndicator size="large" color={colors.primary} style={s.loader} />
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {step === 'ready' && (
        <View style={[s.readyOverlay, readyComplete && s.readyComplete]}>
          <PixelFill
            progress={readyProgress}
            width={screenW}
            height={screenH}
            color={colors.primary}
            origin="bottom-edge"
            onReady={startReadyAnimation}
          />
          <Animated.View
            style={[
              s.readyContent,
              { paddingBottom: Math.max(spacing.xxxl, insets.bottom + spacing.xxl) },
              {
                opacity: readyProgress.interpolate({
                  inputRange: [0.62, 1],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <View style={s.readyCenter}>
              <AliceAvatar size={120} color={colors.onPrimary} />
              <View
                style={s.readyBubble}
                onLayout={(e: LayoutChangeEvent) => setBubbleWidth(e.nativeEvent.layout.width)}
              >
                <View style={[s.readyTail, bubbleWidth > 0 && { left: (bubbleWidth - 14) / 2, marginLeft: 0 }]} />
                <Text style={s.readyBubbleText}>
                  {typed}
                  <Text style={[s.readyCursor, { opacity: cursorOn ? 1 : 0 }]}>|</Text>
                </Text>
              </View>
            </View>
            <TouchableOpacity style={s.readyBtn} onPress={() => router.replace('/?intro=pixel')}>
              <Text style={s.readyBtnText}>START</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    kav: { flex: 1 },
    body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, paddingVertical: spacing.xxxl },
    logo: { width: 72, height: 72, resizeMode: 'contain', marginBottom: spacing.xl },
    title: { fontFamily: typography.pixel, fontSize: 18, color: colors.primaryDark, letterSpacing: 4, textAlign: 'center' },
    subtitle: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 1, marginTop: spacing.sm, textAlign: 'center' },
    desc: { maxWidth: 420, fontFamily: typography.numbers, fontSize: 16, color: colors.muted, textAlign: 'center', lineHeight: 24, marginTop: spacing.lg },
    error: { fontFamily: typography.numbers, fontSize: 14, color: '#e06060', textAlign: 'center', marginTop: spacing.sm },
    warning: { maxWidth: 420, marginTop: spacing.md, fontFamily: typography.pixel, fontSize: 12, lineHeight: 13, color: '#e06060', textAlign: 'center' },
    loader: { marginVertical: spacing.xl },
    btn: { ...pixel, marginTop: spacing.xxl, backgroundColor: colors.primary, borderColor: colors.primaryDark, paddingVertical: spacing.lg, paddingHorizontal: spacing.xxxl },
    disabled: { opacity: 0.4 },
    btnText: { fontFamily: typography.pixel, fontSize: 12, color: colors.onPrimary, letterSpacing: 2 },
    secondaryBtn: { ...pixel, marginTop: spacing.md, backgroundColor: colors.cardBg, paddingVertical: spacing.lg, paddingHorizontal: spacing.xxxl },
    secondaryText: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 1 },
    seedInput: { ...pixel, width: '100%', maxWidth: 520, minHeight: 130, marginTop: spacing.xl, padding: spacing.lg, backgroundColor: colors.cardBg, fontFamily: typography.numbers, fontSize: 17, lineHeight: 25, color: colors.primaryDark, textAlignVertical: 'top' },
    backLink: { marginTop: spacing.xl, padding: spacing.sm },
    backLinkText: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 1 },
    readyOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, overflow: 'hidden' },
    readyComplete: { backgroundColor: colors.primary },
    readyContent: { flex: 1, justifyContent: 'space-between', paddingBottom: spacing.xxxl },
    readyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
    readyBubble: { ...pixel, marginTop: spacing.xxl, maxWidth: 440, backgroundColor: colors.onPrimary, borderColor: colors.onPrimary, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
    readyTail: { position: 'absolute', top: -7, left: '50%', marginLeft: -7, width: 14, height: 14, backgroundColor: colors.onPrimary, transform: [{ rotate: '45deg' }] },
    readyBubbleText: { fontFamily: typography.numbers, fontSize: 18, lineHeight: 26, color: colors.primary, textAlign: 'center' },
    readyCursor: { fontFamily: typography.numbers, fontSize: 18, color: colors.primary },
    readyBtn: { ...pixel, backgroundColor: colors.onPrimary, marginHorizontal: spacing.xxl, paddingVertical: spacing.lg, alignItems: 'center' },
    readyBtnText: { fontFamily: typography.pixel, fontSize: 12, color: colors.primary, letterSpacing: 2 },
  });
}
