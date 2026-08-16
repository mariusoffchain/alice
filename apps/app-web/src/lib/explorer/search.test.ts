import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifySearch } from './search.ts';

describe('classifySearch', () => {
  it('treats a short run of digits as a block height', () => {
    assert.deepEqual(classifySearch('800000'), { kind: 'block', value: '800000' });
    assert.deepEqual(classifySearch('  42 '), { kind: 'block', value: '42' });
  });

  it('treats a 64-hex value as a transaction id by default', () => {
    const txid = 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16';
    assert.deepEqual(classifySearch(txid), { kind: 'tx', value: txid });
  });

  it('treats a 64-hex value with many leading zeros as a block hash', () => {
    const hash = '00000000000000000001c510a1e66adb1a8777fbf3e2758a4bd6b5bd47f03bfe';
    assert.deepEqual(classifySearch(hash), { kind: 'block', value: hash });
  });

  it('lowercases and detects bech32 addresses', () => {
    assert.deepEqual(classifySearch('bc1qvqfw3kc37zw68g0lf6fnf54d4s3a8tnqku02ry'), {
      kind: 'address',
      value: 'bc1qvqfw3kc37zw68g0lf6fnf54d4s3a8tnqku02ry',
    });
  });

  it('detects base58 P2PKH and P2SH addresses', () => {
    assert.equal(classifySearch('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2').kind, 'address');
    assert.equal(classifySearch('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy').kind, 'address');
  });

  it('detects xpubs before addresses', () => {
    assert.equal(classifySearch('zpub6jftahH18ngZxLmXaKw3GSZzZsszmt9WqedkyZdezFtWRFBZqsQH5hyUmb4pCEeZGmVfQuP5bedXTB8is6fTv19U1GQRyQ3ndogyv6cNzds').kind, 'xpub');
    assert.equal(classifySearch('xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet').kind, 'xpub');
  });

  it('routes output descriptors to the wallet view', () => {
    const d = 'wpkh([abcdef12/84h/0h/0h]xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet/<0;1>/*)';
    assert.equal(classifySearch(d).kind, 'xpub');
    assert.equal(classifySearch(`sh(wpkh(xpub.../0/*))`).kind, 'xpub');
    // A plain xpub without a script wrapper is still an xpub, not a descriptor.
    assert.equal(classifySearch('xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet').kind, 'xpub');
  });

  it('reports gibberish and empty input as unknown', () => {
    assert.equal(classifySearch('').kind, 'unknown');
    assert.equal(classifySearch('hello world').kind, 'unknown');
    assert.equal(classifySearch('xyz123').kind, 'unknown');
  });

  it('recognises Liquid addresses only when the caller opts in', () => {
    const legacy = 'QLFdUboUPJnUzvsXKu83hUtrQ1DuxyggRg';
    const conf = 'lq1qqf8t9x0zvwn0uhqf6t7k2m5z3a2c858zry73jwyyz8rtwccckzkg9q724x5ns0';
    assert.equal(classifySearch(legacy).kind, 'unknown');
    assert.deepEqual(classifySearch(legacy, { liquidAddresses: true }), { kind: 'address', value: legacy });
    assert.equal(classifySearch(conf, { liquidAddresses: true }).kind, 'address');
    assert.equal(classifySearch('ex1qw508d6qejxtdg4y5r3zarvary0c5xw7k34m9jp', { liquidAddresses: true }).kind, 'address');
    // The opt-in never bends the other formats.
    assert.equal(classifySearch('800000', { liquidAddresses: true }).kind, 'block');
    assert.equal(classifySearch('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', { liquidAddresses: true }).kind, 'address');
  });

  it('recognises ark1 addresses only when the caller opts in', () => {
    const ark = 'ark1qzpq904am6clw3pgqwyh4p02708fy4xs0hcpwt7rwfdttuxsjameezgu4rz4mh977mt5zc2gquwfdy94npcvgfg865k8dt077z5a70aykxu669';
    assert.equal(classifySearch(ark).kind, 'unknown');
    assert.deepEqual(classifySearch(ark, { arkAddresses: true }), { kind: 'address', value: ark });
    assert.equal(classifySearch('tark1qf00zar234567', { arkAddresses: true }).kind, 'address');
    // The opt-in never bends the other formats.
    assert.equal(classifySearch('800000', { arkAddresses: true }).kind, 'block');
  });
});
