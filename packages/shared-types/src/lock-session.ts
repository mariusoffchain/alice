let unlocked = false;

export function isSessionUnlocked(): boolean {
  return unlocked;
}

export function unlockSession(): void {
  unlocked = true;
}

export function lockSession(): void {
  unlocked = false;
}
