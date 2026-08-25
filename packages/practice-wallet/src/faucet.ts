/**
 * Client for the public Mutinynet faucet, used to credit the practice wallet
 * with its first sats without any external steps.
 */
export const PRACTICE_FAUCET_URL = 'https://faucet.mutinynet.com';
export const PRACTICE_FAUCET_DEFAULT_SATS = 100_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export async function requestPracticeFaucet(params: {
  address: string;
  sats?: number;
  faucetUrl?: string;
  fetchImpl?: FetchLike;
}): Promise<{ txid: string }> {
  const {
    address,
    sats = PRACTICE_FAUCET_DEFAULT_SATS,
    faucetUrl = PRACTICE_FAUCET_URL,
    fetchImpl = defaultFetch,
  } = params;
  if (!Number.isInteger(sats) || sats <= 0) {
    throw new Error('The faucet amount must be a whole number of sats above zero.');
  }

  const response = await fetchImpl(`${faucetUrl.replace(/\/$/, '')}/api/onchain`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sats, address }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(
      `The Mutinynet faucet refused the request (${response.status}).` +
        (detail ? ` ${detail}` : ''),
    );
  }

  const payload = (await response.json().catch(() => null)) as { txid?: unknown } | null;
  if (!payload || typeof payload.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(payload.txid)) {
    throw new Error('The Mutinynet faucet returned an unexpected response.');
  }
  return { txid: payload.txid };
}
