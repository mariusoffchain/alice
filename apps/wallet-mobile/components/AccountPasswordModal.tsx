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
import { useAccount } from '@alice-wallet/alice-ai';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';

type Mode = 'create' | 'signin';
type Flow = 'form' | 'verify-email' | 'choose-username' | 'change-username';

/** Three rows of the middle-word list. Enough to browse, short enough to fit. */
const SUFFIX_LIST_HEIGHT = 132;

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The password is the door and the emailed code is the locksmith. Every
  // sign-in asks for the password; the code path exists to choose a new one
  // when the old is lost, and the server holds that line too: a bare code is
  // refused for any account that has a password.
  const [usePassword, setUsePassword] = useState(true);
  const [resetPassword, setResetPassword] = useState('');

  // The parts of a username, fetched when the screen opens and not when a name
  // is typed. The middle words and the number exist first; the name is the
  // only part the person supplies.
  const [suffixes, setSuffixes] = useState<string[]>([]);
  const [digits, setDigits] = useState<string | null>(null);
  const [suffix, setSuffix] = useState<string | null>(null);
  const [suffixOpen, setSuffixOpen] = useState(false);

  const usernameFlow = flow === 'choose-username' || flow === 'change-username';
  useEffect(() => {
    if (!usernameFlow || digits) return;
    let cancelled = false;
    void account.usernameVocabulary()
      .then(vocabulary => {
        if (cancelled || vocabulary.suffixes.length === 0) return;
        setSuffixes(vocabulary.suffixes);
        setDigits(vocabulary.discriminator);
        // A random word rather than the first: the default is a suggestion,
        // not a ranking.
        setSuffix(vocabulary.suffixes[Math.floor(Math.random() * vocabulary.suffixes.length)]);
      })
      .catch(() => { /* the row stays empty and the submit stays disabled */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usernameFlow, digits]);

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
    setConfirmDelete(false);
    setSuffixOpen(false);
    // Closing has to put the sign-in form back on the password, or one visit
    // to the reset leaves every later visit opening on it.
    setUsePassword(true);
    setResetPassword('');
    // The number belongs to the screen, so closing it lets the next one draw
    // its own.
    setDigits(null);
    setSuffixes([]);
    setSuffix(null);
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

  // Derived, never stored: three parts that each have one owner, assembled
  // only when all three exist.
  const chosenUsername = digits && suffix && prefix.trim()
    ? { username: `${prefix.trim()}.${suffix}#${digits}`, prefix: prefix.trim(), suffix }
    : null;

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
                    : account.signInReason === 'purchase'
                      // Telling someone their free requests need no account,
                      // right after they asked to buy a plan, answers a
                      // question they did not ask and contradicts the one they did.
                      ? 'A paid plan needs an account so it can follow you to another device.'
                      : account.cloudUsage?.kind === 'free'
                        ? `${account.cloudUsage.remaining} of your ${account.cloudUsage.limit} free `
                          + 'Private Cloud requests are left. They work without an account.'
                        : 'Your 21 free Private Cloud requests also work without an account.'}
                </Text>
              </View>
              <TouchableOpacity onPress={account.dismissSignIn} style={s.close} accessibilityLabel="Close account">
                <Text style={s.closeText}>×</Text>
              </TouchableOpacity>
            </View>

            {account.status === 'signed_in' && account.account && !usernameFlow ? (
              <View style={s.content}>
                <AccountRow label="USERNAME" value={account.account.username ?? 'NOT SET'} />
                <AccountRow label="EMAIL" value={account.account.email_masked ?? 'NOT LINKED'} />
                <AccountRow
                  label="PLAN"
                  value={account.cloudUsage?.kind === 'paid' ? 'PRIVATE CLOUD' : 'FREE'}
                />
                {/* Paid plans are metered in bytes server-side, so the exact
                    request counter only exists on the free plan. */}
                <AccountRow
                  label={account.cloudUsage?.kind === 'paid' ? 'ALLOWANCE USED' : 'FREE REQUESTS'}
                  value={account.cloudUsage?.kind === 'paid'
                    ? `${account.cloudUsage.percentUsed}%`
                    : `${account.account.cloud_requests_remaining} / ${account.account.cloud_requests_limit}`}
                />
                {confirmDelete ? (
                  <>
                    <Text style={s.warning}>Delete this Alice account? Your local chats and wallet remain on this device.</Text>
                    <View style={s.buttonRow}>
                      <ActionButton label="CANCEL" onPress={() => setConfirmDelete(false)} disabled={busy} secondary />
                      <ActionButton label="DELETE" onPress={() => void run(account.deleteAccount)} disabled={busy} danger />
                    </View>
                  </>
                ) : (
                  <>
                    <ActionButton
                      label="CHANGE USERNAME"
                      onPress={() => {
                        account.clearError();
                        setPrefix('');
                        setDigits(null);
                        setSuffixes([]);
                        setSuffix(null);
                        setFlow('change-username');
                      }}
                      disabled={busy}
                      secondary
                    />
                    <View style={s.buttonRow}>
                      <ActionButton label="SIGN OUT" onPress={() => void run(account.logout)} disabled={busy} secondary />
                      <ActionButton label="DELETE ACCOUNT" onPress={() => setConfirmDelete(true)} disabled={busy} secondary />
                    </View>
                  </>
                )}
              </View>
            ) : usernameFlow ? (
              <View style={s.content}>
                <Text style={s.label}>USERNAME</Text>
                {/* The username, laid out as it reads, left to right: the name
                    that was typed, the middle word to pick from a list, and
                    the number, already decided, that never moves. */}
                <View style={s.usernameRow}>
                  <TextInput
                    value={prefix}
                    onChangeText={setPrefix}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Your name"
                    placeholderTextColor={colors.muted}
                    style={[s.input, s.usernameName]}
                  />
                  <Text style={s.usernameDot}>.</Text>
                  <TouchableOpacity
                    onPress={() => setSuffixOpen(open => !open)}
                    disabled={busy || suffixes.length === 0}
                    accessibilityLabel="Middle word"
                    style={[s.input, s.usernameSuffix]}
                  >
                    <Text numberOfLines={1} style={s.usernameSuffixText}>{suffix ?? '...'}</Text>
                    <Text style={s.usernameCaret}>{suffixOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  <Text style={s.usernameHash}>#</Text>
                  <Text
                    accessibilityLabel="Your number, already assigned"
                    style={s.usernameDigits}
                  >
                    {digits ?? '...'}
                  </Text>
                </View>
                {suffixOpen ? (
                  <ScrollView style={s.suffixList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {suffixes.map(option => (
                      <TouchableOpacity
                        key={option}
                        onPress={() => { setSuffix(option); setSuffixOpen(false); }}
                        style={[s.suffixOption, option === suffix && s.suffixOptionActive]}
                      >
                        <Text style={[s.suffixOptionText, option === suffix && s.suffixOptionTextActive]}>
                          {option}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : null}
                {chosenUsername ? (
                  <Text style={s.usernamePreview}>Your username: {chosenUsername.username}</Text>
                ) : null}
                {flow === 'choose-username' ? (
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoComplete="new-password"
                    placeholder="Password, 15+ characters"
                    placeholderTextColor={colors.muted}
                    style={s.input}
                  />
                ) : (
                  <Text style={s.warning}>A username can be changed once every 30 days.</Text>
                )}
                <ActionButton
                  label={flow === 'change-username' ? 'SAVE USERNAME' : 'CREATE ACCOUNT'}
                  disabled={busy || !chosenUsername || (flow === 'choose-username' && password.length < 15)}
                  onPress={() => void run(async () => {
                    if (!chosenUsername) return;
                    if (flow === 'change-username') {
                      await account.updateProfile({
                        prefix: chosenUsername.prefix,
                        suffix: chosenUsername.suffix,
                        username: chosenUsername.username,
                      });
                    } else {
                      await account.updatePassword(password, {
                        prefix: chosenUsername.prefix,
                        suffix: chosenUsername.suffix,
                        username: chosenUsername.username,
                        display_name: chosenUsername.prefix,
                      });
                    }
                    account.dismissSignIn();
                  })}
                />
                {flow === 'change-username' ? (
                  <ActionButton label="CANCEL" onPress={() => setFlow('form')} disabled={busy} secondary />
                ) : null}
              </View>
            ) : flow === 'verify-email' ? (
              <View style={s.content}>
                <Text style={s.label}>
                  {mode === 'signin' ? 'RESET CODE SENT TO ' : 'VERIFICATION CODE SENT TO '}
                  {account.pendingEmail.toUpperCase()}
                </Text>
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
                {mode === 'signin' ? (
                  <TextInput
                    value={resetPassword}
                    onChangeText={setResetPassword}
                    secureTextEntry
                    autoComplete="new-password"
                    placeholder="New password, 15+ characters"
                    placeholderTextColor={colors.muted}
                    style={s.input}
                  />
                ) : null}
                <ActionButton
                  label={mode === 'signin' ? 'RESET AND SIGN IN' : 'VERIFY EMAIL'}
                  disabled={busy || code.length !== 6 || (mode === 'signin' && resetPassword.length < 15)}
                  onPress={() => void run(async () => {
                    // Two different promises ride the same six digits: joining
                    // an address to the account being created, or resetting the
                    // way into an existing one. The reset carries its new
                    // password in the same request, because the server refuses
                    // a bare code for any account that has one.
                    if (mode === 'signin') {
                      await account.verifyCode(code, resetPassword);
                      return;
                    }
                    await account.verifyEmailSignup(code);
                    setFlow('choose-username');
                  })}
                />
              </View>
            ) : (
              <View style={s.content}>
                <View style={s.buttonRow}>
                  <ActionButton label="CREATE" onPress={() => setMode('create')} disabled={busy} active={mode === 'create'} secondary={mode !== 'create'} />
                  <ActionButton
                    label="SIGN IN"
                    onPress={() => {
                      setMode('signin');
                      // Sign in means the password. Reaching the reset is a
                      // deliberate second tap, every time.
                      setUsePassword(true);
                      account.clearError();
                    }}
                    disabled={busy}
                    active={mode === 'signin'}
                    secondary={mode !== 'signin'}
                  />
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
                ) : usePassword ? (
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
                    <ActionButton
                      label="FORGOT PASSWORD? RESET BY EMAIL"
                      onPress={() => { setUsePassword(false); account.clearError(); }}
                      disabled={busy}
                      secondary
                    />
                  </>
                ) : (
                  <>
                    {/* The reset, and the only door for an account created
                        with an email and never given a password: this screen
                        used to offer nothing but the password, and CREATE
                        answers that the address is already linked. */}
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
                      label="EMAIL ME A RESET CODE"
                      disabled={busy || !email.trim()}
                      onPress={() => void run(async () => {
                        await account.sendCode(email);
                        setFlow('verify-email');
                      })}
                    />
                    <ActionButton
                      label="BACK TO PASSWORD"
                      onPress={() => { setUsePassword(true); account.clearError(); }}
                      disabled={busy}
                      secondary
                    />
                  </>
                )}
                <TouchableOpacity onPress={account.dismissSignIn} disabled={busy} style={s.textLink}>
                  <Text style={s.textLinkText}>
                    {account.signInReason === 'purchase' ? 'CANCEL' : 'CONTINUE WITHOUT AN ACCOUNT'}
                  </Text>
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
      <Text style={{ fontFamily: typography.pixel, fontSize: 12, color: colors.muted }}>{label}</Text>
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
        borderColor: danger ? colors.danger : colors.border,
        opacity: disabled || !active ? 0.48 : 1,
      }]}
    >
      <Text style={[styles.buttonText, { color: danger ? colors.danger : secondary ? colors.primaryDark : colors.onPrimary }]}>{label}</Text>
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
    title: { fontFamily: typography.pixel, fontSize: 12, lineHeight: 18, color: colors.primaryDark },
    description: { fontFamily: typography.numbers, fontSize: 16, lineHeight: 21, color: colors.muted, marginTop: spacing.sm },
    close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    closeText: { fontFamily: typography.numbers, fontSize: 26, lineHeight: 28, color: colors.muted },
    content: { marginTop: spacing.lg, gap: spacing.sm },
    label: { fontFamily: typography.pixel, fontSize: 12, lineHeight: 15, color: colors.muted },
    input: { ...pixel, minHeight: 46, borderColor: colors.border, color: colors.primaryDark, fontFamily: typography.numbers, fontSize: 17, paddingHorizontal: spacing.md },
    buttonRow: { flexDirection: 'row', gap: spacing.sm },
    usernameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    usernameName: { flex: 1, minWidth: 0 },
    usernameDot: { fontFamily: typography.numbers, fontSize: 18, color: colors.muted },
    usernameSuffix: { width: 130, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardBg },
    usernameSuffixText: { flex: 1, fontFamily: typography.numbers, fontSize: 16, color: colors.primaryDark },
    usernameCaret: { fontFamily: typography.numbers, fontSize: 11, color: colors.muted, marginLeft: spacing.xs },
    usernameHash: { fontFamily: typography.numbers, fontSize: 18, color: colors.muted },
    usernameDigits: { fontFamily: typography.numbers, fontSize: 17, color: colors.muted },
    suffixList: { ...pixel, maxHeight: SUFFIX_LIST_HEIGHT, borderColor: colors.border, backgroundColor: colors.cardBg },
    suffixOption: { minHeight: 42, justifyContent: 'center', paddingHorizontal: spacing.md },
    suffixOptionActive: { backgroundColor: colors.primary },
    suffixOptionText: { fontFamily: typography.numbers, fontSize: 16, color: colors.primaryDark },
    suffixOptionTextActive: { color: colors.onPrimary },
    usernamePreview: { fontFamily: typography.numbers, fontSize: 15, color: colors.muted },
    warning: { fontFamily: typography.numbers, fontSize: 16, lineHeight: 21, color: colors.primaryDark, marginTop: spacing.md },
    textLink: { paddingVertical: spacing.sm, alignItems: 'center' },
    textLinkText: { fontFamily: typography.numbers, fontSize: 14, color: colors.muted },
    error: { fontFamily: typography.numbers, fontSize: 15, lineHeight: 20, color: '#df6060', marginTop: spacing.md },
  });
}

const styles = StyleSheet.create({
  button: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 2, paddingHorizontal: spacing.md },
  buttonText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 0 },
});
