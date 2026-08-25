/**
 * Dev-only design review of the paid states.
 *
 * A paid plan cannot exist without an account behind it, because buying one
 * requires signing in first. So the preview has to fake the account too, or it
 * shows a screen the product can never produce: a CLOUD plan sitting above
 * "Not signed in". This lives on its own so the account tab and the checkout
 * section agree on when the preview is on.
 */
export function isBillingPreview(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('billing-preview') !== null
    || params.get('checkout-preview') === 'settled';
}

/** The name the preview signs in as. */
export const PREVIEW_ACCOUNT_NAME = 'preview';
