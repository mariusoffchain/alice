import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackendSlot, WalletReplacedError } from './backend-slot.ts';
import { createSeedGenerationTracker } from './seed-generation.ts';

/** A backend whose init() resolves only when the test says so. */
class FakeBackend {
  readonly label: string;
  disposed = false;
  private release!: () => void;
  private readonly gate: Promise<void>;

  constructor(label: string) {
    this.label = label;
    this.gate = new Promise<void>(resolve => { this.release = resolve; });
  }

  init(): Promise<void> { return this.gate; }
  finishInit(): void { this.release(); }
  async dispose(): Promise<void> { this.disposed = true; }
}

function makeSlot(backends: FakeBackend[]) {
  const generation = createSeedGenerationTracker();
  const created: FakeBackend[] = [];
  const slot = createBackendSlot<FakeBackend>({
    create: async () => {
      const next = backends.shift();
      if (!next) throw new Error('no backend left to create');
      created.push(next);
      return next;
    },
    generation,
    initTimeoutMs: 1_000,
    initTimeoutMessage: 'timed out',
    disposeTimeoutMs: 50,
  });
  return { slot, generation, created };
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('an initialisation started for A that resolves after B is saved is destroyed, never served', async () => {
  const a = new FakeBackend('A');
  const b = new FakeBackend('B');
  const { slot, generation } = makeSlot([a, b]);

  generation.bump(); // phrase A saved
  const waitingOnA = slot.ensure(); // home screen starts connecting for A
  await tick();
  assert.equal(slot.status(), 'connecting');

  // "Create wallet": onboarding discards the wallet, then saves phrase B.
  await slot.restart();
  generation.bump();

  // A's connection now completes, late.
  a.finishInit();
  await assert.rejects(waitingOnA, WalletReplacedError);
  await tick();
  assert.equal(a.disposed, true, 'the A backend must be disposed on arrival');
  assert.equal(slot.current(), null, 'the A backend must never be stored');

  // The next request builds B and gets B.
  const waitingOnB = slot.ensure();
  b.finishInit();
  assert.equal(await waitingOnB, b);
  assert.equal(slot.current(), b);
  assert.equal(slot.status(), 'connected');
});

test('a phrase saved while A is connecting, without an explicit restart, still discards A', async () => {
  const a = new FakeBackend('A');
  const b = new FakeBackend('B');
  const { slot, generation } = makeSlot([a, b]);

  generation.bump();
  const waitingOnA = slot.ensure();
  await tick();
  generation.bump(); // saveMnemonic(B) alone, restart raced or skipped
  a.finishInit();

  await assert.rejects(waitingOnA, WalletReplacedError);
  await tick();
  assert.equal(a.disposed, true);
  assert.equal(slot.current(), null);

  const waitingOnB = slot.ensure();
  b.finishInit();
  assert.equal(await waitingOnB, b);
});

test('a second caller waiting on the same initialisation is refused too', async () => {
  const a = new FakeBackend('A');
  const { slot, generation } = makeSlot([a]);

  generation.bump();
  const first = slot.ensure();
  const second = slot.ensure(); // joins the same in-flight init
  await tick();
  generation.bump();
  a.finishInit();

  await assert.rejects(first, WalletReplacedError);
  await assert.rejects(second, WalletReplacedError);
  assert.equal(a.disposed, true);
});

test('a stored backend that predates the latest phrase is replaced on the next request', async () => {
  const a = new FakeBackend('A');
  const b = new FakeBackend('B');
  const { slot, generation } = makeSlot([a, b]);

  generation.bump();
  const waitingOnA = slot.ensure();
  a.finishInit();
  assert.equal(await waitingOnA, a);

  generation.bump(); // phrase B saved over a connected A
  const waitingOnB = slot.ensure();
  b.finishInit();
  assert.equal(await waitingOnB, b);
  assert.equal(a.disposed, true);
  assert.equal(slot.current(), b);
});

test('the happy path stores and returns the backend it built', async () => {
  const a = new FakeBackend('A');
  const { slot, generation } = makeSlot([a]);
  generation.bump();
  const waiting = slot.ensure();
  a.finishInit();
  assert.equal(await waiting, a);
  assert.equal(slot.current(), a);
  assert.equal(a.disposed, false);
});
