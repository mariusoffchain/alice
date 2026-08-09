import AsyncStorage from '@react-native-async-storage/async-storage';

const INDEX_KEY = 'alice_downloaded_pack_ids';
const LAST_CHECKED_KEY = 'alice_pack_updates_last_checked_at';

function packKey(packId: string): string {
  return `alice_pack_${packId}`;
}

export async function readPackIndex(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function writePackIndex(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(ids));
}

export async function readPackData(packId: string): Promise<string | null> {
  return AsyncStorage.getItem(packKey(packId));
}

export async function writePackData(packId: string, data: string): Promise<void> {
  await AsyncStorage.setItem(packKey(packId), data);
  const index = await readPackIndex();
  if (!index.includes(packId)) {
    await writePackIndex([...index, packId]);
  }
}

export async function deletePackData(packId: string): Promise<void> {
  await AsyncStorage.removeItem(packKey(packId));
  const index = await readPackIndex();
  await writePackIndex(index.filter(id => id !== packId));
}

export async function readLastCheckedAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(LAST_CHECKED_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function writeLastCheckedAt(timestamp: number): Promise<void> {
  await AsyncStorage.setItem(LAST_CHECKED_KEY, String(timestamp));
}
