import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_SAT_STEP,
  SAT_PRICE_MAX_AGE_MS,
  SAT_PRICE_MAX_DRIFT,
  satsForMinor,
  satStep,
  shouldRepin,
} from './sat-price.ts';
import { type Env } from './index.ts';

/** 90 000 EUR per coin, in cents. */
const RATE = 9_000_000;

describe('satsForMinor', () => {
  it('quotes a 5 EUR plan in satoshis, rounded to the step', () => {
    // 500 / 9 000 000 of a coin is 5 555.55 sats. The step is what makes the
    // figure look like a price instead of a measurement.
    assert.equal(satsForMinor(500, RATE, 100), 5_600);
    assert.equal(satsForMinor(1_000, RATE, 100), 11_100);
  });

  it('rounds to nearest rather than up', () => {
    // Rounding up on every quote would be a silent surcharge on every buyer,
    // small enough that nobody would notice and wrong for exactly that reason.
    assert.equal(satsForMinor(500, RATE, 1_000), 6_000);
    assert.equal(satsForMinor(520, RATE, 1_000), 6_000);
  });

  it('follows the rate: a dearer coin means fewer satoshis', () => {
    const cheap = satsForMinor(500, RATE, 100);
    const dear = satsForMinor(500, RATE * 2, 100);
    assert.ok(dear < cheap);
    assert.equal(dear, 2_800);
  });

  it('never quotes zero, whatever the rate', () => {
    // A free-looking price on a paid plan sells nothing and looks broken.
    assert.equal(satsForMinor(500, RATE * 100_000, 100), 100);
  });

  it('refuses to invent a price without a rate', () => {
    assert.equal(satsForMinor(500, 0, 100), 0);
    assert.equal(satsForMinor(0, RATE, 100), 0);
  });
});

describe('shouldRepin', () => {
  const now = 1_800_000_000_000;

  it('holds the price still while the rate barely moves', () => {
    // The whole point of pinning: a quote that ticks with the market is not a
    // price, it is a ticker, and nobody agrees to a ticker.
    const pin = { rate_minor: RATE, pinned_at: now - 60 * 60 * 1_000 };
    assert.equal(shouldRepin(pin, RATE * 1.01, now), false);
    assert.equal(shouldRepin(pin, RATE * 0.99, now), false);
  });

  it('moves the price when the rate has run away from it', () => {
    const pin = { rate_minor: RATE, pinned_at: now - 60 * 60 * 1_000 };
    const drifted = RATE * (1 + SAT_PRICE_MAX_DRIFT);
    assert.equal(shouldRepin(pin, drifted, now), true);
    assert.equal(shouldRepin(pin, RATE * (1 - SAT_PRICE_MAX_DRIFT), now), true);
  });

  it('replaces a pin that has simply aged out', () => {
    const stale = { rate_minor: RATE, pinned_at: now - SAT_PRICE_MAX_AGE_MS };
    assert.equal(shouldRepin(stale, RATE, now), true);
  });
});

describe('satStep', () => {
  it('defaults to a round step', () => {
    assert.equal(satStep({} as Env), DEFAULT_SAT_STEP);
  });

  it('ignores a step that would break the quote', () => {
    // A zero or negative step would divide by nothing and quote nonsense, so a
    // bad variable falls back rather than taking the price down with it.
    assert.equal(satStep({ SAT_PRICE_STEP: '0' } as Env), DEFAULT_SAT_STEP);
    assert.equal(satStep({ SAT_PRICE_STEP: '-50' } as Env), DEFAULT_SAT_STEP);
    assert.equal(satStep({ SAT_PRICE_STEP: 'free' } as Env), DEFAULT_SAT_STEP);
    assert.equal(satStep({ SAT_PRICE_STEP: '500' } as Env), 500);
  });
});
