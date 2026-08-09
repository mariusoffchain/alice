// Static shell for the Alice admin dashboard, served at GET /admin.
//
// Deliberately a single dependency-free HTML file with inline JS: no build
// step, no third-party analytics/admin SaaS, nothing loaded from a CDN. It
// authenticates using the same account API every Alice client uses
// (/auth/password/login or /auth/email/*), then talks to /admin/api/* with
// the resulting bearer token. The server is the only thing enforcing admin
// access — this page has no special privilege on its own.
//
// Visually it is the wallet: the same Alice Blue palette from
// packages/alice-content/src/theme.ts (PALETTES.blue), the same PressStart2P
// display face and terminal-grotesque body face, and the same 2px border /
// 2px radius "pixel" treatment as the wallet's own surfaces. Charts are drawn
// as discrete cells rather than smooth bars so a screenshot of this page sits
// next to a screenshot of the app without looking borrowed.
import { NUMBERS_FONT_WOFF2, PIXEL_FONT_WOFF2 } from './admin-dashboard-fonts.ts';

export const ADMIN_DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Alice Admin</title>
<style>
  @font-face {
    font-family: 'PressStart2P';
    src: url(data:font/woff2;base64,${PIXEL_FONT_WOFF2}) format('woff2');
    font-display: swap;
  }
  @font-face {
    font-family: 'TerminalGrotesque';
    src: url(data:font/woff2;base64,${NUMBERS_FONT_WOFF2}) format('woff2');
    font-display: swap;
  }

  /* PALETTES.blue.dark — packages/alice-content/src/theme.ts */
  :root {
    color-scheme: dark;
    --alice-bg: #0d1117;
    --alice-bg-soft: #161b22;
    --alice-primary: #8bb8ff;
    --alice-primary-dark: #a8ccff;
    --alice-text: #8bb8ff;
    --alice-border: #2a3a52;
    --alice-muted: #4a6a9a;
    --alice-card-bg: rgba(22, 27, 34, 0.8);
    --alice-on-primary: #16294a;
    --alice-white: #e6edf3;
    /* Prominent text. In dark mode the primary IS the ink; in light mode the
       primary is a pale accent (1.9:1 on #fafafa) and cannot carry text, so
       light falls back to the palette's dark ink (PALETTES.blue.light
       qrColor). Backgrounds and borders keep using --alice-primary in both. */
    --alice-ink: #8bb8ff;
    --alice-danger: #f14317;   /* PALETTES.flame.primary */
    --alice-ok: #56dc4b;       /* PALETTES.green.primary */
    --alice-warn: #f7931a;     /* PALETTES.bitcoin.primary */
  }
  /* PALETTES.blue.light, for anyone who prefers it or screenshots on white */
  :root[data-theme="light"] {
    color-scheme: light;
    --alice-bg: #fafafa;
    --alice-bg-soft: #f6f8fb;
    --alice-primary: #8bb8ff;
    --alice-primary-dark: #6fa3f7;
    --alice-text: #6f9ee8;
    --alice-border: #8bb8ff;
    /* The light palette's own muted (#b8d0ff) is an accent tone and drops to
       ~1.5:1 on #fafafa — fine behind a wallet control, unreadable for the
       dense secondary text on this page. Reuse the dark palette's muted,
       which is on-brand and legible on both backgrounds. */
    --alice-muted: #4a6a9a;
    --alice-card-bg: rgba(255, 255, 255, 0.7);
    --alice-on-primary: #ffffff;
    --alice-white: #1c2533;
    --alice-ink: #1c2533;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--alice-bg);
    color: var(--alice-text);
    font-family: 'TerminalGrotesque', system-ui, -apple-system, sans-serif;
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }

  /* The pixel face is only ever used small: it is a display face, and at
     body size it stops being readable. */
  .pixel, h1, h2, nav button, th, .stat .l, .pill, label {
    font-family: 'PressStart2P', monospace;
    letter-spacing: 0.02em;
  }

  header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; flex-wrap: wrap;
    padding: 16px 20px;
    border-bottom: 2px solid var(--alice-border);
    position: sticky; top: 0; z-index: 10;
    background: var(--alice-bg);
  }
  header h1 {
    font-size: 12px; margin: 0; font-weight: 400;
    color: var(--alice-ink);
  }
  nav { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
  nav button {
    background: none;
    border: 2px solid transparent;
    border-radius: 2px;
    color: var(--alice-muted);
    padding: 7px 10px;
    cursor: pointer;
    font-size: 8px;
    text-transform: uppercase;
  }
  nav button:hover { color: var(--alice-ink); }
  nav button.active {
    background: var(--alice-primary);
    color: var(--alice-on-primary);
    border-color: var(--alice-primary);
  }

  main { padding: 20px; max-width: 1180px; margin: 0 auto; }

  /* 2px border, 2px radius — getPixel() in theme.ts */
  .card {
    background: var(--alice-card-bg);
    border: 2px solid var(--alice-border);
    border-radius: 2px;
    padding: 16px;
    margin-bottom: 16px;
  }
  h2 {
    font-size: 10px; margin: 0 0 14px; font-weight: 400;
    color: var(--alice-ink); text-transform: uppercase;
  }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
  .stat {
    background: var(--alice-card-bg);
    border: 2px solid var(--alice-border);
    border-radius: 2px;
    padding: 14px;
  }
  /* terminal-grotesque is the numeric face in the wallet (typography.numbers) */
  .stat .n {
    font-family: 'TerminalGrotesque', monospace;
    font-size: 32px; line-height: 1; color: var(--alice-ink);
  }
  .stat .l {
    color: var(--alice-muted); font-size: 8px; margin-top: 8px;
    line-height: 1.6; text-transform: uppercase;
  }
  .grid-3 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .stat.hero .n { font-size: 44px; }
  /* The hint is what makes a number readable a month later: it says what is
     actually being counted, in words, not just a terse label. */
  .stat.hero .hint {
    color: var(--alice-muted); font-size: 13px; line-height: 1.5; margin-top: 8px;
  }
  .stat.hero .delta {
    font-family: 'PressStart2P', monospace; font-size: 8px; margin-top: 12px;
    padding-top: 10px; border-top: 2px solid var(--alice-border);
    color: var(--alice-muted);
  }
  .stat.hero .delta.up { color: var(--alice-ok); }
  .stat.hero .delta.down { color: var(--alice-warn); }
  td.num {
    text-align: right; font-family: 'TerminalGrotesque', monospace;
    font-size: 20px; color: var(--alice-ink);
  }

  /* Tables can exceed a card on a narrow viewport; scroll rather than clip
     a column heading. */
  .card { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  th, td { white-space: nowrap; }
  th, td { text-align: left; padding: 9px 8px; border-bottom: 2px solid var(--alice-border); }
  th {
    color: var(--alice-muted); font-weight: 400; font-size: 8px;
    text-transform: uppercase;
  }
  td { color: var(--alice-white); }
  tr.clickable { cursor: pointer; }
  tr.clickable:hover td { background: var(--alice-bg-soft); color: var(--alice-ink); }

  input, select, textarea, button.btn {
    background: var(--alice-bg-soft);
    border: 2px solid var(--alice-border);
    border-radius: 2px;
    color: var(--alice-white);
    padding: 9px 10px;
    font-size: 15px;
    font-family: 'TerminalGrotesque', system-ui, sans-serif;
  }
  input:focus, select:focus, textarea:focus {
    outline: none; border-color: var(--alice-primary);
  }
  input::placeholder { color: var(--alice-muted); }
  button.btn {
    cursor: pointer; font-family: 'PressStart2P', monospace; font-size: 8px;
    padding: 10px 12px; text-transform: uppercase; color: var(--alice-ink);
  }
  button.btn:hover { border-color: var(--alice-primary); }
  button.btn.primary {
    background: var(--alice-primary); border-color: var(--alice-primary);
    color: var(--alice-on-primary);
  }
  button.btn.danger {
    background: transparent; border-color: var(--alice-danger);
    color: var(--alice-danger);
  }
  button.btn.danger:hover { background: var(--alice-danger); color: var(--alice-bg); }
  button.btn:disabled { opacity: .4; cursor: not-allowed; }

  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .muted { color: var(--alice-muted); font-size: 14px; line-height: 1.6; }

  .pill {
    display: inline-block; padding: 4px 7px; border-radius: 2px; font-size: 8px;
    border: 2px solid var(--alice-border); color: var(--alice-muted);
    text-transform: uppercase;
  }
  .pill.active { color: var(--alice-ok); border-color: var(--alice-ok); }
  .pill.suspended { color: var(--alice-danger); border-color: var(--alice-danger); }

  .err { color: var(--alice-danger); margin: 10px 0; white-space: pre-wrap; font-size: 14px; }
  .ok { color: var(--alice-ok); margin: 10px 0; font-size: 14px; }

  label {
    display: block; font-size: 8px; color: var(--alice-muted); margin-bottom: 6px;
    text-transform: uppercase;
  }
  .field { margin-bottom: 12px; }
  code {
    background: var(--alice-bg-soft); padding: 2px 6px; border-radius: 2px;
    font-family: 'TerminalGrotesque', monospace; color: var(--alice-ink);
  }

  /* ---- Charts ----
     Bars keep the wallet's pixel language through a repeating gradient, so a
     bar reads as stacked blocks while its height stays a plain percentage.
     The earlier version drew every empty segment as a dark block, which
     filled the plot with noise and hid the actual shape of the data. */
  .chart { display: flex; gap: 8px; height: 170px; }

  .chart-y {
    display: flex; flex-direction: column; justify-content: space-between;
    font-family: 'PressStart2P', monospace; font-size: 7px;
    color: var(--alice-muted); text-align: right; min-width: 30px;
    padding: 1px 0 15px;
  }

  .chart-plot {
    position: relative; flex: 1;
    border-left: 2px solid var(--alice-border);
    border-bottom: 2px solid var(--alice-border);
  }
  .chart-grid {
    position: absolute; left: 0; right: 0; height: 0;
    border-top: 1px dashed var(--alice-border); opacity: .55;
  }

  .chart-bars {
    position: absolute; inset: 0;
    display: flex; align-items: flex-end; gap: 2px; padding: 0 3px;
  }
  .chart-bar {
    flex: 1; min-width: 4px; height: 100%;
    display: flex; align-items: flex-end;
    cursor: default;
  }
  .chart-fill {
    width: 100%;
    /* The pixel texture: solid bands with gaps, rather than real elements. */
    background: repeating-linear-gradient(
      to top,
      var(--alice-primary) 0 5px,
      transparent 5px 7px
    );
    transition: height 420ms cubic-bezier(.22, 1, .36, 1);
    min-height: 0;
  }
  .chart-bar.empty .chart-fill { background: none; }
  .chart-bar.hot .chart-fill {
    background: repeating-linear-gradient(
      to top,
      var(--alice-warn) 0 5px,
      transparent 5px 7px
    );
  }
  .chart-bar.hot { background: rgba(139, 184, 255, 0.08); }

  .chart-tip {
    position: absolute; bottom: calc(100% + 6px); transform: translateX(-50%);
    background: var(--alice-bg); border: 2px solid var(--alice-primary);
    border-radius: 2px; padding: 5px 8px; white-space: nowrap;
    font-family: 'PressStart2P', monospace; font-size: 7px;
    color: var(--alice-ink); opacity: 0; transition: opacity 120ms;
    pointer-events: none; z-index: 2;
  }

  .chart-x {
    display: flex; gap: 2px; padding: 5px 3px 0 46px;
  }
  .chart-x span {
    flex: 1; min-width: 4px; text-align: center;
    font-family: 'PressStart2P', monospace; font-size: 7px;
    color: var(--alice-muted); white-space: nowrap;
  }

  .chart-summary {
    display: flex; justify-content: space-between; gap: 12px;
    margin: 10px 0 0; padding-top: 10px;
    border-top: 2px solid var(--alice-border);
    font-family: 'PressStart2P', monospace; font-size: 7px;
    color: var(--alice-muted);
  }

  /* Horizontal bars, used by the funnel and the quota histogram. */
  .pxbar {
    display: flex; gap: 2px; margin-top: 5px;
    border: 2px solid var(--alice-border); border-radius: 2px; padding: 2px;
  }
  .pxcell { flex: 1; height: 10px; background: transparent; }
  .pxcell.on { background: var(--alice-primary); }
  .pxcell.on.warn { background: var(--alice-warn); }
  .pxcell.on.danger { background: var(--alice-danger); }
  .pxrow { margin-bottom: 14px; }
  .pxrow .lbl {
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  }
  .pxrow .lbl span:first-child {
    font-family: 'PressStart2P', monospace; font-size: 8px; color: var(--alice-muted);
    text-transform: uppercase;
  }
  .pxrow .lbl span:last-child {
    font-family: 'TerminalGrotesque', monospace; font-size: 20px; color: var(--alice-ink);
  }

  @media (max-width: 700px) {
    header { padding: 12px; }
    main { padding: 12px; }
    nav button { padding: 6px 7px; }
  }
</style>
</head>
<body>
<header>
  <h1>ALICE · ADMIN</h1>
  <nav id="nav" style="display:none">
    <button data-view="overview">Overview</button>
    <button data-view="analytics">Analytics</button>
    <button data-view="events">Events</button>
    <button data-view="accounts">Accounts</button>
    <button data-view="audit">Audit</button>
    <button data-view="promos">Promos</button>
    <button data-view="admins">Admins</button>
    <span id="role" class="pill"></span>
    <button id="theme" class="btn" title="Light / dark">◐</button>
    <button id="logout" class="btn danger">Sign out</button>
  </nav>
</header>
<main id="app"></main>
<script>
(function () {
  var API = location.origin;
  var state = { token: sessionStorage.getItem('alice_admin_token') || null, view: 'overview' };
  var app = document.getElementById('app');
  var nav = document.getElementById('nav');

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function fmtTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString();
  }

  // The dashboard can be served from a secret path, so it learns where it
  // lives from its own URL rather than hard-coding /admin. Call sites keep
  // writing '/admin/api/...' and this rewrites the prefix — one place to get
  // right instead of twenty.
  // Double-escaped on purpose: this whole block is a JS string literal
  // inside a TS template literal, and a single "\\/" is not a recognized
  // escape there — TS silently collapses it to a bare "/", which breaks the
  // regex (or opens a "//" comment) in the emitted client script. "\\/"
  // survives the outer template literal as "\\/", which is what the regex
  // engine actually needs.
  var ADMIN_BASE = location.pathname.replace(/\\/+$/, '') || '/admin';

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ 'content-type': 'application/json' }, options.headers || {});
    if (state.token) headers.authorization = 'Bearer ' + state.token;
    var target = API + path.replace(/^\\/admin\\/api/, ADMIN_BASE + '/api');
    return fetch(target, Object.assign({}, options, { headers: headers }))
      .then(function (res) {
        if (res.status === 204) return null;
        return res.json().then(function (body) {
          if (!res.ok) throw new Error((body.error && body.error.message) || 'Request failed');
          return body;
        });
      });
  }

  function setToken(token) {
    state.token = token;
    if (token) sessionStorage.setItem('alice_admin_token', token);
    else sessionStorage.removeItem('alice_admin_token');
  }

  document.getElementById('logout').addEventListener('click', function () {
    setToken(null);
    render();
  });

  // Alice defaults to dark; light is there for screenshots on a white page.
  var themeBtn = document.getElementById('theme');
  function applyTheme(mode) {
    if (mode === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('alice_admin_theme', mode); } catch (e) {}
  }
  applyTheme(function () {
    try { return localStorage.getItem('alice_admin_theme') || 'dark'; } catch (e) { return 'dark'; }
  }());
  themeBtn.addEventListener('click', function () {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  nav.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-view]');
    if (!btn) return;
    state.view = btn.getAttribute('data-view');
    state.detail = null;
    render();
  });

  function renderLogin() {
    nav.style.display = 'none';
    app.innerHTML = '';
    var err = h('div', { class: 'err' });
    var identifier = h('input', { placeholder: 'username or email', autocomplete: 'username' });
    var password = h('input', { type: 'password', placeholder: 'password', autocomplete: 'current-password' });
    var submit = h('button', { class: 'btn primary', text: 'Sign in' });
    var form = h('form', { class: 'card', style: 'max-width:360px;margin:60px auto' }, [
      h('h2', { text: 'Sign in' }),
      h('p', { class: 'muted', text: 'Sign in with an Alice account that has admin access.' }),
      h('div', { class: 'field' }, [h('label', { text: 'Username or email' }), identifier]),
      h('div', { class: 'field' }, [h('label', { text: 'Password' }), password]),
      submit,
      err,
    ]);
    // First-run setup. It only appears when the credentials were correct but
    // the account is not an admin yet, so it never hints at a bootstrap
    // secret to someone who cannot even sign in.
    var secret = h('input', {
      type: 'password',
      placeholder: 'ADMIN_BOOTSTRAP_SECRET',
      autocomplete: 'off',
    });
    var claim = h('button', { class: 'btn primary', text: 'Claim admin access' });
    var setup = h('div', {
      class: 'card',
      style: 'max-width:360px;margin:0 auto 60px;display:none',
    }, [
      h('h2', { text: 'First-time setup' }),
      h('p', {
        class: 'muted',
        text: 'This account is not an admin yet. If you are setting Alice up for '
          + 'the first time, paste the ADMIN_BOOTSTRAP_SECRET you configured on '
          + 'the Worker. This works only once, while no admin exists.',
      }),
      h('div', { class: 'field' }, [h('label', { text: 'Bootstrap secret' }), secret]),
      claim,
    ]);

    function enterDashboard(session) {
      state.role = session.role;
      render();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      setup.style.display = 'none';
      submit.disabled = true;
      fetch(API + '/auth/password/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.value, password: password.value }),
      }).then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
        .then(function (r) {
          if (!r.ok) throw new Error((r.body.error && r.body.error.message) || 'Sign in failed');
          setToken(r.body.access_token);
          return api('/admin/api/session');
        })
        .then(enterDashboard)
        .catch(function (e) {
          // Keep the token: the credentials were fine, the role is what is
          // missing, and the bootstrap call below needs that session.
          if (state.token && /admin access is required/i.test(e.message)) {
            setup.style.display = 'block';
            secret.focus();
            return;
          }
          setToken(null);
          err.textContent = e.message;
        })
        .finally(function () { submit.disabled = false; });
    });

    claim.addEventListener('click', function () {
      err.textContent = '';
      claim.disabled = true;
      api('/admin/api/bootstrap', {
        method: 'POST',
        headers: { 'x-admin-bootstrap-secret': secret.value },
      })
        .then(function () { return api('/admin/api/session'); })
        .then(enterDashboard)
        .catch(function (e) { err.textContent = e.message; })
        .finally(function () { claim.disabled = false; });
    });

    app.appendChild(form);
    app.appendChild(setup);
  }

  function statCard(n, l) {
    return h('div', { class: 'stat' }, [h('div', { class: 'n', text: String(n) }), h('div', { class: 'l', text: l })]);
  }

  // A headline figure with its own 7-day trend. The hint says what is
  // actually being counted: a bare number with a terse label is the fastest
  // way to make a dashboard unreadable a month later.
  function heroCard(value, label, hint, changePercent) {
    var delta = null;
    if (changePercent !== null && changePercent !== undefined) {
      var up = changePercent >= 0;
      delta = h('div', {
        class: 'delta ' + (changePercent === 0 ? '' : (up ? 'up' : 'down')),
        text: (up ? '▲ +' : '▼ ') + changePercent + '% vs 7 previous days',
      });
    } else {
      delta = h('div', { class: 'delta muted-delta', text: 'no earlier period to compare' });
    }
    return h('div', { class: 'stat hero' }, [
      h('div', { class: 'n', text: String(value) }),
      h('div', { class: 'l', text: label }),
      h('div', { class: 'hint', text: hint }),
      delta,
    ]);
  }

  function renderOverview() {
    app.innerHTML = '<p class="muted">Loading…</p>';
    api('/admin/api/overview').then(function (o) {
      app.innerHTML = '';

      app.appendChild(h('div', { class: 'grid grid-3' }, [
        heroCard(
          o.accounts_created, 'Accounts',
          'People who created an Alice account with a login. Excludes anonymous app installs.',
          o.accounts_change_percent,
        ),
        heroCard(
          o.installations_total, 'App installations',
          'Devices that have opened Alice. ' + o.installations_active_7d
            + ' active in the last 7 days, ' + o.installations_anonymous
            + ' still browsing without an account.',
          o.installations_change_percent,
        ),
        heroCard(
          o.requests_7d, 'AI requests · 7 days',
          'Private Cloud requests that actually reached Venice and succeeded. ' + o.requests_total + ' since launch.',
          o.requests_change_percent,
        ),
      ]));

      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'AI requests per day · 30 days' }),
        columns(toPoints(o.series.requests), 'requests'),
      ]));

      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'New installations per day · 30 days' }),
        columns(toPoints(o.series.installations), 'installations'),
      ]));

      var freeUse = h('table', {}, [
        h('tr', {}, [
          h('td', { text: 'AI requests today (24h)' }),
          h('td', { class: 'num', text: String(o.requests_24h) }),
        ]),
        h('tr', {}, [
          h('td', { text: 'Free requests consumed, all accounts' }),
          h('td', { class: 'num', text: String(o.free_requests_used_total) }),
        ]),
        h('tr', {}, [
          h('td', { text: 'Accounts that used at least one free request' }),
          h('td', { class: 'num', text: String(o.accounts_with_free_usage) }),
        ]),
        h('tr', {}, [
          h('td', { text: 'Accounts that used all 21 free requests' }),
          h('td', { class: 'num', text: String(o.accounts_at_quota) }),
        ]),
      ]);
      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Free quota' }),
        h('p', { class: 'muted', text: 'Every Alice user gets 21 free Private Cloud requests. These are the numbers that tell you whether 21 is the right figure.' }),
        freeUse,
      ]));

      var errorTotal = o.auth_errors_24h + o.email_errors_24h + o.venice_errors_24h;
      var errorsCard = h('div', { class: 'card' }, [
        h('h2', { text: 'Errors · last 24 hours' }),
      ]);
      if (errorTotal === 0) {
        errorsCard.appendChild(h('p', { class: 'muted', text: 'No errors in the last 24 hours.' }));
      } else {
        errorsCard.appendChild(h('table', {}, [
          h('tr', {}, [
            h('td', { text: 'Sign-in and account errors' }),
            h('td', { class: 'num', text: String(o.auth_errors_24h) }),
          ]),
          h('tr', {}, [
            h('td', { text: 'Login email delivery failures' }),
            h('td', { class: 'num', text: String(o.email_errors_24h) }),
          ]),
          h('tr', {}, [
            h('td', { text: 'Venice (AI provider) failures' }),
            h('td', { class: 'num', text: String(o.venice_errors_24h) }),
          ]),
        ]));
      }
      app.appendChild(errorsCard);
    }).catch(function (e) { app.innerHTML = ''; app.appendChild(h('p', { class: 'err', text: e.message })); });
  }

  function statusPill(status) {
    return h('span', { class: 'pill ' + (status === 'active' ? 'active' : 'suspended'), text: status });
  }

  function renderAccounts() {
    app.innerHTML = '';
    var q = h('input', { placeholder: 'username, exact email, or support id', style: 'width:320px' });
    var go = h('button', { class: 'btn primary', text: 'Search' });
    var results = h('div');
    var card = h('div', { class: 'card' }, [
      h('h2', { text: 'Accounts' }),
      h('div', { class: 'row', style: 'margin-bottom:12px' }, [q, go]),
      results,
    ]);
    app.appendChild(card);

    function load(offset) {
      results.innerHTML = '<p class="muted">Loading…</p>';
      var qs = '?offset=' + (offset || 0) + (q.value ? '&q=' + encodeURIComponent(q.value.trim()) : '');
      api('/admin/api/accounts' + qs).then(function (data) {
        results.innerHTML = '';
        var table = h('table', {}, [
          h('tr', {}, [
            h('th', { text: 'Support id' }), h('th', { text: 'Display name' }), h('th', { text: 'Email' }),
            h('th', { text: 'Status' }), h('th', { text: 'Plan' }), h('th', { text: 'Quota' }), h('th', { text: 'Created' }),
          ]),
        ]);
        data.accounts.forEach(function (acc) {
          var tr = h('tr', { class: 'clickable' }, [
            h('td', { text: acc.support_id }),
            h('td', { text: acc.display_name || '—' }),
            h('td', { text: acc.email_masked || '—' }),
            h('td', {}, [statusPill(acc.status)]),
            h('td', { text: acc.plan }),
            h('td', { text: acc.cloud_requests_used + ' / ' + acc.cloud_requests_limit }),
            h('td', { text: fmtTime(acc.created_at) }),
          ]);
          tr.addEventListener('click', function () { state.view = 'account'; state.detail = acc.support_id; render(); });
          table.appendChild(tr);
        });
        results.appendChild(table);
        if (data.next_offset !== null) {
          var more = h('button', { class: 'btn', text: 'Load more', style: 'margin-top:10px' });
          more.addEventListener('click', function () { load(data.next_offset); });
          results.appendChild(more);
        }
      }).catch(function (e) { results.innerHTML = ''; results.appendChild(h('p', { class: 'err', text: e.message })); });
    }
    go.addEventListener('click', function () { load(0); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(0); });
    load(0);
  }

  function renderAccountDetail(id) {
    app.innerHTML = '<p class="muted">Loading…</p>';
    api('/admin/api/accounts/' + encodeURIComponent(id)).then(function (a) {
      app.innerHTML = '';
      var msg = h('div');
      function withMsg(promise) {
        msg.textContent = '';
        return promise.then(function () { msg.className = 'ok'; msg.textContent = 'Done.'; renderAccountDetail(id); })
          .catch(function (e) { msg.className = 'err'; msg.textContent = e.message; });
      }
      var back = h('button', { class: 'btn', text: '← Back to accounts' });
      back.addEventListener('click', function () { state.view = 'accounts'; render(); });
      app.appendChild(back);

      var identities = h('ul');
      a.login_methods.forEach(function (m) {
        identities.appendChild(h('li', { text: m.provider + ' — ' + m.label + ' (last used ' + fmtTime(m.last_used_at) + ')' }));
      });

      var errors = h('ul');
      (a.recent_errors || []).forEach(function (e) {
        errors.appendChild(h('li', { text: '[' + e.category + '] ' + e.code + ' (' + e.status + ') · ' + fmtTime(e.created_at) }));
      });
      if (!a.recent_errors || a.recent_errors.length === 0) errors.appendChild(h('li', { class: 'muted', text: 'None' }));

      var reason = h('input', { placeholder: 'Reason (required)', style: 'width:260px' });
      var suspendBtn = h('button', { class: 'btn danger', text: a.status === 'active' ? 'Suspend' : 'Reactivate' });
      suspendBtn.addEventListener('click', function () {
        if (!reason.value.trim()) { msg.className = 'err'; msg.textContent = 'A reason is required.'; return; }
        var path = a.status === 'active' ? 'suspend' : 'reactivate';
        withMsg(api('/admin/api/accounts/' + encodeURIComponent(id) + '/' + path, {
          method: 'POST', body: JSON.stringify({ reason: reason.value.trim() }),
        }));
      });

      var creditDelta = h('input', { type: 'number', placeholder: 'e.g. 10 or -5', style: 'width:120px' });
      var creditReason = h('input', { placeholder: 'Reason (required)', style: 'width:260px' });
      var creditBtn = h('button', { class: 'btn primary', text: 'Apply credit change' });
      creditBtn.addEventListener('click', function () {
        if (!creditReason.value.trim()) { msg.className = 'err'; msg.textContent = 'A reason is required.'; return; }
        withMsg(api('/admin/api/accounts/' + encodeURIComponent(id) + '/credits', {
          method: 'POST',
          body: JSON.stringify({ delta: Number(creditDelta.value), reason: creditReason.value.trim() }),
        }));
      });

      var confirmDelete = h('input', { placeholder: 'Type "' + a.support_id + '" to confirm', style: 'width:260px' });
      var deletePassword = h('input', { type: 'password', placeholder: 'Your admin password', style: 'width:200px' });
      var deleteBtn = h('button', { class: 'btn danger', text: 'Permanently delete account' });
      deleteBtn.addEventListener('click', function () {
        if (!confirm('This permanently deletes ' + a.support_id + ' and all server-side metadata. Continue?')) return;
        api('/admin/api/accounts/' + encodeURIComponent(id), {
          method: 'DELETE',
          body: JSON.stringify({
            confirm: confirmDelete.value.trim(),
            admin_password: deletePassword.value,
          }),
        }).then(function () { state.view = 'accounts'; render(); })
          .catch(function (e) { msg.className = 'err'; msg.textContent = e.message; });
      });

      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: a.support_id }),
        h('p', {}, [statusPill(a.status)]),
        h('table', {}, [
          h('tr', {}, [h('td', { text: 'Display name' }), h('td', { text: a.display_name || '—' })]),
          h('tr', {}, [h('td', { text: 'Email' }), h('td', { text: a.email_masked || '—' })]),
          h('tr', {}, [h('td', { text: 'Plan' }), h('td', { text: a.plan })]),
          h('tr', {}, [h('td', { text: 'Quota' }), h('td', { text: a.cloud_requests_used + ' / ' + a.cloud_requests_limit + ' (remaining ' + a.cloud_requests_remaining + ')' })]),
          h('tr', {}, [h('td', { text: 'Deep research credits' }), h('td', { text: String(a.deep_research_credits) })]),
          h('tr', {}, [h('td', { text: 'Last activity' }), h('td', { text: fmtTime(a.last_activity_at) })]),
          h('tr', {}, [h('td', { text: 'Internal id' }), h('td', {}, [h('code', { text: a.internal_id })])]),
        ]),
      ]));
      app.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Login methods' }), identities]));
      app.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Recent technical errors' }), errors, h('p', { class: 'muted', text: 'No prompts, AI responses, IP addresses, or wallet data are ever stored here.' })]));
      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Operator tools' }),
        h('div', { class: 'row', style: 'margin-bottom:10px' }, [reason, suspendBtn]),
        h('div', { class: 'row', style: 'margin-bottom:10px' }, [creditDelta, creditReason, creditBtn]),
        h('div', { class: 'row' }, [confirmDelete, deletePassword, deleteBtn]),
        msg,
      ]));
    }).catch(function (e) { app.innerHTML = ''; app.appendChild(h('p', { class: 'err', text: e.message })); });
  }

  var BAR_CELLS = 40;

  // A horizontal bar drawn as discrete cells. Rounding up means any non-zero
  // value lights at least one cell, so a small-but-real number never renders
  // as an empty row.
  function allZero(values) {
    return values.every(function (v) { return !v; });
  }

  function bar(label, value, max, tone) {
    var filled = max > 0 ? Math.ceil((value / max) * BAR_CELLS) : 0;
    var strip = h('div', { class: 'pxbar' });
    for (var i = 0; i < BAR_CELLS; i += 1) {
      strip.appendChild(h('div', {
        class: 'pxcell' + (i < filled ? ' on' + (tone ? ' ' + tone : '') : ''),
      }));
    }
    return h('div', { class: 'pxrow' }, [
      h('div', { class: 'lbl' }, [
        h('span', { text: label }),
        h('span', { text: String(value) }),
      ]),
      strip,
    ]);
  }

  // Turn a {day, count} series from the API into labelled chart points.
  function toPoints(series) {
    return (series || []).map(function (row) {
      return {
        label: new Date(row.day * 86400000).toISOString().slice(5, 10),
        count: row.count,
      };
    });
  }

  // A per-day series drawn as stacked pixel segments.
  // Round a maximum up to a value that divides cleanly, so the axis reads
  // 0 / 10 / 20 rather than 0 / 10.5 / 21.
  function niceMax(value) {
    if (value <= 5) return 5;
    var magnitude = Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i += 1) {
      var candidate = steps[i] * magnitude;
      if (candidate >= value) return Math.ceil(candidate);
    }
    return Math.ceil(value);
  }

  /**
   * A daily bar chart with a real scale.
   *
   * The bars keep Alice's pixel look through a repeating gradient rather than
   * a stack of placeholder blocks: the old version drew every empty segment
   * in the border colour, which filled the plot with dark noise and made a
   * quiet day indistinguishable from a busy one. Here an empty day is simply
   * empty, and the axis says what the heights mean.
   */
  function columns(points, unit) {
    if (points.length === 0) {
      return h('p', { class: 'muted', text: 'No data yet.' });
    }
    var peak = points.reduce(function (m, p) { return Math.max(m, p.count); }, 0);
    if (peak === 0) {
      return h('p', { class: 'muted', text: 'Nothing recorded in this period yet.' });
    }
    var total = points.reduce(function (sum, p) { return sum + p.count; }, 0);
    var top = niceMax(peak);

    var tip = h('div', { class: 'chart-tip' });
    var bars = h('div', { class: 'chart-bars' });

    points.forEach(function (p, index) {
      var fill = h('div', { class: 'chart-fill' });
      // Start flat and grow on the next frame, staggered, so the chart reads
      // as data arriving rather than appearing fully formed.
      fill.style.height = '0%';
      var target = (p.count / top) * 100;
      setTimeout(function () { fill.style.height = target + '%'; }, 20 + index * 12);

      var bar = h('div', { class: 'chart-bar' + (p.count === 0 ? ' empty' : '') }, [fill]);
      bar.addEventListener('mouseenter', function () {
        bar.classList.add('hot');
        tip.textContent = p.label + ' · ' + p.count + ' ' + unit;
        tip.style.opacity = '1';
        // Anchor the tooltip over the hovered bar, clamped inside the plot so
        // the first and last days stay readable.
        var pct = (index + 0.5) / points.length * 100;
        tip.style.left = Math.min(92, Math.max(8, pct)) + '%';
      });
      bar.addEventListener('mouseleave', function () {
        bar.classList.remove('hot');
        tip.style.opacity = '0';
      });
      bars.appendChild(bar);
    });

    var plot = h('div', { class: 'chart-plot' }, [
      h('div', { class: 'chart-grid', style: 'bottom:100%' }),
      h('div', { class: 'chart-grid', style: 'bottom:50%' }),
      bars,
      tip,
    ]);

    var axis = h('div', { class: 'chart-y' }, [
      h('span', { text: String(top) }),
      h('span', { text: String(Math.round(top / 2)) }),
      h('span', { text: '0' }),
    ]);

    // Only a few date labels: thirty of them would be unreadable, and the
    // tooltip gives the exact day on hover anyway.
    var ticks = h('div', { class: 'chart-x' });
    var wanted = [0, Math.floor(points.length / 2), points.length - 1];
    points.forEach(function (p, index) {
      ticks.appendChild(h('span', {
        text: wanted.indexOf(index) >= 0 ? p.label : '',
      }));
    });

    return h('div', {}, [
      h('div', { class: 'chart' }, [axis, plot]),
      ticks,
      h('p', { class: 'chart-summary' }, [
        h('span', { text: total + ' ' + unit + ' over ' + points.length + ' days' }),
        h('span', { text: 'busiest day ' + peak }),
      ]),
    ]);
  }

  function renderOverview() {
    app.innerHTML = '<p class="muted">Loading…</p>';
    api('/admin/api/overview').then(function (o) {
      app.innerHTML = '';

      app.appendChild(h('div', { class: 'grid grid-3' }, [
        heroCard(
          o.accounts_created, 'Accounts',
          'People who created an Alice account with a login. Excludes anonymous app installs.',
          o.accounts_change_percent,
        ),
        heroCard(
          o.installations_total, 'App installations',
          'Devices that have opened Alice. ' + o.installations_active_7d
            + ' active in the last 7 days, ' + o.installations_anonymous
            + ' still browsing without an account.',
          o.installations_change_percent,
        ),
        heroCard(
          o.requests_7d, 'AI requests · 7 days',
          'Private Cloud requests that actually reached Venice and succeeded. ' + o.requests_total + ' since launch.',
          o.requests_change_percent,
        ),
      ]));

      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'AI requests per day · 30 days' }),
        columns(toPoints(o.series.requests), 'requests'),
      ]));

      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'New installations per day · 30 days' }),
        columns(toPoints(o.series.installations), 'installations'),
      ]));

      var freeUse = h('table', {}, [
        h('tr', {}, [
          h('td', { text: 'AI requests today (24h)' }),
          h('td', { class: 'num', text: String(o.requests_24h) }),
        ]),
        h('tr', {}, [
          h('td', { text: 'Free requests consumed, all accounts' }),
          h('td', { class: 'num', text: String(o.free_requests_used_total) }),
        ]),
        h('tr', {}, [
          h('td', { text: 'Accounts that used at least one free request' }),
          h('td', { class: 'num', text: String(o.accounts_with_free_usage) }),
        ]),
        h('tr', {}, [
          h('td', { text: 'Accounts that used all 21 free requests' }),
          h('td', { class: 'num', text: String(o.accounts_at_quota) }),
        ]),
      ]);
      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Free quota' }),
        h('p', { class: 'muted', text: 'Every Alice user gets 21 free Private Cloud requests. These are the numbers that tell you whether 21 is the right figure.' }),
        freeUse,
      ]));

      var errorTotal = o.auth_errors_24h + o.email_errors_24h + o.venice_errors_24h;
      var errorsCard = h('div', { class: 'card' }, [
        h('h2', { text: 'Errors · last 24 hours' }),
      ]);
      if (errorTotal === 0) {
        errorsCard.appendChild(h('p', { class: 'muted', text: 'No errors in the last 24 hours.' }));
      } else {
        errorsCard.appendChild(h('table', {}, [
          h('tr', {}, [
            h('td', { text: 'Sign-in and account errors' }),
            h('td', { class: 'num', text: String(o.auth_errors_24h) }),
          ]),
          h('tr', {}, [
            h('td', { text: 'Login email delivery failures' }),
            h('td', { class: 'num', text: String(o.email_errors_24h) }),
          ]),
          h('tr', {}, [
            h('td', { text: 'Venice (AI provider) failures' }),
            h('td', { class: 'num', text: String(o.venice_errors_24h) }),
          ]),
        ]));
      }
      app.appendChild(errorsCard);
    }).catch(function (e) { app.innerHTML = ''; app.appendChild(h('p', { class: 'err', text: e.message })); });
  }

  function statusPill(status) {
    return h('span', { class: 'pill ' + (status === 'active' ? 'active' : 'suspended'), text: status });
  }

  function renderAccounts() {
    app.innerHTML = '';
    var q = h('input', { placeholder: 'username, exact email, or support id', style: 'width:320px' });
    var go = h('button', { class: 'btn primary', text: 'Search' });
    var results = h('div');
    var card = h('div', { class: 'card' }, [
      h('h2', { text: 'Accounts' }),
      h('div', { class: 'row', style: 'margin-bottom:12px' }, [q, go]),
      results,
    ]);
    app.appendChild(card);

    function load(offset) {
      results.innerHTML = '<p class="muted">Loading…</p>';
      var qs = '?offset=' + (offset || 0) + (q.value ? '&q=' + encodeURIComponent(q.value.trim()) : '');
      api('/admin/api/accounts' + qs).then(function (data) {
        results.innerHTML = '';
        var table = h('table', {}, [
          h('tr', {}, [
            h('th', { text: 'Support id' }), h('th', { text: 'Display name' }), h('th', { text: 'Email' }),
            h('th', { text: 'Status' }), h('th', { text: 'Plan' }), h('th', { text: 'Quota' }), h('th', { text: 'Created' }),
          ]),
        ]);
        data.accounts.forEach(function (acc) {
          var tr = h('tr', { class: 'clickable' }, [
            h('td', { text: acc.support_id }),
            h('td', { text: acc.display_name || '—' }),
            h('td', { text: acc.email_masked || '—' }),
            h('td', {}, [statusPill(acc.status)]),
            h('td', { text: acc.plan }),
            h('td', { text: acc.cloud_requests_used + ' / ' + acc.cloud_requests_limit }),
            h('td', { text: fmtTime(acc.created_at) }),
          ]);
          tr.addEventListener('click', function () { state.view = 'account'; state.detail = acc.support_id; render(); });
          table.appendChild(tr);
        });
        results.appendChild(table);
        if (data.next_offset !== null) {
          var more = h('button', { class: 'btn', text: 'Load more', style: 'margin-top:10px' });
          more.addEventListener('click', function () { load(data.next_offset); });
          results.appendChild(more);
        }
      }).catch(function (e) { results.innerHTML = ''; results.appendChild(h('p', { class: 'err', text: e.message })); });
    }
    go.addEventListener('click', function () { load(0); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(0); });
    load(0);
  }

  function renderAccountDetail(id) {
    app.innerHTML = '<p class="muted">Loading…</p>';
    api('/admin/api/accounts/' + encodeURIComponent(id)).then(function (a) {
      app.innerHTML = '';
      var msg = h('div');
      function withMsg(promise) {
        msg.textContent = '';
        return promise.then(function () { msg.className = 'ok'; msg.textContent = 'Done.'; renderAccountDetail(id); })
          .catch(function (e) { msg.className = 'err'; msg.textContent = e.message; });
      }
      var back = h('button', { class: 'btn', text: '← Back to accounts' });
      back.addEventListener('click', function () { state.view = 'accounts'; render(); });
      app.appendChild(back);

      var identities = h('ul');
      a.login_methods.forEach(function (m) {
        identities.appendChild(h('li', { text: m.provider + ' — ' + m.label + ' (last used ' + fmtTime(m.last_used_at) + ')' }));
      });

      var errors = h('ul');
      (a.recent_errors || []).forEach(function (e) {
        errors.appendChild(h('li', { text: '[' + e.category + '] ' + e.code + ' (' + e.status + ') · ' + fmtTime(e.created_at) }));
      });
      if (!a.recent_errors || a.recent_errors.length === 0) errors.appendChild(h('li', { class: 'muted', text: 'None' }));

      var reason = h('input', { placeholder: 'Reason (required)', style: 'width:260px' });
      var suspendBtn = h('button', { class: 'btn danger', text: a.status === 'active' ? 'Suspend' : 'Reactivate' });
      suspendBtn.addEventListener('click', function () {
        if (!reason.value.trim()) { msg.className = 'err'; msg.textContent = 'A reason is required.'; return; }
        var path = a.status === 'active' ? 'suspend' : 'reactivate';
        withMsg(api('/admin/api/accounts/' + encodeURIComponent(id) + '/' + path, {
          method: 'POST', body: JSON.stringify({ reason: reason.value.trim() }),
        }));
      });

      var creditDelta = h('input', { type: 'number', placeholder: 'e.g. 10 or -5', style: 'width:120px' });
      var creditReason = h('input', { placeholder: 'Reason (required)', style: 'width:260px' });
      var creditBtn = h('button', { class: 'btn primary', text: 'Apply credit change' });
      creditBtn.addEventListener('click', function () {
        if (!creditReason.value.trim()) { msg.className = 'err'; msg.textContent = 'A reason is required.'; return; }
        withMsg(api('/admin/api/accounts/' + encodeURIComponent(id) + '/credits', {
          method: 'POST',
          body: JSON.stringify({ delta: Number(creditDelta.value), reason: creditReason.value.trim() }),
        }));
      });

      var confirmDelete = h('input', { placeholder: 'Type "' + a.support_id + '" to confirm', style: 'width:260px' });
      var deletePassword = h('input', { type: 'password', placeholder: 'Your admin password', style: 'width:200px' });
      var deleteBtn = h('button', { class: 'btn danger', text: 'Permanently delete account' });
      deleteBtn.addEventListener('click', function () {
        if (!confirm('This permanently deletes ' + a.support_id + ' and all server-side metadata. Continue?')) return;
        api('/admin/api/accounts/' + encodeURIComponent(id), {
          method: 'DELETE',
          body: JSON.stringify({
            confirm: confirmDelete.value.trim(),
            admin_password: deletePassword.value,
          }),
        }).then(function () { state.view = 'accounts'; render(); })
          .catch(function (e) { msg.className = 'err'; msg.textContent = e.message; });
      });

      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: a.support_id }),
        h('p', {}, [statusPill(a.status)]),
        h('table', {}, [
          h('tr', {}, [h('td', { text: 'Display name' }), h('td', { text: a.display_name || '—' })]),
          h('tr', {}, [h('td', { text: 'Email' }), h('td', { text: a.email_masked || '—' })]),
          h('tr', {}, [h('td', { text: 'Plan' }), h('td', { text: a.plan })]),
          h('tr', {}, [h('td', { text: 'Quota' }), h('td', { text: a.cloud_requests_used + ' / ' + a.cloud_requests_limit + ' (remaining ' + a.cloud_requests_remaining + ')' })]),
          h('tr', {}, [h('td', { text: 'Deep research credits' }), h('td', { text: String(a.deep_research_credits) })]),
          h('tr', {}, [h('td', { text: 'Last activity' }), h('td', { text: fmtTime(a.last_activity_at) })]),
          h('tr', {}, [h('td', { text: 'Internal id' }), h('td', {}, [h('code', { text: a.internal_id })])]),
        ]),
      ]));
      app.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Login methods' }), identities]));
      app.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Recent technical errors' }), errors, h('p', { class: 'muted', text: 'No prompts, AI responses, IP addresses, or wallet data are ever stored here.' })]));
      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Operator tools' }),
        h('div', { class: 'row', style: 'margin-bottom:10px' }, [reason, suspendBtn]),
        h('div', { class: 'row', style: 'margin-bottom:10px' }, [creditDelta, creditReason, creditBtn]),
        h('div', { class: 'row' }, [confirmDelete, deletePassword, deleteBtn]),
        msg,
      ]));
    }).catch(function (e) { app.innerHTML = ''; app.appendChild(h('p', { class: 'err', text: e.message })); });
  }

  var BAR_CELLS = 40;

  // A horizontal bar drawn as discrete cells. Rounding up means any non-zero
  // value lights at least one cell, so a small-but-real number never renders
  // as an empty row.
  function allZero(values) {
    return values.every(function (v) { return !v; });
  }

  function bar(label, value, max, tone) {
    var filled = max > 0 ? Math.ceil((value / max) * BAR_CELLS) : 0;
    var strip = h('div', { class: 'pxbar' });
    for (var i = 0; i < BAR_CELLS; i += 1) {
      strip.appendChild(h('div', {
        class: 'pxcell' + (i < filled ? ' on' + (tone ? ' ' + tone : '') : ''),
      }));
    }
    return h('div', { class: 'pxrow' }, [
      h('div', { class: 'lbl' }, [
        h('span', { text: label }),
        h('span', { text: String(value) }),
      ]),
      strip,
    ]);
  }

  // Turn a {day, count} series from the API into labelled chart points.
  function toPoints(series) {
    return (series || []).map(function (row) {
      return {
        label: new Date(row.day * 86400000).toISOString().slice(5, 10),
        count: row.count,
      };
    });
  }


  function renderAnalytics() {
    app.innerHTML = '<p class="muted">Loading…</p>';
    api('/admin/api/analytics').then(function (a) {
      app.innerHTML = '';

      var r = a.retention;
      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Retention (installations)' }),
        h('p', { class: 'muted', text: 'Share of installations still seen N days after first contact. Only installations old enough to qualify are counted.' }),
        h('div', { class: 'grid' }, [
          statCard((r.d1.percent === null ? '—' : r.d1.percent + '%'), 'D1 · ' + r.d1.retained + '/' + r.d1.eligible),
          statCard((r.d7.percent === null ? '—' : r.d7.percent + '%'), 'D7 · ' + r.d7.retained + '/' + r.d7.eligible),
          statCard((r.d30.percent === null ? '—' : r.d30.percent + '%'), 'D30 · ' + r.d30.retained + '/' + r.d30.eligible),
        ]),
      ]));

      var f = a.funnel;
      var steps = [
        ['Installations', f.installs],
        ['1st cloud request', f.made_first_request],
        ['10th cloud request', f.made_ten_requests],
        ['Quota exhausted', f.exhausted_quota],
        ['Account created', f.created_account],
      ];
      var funnelCard = h('div', { class: 'card' }, [
        h('h2', { text: 'Activation funnel' }),
        h('p', { class: 'muted', text: 'Aggregate only — computed from write-once installation milestones, never a per-user timeline.' }),
      ]);
      // Milestones only began recording when the feature shipped, so older
      // installations have no data. Say that outright rather than let the
      // steps read as "nobody ever made a request".
      var untracked = f.installs - (f.tracked || 0);
      if (untracked > 0) {
        funnelCard.appendChild(h('p', {
          class: 'muted',
          style: 'color:var(--alice-warn)',
          text: untracked + ' of ' + f.installs + ' installations predate milestone tracking'
            + (f.tracking_since
              ? ' (started ' + new Date(f.tracking_since).toLocaleDateString() + ')'
              : '')
            + ' and show as zero at every step. Only the '
            + (f.tracked || 0) + ' newer ones can be measured; this corrects itself as they replace the old ones.',
        }));
      }
      steps.forEach(function (s) { funnelCard.appendChild(bar(s[0], s[1], f.installs)); });
      app.appendChild(funnelCard);

      var q = a.quota_histogram;
      var qSteps = [
        ['0 requests used', q.used_none, null],
        ['1–5', q.used_1_5, null],
        ['6–10', q.used_6_10, null],
        ['11–20', q.used_11_20, 'warn'],
        ['Exhausted', q.exhausted, 'danger'],
      ];
      var qMax = qSteps.reduce(function (m, s) { return Math.max(m, s[1]); }, 0);
      var qCard = h('div', { class: 'card' }, [
        h('h2', { text: 'Free quota consumption' }),
        h('p', { class: 'muted', text: 'Is 21 the right number?' }),
      ]);
      qSteps.forEach(function (s) { qCard.appendChild(bar(s[0], s[1], qMax, s[2])); });
      app.appendChild(qCard);

      var relTable = h('table', {}, [h('tr', {}, [h('th', { text: 'Ledger status' }), h('th', { text: 'Count (7d)' })])]);
      (a.reliability || []).forEach(function (row) {
        relTable.appendChild(h('tr', {}, [h('td', { text: row.status }), h('td', { text: String(row.count) })]));
      });
      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Venice reliability' }),
        h('p', { class: 'muted', text: 'A refunded request means the upstream call failed and the user was not charged a free request.' }),
        relTable,
      ]));

      var errTable = h('table', {}, [h('tr', {}, [h('th', { text: 'Category' }), h('th', { text: 'Code' }), h('th', { text: 'Count (7d)' })])]);
      (a.errors_by_code || []).forEach(function (row) {
        errTable.appendChild(h('tr', {}, [h('td', { text: row.category }), h('td', { text: row.code }), h('td', { text: String(row.count) })]));
      });
      app.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Errors by code' }), errTable]));

      var reqPoints = (a.requests_by_day || []).map(function (row) {
        return {
          label: new Date(row.day * 86400000).toISOString().slice(5, 10),
          count: row.count,
        };
      });
      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Cloud requests per day (30d)' }),
        columns(reqPoints, 'confirmed'),
      ]));

      var pfTable = h('table', {}, [h('tr', {}, [h('th', { text: 'Platform' }), h('th', { text: 'Version' }), h('th', { text: 'Installations' })])]);
      (a.platforms || []).forEach(function (row) {
        pfTable.appendChild(h('tr', {}, [h('td', { text: row.platform }), h('td', { text: row.app_version }), h('td', { text: String(row.count) })]));
      });
      app.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Platforms and versions' }), pfTable]));
    }).catch(function (e) { app.innerHTML = ''; app.appendChild(h('p', { class: 'err', text: e.message })); });
  }

  function renderEvents() {
    app.innerHTML = '<p class="muted">Loading…</p>';
    api('/admin/api/events?days=30').then(function (data) {
      app.innerHTML = '';
      var table = h('table', {}, [h('tr', {}, [h('th', { text: 'Event' }), h('th', { text: 'Platform' }), h('th', { text: 'Version' }), h('th', { text: 'Count (30d)' })])]);
      (data.totals || []).forEach(function (row) {
        table.appendChild(h('tr', {}, [
          h('td', { text: row.event_name }),
          h('td', { text: row.platform || '—' }),
          h('td', { text: row.app_version || '—' }),
          h('td', { text: String(row.count) }),
        ]));
      });
      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Product events (aggregate)' }),
        h('p', { class: 'muted', text: 'Day-resolution counters only. No user id, no session id, no ordering between events — an individual journey cannot be reconstructed from this data.' }),
        table,
      ]));
      app.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Allowed event names' }),
        h('p', { class: 'muted', text: (data.known_event_names || []).join(', ') }),
        h('p', { class: 'muted', text: 'Anything not on this server-side allowlist is discarded on ingest, so no client-supplied string can reach storage.' }),
      ]));
    }).catch(function (e) { app.innerHTML = ''; app.appendChild(h('p', { class: 'err', text: e.message })); });
  }

  function renderAudit() {
    app.innerHTML = '<p class="muted">Loading…</p>';
    api('/admin/api/audit-log').then(function (data) {
      app.innerHTML = '';
      var table = h('table', {}, [
        h('tr', {}, [h('th', { text: 'When' }), h('th', { text: 'Actor' }), h('th', { text: 'Action' }), h('th', { text: 'Target' }), h('th', { text: 'Details' })]),
      ]);
      data.entries.forEach(function (e) {
        table.appendChild(h('tr', {}, [
          h('td', { text: fmtTime(e.created_at) }),
          h('td', { text: e.actor_support_id }),
          h('td', { text: e.action }),
          h('td', { text: e.target_support_id || '—' }),
          h('td', { text: JSON.stringify(e.metadata) }),
        ]));
      });
      app.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Audit log' }), table]));
    }).catch(function (e) { app.innerHTML = ''; app.appendChild(h('p', { class: 'err', text: e.message })); });
  }

  function renderPromos() {
    app.innerHTML = '';
    var msg = h('div');
    var code = h('input', { placeholder: 'Code (optional, auto-generated)' });
    var credits = h('input', { type: 'number', placeholder: 'Credits', value: '21' });
    var maxRedemptions = h('input', { type: 'number', placeholder: 'Max redemptions', value: '1' });
    var expiresInDays = h('input', { type: 'number', placeholder: 'Expires in days (optional)' });
    var createBtn = h('button', { class: 'btn primary', text: 'Create' });
    var list = h('div');
    function load() {
      list.innerHTML = '<p class="muted">Loading…</p>';
      api('/admin/api/promo-codes').then(function (data) {
        list.innerHTML = '';
        var table = h('table', {}, [
          h('tr', {}, [h('th', { text: 'Code' }), h('th', { text: 'Credits' }), h('th', { text: 'Redeemed' }), h('th', { text: 'Expires' }), h('th', { text: 'Status' }), h('th', {})]),
        ]);
        data.promo_codes.forEach(function (p) {
          var disableBtn = h('button', { class: 'btn', text: 'Disable' });
          disableBtn.disabled = Boolean(p.disabled_at);
          disableBtn.addEventListener('click', function () {
            api('/admin/api/promo-codes/' + encodeURIComponent(p.code) + '/disable', { method: 'POST' }).then(load);
          });
          table.appendChild(h('tr', {}, [
            h('td', {}, [h('code', { text: p.code })]),
            h('td', { text: String(p.credits) }),
            h('td', { text: p.redemptions_count + ' / ' + p.max_redemptions }),
            h('td', { text: fmtTime(p.expires_at) }),
            h('td', { text: p.disabled_at ? 'disabled' : 'active' }),
            h('td', {}, [disableBtn]),
          ]));
        });
        list.appendChild(table);
      }).catch(function (e) { list.innerHTML = ''; list.appendChild(h('p', { class: 'err', text: e.message })); });
    }
    createBtn.addEventListener('click', function () {
      msg.textContent = '';
      api('/admin/api/promo-codes', {
        method: 'POST',
        body: JSON.stringify({
          code: code.value.trim() || undefined,
          credits: Number(credits.value),
          max_redemptions: Number(maxRedemptions.value),
          expires_in_days: expiresInDays.value ? Number(expiresInDays.value) : undefined,
        }),
      }).then(function () { code.value = ''; load(); })
        .catch(function (e) { msg.className = 'err'; msg.textContent = e.message; });
    });
    app.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: 'Create promo code' }),
      // The redeem field was removed from both apps for the beta, so a code
      // created here cannot currently be entered by anyone. Say so on the
      // screen rather than letting an operator hand out a dead code.
      h('p', {
        class: 'muted',
        style: 'color:var(--alice-warn)',
        text: 'Codes cannot be redeemed right now: the promo field is not shown in the apps '
          + 'during the beta. To give an account more requests, open it under Accounts and '
          + 'adjust its credits directly.',
      }),
      h('div', { class: 'row' }, [code, credits, maxRedemptions, expiresInDays, createBtn]),
      msg,
    ]));
    app.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Promo codes' }), list]));
    load();
  }

  function renderAdmins() {
    app.innerHTML = '';
    var msg = h('div');
    var account = h('input', { placeholder: 'username or support id' });
    var roleSelect = h('select', {}, [
      h('option', { value: 'admin', text: 'admin (full access)' }),
      h('option', { value: 'support', text: 'support (read-only)' }),
    ]);
    var promotePassword = h('input', { type: 'password', placeholder: 'Your admin password', style: 'width:200px' });
    var promoteBtn = h('button', { class: 'btn primary', text: 'Grant access' });
    var list = h('div');
    function load() {
      list.innerHTML = '<p class="muted">Loading…</p>';
      api('/admin/api/admins').then(function (data) {
        list.innerHTML = '';
        var table = h('table', {}, [h('tr', {}, [h('th', { text: 'Support id' }), h('th', { text: 'Role' }), h('th', { text: 'Granted' }), h('th', {})])]);
        data.admins.forEach(function (a) {
          var demoteBtn = h('button', { class: 'btn', text: 'Revoke' });
          demoteBtn.addEventListener('click', function () {
            if (!confirm('Remove dashboard access for ' + a.support_id + '?')) return;
            api('/admin/api/admins/' + encodeURIComponent(a.support_id), {
              method: 'DELETE',
              body: JSON.stringify({ admin_password: promotePassword.value }),
            }).then(load).catch(function (e) { msg.className = 'err'; msg.textContent = e.message; });
          });
          table.appendChild(h('tr', {}, [
            h('td', { text: a.support_id }),
            h('td', {}, [h('span', { class: 'pill ' + (a.role === 'admin' ? 'active' : ''), text: a.role })]),
            h('td', { text: fmtTime(a.granted_at) }),
            h('td', {}, [demoteBtn]),
          ]));
        });
        list.appendChild(table);
      }).catch(function (e) { list.innerHTML = ''; list.appendChild(h('p', { class: 'err', text: e.message })); });
    }
    promoteBtn.addEventListener('click', function () {
      msg.textContent = '';
      api('/admin/api/admins', { method: 'POST', body: JSON.stringify({ account: account.value.trim(), role: roleSelect.value, admin_password: promotePassword.value }) })
        .then(function () { account.value = ''; load(); })
        .catch(function (e) { msg.className = 'err'; msg.textContent = e.message; });
    });
    app.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: 'Grant dashboard access' }),
      h('p', { class: 'muted', text: 'support is read-only: it can see the overview, accounts and audit log, but cannot suspend, adjust credits, delete, or change roles.' }),
      h('div', { class: 'row' }, [account, roleSelect, promotePassword, promoteBtn]),
      msg,
    ]));
    app.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Current admins' }), list]));
    load();
  }

  function render() {
    if (!state.token) { renderLogin(); return; }
    nav.style.display = 'flex';
    var roleEl = document.getElementById('role');
    roleEl.textContent = state.role || '';
    roleEl.className = 'pill ' + (state.role === 'admin' ? 'active' : '');
    Array.prototype.forEach.call(nav.querySelectorAll('button[data-view]'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === state.view || (state.view === 'account' && b.getAttribute('data-view') === 'accounts'));
    });
    if (state.view === 'overview') renderOverview();
    else if (state.view === 'analytics') renderAnalytics();
    else if (state.view === 'events') renderEvents();
    else if (state.view === 'accounts') renderAccounts();
    else if (state.view === 'account') renderAccountDetail(state.detail);
    else if (state.view === 'audit') renderAudit();
    else if (state.view === 'promos') renderPromos();
    else if (state.view === 'admins') renderAdmins();
  }

  if (state.token) {
    api('/admin/api/session').then(function (s) { state.role = s.role; render(); })
      .catch(function () { setToken(null); render(); });
  } else {
    render();
  }
})();
</script>
</body>
</html>
`;
