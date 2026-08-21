import { router, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { isOnboarded } from '../lib/onboarding';
import { AppUpdateNotices } from '../components/AppUpdateNotices';
import { ThemeProvider, useTheme } from '@alice-wallet/alice-ui';
import {
  AccountProvider,
  ChatProvider,
  flushProductEvents,
  preloadSemanticSearch,
  restoreDownloadedPacks,
  trackProductEvent,
  type AliceProductEvent,
} from '@alice-wallet/alice-ai';
import {
  isLockEnabled,
  lockWebVault,
  maintainVtxosIfReady,
  syncVtxosIfReady,
} from '@alice-wallet/wallet-core';
import { isSessionUnlocked, lockSession } from '@alice-wallet/shared-types';
import { AccountPasswordModal } from '../components/AccountPasswordModal';

const AUTO_LOCK_MS = 2 * 60 * 1_000;

/**
 * Routes worth counting, and only those. This is a fixed map rather than
 * "track whatever route we are on" on purpose: a route name is a string
 * that could carry an address, an id or a query, and the aggregate counters
 * must never receive one. Anything absent here is simply not counted.
 */
const ROUTE_EVENTS: Record<string, AliceProductEvent> = {
  settings: 'settings_opened',
  'what-alice-knows': 'learning_profile_opened',
  onboarding: 'onboarding_started',
};
const originalConsoleLog = console.log.bind(console);
const originalConsoleDebug = console.debug.bind(console);

console.log = (...args: unknown[]) => {
  if (args.some(arg => String(arg).includes('[web] Logs will appear in the browser console'))) return;
  originalConsoleLog(...args);
};

console.debug = (...args: unknown[]) => {
  if (args.some(arg => String(arg).includes('Using expo/fetch for streaming'))) return;
  originalConsoleDebug(...args);
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const segments = useSegments();
  const currentRoute = segments[0];
  const [checked, setChecked] = useState(Platform.OS === 'web');
  const backgroundAt = useRef<number | null>(null);
  const segmentsRef = useRef(segments);
  const [fontsLoaded, fontError] = useFonts({
    PressStart2P: require('../assets/fonts/PressStart2P-Regular.ttf'),
    TerminalGrotesque: require('../assets/fonts/terminal-grotesque.ttf'),
  });

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    let cancelled = false;
    async function checkStartup() {
      try {
        const done = await isOnboarded();
        if (cancelled) return;
        if (!done) {
          router.replace('/onboarding');
        } else if ((await isLockEnabled()) && !isSessionUnlocked()) {
          router.replace('/lock');
        }
        setChecked(true);
      } catch (cause) {
        if (cancelled) return;
        if (Platform.OS === 'web') {
          console.error('Unable to read the saved web wallet during startup.', cause);
          setChecked(true);
          router.replace('/onboarding');
          return;
        }
        throw cause;
      }
    }
    void checkStartup();
    return () => { cancelled = true; };
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    // Mobile semantic RAG downloads its model only on Wi-Fi and otherwise
    // leaves chat on the immediate lexical fallback.
    if (!checked || Platform.OS === 'web') return;
    void restoreDownloadedPacks().finally(() => preloadSemanticSearch());
  }, [checked]);

  useEffect(() => {
    if (!checked) return;
    trackProductEvent('app_opened');
  }, [checked]);

  useEffect(() => {
    if (!checked) return;
    const event = currentRoute ? ROUTE_EVENTS[currentRoute] : undefined;
    if (event) trackProductEvent(event);
  }, [checked, currentRoute]);

  useEffect(() => {
    if (!checked) return;
    if (currentRoute === 'lock' || currentRoute === 'onboarding') return;
    isLockEnabled().then(enabled => {
      if (enabled && !isSessionUnlocked()) router.replace('/lock');
    });
  }, [checked, currentRoute]);

  useEffect(() => {
    if (!checked) return;
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'inactive' || nextState === 'background') {
        if (backgroundAt.current === null) backgroundAt.current = Date.now();
        // Send whatever is queued before the OS suspends us, rather than
        // losing it. Fire-and-forget: this must never delay backgrounding.
        void flushProductEvents();
        return;
      }
      if (nextState === 'active') {
        const elapsed = backgroundAt.current === null ? 0 : Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        void (async () => {
          if (elapsed >= AUTO_LOCK_MS && await isLockEnabled()) {
            if (Platform.OS === 'web') lockWebVault();
            lockSession();
            router.replace('/lock');
            return;
          }
          const route = segmentsRef.current[0];
          if (!route) {
            await maintainVtxosIfReady();
          } else {
            await syncVtxosIfReady();
          }
        })().catch(cause => {
          console.warn('Unable to secure or synchronize the wallet after app resume.', cause);
        });
      }
    });
    return () => subscription.remove();
  }, [checked]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ThemeProvider>
      <AccountProvider>
        <ChatProvider>
          <SafeAreaProvider>
            <ThemedStack checked={checked} />
            <AccountPasswordModal />
          </SafeAreaProvider>
        </ChatProvider>
      </AccountProvider>
    </ThemeProvider>
  );
}

function ThemedStack({ checked }: { checked: boolean }) {
  const { mode, colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} backgroundColor={colors.background} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      />
      {checked && <AppUpdateNotices />}
      {!checked && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.background }]}
        />
      )}
    </View>
  );
}
