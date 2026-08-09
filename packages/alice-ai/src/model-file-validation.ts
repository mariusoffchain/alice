export function isExpectedModelFileSize(
  actualBytes: number | undefined,
  expectedBytes: number,
): boolean {
  return Number.isFinite(actualBytes)
    && actualBytes === expectedBytes;
}
