import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useMemo, useState } from 'react';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import {
  ALICE_MEMORY_CATEGORIES,
  ALICE_MEMORY_CATEGORY_LABELS,
  ALICE_MEMORY_RECENT_LIMIT,
  ALICE_MEMORY_WARNING,
  KNOWLEDGE_CONCEPT_LABELS,
  MAX_TEXT_LENGTH,
  aliceMemoryRefusalMessage,
  clearAliceMemory,
  clearAliceMemoryCategory,
  clearPedagogicalProfile,
  editAliceMemoryItem,
  familiarityFor,
  forgetAliceMemoryItem,
  forgetPedagogicalConcept,
  getAliceMemory,
  getPedagogicalProfile,
  isAliceMemoryCategoryPaused,
  setAliceMemoryCategoryPaused,
  setAliceMemoryEnabled,
  type AliceMemory,
  type AliceMemoryCategory,
  type AliceMemoryItem,
  type FamiliarityState,
  type KnowledgeConcept,
  type PedagogicalProfile,
} from '@alice-wallet/alice-ai';
import { PixelToggle, useTheme } from '@alice-wallet/alice-ui';

// Since 2026-10-06 the facts are laid out as one field per category, every
// field shown even when empty. Each fact can be edited in place (the new text
// goes through the capture filters, and a refusal says why) or deleted; each
// field can be cleared or paused. Past the fifty most recent facts, the older
// ones fold into a section of their own, still editable and deletable.

const CATEGORY_LABELS = ALICE_MEMORY_CATEGORY_LABELS.en;

type Styles = ReturnType<typeof makeStyles>;

function familiarityLabel(state: FamiliarityState, declared: boolean): string {
  if (declared) return `DECLARED ${state.toUpperCase()}`;
  if (state === 'introduced') return 'DISCUSSED';
  return state.toUpperCase();
}

function MemoryFactRow({
  item,
  showCategory,
  divided,
  s,
  colors,
  onChange,
}: {
  item: AliceMemoryItem;
  showCategory?: boolean;
  divided: boolean;
  s: Styles;
  colors: Colors;
  onChange: (memory: AliceMemory) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [refusal, setRefusal] = useState<string | null>(null);

  const startEditing = () => {
    setDraft(item.text);
    setRefusal(null);
    setEditing(true);
  };

  const save = () => {
    void editAliceMemoryItem(item.id, draft).then(result => {
      if (result.refusal) {
        setRefusal(aliceMemoryRefusalMessage(result.refusal, 'en'));
        return;
      }
      setRefusal(null);
      setEditing(false);
      onChange(result.memory);
    });
  };

  return (
    <View style={[s.itemRow, divided && s.itemBorder, editing && s.itemRowEditing]}>
      <View style={s.itemCopy}>
        {showCategory && <Text style={s.itemMeta}>{CATEGORY_LABELS[item.category].toUpperCase()}</Text>}
        {editing ? (
          <View>
            <TextInput
              style={[s.editInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={save}
              maxLength={MAX_TEXT_LENGTH}
              autoFocus
              accessibilityLabel="Edit this fact"
              placeholder="Edit this fact"
              placeholderTextColor={colors.muted}
            />
            {refusal && <Text style={[s.refusal, { color: colors.danger }]} accessibilityRole="alert">{refusal}</Text>}
            <View style={s.editActions}>
              <TouchableOpacity onPress={save} style={s.inlineButton} accessibilityRole="button" accessibilityLabel="Save this fact">
                <Text style={[s.inlineButtonText, { color: colors.primary }]}>SAVE</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditing(false)} style={s.inlineButton} accessibilityRole="button" accessibilityLabel="Cancel editing">
                <Text style={s.inlineButtonText}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <Text style={s.itemText}>{item.text}</Text>
        )}
      </View>
      {!editing && (
        <View style={s.itemActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit: ${item.text}`} onPress={startEditing} style={s.inlineButton}>
            <Text style={s.inlineButtonText}>EDIT</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Delete: ${item.text}`}
            onPress={() => { void forgetAliceMemoryItem(item.id).then(onChange); }}
            style={s.inlineButton}
          >
            <Text style={[s.inlineButtonText, { color: colors.danger }]}>DELETE</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function MemoryCategoryField({
  category,
  items,
  totalCount,
  paused,
  s,
  colors,
  onChange,
}: {
  category: AliceMemoryCategory;
  items: AliceMemoryItem[];
  /** Every fact in the category, the older ones folded below included. */
  totalCount: number;
  paused: boolean;
  s: Styles;
  colors: Colors;
  onChange: (memory: AliceMemory) => void;
}) {
  const label = CATEGORY_LABELS[category];
  const clearHere = () => {
    Alert.alert(
      `Delete everything under ${label}?`,
      `This removes all ${totalCount} ${totalCount === 1 ? 'fact' : 'facts'} in this field, including older ones not shown here. The other fields stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void clearAliceMemoryCategory(category).then(onChange); } },
      ],
    );
  };

  return (
    <View>
      <View style={s.fieldHeader}>
        <Text style={s.sectionTitle} accessibilityRole="header">{label.toUpperCase()}{items.length > 0 ? ` (${items.length})` : ''}</Text>
        <View style={s.fieldActions}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ checked: paused }}
            accessibilityLabel={paused ? `Resume capture for ${label}` : `Pause capture for ${label}`}
            onPress={() => { void setAliceMemoryCategoryPaused(category, !paused).then(onChange); }}
            style={s.inlineButton}
          >
            <Text style={[s.inlineButtonText, paused && { color: colors.primary }]}>{paused ? 'RESUME' : 'PAUSE'}</Text>
          </TouchableOpacity>
          {totalCount > 0 && (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Delete everything under ${label}`} onPress={clearHere} style={s.inlineButton}>
              <Text style={[s.inlineButtonText, { color: colors.danger }]}>DELETE ALL HERE</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <View style={s.section}>
        {paused && <Text style={s.pausedNote}>Paused: Alice no longer adds facts here. What is already here stays until you delete it.</Text>}
        {items.length === 0 ? (
          <Text style={s.empty}>Nothing here yet.</Text>
        ) : items.map((item, index) => (
          <MemoryFactRow key={item.id} item={item} divided={index > 0} s={s} colors={colors} onChange={onChange} />
        ))}
      </View>
    </View>
  );
}

export default function WhatAliceKnowsScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [memory, setMemory] = useState<AliceMemory | null>(null);
  const [learning, setLearning] = useState<PedagogicalProfile | null>(null);
  const [olderOpen, setOlderOpen] = useState(false);

  const refresh = useCallback(() => {
    void Promise.all([getAliceMemory(), getPedagogicalProfile()])
      .then(([nextMemory, nextLearning]) => {
        setMemory(nextMemory);
        setLearning(nextLearning);
      })
      .catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
  }, [refresh]));

  const activeConcepts = learning
    ? (Object.keys(learning.concepts) as KnowledgeConcept[])
        .filter(concept => familiarityFor(learning.concepts[concept]) !== 'unseen')
    : [];

  function forgetEverything() {
    Alert.alert(
      'Forget everything?',
      "This removes Alice's personal memories and learning signals from this device. It does not delete conversations, your wallet, your account, or your language preference.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => { void Promise.all([clearAliceMemory(), clearPedagogicalProfile()]).then(refresh); },
        },
      ],
    );
  }

  // Items are stored oldest first. The fifty most recent fill the fields;
  // anything older folds into its own section below.
  const items = memory?.items ?? [];
  const recent = items.slice(-ALICE_MEMORY_RECENT_LIMIT);
  const older = items.slice(0, Math.max(0, items.length - ALICE_MEMORY_RECENT_LIMIT));

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} accessibilityLabel="Back">
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>WHAT ALICE REMEMBERS</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={s.warning}>{ALICE_MEMORY_WARNING.en}</Text>

        <View style={s.memoryControl}>
          <View style={s.controlCopy}>
            <Text style={s.itemTitle}>MEMORY</Text>
            <Text style={s.hint}>Useful details are stored on this device. With Private Cloud, the relevant ones travel inside the same end-to-end encrypted envelope as your messages, readable only by the attested enclave.</Text>
          </View>
          <PixelToggle
            value={memory?.enabled ?? true}
            onValueChange={enabled => {
              setMemory(current => current ? { ...current, enabled } : current);
              void setAliceMemoryEnabled(enabled).then(setMemory);
            }}
            accessibilityLabel="Enable Alice memory"
          />
        </View>

        <Text style={s.groupTitle}>ABOUT YOU</Text>
        {ALICE_MEMORY_CATEGORIES.map(category => (
          <MemoryCategoryField
            key={category}
            category={category}
            items={recent.filter(item => item.category === category)}
            totalCount={items.filter(item => item.category === category).length}
            paused={memory ? isAliceMemoryCategoryPaused(memory, category) : false}
            s={s}
            colors={colors}
            onChange={setMemory}
          />
        ))}

        {older.length > 0 && (
          <View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ expanded: olderOpen }}
              accessibilityLabel={`${olderOpen ? 'Hide' : 'Show'} older facts, ${older.length}`}
              onPress={() => setOlderOpen(open => !open)}
              style={s.olderToggle}
            >
              <Text style={s.sectionTitle}>{olderOpen ? 'HIDE' : 'SHOW'} OLDER FACTS ({older.length})</Text>
            </TouchableOpacity>
            {olderOpen && (
              <View style={s.section}>
                {older.map((item, index) => (
                  <MemoryFactRow key={item.id} item={item} showCategory divided={index > 0} s={s} colors={colors} onChange={setMemory} />
                ))}
              </View>
            )}
          </View>
        )}

        <Text style={s.groupTitle}>LEARNING</Text>
        <View style={s.section}>
          {activeConcepts.length === 0 ? (
            <Text style={s.empty}>No Bitcoin learning signals yet.</Text>
          ) : activeConcepts.map((concept, index) => {
            const progress = learning!.concepts[concept];
            const state = familiarityFor(progress);
            return (
              <View key={concept} style={[s.itemRow, index > 0 && s.itemBorder]}>
                <View style={s.itemCopy}>
                  <Text style={s.itemText}>{KNOWLEDGE_CONCEPT_LABELS[concept]}</Text>
                  <Text style={s.itemMeta}>{familiarityLabel(state, Boolean(progress?.declaredFamiliarity))}</Text>
                </View>
                <TouchableOpacity
                  accessibilityLabel={`Forget ${KNOWLEDGE_CONCEPT_LABELS[concept]}`}
                  onPress={() => { void forgetPedagogicalConcept(concept).then(setLearning); }}
                  style={s.forgetButton}
                >
                  <Text style={[s.forgetText, { color: colors.danger }]}>FORGET</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        <Text style={s.privacyCopy}>
          Alice never saves message text, seeds, private keys, addresses, balances, amounts, transactions, exchange accounts, direct identifiers, precise location, or sensitive personal attributes in this memory, even when asked to.
        </Text>

        <TouchableOpacity style={[s.resetButton, { borderColor: colors.danger }]} onPress={forgetEverything}>
          <Text style={[s.resetText, { color: colors.danger }]}>FORGET EVERYTHING</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    backBtn: { ...pixel, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg },
    backIcon: { fontFamily: typography.pixel, fontSize: 18, color: colors.primary },
    title: { flex: 1, fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, textAlign: 'center', color: colors.primaryDark },
    body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    warning: { fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.text, marginBottom: spacing.lg },
    memoryControl: { ...pixel, backgroundColor: colors.cardBg, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    controlCopy: { flex: 1 },
    groupTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: colors.primaryDark, marginTop: spacing.xxl },
    sectionTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: colors.muted },
    fieldHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xl, marginBottom: spacing.sm },
    fieldActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    section: { ...pixel, backgroundColor: colors.cardBg, paddingHorizontal: spacing.lg },
    itemRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
    itemRowEditing: { alignItems: 'flex-start' },
    itemBorder: { borderTopWidth: 1, borderTopColor: colors.dotted },
    itemCopy: { flex: 1 },
    itemActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    itemTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: colors.primaryDark },
    itemText: { fontFamily: typography.numbers, fontSize: 15, lineHeight: 21, color: colors.text },
    itemMeta: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: colors.muted, marginBottom: spacing.xs },
    hint: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: spacing.xs },
    empty: { fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.muted, paddingVertical: spacing.lg },
    pausedNote: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 19, color: colors.muted, paddingTop: spacing.md },
    editInput: { ...pixel, minHeight: 44, paddingHorizontal: spacing.md, backgroundColor: colors.background, fontFamily: typography.numbers, fontSize: 14, color: colors.primaryDark },
    editActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    refusal: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
    inlineButton: { minHeight: 44, justifyContent: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
    inlineButtonText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: colors.muted },
    olderToggle: { minHeight: 44, justifyContent: 'center', marginTop: spacing.xl, marginBottom: spacing.sm },
    forgetButton: { paddingVertical: spacing.sm, paddingLeft: spacing.sm },
    forgetText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: '#e06060' },
    privacyCopy: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: spacing.xl },
    resetButton: { ...pixel, borderColor: '#e06060', borderWidth: 2, marginTop: spacing.xxl, paddingVertical: spacing.lg, alignItems: 'center' },
    resetText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: '#e06060' },
  });
}
