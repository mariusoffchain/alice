import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import {
  listReceiveAddresses,
  updateReceiveAddress,
  type ReceiveAddressLayer,
  type ReceiveAddressRecord,
} from '@alice-wallet/wallet-core';
import {
  AddressDetailModal,
  CompactAddressRow,
} from '../lib/address-management';

export default function AddressArchivesScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [addresses, setAddresses] = useState<ReceiveAddressRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAddress, setBusyAddress] = useState<string | null>(null);
  const [detailAddress, setDetailAddress] = useState<ReceiveAddressRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAddresses((await listReceiveAddresses()).filter(item => item.archived));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load archived addresses.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function saveLabel(item: ReceiveAddressRecord, label: string) {
    setBusyAddress(item.address);
    setError(null);
    try {
      const next = await updateReceiveAddress(item.address, { label });
      setAddresses(current => current.map(address =>
        address.address === next.address ? next : address
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update address.');
      throw cause;
    } finally {
      setBusyAddress(null);
    }
  }

  async function restoreAddress(item: ReceiveAddressRecord) {
    setBusyAddress(item.address);
    setError(null);
    try {
      await updateReceiveAddress(item.address, { archived: false });
      setAddresses(current => current.filter(address => address.address !== item.address));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to restore address.');
    } finally {
      setBusyAddress(null);
    }
  }

  function renderSection(layer: ReceiveAddressLayer) {
    const items = addresses.filter(item => item.layer === layer);
    if (items.length === 0) return null;
    return (
      <View style={s.section}>
        <Text style={s.network}>{layer === 'arkade' ? 'ARKADE' : 'BITCOIN'}</Text>
        <View style={s.list}>
          {items.map(item => (
            <CompactAddressRow
              key={item.address}
              item={item}
              busy={busyAddress === item.address}
              archiveAction="restore"
              onSaveLabel={saveLabel}
              onArchiveAction={restoreAddress}
              onShowQr={setDetailAddress}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="arrow-back" size={19} color={colors.primary} />
        </TouchableOpacity>
        <Text style={s.title}>ARCHIVED ADDRESSES</Text>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <View style={s.notice}>
          <Ionicons name="eye-outline" size={18} color={colors.primary} />
          <Text style={s.noticeText}>
            ARCHIVING ONLY HIDES AN ADDRESS FROM THE MAIN LIST. IT REMAINS VALID AND WATCHED FOR PAYMENTS.
          </Text>
        </View>

        {error && <Text style={s.error}>{error}</Text>}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={s.loading} />
        ) : addresses.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="archive-outline" size={30} color={colors.muted} />
            <Text style={s.emptyTitle}>NO ARCHIVED ADDRESSES</Text>
          </View>
        ) : (
          <>
            {renderSection('arkade')}
            {renderSection('onchain')}
          </>
        )}
      </ScrollView>

      <AddressDetailModal item={detailAddress} onClose={() => setDetailAddress(null)} />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    iconBtn: {
      ...pixel,
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardBg,
    },
    headerSpacer: { width: 38, height: 38 },
    title: {
      fontFamily: typography.pixel,
      fontSize: 10,
      color: colors.primaryDark,
      letterSpacing: 1,
      textAlign: 'center',
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxxl,
    },
    notice: {
      paddingVertical: spacing.md,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.dotted,
    },
    noticeText: {
      flex: 1,
      fontFamily: typography.numbers,
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
    },
    error: {
      marginTop: spacing.md,
      fontFamily: typography.numbers,
      fontSize: 14,
      lineHeight: 20,
      color: '#c84f4f',
      textAlign: 'center',
    },
    loading: { marginTop: spacing.xxxl },
    empty: {
      minHeight: 260,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
    },
    emptyTitle: {
      fontFamily: typography.pixel,
      fontSize: 7,
      color: colors.muted,
    },
    section: {
      marginTop: spacing.xl,
      borderTopWidth: 2,
      borderTopColor: colors.border,
    },
    network: {
      paddingVertical: spacing.md,
      fontFamily: typography.pixel,
      fontSize: 8,
      color: colors.primaryDark,
    },
    list: { borderTopWidth: 1, borderTopColor: colors.dotted },
  });
}
