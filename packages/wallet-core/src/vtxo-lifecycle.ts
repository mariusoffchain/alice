import {
  isExpired,
  isRecoverable,
  isSpendable,
  type ArkProvider,
  type ExtendedVirtualCoin,
  type IWallet,
} from '@arkade-os/sdk';
import type {
  VtxoInfo,
  VtxoMaintenanceResult,
  VtxoOperationResult,
  VtxoSyncResult,
} from './wallet-backend';
import type { WalletStateStorage } from './wallet-state-storage';

export const VTXO_RENEWAL_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1_000;
const MAX_SETTLEMENT_INPUTS = 50;
const FALLBACK_DUST_SATS = 330n;

type LifecycleWallet = IWallet & {
  arkProvider: Pick<ArkProvider, 'getInfo'>;
  dustAmount?: bigint;
};

function outpointId(vtxo: Pick<ExtendedVirtualCoin, 'txid' | 'vout'>): string {
  return `${vtxo.txid}:${vtxo.vout}`;
}

export function parseOutpoint(id: string): { txid: string; vout: number } {
  const match = id.match(/^([0-9a-f]{64}):(\d+)$/i);
  if (!match) throw new Error(`Invalid VTXO outpoint: ${id}`);
  const vout = Number(match[2]);
  if (!Number.isSafeInteger(vout) || vout < 0) {
    throw new Error(`Invalid VTXO outpoint: ${id}`);
  }
  return { txid: match[1].toLowerCase(), vout };
}

function hasValidExpiry(vtxo: ExtendedVirtualCoin): boolean {
  const expiry = vtxo.virtualStatus.batchExpiry;
  return expiry !== undefined && new Date(expiry).getFullYear() >= 2025;
}

export function classifyVtxo(
  vtxo: ExtendedVirtualCoin,
  exclusion?: { reason: string; excludedAt: number },
  now = Date.now(),
  freeze?: { frozenAt: number },
): VtxoInfo {
  const spendable = isSpendable(vtxo);
  const recoverable = isRecoverable(vtxo);
  const expired = isExpired(vtxo);
  const unrolled = Boolean(vtxo.isUnrolled);
  const needsRenewal = spendable
    && !recoverable
    && !expired
    && !unrolled
    && hasValidExpiry(vtxo)
    && Number(vtxo.virtualStatus.batchExpiry) - now <= VTXO_RENEWAL_THRESHOLD_MS;
  const excluded = exclusion !== undefined;
  const collaborativeEligible = spendable
    && !recoverable
    && !expired
    && !unrolled
    && !excluded
    && (vtxo.virtualStatus.state === 'preconfirmed'
      || vtxo.virtualStatus.state === 'settled');

  return {
    id: outpointId(vtxo),
    txid: vtxo.txid,
    vout: vtxo.vout,
    value: vtxo.value,
    state: vtxo.virtualStatus.state,
    batchExpiry: vtxo.virtualStatus.batchExpiry,
    createdAt: vtxo.createdAt.getTime(),
    spendable,
    recoverable,
    expired,
    unrolled,
    needsRenewal,
    collaborativeEligible,
    excluded,
    exclusionReason: exclusion?.reason,
    excludedAt: exclusion?.excludedAt,
    frozen: freeze !== undefined,
    frozenAt: freeze?.frozenAt,
  };
}

function chooseBatch(
  inputs: ExtendedVirtualCoin[],
  maxAmount: bigint,
): ExtendedVirtualCoin[] {
  const batch: ExtendedVirtualCoin[] = [];
  let total = 0n;
  for (const input of inputs) {
    if (batch.length >= MAX_SETTLEMENT_INPUTS) break;
    const next = total + BigInt(input.value);
    if (maxAmount >= 0n && next > maxAmount) continue;
    batch.push(input);
    total = next;
  }
  return batch;
}

export class VtxoLifecycleController {
  private readonly wallet: LifecycleWallet;
  private readonly storage: WalletStateStorage;
  private lastSyncedAt: number | null = null;

  constructor(wallet: LifecycleWallet, storage: WalletStateStorage) {
    this.wallet = wallet;
    this.storage = storage;
  }

  getLastSyncedAt(): number | null {
    return this.lastSyncedAt;
  }

  async list(): Promise<VtxoInfo[]> {
    const [vtxos, exclusions, frozen] = await Promise.all([
      this.wallet.getVtxos({ withRecoverable: true, withUnrolled: true }),
      this.storage.getExclusions(),
      this.storage.getFrozenVtxos(),
    ]);
    const byId = new Map(exclusions.map(item => [item.id, item]));
    const frozenById = new Map(frozen.map(item => [item.id, item]));
    return vtxos.map(vtxo => classifyVtxo(
      vtxo,
      byId.get(outpointId(vtxo)),
      Date.now(),
      frozenById.get(outpointId(vtxo)),
    ));
  }

  async sync(ids?: string[]): Promise<VtxoSyncResult> {
    const manager = await this.wallet.getContractManager();
    if (ids?.length) {
      await manager.refreshOutpoints([...new Set(ids)].map(parseOutpoint));
    } else {
      await manager.refreshVtxos({ includeInactive: true });
    }
    this.lastSyncedAt = Date.now();

    const vtxos = await this.wallet.getVtxos({ withRecoverable: true, withUnrolled: true });
    const live = new Map(vtxos.map(vtxo => [outpointId(vtxo), vtxo]));
    const exclusions = await this.storage.getExclusions();
    const resolved = exclusions
      .filter(item => {
        const vtxo = live.get(item.id);
        return !vtxo || !isSpendable(vtxo) || Boolean(vtxo.isUnrolled);
      })
      .map(item => item.id);
    const staleFrozen = (await this.storage.getFrozenVtxos())
      .filter(item => {
        const vtxo = live.get(item.id);
        return !vtxo || !isSpendable(vtxo) || Boolean(vtxo.isUnrolled);
      })
      .map(item => item.id);
    const [removedExclusions] = await Promise.all([
      this.storage.removeExclusions(resolved),
      this.storage.removeFrozenVtxos(staleFrozen),
    ]);

    return {
      syncedAt: this.lastSyncedAt,
      inputIds: ids?.length ? [...new Set(ids)] : vtxos.map(outpointId),
      removedExclusions,
    };
  }

  async renew(ids: string[]): Promise<VtxoOperationResult> {
    const result = await this.settleSelected(ids, 'renew', true);
    if (!result) throw new Error('No selected VTXOs are eligible to renew.');
    return result;
  }

  async recover(ids: string[]): Promise<VtxoOperationResult> {
    const result = await this.settleSelected(ids, 'recover', true);
    if (!result) throw new Error('No selected VTXOs are eligible to recover.');
    return result;
  }

  async maintain(): Promise<VtxoMaintenanceResult> {
    const sync = await this.sync();
    const manager = await this.wallet.getContractManager();
    const delegateManager = await this.wallet.getDelegateManager();
    const delegatedIds = new Set<string>();
    if (delegateManager) {
      const delegateContracts = await manager.getContractsWithVtxos({ type: 'delegate' });
      for (const item of delegateContracts) {
        for (const vtxo of item.vtxos) delegatedIds.add(outpointId(vtxo));
      }
    }
    const expiringIds = (await this.list())
      .filter(vtxo =>
        vtxo.needsRenewal
        && !vtxo.excluded
        && !delegatedIds.has(vtxo.id)
      )
      .map(vtxo => vtxo.id);
    const renewal = expiringIds.length > 0
      ? await this.settleSelected(expiringIds, 'renew', false)
      : null;
    return { sync, renewal };
  }

  async retryExcluded(id: string): Promise<VtxoSyncResult> {
    const result = await this.sync([id]);
    await this.storage.removeExclusions([id]);
    return result;
  }

  private async settleSelected(
    ids: string[],
    operation: 'renew' | 'recover',
    requireAll: boolean,
  ): Promise<VtxoOperationResult | null> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) throw new Error('Select at least 1 VTXO.');
    await this.sync(uniqueIds);

    const [all, exclusions, info] = await Promise.all([
      this.wallet.getVtxos({ withRecoverable: true, withUnrolled: false }),
      this.storage.getExclusions(),
      this.wallet.arkProvider.getInfo(),
    ]);
    const excluded = new Set(exclusions.map(item => item.id));
    const requested = new Map(
      all.filter(vtxo => uniqueIds.includes(outpointId(vtxo)))
        .map(vtxo => [outpointId(vtxo), vtxo]),
    );
    if (requested.size !== uniqueIds.length) {
      throw new Error('The selected VTXO set changed during synchronization. Review it again.');
    }

    let candidates = uniqueIds.map(id => requested.get(id)!);
    if (operation === 'renew') {
      candidates = candidates.filter(vtxo => {
        const info = classifyVtxo(vtxo, excluded.has(outpointId(vtxo))
          ? { reason: 'Excluded', excludedAt: 0 }
          : undefined);
        return info.needsRenewal && !info.excluded;
      });
    } else {
      candidates = candidates.filter(vtxo =>
        !excluded.has(outpointId(vtxo))
        && isSpendable(vtxo)
        && (isRecoverable(vtxo) || isExpired(vtxo))
        && !vtxo.isUnrolled
      );
    }
    if (requireAll && candidates.length !== uniqueIds.length) {
      throw new Error(
        `At least 1 selected VTXO is no longer eligible to ${operation}. Review the synchronized list.`,
      );
    }
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => operation === 'renew'
      ? (a.virtualStatus.batchExpiry ?? Infinity) - (b.virtualStatus.batchExpiry ?? Infinity)
      : b.value - a.value);
    const maxAmount = info.vtxoMaxAmount ?? -1n;
    const batch = chooseBatch(candidates, maxAmount);
    if (requireAll && batch.length !== candidates.length) {
      throw new Error(
        `This operation exceeds Arkade's ${MAX_SETTLEMENT_INPUTS}-input or ${maxAmount}-sat settlement limit. Select a smaller set.`,
      );
    }
    if (batch.length === 0) {
      throw new Error('No expiring VTXO fits within the current Arkade settlement limit.');
    }

    const amountSats = batch.reduce((sum, vtxo) => sum + vtxo.value, 0);
    const dust = this.wallet.dustAmount ?? FALLBACK_DUST_SATS;
    if (BigInt(amountSats) < dust) {
      throw new Error(`The selected total is below the ${dust}-sat Arkade dust limit.`);
    }
    const txid = await this.wallet.settle({
      inputs: batch,
      outputs: [{
        address: await this.wallet.getAddress(),
        amount: BigInt(amountSats),
      }],
    });
    await Promise.all([
      this.storage.removeExclusions(batch.map(outpointId)),
      this.storage.removeFrozenVtxos(batch.map(outpointId)),
    ]);
    return {
      txid,
      inputIds: batch.map(outpointId),
      amountSats,
    };
  }
}
