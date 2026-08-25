import type { AliceBilling, AlicePaidPlan } from './account-client';

/**
 * Pure checkout logic, kept apart from account-client because that module
 * pulls in expo/fetch and platform storage. Deciding whether a Bitcoin
 * payment has landed is the part most worth testing, and it should not need a
 * React Native runtime to run.
 */

/**
 * A checkout the user has started and that has not been credited yet.
 *
 * Bitcoin does not settle when the buyer closes the payment page: the plan
 * appears only once BTCPay's signed webhook reaches the Worker, which can be
 * seconds or minutes later, and after the app has been closed. Persisting this
 * is what lets Alice say "waiting for confirmation" instead of losing the
 * payment from view and looking like it swallowed the money.
 */
export type AlicePendingCheckout = {
  invoice_id: string;
  plan: AlicePaidPlan;
  months: number;
  /** What was quoted, in satoshis. Alice never shows a buyer a euro figure. */
  amount_sats: number;
  started_at: number;
  /**
   * The expiry in force when checkout began, so settlement can be detected by
   * the expiry moving forward. Works for a first purchase and a renewal alike.
   */
  previous_expires_at: number | null;
};

/** Pending checkouts older than this stop being watched. */
export const PENDING_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Has the server credited the payment we are waiting for?
 *
 * Settlement is read from the expiry moving past where it stood when checkout
 * began, which is one test that covers both a first purchase and a renewal.
 * Comparing the plan name instead would miss a renewal of the same plan, and
 * trusting the client's own optimism would grant capacity nobody paid for.
 */
export function isCheckoutSettled(
  pending: AlicePendingCheckout,
  billing: AliceBilling | null,
): boolean {
  return billing !== null
    && billing.plan !== 'free'
    && billing.plan_expires_at !== null
    && billing.plan_expires_at > (pending.previous_expires_at ?? 0);
}
