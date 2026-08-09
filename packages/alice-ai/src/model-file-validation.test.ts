import assert from 'node:assert/strict';
import test from 'node:test';

import { isExpectedModelFileSize } from './model-file-validation.ts';

test('accepts only a complete model file', () => {
  assert.equal(isExpectedModelFileSize(1_282_439_360, 1_282_439_360), true);
  assert.equal(isExpectedModelFileSize(1_200_000_000, 1_282_439_360), false);
  assert.equal(isExpectedModelFileSize(undefined, 1_282_439_360), false);
});

test('rejects an oversized response such as an HTML or proxy artifact', () => {
  assert.equal(isExpectedModelFileSize(1_282_439_361, 1_282_439_360), false);
});
