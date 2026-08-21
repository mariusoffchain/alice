import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  reserveArkadeReceiveAddress,
  reserveOnchainReceiveAddress,
  restoreWallet,
  updateReceiveAddress,
  type ReceiveAddressLayer,
  type ReceiveAddressRecord,
} from '@alice-wallet/wallet-core';
import {
  AddressDetailModal,
  CompactAddressRow,
  shortAddress,
} from '../lib/address-management';

export default function AddressesScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [addresses, setAddresses] = useState<ReceiveAddressRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAddress, setBusyAddress] = useState<string | null>(null);
  const [detailAddress, setDetailAddress] = useState<ReceiveAddressRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const labelDrafts = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAddresses(await listReceiveAddresses());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load addresses.');
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

  async function archiveAddress(item: ReceiveAddressRecord) {
    setBusyAddress(item.address);
    setError(null);
    setSuccess(null);
    try {
      const next = await updateReceiveAddress(item.address, { archived: true });
      setAddresses(current => current.map(address =>
        address.address === next.address ? next : address
      ));
      setSuccess('ADDRESS ARCHIVED. IT REMAINS WATCHED FOR PAYMENTS.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to archive address.');
    } finally {
      setBusyAddress(null);
    }
  }

  async function reserveAndRotate(item: ReceiveAddressRecord) {
    setBusyAddress(item.address);
    setError(null);
    setSuccess(null);
    try {
      const label = (labelDrafts.current[item.address] ?? item.label).trim();
      if (label !== item.label) {
        await updateReceiveAddress(item.address, { label });
      }
      if (item.layer === 'arkade') await reserveArkadeReceiveAddress();
      else await reserveOnchainReceiveAddress();
      setSuccess(
        `NEW ${item.layer === 'arkade' ? 'ARKADE' : 'BITCOIN'} ADDRESS READY. THE PREVIOUS ADDRESS REMAINS WATCHED.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate address.');
    } finally {
      setBusyAddress(null);
    }
  }

  async function fullRescan() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await restoreWallet();
      setSuccess('FULL HD ADDRESS RESCAN COMPLETE.');
      setAddresses(await listReceiveAddresses());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to rescan receive addresses.');
    } finally {
      setLoading(false);
    }
  }

  const activeAddresses = addresses.filter(item => !item.archived);

  function renderSection(layer: ReceiveAddressLayer) {
    const network = layer === 'arkade' ? 'ARKADE' : 'BITCOIN';
    const current = activeAddresses.find(item => item.layer === layer && item.current);
    const previous = activeAddresses.filter(item => item.layer === layer && !item.current);

    return (
      <View style={s.section}>
        {current ? (
          <View style={s.currentCard}>
            <View style={s.currentTop}>
              <Text style={s.network}>{network}</Text>
              <Text style={[s.currentStatus, { color: colors.success }]}>CURRENT</Text>
            </View>
            <Text style={s.currentAddress} selectable>{shortAddress(current.address)}</Text>
            <TextInput
              style={[s.labelInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
              value={current.label}
              onChangeText={label => {
                labelDrafts.current[current.address] = label;
                setAddresses(items => items.map(item =>
                  item.address === current.address ? { ...item, label } : item
                ));
              }}
              onBlur={() => void saveLabel(
                current,
                (labelDrafts.current[current.address] ?? current.label).trim(),
              )}
              placeholder="Label this address"
              placeholderTextColor={colors.muted}
              maxLength={80}
            />
            <TouchableOpacity
              style={s.generateButton}
              onPress={() => void reserveAndRotate(current)}
              disabled={busyAddress === current.address}
            >
              {busyAddress === current.address
                ? <ActivityIndicator size="small" color={colors.onPrimary} />
                : <Ionicons name="add-circle-outline" size={17} color={colors.onPrimary} />}
              <Text style={s.generateText}>GENERATE NEW {network} ADDRESS</Text>
            </TouchableOpacity>
          </View>
        ) : loading ? (
          <ActivityIndicator color={colors.primary} style={s.sectionLoading} />
        ) : (
          <Text style={s.emptyText}>NO CURRENT {network} ADDRESS</Text>
        )}

        {previous.length > 0 && (
          <View style={s.previousList}>
            {previous.map(item => (
              <CompactAddressRow
                key={item.address}
                item={item}
                busy={busyAddress === item.address}
                archiveAction="archive"
                onSaveLabel={saveLabel}
                onArchiveAction={archiveAddress}
                onShowQr={setDetailAddress}
              />
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="arrow-back" size={19} color={colors.primary} />
        </TouchableOpacity>
        <Text style={s.title}>ADDRESSES</Text>
        <TouchableOpacity
          onPress={() => void fullRescan()}
          style={s.iconBtn}
          disabled={loading}
          accessibilityLabel="Run full HD address rescan"
        >
          {loading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="sync" size={19} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <View style={s.notice}>
          <Ionicons name="repeat-outline" size={18} color={colors.primary} />
          <Text style={s.noticeText}>
            YOUR CURRENT ADDRESSES STAY THE SAME UNTIL YOU GENERATE NEW ONES. PREVIOUS AND ARCHIVED ADDRESSES REMAIN WATCHED.
          </Text>
        </View>

        {success && <Text style={[s.success, { color: colors.success }]}>{success}</Text>}
        {error && <Text style={[s.error, { color: colors.danger }]}>{error}</Text>}

        {renderSection('arkade')}
        {renderSection('onchain')}

        <View style={s.recoveryFooter}>
          <View style={s.recoveryHeadingRow}>
            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={s.recoveryHeading}>RECOVERY INFORMATION</Text>
          </View>
          <Text style={s.recoveryText}>
            Generating more than 15 consecutive addresses without receiving funds may make automatic recovery slower or less reliable. A full Alice recovery scans 100 shared HD indexes across Arkade and Bitcoin. Activity beyond that range may require an extended recovery.
          </Text>
        </View>

        <TouchableOpacity
          style={s.archiveButton}
          onPress={() => router.push('/address-archives' as never)}
        >
          <Ionicons name="archive-outline" size={18} color={colors.primaryDark} />
          <Text style={s.archiveButtonText}>ARCHIVED ADDRESSES</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.primaryDark} />
        </TouchableOpacity>
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
    title: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.primaryDark,
      letterSpacing: 2,
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
    success: {
      marginTop: spacing.md,
      fontFamily: typography.numbers,
      fontSize: 14,
      lineHeight: 20,
      color: '#2ea043',
      textAlign: 'center',
    },
    error: {
      marginTop: spacing.md,
      fontFamily: typography.numbers,
      fontSize: 14,
      lineHeight: 20,
      color: '#c84f4f',
      textAlign: 'center',
    },
    section: {
      marginTop: spacing.xl,
      borderTopWidth: 2,
      borderTopColor: colors.border,
    },
    currentCard: { paddingVertical: spacing.lg },
    currentTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    network: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.primaryDark,
    },
    currentStatus: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: '#2ea043',
    },
    currentAddress: {
      marginTop: spacing.sm,
      fontFamily: typography.numbers,
      fontSize: 14,
      color: colors.primaryDark,
    },
    labelInput: {
      ...pixel,
      minHeight: 44,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.cardBg,
      fontFamily: typography.numbers,
      fontSize: 14,
      color: colors.primaryDark,
    },
    generateButton: {
      ...pixel,
      minHeight: 44,
      marginTop: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.primary,
      borderColor: colors.primaryDark,
    },
    generateText: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.onPrimary,
      textAlign: 'center',
    },
    previousList: {
      borderTopWidth: 1,
      borderTopColor: colors.dotted,
    },
    sectionLoading: { marginVertical: spacing.xl },
    emptyText: {
      marginVertical: spacing.xl,
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.muted,
      textAlign: 'center',
    },
    recoveryFooter: {
      marginTop: spacing.xxl,
      paddingVertical: spacing.lg,
      borderTopWidth: 2,
      borderTopColor: colors.border,
    },
    recoveryHeadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    recoveryHeading: {
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.primaryDark,
      letterSpacing: 1,
    },
    recoveryText: {
      marginTop: spacing.md,
      fontFamily: typography.numbers,
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
    },
    archiveButton: {
      ...pixel,
      minHeight: 48,
      marginTop: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.cardBg,
    },
    archiveButtonText: {
      flex: 1,
      fontFamily: typography.pixel,
      fontSize: 12,
      color: colors.primaryDark,
      textAlign: 'center',
    },
  });
}
