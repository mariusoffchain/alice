import { aliceMemoryStorage } from './alice-memory-storage';
import {
  clearAliceMemoryCategoryInStorage,
  clearAliceMemoryFromStorage,
  editAliceMemoryItemInStorage,
  forgetAliceMemoryItemInStorage,
  getAliceMemoryFromStorage,
  setAliceMemoryCategoryPausedInStorage,
  writeAliceCandidatesToStorage,
  setAliceMemoryEnabledInStorage,
  type AliceMemoryCategory,
} from './alice-memory-core';

export * from './alice-memory-core';

export function getAliceMemory() {
  return getAliceMemoryFromStorage(aliceMemoryStorage);
}

export function rememberAliceCandidates(candidates: Parameters<typeof writeAliceCandidatesToStorage>[0]) {
  return writeAliceCandidatesToStorage(candidates, aliceMemoryStorage);
}

export function forgetAliceMemoryItem(id: string) {
  return forgetAliceMemoryItemInStorage(id, aliceMemoryStorage);
}

export function editAliceMemoryItem(id: string, text: string) {
  return editAliceMemoryItemInStorage(id, text, aliceMemoryStorage);
}

export function clearAliceMemoryCategory(category: AliceMemoryCategory) {
  return clearAliceMemoryCategoryInStorage(category, aliceMemoryStorage);
}

export function setAliceMemoryCategoryPaused(category: AliceMemoryCategory, paused: boolean) {
  return setAliceMemoryCategoryPausedInStorage(category, paused, aliceMemoryStorage);
}

export function setAliceMemoryEnabled(enabled: boolean) {
  return setAliceMemoryEnabledInStorage(enabled, aliceMemoryStorage);
}

export function clearAliceMemory() {
  return clearAliceMemoryFromStorage(aliceMemoryStorage);
}
