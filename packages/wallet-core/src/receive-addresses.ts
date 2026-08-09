import type { Wallet } from '@arkade-os/sdk';
import type {
  ReceiveAddressLayer,
  ReceiveAddressRecord,
  WalletStateStorage,
} from './wallet-state-storage';

export const RECEIVE_RESTORE_GAP_LIMIT = 100;

type RotatingWallet = Pick<
  Wallet,
  | 'getAddress'
  | 'getBoardingAddress'
  | 'getNewBoardingAddress'
  | 'getContractManager'
  | 'getVtxoManager'
> & {
  readonly defaultContractScript: string;
  _receiveRotator?: {
    rotate(wallet: RotatingWallet): Promise<void>;
    runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  };
};

export class ReceiveAddressController {
  private readonly wallet: RotatingWallet;
  private readonly storage: WalletStateStorage;
  private rotation = Promise.resolve();

  constructor(
    wallet: RotatingWallet,
    storage: WalletStateStorage,
  ) {
    this.wallet = wallet;
    this.storage = storage;
  }

  async initialize(): Promise<void> {
    const [arkade, onchain] = await Promise.all([
      this.wallet.getAddress(),
      this.wallet.getBoardingAddress(),
    ]);
    await Promise.all([
      this.ensureCurrent(arkade, 'arkade'),
      this.ensureCurrent(onchain, 'onchain'),
    ]);
  }

  async list(): Promise<ReceiveAddressRecord[]> {
    await this.initialize();
    return (await this.storage.getReceiveAddresses())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async reserveArkade(): Promise<string> {
    return this.runExclusive(async () => {
      await this.initialize();
      return this.reserveArkadeUnlocked();
    });
  }

  async reserveOnchain(): Promise<string> {
    return this.runExclusive(async () => {
      await this.initialize();
      return this.reserveOnchainUnlocked();
    });
  }

  async reserveUnified(): Promise<{ arkade: string; onchain: string }> {
    return this.runExclusive(async () => {
      await this.initialize();
      const arkade = await this.reserveArkadeUnlocked();
      const onchain = await this.reserveOnchainUnlocked();
      return { arkade, onchain };
    });
  }

  private async reserveArkadeUnlocked(): Promise<string> {
    const current = await this.wallet.getAddress();
    const currentScript = this.wallet.defaultContractScript;
    const record = (await this.storage.getReceiveAddresses())
      .find(item => item.address === current);
    await this.rotateArkade();
    await (await this.wallet.getContractManager())
      .setContractState(currentScript, 'active');
    await this.storage.upsertReceiveAddress({
      address: current,
      layer: 'arkade',
      label: record?.label ?? '',
      shared: true,
      used: record?.used ?? false,
      current: false,
    });
    await this.ensureCurrent(await this.wallet.getAddress(), 'arkade');
    return current;
  }

  private async reserveOnchainUnlocked(): Promise<string> {
    const current = await this.wallet.getBoardingAddress();
    const record = (await this.storage.getReceiveAddresses())
      .find(item => item.address === current);
    const next = await this.wallet.getNewBoardingAddress();
    await this.storage.upsertReceiveAddress({
      address: current,
      layer: 'onchain',
      label: record?.label ?? '',
      shared: true,
      used: record?.used ?? false,
      current: false,
    });
    await this.ensureCurrent(next, 'onchain');
    return current;
  }

  async update(
    address: string,
    patch: Partial<Pick<ReceiveAddressRecord, 'label' | 'shared' | 'used' | 'archived'>>,
  ): Promise<ReceiveAddressRecord> {
    if (patch.archived) {
      const item = (await this.storage.getReceiveAddresses())
        .find(record => record.address === address);
      if (item?.current) {
        throw new Error('Generate a new address before archiving the current address.');
      }
    }
    return this.storage.updateReceiveAddress(address, patch);
  }

  private async rotateArkade(): Promise<void> {
    await this.wallet.getVtxoManager();
    const rotator = this.wallet._receiveRotator;
    if (!rotator) {
      throw new Error('HD Arkade address rotation is unavailable in this SDK build.');
    }
    await rotator.runExclusive(() => rotator.rotate(this.wallet));
  }

  private async ensureCurrent(
    address: string,
    layer: ReceiveAddressLayer,
  ): Promise<void> {
    const records = await this.storage.getReceiveAddresses();
    const existing = records.find(item => item.address === address);
    await this.storage.upsertReceiveAddress({
      address,
      layer,
      label: existing?.label ?? '',
      shared: existing?.shared ?? false,
      used: existing?.used ?? false,
      current: true,
      archived: false,
    });
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    const previous = this.rotation;
    this.rotation = next;
    return previous.then(async () => {
      try {
        return await operation();
      } finally {
        release();
      }
    });
  }
}
