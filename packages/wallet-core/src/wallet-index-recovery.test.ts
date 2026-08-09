import assert from 'node:assert/strict';
import test from 'node:test';
import { isHdDescriptorMismatchError } from './wallet-index-recovery.ts';

test('recognizes Arkade HD descriptor mismatches', () => {
  assert.equal(
    isHdDescriptorMismatchError('HD descriptor mismatch stored, refusing to reuse HD state from a different entity.'),
    true,
  );
  assert.equal(isHdDescriptorMismatchError(new Error('different entity')), true);
});

test('does not offer index rebuilding for unrelated wallet failures', () => {
  assert.equal(isHdDescriptorMismatchError('Network request failed'), false);
  assert.equal(isHdDescriptorMismatchError('Insufficient funds'), false);
});
