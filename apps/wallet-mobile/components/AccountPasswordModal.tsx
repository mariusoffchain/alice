import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAccount, type UsernameSuggestion } from '@alice-wallet/alice-ai';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';

type Mode = 'create' | 'signin';
type Flow = 'form' | 'verify-email' | 'choose-username';

export function AccountPasswordModal() {
  const account = useAccount();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [mode, setMode] = useState<Mode>('create');
  const [flow, setFlow] = useState<Flow>('form');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suggestions, setSuggestions] = useState<UsernameSuggestion[]>([]);
  const [selectedUsername, setSelectedUsername] = useState<UsernameSuggestion | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (account.signInOpen) return;
    setMode('create');
    setFlow('form');
    setBusy(false);
    setEmail('');
    setCode('');
    setIdentifier('');
    setPassword('');
    setPrefix('');
    setSuggestions([]);
    setSelectedUsername(null);
    setConfirmDelete(false);
  }, [account.signInOpen]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    account.clearError();
    try {
      await action();
    } catch {
      // AccountContext exposes the cleaned user-facing error.
    } finally {
      setBusy(false);
    }
  };

  const fetchSuggestions = () => void run(async () => {
    const next = await account.suggestUsernames(prefix, prefix);
    setSuggestions(next);
    setSelectedUsername(next[0] ?? null);
  });

  return (
    <Modal
      visible={account.signInOpen}
      transparent
      animationType="fade"
      onRequestClose={account.dismissSignIn}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.backdrop}>
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={s.dialog}>
            <View style={s.header}>
              <View style={s.headerCopy}>
                <Text style={s.title}>{account.status === 'signed_in' ? 'ALICE ACCOUNT' : 'CREATE ACCOUNT'}</Text>
                <Text style={s.description}>
                  {account.status === 'signed_in'
                    ? 'Your Alice account is separate from your wallet and recovery phrase.'
                    : account.cloudQuota
                      ? `${account.cloudQuota.remaining} of your ${account.cloudQuota.limit} free `
                        + 'Private Cloud requests are left. They work without an account.'
                      : 'Your 21 free Private Cloud requests also work without an account.'}
                </Text>
              </View>
              <TouchableOpacity onPress={account.dismissSignIn} style={s.close} accessibilityLabel="Close account">
                <Text style={s.closeText}>×</Text>
              </TouchableOpacity>
            </View>

            {account.status === 'signed_in' && account.account && flow !== 'choose-username' ? (
              <View style={s.content}>
                <AccountRow label="USERNAME" value={account.account.username ?? 'NOT SET'} />
                <AccountRow label="EMAIL" value={account.account.email_masked ?? 'NOT LINKED'} />
                <AccountRow label="PRIVATE CLOUD" value={`${account.account.cloud_requests_remaining} / ${account.account.cloud_requests_limit}`} />
                {confirmDelete ? (
                  <>
                    <Text style={s.warning}>Delete this Alice account? Your local chats and wallet remain on this device.</Text>
                    <View style={s.buttonRow}>
                      <ActionButton label="CANCEL" onPress={() => setConfirmDelete(false)} disabled={busy} secondary />
                      <ActionButton label="DELETE" onPress={() => void run(account.deleteAccount)} disabled={busy} danger />
                    </View>
                  </>
                ) : (
                  <View style={s.buttonRow}>
                    <ActionButton label="SIGN OUT" onPress={() => void run(account.logout)} disabled={busy} secondary />
                    <ActionButton label="DELETE ACCOUNT" onPress={() => setConfirmDelete(true)} disabled={busy} secondary />
                  </View>
                )}
              </View>
            ) : flow === 'choose-username' ? (
              <View style={s.content}>
                <Text style={s.label}>USERNAME</Text>
                <TextInput
                  value={prefix}
                  onChangeText={value => {
                    setPrefix(value);
                    setSuggestions([]);
                    setSelectedUsername(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Your name or pseudonym"
                  placeholderTextColor={colors.muted}
                  style={s.input}
                />
                <ActionButton
                  label={suggestions.length ? 'SHUFFLE USERNAME' : 'CHOOSE USERNAME'}
                  onPress={fetchSuggestions}
                  disabled={busy || !prefix.trim()}
                  secondary
                />
                {suggestions.map(suggestion => (
                  <TouchableOpacity
                    key={suggestion.username}
                    onPress={() => setSelectedUsername(suggestion)}
                    style={[s.usernameChoice, selectedUsername?.username === suggestion.username && s.usernameChoiceActive]}
                  >
                    <Text style={[s.usernameChoiceText, selectedUsername?.username === suggestion.username && s.usernameChoiceTextActive]}>
                      {suggestion.username}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  placeholder="Password, 15+ characters"
                  placeholderTextColor={colors.muted}
                  style={s.input}
                />
                <ActionButton
                  label="CREATE ACCOUNT"
                  disabled={busy || !selectedUsername || password.length < 15}
                  onPress={() => void run(async () => {
                    if (!selectedUsername) return;
                    await account.updatePassword(password, {
                      prefix: selectedUsername.prefix,
                      suffix: selectedUsername.suffix,
                      username: selectedUsername.username,
                      display_name: selectedUsername.prefix,
                    });
                    account.dismissSignIn();
                  })}
                />
              </View>
            ) : flow === 'verify-email' ? (
              <View style={s.content}>
                <Text style={s.label}>VERIFICATION CODE SENT TO {account.pendingEmail.toUpperCase()}</Text>
                <TextInput
                  value={code}
                  onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  placeholderTextColor={colors.muted}
                  style={s.input}
                />
                <ActionButton
                  label="VERIFY EMAIL"
                  disabled={busy || code.length !== 6}
                  onPress={() => void run(async () => {
                    await account.verifyEmailSignup(code);
                    setFlow('choose-username');
                  })}
                />
              </View>
            ) : (
              <View style={s.content}>
                <View style={s.buttonRow}>
                  <ActionButton label="CREATE" onPress={() => setMode('create')} disabled={busy} active={mode === 'create'} secondary={mode !== 'create'} />
                  <ActionButton label="SIGN IN" onPress={() => setMode('signin')} disabled={busy} active={mode === 'signin'} secondary={mode !== 'signin'} />
                </View>
                {mode === 'create' ? (
                  <>
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      placeholder="you@example.com"
                      placeholderTextColor={colors.muted}
                      style={s.input}
                    />
                    <ActionButton
                      label="CONTINUE WITH EMAIL"
                      disabled={busy || !email.trim()}
                      onPress={() => void run(async () => {
                        await account.startEmailSignup(email);
                        setFlow('verify-email');
                      })}
                    />
                  </>
                ) : (
                  <>
                    <TextInput
                      value={identifier}
                      onChangeText={setIdentifier}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="username"
                      placeholder="Email or username"
                      placeholderTextColor={colors.muted}
                      style={s.input}
                    />
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoComplete="current-password"
                      placeholder="Password"
                      placeholderTextColor={colors.muted}
                      style={s.input}
                    />
                    <ActionButton
                      label="SIGN IN"
                      disabled={busy || !identifier.trim() || password.length < 15}
                      onPress={() => void run(() => account.signInWithPassword(identifier, password))}
                    />
                  </>
                )}
                <TouchableOpacity onPress={account.dismissSignIn} disabled={busy} style={s.textLink}>
                  <Text style={s.textLinkText}>CONTINUE WITHOUT AN ACCOUNT</Text>
                </TouchableOpacity>
              </View>
            )}

            {account.error ? <Text style={s.error}>{account.error}</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm }}>
      <Text style={{ fontFamily: typography.pixel, fontSize: 7, color: colors.muted }}>{label}</Text>
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontFamily: typography.numbers, fontSize: 16, color: colors.primaryDark }}>{value}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  secondary = false,
  danger = false,
  active = true,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  secondary?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  const { colors, pixel } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, pixel, {
        backgroundColor: secondary ? colors.cardBg : colors.primary,
        borderColor: danger ? '#df6060' : colors.border,
        opacity: disabled || !active ? 0.48 : 1,
      }]}
    >
      <Text style={[styles.buttonText, { color: danger ? '#df6060' : secondary ? colors.primaryDark : colors.onPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
    scrollContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
    dialog: { ...pixel, backgroundColor: colors.background, borderColor: colors.border, padding: spacing.lg },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    headerCopy: { flex: 1 },
    title: { fontFamily: typography.pixel, fontSize: 10, lineHeight: 18, color: colors.primaryDark },
    description: { fontFamily: typography.numbers, fontSize: 16, lineHeight: 21, color: colors.muted, marginTop: spacing.sm },
    close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    closeText: { fontFamily: typography.numbers, fontSize: 26, lineHeight: 28, color: colors.muted },
    content: { marginTop: spacing.lg, gap: spacing.sm },
    label: { fontFamily: typography.pixel, fontSize: 7, lineHeight: 15, color: colors.muted },
    input: { ...pixel, minHeight: 46, borderColor: colors.border, color: colors.primaryDark, fontFamily: typography.numbers, fontSize: 17, paddingHorizontal: spacing.md },
    buttonRow: { flexDirection: 'row', gap: spacing.sm },
    usernameChoice: { ...pixel, minHeight: 42, justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.cardBg, borderColor: colors.border },
    usernameChoiceActive: { backgroundColor: colors.primary, borderColor: colors.primaryDark },
    usernameChoiceText: { fontFamily: typography.numbers, fontSize: 16, color: colors.primaryDark },
    usernameChoiceTextActive: { color: colors.onPrimary },
    warning: { fontFamily: typography.numbers, fontSize: 16, lineHeight: 21, color: colors.primaryDark, marginTop: spacing.md },
    textLink: { paddingVertical: spacing.sm, alignItems: 'center' },
    textLinkText: { fontFamily: typography.numbers, fontSize: 14, color: colors.muted },
    error: { fontFamily: typography.numbers, fontSize: 15, lineHeight: 20, color: '#df6060', marginTop: spacing.md },
  });
}

const styles = StyleSheet.create({
  button: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 2, paddingHorizontal: spacing.md },
  buttonText: { fontFamily: typography.pixel, fontSize: 7, letterSpacing: 0 },
});
