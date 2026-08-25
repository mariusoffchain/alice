import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useMemo, useState } from 'react';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import {
  KNOWLEDGE_CONCEPT_LABELS,
  clearAliceMemory,
  clearPedagogicalProfile,
  familiarityFor,
  forgetAliceMemoryItem,
  forgetPedagogicalConcept,
  getAliceMemory,
  getPedagogicalProfile,
  setAliceMemoryEnabled,
  type AliceMemory,
  type AliceMemoryCategory,
  type FamiliarityState,
  type KnowledgeConcept,
  type PedagogicalProfile,
} from '@alice-wallet/alice-ai';
import { PixelToggle, useTheme } from '@alice-wallet/alice-ui';

const CATEGORY_LABELS: Record<AliceMemoryCategory, string> = {
  preference: 'PREFERENCE',
  goal: 'GOAL',
  project: 'PROJECT',
  interest: 'INTEREST',
  background: 'BACKGROUND',
  constraint: 'CONSTRAINT',
};

function familiarityLabel(state: FamiliarityState, declared: boolean): string {
  if (declared) return `DECLARED ${state.toUpperCase()}`;
  if (state === 'introduced') return 'DISCUSSED';
  return state.toUpperCase();
}

export default function WhatAliceKnowsScreen() {
  const router = useRouter();
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [memory, setMemory] = useState<AliceMemory | null>(null);
  const [learning, setLearning] = useState<PedagogicalProfile | null>(null);

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

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} accessibilityLabel="Back">
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>WHAT ALICE REMEMBERS</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
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

        <Text style={s.sectionTitle}>ABOUT YOU</Text>
        <View style={s.section}>
          {!memory || memory.items.length === 0 ? (
            <Text style={s.empty}>Alice has not saved any useful details about you yet.</Text>
          ) : memory.items.map((item, index) => (
            <View key={item.id} style={[s.itemRow, index > 0 && s.itemBorder]}>
              <View style={s.itemCopy}>
                <Text style={s.itemMeta}>{CATEGORY_LABELS[item.category]}</Text>
                <Text style={s.itemText}>{item.text}</Text>
              </View>
              <TouchableOpacity
                accessibilityLabel={`Forget ${item.text}`}
                onPress={() => { void forgetAliceMemoryItem(item.id).then(setMemory); }}
                style={s.forgetButton}
              >
                <Text style={[s.forgetText, { color: colors.danger }]}>FORGET</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <Text style={s.sectionTitle}>LEARNING</Text>
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
          Alice never saves message text, seeds, private keys, addresses, balances, transactions, direct identifiers, precise location, or sensitive personal attributes in this memory.
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
    memoryControl: { ...pixel, backgroundColor: colors.cardBg, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    controlCopy: { flex: 1 },
    sectionTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: colors.muted, marginTop: spacing.xxl, marginBottom: spacing.sm },
    section: { ...pixel, backgroundColor: colors.cardBg, paddingHorizontal: spacing.lg },
    itemRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
    itemBorder: { borderTopWidth: 1, borderTopColor: colors.dotted },
    itemCopy: { flex: 1 },
    itemTitle: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: colors.primaryDark },
    itemText: { fontFamily: typography.numbers, fontSize: 15, lineHeight: 21, color: colors.text },
    itemMeta: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: colors.muted, marginBottom: spacing.xs },
    hint: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: spacing.xs },
    empty: { fontFamily: typography.numbers, fontSize: 14, lineHeight: 20, color: colors.muted, paddingVertical: spacing.lg },
    forgetButton: { paddingVertical: spacing.sm, paddingLeft: spacing.sm },
    forgetText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: '#e06060' },
    privacyCopy: { fontFamily: typography.numbers, fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: spacing.xl },
    resetButton: { ...pixel, borderColor: '#e06060', borderWidth: 2, marginTop: spacing.xxl, paddingVertical: spacing.lg, alignItems: 'center' },
    resetText: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 1, color: '#e06060' },
  });
}
