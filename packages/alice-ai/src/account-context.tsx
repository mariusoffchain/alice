import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AliceAccountError,
  type AliceAccount,
  clearAccountSession,
  ensureAnonymousAccountSession,
  getAccount,
  loginWithPassword,
  loadAccountSession,
  logoutAccount,
  revokeAccountIdentity,
  requestAccountDeletion,
  redeemPromoCode,
  registerWithPassword,
  setPassword,
  updateAccountProfile,
  startEmailIdentityLink,
  startEmailLogin,
  verifyEmailIdentityLink,
  verifyEmailLogin,
  suggestAccountUsernames,
  type UsernameSuggestion,
} from './account-client';

type AccountStatus = 'loading' | 'signed_out' | 'signed_in';

/**
 * The free Private Cloud allowance, whether or not there is an account.
 *
 * `account` is deliberately null while anonymous — surfaces read it as "am I
 * signed in?" — but the allowance exists from the first launch and is the one
 * number a user needs to see. Without it the 22nd request is refused with no
 * warning, and the people affected are exactly those using Alice the way it is
 * meant to be tried: without an account.
 */
export type AliceCloudQuota = { remaining: number; limit: number };

type AccountContextValue = {
  status: AccountStatus;
  account: AliceAccount | null;
  cloudQuota: AliceCloudQuota | null;
  signInOpen: boolean;
  pendingEmail: string;
  resendSeconds: number;
  error: string | null;
  requestSignIn: () => void;
  dismissSignIn: () => void;
  sendCode: (email: string) => Promise<void>;
  startEmailSignup: (email: string) => Promise<void>;
  changeEmail: () => void;
  verifyCode: (code: string) => Promise<void>;
  verifyEmailSignup: (code: string) => Promise<void>;
  signInWithPassword: (identifier: string, password: string) => Promise<void>;
  createWithPassword: (input: {
    prefix: string;
    suffix: string;
    username?: string;
    display_name?: string;
    password: string;
  }) => Promise<void>;
  suggestUsernames: (
    prefix: string,
    displayName?: string,
  ) => Promise<UsernameSuggestion[]>;
  updatePassword: (
    password: string,
    profile?: { display_name?: string; prefix?: string; suffix?: string; username?: string },
  ) => Promise<void>;
  updateProfile: (input: {
    display_name?: string;
    prefix?: string;
    suffix?: string;
    username?: string;
  }) => Promise<void>;
  removeIdentity: (identityId: string) => Promise<void>;
  redeemPromo: (code: string) => Promise<void>;
  addEmail: (email: string) => Promise<void>;
  confirmEmailLink: (email: string, code: string) => Promise<void>;
  refreshAccount: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

function messageFor(error: unknown): string {
  if (error instanceof AliceAccountError) {
    if (error.code === 'rate_limited') return 'Too many attempts. Try again later.';
    if (error.code === 'invalid_code') return 'That code is invalid or expired.';
    if (error.code === 'network') return 'Network error. Check your connection and try again.';
    return error.message;
  }
  return 'Alice could not complete this account request.';
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus>('loading');
  const [account, setAccount] = useState<AliceAccount | null>(null);
  const [anonymousQuota, setAnonymousQuota] = useState<AliceCloudQuota | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => {
      setResendSeconds(seconds => Math.max(0, seconds - 1));
    }, 1_000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  const refreshAccount = useCallback(async () => {
    try {
      const next = await getAccount();
      if (next.is_anonymous) {
        // Keep the allowance even though the account itself is discarded: it
        // is the only place an anonymous user can learn it.
        setAnonymousQuota({
          remaining: next.cloud_requests_remaining,
          limit: next.cloud_requests_limit,
        });
        setAccount(null);
        setStatus('signed_out');
        return;
      }
      setAccount(next);
      setStatus('signed_in');
    } catch (cause) {
      if (cause instanceof AliceAccountError && (
        cause.code === 'account_required'
        || cause.code === 'session_expired'
        || cause.code === 'invalid_refresh_token'
      )) {
        await clearAccountSession();
        setAccount(null);
        setStatus('signed_out');
        return;
      }
      throw cause;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAccountSession()
      .then(async session => {
        if (cancelled) return;
        if (!session) {
          setStatus('signed_out');
          return;
        }
        await refreshAccount();
      })
      .catch(() => {
        if (!cancelled) setStatus('signed_out');
      });
    return () => { cancelled = true; };
  }, [refreshAccount]);

  const requestSignIn = useCallback(() => {
    setError(null);
    setSignInOpen(true);
  }, []);

  const dismissSignIn = useCallback(() => {
    setError(null);
    setSignInOpen(false);
  }, [status]);

  const sendCode = useCallback(async (email: string) => {
    setError(null);
    try {
      const result = await startEmailLogin(email);
      setPendingEmail(email.trim());
      setResendSeconds(result.retry_after_seconds);
    } catch (cause) {
      setError(messageFor(cause));
      throw cause;
    }
  }, []);

  const startEmailSignup = useCallback(async (email: string) => {
    setError(null);
    try {
      await ensureAnonymousAccountSession();
      const result = await startEmailIdentityLink(email);
      setPendingEmail(email.trim());
      setResendSeconds(result.retry_after_seconds);
    } catch (cause) {
      setError(messageFor(cause));
      throw cause;
    }
  }, []);

  const changeEmail = useCallback(() => {
    setError(null);
    setPendingEmail('');
    setResendSeconds(0);
  }, []);

  const verifyCode = useCallback(async (code: string) => {
    setError(null);
    try {
      const result = await verifyEmailLogin(pendingEmail, code);
      setAccount(result.account);
      setStatus('signed_in');
      setSignInOpen(false);
      setPendingEmail('');
      setResendSeconds(0);
    } catch (cause) {
      setError(messageFor(cause));
      throw cause;
    }
  }, [pendingEmail]);

  const verifyEmailSignup = useCallback(async (code: string) => {
    setError(null);
    try {
      const result = await verifyEmailIdentityLink(pendingEmail, code);
      setAccount(result);
      setStatus('signed_in');
      setPendingEmail('');
      setResendSeconds(0);
    } catch (cause) {
      setError(messageFor(cause));
      throw cause;
    }
  }, [pendingEmail]);

  const acceptLogin = useCallback(async (
    login: () => Promise<{ account: AliceAccount }>,
  ) => {
    setError(null);
    try {
      const result = await login();
      setAccount(result.account);
      setStatus('signed_in');
      setSignInOpen(false);
    } catch (cause) {
      setError(messageFor(cause));
      throw cause;
    }
  }, []);

  const signInWithPassword = useCallback(
    (identifier: string, password: string) => acceptLogin(
      () => loginWithPassword(identifier, password),
    ),
    [acceptLogin],
  );
  const createWithPassword = useCallback(
    (input: {
      prefix: string;
      suffix: string;
      display_name?: string;
      password: string;
    }) => acceptLogin(() => registerWithPassword(input)),
    [acceptLogin],
  );
  const suggestUsernames = useCallback(
    async (prefix: string, displayName?: string) => (
      await suggestAccountUsernames(prefix, displayName)
    ).suggestions,
    [],
  );
  const updateSignedInAccount = useCallback(async (
    operation: () => Promise<AliceAccount>,
  ) => {
    setError(null);
    try {
      setAccount(await operation());
    } catch (cause) {
      setError(messageFor(cause));
      throw cause;
    }
  }, []);

  const updatePassword = useCallback(
    (
      password: string,
      profile?: { display_name?: string; prefix?: string; suffix?: string; username?: string },
    ) => updateSignedInAccount(() => setPassword({ password, ...profile })),
    [updateSignedInAccount],
  );
  const updateProfile = useCallback(
    (input: {
      display_name?: string;
      prefix?: string;
      suffix?: string;
      username?: string;
    }) => updateSignedInAccount(() => updateAccountProfile(input)),
    [updateSignedInAccount],
  );
  const removeIdentity = useCallback(
    (identityId: string) => updateSignedInAccount(
      () => revokeAccountIdentity(identityId),
    ),
    [updateSignedInAccount],
  );
  const redeemPromo = useCallback(
    (code: string) => updateSignedInAccount(() => redeemPromoCode(code)),
    [updateSignedInAccount],
  );
  const addEmail = useCallback(async (email: string) => {
    setError(null);
    try {
      await startEmailIdentityLink(email);
    } catch (cause) {
      setError(messageFor(cause));
      throw cause;
    }
  }, []);
  const confirmEmailLink = useCallback(
    (email: string, code: string) => updateSignedInAccount(
      () => verifyEmailIdentityLink(email, code),
    ),
    [updateSignedInAccount],
  );

  const logout = useCallback(async () => {
    await logoutAccount().catch(() => {});
    setAccount(null);
    setStatus('signed_out');
    setPendingEmail('');
    setResendSeconds(0);
    setSignInOpen(false);
  }, []);

  const deleteAccount = useCallback(async () => {
    await requestAccountDeletion();
    setAccount(null);
    setStatus('signed_out');
    setPendingEmail('');
    setResendSeconds(0);
    setSignInOpen(false);
  }, []);

  // Derived rather than stored, so every path that sets an account -- sign-in,
  // sign-up, promo redemption, profile update -- reports the right balance
  // without each having to remember to.
  const cloudQuota = useMemo<AliceCloudQuota | null>(() => (
    account
      ? { remaining: account.cloud_requests_remaining, limit: account.cloud_requests_limit }
      : anonymousQuota
  ), [account, anonymousQuota]);

  const value = useMemo<AccountContextValue>(() => ({
    status,
    account,
    cloudQuota,
    signInOpen,
    pendingEmail,
    resendSeconds,
    error,
    requestSignIn,
    dismissSignIn,
    sendCode,
    startEmailSignup,
    changeEmail,
    verifyCode,
    verifyEmailSignup,
    signInWithPassword,
    createWithPassword,
    suggestUsernames,
    updatePassword,
    updateProfile,
    removeIdentity,
    redeemPromo,
    addEmail,
    confirmEmailLink,
    refreshAccount,
    logout,
    deleteAccount,
    clearError: () => setError(null),
  }), [
    account,
    cloudQuota,
    changeEmail,
    deleteAccount,
    dismissSignIn,
    error,
    logout,
    pendingEmail,
    resendSeconds,
    refreshAccount,
    requestSignIn,
    sendCode,
    startEmailSignup,
    signInOpen,
    status,
    signInWithPassword,
    createWithPassword,
    suggestUsernames,
    updatePassword,
    updateProfile,
    removeIdentity,
    redeemPromo,
    addEmail,
    confirmEmailLink,
    verifyCode,
    verifyEmailSignup,
  ]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside AccountProvider.');
  return value;
}
