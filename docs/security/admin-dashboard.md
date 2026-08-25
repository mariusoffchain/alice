# Alice admin dashboard

A staff-only dashboard for understanding Private Cloud usage and helping
testers, built directly into the existing Venice proxy Worker (`apps/venice-proxy-worker`).
It reuses the same D1 database (`ACCOUNT_DB`), the same session/bearer-token
model as every other Alice client, and adds nothing external: no third-party
analytics or admin SaaS, no new deploy target.

- Static shell: `GET /admin` (served by `src/admin-dashboard-html.ts`, no
  build step, no CDN dependency)
- Brand fonts: `src/admin-dashboard-fonts.ts` (see [Look and feel](#look-and-feel))
- JSON API: `/admin/api/*` (`src/admin.ts`, routed from `src/index.ts`)
- Migrations: `0006_admin.sql`, `0007_installation_milestones.sql`,
  `0008_admin_roles.sql`, `0009_events_daily.sql`

## The data inventory, in five categories

This is the complete picture of what Alice's server side handles. The
principle behind it: collect nothing that is not needed to run and improve
Alice, and nothing personal beyond what an account inherently is. Everything
below is enumerable, there is no "and miscellaneous logs" bucket.

**1. Can never be collected, impossible by construction.** Wallet recovery
phrases, wallet keys, balances, transactions, or even the fact that a wallet
exists: the wallet apps never send any of it to this Worker, and no schema
column could hold it. Chat prompts and AI responses: encrypted on the device,
relayed as ciphertext, never readable here. Plaintext passwords: only salted
hashes exist. Plaintext email addresses at rest: only a keyed one-way HMAC
(for login lookup) and a masked display label (`sat****@bitcoin.com`) are
stored.

**2. Collected by Alice, the exhaustive list.** Account rows (username,
display name, masked email label, HMAC email fingerprint, creation and
last-use timestamps); password hashes (scrypt or PBKDF2, salted); session
records (hashed tokens); quota counters and the cloud request ledger
(confirmed/refunded, day-level, no model name, no content); pseudonymous
installation rows (HMAC of a random install id, platform, app version,
write-once milestone timestamps); day-level aggregate product counters
(event × day × platform × version, no user id); technical error telemetry
(category, code, status); admin roles, the admin audit log and recorded
access denials; promo codes and their redemptions.

**3. Seen in transit but deliberately not kept.** The raw IP address is
HMAC'd with a day-scoped key for rate limiting, then unrecoverable, no
durable IP record exists. The email address transits once per login to send
the verification code, and is not stored in clear. Request and response
bodies are never read into logs; Cloudflare invocation logs are disabled in
`wrangler.toml`.

**4. Collected by third parties, under their own policies, because Alice
uses them.** Each provider sees only its own slice: Cloudflare (edge
metadata of proxy traffic and DNS queries; the payload it relays is
ciphertext), Venice (encrypted inference inside the TEE, session metadata),
Resend (the recipient address and delivery metadata of login-code emails),
Arkade, Boltz and Satora (the payment operations they execute), Esplora
providers (the on-chain addresses a wallet queries), Vercel (web-hosting
access logs), Hugging Face (model-download traffic). None of them receives
seeds, chat plaintext, or Alice account credentials.

**5. Could technically be collected, and deliberately is not.** Per-user
event streams and behavioural timelines (the schema has no place for them);
per-model usage; a queryable IP or device-fingerprint table; a "wallet
created" milestone; timestamps finer than a day in analytics; substring
search over email addresses. Each of these was considered and rejected, adding any of them back is a reviewable schema change, not a toggle.

## Access model

There is no "admin flag" anywhere in a client or in a JWT claim. Every
`/admin/api/*` route calls `requireAdmin()`, which:

1. runs the normal `authenticate()` check used by every other authenticated
   route (a valid, non-expired, non-revoked session for an `active` user), then
2. requires a row for that `user_id` in the `admin_users` table, and
3. for any state-changing route, requires that row's `role` to be `admin`.

Both checks happen on the server, per request. The dashboard HTML page itself
carries no privilege, it is a thin client that signs in through the existing
`/auth/password/login` endpoint and then calls
`/admin/api/*` with the resulting bearer token, exactly like any Alice client
would call `/account`.

### Roles

| Role | Can do |
| --- | --- |
| `support` | Read-only: overview, analytics, events, account search, account sheet, audit log. |
| `admin` | Everything, including suspend/reactivate, credit adjustment, promo codes, role changes, and permanent deletion. |

### Re-authentication for irreversible actions

Permanently deleting an account, granting dashboard access, and revoking it
all require the acting admin to re-enter their **own** password in the same
request (`admin_password` in the body). A stolen or left-open session is
therefore not enough on its own to destroy data or grant itself company. The
check is rate-limited per admin so it cannot be used as a password oracle,
and every failure is recorded.

Denied attempts, not an admin, insufficient role, or a failed re-auth, are
written to `admin_access_denials` and surfaced at
`GET /admin/api/access-denials`, so probing the dashboard is visible rather
than silent.

### Is the page itself a risk?

`GET /admin` is public: anyone who knows the URL sees the sign-in form. That
is deliberate and safe, because **the page ships no data**. Every value on
every screen arrives from `/admin/api/*` after a server-side check, so there
is nothing for a tampered client to reveal:

- Faking a token in `sessionStorage` → `authenticate()` HMACs it and finds no
  matching session → **401** on every route.
- Editing the JS in devtools to skip the login, or setting `state.role =
  'admin'` in the console → cosmetic only; the page renders empty shells
  because every fetch is still refused.
- Signing in with a real, correct password on an account that is not an admin
  → **403** on every route, with no data in the body.
- Suspending an admin's account revokes its sessions, so an `admin_users` row
  alone does not keep a dashboard session alive.

`admin.test.ts` proves this rather than asserting it: the suite enumerates
**every** admin route and checks all three attacker positions (no token,
forged token, valid non-admin session) against each one. A separate test
writes real accounts and sessions to the database, then fetches `/admin`
unauthenticated and asserts that none of those usernames, user ids, tokens or
session hashes appear anywhere in the HTML. If a new admin endpoint is ever
added without protection, that route list is where it surfaces.

The page does contain the *name* `ADMIN_BOOTSTRAP_SECRET`, as the placeholder
telling the operator which variable to paste. Naming an environment variable
is not disclosing it.

### A secret path

`ADMIN_DASHBOARD_PATH` moves the whole dashboard, shell and API, to a path
of your choosing, and `/admin` then returns 404. The page derives its API
base from its own URL, so one variable moves everything.

**This is not a security control.** It keeps drive-by scanners, bots and
casual URL-guessing away, which is worth having, but anyone who learns the
URL gains nothing: the role check is identical there, and a non-admin still
gets 403 on every route. Treat it as noise reduction layered on top of the
password and the `admin_users` row, never as a replacement for either.

A malformed value falls back to `/admin` rather than half-applying, so a typo
cannot leave the dashboard reachable at two places or at none.

### Reachability

Once deployed, `/admin` is reachable from anywhere on the internet at the
Worker's URL, it is not a local-only tool. That is what the layers above are
for: a password with a 15-character minimum, an `admin_users` row, an
optional `ADMIN_ALLOWED_USERNAMES` gate, password re-auth on destructive
actions, and recorded denials. For a private beta, putting **Cloudflare
Access** in front of the route as well is the cheapest large improvement:
an attacker then has to pass your IdP before they can even see the form.

### Transport hardening

- **No CORS on `/admin/api/*`.** The dashboard is served same-origin by this
  Worker, so it needs none, and withholding the headers means no other
  allowlisted Alice origin (the wallet apps, `localhost` during development)
  can script a request against these endpoints from a user's browser.
  Preflights for `/admin*` are answered without CORS headers too. The normal
  account API keeps its CORS as before.
- **The dashboard page is unframable.** `X-Frame-Options: DENY` plus
  `frame-ancestors 'none'`. It has one-click destructive controls, so
  without this a hostile page could overlay an invisible iframe and trick an
  admin into clicking *Delete*.
- **A tight CSP** (`default-src 'none'`, no external origins), plus
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and
  `X-Robots-Tag: noindex`.

### Bootstrap is race-free

The bootstrap insert is conditional (`INSERT … WHERE NOT EXISTS`) rather than
check-then-insert, so two concurrent calls from different accounts cannot
both become admin. It is also rate-limited, and a wrong secret is recorded as
a denial.

### Recommended additional layer

Put **Cloudflare Access** in front of the `/admin` route. It is configuration
rather than code, costs nothing here, and means an attacker needs to pass
your IdP before they can even reach the login form. This is not implemented
in code on purpose: an IP allowlist inside the Worker would mean handling raw
IPs, which Alice deliberately avoids everywhere else.

### Bootstrapping the first admin

There is no seed data and no default admin. The whole first run happens in
the browser, no `curl` needed.

**The admin account must have a password.** The dashboard's sign-in form is
password-based, and every irreversible action (delete an account, grant or
revoke dashboard access) requires re-entering that same password.

1. **Create a normal Alice account with a password**, in the app or on the
   web build. Nothing special about it, it is an ordinary account that will
   be marked as admin in step 4. Password rules come from `validatePassword`:
   **15 to 128 characters**. The username is `prefix.suffix#1234`, and note
   that `admin`, `alice`, `support`, `staff`, `security`, `team` and a few
   others are reserved and cannot be used as either part.
2. **Set the bootstrap secret** on the Worker, once:
   ```bash
   openssl rand -base64 48 | npx wrangler secret put ADMIN_BOOTSTRAP_SECRET
   ```
3. **Open `/admin`** and sign in with that username and password.
4. The dashboard sees a valid session with no admin role and reveals a
   **First-time setup** panel. Paste the secret from step 2 and press *Claim
   admin access*. That panel only appears once the credentials are already
   correct, so it never hints at a bootstrap secret to someone who cannot
   sign in.

That is the whole flow. It succeeds exactly once: if `admin_users` already
has a row, the call returns `409 admin_already_bootstrapped`. Every
subsequent admin is granted by an existing admin from the Admins tab, which
requires that admin's password and writes an audit entry, no secret
involved.

Afterwards, rotate or delete `ADMIN_BOOTSTRAP_SECRET`; it is only useful
again if `admin_users` is ever emptied. Consider setting
`ADMIN_ALLOWED_USERNAMES` to your username at the same time.

Demoting the last remaining full admin is refused server-side
(`409 last_admin`) so the team can never lock itself out.

## What the dashboard shows

**Overview** (`GET /admin/api/overview`): accounts created vs. anonymous
installations (distinguished by the existing `anon_<hash>` user id prefix, no new table), confirmed Private Cloud requests over 24h/7d/30d (from the
existing `cloud_request_ledger`), free-quota consumption and accounts at
quota, plan breakdown, and auth/email/venice error counts over 24h.

**Analytics** (`GET /admin/api/analytics`): everything here is a COUNT or a
SUM over rows Alice already stores, collapsed to totals before it leaves the
database.

- *Retention*, share of installations still seen 1/7/30 days after first
  contact, from `installations.first_seen_at` / `last_seen_at`. Cohort
  eligibility is applied per horizon, so a two-day-old install never drags
  down D30.
- *Activation funnel*, installations → 1st cloud request → 10th → quota
  exhausted → account created, from the write-once milestone columns below.
- *Free quota histogram*, how far into their 21 requests users actually
  get. This is the number that tells you whether 21 is the right number.
- *Venice reliability*, confirmed vs. refunded ledger entries. A refund
  means the upstream call failed and the user was **not** charged.
- *Errors by code* and *requests per day*.
- *Platforms and versions*, installation counts per platform/version.

**Events** (`GET /admin/api/events`): aggregate product analytics, see
[Product events](#product-events).

**Accounts** (`GET /admin/api/accounts?q=`): search by username, exact email
(hashed the same way login does, Alice never stores plaintext email, so
there is no substring search over it), or support id. Anonymous
installations are excluded from this list; they are not accounts.

**Account detail** (`GET /admin/api/accounts/:id`): username, display name,
creation date, login methods with their labels and timestamps (never a
credential, key, or hash), plan/quota/usage, last session activity, status,
and the account's own last 10 technical error events (category + status
code + timestamp only).

**Operator tools**: suspend/reactivate (reason required, both audited),
credit adjustment (`delta` + reason, clamped so a reduction can never drop
the limit below what is already used), permanent deletion (see below), and
promo code management.

**Audit log** (`GET /admin/api/audit-log`): every state-changing admin
action, newest first, with the acting admin's support id, the action, the
target's support id (kept even after a deletion), and a small metadata blob
(the reason string, before/after numbers, never a secret or free-text
content).

## Look and feel

The dashboard is deliberately the same visual language as the wallet, so a
screenshot of it can go straight into Alice's communication without looking
borrowed from a generic admin tool.

- **Palette**: `PALETTES.blue` from `packages/alice-content/src/theme.ts`,
  transcribed into CSS custom properties, the same values the web app
  already declares in `globals.css`. Accent tones for status come from the
  other Alice palettes rather than arbitrary colours: `flame` for danger,
  `green` for OK, `bitcoin` for warnings.
- **Type**: PressStart2P for display/labels and terminal-grotesque for body
  and numbers, matching `typography.pixel` / `typography.numbers`. Both are
  embedded as WOFF2 data URIs, converted from the TTFs in
  `apps/wallet-mobile/assets/fonts` (115KB + 49KB of TTF → 29KB + 12KB). The
  page's CSP is `default-src 'none'`, so nothing can be fetched from a CDN, the bytes have to travel with the Worker.
- **Pixel treatment**: 2px borders and a 2px radius everywhere, matching
  `getPixel()`. Charts are drawn as discrete cells (horizontal strips for
  bars, stacked segments for the per-day series) rather than smooth
  rectangles, so they read as part of the same pixel language as the
  wallet's toggles.
- **Themes**: dark by default like the app, with a light toggle for
  screenshots on a white page.

Two deliberate deviations from the palette, both because this page carries
far denser text than a wallet screen:

- In light mode, `muted` (`#b8d0ff`) falls to ~1.5:1 on `#fafafa`. It is an
  accent tone in the wallet, not body text. Light mode reuses the dark
  palette's `muted` (`#4a6a9a`) instead → 5.3:1.
- `--alice-ink` carries prominent text. In dark mode it is the primary; in
  light mode the primary is a pale accent (1.9:1) that cannot carry a
  headline number, so it falls back to the palette's own dark ink
  (`#1c2533`) → 14.8:1. Backgrounds and borders keep using the primary in
  both themes.

Measured contrast: headline numbers 9.4:1 dark / 14.8:1 light; secondary
text 3.4:1 dark / 5.3:1 light. The dark secondary figure is the wallet's own
`muted` on its own background, kept as-is for brand fidelity rather than
nudged to clear AA.

## Installation milestones

`migrations/0007_installation_milestones.sql` adds a handful of write-once
columns to `installations`, which is already pseudonymous (the primary key
is an HMAC of the install id):

```
platform, app_version,
first_cloud_request_at, tenth_cloud_request_at,
quota_exhausted_at, account_created_at
```

The design principle is **milestones, not an event stream**. Each column
records "this installation reached step X at time T", written once with
`COALESCE` and never overwritten. That is enough for funnels, retention and
cohort analysis, while keeping what Alice stores fully enumerable, there is
no per-action log, and no way to reconstruct a behavioural timeline.

`platform` is validated against an allowlist (`ios`, `android`, `web`,
`desktop-macos`, `desktop-windows`, `desktop-linux`) and `app_version`
against `N.N.N`, both server-side. Anything else is dropped rather than
stored, so these columns can never carry arbitrary client text. Clients send
them as the `x-alice-platform` and `x-alice-app-version` headers.

**There is deliberately no wallet milestone.** The server has no reason to
know that a wallet exists, when it was created, or that it was used. Cloud
request milestones exist only because those requests already pass through
this proxy on their way to Venice.

## Product events

`POST /account/events` accepts `{ "events": ["app_opened", ...] }` and
increments day-resolution counters in `events_daily`, keyed by
`(day, event_name, platform, app_version)`.

There is **no `user_id`, no session id, no install id, no timestamp finer
than a day, and no ordering between events**. A row says "on day D, event E
happened N times on platform P at version V" and nothing more, so no
individual behavioural profile can be reconstructed from this table even in
principle. A session is required to post, purely so the endpoint cannot be
spammed by unauthenticated traffic, the identity is deliberately not stored
with the event.

`event_name` is checked against `ALLOWED_EVENT_NAMES` in `src/admin.ts`
before anything is written. **That allowlist is the control that makes this
table safe**: without it a client could send arbitrary strings, and an
event label is exactly the kind of field that ends up carrying a search
query or a file name. Unknown names are silently dropped. Adding a new event
means adding it to that set in the Worker, a deliberate, reviewable step.

What you give up with this design is the per-individual funnel ("this user
clicked A then B"). What you keep is the per-cohort funnel, which is what
almost every product decision actually needs.

### Client side

`packages/alice-ai/src/product-events.ts` batches events and flushes at most
every 10s, on app background (mobile) and on tab hide (web). Failures are
swallowed, a counter is never worth a retry queue or a broken user action.
`setProductEventsEnabled(false)` stops collection at the source, so a
user-facing opt-out does not have to trust the server to discard data.

Route-based tracking uses a **fixed route→event map**, never "track whatever
route we are on": a route name is a string that could carry an address or an
id, and the counters must never receive one.

`packages/alice-ai/src/client-info.ts` attaches `X-Alice-Platform` and
`X-Alice-App-Version` to authenticated proxy requests. Platform resolution
follows the repo's existing `.native.ts` split so the iOS/Android build uses
`Platform.OS` while web/desktop sniffs the Tauri webview; the pure
formatting logic lives in `client-info-format.ts` so it is unit tested as a
leaf module.

`ALICE_PRODUCT_EVENTS` in the client mirrors `ALLOWED_EVENT_NAMES` in the
Worker. If they drift, the server silently drops the unknown name, benign,
but the event stops counting. The dashboard's Events tab lists the server's
current allowlist so drift is visible to an operator.

## What is deliberately never collected or shown

- Prompts, AI responses, or any Private Cloud request/response body, the
  proxy never reads them in the first place (see `docs/security/private-cloud-e2ee.md`).
- Wallet seeds, wallet private keys, wallet transactions, or even *the fact
  that a wallet exists*, this Worker has no wallet data at all, the wallet
  apps never send it here, and no milestone or event records wallet activity.
- Per-user click streams, page-view timelines, or session replay. Product
  analytics are aggregate counters only.
- Passwords, password hashes and session tokens.
- Raw IP addresses. `technical_events` (auth/email/venice error telemetry)
  stores only a category, a code, a status, and, only when the request was
  already authenticated, the acting `user_id`; it is never derived from IP
  or install id, so it adds no new tracking surface.
- Per-model usage breakdown. `cloud_request_ledger` does not record which
  model a request used, so the dashboard cannot show it either; adding that
  column would be new tracking, which this project avoids by default.
- Full unmasked email addresses in any list view.
- The internal `user_id` to end users, it only ever appears to admins, in
  the single-account detail view, because operators need a real primary key
  to act on a record via this API.

## Account deletion

`DELETE /admin/api/accounts/:id` requires the request body's `confirm` field
to exactly match the account's support id (its username, or its internal id
if it never set one), copy-pasted, not just any string, as a strong
confirmation gate. The action is written to `admin_audit_log` *before* the
row disappears (so the trail survives), then every row referencing the
account is deleted in an explicit, ordered batch (promo redemptions, admin
role, cloud request ledger, free grant, installations, legacy passkey
credentials if present, password credentials, identities, sessions, usage
counters, entitlements, the
username reservation is released, and finally the `users` row itself). This
does not rely on SQLite's `ON DELETE CASCADE` being active for the
connection, it is correct regardless of D1's per-connection foreign-key
pragma state.

## Environment variables and secrets

| Name | Kind | Required | Notes |
| --- | --- | --- | --- |
| `ACCOUNT_DB` | D1 binding | existing | Same database as accounts/auth. |
| `AUTH_HMAC_KEY` | secret | existing | Same key used for session tokens. |
| `ADMIN_BOOTSTRAP_SECRET` | secret | new, admin-only | ≥32 bytes. Only used by `POST /admin/api/bootstrap`. Safe to rotate/remove after the first admin exists. |
| `ADMIN_ALLOWED_USERNAMES` | var | optional | Comma-separated usernames. When set, a session must match one of these **and** have an `admin_users` row. See below. |
| `ADMIN_DASHBOARD_PATH` | secret | optional | Secret path for the dashboard, e.g. `/console-7fq2xk`. When set, `/admin` stops existing. Set it as a secret, not a `[vars]` entry, so it does not sit in git. |
| `EXPO_PUBLIC_ALICE_APP_VERSION` | client build var | optional | `x.y.z`. Inlined into the app builds so they can report their version. Malformed values are simply not reported. |

### Locking the dashboard to specific people

`ADMIN_ALLOWED_USERNAMES` is the answer to "only I should be able to see
this". With it set, being in the `admin_users` table is no longer
sufficient, the session's username must also appear in the list. That means
a rogue promotion, a mistake, or a direct write to D1 by anything other than
this Worker still grants nothing. Set it to your own username and the
dashboard is yours alone. Store the value in `.dev.vars`, not in
`wrangler.toml`, and quote it because dotenv treats an unquoted `#` as the
start of a comment:

```dotenv
ADMIN_ALLOWED_USERNAMES="admin.whiterabbit#4269"
```

Without the quotes, Wrangler loads only `admin.whiterabbit`, and the valid
admin account is refused even though the file appears to contain the complete
username.

Leave it unset to let the database decide alone (useful before you know your
final username). Combined with Cloudflare Access in front of `/admin`, an
attacker needs your IdP **and** your Alice password **and** a listed
username.

### Rotating the admin username without locking yourself out

The value is a **comma-separated list**, which is what makes a safe rotation
possible: the old and the new name can both be listed while the change is in
flight, so there is never a moment when no name matches.

Two server rules make the order matter. A username can only be changed **once
every 30 days**, and the previous one stays **reserved for 180 days**. A
rotation done in the wrong order therefore cannot simply be undone.

1. **Before touching anything**, confirm the dashboard works as it stands:
   sign in and load one read screen. That is the baseline you compare against.
2. **Add the future username to the list first**, next to the current one, and
   restart the console. Both are accepted from now on.
3. **Change the username in the app.** The session keeps working, because its
   new name is already listed.
4. **Sign in again and confirm** the dashboard loads and returns data. Until
   this passes, do not go further.
5. **Remove the old username from the list**, restart, and confirm once more.
   The old access is invalid only at this point.

The list lives wherever the console actually runs. For a local console that is
`.dev.vars`, which is git-ignored: the real value never belongs in the
repository, and `wrangler.toml` carries a format example only.

No other new environment variable is required. The dashboard reuses
`ALLOWED_ORIGINS`/CORS handling only for its `/admin/api/*` JSON responses;
the `GET /admin` HTML page is same-origin (served by the Worker itself) so it
needs no CORS entry.

## Tests

`apps/venice-proxy-worker/src/admin.test.ts` covers: bootstrap (success,
wrong secret, refuses a second bootstrap), access control (non-admin
rejected, unauthenticated rejected, static shell reachable without auth),
overview counts, account search/suspend/reactivate (and that a suspended
account really can't log in), reason-required enforcement, credit
adjustment clamping, that account detail never serializes a secret, delete
confirmation matching, last-admin protection, promo code creation,
redemption, double-redemption and disabling, plus:

- destructive actions refused without / with a wrong re-auth password, and
  the target account left untouched afterwards;
- a `support` operator can read every read endpoint but is refused on every
  mutation, with `admin_role_required`;
- denied attempts recorded and listable;
- analytics returning aggregates that contain no `user_id` or `install_id`;
- platform/version recorded when valid, **dropped when not on the
  allowlist**;
- product events counting allowlisted names, silently dropping a smuggled
  content-bearing string, storing exactly five columns and no identifier,
  and requiring a session.

Run with:
```bash
node --test "apps/venice-proxy-worker/src/**/*.test.ts"
```

## Known limitations

- **Payments, subscriptions and top-ups are not implemented, so the account
  sheet cannot show them.** Alice has no billing system at all today:
  `entitlements.plan` is CHECK-constrained to `'free'` in
  `migrations/0001_accounts.sql`, there is no payment provider integration,
  and no table records a subscription, a payment method or a top-up. The
  "promo codes" here are a manual operator tool for granting extra free
  requests, not a purchase flow.

  The plan is **BTCPay Server only** for the private beta, free to run, no
  card data anywhere, and a natural fit for a Bitcoin wallet. Stripe is
  deferred until commercialisation is actually decided. Billing work should
  not start before that BTCPay Server exists. When it does, keep a
  `provider` discriminator so Stripe can be added later without rewriting
  the schema, and never store card data, only an opaque provider token plus
  the brand/last-4 the provider echoes back, with the top-up ledger kept
  separate from subscription state.
- **No per-model usage stat**, by design, `cloud_request_ledger` does not
  record which model served a request, and adding that column would be new
  tracking.
- **No IP-based abuse dashboard.** Alice intentionally does not persist raw
  IPs; rate limiting uses HMAC'd, day-bucketed IP hashes that are not
  admin-queryable. Anonymous-installation counts, the activation funnel and
  free-quota consumption are the available proxies for abuse.
- **Anonymous usage is not perfectly unlinkable.** `user_installations` and
  `free_grants` already tie an installation to an account created later on
  that same install, which predates this dashboard. Nothing here exposes
  that link per-individual, but if the "anonymous" promise is meant to be
  strict, that relationship is the thing to revisit.
- **Retention is approximated** from `first_seen_at`/`last_seen_at` rather
  than a true daily-active signal, because Alice does not store per-day
  activity. It answers "was this install still around N days later", which
  is the honest reading of the number.
- **Admin accounts authenticate with a password.** Re-auth is required for
  irreversible actions.
