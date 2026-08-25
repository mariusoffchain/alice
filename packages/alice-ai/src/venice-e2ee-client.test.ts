import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildEncryptedMessages,
  fetchAndVerifyAttestation,
  readEncryptedStream,
  streamE2EEChatCompletion,
} from './venice-e2ee-client.ts';
import { deriveSigningAddress } from './venice-attestation-verify.ts';
import type { ChainPolicy } from './venice-attestation-chain.ts';
import {
  VeniceE2EEError,
  decryptEnvelope,
  encryptToEnvelope,
  generateEphemeralKeyPair,
  parseEnvelope,
} from './venice-e2ee-crypto.ts';
import type { Message } from './llm';

/** Turns SSE text into the ReadableStream shape the reader expects. */
function sseStream(frames: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i >= frames.length) return { done: true, value: undefined };
          return { done: false, value: encoder.encode(frames[i++]) };
        },
      };
    },
  };
}

function encryptedFrame(clientPubKey: Uint8Array, text: string, extra: Record<string, unknown> = {}) {
  const envelope = encryptToEnvelope(clientPubKey, text);
  return `data: ${JSON.stringify({ choices: [{ delta: { content: envelope }, ...extra }] })}\n`;
}

describe('buildEncryptedMessages', () => {
  const messages: Message[] = [
    { role: 'system', content: 'You are Alice.' },
    { role: 'user', content: 'What is a UTXO?' },
    { role: 'assistant', content: 'A previous answer.' },
    { role: 'user', content: 'Explain more.' },
  ];

  it('encrypts every user and system message', () => {
    const model = generateEphemeralKeyPair();
    const built = buildEncryptedMessages(messages, model.publicKey, 'drop');
    for (const m of built) {
      assert.notEqual(m.content, 'You are Alice.');
      assert.notEqual(m.content, 'What is a UTXO?');
      // Each survives a round trip back to its plaintext.
      assert.doesNotThrow(() => parseEnvelope(m.content));
    }
    assert.equal(decryptEnvelope(model.secretKey, built[0].content), 'You are Alice.');
    assert.equal(decryptEnvelope(model.secretKey, built[1].content), 'What is a UTXO?');
    assert.notDeepEqual(
      parseEnvelope(built[0].content).peerPublicKey,
      parseEnvelope(built[1].content).peerPublicKey,
      'each message carries its own ephemeral public key',
    );
  });

  it('merges every system fragment into one leading encrypted message', () => {
    const model = generateEphemeralKeyPair();
    const built = buildEncryptedMessages([
      { role: 'user', content: 'Earlier question' },
      { role: 'system', content: 'Base policy' },
      { role: 'system', content: 'Retrieved context' },
      { role: 'user', content: 'Current question' },
    ], model.publicKey, 'drop');

    assert.deepEqual(built.map(message => message.role), ['system', 'user', 'user']);
    assert.equal(
      decryptEnvelope(model.secretKey, built[0].content),
      'Base policy\n\nRetrieved context',
    );
    assert.equal(decryptEnvelope(model.secretKey, built[1].content), 'Earlier question');
    assert.equal(decryptEnvelope(model.secretKey, built[2].content), 'Current question');
  });

  // The reason 'drop' is the default: Venice does not decrypt assistant turns,
  // so keeping them would push prior Alice replies through the proxy in clear.
  it('drops assistant history by default so no plaintext leaves the device', () => {
    const model = generateEphemeralKeyPair();
    const built = buildEncryptedMessages(messages, model.publicKey, 'drop');
    assert.equal(built.length, 3);
    assert.ok(built.every(m => m.role !== 'assistant'));
    const joined = built.map(m => m.content).join('');
    assert.ok(!joined.includes('A previous answer.'));
  });

  it('keeps assistant history in the clear only when explicitly asked', () => {
    const model = generateEphemeralKeyPair();
    const built = buildEncryptedMessages(messages, model.publicKey, 'plaintext');
    assert.equal(built.length, 4);
    const assistant = built.find(m => m.role === 'assistant');
    assert.equal(assistant?.content, 'A previous answer.');
  });
});

describe('readEncryptedStream', () => {
  it('decrypts and concatenates chunks, streaming each piece', async () => {
    const client = generateEphemeralKeyPair();
    const stream = sseStream([
      encryptedFrame(client.publicKey, 'Hello '),
      encryptedFrame(client.publicKey, 'world.'),
      'data: [DONE]\n',
    ]);
    const pieces: string[] = [];
    const result = await readEncryptedStream(stream, client.secretKey, c => pieces.push(c));
    assert.equal(result.content, 'Hello world.');
    assert.deepEqual(pieces, ['Hello ', 'world.']);
  });

  it('handles frames split across reads', async () => {
    const client = generateEphemeralKeyPair();
    const frame = encryptedFrame(client.publicKey, 'split me');
    const half = Math.floor(frame.length / 2);
    const stream = sseStream([frame.slice(0, half), frame.slice(half)]);
    const result = await readEncryptedStream(stream, client.secretKey);
    assert.equal(result.content, 'split me');
  });

  it('collects usage and the truncation flag', async () => {
    const client = generateEphemeralKeyPair();
    const stream = sseStream([
      encryptedFrame(client.publicKey, 'cut', { finish_reason: 'length' }),
      `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n`,
    ]);
    const result = await readEncryptedStream(stream, client.secretKey);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  // The single most important guarantee: a server that answers in the clear
  // must not be rendered as if the exchange had been encrypted.
  it('fails closed when the server returns plaintext instead of an envelope', async () => {
    const client = generateEphemeralKeyPair();
    const stream = sseStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'A UTXO is an unspent output.' } }] })}\n`,
    ]);
    await assert.rejects(() => readEncryptedStream(stream, client.secretKey), VeniceE2EEError);
  });

  it('fails closed on a chunk encrypted to somebody else', async () => {
    const client = generateEphemeralKeyPair();
    const other = generateEphemeralKeyPair();
    const stream = sseStream([encryptedFrame(other.publicKey, 'not for you')]);
    await assert.rejects(() => readEncryptedStream(stream, client.secretKey), VeniceE2EEError);
  });

  it('ignores malformed SSE frames without breaking the stream', async () => {
    const client = generateEphemeralKeyPair();
    const stream = sseStream([
      'data: {not json\n',
      ': a comment line\n',
      encryptedFrame(client.publicKey, 'ok'),
    ]);
    const result = await readEncryptedStream(stream, client.secretKey);
    assert.equal(result.content, 'ok');
  });

  it('fails closed on a short non-hex content chunk (not shown as text)', async () => {
    const client = generateEphemeralKeyPair();
    const stream = sseStream([`data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n`]);
    await assert.rejects(() => readEncryptedStream(stream, client.secretKey), VeniceE2EEError);
  });

  it('fails closed when content is a non-string value', async () => {
    const client = generateEphemeralKeyPair();
    const stream = sseStream([`data: ${JSON.stringify({ choices: [{ delta: { content: { sneaky: true } } }] })}\n`]);
    await assert.rejects(() => readEncryptedStream(stream, client.secretKey), /not an encrypted string/);
  });

  it('aborts the whole stream when a later chunk is tampered, after emitting earlier authentic ones', async () => {
    const client = generateEphemeralKeyPair();
    const good = encryptedFrame(client.publicKey, 'first ');
    const tampered = encryptedFrame(client.publicKey, 'second');
    // Corrupt the tampered frame's ciphertext so the GCM tag fails.
    const broken = tampered.replace(/"content":"([0-9a-f]+)"/, (_m, hex) => `"content":"${hex.slice(0, -2)}00"`);
    const seen: string[] = [];
    await assert.rejects(
      () => readEncryptedStream(sseStream([good, broken]), client.secretKey, c => seen.push(c)),
      VeniceE2EEError,
    );
    assert.deepEqual(seen, ['first '], 'only the authentic chunk was emitted before the hard stop');
  });

  it('passes usage and [DONE] through without treating them as content', async () => {
    const client = generateEphemeralKeyPair();
    const stream = sseStream([
      `data: ${JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } })}\n`,
      encryptedFrame(client.publicKey, 'body'),
      'data: [DONE]\n',
    ]);
    const result = await readEncryptedStream(stream, client.secretKey);
    assert.equal(result.content, 'body');
    assert.deepEqual(result.usage, { promptTokens: 1, completionTokens: 2, totalTokens: 3 });
  });
});

describe('streamE2EEChatCompletion', () => {
  function harness(overrides: { attestationBody?: any; dcapFailure?: Error } = {}) {
    const model = generateEphemeralKeyPair();
    const calls: { url: string; init: any }[] = [];
    let clientPubKeyHex = '';
    let latestAttestationNonce = '';
    const address = deriveSigningAddress(model.publicKeyHex);
    const policy: ChainPolicy = {
      dcap: {
        pccsUrl: 'https://pccs.test',
        getCollateral: async () => ({ public: 'collateral' }),
        verify: async () => {
          if (overrides.dcapFailure) throw overrides.dcapFailure;
          return {
            status: 'UpToDate',
            report: {
              type: 'td10',
              data: {
                reportData: `${address}${'00'.repeat(12)}${latestAttestationNonce}`,
                tdAttributes: '0000001000000000',
                mrTd: 'aa'.repeat(48),
              },
            },
          };
        },
      },
      measurements: { references: [] },
      requireMeasurementPinning: false,
      requireNvidia: false,
    };

    const fetchImpl = async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.includes('/tee/attestation')) {
        const url_ = new URL(url);
        latestAttestationNonce = url_.searchParams.get('nonce') ?? '';
        return {
          ok: true,
          status: 200,
          json: async () =>
            overrides.attestationBody ?? {
              // Deliberately false: Alice must ignore Venice's verdict and
              // decide from the DCAP-verified quote.
              verified: false,
              nonce: url_.searchParams.get('nonce'),
              signing_public_key: model.publicKeyHex,
              intel_quote: '04ab',
            },
        };
      }
      clientPubKeyHex = init.headers['X-Venice-TEE-Client-Pub-Key'];
      const clientPub = Buffer.from(clientPubKeyHex, 'hex');
      return {
        ok: true,
        status: 200,
        body: sseStream([encryptedFrame(new Uint8Array(clientPub), 'decrypted reply')]),
      };
    };

    return { model, calls, fetchImpl, policy, clientPubKeyHex: () => clientPubKeyHex };
  }

  const messages: Message[] = [{ role: 'user', content: 'hi' }];

  it('performs attestation, encrypts, and decrypts the reply end to end', async () => {
    const h = harness();
    const result = await streamE2EEChatCompletion({
      transport: { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
      model: 'e2ee-test',
      messages,
      attestationPolicy: h.policy,
    });
    assert.equal(result.content, 'decrypted reply');
    assert.equal(result.assurance, 'attested-unpinned');
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls[0].url.includes('/tee/attestation'));
    assert.ok(h.calls[1].url.endsWith('/chat/completions'));
  });

  it('always sends stream: true and never offers a non-streaming path', async () => {
    const h = harness();
    await streamE2EEChatCompletion({
      transport: { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
      model: 'e2ee-test',
      messages,
      attestationPolicy: h.policy,
    });
    const body = JSON.parse(h.calls[1].init.body);
    assert.equal(body.stream, true);
    assert.equal(body.temperature, 0.7);
    assert.equal(body.max_tokens, 1024);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.equal(body.venice_parameters, undefined);
  });

  it('keeps per-message request keys distinct from the advertised response key', async () => {
    const h = harness();
    await streamE2EEChatCompletion({
      transport: { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
      model: 'e2ee-test',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'question' },
      ],
      attestationPolicy: h.policy,
    });
    const body = JSON.parse(h.calls[1].init.body);
    const advertised = h.calls[1].init.headers['X-Venice-TEE-Client-Pub-Key'];
    const messageKeys: string[] = [];
    for (const message of body.messages) {
      const embedded = Buffer.from(parseEnvelope(message.content).peerPublicKey).toString('hex');
      assert.notEqual(embedded, advertised);
      messageKeys.push(embedded);
    }
    assert.equal(new Set(messageKeys).size, body.messages.length);
  });

  it('sends the three required E2EE headers', async () => {
    const h = harness();
    await streamE2EEChatCompletion({
      transport: { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
      model: 'e2ee-test',
      messages,
      attestationPolicy: h.policy,
    });
    const headers = h.calls[1].init.headers;
    assert.match(headers['X-Venice-TEE-Client-Pub-Key'], /^04[0-9a-f]{128}$/);
    assert.equal(headers['X-Venice-TEE-Model-Pub-Key'], h.model.publicKeyHex);
    assert.equal(headers['X-Venice-TEE-Signing-Algo'], 'ecdsa');
  });

  it('never puts the prompt in the request body in clear', async () => {
    const h = harness();
    await streamE2EEChatCompletion({
      transport: { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
      model: 'e2ee-test',
      messages: [{ role: 'user', content: 'my secret question' }],
      attestationPolicy: h.policy,
    });
    assert.ok(!h.calls[1].init.body.includes('my secret question'));
  });

  it('omits Authorization when the transport has none (public web path)', async () => {
    const h = harness();
    await streamE2EEChatCompletion({
      transport: { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
      model: 'e2ee-test',
      messages,
      attestationPolicy: h.policy,
    });
    assert.equal(h.calls[0].init.headers.Authorization, undefined);
    assert.equal(h.calls[1].init.headers.Authorization, undefined);
  });

  it('aborts before sending anything when independent DCAP verification fails', async () => {
    const h = harness({ dcapFailure: new Error('bad quote signature') });
    await assert.rejects(
      () =>
        streamE2EEChatCompletion({
          transport: { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
          model: 'e2ee-test',
          messages,
          attestationPolicy: h.policy,
        }),
      VeniceE2EEError,
    );
    // Only the attestation call happened: no encrypted request was attempted.
    assert.equal(h.calls.length, 1);
  });

  it('fetches a fresh attestation with a different nonce for every send', async () => {
    const h = harness();
    await streamE2EEChatCompletion({
      transport: { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
      model: 'e2ee-test',
      messages,
      attestationPolicy: h.policy,
    });
    await streamE2EEChatCompletion({
      transport: { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
      model: 'e2ee-test',
      messages,
      attestationPolicy: h.policy,
    });
    const attestationUrls = h.calls
      .filter(call => call.url.includes('/tee/attestation'))
      .map(call => new URL(call.url));
    assert.equal(attestationUrls.length, 2);
    assert.notEqual(
      attestationUrls[0].searchParams.get('nonce'),
      attestationUrls[1].searchParams.get('nonce'),
    );
  });

  it('fetchAndVerifyAttestation refuses a nonce mismatch before chat', async () => {
    const h = harness({
      attestationBody: {
        verified: true,
        nonce: '00'.repeat(32),
        signing_public_key: generateEphemeralKeyPair().publicKeyHex,
        intel_quote: '04ab',
      },
    });
    await assert.rejects(
      () =>
        fetchAndVerifyAttestation(
          { baseUrl: 'https://proxy.test/api/v1', fetchImpl: h.fetchImpl },
          'e2ee-test',
          h.policy,
        ),
      (err: unknown) => {
        assert.ok(err instanceof VeniceE2EEError);
        assert.equal(err.code, 'attestation_invalid');
        assert.match(err.message, /nonce mismatch/i);
        return true;
      },
    );
  });

  it('classifies an unreachable attestation service separately', async () => {
    const h = harness();
    await assert.rejects(
      () => fetchAndVerifyAttestation(
        {
          baseUrl: 'https://proxy.test/api/v1',
          fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
        },
        'e2ee-test',
        h.policy,
      ),
      (err: unknown) => {
        assert.ok(err instanceof VeniceE2EEError);
        // A request that never completed is not a busy service: telling the
        // user to try again shortly would be a lie, so it has its own code.
        assert.equal(err.code, 'attestation_blocked');
        // The cause moves to the detail line, where the vocabulary is closed.
        assert.equal(
          err.detail,
          'stage=attestation host=proxy.test kind=unreachable error=TypeError hint=blocked-or-offline',
        );
        return true;
      },
    );
  });

  it('classifies an attestation HTTP 5xx as temporarily unavailable', async () => {
    const h = harness();
    await assert.rejects(
      () => fetchAndVerifyAttestation(
        {
          baseUrl: 'https://proxy.test/api/v1',
          fetchImpl: async () => ({
            ok: false,
            status: 502,
            text: async () => JSON.stringify({ error: 'upstream verification failed' }),
          }),
        },
        'e2ee-test',
        h.policy,
      ),
      (err: unknown) => {
        assert.ok(err instanceof VeniceE2EEError);
        assert.equal(err.code, 'attestation_unavailable');
        assert.equal(err.status, 502);
        return true;
      },
    );
  });
});
