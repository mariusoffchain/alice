import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  decodeURIComponent(new URL('../../../apps/wallet-mobile/app/send.tsx', import.meta.url).pathname),
  'utf8',
);

test('native exit refresh errors tell users to retry later or change rail', () => {
  assert.match(
    source,
    /RETURN TO THE WALLET AND WAIT FOR SYNC, THEN TRY AGAIN LATER\./,
  );
  assert.match(
    source,
    /OR SEND VIA ARKADE OR LIGHTNING INSTEAD\./,
  );
  assert.match(
    source,
    /friendlySendError\(error, availableBalance, 'arkade'\)/,
  );
});
