import type { NextConfig } from 'next';
import path from 'path';

// Set by `tauri dev` when testing against a non-localhost host (e.g. a mobile
// device on the same network). Recommended by Tauri's Next.js integration guide
// so built assets resolve correctly: https://v2.tauri.app/start/frontend/nextjs/
const internalHost = process.env.TAURI_DEV_HOST;

const nextConfig: NextConfig = {
  output: 'export',
  // A stray package-lock.json outside the monorepo makes Next infer the wrong
  // workspace root, which breaks `next build` (PageNotFoundError on /_document).
  // Pin the root to the monorepo explicitly.
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  // Turbopack (used by `next dev`) has its own alias system separate from
  // webpack. Without this, it resolves `react-native` directly and chokes on
  // Flow syntax in the RN source. Mirrors the webpack aliases below exactly.
  turbopack: {
    // Turbopack does not support absolute paths in resolveAlias — they are
    // misinterpreted as server-relative paths and fail with "not implemented".
    // Use paths relative to the app root (apps/app-web/) instead.
    resolveAlias: {
      '@react-native-async-storage/async-storage': './src/lib/async-storage-web.ts',
      'react-native': './src/lib/react-native-web-shim.ts',
      'expo/fetch': './src/lib/expo-fetch-shim.ts',
      'expo-file-system/legacy': './src/lib/expo-file-system-shim.ts',
      'expo-file-system': './src/lib/expo-file-system-shim.ts',
      'expo-asset': './src/lib/expo-noop-shim.ts',
    },
  },
  // Tauri's asset protocol does a literal path lookup and falls back to the
  // root index.html for any unresolved request (an SPA history-mode fallback).
  // Without this, a direct/reload request to /settings would silently render
  // the homepage instead of a 404, since the flat `settings.html` export
  // doesn't match a literal `/settings` lookup. Nested `settings/index.html`
  // resolves the same way the root `/` already resolves to `index.html`.
  trailingSlash: true,
  assetPrefix: internalHost ? `http://${internalHost}:3000` : undefined,
  transpilePackages: [
    '@alice-wallet/alice-ai',
    '@alice-wallet/alice-content',
    '@alice-wallet/alice-ui',
  ],
  env: {
    // EXPO_PUBLIC_VENICE_API_KEY is deliberately NOT inlined here. Anything in
    // this block is baked into the client bundle and readable by every visitor.
    // The web app reaches Venice through the blind proxy, which holds the key
    // server-side; without a proxy it refuses to run Private Cloud rather than
    // shipping a key. Only the proxy URL is public.
    EXPO_PUBLIC_VENICE_PROXY_URL: process.env.EXPO_PUBLIC_VENICE_PROXY_URL ?? '',
    EXPO_PUBLIC_VENICE_PCCS_URL: process.env.EXPO_PUBLIC_VENICE_PCCS_URL ?? '',
    // The build's own version, for client-info headers and the update banner
    // (a build that does not know its version can never see a newer one).
    // The monorepo root package.json is the shared release number.
    EXPO_PUBLIC_ALICE_APP_VERSION:
      process.env.EXPO_PUBLIC_ALICE_APP_VERSION
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ?? (require('../../package.json') as { version: string }).version,
    EXPO_PUBLIC_PRIVATE_CLOUD_ENABLED:
      process.env.EXPO_PUBLIC_PRIVATE_CLOUD_ENABLED ?? 'true',
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': path.resolve(
        __dirname,
        'src/lib/async-storage-web.ts'
      ),
      'react-native': path.resolve(
        __dirname,
        'src/lib/react-native-web-shim.ts'
      ),
      'expo/fetch': path.resolve(
        __dirname,
        'src/lib/expo-fetch-shim.ts'
      ),
      'expo-file-system/legacy': path.resolve(
        __dirname,
        'src/lib/expo-file-system-shim.ts'
      ),
      'expo-file-system': path.resolve(
        __dirname,
        'src/lib/expo-file-system-shim.ts'
      ),
      'expo-asset': path.resolve(
        __dirname,
        'src/lib/expo-noop-shim.ts'
      ),
    };
    return config;
  },
};

export default nextConfig;
