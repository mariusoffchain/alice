import {
  isExpired,
  isRecoverable,
  isSpendable,
  type ArkProvider,
  type ExtendedVirtualCoin,
  type IWallet,
} from '@arkade-os/sdk';
import type { WalletStateStorage } from './wallet-state-storage';

type SpendWallet = Pick<IWallet, 'getVtxos' | 'sendBitcoin'> & {
  arkProvider: Pick<ArkProvider, 'getInfo'>;
};
type FrozenStorage = Pick<WalletStateStorage, 'getFrozenVtxos'>;

export const FROZEN_FUNDS_ERROR =
  'THIS PAYMENT NEEDS A FROZEN VTXO. UNFREEZE IT IN COIN CONTROL OR SEND A SMALLER AMOUNT.';

export const SELECTED_FROZEN_ERROR =
  'A SELECTED VTXO IS FROZEN. UNFREEZE IT IN COIN CONTROL BEFORE SENDING.';

const DUST_LIMIT_ERROR_PREFIX = 'ARKADE_VTXO_DUST_LIMIT:';

function dustLimitError(minimumSats: number): Error {
  return new Error(`${DUST_LIMIT_ERROR_PREFIX}${minimumSats}`);
}

async function getVtxoMinimumSats(wallet: SpendWallet): Promise<number> {
  const minimumSats = Number((await wallet.arkProvider.getInfo()).vtxoMinAmount);
  if (!Number.isSafeInteger(minimumSats) || minimumSats <= 0) {
    throw new Error('Arkade did not provide a valid VTXO minimum.');
  }
  return minimumSats;
}

export function vtxoId(vtxo: Pick<ExtendedVirtualCoin, 'txid' | 'vout'>): string {
  return `${vtxo.txid}:${vtxo.vout}`;
}

export function isCollaborativeBitcoinVtxo(vtxo: ExtendedVirtualCoin): boolean {
  return isSpendable(vtxo)
    && !isRecoverable(vtxo)
    && !isExpired(vtxo)
    && !vtxo.isUnrolled
    && (vtxo.assets?.length ?? 0) === 0
    && (
      vtxo.virtualStatus.state === 'settled'
      || vtxo.virtualStatus.state === 'preconfirmed'
    );
}

export function selectBitcoinVtxos(
  inputs: ExtendedVirtualCoin[],
  amountSats: number,
  minimumVtxoSats: number,
): ExtendedVirtualCoin[] {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error('Enter a valid whole number of sats.');
  }
  if (!Number.isSafeInteger(minimumVtxoSats) || minimumVtxoSats <= 0) {
    throw new Error('Arkade did not provide a valid VTXO minimum.');
  }
  const candidates = inputs
    .filter(isCollaborativeBitcoinVtxo)
    .sort((a, b) => a.value - b.value || vtxoId(a).localeCompare(vtxoId(b)));
  const exact = candidates.find(input => input.value === amountSats);
  if (exact) return [exact];
  const single = candidates.find(input =>
    input.value > amountSats && input.value - amountSats >= minimumVtxoSats,
  );
  if (single) return [single];

  const selected: ExtendedVirtualCoin[] = [];
  let total = 0;
  for (const input of [...candidates].sort((a, b) =>
    b.value - a.value || vtxoId(a).localeCompare(vtxoId(b))
  )) {
    selected.push(input);
    total += input.value;
    const change = total - amountSats;
    if (change === 0 || change >= minimumVtxoSats) return selected;
  }
  return [];
}

export async function getFrozenSpendableAmount(
  wallet: Pick<IWallet, 'getVtxos'>,
  storage: FrozenStorage,
): Promise<number> {
  const [vtxos, frozen] = await Promise.all([
    wallet.getVtxos({ withRecoverable: false, withUnrolled: false }),
    storage.getFrozenVtxos(),
  ]);
  const frozenIds = new Set(frozen.map(item => item.id));
  return vtxos
    .filter(input => frozenIds.has(vtxoId(input)) && isCollaborativeBitcoinVtxo(input))
    .reduce((sum, input) => sum + input.value, 0);
}

export async function sendBitcoinRespectingFreeze(
  wallet: SpendWallet,
  storage: FrozenStorage,
  address: string,
  amountSats: number,
): Promise<string> {
  const [vtxos, frozen, minimumVtxoSats] = await Promise.all([
    wallet.getVtxos({ withRecoverable: false, withUnrolled: false }),
    storage.getFrozenVtxos(),
    getVtxoMinimumSats(wallet),
  ]);
  if (amountSats < minimumVtxoSats) throw dustLimitError(minimumVtxoSats);
  const frozenIds = new Set(frozen.map(item => item.id));
  const eligible = vtxos.filter(isCollaborativeBitcoinVtxo);
  const selected = selectBitcoinVtxos(
    eligible.filter(input => !frozenIds.has(vtxoId(input))),
    amountSats,
    minimumVtxoSats,
  );
  if (selected.length === 0) {
    const allSelected = selectBitcoinVtxos(eligible, amountSats, minimumVtxoSats);
    if (allSelected.length > 0) throw new Error(FROZEN_FUNDS_ERROR);
    const eligibleTotal = eligible.reduce((sum, input) => sum + input.value, 0);
    const change = eligibleTotal - amountSats;
    if (change > 0 && change < minimumVtxoSats) {
      throw dustLimitError(minimumVtxoSats);
    }
    throw new Error('Insufficient Arkade funds for this payment.');
  }
  if (selected.some(input => frozenIds.has(vtxoId(input)))) {
    throw new Error(SELECTED_FROZEN_ERROR);
  }
  return wallet.sendBitcoin({
    address,
    amount: amountSats,
    selectedVtxos: selected,
  });
}

export function freezeAwareWallet<T extends IWallet & { arkProvider: Pick<ArkProvider, 'getInfo'> }>(
  wallet: T,
  storage: FrozenStorage,
): T {
  return new Proxy(wallet, {
    get(target, property) {
      if (property === 'send') {
        return async (...recipients: Parameters<IWallet['send']>) => {
          if (recipients.length !== 1 || (recipients[0].assets?.length ?? 0) > 0) {
            const frozen = await storage.getFrozenVtxos();
            if (frozen.length > 0) {
              throw new Error(
                'Coin control cannot safely select frozen VTXOs for this asset payment.',
              );
            }
            return target.send(...recipients);
          }
          return sendBitcoinRespectingFreeze(
            target,
            storage,
            recipients[0].address,
            recipients[0].amount ?? 330,
          );
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
