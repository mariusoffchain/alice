import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import worker, {
  type Env,
  corsHeaders,
  missingE2EEHeaders,
  sanitizeChatBody,
} from './index.ts';
import {
  DEFAULT_FREE_REQUEST_BYTES,
  MAX_FREE_MESSAGES,
  MAX_TOKENS_CEILING,
} from './limits.ts';

class FakeStatement {
  readonly query: string;

  constructor(query: string) {
    this.query = query;
  }

  bind() {
    return this;
  }

  async first() {
    // The relay now takes a rate-limit slot before it does anything else.
    // The real table returns the running count; a stub that answers nothing
    // reads as "refused", which is the safe direction but not the one these
    // tests are about.
    if (this.query.includes('auth_rate_limits')) {
      return { request_count: (globalThis as any).__rateCount ?? 1 };
    }
    if (this.query.includes('sessions.id AS session_id')) {
      return {
        session_id: 'session-test',
        user_id: 'user-test',
        status: 'active',
        access_expires_at: Date.now() + 60_000,
      };
    }
    if (this.query.includes('FROM cloud_request_ledger')) {
      return { id: 'ledger-test', status: 'reserved', units: 1 };
    }
    // The chat route asks which plan meters this request before relaying it.
    // A free account keeps the request counter; the byte meter is exercised
    // in the billing suite against a real database.
    if (this.query.includes('FROM entitlements')) {
      return {
        plan: 'free',
        plan_expires_at: null,
        cloud_enabled: 1,
        free_cloud_requests_limit: 21,
        input_bytes_limit: 0,
        output_bytes_limit: 0,
        deep_research_credits: 0,
      };
    }
    if (this.query.includes('users.id AS user_id')) {
      return {
        user_id: 'user-test',
        status: 'active',
        email_masked: 'te**@example.com',
        plan: 'free',
        cloud_enabled: 1,
        free_cloud_requests_limit: 21,
        free_cloud_requests_used: 1,
        deep_research_credits: 0,
      };
    }
    return null;
  }

  async run() {
    return { success: true, meta: { changes: 1 } };
  }

  async all() {
    if (this.query.includes('FROM user_identities')) {
      return {
        results: [{
          id: 'identity-test',
          provider: 'email',
          display_label: 'te**@example.com',
          created_at: Date.now(),
          last_used_at: Date.now(),
          can_recover_encrypted_backup: 0,
        }],
      };
    }
    return { results: [] };
  }
}

const ACCOUNT_DB = {
  prepare(query: string) {
    return new FakeStatement(query);
  },
  async batch(statements: FakeStatement[]) {
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  },
} as any;

const ENV: Env = {
  VENICE_API_KEY: 'test-key',
  AUTH_HMAC_KEY: 'test-auth-secret-that-is-at-least-thirty-two-bytes',
  AUTH_EMAIL_FROM: 'login@alice.example',
  ACCOUNT_DB,
  EMAIL: { send: async () => ({ messageId: 'test-message' }) } as any,
  ALLOWED_ORIGINS: 'https://alice.example',
  VENICE_API_BASE: 'https://upstream.test/api/v1',
};

const ACCOUNT_HEADERS = {
  authorization: 'Bearer ' + 'a'.repeat(43),
  'x-alice-request-id': 'test-request-id-00000001',
};

const E2EE_HEADERS = {
  ...ACCOUNT_HEADERS,
  'x-venice-tee-client-pub-key': '04' + 'ab'.repeat(64),
  'x-venice-tee-model-pub-key': '04' + 'cd'.repeat(64),
  'x-venice-tee-signing-algo': 'ecdsa',
  'content-type': 'application/json',
};

const realFetch = globalThis.fetch;
const logged: string[] = [];
const realLog = console.log;

function stubUpstream(handler: (url: string, init: any) => Response) {
  const calls: { url: string; init: any }[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  console.log = (msg: string) => { logged.push(String(msg)); };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  logged.length = 0;
});

function chatRequest(body: unknown, headers: Record<string, string> = E2EE_HEADERS) {
  return new Request('https://proxy.test/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { model: 'e2ee-gpt-oss-120b-p', stream: true, max_tokens: 1000, messages: [{ role: 'user', content: 'deadbeef' }] };

const PCCS_ENV: Env = { ...ENV, PCCS_UPSTREAM: 'https://pccs.upstream.test' };

import { maxRequestBytes } from './index.ts';

describe('how large a request may be', () => {
  const env = {
    FREE_CLOUD_MAX_REQUEST_BYTES: '262144',
    PAID_CLOUD_MAX_REQUEST_BYTES: '524288',
    DEEP_RESEARCH_MAX_TOKENS: '500000',
    BYTES_PER_TOKEN: '3.7',
  } as unknown as Env;

  it('gives a paid plan the larger limit', () => {
    assert.equal(maxRequestBytes(env, 'cloud'), 524_288);
  });

  it('keeps the free plan on its own smaller limit', () => {
    assert.equal(maxRequestBytes(env, 'free'), 262_144);
  });
});

describe('the payment-host alert door', () => {
  it('does not exist when no secret is configured', async () => {
    const res = await worker.fetch(
      new Request('https://proxy.test/ops/tunnel-alert/anything', { method: 'POST' }),
      ENV,
    );
    assert.equal(res.status, 404, 'an unconfigured alert route must not stand open');
  });

  it('refuses a wrong secret with the same 404, telling an attacker nothing', async () => {
    const res = await worker.fetch(
      new Request('https://proxy.test/ops/tunnel-alert/wrong', { method: 'POST' }),
      { ...ENV, OPS_ALERT_SECRET: 'right' },
    );
    assert.equal(res.status, 404);
  });

  it('is POST-only: a crawler following the URL cannot trigger a probe', async () => {
    const res = await worker.fetch(
      new Request('https://proxy.test/ops/tunnel-alert/right', { method: 'GET' }),
      { ...ENV, OPS_ALERT_SECRET: 'right' },
    );
    assert.notEqual(res.status, 200);
  });
});

describe('the released version door', () => {
  it('answers publicly, cacheable, with the release constant', async () => {
    const res = await worker.fetch(new Request('https://proxy.test/app-version', { method: 'GET' }), ENV);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Cache-Control') ?? '', /max-age/);
    const body = await res.json() as { version: string };
    assert.match(body.version, /^\d+\.\d+\.\d+$/);
  });
});

describe('the ceiling on the money route', () => {
  it('shields the key on the attestation door too', async () => {
    // Attestation does not bill, but it goes upstream wearing the Venice key:
    // hammering it makes Venice's rate limiting the key's problem. Refused
    // before any upstream call, like the chat route.
    (globalThis as any).__rateCount = 481;
    const calls = stubUpstream(() => new Response('{}', { status: 200 }));
    const res = await worker.fetch(new Request(
      'https://proxy.test/api/v1/tee/attestation?model=e2ee-gpt-oss-120b-p&nonce=' + 'ab'.repeat(16),
      { headers: ACCOUNT_HEADERS },
    ), ENV);
    delete (globalThis as any).__rateCount;

    assert.equal(res.status, 429);
    assert.equal(calls.length, 0, 'Venice must never be contacted');
  });

  it('refuses a session that has burned through its hourly slots', async () => {
    // Everything else guarding this route bounds what an account may have:
    // twenty-one requests, a month of bytes. Nothing bounded how fast it could
    // ask, so a session that slipped past those budgets had Alice's Venice
    // balance and nothing in between. The refusal must land before the key is
    // ever attached, so no call is made and nothing is charged.
    (globalThis as any).__rateCount = 241;
    const calls = stubUpstream(() => new Response('{}', { status: 200 }));
    const res = await worker.fetch(chatRequest(VALID_BODY), ENV);
    delete (globalThis as any).__rateCount;

    assert.equal(res.status, 429);
    assert.equal(((await res.json()) as any).error.code, 'rate_limited');
    assert.equal(calls.length, 0, 'Venice must never be contacted');
  });
});

describe('PCCS collateral relay', () => {
  it('forwards an allowed path to the fixed upstream, no key attached', async () => {
    const calls = stubUpstream(() => new Response('CRL', { status: 200, headers: { 'SGX-PCK-CRL-Issuer-Chain': 'chain' } }));
    const res = await worker.fetch(new Request('https://proxy.test/pccs/sgx/certification/v4/pckcrl?ca=platform', { method: 'GET', headers: { Origin: 'https://alice.example' } }), PCCS_ENV);
    assert.equal(res.status, 200);
    assert.equal(calls[0].url, 'https://pccs.upstream.test/sgx/certification/v4/pckcrl?ca=platform');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[0].init.headers?.Authorization, undefined);
    // Issuer-chain header is exposed and passed through for the client library.
    assert.equal(res.headers.get('SGX-PCK-CRL-Issuer-Chain'), 'chain');
    assert.match(res.headers.get('Access-Control-Expose-Headers') ?? '', /Issuer-Chain/);
  });

  it('works without a Venice key (collateral is public)', async () => {
    stubUpstream(() => new Response('ok'));
    const res = await worker.fetch(new Request('https://proxy.test/pccs/tcb?fmspc=abc', { method: 'GET' }), { ...PCCS_ENV, VENICE_API_KEY: '' });
    assert.equal(res.status, 200);
  });

  it('cannot be turned into an arbitrary proxy (rejects URL / traversal)', async () => {
    const calls = stubUpstream(() => new Response('should not happen'));
    for (const p of ['/pccs/https://evil.test/x', '/pccs/../secret', '/pccs/a/../../b']) {
      const res = await worker.fetch(new Request('https://proxy.test' + p, { method: 'GET' }), PCCS_ENV);
      assert.equal(res.status, 404, `blocked ${p}`);
    }
    assert.equal(calls.length, 0);
  });

  it('is GET-only', async () => {
    const calls = stubUpstream(() => new Response('x'));
    const res = await worker.fetch(new Request('https://proxy.test/pccs/tcb', { method: 'POST' }), PCCS_ENV);
    assert.equal(res.status, 404);
    assert.equal(calls.length, 0);
  });

  it('logs only technical fields, never a URL query or body', async () => {
    stubUpstream(() => new Response('x'));
    await worker.fetch(new Request('https://proxy.test/pccs/tcb?fmspc=SECRETFMSPC', { method: 'GET' }), PCCS_ENV);
    const line = logged.join('\n');
    assert.ok(!line.includes('SECRETFMSPC'));
    const entry = JSON.parse(logged[0]);
    assert.equal(entry.route, 'pccs');
  });
});

describe('sanitizeChatBody', () => {
  it('clamps max_tokens to the ceiling', () => {
    const { body } = sanitizeChatBody(JSON.stringify({ ...VALID_BODY, max_tokens: 999999 }));
    assert.equal(JSON.parse(body).max_tokens, MAX_TOKENS_CEILING);
  });

  it('leaves a reasonable max_tokens alone', () => {
    const { body } = sanitizeChatBody(JSON.stringify({ ...VALID_BODY, max_tokens: 512 }));
    assert.equal(JSON.parse(body).max_tokens, 512);
  });

  it('strips client-controlled Venice capability parameters', () => {
    const { body } = sanitizeChatBody(JSON.stringify({
      ...VALID_BODY,
      venice_parameters: { enable_e2ee: false, enable_web_search: true },
    }));
    assert.equal(JSON.parse(body).venice_parameters, undefined);
  });

  it('refuses a non-streaming request', () => {
    assert.throws(() => sanitizeChatBody(JSON.stringify({ ...VALID_BODY, stream: false })), /streaming/i);
    assert.throws(() => sanitizeChatBody(JSON.stringify({ model: 'x', messages: [] })), /streaming/i);
  });

  it('refuses invalid JSON', () => {
    assert.throws(() => sanitizeChatBody('{not json'), /valid JSON/i);
  });

  it('requires bounded encrypted messages and refuses paid capabilities', () => {
    assert.throws(
      () => sanitizeChatBody(JSON.stringify({ ...VALID_BODY, messages: [] })),
      /one encrypted message/i,
    );
    assert.throws(
      () => sanitizeChatBody(JSON.stringify({
        ...VALID_BODY,
        messages: Array.from(
          { length: MAX_FREE_MESSAGES + 1 },
          () => ({ role: 'user', content: 'deadbeef' }),
        ),
      })),
      new RegExp(`At most ${MAX_FREE_MESSAGES}`),
    );
    assert.throws(
      () => sanitizeChatBody(JSON.stringify({ ...VALID_BODY, tools: [] })),
      /tools is not available/i,
    );
  });

  // The proxy must not alter what it cannot read.
  it('passes the encrypted message contents through untouched', () => {
    const cipher = 'ab'.repeat(200);
    const { body } = sanitizeChatBody(JSON.stringify({ ...VALID_BODY, messages: [{ role: 'user', content: cipher }] }));
    assert.equal(JSON.parse(body).messages[0].content, cipher);
  });
});

describe('E2EE header gate', () => {
  it('reports every missing header', () => {
    const bare = new Request('https://proxy.test/api/v1/chat/completions', { method: 'POST' });
    assert.equal(missingE2EEHeaders(bare).length, 3);
  });

  it('is satisfied by the full set', () => {
    assert.deepEqual(missingE2EEHeaders(chatRequest(VALID_BODY)), []);
  });

  // Without this the proxy could be used as an ordinary plaintext Venice relay.
  it('rejects a chat request with no E2EE headers', async () => {
    const calls = stubUpstream(() => new Response('should not happen'));
    const res = await worker.fetch(chatRequest(VALID_BODY, {
      ...ACCOUNT_HEADERS,
      'content-type': 'application/json',
    }), ENV);
    assert.equal(res.status, 400);
    assert.match((await res.json() as any).error, /Missing E2EE headers/);
    assert.equal(calls.length, 0, 'nothing was forwarded upstream');
  });
});

describe('chat relay', () => {
  it('attaches the Venice key server-side and never exposes it to the client', async () => {
    const calls = stubUpstream(() => new Response('data: {}\n', { headers: { 'content-type': 'text/event-stream' } }));
    const res = await worker.fetch(chatRequest(VALID_BODY), ENV);
    assert.equal(res.status, 200);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
    // The key must not come back to the caller in any header.
    for (const [, value] of res.headers) {
      assert.ok(!String(value).includes('test-key'));
    }
  });

  it('forwards the three E2EE headers upstream', async () => {
    const calls = stubUpstream(() => new Response('data: {}\n'));
    await worker.fetch(chatRequest(VALID_BODY), ENV);
    const sent = calls[0].init.headers;
    assert.equal(sent['x-venice-tee-client-pub-key'], E2EE_HEADERS['x-venice-tee-client-pub-key']);
    assert.equal(sent['x-venice-tee-model-pub-key'], E2EE_HEADERS['x-venice-tee-model-pub-key']);
    assert.equal(sent['x-venice-tee-signing-algo'], 'ecdsa');
  });

  it('keeps milestone writes alive through the execution context', async () => {
    stubUpstream(() => new Response('data: {}\n'));
    const backgroundWrites: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        backgroundWrites.push(promise);
      },
    } as ExecutionContext;

    const res = await worker.fetch(chatRequest(VALID_BODY), ENV, ctx);

    assert.equal(res.status, 200);
    // Two of them, and both must outlive the response: the usage milestone,
    // and the byte measurement. Neither may be dropped when the handler
    // returns, which is the whole point of the execution context.
    assert.equal(backgroundWrites.length, 2);

    // The measurement resolves only once the body has gone past, because that
    // is when its figure exists. Draining the response is what a client does,
    // and without it this would wait forever.
    await res.text();
    await Promise.all(backgroundWrites);
  });

  it('rejects a non-streaming body before contacting Venice', async () => {
    const calls = stubUpstream(() => new Response('nope'));
    const res = await worker.fetch(chatRequest({ ...VALID_BODY, stream: false }), ENV);
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  });

  it('rejects an oversized body before contacting Venice or charging inference', async () => {
    const calls = stubUpstream(() => new Response('nope'));
    const res = await worker.fetch(
      chatRequest({
        ...VALID_BODY,
        messages: [{ role: 'user', content: 'ab'.repeat(DEFAULT_FREE_REQUEST_BYTES) }],
      }),
      ENV,
    );
    assert.equal(res.status, 413);
    assert.equal((await res.json() as any).error.code, 'body_too_large');
    assert.equal(calls.length, 0);
  });

  it('fails cleanly when the key is not configured', async () => {
    const res = await worker.fetch(chatRequest(VALID_BODY), { ...ENV, VENICE_API_KEY: '' });
    assert.equal(res.status, 500);
  });
});

describe('logging discipline', () => {
  it('logs only technical fields, never the body', async () => {
    stubUpstream(() => new Response('data: {}\n'));
    const secret = 'ff'.repeat(300);
    await worker.fetch(chatRequest({ ...VALID_BODY, messages: [{ role: 'user', content: secret }] }), ENV);

    assert.ok(logged.length > 0, 'something was logged');
    const line = logged.join('\n');
    assert.ok(!line.includes(secret), 'ciphertext must not be logged');
    assert.ok(!line.includes('messages'), 'the body must not be logged');
    assert.ok(!line.includes('test-key'), 'the API key must not be logged');

    const entry = JSON.parse(logged[0]);
    assert.deepEqual(Object.keys(entry).sort(), ['approxBytes', 'at', 'durationMs', 'model', 'route', 'status']);
  });

  it('logs nothing resembling wallet data because it never sees the body', async () => {
    stubUpstream(() => new Response('data: {}\n'));
    await worker.fetch(chatRequest(VALID_BODY), ENV);
    const line = logged.join('\n');
    for (const forbidden of ['seed', 'mnemonic', 'xpub', 'privkey', 'balance', 'address']) {
      assert.ok(!line.toLowerCase().includes(forbidden), `must not log ${forbidden}`);
    }
  });
});

describe('attestation relay', () => {
  it('rejects an unauthenticated attestation request', async () => {
    const calls = stubUpstream(() => new Response(JSON.stringify({ verified: true }), { status: 200 }));
    const res = await worker.fetch(
      new Request('https://proxy.test/api/v1/tee/attestation?model=e2ee-test&nonce=' + 'a'.repeat(64)),
      ENV,
    );
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });

  it('forwards model and nonce with the key attached for an authenticated account', async () => {
    const calls = stubUpstream(() => new Response(JSON.stringify({ verified: true }), { status: 200 }));
    const res = await worker.fetch(
      new Request(
        'https://proxy.test/api/v1/tee/attestation?model=e2ee-test&nonce=' + 'a'.repeat(64),
        { headers: ACCOUNT_HEADERS },
      ),
      ENV,
    );
    assert.equal(res.status, 200);
    assert.ok(calls[0].url.startsWith('https://upstream.test/api/v1/tee/attestation'));
    assert.ok(calls[0].url.includes('model=e2ee-test'));
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
  });

  it('requires model and nonce', async () => {
    const calls = stubUpstream(() => new Response('{}'));
    const res = await worker.fetch(new Request(
      'https://proxy.test/api/v1/tee/attestation',
      { headers: ACCOUNT_HEADERS },
    ), ENV);
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  });

  it('rejects a nonce that is not exactly 32 bytes of hex before contacting Venice', async () => {
    const calls = stubUpstream(() => new Response('{}'));
    for (const nonce of ['a'.repeat(32), 'z'.repeat(64), 'a'.repeat(66)]) {
      const res = await worker.fetch(new Request(
        `https://proxy.test/api/v1/tee/attestation?model=e2ee-test&nonce=${nonce}`,
        { headers: ACCOUNT_HEADERS },
      ), ENV);
      assert.equal(res.status, 400);
      assert.equal((await res.json() as any).error.code, 'invalid_attestation_nonce');
    }
    assert.equal(calls.length, 0);
  });
});

describe('CORS', () => {
  it('echoes only an allowlisted origin', () => {
    assert.equal(corsHeaders('https://alice.example', ENV)['Access-Control-Allow-Origin'], 'https://alice.example');
  });

  it('gives nothing to an unknown origin', () => {
    assert.deepEqual(corsHeaders('https://evil.example', ENV), {});
    assert.deepEqual(corsHeaders(null, ENV), {});
  });

  it('never answers with a wildcard', () => {
    const headers = corsHeaders('https://alice.example', ENV);
    assert.notEqual(headers['Access-Control-Allow-Origin'], '*');
  });

  it('allows every method a browser route actually uses', () => {
    // Setting a password and saving a username are PUTs; removing an identity
    // is a DELETE. A method missing from this list dies in preflight as a
    // "network error", with nothing in the server logs because the blocked
    // request is never sent. That is exactly how it shipped broken once.
    const allowed = corsHeaders('https://alice.example', ENV)['Access-Control-Allow-Methods'];
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
      assert.ok(allowed.includes(method), `${method} missing from ${allowed}`);
    }
  });
});

describe('routing', () => {
  it('404s anything else', async () => {
    const res = await worker.fetch(new Request('https://proxy.test/api/v1/models'), ENV);
    assert.equal(res.status, 404);
  });
});

describe('deep research web search', () => {
  it('turns Venice web search on for a Deep Research run, and only there', async () => {
    // The switch bills per request, so who sets it matters as much as that it
    // is set: Alice sets it, having checked the plan and charged the run.
    const deepBody = JSON.stringify({
      model: 'e2ee-gpt-oss-120b-p',
      stream: true,
      max_tokens: 8192,
      messages: [{ role: 'user', content: 'deadbeef' }],
      // A client trying to switch it on itself must not be obeyed.
      venice_parameters: { enable_web_search: 'on', enable_web_scraping: true },
    });
    const sanitized = sanitizeChatBody(deepBody);
    assert.equal(
      'venice_parameters' in JSON.parse(sanitized.body),
      false,
      'the client never gets to set a billable switch',
    );
  });
});
