/**
 * Quoting a price in satoshis without letting it flicker.
 *
 * Alice never shows a euro figure to a buyer. The plans are still anchored to
 * euros, because Venice bills in fiat and a plan denominated in satoshis would
 * make Alice's revenue swing with the exchange rate while her costs did not.
 * So the euro amount is the anchor and the satoshi amount is the quote.
 *
 * The quote has to hold still. A price recomputed on every render would tick
 * every few seconds, which does not read as a price at all, and a buyer who
 * sees one number in the app and another on the payment page concludes that
 * one of them is a lie. So a single rate is pinned in the database, everything
 * quotes from it, and the hourly cron replaces it only when it has aged out or
 * moved far enough to be worth moving.
 */

import type { Env } from './index';

/** The rounding step, in satoshis. A quote is always a multiple of it. */
export const DEFAULT_SAT_STEP = 100;

/** How long a pinned rate is honoured before it is replaced on principle. */
export const SAT_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

/**
 * How far the live rate may wander before the pin is replaced early.
 *
 * This is the only thing standing between a fast move and a price that is
 * plainly wrong, so it is deliberately tighter than the daily refresh.
 */
export const SAT_PRICE_MAX_DRIFT = 0.05;

const SATS_PER_BTC = 100_000_000;

export type SatPricePin = {
  /** BTC price in minor units of the anchor currency, ie. cents for EUR. */
  rate_minor: number;
  pinned_at: number;
};

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function satStep(env: Env): number {
  return Math.max(1, Math.floor(positiveNumber(env.SAT_PRICE_STEP, DEFAULT_SAT_STEP)));
}

export function anchorCurrency(env: Env): string {
  const value = (env.BILLING_CURRENCY ?? 'EUR').toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : 'EUR';
}

/**
 * Turn an anchored amount into a satoshi quote.
 *
 * Rounds to the nearest step rather than up: rounding up on every quote would
 * quietly overcharge, and at these amounts the step is worth a fraction of a
 * cent either way. Never returns zero, because a free-looking price on a paid
 * plan would be a bug that sells nothing.
 */
export function satsForMinor(minor: number, rateMinor: number, step: number): number {
  if (!(rateMinor > 0) || !(minor > 0)) return 0;
  const exact = (minor / rateMinor) * SATS_PER_BTC;
  const rounded = Math.round(exact / step) * step;
  return Math.max(step, rounded);
}

/**
 * Ask Coinbase what a bitcoin costs.
 *
 * The same source the wallet already uses for its balance conversion, so the
 * two halves of the app never disagree about the rate in front of the user.
 */
export async function fetchRateMinor(currency: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.coinbase.com/v2/prices/BTC-${currency}/spot`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) return null;
    const body = await response.json() as { data?: { amount?: string } };
    const amount = Number(body?.data?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return Math.round(amount * 100);
  } catch {
    return null;
  }
}

export async function loadPin(env: Env, currency: string): Promise<SatPricePin | null> {
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT rate_minor, pinned_at FROM sat_price_pin WHERE currency = ?
  `).bind(currency).first<SatPricePin>();
  return row ?? null;
}

async function savePin(
  env: Env,
  currency: string,
  rateMinor: number,
  now: number,
): Promise<void> {
  await env.ACCOUNT_DB.prepare(`
    INSERT INTO sat_price_pin (currency, rate_minor, pinned_at)
    VALUES (?, ?, ?)
    ON CONFLICT(currency) DO UPDATE SET rate_minor = excluded.rate_minor,
                                        pinned_at = excluded.pinned_at
  `).bind(currency, rateMinor, now).run();
}

/** Whether a live rate is far enough from the pin to justify moving the price. */
export function shouldRepin(pin: SatPricePin, liveMinor: number, now: number): boolean {
  if (now - pin.pinned_at >= SAT_PRICE_MAX_AGE_MS) return true;
  const drift = Math.abs(liveMinor - pin.rate_minor) / pin.rate_minor;
  return drift >= SAT_PRICE_MAX_DRIFT;
}

/**
 * The rate every quote is built from.
 *
 * Reads the pin and nothing else on the hot path: a price should not depend on
 * a third party being reachable while someone is looking at it. The only time
 * this fetches is when no pin exists yet, which is the very first quote after
 * a deployment.
 */
export async function currentRateMinor(env: Env, now = Date.now()): Promise<number | null> {
  const currency = anchorCurrency(env);
  const pin = await loadPin(env, currency);
  if (pin) return pin.rate_minor;

  const live = await fetchRateMinor(currency);
  if (live === null) return null;
  await savePin(env, currency, live, now);
  return live;
}

/**
 * The hourly job that lets the price move.
 *
 * Fetching here rather than in the request path is what keeps the quote stable
 * between runs: the app cannot change the price by being looked at. A failed
 * fetch leaves the previous pin in place, so a Coinbase outage freezes the
 * price rather than removing it.
 */
export async function refreshSatPrice(env: Env, now = Date.now()): Promise<void> {
  if (!env.ACCOUNT_DB) return;
  const currency = anchorCurrency(env);
  const live = await fetchRateMinor(currency);
  if (live === null) return;

  const pin = await loadPin(env, currency);
  if (pin && !shouldRepin(pin, live, now)) return;
  await savePin(env, currency, live, now);
}
