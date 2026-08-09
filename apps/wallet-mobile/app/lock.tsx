import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { getPinLength, loadLockConfig, verifyPin } from '@alice-wallet/wallet-core';
import { unlockSession } from '@alice-wallet/shared-types';
import { PinInput } from '@alice-wallet/alice-ui';

const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 30;

export default function LockScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [pin, setPin] = useState('');
  const [pinLength, setPinLength] = useState<4 | 6>(6);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    loadLockConfig().then(config => {
      if (!config) {
        unlock();
        return;
      }
      setPinLength(getPinLength(config));
      setBiometricEnabled(config.biometricEnabled && Platform.OS !== 'web');
      if (config.biometricEnabled && Platform.OS !== 'web') void useBiometric();
    });
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  function unlock() {
    unlockSession();
    router.replace('/');
  }

  async function useBiometric() {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Alice',
      cancelLabel: 'Use PIN',
      disableDeviceFallback: true,
    });
    if (result.success) unlock();
  }

  async function submitPin(value = pin) {
    if (checking || cooldown > 0 || value.length !== pinLength) return;
    setChecking(true);
    setError(null);
    try {
      if (await verifyPin(value)) {
        unlock();
        return;
      }
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      setPin('');
      if (nextAttempts >= MAX_ATTEMPTS) {
        setAttempts(0);
        setCooldown(COOLDOWN_SECONDS);
        setError(`Too many attempts. Try again in ${COOLDOWN_SECONDS} seconds.`);
      } else {
        setError(`Incorrect PIN. ${MAX_ATTEMPTS - nextAttempts} attempts remaining.`);
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.body}>
        <Text style={s.title}>ALICE IS LOCKED</Text>
        <Text style={s.description}>{cooldown > 0 ? `TRY AGAIN IN ${cooldown}s` : `ENTER YOUR ${pinLength}-DIGIT PIN`}</Text>
        <PinInput
          value={pin}
          onChange={setPin}
          length={pinLength}
          onInput={() => setError(null)}
          onComplete={digits => void submitPin(digits)}
          autoFocus
          editable={cooldown === 0}
          containerStyle={s.pinInputWrap}
          inputStyle={s.pinInput}
        />
        <TouchableOpacity
          style={[s.primaryBtn, (pin.length !== pinLength || cooldown > 0) && s.disabled]}
          onPress={() => void submitPin()}
          disabled={pin.length !== pinLength || cooldown > 0 || checking}
        >
          <Text style={s.primaryText}>{checking ? 'CHECKING...' : 'UNLOCK'}</Text>
        </TouchableOpacity>
        {biometricEnabled && (
          <TouchableOpacity style={s.biometricBtn} onPress={() => void useBiometric()}>
            <Text style={s.biometricText}>USE FACE ID / FINGERPRINT</Text>
          </TouchableOpacity>
        )}
        {error && <Text style={s.error}>{cooldown > 0 ? `Too many attempts. Try again in ${cooldown} seconds.` : error}</Text>}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
    title: { fontFamily: typography.pixel, fontSize: 14, color: colors.primaryDark, letterSpacing: 3, textAlign: 'center' },
    description: { marginTop: spacing.lg, fontFamily: typography.pixel, fontSize: 7, color: colors.muted, letterSpacing: 1, textAlign: 'center' },
    pinInputWrap: { maxWidth: 320, marginTop: spacing.xxl },
    pinInput: { fontSize: 22, letterSpacing: 12 },
    primaryBtn: { ...pixel, width: '100%', maxWidth: 320, marginTop: spacing.xl, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.primaryDark },
    primaryText: { fontFamily: typography.pixel, fontSize: 8, color: colors.onPrimary, letterSpacing: 1 },
    biometricBtn: { marginTop: spacing.xl, padding: spacing.md },
    biometricText: { fontFamily: typography.pixel, fontSize: 7, color: colors.primaryDark, letterSpacing: 1, textAlign: 'center' },
    disabled: { opacity: 0.4 },
    error: { maxWidth: 360, marginTop: spacing.lg, fontFamily: typography.numbers, fontSize: 14, color: '#e06060', textAlign: 'center' },
  });
}
