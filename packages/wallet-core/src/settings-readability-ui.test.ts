import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function appSource(file: string) {
  return readFileSync(
    decodeURIComponent(new URL(`../../../apps/wallet-mobile/app/${file}`, import.meta.url).pathname),
    'utf8',
  );
}

function coreSource(file: string) {
  return readFileSync(
    decodeURIComponent(new URL(`./${file}`, import.meta.url).pathname),
    'utf8',
  );
}

test('address management keeps rotation manual and recovery guidance below the list', () => {
  const source = appSource('addresses.tsx');
  assert.match(source, /GENERATE NEW/);
  assert.match(source, /more than 15 consecutive addresses/);
  assert.match(source, /scans 100 shared HD indexes/);
  assert.doesNotMatch(source, /ADDRESS RECOVERY WINDOW/);
  assert.doesNotMatch(source, /MARK SHARED/);
  assert.ok(source.indexOf("renderSection('arkade')") < source.indexOf("renderSection('onchain')"));
  assert.ok(source.indexOf('RECOVERY INFORMATION') > source.indexOf("renderSection('onchain')"));
});

test('previous addresses have persistent labels, QR details, and reversible archives', () => {
  const source = appSource('addresses.tsx');
  const archive = appSource('address-archives.tsx');
  const components = readFileSync(
    decodeURIComponent(new URL(
      '../../../apps/wallet-mobile/lib/address-management.tsx',
      import.meta.url,
    ).pathname),
    'utf8',
  );
  assert.match(source, /CompactAddressRow/);
  assert.match(source, /ARCHIVED ADDRESSES/);
  assert.match(archive, /archiveAction="restore"/);
  assert.match(components, /item\.label \|\| 'UNLABELED ADDRESS'/);
  assert.match(components, /name="pencil"/);
  assert.match(components, /name="qr-code-outline"/);
  assert.match(components, /<QRCode value=\{item\.address\}/);
});

test('receive screens reuse current addresses instead of rotating them implicitly', () => {
  const receive = appSource('receive.tsx');
  const core = coreSource('ark.ts');
  assert.match(receive, /getArkAddress\(\), getReceiveAddress\(\)/);
  assert.doesNotMatch(receive, /reserveUnifiedReceiveAddresses/);
  assert.match(core, /targetArkadeAddress: await walletBackend\.getAddress\(\)/);
  assert.doesNotMatch(
    core.slice(core.indexOf('export async function createReceivePayment')),
    /reserveArkadeReceiveAddress\(\)/,
  );
});

test('recent wallet settings screens do not use unreadably small font sizes', () => {
  for (const file of [
    'addresses.tsx',
    'address-archives.tsx',
    'coin-control.tsx',
    'delegates.tsx',
    'emergency-exit.tsx',
    'swap-ids.tsx',
  ]) {
    assert.doesNotMatch(
      appSource(file),
      /fontSize:\s*[1-6](?:\D|$)/,
      `${file} contains a font smaller than 7px`,
    );
  }
});
