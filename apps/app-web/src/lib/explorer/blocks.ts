// Pure display helpers for the live block ribbon. No React, no fetch: the
// provider returns NormalizedBlock / ProjectedBlock, these turn numbers into a
// colour and human strings, and are unit tested in isolation.

// A green-to-red heat scale by median fee (sat/vB), the convention every block
// explorer uses. Semantic, so it stays a heat scale rather than a brand tint.
const FEE_TIERS: { max: number; color: string }[] = [
  { max: 1, color: '#3fa46a' },
  { max: 4, color: '#6aa84f' },
  { max: 10, color: '#b7a53f' },
  { max: 20, color: '#d1943a' },
  { max: 50, color: '#d1703a' },
  { max: 100, color: '#d1503a' },
  { max: Infinity, color: '#c83a3a' },
];

export function feeColor(medianFeeSatVb?: number): string {
  if (medianFeeSatVb === undefined || medianFeeSatVb <= 0) return 'var(--alice-muted)';
  return (FEE_TIERS.find(t => medianFeeSatVb <= t.max) ?? FEE_TIERS[FEE_TIERS.length - 1]).color;
}

// Same heat scale but always a concrete hex, for canvas fillStyle where CSS
// variables cannot be used. A zero/undefined rate falls back to a muted blue.
export function feeColorHex(rateSatVb: number): string {
  if (!(rateSatVb > 0)) return '#3a5578';
  return (FEE_TIERS.find(t => rateSatVb <= t.max) ?? FEE_TIERS[FEE_TIERS.length - 1]).color;
}

// Compact relative age from a block timestamp. `nowSec` is injectable for tests.
export function formatBlockAge(timestampSec: number, nowSec: number): string {
  const diff = Math.max(0, Math.floor(nowSec - timestampSec));
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// The confirmation moment, absolute and in the viewer's local time: relative
// ages ("176d ago") get vague fast, so the exact date rides along everywhere a
// confirmation is shown. One shared formatter keeps the style uniform.
export function formatDateTime(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Numeric date only (dd/mm/yyyy), for tight spots like the block ribbon. */
export function formatDateNum(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/** The ribbon's age label: relative while fresh, the plain numeric date once
 *  a week old (a "176d ago" says less than 14/08/2026). */
export function formatBlockAgeOrDate(timestampSec: number, nowSec: number): string {
  return nowSec - timestampSec >= 7 * 86400 ? formatDateNum(timestampSec) : formatBlockAge(timestampSec, nowSec);
}

// Byte size to a short human string, binary units.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// A block's fee spread as "low - high sat/vB", from the feeRange percentiles.
export function formatFeeRange(feeRange?: number[]): string | null {
  if (!feeRange || feeRange.length === 0) return null;
  const lo = feeRange[0];
  const hi = feeRange[feeRange.length - 1];
  const r = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  return lo === hi ? `${r(hi)} sat/vB` : `${r(lo)} - ${r(hi)} sat/vB`;
}
