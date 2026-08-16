import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addTab, closeTab, makeTab, overviewTab, shortLabel } from './tabs.ts';

describe('shortLabel', () => {
  it('names the overview Home', () => {
    assert.equal(shortLabel('overview'), 'Home');
  });
  it('truncates long subjects and keeps short ones whole', () => {
    assert.equal(shortLabel('tx', 'a'.repeat(64)), 'aaaaaa...aaaa');
    assert.equal(shortLabel('block', '800000'), 'Block 800000');
    assert.equal(shortLabel('address', 'bc1short'), 'bc1short');
  });
});

describe('addTab', () => {
  it('inserts right after the active tab', () => {
    const home = overviewTab('mainnet');
    const a = makeTab('tx', 'a'.repeat(64), 'mainnet');
    const b = makeTab('tx', 'b'.repeat(64), 'mainnet');
    let tabs = addTab([home], a, home.id);
    tabs = addTab(tabs, b, home.id); // active is still home
    assert.deepEqual(tabs.map(t => t.id), [home.id, b.id, a.id]);
  });
});

describe('tabs carry their network', () => {
  it('keeps the network a tab was opened on', () => {
    assert.equal(makeTab('tx', 'a'.repeat(64), 'testnet4').networkId, 'testnet4');
    assert.equal(overviewTab('signet').networkId, 'signet');
  });
});

describe('closeTab', () => {
  it('re-seeds a home on the given network when the last tab closes', () => {
    const home = overviewTab('testnet4');
    const { tabs, fallbackId } = closeTab([home], home.id, 'mainnet');
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].kind, 'overview');
    assert.equal(tabs[0].networkId, 'mainnet');
    assert.equal(tabs[0].id, fallbackId);
  });

  it('focuses the neighbour after closing', () => {
    const home = overviewTab('mainnet');
    const a = makeTab('tx', 'a'.repeat(64), 'mainnet');
    const b = makeTab('tx', 'b'.repeat(64), 'mainnet');
    const start = [home, a, b];
    const { tabs, fallbackId } = closeTab(start, a.id, 'mainnet');
    assert.deepEqual(tabs.map(t => t.id), [home.id, b.id]);
    assert.equal(fallbackId, b.id);
  });
});
