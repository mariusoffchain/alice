import {
  ArkError,
  Estimator,
  isExpired,
  isRecoverable,
  isSpendable,
  networks,
  type ArkProvider,
  type ExtendedVirtualCoin,
  type IWallet,
} from '@arkade-os/sdk';
import { Address, OutScript } from '@scure/btc-signer';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ParsedPaymentRequest, PaymentQuote, PaymentRecord } from './payment-types';
import type { WalletStateStorage } from './wallet-state-storage';
import { FROZEN_FUNDS_ERROR, SELECTED_FROZEN_ERROR } from './frozen-vtxos.ts';

const QUOTE_TTL_MS = 60_000;
const MAX_FEE_CONVERGENCE_STEPS = 8;
const PROVIDER_ID = 'arkade-native';
const NETWORK_NAMES = ['bitcoin', 'regtest', 'testnet', 'signet', 'mutinynet'] as const;

type NativeQuoteData = {
  destination: string;
  offboardAmountSats: number;
  inputFeeSats: number;
  outputFeeSats: number;
  selectedOutpoints: string[];
};

type PreparedQuote = {
  quote: PaymentQuote;
  inputs: ExtendedVirtualCoin[];
  changeSats: bigint;
};

type NativeOnchainWallet = IWallet & {
  arkProvider: Pick<ArkProvider, 'getInfo'>;
};
type ExclusionStorage = Pick<
  WalletStateStorage,
  'getExclusions' | 'setExclusion' | 'getFrozenVtxos'
>;

function createVolatileExclusionStorage(): ExclusionStorage {
  const exclusions = new Map<string, { id: string; reason: string; excludedAt: number }>();
  return {
    getExclusions: async () => [...exclusions.values()],
    getFrozenVtxos: async () => [],
    setExclusion: async (id, reason) => {
      exclusions.set(id, { id, reason, excludedAt: Date.now() });
    },
  };
}

let quoteSequence = 0;

type VtxoCandidate = {
  input: ExtendedVirtualCoin;
  inputFeeSats: number;
  netValue: bigint;
};

function expiryPriority(candidate: VtxoCandidate): number {
  const expiry = candidate.input.virtualStatus.batchExpiry;
  if (!expiry || new Date(expiry).getFullYear() < 2025) {
    return Number.MAX_SAFE_INTEGER;
  }
  return expiry;
}

function rejectedVtxoOutpoint(error: ArkError): string | null {
  const metadataOutpoint = error.metadata?.vtxo_outpoint;
  if (typeof metadataOutpoint === 'string') return metadataOutpoint;

  const match = error.message.match(/\bvtxo\s+([0-9a-f]{64}):(\d+)\b/i);
  return match ? `${match[1].toLowerCase()}:${match[2]}` : null;
}

export function canOfferNativeOnchainFallback(
  state: { swapCreated: boolean; fundingAttempted: boolean },
): boolean {
  return !state.swapCreated && !state.fundingAttempted;
}

function destinationScript(address: string): string {
  for (const networkName of NETWORK_NAMES) {
    try {
      const decoded = Address(networks[networkName]).decode(address);
      return bytesToHex(OutScript.encode(decoded));
    } catch {
      // Try the next Bitcoin network. The payment parser enforces the build network.
    }
  }
  throw new Error(`Failed to decode destination address: ${address}`);
}

function outpointId(vtxo: Pick<ExtendedVirtualCoin, 'txid' | 'vout'>): string {
  return `${vtxo.txid}:${vtxo.vout}`;
}

function isCollaborativelySpendable(vtxo: ExtendedVirtualCoin): boolean {
  return (
    isSpendable(vtxo)
    && !isRecoverable(vtxo)
    && !isExpired(vtxo)
    && !vtxo.isUnrolled
    && (vtxo.virtualStatus.state === 'settled'
      || vtxo.virtualStatus.state === 'preconfirmed')
  );
}

function selectVtxos(
  candidates: VtxoCandidate[],
  requiredSats: bigint,
  dustSats: bigint,
): VtxoCandidate[] {
  const validChange = (total: bigint) => {
    const change = total - requiredSats;
    return change === 0n || change >= dustSats;
  };
  const singles = candidates
    .filter(candidate => candidate.netValue >= requiredSats && validChange(candidate.netValue))
    .sort((a, b) => {
      const expiryDelta = expiryPriority(a) - expiryPriority(b);
      if (expiryDelta !== 0) return expiryDelta;
      if (a.netValue !== b.netValue) return a.netValue < b.netValue ? -1 : 1;
      return outpointId(a.input).localeCompare(outpointId(b.input));
    });
  if (singles[0]) return [singles[0]];

  const selected: VtxoCandidate[] = [];
  let total = 0n;
  for (const candidate of [...candidates].sort((a, b) => {
    const expiryDelta = expiryPriority(a) - expiryPriority(b);
    if (expiryDelta !== 0) return expiryDelta;
    if (a.netValue !== b.netValue) return a.netValue > b.netValue ? -1 : 1;
    return outpointId(a.input).localeCompare(outpointId(b.input));
  })) {
    selected.push(candidate);
    total += candidate.netValue;
    if (total >= requiredSats && validChange(total)) return selected;
  }

  throw new Error('Insufficient funds including native exit fees.');
}

function quoteData(quote: PaymentQuote): NativeQuoteData {
  const data = quote.providerData as Partial<NativeQuoteData> | undefined;
  if (
    !data
    || typeof data.destination !== 'string'
    || !Number.isSafeInteger(data.offboardAmountSats)
    || !Number.isSafeInteger(data.inputFeeSats)
    || !Number.isSafeInteger(data.outputFeeSats)
    || !Array.isArray(data.selectedOutpoints)
    || data.selectedOutpoints.some(outpoint => typeof outpoint !== 'string')
  ) {
    throw new Error('Native Arkade quote data is invalid. No funds were sent.');
  }
  return data as NativeQuoteData;
}

async function prepareQuote(
  wallet: NativeOnchainWallet,
  request: ParsedPaymentRequest,
  receiveAmountSats: number,
  rejectedOutpoints: ReadonlySet<string> = new Set(),
): Promise<PreparedQuote> {
  if (!Number.isSafeInteger(receiveAmountSats) || receiveAmountSats <= 0) {
    throw new Error('Enter a valid whole number of sats.');
  }

  const route = request.routes.find(candidate => candidate.layer === 'onchain');
  if (!route) throw new Error('A valid Bitcoin address is required.');

  const [info, vtxos] = await Promise.all([
    wallet.arkProvider.getInfo(),
    wallet.getVtxos({ withRecoverable: false, withUnrolled: false }),
  ]);
  const estimator = new Estimator(info.fees.intentFee ?? {});

  const candidates: VtxoCandidate[] = [];
  for (const vtxo of vtxos) {
    if (!isCollaborativelySpendable(vtxo) || rejectedOutpoints.has(outpointId(vtxo))) {
      continue;
    }
    const inputFee = estimator.evalOffchainInput({
      amount: BigInt(vtxo.value),
      type: 'vtxo',
      weight: 0,
      birth: vtxo.createdAt,
      expiry: vtxo.virtualStatus.batchExpiry
        ? new Date(vtxo.virtualStatus.batchExpiry)
        : undefined,
    }).satoshis;
    if (inputFee >= vtxo.value) continue;
    candidates.push({
      input: vtxo,
      inputFeeSats: inputFee,
      netValue: BigInt(vtxo.value - inputFee),
    });
  }
  if (candidates.length === 0) {
    throw new Error('No Arkade funds are available after native exit fees.');
  }

  const script = destinationScript(route.destination);
  const recipientAmount = BigInt(receiveAmountSats);
  let offboardAmount = recipientAmount;
  let outputFeeSats = 0;

  for (let step = 0; step < MAX_FEE_CONVERGENCE_STEPS; step += 1) {
    outputFeeSats = estimator.evalOnchainOutput({
      amount: offboardAmount,
      script,
    }).satoshis;
    const nextAmount = recipientAmount + BigInt(outputFeeSats);
    if (nextAmount === offboardAmount) break;
    offboardAmount = nextAmount;
  }

  outputFeeSats = estimator.evalOnchainOutput({
    amount: offboardAmount,
    script,
  }).satoshis;
  if (offboardAmount - BigInt(outputFeeSats) !== recipientAmount) {
    throw new Error('Arkade native exit fees could not be quoted safely.');
  }
  const selected = selectVtxos(candidates, offboardAmount, info.dust);
  const selectedNetValue = selected.reduce((sum, candidate) => sum + candidate.netValue, 0n);
  const inputFeeSats = selected.reduce((sum, candidate) => sum + candidate.inputFeeSats, 0);
  const change = selectedNetValue - offboardAmount;

  const offboardAmountSats = Number(offboardAmount);
  const sendAmountSats = offboardAmountSats + inputFeeSats;
  if (!Number.isSafeInteger(offboardAmountSats) || !Number.isSafeInteger(sendAmountSats)) {
    throw new Error('Native exit amount is outside the supported range.');
  }

  return {
    quote: {
      id: `arkade-native-btc-${Date.now()}-${quoteSequence += 1}`,
      provider: PROVIDER_ID,
      layer: 'onchain',
      request,
      sendAmountSats,
      receiveAmountSats,
      feeSats: inputFeeSats + outputFeeSats,
      expiresAt: Date.now() + QUOTE_TTL_MS,
      warnings: ['Collaborative exit requires the Arkade server and its next settlement batch.'],
      providerData: {
        destination: route.destination,
        offboardAmountSats,
        inputFeeSats,
        outputFeeSats,
        selectedOutpoints: selected.map(candidate => outpointId(candidate.input)),
      } satisfies NativeQuoteData,
    },
    inputs: selected.map(candidate => candidate.input),
    changeSats: change,
  };
}

export class NativeOnchainPayment {
  private readonly inFlightQuotes = new Set<string>();
  private readonly consumedQuotes = new Set<string>();
  private readonly wallet: NativeOnchainWallet;
  private readonly stateStorage: ExclusionStorage;

  constructor(wallet: NativeOnchainWallet, stateStorage?: ExclusionStorage) {
    this.wallet = wallet;
    this.stateStorage = stateStorage ?? createVolatileExclusionStorage();
  }

  async quote(
    request: ParsedPaymentRequest,
    receiveAmountSats: number,
  ): Promise<PaymentQuote> {
    const [exclusions, frozen] = await Promise.all([
      this.stateStorage.getExclusions(),
      this.stateStorage.getFrozenVtxos(),
    ]);
    const rejectedOutpoints = new Set([
      ...exclusions.map(item => item.id),
      ...frozen.map(item => item.id),
    ]);
    try {
      return (await prepareQuote(
        this.wallet,
        request,
        receiveAmountSats,
        rejectedOutpoints,
      )).quote;
    } catch (cause) {
      if (frozen.length > 0) {
        const withoutFreeze = new Set(exclusions.map(item => item.id));
        try {
          await prepareQuote(this.wallet, request, receiveAmountSats, withoutFreeze);
          throw new Error(FROZEN_FUNDS_ERROR);
        } catch (allCause) {
          if (allCause instanceof Error && allCause.message === FROZEN_FUNDS_ERROR) {
            throw allCause;
          }
        }
      }
      throw cause;
    }
  }

  async send(quote: PaymentQuote): Promise<PaymentRecord> {
    if (quote.provider !== PROVIDER_ID || quote.layer !== 'onchain') {
      throw new Error('This native Arkade quote is not supported.');
    }
    if (quote.expiresAt !== null && Date.now() >= quote.expiresAt) {
      throw new Error('The payment quote expired. Request a new quote.');
    }
    if (this.inFlightQuotes.has(quote.id) || this.consumedQuotes.has(quote.id)) {
      throw new Error('This native exit is already being processed.');
    }

    const route = quote.request.routes.find(candidate => candidate.layer === 'onchain');
    if (!route) throw new Error('Bitcoin destination missing from quote.');
    const confirmedData = quoteData(quote);
    if (confirmedData.destination !== route.destination) {
      throw new Error('Native exit destination changed. No funds were sent.');
    }

    this.inFlightQuotes.add(quote.id);
    try {
      const [exclusions, frozen] = await Promise.all([
        this.stateStorage.getExclusions(),
        this.stateStorage.getFrozenVtxos(),
      ]);
      const rejectedOutpoints = new Set([
        ...exclusions.map(item => item.id),
        ...frozen.map(item => item.id),
      ]);
      if (confirmedData.selectedOutpoints.some(outpoint =>
        frozen.some(item => item.id === outpoint)
      )) {
        throw new Error(SELECTED_FROZEN_ERROR);
      }
      const fresh = await prepareQuote(
        this.wallet,
        quote.request,
        quote.receiveAmountSats,
        rejectedOutpoints,
      );
      const freshData = quoteData(fresh.quote);
      if (
        fresh.quote.sendAmountSats !== quote.sendAmountSats
        || fresh.quote.feeSats !== quote.feeSats
        || freshData.offboardAmountSats !== confirmedData.offboardAmountSats
        || freshData.selectedOutpoints.join(',') !== confirmedData.selectedOutpoints.join(',')
      ) {
        throw new Error('Native Arkade fees changed. Review and confirm the updated quote.');
      }

      // From this point a settlement may have reached the server. Never retry
      // the same confirmation automatically or fall through to another rail.
      this.consumedQuotes.add(quote.id);
      let txid: string;
      try {
        const outputs = [{
          address: route.destination,
          amount: BigInt(freshData.offboardAmountSats - freshData.outputFeeSats),
        }];
        if (fresh.changeSats > 0n) {
          outputs.push({
            address: await this.wallet.getAddress(),
            amount: fresh.changeSats,
          });
        }
        txid = await this.wallet.settle({
          inputs: fresh.inputs,
          outputs,
        });
      } catch (error) {
        if (error instanceof ArkError && error.name === 'INVALID_PSBT_INPUT') {
          const rejectedOutpoint = rejectedVtxoOutpoint(error);
          const rejected = rejectedOutpoint
            ? fresh.inputs.find(input => outpointId(input) === rejectedOutpoint)
            : undefined;
          if (rejected && rejectedOutpoint) {
            const temporarilyIneligible = /\bexpires after\b/i.test(error.message);
            await this.stateStorage.setExclusion(
              rejectedOutpoint,
              temporarilyIneligible
                ? 'Not eligible for a collaborative exit yet.'
                : 'Rejected by Arkade as an invalid collaborative input.',
            );
            throw new Error(
              temporarilyIneligible
                ? 'One Arkade VTXO is not eligible for a collaborative exit yet. Alice excluded it. Review and confirm the new quote.'
                : 'Arkade rejected one VTXO input. Alice excluded it. Review and confirm the new quote.',
            );
          }
        }
        throw error;
      }
      if (!txid) throw new Error('Arkade did not return settlement evidence.');

      return {
        id: `native-exit-${txid}`,
        provider: PROVIDER_ID,
        layer: 'onchain',
        direction: 'outgoing',
        amountSats: quote.receiveAmountSats,
        feeSats: quote.feeSats,
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: null,
        txid,
        refundable: false,
        providerData: {
          ...freshData,
          arkadeTxid: txid,
          settlementConfirmed: false,
        },
      };
    } finally {
      this.inFlightQuotes.delete(quote.id);
    }
  }
}
