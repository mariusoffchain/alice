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
  type AliceBilling,
  type AliceCheckout,
  type AlicePaidPlan,
  clearAccountSession,
  clearPendingCheckout,
  loadPendingCheckout,
  savePendingCheckout,
  ensureAnonymousAccountSession,
  getAccount,
  getBilling,
  loginWithPassword,
  loadAccountSession,
  logoutAccount,
  revokeAccountIdentity,
  requestAccountDeletion,
  redeemPromoCode,
  setProductUpdates,
  setPassword,
  startPlanCheckout,
  updateAccountProfile,
  startEmailIdentityLink,
  startEmailLogin,
  verifyEmailIdentityLink,
  verifyEmailLogin,
  getUsernameVocabulary,
  suggestAccountUsernames,
  type UsernameSuggestion,
} from './account-client';
import {
  isCheckoutSettled,
  PENDING_CHECKOUT_TTL_MS,
  type AlicePendingCheckout,
} from './billing-checkout';

type AccountStatus = 'loading' | 'signed_out' | 'signed_in';

/**
 * What Private Cloud usage looks like right now, in whichever unit the plan
 * is actually metered in.
 *
 * The two regimes are deliberately different shapes. A free account counts
 * requests, and "18 of 21 left" is exact. A paid plan is metered in bytes of
 * encrypted traffic, so the only honest figure is a percentage, and once a
 * plan is paid the request counter disappears entirely: showing both would
 * mean showing one number that is true and one that is not.
 *
 * The free shape exists even while anonymous, `account` is null then, but the
 * allowance is real from first launch and this is the only place an anonymous
 * user can learn it. Without it the 22nd request is refused with no warning,
 * and the people affected are exactly those trying Alice the way it is meant
 * to be tried: without an account.
 */
export type AliceCloudUsage =
  | { kind: 'free'; remaining: number; limit: number }
  | {
    kind: 'paid';
    plan: AlicePaidPlan;
    /**
     * Estimated from the volume of encrypted data, because the messages are
     * end-to-end encrypted and the server cannot count tokens. Any screen
     * showing this owes the user that sentence.
     */
    percentUsed: number;
    periodEndsAt: number | null;
    expiresAt: number;
  };

/**
 * Why sign-in was opened.
 *
 * 'purchase' matters because the default copy tells people their free requests
 * work without an account and offers to continue without one. That is true,
 * and it is exactly the wrong thing to say to someone who just asked to buy a
 * plan, which does need an account to be recoverable.
 */
export type AliceSignInReason = 'default' | 'purchase';

type AccountContextValue = {
  status: AccountStatus;
  account: AliceAccount | null;
  cloudUsage: AliceCloudUsage | null;
  billing: AliceBilling | null;
  /** A started payment that has not been credited yet, if any. */
  pendingCheckout: AlicePendingCheckout | null;
  /** Set once a pending payment settles, until the surface acknowledges it. */
  checkoutSettled: boolean;
  signInOpen: boolean;
  pendingEmail: string;
  resendSeconds: number;
  error: string | null;
  requestSignIn: (reason?: AliceSignInReason) => void;
  /** Why the sign-in was opened, so surfaces can drop copy that contradicts it. */
  signInReason: AliceSignInReason;
  dismissSignIn: () => void;
  sendCode: (email: string) => Promise<void>;
  startEmailSignup: (email: string) => Promise<void>;
  changeEmail: () => void;
  verifyCode: (code: string, newPassword?: string) => Promise<void>;
  verifyEmailSignup: (code: string) => Promise<void>;
  signInWithPassword: (identifier: string, password: string) => Promise<void>;
  suggestUsernames: (
    prefix: string,
    displayName?: string,
    options?: { all?: boolean },
  ) => Promise<UsernameSuggestion[]>;
  /** The middle words and the number, fetched before a name exists. */
  usernameVocabulary: () => Promise<{ suffixes: string[]; discriminator: string }>;
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
  refreshBilling: () => Promise<void>;
  startCheckout: (plan: AlicePaidPlan, months: number) => Promise<AliceCheckout>;
  /** Stop watching a payment the user gave up on. Never cancels the invoice. */
  dismissPendingCheckout: () => Promise<void>;
  acknowledgeCheckout: () => void;
  /** Turn the occasional product mail on or off. Expiry warnings are separate. */
  chooseProductUpdates: (enabled: boolean) => Promise<void>;
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
  const [billing, setBilling] = useState<AliceBilling | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<AlicePendingCheckout | null>(null);
  const [checkoutSettled, setCheckoutSettled] = useState(false);
  const [anonymousQuota, setAnonymousQuota] = useState<{ remaining: number; limit: number } | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInReason, setSignInReason] = useState<AliceSignInReason>('default');
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

  const refreshBilling = useCallback(async () => {
    try {
      setBilling(await getBilling());
    } catch {
      // Billing is presentation, not authorisation: the server enforces every
      // quota on its own. A failed fetch keeps the last known snapshot rather
      // than degrading the whole account screen.
    }
  }, []);

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
        setBilling(null);
        setStatus('signed_out');
        return;
      }
      setAccount(next);
      setStatus('signed_in');
      // `next.plan` is what was bought, not what is in force: deciding whether
      // it still grants anything (expiry included) is the billing snapshot's
      // job, so any account that ever paid refreshes it.
      if (next.plan !== 'free') await refreshBilling();
      else setBilling(null);
    } catch (cause) {
      if (cause instanceof AliceAccountError && (
        cause.code === 'account_required'
        || cause.code === 'session_expired'
        || cause.code === 'invalid_refresh_token'
      )) {
        await clearAccountSession();
        setAccount(null);
        setBilling(null);
        setStatus('signed_out');
        return;
      }
      throw cause;
    }
  }, [refreshBilling]);

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

  // A payment started before the app was closed is still owed to the user, so
  // the watch resumes on launch rather than only within the session that
  // started it.
  useEffect(() => {
    let cancelled = false;
    loadPendingCheckout()
      .then(pending => { if (!cancelled) setPendingCheckout(pending); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /**
   * Watch a started payment until the server credits it.
   *
   * Settlement is detected by the expiry moving past what it was when checkout
   * began, which covers a first purchase and a renewal with the same test. The
   * server is the only authority here: the client never grants a plan, it just
   * stops asking once the plan it was promised has appeared.
   */
  useEffect(() => {
    if (!pendingCheckout) return;
    let cancelled = false;

    if (isCheckoutSettled(pendingCheckout, billing)) {
      void clearPendingCheckout();
      setPendingCheckout(null);
      setCheckoutSettled(true);
      return;
    }

    // An invoice the user never paid must not leave the app polling forever,
    // which on a phone means draining the battery over an abandoned checkout.
    // Giving up here is only about watching: a payment that lands afterwards
    // is still credited by the webhook and shows up on the next refresh.
    if (Date.now() - pendingCheckout.started_at > PENDING_CHECKOUT_TTL_MS) {
      void clearPendingCheckout();
      setPendingCheckout(null);
      return;
    }

    // Bitcoin confirmations arrive on their own schedule, so a slow poll that
    // keeps running beats a fast one that gives up.
    const interval = setInterval(() => {
      if (!cancelled) void refreshBilling();
    }, 5_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pendingCheckout, billing, refreshBilling]);

  const requestSignIn = useCallback((reason: AliceSignInReason = 'default') => {
    setError(null);
    setSignInReason(reason);
    setSignInOpen(true);
  }, []);

  const dismissSignIn = useCallback(() => {
    setError(null);
    setSignInOpen(false);
    setSignInReason('default');
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

  const verifyCode = useCallback(async (code: string, newPassword?: string) => {
    setError(null);
    try {
      const result = await verifyEmailLogin(pendingEmail, code, newPassword);
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
  const usernameVocabulary = useCallback(() => getUsernameVocabulary(), []);
  const suggestUsernames = useCallback(
    async (prefix: string, displayName?: string, options?: { all?: boolean }) => (
      await suggestAccountUsernames(prefix, displayName, options)
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
    setBilling(null);
    setStatus('signed_out');
    setPendingEmail('');
    setResendSeconds(0);
    setSignInOpen(false);
  }, []);

  const deleteAccount = useCallback(async () => {
    await requestAccountDeletion();
    setAccount(null);
    setBilling(null);
    setStatus('signed_out');
    setPendingEmail('');
    setResendSeconds(0);
    setSignInOpen(false);
  }, []);

  const startCheckout = useCallback(async (plan: AlicePaidPlan, months: number) => {
    // Paying needs an account that can be credited, which an anonymous
    // session already is: it holds entitlements like any other user row.
    const checkout = await startPlanCheckout(plan, months);
    const pending: AlicePendingCheckout = {
      invoice_id: checkout.invoice_id,
      plan: checkout.plan,
      months: checkout.months,
      amount_sats: checkout.amount_sats,
      started_at: Date.now(),
      previous_expires_at: billing?.plan_expires_at ?? null,
    };
    await savePendingCheckout(pending);
    setPendingCheckout(pending);
    setCheckoutSettled(false);
    return checkout;
  }, [billing]);

  const dismissPendingCheckout = useCallback(async () => {
    await clearPendingCheckout();
    setPendingCheckout(null);
  }, []);

  const acknowledgeCheckout = useCallback(() => setCheckoutSettled(false), []);

  const chooseProductUpdates = useCallback(async (enabled: boolean) => {
    setAccount(await setProductUpdates(enabled));
  }, []);

  // Derived rather than stored, so every path that sets an account -- sign-in,
  // sign-up, promo redemption, profile update -- reports the right balance
  // without each having to remember to.
  //
  // A live paid plan wins; everything else (free, anonymous, expired) falls
  // back to the request counter, which is exact for those accounts.
  const cloudUsage = useMemo<AliceCloudUsage | null>(() => {
    if (billing && billing.plan !== 'free' && billing.plan_expires_at !== null) {
      return {
        kind: 'paid',
        plan: billing.plan,
        percentUsed: billing.usage_percent ?? 0,
        periodEndsAt: billing.period_ends_at,
        expiresAt: billing.plan_expires_at,
      };
    }
    if (account) {
      return {
        kind: 'free',
        remaining: account.cloud_requests_remaining,
        limit: account.cloud_requests_limit,
      };
    }
    return anonymousQuota ? { kind: 'free', ...anonymousQuota } : null;
  }, [billing, account, anonymousQuota]);

  const value = useMemo<AccountContextValue>(() => ({
    status,
    account,
    cloudUsage,
    billing,
    pendingCheckout,
    checkoutSettled,
    signInOpen,
    signInReason,
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
    suggestUsernames,
    usernameVocabulary,
    updatePassword,
    updateProfile,
    removeIdentity,
    redeemPromo,
    addEmail,
    confirmEmailLink,
    refreshAccount,
    refreshBilling,
    startCheckout,
    dismissPendingCheckout,
    acknowledgeCheckout,
    chooseProductUpdates,
    logout,
    deleteAccount,
    clearError: () => setError(null),
  }), [
    account,
    billing,
    pendingCheckout,
    checkoutSettled,
    cloudUsage,
    changeEmail,
    deleteAccount,
    dismissSignIn,
    error,
    logout,
    pendingEmail,
    resendSeconds,
    refreshAccount,
    refreshBilling,
    startCheckout,
    dismissPendingCheckout,
    acknowledgeCheckout,
    chooseProductUpdates,
    requestSignIn,
    sendCode,
    startEmailSignup,
    signInOpen,
    signInReason,
    status,
    signInWithPassword,
    suggestUsernames,
    usernameVocabulary,
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
