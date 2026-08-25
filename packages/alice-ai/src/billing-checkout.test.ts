import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCheckoutSettled, type AlicePendingCheckout } from './billing-checkout.ts';
import type { AliceBilling } from './account-client.ts';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = 1_760_000_000_000;

function pending(previousExpiresAt: number | null): AlicePendingCheckout {
  return {
    invoice_id: 'invoice-test',
    plan: 'cloud',
    months: 1,
    amount_sats: 5_600,
    started_at: NOW,
    previous_expires_at: previousExpiresAt,
  };
}

function billing(overrides: Partial<AliceBilling> = {}): AliceBilling {
  return {
    plan: 'cloud',
    purchased_plan: 'cloud',
    plan_expires_at: NOW + 30 * DAY_MS,
    expired: false,
    period_started_at: NOW,
    period_ends_at: NOW + 30 * DAY_MS,
    usage_percent: 0,
    input_bytes_used: 0,
    input_bytes_limit: 29_600_000,
    output_bytes_used: 0,
    output_bytes_limit: 7_400_000,
    billing_email_masked: null,
    ...overrides,
  };
}

describe('waiting for a bitcoin payment to settle', () => {
  it('keeps waiting while the account is still on the free plan', () => {
    // The window between "invoice opened" and "webhook received" is exactly
    // where a user fears their money vanished. Nothing may be granted here.
    assert.equal(
      isCheckoutSettled(pending(null), billing({ plan: 'free', plan_expires_at: null })),
      false,
    );
  });

  it('keeps waiting when no billing snapshot has loaded yet', () => {
    assert.equal(isCheckoutSettled(pending(null), null), false);
  });

  it('settles a first purchase once an expiry appears', () => {
    assert.equal(isCheckoutSettled(pending(null), billing()), true);
  });

  it('settles a renewal, where the plan name never changes', () => {
    const previous = NOW + 5 * DAY_MS;
    // The naive test -- "is the plan paid?" -- was already true before this
    // payment, so only the expiry moving forward proves the invoice landed.
    assert.equal(
      isCheckoutSettled(pending(previous), billing({ plan_expires_at: previous + 30 * DAY_MS })),
      true,
    );
  });

  it('keeps waiting when a renewal has not been credited yet', () => {
    const previous = NOW + 5 * DAY_MS;
    assert.equal(
      isCheckoutSettled(pending(previous), billing({ plan_expires_at: previous })),
      false,
    );
  });

  it('keeps waiting on an upgrade until the new time is actually added', () => {
    const previous = NOW + 20 * DAY_MS;
    assert.equal(
      isCheckoutSettled(
        pending(previous),
        billing({ plan: 'cloud', plan_expires_at: previous }),
      ),
      false,
    );
  });
});
