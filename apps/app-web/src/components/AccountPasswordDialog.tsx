'use client';

import { useEffect, useState } from 'react';
import { useAccount, type UsernameSuggestion } from '@alice-wallet/alice-ai';

type Mode = 'create' | 'signin';
type Flow = 'form' | 'verify-email' | 'choose-username';

export function AccountPasswordDialog() {
  const account = useAccount();
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

  useEffect(() => {
    if (!account.account || account.account.has_password && account.account.username) return;
    setFlow('choose-username');
  }, [account.account]);

  if (!account.signInOpen) return null;

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

  const chooseSuggestions = () => void run(async () => {
    const next = await account.suggestUsernames(prefix, prefix);
    setSuggestions(next);
    setSelectedUsername(next[0] ?? null);
  });

  const title = account.status === 'signed_in' ? 'ALICE ACCOUNT' : 'CREATE ACCOUNT';

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
                : account.cloudQuota
                  ? `${account.cloudQuota.remaining} of your ${account.cloudQuota.limit} free `
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

        {account.status === 'signed_in' && account.account && flow !== 'choose-username' ? (
          <div className="mt-5">
            <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 font-numbers">
              <dt style={{ color: 'var(--alice-muted)' }}>Username</dt>
              <dd className="m-0 max-w-[230px] truncate text-right">{account.account.username}</dd>
              <dt style={{ color: 'var(--alice-muted)' }}>Email</dt>
              <dd className="m-0 text-right">{account.account.email_masked ?? 'Not linked'}</dd>
              <dt style={{ color: 'var(--alice-muted)' }}>Private Cloud</dt>
              <dd className="m-0 text-right">
                {account.account.cloud_requests_remaining} / {account.account.cloud_requests_limit}
              </dd>
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
              <div className="mt-5 flex gap-2">
                <button type="button" className="account-secondary-button flex-1" disabled={busy} onClick={() => void run(account.logout)}>SIGN OUT</button>
                <button type="button" className="account-secondary-button flex-1" disabled={busy} onClick={() => setConfirmDelete(true)}>DELETE ACCOUNT</button>
              </div>
            )}
          </div>
        ) : flow === 'choose-username' ? (
          <form
            className="mt-5"
            onSubmit={event => {
              event.preventDefault();
              if (!selectedUsername || password.length < 15) return;
              void run(async () => {
                await account.updatePassword(password, {
                  prefix: selectedUsername.prefix,
                  suffix: selectedUsername.suffix,
                  username: selectedUsername.username,
                  display_name: selectedUsername.prefix,
                });
                account.dismissSignIn();
              });
            }}
          >
            <label className="font-numbers block" htmlFor="account-username-prefix">Username</label>
            <input
              id="account-username-prefix"
              autoFocus
              autoComplete="username"
              value={prefix}
              onChange={event => {
                setPrefix(event.target.value);
                setSuggestions([]);
                setSelectedUsername(null);
              }}
              className="account-input mt-2"
              placeholder="Your name or pseudonym"
            />
            <button type="button" className="account-secondary-button mt-2 w-full" disabled={busy || !prefix.trim()} onClick={chooseSuggestions}>
              {suggestions.length ? 'SHUFFLE USERNAME' : 'CHOOSE USERNAME'}
            </button>
            {suggestions.length ? (
              <div className="mt-2 grid grid-cols-1 gap-2">
                {suggestions.map(suggestion => (
                  <button
                    key={suggestion.username}
                    type="button"
                    onClick={() => setSelectedUsername(suggestion)}
                    className={selectedUsername?.username === suggestion.username ? 'account-primary-button' : 'account-secondary-button'}
                  >
                    {suggestion.username}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="account-input mt-2"
              placeholder="Password, 15+ characters"
            />
            <button type="submit" className="account-primary-button mt-3 w-full" disabled={busy || !selectedUsername || password.length < 15}>
              CREATE ACCOUNT
            </button>
          </form>
        ) : flow === 'verify-email' ? (
          <form
            className="mt-5"
            onSubmit={event => {
              event.preventDefault();
              if (code.length === 6) void run(() => account.verifyEmailSignup(code));
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
            <button type="submit" className="account-primary-button mt-3 w-full" disabled={busy || code.length !== 6}>VERIFY EMAIL</button>
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
                onClick={() => { setMode('signin'); account.clearError(); }}
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
            ) : (
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
              </form>
            )}
            <button type="button" className="mt-4 w-full cursor-pointer border-none bg-transparent font-numbers" style={{ color: 'var(--alice-muted)', fontSize: 14 }} onClick={account.dismissSignIn} disabled={busy}>
              CONTINUE WITHOUT AN ACCOUNT
            </button>
          </div>
        )}

        {account.error ? (
          <p role="alert" className="font-numbers m-0 mt-3" style={{ color: '#e06060', fontSize: 14, lineHeight: '19px' }}>
            {account.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
