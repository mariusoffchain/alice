import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { PixelToggle, useTheme } from '@alice-wallet/alice-ui';
import { clearAppLock, createPin, loadLockConfig, setBiometricEnabled, verifyPin } from '@alice-wallet/wallet-core';
import { unlockSession } from '@alice-wallet/shared-types';
import { PinInput } from '@alice-wallet/alice-ui';

type Mode = 'loading' | 'create' | 'manage' | 'change' | 'disable';
type PinChoice = 'none' | 4 | 6;

export default function SecurityScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [mode, setMode] = useState<Mode>('loading');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [pinChoice, setPinChoice] = useState<PinChoice>('none');
  const [currentPinLength, setCurrentPinLength] = useState<4 | 6>(6);
  const [biometricEnabled, setBiometricState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadLockConfig(),
      Platform.OS === 'web'
        ? Promise.resolve(false)
        : Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()])
            .then(([hardware, enrolled]) => hardware && enrolled),
    ]).then(([config, available]) => {
      setBiometricState(config?.biometricEnabled ?? false);
      setBiometricAvailable(available);
      if (config) {
        const savedLength = config.pinLength === 4 ? 4 : 6;
        setPinChoice(savedLength);
        setCurrentPinLength(savedLength);
      }
      setMode(config ? 'manage' : 'create');
    }).catch(() => setMode('create'));
  }, []);

  function resetFields(nextMode: Mode) {
    setPin('');
    setConfirmPin('');
    setCurrentPin('');
    setError(null);
    setSuccess(null);
    setMode(nextMode);
  }

  async function saveNewPin(isChange = false) {
    setError(null);
    setSuccess(null);
    if (pin !== confirmPin) {
      setError('PINs do not match.');
      return;
    }
    if (pinChoice === 'none') {
      setError('Choose a 4-digit or 6-digit PIN.');
      return;
    }
    if (pin.length !== pinChoice || !/^\d+$/.test(pin)) {
      setError(`PIN must contain exactly ${pinChoice} digits.`);
      return;
    }
    setBusy(true);
    try {
      if (isChange && !(await verifyPin(currentPin))) {
        setError('Current PIN is incorrect.');
        return;
      }
      await createPin(pin);
      unlockSession();
      setBiometricState(false);
      setCurrentPinLength(pin.length as 4 | 6);
      resetFields('manage');
      setSuccess(isChange ? 'PIN changed.' : 'App lock enabled.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleBiometric(enabled: boolean) {
    setError(null);
    setSuccess(null);
    if (enabled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable biometric unlock',
        cancelLabel: 'Cancel',
        disableDeviceFallback: true,
      });
      if (!result.success) {
        setError('Biometric authentication was not completed.');
        return;
      }
    }
    await setBiometricEnabled(enabled);
    setBiometricState(enabled);
    setSuccess(enabled ? 'Biometric unlock enabled.' : 'Biometric unlock disabled.');
  }

  async function disableLock() {
    setError(null);
    if (!(await verifyPin(currentPin))) {
      setError('Current PIN is incorrect.');
      return;
    }
    await clearAppLock();
    unlockSession();
    resetFields('create');
    setSuccess('App lock disabled.');
  }

  async function useWithoutPin() {
    await clearAppLock();
    unlockSession();
    router.back();
  }

  function choosePin(value: PinChoice) {
    setPinChoice(value);
    setPin('');
    setConfirmPin('');
    setError(null);
  }

  const selectedPinLength = pinChoice === 'none' ? 6 : pinChoice;

  const PinChoiceButtons = ({ includeNone = true }: { includeNone?: boolean }) => (
    <View style={s.choiceRow}>
      {includeNone && (
        <TouchableOpacity style={[s.choiceBtn, pinChoice === 'none' && s.choiceBtnActive]} onPress={() => choosePin('none')}>
          <Text style={[s.choiceText, pinChoice === 'none' && s.choiceTextActive]}>NONE</Text>
        </TouchableOpacity>
      )}
      {([4, 6] as const).map(length => (
        <TouchableOpacity key={length} style={[s.choiceBtn, pinChoice === length && s.choiceBtnActive]} onPress={() => choosePin(length)}>
          <Text style={[s.choiceText, pinChoice === length && s.choiceTextActive]}>{length} DIGITS</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backIcon}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>SECURITY</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Scrollable, and taps keep going through to the buttons while the
          keyboard is up: the change-PIN mode stacks three PIN fields, which
          no longer fit once a small phone raises its keyboard. */}
      <ScrollView
        contentContainerStyle={s.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {mode === 'loading' && <Text style={s.description}>LOADING...</Text>}

        {mode === 'create' && (
          <>
            <Text style={s.title}>CHOOSE APP LOCK</Text>
            <Text style={s.description}>Choose no PIN, a 4-digit PIN, or a more secure 6-digit PIN.</Text>
            <PinChoiceButtons />
            {pinChoice === 'none' ? (
              <TouchableOpacity style={s.secondaryBtn} onPress={() => void useWithoutPin()}>
                <Text style={s.secondaryText}>CONTINUE WITHOUT PIN</Text>
              </TouchableOpacity>
            ) : (
              <>
                <PinInput value={pin} onChange={setPin} onInput={() => setError(null)} placeholder="enter password" length={selectedPinLength} />
                <PinInput value={confirmPin} onChange={setConfirmPin} onInput={() => setError(null)} placeholder="confirm password" length={selectedPinLength} />
                <TouchableOpacity style={[s.primaryBtn, busy && s.disabled]} onPress={() => void saveNewPin()} disabled={busy}>
                  <Text style={s.primaryText}>ENABLE LOCK</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {mode === 'manage' && (
          <>
            <Text style={s.title}>APP LOCK ENABLED</Text>
            <Text style={s.description}>Alice locks at launch and after being left in the background for two minutes.</Text>
            <View style={s.settingRow}>
              <View style={s.settingCopy}>
                <Text style={s.settingTitle}>BIOMETRIC UNLOCK</Text>
                <Text style={s.settingDescription}>{biometricAvailable ? 'Face ID or fingerprint' : 'Not available on this device'}</Text>
              </View>
              <PixelToggle
                value={biometricEnabled}
                onValueChange={value => void toggleBiometric(value)}
                disabled={!biometricAvailable}
                accessibilityLabel="Enable biometric unlock"
              />
            </View>
            <TouchableOpacity style={s.secondaryBtn} onPress={() => resetFields('change')}>
              <Text style={s.secondaryText}>CHANGE PIN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.dangerBtn, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]} onPress={() => resetFields('disable')}>
              <Text style={[s.dangerText, { color: colors.danger }]}>DISABLE APP LOCK</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === 'change' && (
          <>
            <Text style={s.title}>CHANGE PIN</Text>
            <Text style={s.description}>Choose the length of your new PIN.</Text>
            <PinChoiceButtons includeNone={false} />
            <PinInput value={currentPin} onChange={setCurrentPin} onInput={() => setError(null)} placeholder="current password" length={currentPinLength} />
            <PinInput value={pin} onChange={setPin} onInput={() => setError(null)} placeholder="new password" length={selectedPinLength} />
            <PinInput value={confirmPin} onChange={setConfirmPin} onInput={() => setError(null)} placeholder="confirm password" length={selectedPinLength} />
            <TouchableOpacity style={s.primaryBtn} onPress={() => void saveNewPin(true)}>
              <Text style={s.primaryText}>SAVE NEW PIN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.backLink} onPress={() => resetFields('manage')}><Text style={s.backLinkText}>CANCEL</Text></TouchableOpacity>
          </>
        )}

        {mode === 'disable' && (
          <>
            <Text style={s.title}>DISABLE APP LOCK?</Text>
            <Text style={s.description}>Anyone with access to this device will be able to open Alice.</Text>
            <PinInput value={currentPin} onChange={setCurrentPin} onInput={() => setError(null)} placeholder="current password" length={currentPinLength} />
            <TouchableOpacity style={[s.dangerBtn, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]} onPress={() => void disableLock()}>
              <Text style={[s.dangerText, { color: colors.danger }]}>CONFIRM DISABLE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.backLink} onPress={() => resetFields('manage')}><Text style={s.backLinkText}>CANCEL</Text></TouchableOpacity>
          </>
        )}

        {error && <Text style={[s.error, { color: colors.danger }]}>{error}</Text>}
        {success && <Text style={[s.success, { color: colors.success }]}>{success}</Text>}
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
    headerTitle: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 2 },
    body: { flexGrow: 1, alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl, paddingBottom: spacing.xxl },
    title: { fontFamily: typography.pixel, fontSize: 12, lineHeight: 20, color: colors.primaryDark, letterSpacing: 2, textAlign: 'center' },
    description: { maxWidth: 480, marginTop: spacing.lg, marginBottom: spacing.lg, fontFamily: typography.numbers, fontSize: 16, lineHeight: 23, color: colors.muted, textAlign: 'center' },
    primaryBtn: { ...pixel, marginTop: spacing.xxl, width: '100%', maxWidth: 420, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.primaryDark },
    primaryText: { fontFamily: typography.pixel, fontSize: 12, color: colors.onPrimary, letterSpacing: 1 },
    secondaryBtn: { ...pixel, marginTop: spacing.xxl, width: '100%', maxWidth: 420, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.cardBg },
    secondaryText: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 1 },
    dangerBtn: { ...pixel, marginTop: spacing.md, width: '100%', maxWidth: 420, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: '#fff1f1', borderColor: '#e06060' },
    dangerText: { fontFamily: typography.pixel, fontSize: 12, color: '#c84f4f', letterSpacing: 1 },
    disabled: { opacity: 0.4 },
    settingRow: { ...pixel, width: '100%', maxWidth: 420, marginTop: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.cardBg },
    settingCopy: { flex: 1, gap: spacing.sm },
    settingTitle: { fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, letterSpacing: 1 },
    settingDescription: { fontFamily: typography.numbers, fontSize: 14, color: colors.muted },
    choiceRow: { width: '100%', maxWidth: 420, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
    choiceBtn: { ...pixel, flex: 1, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: colors.cardBg },
    choiceBtnActive: { backgroundColor: colors.primary, borderColor: colors.primaryDark },
    choiceText: { fontFamily: typography.pixel, fontSize: 10, lineHeight: 14, color: colors.primaryDark, letterSpacing: 1 },
    choiceTextActive: { color: colors.onPrimary },
    backLink: { marginTop: spacing.lg, padding: spacing.sm },
    backLinkText: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 1 },
    error: { marginTop: spacing.lg, fontFamily: typography.numbers, fontSize: 14, color: '#e06060', textAlign: 'center' },
    success: { marginTop: spacing.lg, fontFamily: typography.numbers, fontSize: 14, color: '#2ea043', textAlign: 'center' },
  });
}
