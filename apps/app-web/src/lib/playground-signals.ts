// Ask-Alice context for the Playground pages, following the Explorer's
// contract exactly:
//
//  - the DEFAULT attachment is de-identified: wallet activity as counts and
//    magnitude buckets, never an address, txid or amount in clear;
//  - identified mode (explicit, per the shared disclaimer flow) attaches the
//    page description in clear, with every identifier DECLARED as a raw
//    subject so route() classifies the message D by construction, never by
//    hoping a text scan catches it.
//
// The recovery phrase never appears in either mode: seed words are blocked
// at the chat boundary and have no business in a context attachment.

import type { PrivacySignal } from '@/lib/explorer/signals';
import type { FullContext } from '@/lib/explorer/ask-alice';
import type { PracticeTxPlan } from '@alice-wallet/practice-wallet';
import type { PlaygroundSnapshot } from '@/lib/playground';

export type PlaygroundView =
  | 'home'
  | 'send'
  | 'receive'
  | 'settings'
  | 'coins'
  | 'addresses'
  | 'backup'
  | 'faucet';

const PAGE_NAMES: Record<PlaygroundView, string> = {
  home: 'the Playground home',
  send: 'the guided send flow',
  receive: 'the receive screen',
  settings: 'the Playground settings',
  coins: 'the coin control list',
  addresses: 'the address list',
  backup: 'the recovery phrase screen',
  faucet: 'the free test sats screen',
};

export function playgroundPageName(view: PlaygroundView): string {
  return PAGE_NAMES[view];
}

/** De-identified default: activity counts, projected to buckets downstream. */
export function buildPlaygroundSignals(
  snapshot: PlaygroundSnapshot | null,
  draft?: PracticeTxPlan | null,
): PrivacySignal[] {
  if (!snapshot) return [];
  const signals: PrivacySignal[] = [];
  if (draft) {
    // The transaction being composed, as shape only: how many coins it spends
    // and how many outputs it creates, never an address or an exact amount.
    signals.push({
      id: 'TX_CONTEXT:test-wallet-draft',
      ruleId: 'TX_CONTEXT',
      severity: 'info',
      confidence: 'certain',
      title: 'Transaction being composed',
      detail: `${draft.inputs.length} input(s) into ${draft.outputs.length} output(s).`,
      subjects: ['test-wallet-draft'],
      evidence: {
        inputCount: draft.inputs.length,
        outputCount: draft.outputs.length,
        addressCount: draft.outputs.length,
        totalOutSats: draft.amountSats + draft.changeSats,
        scriptTypes: 'v0_p2wpkh',
      },
    });
  }
  signals.push({
      id: 'ADDRESS_CONTEXT:test-wallet',
      ruleId: 'ADDRESS_CONTEXT',
      severity: 'info',
      confidence: 'certain',
      title: 'Playground activity',
      detail: `${snapshot.history.length} transaction(s) in this Mutinynet practice wallet.`,
      subjects: ['test-wallet'],
    evidence: {
      txCount: snapshot.history.length,
      balanceSats: snapshot.balanceSats,
    },
  });
  return signals;
}

/** Identified mode: the page in clear, identifiers declared as raw subjects. */
export function buildPlaygroundFullContext(
  view: PlaygroundView,
  snapshot: PlaygroundSnapshot | null,
  draft?: PracticeTxPlan | null,
): FullContext | null {
  if (!snapshot) return null;
  const lines = [
    `The user is looking at ${PAGE_NAMES[view]} of the Playground, their Mutinynet practice wallet, `
      + 'a learning wallet whose coins have no real value.',
    `Confirmed balance: ${snapshot.balanceSats} sats. Pending: ${snapshot.pendingSats} sats.`,
    `Current receive address: ${snapshot.receiveAddress}.`,
  ];
  if (snapshot.utxos.length > 0) {
    lines.push(
      'Coins (UTXOs): '
        + snapshot.utxos
          .map(
            (utxo) =>
              `${utxo.txid}:${utxo.vout} holding ${utxo.valueSats} sats`
              + `${utxo.confirmed ? '' : ' (unconfirmed)'} on ${utxo.address}`,
          )
          .join('; ')
        + '.',
    );
  }
  if (snapshot.history.length > 0) {
    lines.push(
      'Recent transactions: '
        + snapshot.history
          .slice(0, 10)
          .map(
            (entry) =>
              `${entry.direction} ${entry.amountSats} sats`
              + ` (${entry.txid}${entry.confirmed ? '' : ', unconfirmed'})`,
          )
          .join('; ')
        + '.',
    );
  }
  if (draft) {
    lines.push(
      'The transaction they are composing right now: '
        + `it spends ${draft.inputs.length} coin(s) totalling ${draft.totalInputSats} sats, `
        + `pays ${draft.amountSats} sats to ${draft.recipientAddress}, `
        + (draft.changeSats > 0
          ? `returns ${draft.changeSats} sats of change, `
          : 'creates no change output, ')
        + `and leaves ${draft.feeSats} sats of mining fee `
        + `(${draft.estimatedVbytes} vbytes at ${draft.feeRateSatVb} sat/vB).`,
    );
  }
  return {
    description: lines.join('\n'),
    subjects: [
      ...snapshot.addresses.map((info) => ({ kind: 'address' as const, value: info.address })),
      ...snapshot.history.slice(0, 10).map((entry) => ({ kind: 'txid' as const, value: entry.txid })),
      ...(draft ? [{ kind: 'address' as const, value: draft.recipientAddress }] : []),
    ],
  };
}
