'use client';

// Playground transactions open in Alice's own Explorer rather than a third
// party site: the Explorer already speaks Mutinynet, and it is where the rest
// of the app teaches how to read a transaction. It travels through the shared
// one-shot deep-link channel, so the workspace picks it up on mount without
// racing its own tab persistence.

import { requestPendingOpen } from '@/lib/explorer/tab-storage';

export function openPlaygroundTxInExplorer(
  txid: string,
  navigate: (path: string) => void,
  label = 'Playground transaction',
): void {
  requestPendingOpen(
    'tx',
    txid,
    { label, origin: 'Playground' },
    'mutinynet',
  );
  navigate('/explorer');
}

export function openPlaygroundAddressInExplorer(
  address: string,
  navigate: (path: string) => void,
  label = 'Playground address',
): void {
  requestPendingOpen('address', address, { label, origin: 'Playground' }, 'mutinynet');
  navigate('/explorer');
}
