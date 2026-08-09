export const ARKADE_BACKGROUND_TASK_NAME = 'alice-arkade-background-sync';

export async function registerArkadeBackgroundSync(): Promise<boolean> {
  return false;
}

export async function unregisterArkadeBackgroundSync(): Promise<void> {}

export async function closeArkadeBackgroundDatabase(): Promise<void> {}
