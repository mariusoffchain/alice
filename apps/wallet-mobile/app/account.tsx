import { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, typography } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import { useAccount } from '@alice-wallet/alice-ai';

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Where a plan is bought. Never here.
 *
 * A phone build carries no purchase flow at all, and this is not a limitation
 * being worked around: a store takes its cut of anything sold inside an app it
 * distributes, and Alice sells a five euro plan paid in bitcoin. So the phone
 * shows what the account holds and hands the buying over to the web app, which
 * is also where the payment page and the waiting screen already live.
 */
const WEB_APP_ACCOUNT_URL =
  (process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://app.alicebtc.com').replace(/\/+$/, '')
  + '/?settings=account';

/** The same three days the server waits before mailing the first reminder. */
const EXPIRY_WARNING_MS = 3 * DAY_MS;

const PLAN_LABELS: Record<string, string> = {
  free: 'FREE',
  cloud: 'CLOUD',
};

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  cloud: 'Cloud',
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The account on a phone.
 *
 * It shows the same state as the web account tab and stops short of selling
 * anything. That is not an omission: a purchase flow inside a store-distributed
 * app is the store's business, and Alice takes bitcoin. Buying happens on the
 * web, where nobody takes a cut of a plan meant to cost five euros.
 *
 * What matters here is that a paying user who lives on their phone can still
 * see what they have, how much of it is left, and when it runs out. Before
 * this screen the phone showed a single percentage in a settings row, which is
 * the least a paid plan could say for itself.
 */
export default function AccountScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const account = useAccount();

  // The snapshot is often minutes old when this screen opens, and this is
  // exactly the place where a stale figure misleads.
  useEffect(() => {
    void account.refreshAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFocusEffect(useCallback(() => {
    void account.refreshBilling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const now = Date.now();
  const usage = account.cloudUsage;
  const billing = account.billing;
  const paid = usage?.kind === 'paid' ? usage : null;
  const free = usage?.kind === 'free' ? usage : null;
  const expiresSoon = paid !== null && paid.expiresAt - now <= EXPIRY_WARNING_MS;
  const lapsed = billing !== null && billing.expired;
  const reachable = account.account?.email_reachable ?? false;

  const percent = Math.max(0, Math.min(100, paid?.percentUsed ?? 0));

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')}
          style={[s.backBtn, pixel, { backgroundColor: colors.cardBg }]}
        >
          <Text style={[s.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.primaryDark }]}>ACCOUNT</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {/* What plan this account holds, and until when. */}
        <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
          <Text style={[s.sectionTitle, { color: colors.primaryDark }]}>PLAN</Text>
          <View style={[s.row, s.rowLast, { borderBottomColor: colors.dotted }]}>
            <Text style={[s.planName, { color: colors.primaryDark }]}>
              {PLAN_LABELS[paid ? paid.plan : 'free']}
            </Text>
            {paid && (
              <Text style={[s.rowValue, { color: colors.muted }]}>
                until {formatDate(paid.expiresAt)}
              </Text>
            )}
          </View>

          {paid && expiresSoon && (
            <Text style={[s.note, { color: colors.warning }]}>
              {paid.expiresAt - now <= DAY_MS
                ? 'Your plan ends today.'
                : `Your plan ends on ${formatDate(paid.expiresAt)}.`}
              {' '}Bitcoin payments cannot renew on their own, so nothing happens
              unless you choose to renew.
            </Text>
          )}

          {lapsed && (
            <Text style={[s.note, { color: colors.muted }]}>
              Your {PLAN_NAMES[billing.purchased_plan] ?? ''} plan ended
              {billing.plan_expires_at ? ` on ${formatDate(billing.plan_expires_at)}` : ''}.
              Your wallet, your local AI and your data are not affected.
            </Text>
          )}

          {!paid && !lapsed && (
            <Text style={[s.note, { color: colors.muted }]}>
              The wallet, the local AI and your data stay free. Paid plans only
              add Private Cloud capacity.
            </Text>
          )}
        </View>

        {/* How much of it has been used. */}
        <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
          <Text style={[s.sectionTitle, { color: colors.primaryDark }]}>USAGE</Text>
          {paid ? (
            <>
              <View style={[s.row, { borderBottomColor: colors.dotted }]}>
                <Text style={[s.rowLabel, { color: colors.primaryDark }]}>THIS MONTH</Text>
                <Text style={[s.rowValue, { color: colors.muted }]}>{percent}%</Text>
              </View>
              <View style={s.gaugeWrap}>
                <View style={[s.gauge, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <View
                    style={{
                      width: `${percent}%`,
                      height: '100%',
                      backgroundColor: percent >= 90 ? colors.warning : colors.primary,
                    }}
                  />
                </View>
              </View>
              {paid.periodEndsAt !== null && (
                <Text style={[s.note, { color: colors.muted }]}>
                  Allowance resets on {formatDate(paid.periodEndsAt)}.
                </Text>
              )}
              {/* The same disclosure the web screen carries, for the same
                  reason: the figure above is an estimate, and saying so is the
                  only honest way to show it. */}
              <Text style={[s.note, { color: colors.muted }]}>
                Usage is estimated from the volume of data exchanged. Your
                messages are end-to-end encrypted, Alice cannot read them, so
                the exact token count is not accessible to her.
              </Text>
            </>
          ) : free ? (
            <>
              <View style={[s.row, s.rowLast, { borderBottomColor: colors.dotted }]}>
                <Text style={[s.rowLabel, { color: colors.primaryDark }]}>CLOUD REQUESTS</Text>
                <Text style={[s.rowValue, { color: colors.muted }]}>
                  {free.remaining} / {free.limit} left
                </Text>
              </View>
              <Text style={[s.note, { color: colors.muted }]}>
                Free requests are counted exactly, and they work without an
                account. Local AI is unlimited and never counted.
              </Text>
            </>
          ) : (
            <Text style={[s.note, { color: colors.muted }]}>
              Sign in to see your Private Cloud usage.
            </Text>
          )}
        </View>

        {/* Not a plan picker, and not a paywall. One line saying where the
            buying happens, and a way to get there. */}
        <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
          <TouchableOpacity
            style={[s.row, s.rowLast, { borderBottomColor: colors.dotted }]}
            onPress={() => void Linking.openURL(WEB_APP_ACCOUNT_URL)}
          >
            <Text style={[s.rowLabel, { color: colors.primaryDark }]}>
              {paid ? 'RENEW ON THE WEB' : 'PLANS ON THE WEB'}
            </Text>
            <Text
              numberOfLines={1}
              style={[s.pill, pixel, { backgroundColor: colors.primary, color: colors.onPrimary }]}
            >
              OPEN ›
            </Text>
          </TouchableOpacity>
          <Text style={[s.note, { color: colors.muted }]}>
            Plans are paid in bitcoin from the Alice web app. Your account is
            the same one, so anything bought there appears here.
          </Text>
        </View>

        {/* What Alice may send, and where. */}
        {(paid || lapsed) && (
          <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
            <Text style={[s.sectionTitle, { color: colors.primaryDark }]}>MAIL</Text>
            {reachable ? (
              <>
                <View style={[s.row, { borderBottomColor: colors.dotted }]}>
                  <Text style={[s.rowLabel, { color: colors.primaryDark }]}>ADDRESS</Text>
                  <Text style={[s.rowValue, { color: colors.muted }]} numberOfLines={1}>
                    {account.account?.email_masked ?? ''}
                  </Text>
                </View>
                <Text style={[s.note, { color: colors.muted }]}>
                  Bitcoin cannot renew a plan on its own, so Alice writes three
                  days before yours runs out and again on the day.
                </Text>
                <Text style={[s.note, { color: colors.muted }]}>
                  A few times a year she also writes about what Alice can now
                  do. Nothing else: no marketing, no partners, and your address
                  goes nowhere.
                </Text>
                <Text style={[s.note, { color: colors.muted }]}>
                  Your address is stored encrypted, which protects it if the
                  database leaks. It does not hide it from Alice: the server
                  decrypts it to send. An alias works perfectly well here.
                </Text>
              </>
            ) : (
              <Text style={[s.note, { color: colors.muted }]}>
                Alice has no address for this account, so she cannot warn you
                before a plan runs out. Add an email from the account below.
              </Text>
            )}
          </View>
        )}

        {/* Who is signed in, or the invitation to be. */}
        <View style={[s.section, pixel, { backgroundColor: colors.cardBg }]}>
          <TouchableOpacity
            style={[s.row, s.rowLast, { borderBottomColor: colors.dotted }]}
            onPress={() => account.requestSignIn()}
          >
            <Text style={[s.rowLabel, { color: colors.primaryDark }]}>ALICE ACCOUNT</Text>
            <Text
              numberOfLines={1}
              style={[s.pill, pixel, { backgroundColor: colors.primary, color: colors.onPrimary }]}
            >
              {account.account
                ? `${account.account.username ?? account.account.display_name ?? 'Signed in'} ›`
                : 'SIGN IN ›'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontFamily: typography.pixel, fontSize: 18 },
  title: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 3 },
  section: { marginHorizontal: spacing.lg, marginTop: spacing.md, paddingBottom: spacing.md },
  sectionTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, borderBottomWidth: 1 },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { flexShrink: 1, fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1 },
  rowValue: { flexShrink: 1, fontFamily: typography.pixel, fontSize: 12, textAlign: 'right' },
  planName: { fontFamily: typography.pixel, fontSize: 16, letterSpacing: 2 },
  /* The two rows that do something, told apart from the ones that only
     report. Filled rather than outlined: on a phone these are the only two
     places to tap on this screen, and they were reading as labels. */
  pill: { flexShrink: 0, fontFamily: typography.pixel, fontSize: 11, letterSpacing: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginLeft: spacing.md, overflow: 'hidden' },
  gaugeWrap: { paddingHorizontal: spacing.lg },
  gauge: { height: 12, borderWidth: 2, borderRadius: 2, overflow: 'hidden' },
  note: { fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
});
