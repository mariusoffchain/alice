import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';
import type { ReceiveAddressRecord } from '@alice-wallet/wallet-core';

export function shortAddress(address: string) {
  return address.length > 34
    ? `${address.slice(0, 18)}...${address.slice(-12)}`
    : address;
}

interface CompactAddressRowProps {
  item: ReceiveAddressRecord;
  busy?: boolean;
  archiveAction: 'archive' | 'restore';
  onSaveLabel(item: ReceiveAddressRecord, label: string): Promise<void>;
  onArchiveAction(item: ReceiveAddressRecord): Promise<void>;
  onShowQr(item: ReceiveAddressRecord): void;
}

export function CompactAddressRow({
  item,
  busy = false,
  archiveAction,
  onSaveLabel,
  onArchiveAction,
  onShowQr,
}: CompactAddressRowProps) {
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.label);

  useEffect(() => {
    if (!editing) setLabel(item.label);
  }, [editing, item.label]);

  async function save() {
    await onSaveLabel(item, label.trim());
    setEditing(false);
  }

  return (
    <View style={s.compactRow}>
      {editing ? (
        <View style={s.editRow}>
          <TextInput
            style={[s.editInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
            value={label}
            onChangeText={setLabel}
            placeholder="Label this address"
            placeholderTextColor={colors.muted}
            maxLength={80}
            autoFocus
            onSubmitEditing={() => void save()}
          />
          <TouchableOpacity
            style={s.iconAction}
            onPress={() => void save()}
            disabled={busy}
            accessibilityLabel="Save address label"
          >
            {busy
              ? <ActivityIndicator size="small" color={colors.primaryDark} />
              : <Ionicons name="checkmark" size={18} color={colors.primaryDark} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.iconAction}
            onPress={() => {
              setLabel(item.label);
              setEditing(false);
            }}
            disabled={busy}
            accessibilityLabel="Cancel label editing"
          >
            <Ionicons name="close" size={18} color={colors.primaryDark} />
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={s.savedLabel} numberOfLines={1}>
          {item.label || 'UNLABELED ADDRESS'}
        </Text>
      )}

      <View style={s.addressLine}>
        <Text style={s.compactAddress} selectable numberOfLines={1}>
          {shortAddress(item.address)}
        </Text>
        {!editing && (
          <View style={s.rowActions}>
            <TouchableOpacity
              style={s.iconAction}
              onPress={() => setEditing(true)}
              disabled={busy}
              accessibilityLabel="Edit address label"
            >
              <Ionicons name="pencil" size={17} color={colors.primaryDark} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.iconAction}
              onPress={() => onShowQr(item)}
              disabled={busy}
              accessibilityLabel="Show address QR code"
            >
              <Ionicons name="qr-code-outline" size={18} color={colors.primaryDark} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.iconAction}
              onPress={() => void onArchiveAction(item)}
              disabled={busy}
              accessibilityLabel={archiveAction === 'archive' ? 'Archive address' : 'Restore address'}
            >
              {busy
                ? <ActivityIndicator size="small" color={colors.primaryDark} />
                : <Ionicons
                    name={archiveAction === 'archive' ? 'archive-outline' : 'arrow-undo-outline'}
                    size={18}
                    color={colors.primaryDark}
                  />}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

interface AddressDetailModalProps {
  item: ReceiveAddressRecord | null;
  onClose(): void;
}

export function AddressDetailModal({ item, onClose }: AddressDetailModalProps) {
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [QRCode, setQRCode] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    import('react-native-qrcode-svg')
      .then(module => setQRCode(() => module.default))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (item) setCopied(false);
  }, [item?.address]);

  async function copyAddress() {
    if (!item) return;
    if (Platform.OS === 'web') {
      await navigator.clipboard.writeText(item.address);
    } else {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(item.address);
    }
    setCopied(true);
  }

  return (
    <Modal
      visible={item !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <View style={s.modalHeader}>
            <View style={s.modalHeading}>
              <Text style={s.modalTitle}>{item?.label || 'ADDRESS DETAILS'}</Text>
              <Text style={s.modalNetwork}>
                {item?.layer === 'arkade' ? 'ARKADE' : 'BITCOIN'}
              </Text>
            </View>
            <TouchableOpacity
              style={s.iconAction}
              onPress={onClose}
              accessibilityLabel="Close address details"
            >
              <Ionicons name="close" size={20} color={colors.primaryDark} />
            </TouchableOpacity>
          </View>

          <View style={s.qrFrame}>
            {item && QRCode
              ? <QRCode value={item.address} size={220} backgroundColor="#ffffff" color="#0c121a" />
              : <ActivityIndicator color={colors.primary} />}
          </View>

          <Text style={s.fullAddress} selectable>{item?.address}</Text>

          <TouchableOpacity style={s.copyButton} onPress={() => void copyAddress()}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.onPrimary} />
            <Text style={s.copyButtonText}>{copied ? 'COPIED' : 'COPY ADDRESS'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    compactRow: {
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.dotted,
    },
    savedLabel: {
      fontFamily: typography.numbers,
      fontSize: 15,
      color: colors.primaryDark,
    },
    addressLine: {
      minHeight: 42,
      marginTop: spacing.xs,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    compactAddress: {
      flex: 1,
      minWidth: 0,
      fontFamily: typography.numbers,
      fontSize: 14,
      color: colors.muted,
    },
    rowActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    iconAction: {
      ...pixel,
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardBg,
    },
    editRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    editInput: {
      ...pixel,
      flex: 1,
      minHeight: 40,
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.cardBg,
      fontFamily: typography.numbers,
      fontSize: 14,
      color: colors.primaryDark,
    },
    modalBackdrop: {
      flex: 1,
      padding: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.78)',
    },
    modalCard: {
      ...pixel,
      width: '100%',
      maxWidth: 440,
      padding: spacing.lg,
      backgroundColor: colors.background,
      borderColor: colors.primary,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    modalHeading: { flex: 1 },
    modalTitle: {
      fontFamily: typography.numbers,
      fontSize: 19,
      color: colors.primaryDark,
    },
    modalNetwork: {
      marginTop: spacing.xs,
      fontFamily: typography.pixel,
      fontSize: 7,
      color: colors.muted,
    },
    qrFrame: {
      width: 252,
      height: 252,
      marginTop: spacing.lg,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      backgroundColor: '#ffffff',
      borderWidth: 2,
      borderColor: colors.border,
    },
    fullAddress: {
      marginTop: spacing.lg,
      fontFamily: typography.numbers,
      fontSize: 14,
      lineHeight: 20,
      color: colors.primaryDark,
      textAlign: 'center',
    },
    copyButton: {
      ...pixel,
      minHeight: 44,
      marginTop: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.primary,
      borderColor: colors.primaryDark,
    },
    copyButtonText: {
      fontFamily: typography.pixel,
      fontSize: 7,
      color: colors.onPrimary,
    },
  });
}
