export const PRIVATE_CLOUD_ENABLED =
  process.env.EXPO_PUBLIC_PRIVATE_CLOUD_ENABLED !== 'false';

export const PRIVATE_CLOUD_DISABLED_MESSAGE =
  'Private Cloud is unavailable in this beta build.';

export function assertPrivateCloudEnabled(): void {
  if (!PRIVATE_CLOUD_ENABLED) {
    throw new Error(PRIVATE_CLOUD_DISABLED_MESSAGE);
  }
}
