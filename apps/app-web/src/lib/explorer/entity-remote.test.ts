import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mergeLabels, remoteEntityLookup } from './entity-remote.ts';
import type { EntityLabel } from './entities.ts';

const label = (name: string, source: string): EntityLabel => ({
  name, category: 'exchange', confidence: 'strong', source, sourceLabel: 'x', date: '2026-08-14',
});

describe('mergeLabels', () => {
  it('appends remote labels and drops duplicates on (name, source)', () => {
    const local = [label('Binance', 'a')];
    const remote = [label('Binance', 'a'), label('BitMEX', 'b')];
    const merged = mergeLabels(local, remote);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].name, 'Binance'); // local keeps its position
    assert.equal(merged[1].name, 'BitMEX');
  });
});

describe('remoteEntityLookup', () => {
  const origFetch = globalThis.fetch;
  const origEnv = process.env.EXPO_PUBLIC_VENICE_PROXY_URL;
  beforeEach(() => { process.env.EXPO_PUBLIC_VENICE_PROXY_URL = 'https://proxy.example'; });
  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origEnv === undefined) delete process.env.EXPO_PUBLIC_VENICE_PROXY_URL;
    else process.env.EXPO_PUBLIC_VENICE_PROXY_URL = origEnv;
  });

  it('parses labels and coerces unknown category/confidence to safe defaults', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      labels: {
        'bc1qx': [
          { name: 'BitMEX', category: 'exchange', confidence: 'strong', source: 's', sourceLabel: 'l', date: 'd' },
          { name: 'Weird', category: 'nonsense', confidence: 'huh', source: 's', sourceLabel: 'l', date: 'd' },
        ],
      },
    }), { status: 200 })) as typeof fetch;
    const map = await remoteEntityLookup(['bc1qx']);
    const labels = map.get('bc1qx')!;
    assert.equal(labels.length, 2);
    assert.equal(labels[1].category, 'unknown');
    assert.equal(labels[1].confidence, 'possible');
  });

  it('resolves to an empty map on a non-ok response', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    const map = await remoteEntityLookup(['bc1qx']);
    assert.equal(map.size, 0);
  });

  it('is a no-op with no proxy configured', async () => {
    delete process.env.EXPO_PUBLIC_VENICE_PROXY_URL;
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
    const map = await remoteEntityLookup(['bc1qx']);
    assert.equal(called, false);
    assert.equal(map.size, 0);
  });
});
