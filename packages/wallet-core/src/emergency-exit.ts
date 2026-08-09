import {
  MnemonicIdentity,
  OnchainWallet,
  Unroll,
  isSpendable,
  type Wallet,
} from '@arkade-os/sdk';
import { NETWORK, PAYMENT_NETWORK } from './network-config';
import { parsePaymentInput } from './payment-parser';
import type { EmergencyExitState } from './wallet-backend';
import type { WalletStateStorage } from './wallet-state-storage';
import { parseOutpoint } from './vtxo-lifecycle';

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function updateState(
  state: EmergencyExitState,
  updates: Partial<EmergencyExitState>,
): EmergencyExitState {
  return { ...state, ...updates, updatedAt: Date.now() };
}

function isWaitingForTimelock(message: string): boolean {
  return /no available exit path|timelock|csv/i.test(message);
}

function isWaitingForConfirmation(message: string): boolean {
  return /not confirmed|confirmation|mempool/i.test(message);
}

export class EmergencyExitController {
  private readonly wallet: Wallet;
  private readonly mnemonic: string;
  private readonly storage: WalletStateStorage;

  constructor(wallet: Wallet, mnemonic: string, storage: WalletStateStorage) {
    this.wallet = wallet;
    this.mnemonic = mnemonic;
    this.storage = storage;
  }

  async getState(): Promise<EmergencyExitState> {
    const stored = await this.storage.getEmergencyExit();
    if (!stored) return this.idleState();
    const bumper = await this.getBumper();
    const feeBalanceSats = await bumper.getBalance().catch(() => stored.feeBalanceSats);
    return updateState(stored, {
      feeAddress: bumper.address,
      feeBalanceSats,
      stage: stored.stage === 'needs-fee-funding' && feeBalanceSats > 0
        ? 'ready'
        : stored.stage,
    });
  }

  async prepare(ids: string[], destination: string): Promise<EmergencyExitState> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) throw new Error('Select at least 1 VTXO for emergency exit.');
    const parsed = parsePaymentInput(destination, PAYMENT_NETWORK);
    const route = parsed?.routes.find(candidate => candidate.layer === 'onchain');
    if (!route || route.destination !== destination.trim()) {
      throw new Error(
        `Enter a valid ${NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet'} address.`,
      );
    }

    const vtxos = await this.wallet.getVtxos({ withRecoverable: true, withUnrolled: true });
    const selected = vtxos.filter(vtxo => uniqueIds.includes(`${vtxo.txid}:${vtxo.vout}`));
    if (selected.length !== uniqueIds.length) {
      throw new Error('At least 1 selected VTXO is no longer in this wallet.');
    }
    if (selected.some(vtxo => !isSpendable(vtxo) && !vtxo.isUnrolled)) {
      throw new Error('Spent VTXOs cannot be included in an emergency exit.');
    }

    const bumper = await this.getBumper();
    const feeBalanceSats = await bumper.getBalance();
    const now = Date.now();
    const state: EmergencyExitState = {
      version: 1,
      stage: feeBalanceSats > 0 ? 'ready' : 'needs-fee-funding',
      destination: route.destination,
      selectedIds: uniqueIds,
      selectedAmountSats: selected.reduce((sum, vtxo) => sum + vtxo.value, 0),
      feeAddress: bumper.address,
      feeBalanceSats,
      completedVtxoIds: selected
        .filter(vtxo => vtxo.isUnrolled)
        .map(vtxo => `${vtxo.txid}:${vtxo.vout}`),
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.setEmergencyExit(state);
    return state;
  }

  async advance(): Promise<EmergencyExitState> {
    let state = await this.getState();
    if (state.stage === 'idle') throw new Error('Prepare an emergency exit first.');
    if (state.stage === 'completed') return state;

    const bumper = await this.getBumper();
    const feeBalanceSats = await bumper.getBalance();
    if (feeBalanceSats <= 0) {
      state = updateState(state, {
        stage: 'needs-fee-funding',
        feeAddress: bumper.address,
        feeBalanceSats,
        error: 'Fund the fee address with on-chain bitcoin before continuing.',
      });
      await this.storage.setEmergencyExit(state);
      return state;
    }

    const completed = new Set(state.completedVtxoIds);
    for (const id of state.selectedIds) {
      const { txid, vout } = parseOutpoint(id);
      if (completed.has(id)) continue;

      state = updateState(state, {
        stage: 'unrolling',
        currentVtxoId: id,
        currentTxid: undefined,
        feeAddress: bumper.address,
        feeBalanceSats,
        error: undefined,
      });
      await this.storage.setEmergencyExit(state);

      try {
        const session = await Unroll.Session.create(
          { txid, vout },
          bumper,
          bumper.provider,
          this.wallet.indexerProvider,
        );
        const step = await session.next();
        if (step.type === Unroll.StepType.WAIT) {
          state = updateState(state, {
            stage: 'waiting-confirmation',
            currentTxid: step.txid,
          });
          await this.storage.setEmergencyExit(state);
          return state;
        }
        if (step.type === Unroll.StepType.UNROLL) {
          await step.do();
          state = updateState(state, {
            stage: 'waiting-confirmation',
            currentTxid: step.tx.id,
          });
          await this.storage.setEmergencyExit(state);
          return state;
        }

        completed.add(id);
        state = updateState(state, {
          stage: 'unrolling',
          completedVtxoIds: [...completed],
          currentVtxoId: undefined,
          currentTxid: undefined,
        });
        await this.storage.setEmergencyExit(state);
      } catch (cause) {
        state = updateState(state, {
          stage: 'failed',
          error: errorMessage(cause),
        });
        await this.storage.setEmergencyExit(state);
        return state;
      }
    }

    state = updateState(state, {
      stage: 'completing',
      completedVtxoIds: [...completed],
      currentVtxoId: undefined,
      currentTxid: undefined,
      error: undefined,
    });
    await this.storage.setEmergencyExit(state);
    try {
      const finalTxid = await Unroll.completeUnroll(
        this.wallet,
        [...new Set(state.selectedIds.map(id => parseOutpoint(id).txid))],
        state.destination,
      );
      state = updateState(state, {
        stage: 'completed',
        finalTxid,
      });
    } catch (cause) {
      const message = errorMessage(cause);
      state = updateState(state, {
        stage: isWaitingForTimelock(message)
          ? 'waiting-timelock'
          : isWaitingForConfirmation(message)
            ? 'waiting-confirmation'
            : 'failed',
        error: message,
      });
    }
    await this.storage.setEmergencyExit(state);
    return state;
  }

  clear(): Promise<void> {
    return this.storage.clearEmergencyExit();
  }

  private async getBumper(): Promise<OnchainWallet> {
    return OnchainWallet.create(
      MnemonicIdentity.fromMnemonic(this.mnemonic, {
        isMainnet: NETWORK === 'bitcoin',
      }),
      NETWORK,
      this.wallet.onchainProvider,
    );
  }

  private async idleState(): Promise<EmergencyExitState> {
    const bumper = await this.getBumper();
    const feeBalanceSats = await bumper.getBalance().catch(() => 0);
    const now = Date.now();
    return {
      version: 1,
      stage: 'idle',
      destination: '',
      selectedIds: [],
      selectedAmountSats: 0,
      feeAddress: bumper.address,
      feeBalanceSats,
      completedVtxoIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }
}
