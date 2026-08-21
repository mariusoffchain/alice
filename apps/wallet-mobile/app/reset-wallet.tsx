import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { getPaymentHistory, getPinLength, loadLockConfig, verifyPin } from '@alice-wallet/wallet-core';
import { clearWallet } from '@alice-wallet/wallet-core';
import { unlockSession } from '@alice-wallet/shared-types';
import { PinInput } from '@alice-wallet/alice-ui';

const CONFIRMATION = 'RESET ALICE';

type ResetRisk = {
  unsafeSwapCount: number;
};

export default function ResetWalletScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [understood, setUnderstood] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [pin, setPin] = useState('');
  const [pinLength, setPinLength] = useState<4 | 6 | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [risk, setRisk] = useState<ResetRisk | null>(null);

  useEffect(() => {
    loadLockConfig()
      .then(config => setPinLength(config ? getPinLength(config) : null))
      .catch(() => setPinLength(null))
      .finally(() => setLoading(false));
  }, []);

  const ready = !loading
    && understood
    && confirmation.trim().toUpperCase() === CONFIRMATION
    && (pinLength === null || pin.length === pinLength);

  async function getResetRisk(): Promise<ResetRisk> {
    const payments = await getPaymentHistory();
    return {
      unsafeSwapCount: payments.filter(payment => payment.status === 'pending' || payment.status === 'refundable').length,
    };
  }

  async function requestReset() {
    if (!ready || resetting) return;
    setError(null);
    try {
      setRisk(await getResetRisk());
    } catch {
      setError('Alice could not verify the current swap status. Reset remains blocked. Check your connection and try again.');
    }
  }

  async function resetWallet() {
    if (!ready || resetting) return;
    setError(null);
    setResetting(true);
    try {
      if (pinLength !== null && !(await verifyPin(pin))) {
        setError('Current PIN is incorrect. Nothing was deleted.');
        setPin('');
        return;
      }
      await clearWallet();
      unlockSession();
      router.replace('/onboarding');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to reset the wallet.';
      setError(`${message} Reset could not be completed. Keep your recovery phrase and try again.`);
    } finally {
      setResetting(false);
      setRisk(null);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.danger }]}>RESET WALLET</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={s.kav} behavior="padding">
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={[s.warning, { color: colors.danger }]}>THIS CANNOT BE UNDONE</Text>
        <Text style={s.description}>
          Resetting Alice removes this wallet from this device. You will return to the initial setup screen.
        </Text>

        <View style={[s.lossCard, { borderColor: colors.danger }]}>
          <Text style={[s.lossTitle, { color: colors.danger }]}>WHAT WILL BE DELETED</Text>
          <Text style={s.lossItem}>• Recovery phrase stored on this device</Text>
          <Text style={s.lossItem}>• Arkade wallet data and local history</Text>
          <Text style={s.lossItem}>• Backup status, PIN and biometric lock</Text>
        </View>

        <Text style={[s.recoveryWarning, { color: colors.danger }]}>
          Your funds can only be recovered with your recovery phrase. If you have not written it down, you may permanently lose access to them.
        </Text>
        <Text style={s.swapWarning}>
          For your safety, Alice will refuse to reset while a Bitcoin or Lightning swap is pending or still refundable.
        </Text>

        <TouchableOpacity style={s.checkRow} onPress={() => { setUnderstood(value => !value); setError(null); }}>
          <View style={[s.checkbox, understood && s.checkboxChecked]}>
            <Text style={s.checkmark}>{understood ? '✓' : ''}</Text>
          </View>
          <Text style={s.checkText}>I understand what will be lost and I have secured my recovery phrase.</Text>
        </TouchableOpacity>

        <Text style={s.inputLabel}>TYPE “RESET ALICE” TO CONFIRM</Text>
        <TextInput
          style={[s.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
          value={confirmation}
          onChangeText={value => { setConfirmation(value); setError(null); }}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="RESET ALICE"
          placeholderTextColor={colors.muted}
        />

        {pinLength !== null && (
          <>
            <Text style={s.inputLabel}>ENTER YOUR {pinLength}-DIGIT PIN</Text>
            <PinInput
              value={pin}
              onChange={setPin}
              onInput={() => setError(null)}
              length={pinLength}
              containerStyle={s.pinInputWrap}
              inputStyle={s.pinInput}
            />
          </>
        )}

        {error && <Text style={[s.error, { color: colors.danger }]}>{error}</Text>}

        <TouchableOpacity style={[s.resetBtn, (!ready || resetting) && s.disabled]} onPress={() => void requestReset()} disabled={!ready || resetting}>
          <Text style={s.resetText}>{resetting ? 'RESETTING...' : 'PERMANENTLY RESET WALLET'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.cancelBtn} onPress={() => router.back()} disabled={resetting}>
          <Text style={s.cancelText}>CANCEL</Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={risk !== null} transparent animationType="fade" onRequestClose={() => setRisk(null)}>
        <View style={s.modalBackdrop}>
          <View style={[s.modal, { borderColor: colors.danger }]}>
            <Text style={[s.modalTitle, { color: colors.danger }]}>FINAL RESET CHECK</Text>
            {risk && risk.unsafeSwapCount > 0 ? (
              <Text style={s.modalBody}>
                Alice found {risk.unsafeSwapCount} swap payment{risk.unsafeSwapCount === 1 ? '' : 's'} still pending or refundable. Reset is blocked to preserve the local recovery data for {risk.unsafeSwapCount === 1 ? 'that swap' : 'those swaps'}.
              </Text>
            ) : (
              <Text style={s.modalBody}>
                This will delete Alice wallet data from this device and return you to the initial setup screen.
              </Text>
            )}
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => setRisk(null)} disabled={resetting}>
                <Text style={s.modalCancelText}>CANCEL</Text>
              </TouchableOpacity>
              {risk && risk.unsafeSwapCount > 0 ? (
                <TouchableOpacity style={[s.modalResetBtn, { backgroundColor: colors.danger, borderColor: colors.dangerInk }]} onPress={() => router.replace('/history')}>
                  <Text style={s.modalResetText}>VIEW HISTORY</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[s.modalResetBtn, resetting && s.disabled]} onPress={() => void resetWallet()} disabled={resetting}>
                  <Text style={s.modalResetText}>YES, RESET</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    kav: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    backBtn: { ...pixel, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg },
    backIcon: { fontFamily: typography.pixel, fontSize: 18, color: colors.primary },
    headerTitle: { fontFamily: typography.pixel, fontSize: 12, color: '#c84f4f', letterSpacing: 2 },
    body: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxxl },
    warning: { fontFamily: typography.pixel, fontSize: 12, lineHeight: 20, color: '#c84f4f', letterSpacing: 2, textAlign: 'center' },
    description: { maxWidth: 520, marginTop: spacing.lg, fontFamily: typography.numbers, fontSize: 16, lineHeight: 23, color: colors.muted, textAlign: 'center' },
    lossCard: { ...pixel, width: '100%', maxWidth: 520, marginTop: spacing.xl, padding: spacing.lg, backgroundColor: colors.cardBg, borderColor: '#e06060' },
    lossTitle: { marginBottom: spacing.md, fontFamily: typography.pixel, fontSize: 12, color: '#c84f4f', letterSpacing: 1 },
    lossItem: { marginTop: spacing.sm, fontFamily: typography.numbers, fontSize: 15, lineHeight: 21, color: colors.primaryDark },
    recoveryWarning: { maxWidth: 520, marginTop: spacing.xl, fontFamily: typography.numbers, fontSize: 16, lineHeight: 23, color: '#c84f4f', textAlign: 'center' },
    swapWarning: { maxWidth: 520, marginTop: spacing.lg, fontFamily: typography.numbers, fontSize: 15, lineHeight: 21, color: colors.muted, textAlign: 'center' },
    checkRow: { width: '100%', maxWidth: 520, marginTop: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    checkbox: { ...pixel, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg },
    checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primaryDark },
    checkmark: { fontFamily: typography.pixel, fontSize: 12, color: colors.onPrimary },
    checkText: { flex: 1, fontFamily: typography.numbers, fontSize: 15, lineHeight: 21, color: colors.primaryDark },
    inputLabel: { width: '100%', maxWidth: 420, marginTop: spacing.xl, fontFamily: typography.pixel, fontSize: 12, lineHeight: 15, color: colors.muted, letterSpacing: 1 },
    input: { ...pixel, width: '100%', maxWidth: 420, height: 58, marginTop: spacing.sm, paddingVertical: 0, paddingHorizontal: spacing.lg, backgroundColor: colors.cardBg, fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: true },
    pinInputWrap: { maxWidth: 420, marginTop: spacing.sm },
    pinInput: { fontSize: 16, letterSpacing: 8 },
    resetBtn: { ...pixel, width: '100%', maxWidth: 420, marginTop: spacing.xxl, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: '#c84f4f', borderColor: '#8f3030' },
    resetText: { fontFamily: typography.pixel, fontSize: 12, color: '#ffffff', letterSpacing: 1 },
    cancelBtn: { marginTop: spacing.lg, padding: spacing.md },
    cancelText: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 1 },
    error: { maxWidth: 520, marginTop: spacing.lg, fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: '#e06060', textAlign: 'center' },
    disabled: { opacity: 0.35 },
    modalBackdrop: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)' },
    modal: { ...pixel, width: '100%', maxWidth: 460, padding: spacing.xl, backgroundColor: colors.cardBg, borderColor: '#c84f4f' },
    modalTitle: { fontFamily: typography.pixel, fontSize: 12, lineHeight: 18, color: '#c84f4f', letterSpacing: 1, textAlign: 'center' },
    modalBody: { marginTop: spacing.lg, fontFamily: typography.numbers, fontSize: 16, lineHeight: 23, color: colors.primaryDark, textAlign: 'center' },
    modalActions: { marginTop: spacing.xl, gap: spacing.md },
    modalCancelBtn: { ...pixel, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: colors.background },
    modalCancelText: { fontFamily: typography.pixel, fontSize: 12, color: colors.muted, letterSpacing: 1 },
    modalResetBtn: { ...pixel, paddingVertical: spacing.lg, alignItems: 'center', backgroundColor: '#c84f4f', borderColor: '#8f3030' },
    modalResetText: { fontFamily: typography.pixel, fontSize: 12, color: '#ffffff', letterSpacing: 1 },
  });
}
