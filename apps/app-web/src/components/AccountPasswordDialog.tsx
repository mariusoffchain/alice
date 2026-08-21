'use client';

import { useEffect, useState } from 'react';
import { useAccount, type UsernameSuggestion } from '@alice-wallet/alice-ai';
import { useOpenSettings } from '@/lib/settings-url';

type Mode = 'create' | 'signin';
type Flow = 'form' | 'verify-email' | 'choose-username' | 'change-username';

/** Three rows of the middle-word list. Enough to browse, short enough to fit. */
const SUFFIX_PANEL_HEIGHT = 102;

export function AccountPasswordDialog() {
  const account = useAccount();
  const openSettings = useOpenSettings();
  const [mode, setMode] = useState<Mode>('create');
  const [flow, setFlow] = useState<Flow>('form');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  // The password is the door and the emailed code is the locksmith. Every
  // sign-in asks for the password; the code path exists to choose a new one
  // when the old is lost, and the server holds that line too: a bare code
  // is refused for any account that has a password.
  const [usePassword, setUsePassword] = useState(true);
  const [resetPassword, setResetPassword] = useState('');
  const [prefix, setPrefix] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The parts of a username, fetched when the screen opens and not when a
  // name is typed. The middle words and the number exist first; the name is
  // the only part the person supplies. Deriving them from the typed name left
  // the dropdown dead and the number showing dots until someone typed, which
  // read as broken because it was.
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
    // to the reset leaves every later visit opening on it: the dialog is
    // hidden rather than unmounted, so nothing else forgets this choice.
    setUsePassword(true);
    setResetPassword('');
    // The number belongs to the screen, so closing it lets the next one draw
    // its own.
    setDigits(null);
    setSuffixes([]);
    setSuffix(null);
  }, [account.signInOpen]);

  useEffect(() => {
    // Only an account still missing its username is mid-creation and gets
    // walked back into the picker. Hijacking on a missing password too meant
    // an account that lost its password (the CORS era ate some) could never
    // see its own card again: every visit reopened the creation screen,
    // which read as “sometimes it shows the password form” because it was.
    if (!account.account || account.account.username) return;
    setFlow('choose-username');
  }, [account.account]);

  if (!account.signInOpen) return null;

  // One paid product, one name. A cloud_plus entitlement bought before the
  // withdrawal still runs to its expiry date, and reads as Private Cloud
  // because that is what it now grants: the extra it was sold for, Deep
  // Research, no longer exists to grant.
  const usage = account.cloudUsage;
  const planLabel = usage?.kind === 'paid' ? 'Private Cloud' : 'Free';
  // A bitcoin plan has an end date and no renewal, so the date is not a
  // detail: it is the thing the holder has to act on.
  const renewsOn = usage?.kind === 'paid' && usage.expiresAt
    ? new Date(usage.expiresAt).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      // AccountContext owns the user-facing error.
    } finally {
      setBusy(false);
    }
  };


  // Assembled, never stored: three inputs and one reading of them.
  const chosenUsername = digits && suffix && prefix.trim()
    ? { username: `${prefix.trim()}.${suffix}#${digits}`, prefix: prefix.trim(), suffix }
    : null;

  // Signed out, this dialog is both the sign-in and the sign-up path, so it is
  // named after the destination rather than after one of the two routes to it.
  const title = 'ALICE ACCOUNT';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-5"
      style={{ backgroundColor: 'rgba(0,0,0,0.68)' }}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) account.dismissSignIn();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="alice-account-title"
        className="w-full"
        style={{
          maxWidth: 420,
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto',
          padding: 20,
          border: '2px solid var(--alice-border)',
          borderRadius: 2,
          backgroundColor: 'var(--alice-bg)',
          color: 'var(--alice-text)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="alice-account-title"
              className="font-pixel m-0 tracking-widest"
              style={{ fontSize: 10, lineHeight: '18px', color: 'var(--alice-primary)' }}
            >
              {title}
            </h2>
            <p className="font-numbers m-0 mt-2" style={{ fontSize: 16, lineHeight: '21px', color: 'var(--alice-muted)' }}>
              {account.status === 'signed_in'
                ? 'Your Alice account is separate from your wallet and recovery phrase.'
                : account.signInReason === 'purchase'
                  // Telling someone their free requests need no account, right
                  // after they asked to buy a plan, answers a question they
                  // did not ask and contradicts the one they did.
                  ? 'A paid plan needs an account so it can follow you to another device.'
                  : account.cloudUsage?.kind === 'free'
                    ? `${account.cloudUsage.remaining} of your ${account.cloudUsage.limit} free `
                      + 'Private Cloud requests are left. They work without an account.'
                    : 'Your 21 free Private Cloud requests also work without an account.'}
            </p>
          </div>
          <button
            type="button"
            onClick={account.dismissSignIn}
            aria-label="Close account"
            className="h-8 w-8 shrink-0 cursor-pointer border-none bg-transparent font-numbers"
            style={{ color: 'var(--alice-muted)', fontSize: 24, lineHeight: '28px' }}
          >
            ×
          </button>
        </div>

        {account.status === 'signed_in' && account.account && flow !== 'choose-username' && flow !== 'change-username' ? (
          <div className="mt-5">
            <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 font-numbers">
              <dt style={{ color: 'var(--alice-muted)' }}>Username</dt>
              <dd className="m-0 max-w-[230px] truncate text-right">{account.account.username}</dd>
              <dt style={{ color: 'var(--alice-muted)' }}>Email</dt>
              <dd className="m-0 text-right">{account.account.email_masked ?? 'Not linked'}</dd>
              {/* Which plan, before how much of it is left. The card used to
                  show only a percentage under the words "Private Cloud",
                  which someone who had just paid for Cloud+ could read
                  without ever seeing that they had it. A number means
                  nothing until you know what it is a number of. */}
              <dt style={{ color: 'var(--alice-muted)' }}>Plan</dt>
              <dd className="m-0 text-right">{planLabel}</dd>
              <dt style={{ color: 'var(--alice-muted)' }}>
                {account.cloudUsage?.kind === 'paid' ? 'Allowance used' : 'Free requests'}
              </dt>
              <dd className="m-0 text-right">
                {/* Paid plans are metered in bytes server-side, so the exact
                    request counter only exists on the free plan. */}
                {account.cloudUsage?.kind === 'paid'
                  ? `${account.cloudUsage.percentUsed}%`
                  : `${account.account.cloud_requests_remaining} / ${account.account.cloud_requests_limit}`}
              </dd>
              {renewsOn ? (
                <>
                  <dt style={{ color: 'var(--alice-muted)' }}>Runs out</dt>
                  <dd className="m-0 text-right">{renewsOn}</dd>
                </>
              ) : null}
            </dl>
            {confirmDelete ? (
              <div className="mt-5" style={{ borderTop: '1px solid var(--alice-border)', paddingTop: 16 }}>
                <p className="font-numbers m-0" style={{ fontSize: 15, lineHeight: '20px' }}>
                  Delete this Alice account? Your local chats and wallet remain on this device.
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="account-secondary-button flex-1" disabled={busy} onClick={() => setConfirmDelete(false)}>CANCEL</button>
                  <button type="button" className="account-danger-button flex-1" disabled={busy} onClick={() => void run(account.deleteAccount)}>DELETE</button>
                </div>
              </div>
            ) : (
              <div className="mt-5">
                {/* Buying lived only in the settings tab, so this card could
                    tell someone their plan was running out and offer them no
                    way to do anything about it. The purchase itself stays in
                    one place; this is a door to it, next to the line that
                    prompts the question. */}
                <button
                  type="button"
                  className="account-primary-button w-full"
                  disabled={busy}
                  onClick={() => {
                    account.dismissSignIn();
                    openSettings('account');
                  }}
                >
                  {/* "Add credit" waits until topping up actually exists:
                      a button must not promise more than the screen behind
                      it sells, and today that screen sells plans and months,
                      not credit. */}
                  UPGRADE PLAN
                </button>
                <button
                  type="button"
                  className="account-secondary-button mt-2 w-full"
                  disabled={busy}
                  onClick={() => {
                    account.clearError();
                    setPrefix('');
                    setDigits(null);
                    setSuffixes([]);
                    setSuffix(null);
                    setFlow('change-username');
                  }}
                >
                  CHANGE USERNAME
                </button>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="account-secondary-button flex-1" disabled={busy} onClick={() => void run(account.logout)}>SIGN OUT</button>
                  <button type="button" className="account-secondary-button flex-1" disabled={busy} onClick={() => setConfirmDelete(true)}>DELETE ACCOUNT</button>
                </div>
              </div>
            )}
          </div>
        ) : flow === 'choose-username' || flow === 'change-username' ? (
          <form
            className="mt-5"
            onSubmit={event => {
              event.preventDefault();
              if (!chosenUsername || (flow === 'choose-username' && password.length < 15)) return;
              void run(async () => {
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
              });
            }}
          >
            <label className="font-numbers block" htmlFor="account-username-prefix">Username</label>
            <>
                {/* The username, laid out as it reads, left to right: the name
                    that was typed, the middle word to pick from a scrolling
                    list, and the number, already decided, that never moves.
                    One number for every middle word, on purpose: digits that
                    changed with the choice would look like part of it. */}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="account-username-prefix"
                    aria-label="Username name part"
                    autoFocus
                    autoComplete="username"
                    value={prefix}
                    onChange={event => setPrefix(event.target.value)}
                    className="account-input min-w-0 flex-1"
                    placeholder="Your name"
                  />
                  <span className="font-numbers shrink-0" style={{ fontSize: 18, color: 'var(--alice-muted)' }}>.</span>
                  <div className="relative shrink-0" style={{ width: 168 }}>
                    <button
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={suffixOpen}
                      aria-label="Middle word"
                      disabled={!suffixes.length}
                      onClick={() => setSuffixOpen(open => !open)}
                      className="flex w-full items-center justify-between gap-2 cursor-pointer text-left font-numbers"
                      style={{
                        padding: '9px 10px',
                        fontSize: 15,
                        border: `2px solid ${suffixes.length ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
                        borderRadius: 2,
                        backgroundColor: 'transparent',
                        color: suffixes.length ? 'var(--alice-text)' : 'var(--alice-muted)',
                      }}
                    >
                      <span className="truncate">
                        {suffix ?? '...'}
                      </span>
                      <span aria-hidden style={{ opacity: 0.6 }}>{suffixOpen ? '\u25b4' : '\u25be'}</span>
                    </button>
                    {suffixOpen && suffixes.length ? (
                      <div
                        role="listbox"
                        aria-label="Middle word"
                        // Opened on the word already chosen rather than at the
                        // top of the list: three rows is not enough to find
                        // your own place in fifteen.
                        ref={panel => {
                          panel?.querySelector('[aria-selected="true"]')
                            ?.scrollIntoView({ block: 'nearest' });
                        }}
                        className="absolute left-0 right-0 z-10 overflow-y-auto"
                        style={{
                          top: 'calc(100% + 4px)',
                          maxHeight: SUFFIX_PANEL_HEIGHT,
                          border: '2px solid var(--alice-primary)',
                          borderRadius: 2,
                          backgroundColor: 'var(--alice-bg)',
                        }}
                      >
                        {suffixes.map(option => {
                          const active = option === suffix;
                          return (
                            <button
                              key={option}
                              type="button"
                              role="option"
                              aria-selected={active}
                              onClick={() => { setSuffix(option); setSuffixOpen(false); }}
                              className="block w-full border-none cursor-pointer text-left font-numbers"
                              style={{
                                padding: '7px 10px',
                                fontSize: 15,
                                backgroundColor: active ? 'var(--alice-primary)' : 'transparent',
                                color: active ? 'var(--alice-on-primary)' : 'var(--alice-text)',
                              }}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  <span className="font-numbers shrink-0" style={{ fontSize: 18, color: 'var(--alice-muted)' }}>#</span>
                  <span
                    className="font-numbers shrink-0"
                    aria-label="Your number, already assigned"
                    style={{ fontSize: 18, color: digits ? 'var(--alice-primary-dark)' : 'var(--alice-muted)' }}
                  >
                    {digits ?? '····'}
                  </span>
                </div>
                {chosenUsername ? (
                  <p className="font-numbers m-0 mt-2" style={{ fontSize: 15, color: 'var(--alice-muted)' }}>
                    Your username: {' '}
                    <span style={{ color: 'var(--alice-primary-dark)' }}>{chosenUsername.username}</span>
                  </p>
                ) : null}
              </>
            {flow === 'choose-username' ? (
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                className="account-input mt-2"
                placeholder="Password, 15+ characters"
              />
            ) : (
              <p className="font-numbers m-0 mt-3" style={{ color: 'var(--alice-muted)', fontSize: 14 }}>
                A username can be changed once every 30 days.
              </p>
            )}
            <button
              type="submit"
              className="account-primary-button mt-3 w-full"
              disabled={busy || !chosenUsername || (flow === 'choose-username' && password.length < 15)}
            >
              {flow === 'change-username' ? 'SAVE USERNAME' : 'CREATE ACCOUNT'}
            </button>
            {flow === 'change-username' ? (
              <button type="button" className="account-secondary-button mt-2 w-full" disabled={busy} onClick={() => setFlow('form')}>
                CANCEL
              </button>
            ) : null}
          </form>
        ) : flow === 'verify-email' ? (
          <form
            className="mt-5"
            onSubmit={event => {
              event.preventDefault();
              if (code.length !== 6) return;
              if (mode === 'signin' && resetPassword.length < 15) return;
              // Two different promises ride the same six digits: joining an
              // address to the account being created, or resetting the way
              // into an existing one. The reset carries its new password in
              // the same request, because the server refuses a bare code for
              // any account that has one.
              void run(() => (mode === 'signin' ? account.verifyCode(code, resetPassword) : account.verifyEmailSignup(code)));
            }}
          >
            <label className="font-numbers block" htmlFor="account-email-code">Verification code sent to {account.pendingEmail}</label>
            <input
              id="account-email-code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="account-input mt-2"
              placeholder="000000"
            />
            {mode === 'signin' ? (
              <input
                type="password"
                autoComplete="new-password"
                value={resetPassword}
                onChange={event => setResetPassword(event.target.value)}
                className="account-input mt-2"
                placeholder="New password, 15+ characters"
              />
            ) : null}
            <button
              type="submit"
              className="account-primary-button mt-3 w-full"
              disabled={busy || code.length !== 6 || (mode === 'signin' && resetPassword.length < 15)}
            >
              {mode === 'signin' ? 'RESET AND SIGN IN' : 'VERIFY EMAIL'}
            </button>
          </form>
        ) : (
          <div className="mt-5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={mode === 'create' ? 'account-primary-button' : 'account-secondary-button'}
                onClick={() => { setMode('create'); account.clearError(); }}
              >
                CREATE ACCOUNT
              </button>
              <button
                type="button"
                className={mode === 'signin' ? 'account-primary-button' : 'account-secondary-button'}
                onClick={() => {
                  setMode('signin');
                  // Sign in means the password. Reaching the reset is a
                  // deliberate second click, every time.
                  setUsePassword(true);
                  account.clearError();
                }}
              >
                SIGN IN
              </button>
            </div>
            {mode === 'create' ? (
              <form
                className="mt-3"
                onSubmit={event => {
                  event.preventDefault();
                  if (!email.trim()) return;
                  void run(async () => {
                    await account.startEmailSignup(email);
                    setFlow('verify-email');
                  });
                }}
              >
                <input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="account-input" placeholder="you@example.com" />
                <button type="submit" className="account-primary-button mt-3 w-full" disabled={busy || !email.trim()}>CONTINUE WITH EMAIL</button>
              </form>
            ) : usePassword ? (
              <form
                className="mt-3"
                onSubmit={event => {
                  event.preventDefault();
                  if (identifier.trim() && password.length >= 15) void run(() => account.signInWithPassword(identifier, password));
                }}
              >
                <input autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} className="account-input" placeholder="Email or username" />
                <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="account-input mt-2" placeholder="Password" />
                <button type="submit" className="account-primary-button mt-3 w-full" disabled={busy || !identifier.trim() || password.length < 15}>SIGN IN</button>
                <button type="button" className="account-secondary-button mt-2 w-full" disabled={busy} onClick={() => { setUsePassword(false); account.clearError(); }}>
                  FORGOT PASSWORD? RESET BY EMAIL
                </button>
              </form>
            ) : (
              // The reset, which doubles as the only door for accounts from
              // the era when a password could be lost in transit: prove the
              // inbox, choose a new password on the next screen, and the two
              // arrive at the server in one request.
              <form
                className="mt-3"
                onSubmit={event => {
                  event.preventDefault();
                  if (!email.trim()) return;
                  void run(async () => {
                    await account.sendCode(email);
                    setFlow('verify-email');
                  });
                }}
              >
                <input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="account-input" placeholder="you@example.com" />
                <button type="submit" className="account-primary-button mt-3 w-full" disabled={busy || !email.trim()}>EMAIL ME A RESET CODE</button>
                <button type="button" className="account-secondary-button mt-2 w-full" disabled={busy} onClick={() => { setUsePassword(true); account.clearError(); }}>
                  BACK TO PASSWORD
                </button>
              </form>
            )}
            <button type="button" className="mt-4 w-full cursor-pointer border-none bg-transparent font-numbers" style={{ color: 'var(--alice-muted)', fontSize: 14 }} onClick={account.dismissSignIn} disabled={busy}>
              {account.signInReason === 'purchase' ? 'CANCEL' : 'CONTINUE WITHOUT AN ACCOUNT'}
            </button>
          </div>
        )}

        {account.error ? (
          <p role="alert" className="font-numbers m-0 mt-3" style={{ color: 'var(--alice-danger)', fontSize: 14, lineHeight: '19px' }}>
            {account.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
