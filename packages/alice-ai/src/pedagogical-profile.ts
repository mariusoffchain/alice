import { pedagogicalProfileStorage } from './pedagogical-profile-storage';
import {
  clearPedagogicalProfileFromStorage,
  forgetPedagogicalConceptInStorage,
  getPedagogicalProfileFromStorage,
  recordPedagogicalSignalInStorage,
} from './pedagogical-profile-core';

export * from './pedagogical-profile-core';

export function getPedagogicalProfile() {
  return getPedagogicalProfileFromStorage(pedagogicalProfileStorage);
}

export function recordPedagogicalSignal(message: string) {
  return recordPedagogicalSignalInStorage(message, pedagogicalProfileStorage);
}

export function clearPedagogicalProfile() {
  return clearPedagogicalProfileFromStorage(pedagogicalProfileStorage);
}

export function forgetPedagogicalConcept(concept: Parameters<typeof forgetPedagogicalConceptInStorage>[0]) {
  return forgetPedagogicalConceptInStorage(concept, pedagogicalProfileStorage);
}
