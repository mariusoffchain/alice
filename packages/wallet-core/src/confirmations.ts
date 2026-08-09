import { ESPLORA_URL } from './network-config.ts';

export async function getConfirmations(txid: string): Promise<number | null> {
  try {
    const [txRes, tipRes] = await Promise.all([
      fetch(`${ESPLORA_URL}/tx/${txid}`),
      fetch(`${ESPLORA_URL}/blocks/tip/height`),
    ]);
    if (!txRes.ok || !tipRes.ok) return null;

    const tx = await txRes.json();
    const tipHeight = parseInt(await tipRes.text(), 10);

    if (!tx.status?.confirmed || !tx.status?.block_height) return 0;
    if (!Number.isFinite(tipHeight) || tipHeight < tx.status.block_height) return null;
    return Math.max(0, tipHeight - tx.status.block_height + 1);
  } catch {
    return null;
  }
}
