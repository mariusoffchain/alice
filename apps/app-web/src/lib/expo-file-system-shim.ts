export const documentDirectory: string | null = null;
export const bundleDirectory: string | null = null;
export const cacheDirectory: string | null = null;

export async function getInfoAsync(_uri: string, _options?: Record<string, unknown>): Promise<{ exists: boolean; size: number; isDirectory?: boolean }> {
  return { exists: false, size: 0 };
}

export async function deleteAsync(_uri: string, _options?: Record<string, unknown>): Promise<void> {}

export async function makeDirectoryAsync(_uri: string, _options?: Record<string, unknown>): Promise<void> {}

export async function copyAsync(_options: { from: string; to: string }): Promise<void> {}

export async function moveAsync(_options: { from: string; to: string }): Promise<void> {}

export async function readDirectoryAsync(_uri: string): Promise<string[]> {
  return [];
}

export function createDownloadResumable(_uri: string, _fileUri: string, _options?: Record<string, unknown>, _callback?: (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) {
  return {
    downloadAsync: async () => ({ uri: '', status: 200 } as { uri: string; status: number }),
    pauseAsync: async () => ({}),
    resumeAsync: async () => ({ uri: '' }),
  };
}
