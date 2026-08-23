/**
 * The one slot holding the running wallet backend, and the rules that keep
 * it tied to the phrase it was built from.
 *
 * Kept free of React Native and of the SDK so the seed race can be tested
 * deterministically: an initialisation started for phrase A that resolves
 * after phrase B was saved must be destroyed on arrival, never stored, never
 * handed to a caller.
 */

export type SlotStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface Disposable {
  init(): Promise<void>;
  dispose(): Promise<void>;
}

export interface GenerationTracker {
  current(): number;
  bind(): void;
  stale(): boolean;
  unbind(): void;
}

export interface BackendSlotOptions<B extends Disposable> {
  /** Builds a fresh, not yet initialised backend. */
  create(): Promise<B>;
  generation: GenerationTracker;
  initTimeoutMs: number;
  initTimeoutMessage: string;
  disposeTimeoutMs?: number;
  /** Whether a failed init deserves one immediate retry. */
  isTransient?(error: unknown): boolean;
  log?(level: 'info' | 'warning' | 'error', title: string, detail?: string): void;
}

/** Thrown to callers whose backend was superseded by a new phrase mid-flight. */
export class WalletReplacedError extends Error {
  constructor() {
    super('The wallet changed while connecting. Please try again.');
    this.name = 'WalletReplacedError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

export function createBackendSlot<B extends Disposable>(options: BackendSlotOptions<B>) {
  let backend: B | null = null;
  let initPromise: Promise<B> | null = null;
  let status: SlotStatus = 'disconnected';
  let lastError: string | null = null;
  const { generation } = options;
  const log = options.log ?? (() => {});

  function disposeQuietly(target: B): Promise<void> {
    return withTimeout(
      target.dispose(),
      options.disposeTimeoutMs ?? 3_000,
      'Wallet backend dispose timed out.',
    ).catch(() => {});
  }

  async function ensure(): Promise<B> {
    // Second barrier behind onboarding's explicit discard: a backend built
    // from a phrase that has since been replaced is never handed out.
    if (backend && generation.stale()) {
      await restart();
    }
    if (backend) {
      status = 'connected';
      return backend;
    }

    if (!initPromise) {
      status = 'connecting';
      lastError = null;
      generation.bind();
      // The phrase this initialisation is built from. A phrase saved while
      // the backend is still connecting (an import abandoned, then "Create
      // wallet" within the connection window) makes this work obsolete: the
      // backend it produces must be thrown away, never stored as the wallet.
      const startedFor = generation.current();
      let self: Promise<B> | null = null;
      const run = (async () => {
        let failure: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const next = await options.create();
          try {
            await withTimeout(next.init(), options.initTimeoutMs, options.initTimeoutMessage);
            if (generation.current() !== startedFor || initPromise !== self) {
              void disposeQuietly(next);
              throw new WalletReplacedError();
            }
            backend = next;
            status = 'connected';
            lastError = null;
            log('info', 'Arkade wallet connected');
            return next;
          } catch (error) {
            if (error instanceof WalletReplacedError) throw error;
            failure = error;
            void disposeQuietly(next);
            if (attempt === 0 && options.isTransient?.(error)) {
              log('warning', 'Arkade connection retrying over network', 'A transient connection error occurred during wallet initialization.');
              continue;
            }
          }
        }
        if (initPromise === self) {
          status = 'error';
          lastError = failure instanceof Error ? failure.message : String(failure);
        }
        log('error', 'Arkade connection failed', `error_class=${failure instanceof Error ? failure.name : 'unknown'}`);
        throw failure;
      })();
      self = run;
      initPromise = run;
      void run.catch(() => {}).finally(() => {
        // Only this initialisation may clear the slot: a restart in the
        // meantime has already replaced or emptied it.
        if (initPromise === run) initPromise = null;
      });
    }

    const ready = await initPromise;
    if (generation.stale() || backend !== ready) {
      // The phrase changed while we were waiting on someone else's
      // initialisation: that backend is not ours to use.
      throw new WalletReplacedError();
    }
    return ready;
  }

  /** Empties the slot and disposes the backend it held, bounded in time. */
  async function restart(): Promise<void> {
    const active = backend;
    backend = null;
    initPromise = null;
    generation.unbind();
    if (active) {
      // Bounded: "Create wallet" must not hang offline on a backend that
      // cannot reach the network to say goodbye.
      await disposeQuietly(active);
    }
  }

  /** Empties the slot without disposing: the caller already did. */
  function forget(): void {
    backend = null;
    initPromise = null;
  }

  return {
    ensure,
    restart,
    forget,
    current(): B | null { return backend; },
    status(): SlotStatus { return status; },
    error(): string | null { return lastError; },
  };
}
