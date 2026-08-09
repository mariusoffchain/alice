import { aliceMemoryStorage } from './alice-memory-storage';
import {
  clearAliceMemoryFromStorage,
  forgetAliceMemoryItemInStorage,
  getAliceMemoryFromStorage,
  rememberAliceCandidatesInStorage,
  setAliceMemoryEnabledInStorage,
} from './alice-memory-core';

export * from './alice-memory-core';

export function getAliceMemory() {
  return getAliceMemoryFromStorage(aliceMemoryStorage);
}

export function rememberAliceCandidates(candidates: Parameters<typeof rememberAliceCandidatesInStorage>[0]) {
  return rememberAliceCandidatesInStorage(candidates, aliceMemoryStorage);
}

export function forgetAliceMemoryItem(id: string) {
  return forgetAliceMemoryItemInStorage(id, aliceMemoryStorage);
}

export function setAliceMemoryEnabled(enabled: boolean) {
  return setAliceMemoryEnabledInStorage(enabled, aliceMemoryStorage);
}

export function clearAliceMemory() {
  return clearAliceMemoryFromStorage(aliceMemoryStorage);
}
