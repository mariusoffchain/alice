/** True only when Arkade rejects local state from another seed or network. */
export function isHdDescriptorMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /hd descriptor mismatch|refusing to reuse hd state|different entity/i.test(message);
}
