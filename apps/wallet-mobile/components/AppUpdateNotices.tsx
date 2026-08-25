import { useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RELEASE_NOTES_URL,
  checkForAppUpdate,
  takeWhatsNew,
  whatsNewFor,
  type WhatsNewEntry,
} from '@alice-wallet/alice-ai';
import { spacing, typography } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1_000;

/**
 * Same contract as the app-web AppUpdateNotices: a quiet strip when a newer
 * Alice is released, and a one-time what's-new dialog after an update. On the
 * web build a reload picks the new deploy up; the installed APK is sent to
 * the release page instead.
 */
export function AppUpdateNotices() {
  const { colors } = useTheme();
  const [latest, setLatest] = useState<string | null>(null);
  const [whatsNew, setWhatsNew] = useState<WhatsNewEntry | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void takeWhatsNew(AsyncStorage).then(version => {
      if (!cancelled && version) setWhatsNew(whatsNewFor(version));
    });
    const check = () => {
      void checkForAppUpdate(AsyncStorage).then(found => {
        if (!cancelled && found) setLatest(found);
      });
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const applyUpdate = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    void Linking.openURL(RELEASE_NOTES_URL);
  };

  return (
    <>
      {/* One voice at a time: the what's-new dialog speaks first, the update
          strip appears once it is closed (same rule as app-web). */}
      {latest && !dismissed && whatsNew === null && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.backgroundSoft,
            borderTopWidth: 2,
            borderTopColor: colors.primary,
          }}
        >
          <Text style={{ fontFamily: typography.pixel, fontSize: 10, color: colors.primaryDark }}>
            ALICE {latest} IS OUT
          </Text>
          <Pressable
            onPress={applyUpdate}
            style={{ backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2 }}
          >
            <Text style={{ fontFamily: typography.pixel, fontSize: 10, color: colors.onPrimary }}>
              {Platform.OS === 'web' ? 'RELOAD TO UPDATE' : 'GET THE UPDATE'}
            </Text>
          </Pressable>
          <Pressable onPress={() => setDismissed(true)} accessibilityLabel="Dismiss update notice">
            <Text style={{ fontFamily: typography.pixel, fontSize: 10, color: colors.muted }}>LATER</Text>
          </Pressable>
        </View>
      )}

      <Modal
        visible={whatsNew !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setWhatsNew(null)}
      >
        <Pressable
          onPress={() => setWhatsNew(null)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.6)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.lg,
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              width: '100%',
              maxWidth: 420,
              backgroundColor: colors.background,
              borderWidth: 2,
              borderColor: colors.border,
              borderRadius: 4,
              padding: spacing.lg,
            }}
          >
            <Text style={{ fontFamily: typography.pixel, fontSize: 10, color: colors.primary }}>
              ALICE {whatsNew?.version}
            </Text>
            <Text style={{ fontFamily: typography.pixel, fontSize: 12, color: colors.primaryDark, marginTop: spacing.sm }}>
              WHAT&apos;S NEW
            </Text>
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {whatsNew?.highlights.map(line => (
                <Text
                  key={line}
                  style={{ fontFamily: typography.numbers, fontSize: 14, lineHeight: 19, color: colors.text }}
                >
                  {'▪'} {line}
                </Text>
              ))}
            </View>
            <Text
              onPress={() => void Linking.openURL(RELEASE_NOTES_URL)}
              style={{ fontFamily: typography.numbers, fontSize: 13, color: colors.primary, textDecorationLine: 'underline', marginTop: spacing.md }}
            >
              Bug fixes and the full detail: release notes
            </Text>
            <View style={{ marginTop: spacing.lg, alignItems: 'flex-end' }}>
              <Pressable
                onPress={() => setWhatsNew(null)}
                style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 2 }}
              >
                <Text style={{ fontFamily: typography.pixel, fontSize: 10, color: colors.onPrimary }}>EXPLORE</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
