import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  JOURNEY_SECTIONS,
  resolveSections,
  allLessons,
  isUnitComplete,
  isSectionLocked,
  type JourneyLesson,
  type JourneySection,
  type JourneyUnit,
} from '@/lib/journey';

// ─── Design tokens ────────────────────────────────────────────────────────────

const BG       = '#111111';
const CARD_BG  = 'rgba(40,40,40,0.85)';
const BORDER   = 'rgba(255,255,255,0.08)';
const TEXT     = '#F2F2F2';
const MUTED    = 'rgba(255,255,255,0.25)';
const DIM      = 'rgba(255,255,255,0.5)';
const GOLD     = '#E8D200';

const SCREEN_W = Dimensions.get('window').width;
const NODE_SIZE = 62;

const CENTRE_X = SCREEN_W / 2;
const CURVE_AMP = SCREEN_W * 0.22;

function snakeX(indexInUnit: number): number {
  const positions = [0, 1, 0, -1, 0];
  const pos = positions[indexInUnit % positions.length];
  return CENTRE_X + pos * CURVE_AMP - NODE_SIZE / 2;
}

// ─── Mock completed IDs — first 12 lessons done ──────────────────────────────

const COMPLETED_IDS = new Set([
  'l-001', 'l-002', 'l-003', 'l-004', 'l-005', 'l-006',
  'l-007', 'l-008', 'l-009', 'l-010', 'l-011', 'l-012',
]);

// ─── Component ────────────────────────────────────────────────────────────────

export function JourneyFullView() {
  const [selected, setSelected] = useState<JourneyLesson | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const sections = resolveSections(JOURNEY_SECTIONS, COMPLETED_IDS);
  const lessons  = allLessons(sections);
  const completed = lessons.filter(l => l.state === 'completed').length;

  // Auto-scroll to current lesson
  useEffect(() => {
    const currentIdx = lessons.findIndex(l => l.state === 'current');
    if (currentIdx < 0) return;
    const timer = setTimeout(() => {
      let y = 0;
      let count = 0;
      for (const s of sections) {
        if (isSectionLocked(s)) break;
        y += 100;
        for (const u of s.units) {
          y += 52;
          for (const l of u.lessons) {
            if (count === currentIdx) {
              scrollRef.current?.scrollTo({ y: Math.max(0, y - 200), animated: true });
              return;
            }
            y += 100;
            count++;
          }
          y += 50;
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      {/* Overall progress */}
      <View style={styles.topProgress}>
        <Text style={styles.topProgressText}>
          {completed} / {lessons.length} lessons
        </Text>
        <View style={styles.topProgressBarWrap}>
          <View style={[styles.topProgressBar, { width: `${(completed / lessons.length) * 100}%` as any }]} />
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {sections.map((section, si) => {
          const locked = isSectionLocked(section);

          // ── Locked section: show "UP NEXT" card ──
          if (locked) {
            return (
              <LockedSectionCard
                key={section.id}
                section={section}
                index={si + 1}
              />
            );
          }

          // ── Active/completed section: show full path ──
          return (
            <View key={section.id}>
              <SectionBanner section={section} index={si + 1} />

              {section.units.map((unit) => {
                const unitDone = isUnitComplete(unit);
                return (
                  <View key={unit.id}>
                    <UnitHeader unit={unit} colour={section.colour} />
                    <View style={styles.lessonPath}>
                      {unit.lessons.map((lesson, li) => (
                        <View
                          key={lesson.id}
                          style={[styles.lessonSlot, { paddingLeft: snakeX(li) }]}
                        >
                          {li < unit.lessons.length - 1 && (
                            <View style={styles.connectorLine} pointerEvents="none" />
                          )}
                          <LessonNode
                            lesson={lesson}
                            colour={section.colour}
                            onPress={() => setSelected(lesson)}
                          />
                        </View>
                      ))}
                    </View>
                    <RewardChest unit={unit} complete={unitDone} colour={section.colour} />
                  </View>
                );
              })}
            </View>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>

      {selected && (
        <LessonDetailSheet
          lesson={selected}
          sections={sections}
          onClose={() => setSelected(null)}
        />
      )}
    </View>
  );
}

// ─── Section Banner (active/completed) ────────────────────────────────────────

function SectionBanner({ section, index }: { section: JourneySection; index: number }) {
  const sLessons  = allLessons([section]);
  const completed = sLessons.filter(l => l.state === 'completed').length;
  const total     = sLessons.length;

  return (
    <View style={styles.sectionBanner}>
      <LinearGradient
        colors={[`${section.colour}30`, `${section.colour}08`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.sectionAccent, { backgroundColor: section.colour }]} />
      <View style={styles.sectionBannerContent}>
        <Text style={[styles.sectionNumber, { color: section.colour }]}>
          SECTION {index}
        </Text>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
        <View style={styles.sectionProgressRow}>
          <View style={styles.sectionProgressTrack}>
            <View
              style={[
                styles.sectionProgressFill,
                { width: `${total > 0 ? (completed / total) * 100 : 0}%` as any, backgroundColor: section.colour },
              ]}
            />
          </View>
          <Text style={styles.sectionProgressLabel}>{completed}/{total}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Locked Section Card ("UP NEXT") ──────────────────────────────────────────

function LockedSectionCard({
  section,
  index,
}: {
  section: JourneySection;
  index: number;
}) {
  const total = allLessons([section]).length;

  return (
    <View style={styles.lockedSectionWrap}>
      {/* "UP NEXT" pill */}
      <View style={styles.upNextPill}>
        <Text style={styles.upNextText}>UP NEXT</Text>
      </View>

      {/* Card */}
      <View style={styles.lockedSectionCard}>
        <LinearGradient
          colors={['rgba(40,40,40,0.6)', 'rgba(30,30,30,0.9)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        <Ionicons name="lock-closed" size={20} color={MUTED} style={{ marginBottom: 4 }} />
        <Text style={styles.lockedSectionTitle}>
          Section {index}
        </Text>
        <Text style={styles.lockedSectionName}>{section.title}</Text>
        <Text style={styles.lockedSectionDesc}>{section.subtitle}</Text>
        <Text style={styles.lockedSectionMeta}>
          {total} lessons · {section.units.length} units
        </Text>
      </View>
    </View>
  );
}

// ─── Unit Header ──────────────────────────────────────────────────────────────

function UnitHeader({ unit, colour }: { unit: JourneyUnit; colour: string }) {
  const completed = unit.lessons.filter(l => l.state === 'completed').length;
  const total     = unit.lessons.length;
  const done      = completed === total;

  return (
    <View style={styles.unitHeader}>
      <View style={[styles.unitHeaderLine, { backgroundColor: `${colour}30` }]} />
      <View style={styles.unitHeaderCenter}>
        <Text style={[styles.unitHeaderTitle, done && { color: colour }]}>
          {unit.title}
        </Text>
        <Text style={styles.unitHeaderSub}>{completed}/{total}</Text>
      </View>
      <View style={[styles.unitHeaderLine, { backgroundColor: `${colour}30` }]} />
    </View>
  );
}

// ─── Lesson Node ──────────────────────────────────────────────────────────────

function LessonNode({
  lesson,
  colour,
  onPress,
}: {
  lesson: JourneyLesson;
  colour: string;
  onPress: () => void;
}) {
  const isCompleted = lesson.state === 'completed';
  const isCurrent   = lesson.state === 'current';
  const isLocked    = lesson.state === 'locked';

  const pulseScale   = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.5);

  useEffect(() => {
    if (!isCurrent) return;
    pulseScale.value = withRepeat(
      withSequence(withTiming(1.4, { duration: 1000 }), withTiming(1, { duration: 800 })),
      -1, false,
    );
    pulseOpacity.value = withRepeat(
      withSequence(withTiming(0, { duration: 1000 }), withTiming(0.5, { duration: 800 })),
      -1, false,
    );
  }, [isCurrent]);

  const pulseRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.lessonNodeWrap, pressed && { opacity: 0.8 }]}
    >
      {isCurrent && (
        <Animated.View
          style={[
            styles.lessonPulseRing,
            { borderColor: colour, backgroundColor: `${colour}10` },
            pulseRingStyle,
          ]}
          pointerEvents="none"
        />
      )}

      <View
        style={[
          styles.lessonCircle,
          isCompleted && { backgroundColor: colour, borderColor: colour },
          isCurrent   && { backgroundColor: `${colour}25`, borderColor: colour, borderWidth: 3 },
          isLocked    && styles.lessonCircleLocked,
        ]}
      >
        {isCompleted && <Ionicons name="checkmark" size={26} color="#0d0d0d" />}
        {isCurrent && <Ionicons name={(lesson.icon || 'star-outline') as any} size={24} color={colour} />}
        {isLocked && <Ionicons name="lock-closed" size={20} color="rgba(255,255,255,0.15)" />}
      </View>

      <Text
        style={[
          styles.lessonLabel,
          isCompleted && { color: colour },
          isCurrent   && { color: TEXT, fontWeight: '500' },
          isLocked    && { color: MUTED },
        ]}
        numberOfLines={1}
      >
        {lesson.title}
      </Text>

      {isCurrent && (
        <View style={[styles.lessonStartBadge, { backgroundColor: colour }]}>
          <Text style={styles.lessonStartText}>START</Text>
        </View>
      )}
    </Pressable>
  );
}

// ─── Reward Chest ─────────────────────────────────────────────────────────────

function RewardChest({ unit, complete, colour }: { unit: JourneyUnit; complete: boolean; colour: string }) {
  return (
    <View style={styles.rewardChestWrap}>
      <View
        style={[
          styles.rewardChestCircle,
          complete
            ? { backgroundColor: `${colour}20`, borderColor: colour }
            : styles.rewardChestLocked,
        ]}
      >
        <Ionicons
          name={complete ? 'gift' : 'gift-outline'}
          size={22}
          color={complete ? colour : MUTED}
        />
      </View>
      <Text style={[styles.rewardChestText, complete && { color: colour }]}>
        {complete ? `+${unit.bonusXp} XP` : `${unit.bonusXp} XP`}
      </Text>
    </View>
  );
}

// ─── Lesson Detail Sheet ──────────────────────────────────────────────────────

function LessonDetailSheet({
  lesson,
  sections,
  onClose,
}: {
  lesson: JourneyLesson;
  sections: JourneySection[];
  onClose: () => void;
}) {
  const isLocked    = lesson.state === 'locked';
  const isCompleted = lesson.state === 'completed';

  let sectionColour = GOLD;
  for (const s of sections) {
    for (const u of s.units) {
      if (u.lessons.some(l => l.id === lesson.id)) {
        sectionColour = s.colour;
      }
    }
  }
  const colour = isLocked ? MUTED : sectionColour;

  return (
    <Pressable style={styles.overlay} onPress={onClose}>
      <View style={styles.detailSheet}>
        <View style={[styles.detailAccent, { backgroundColor: colour }]} />

        <View style={[styles.detailIconWrap, { backgroundColor: `${colour}20`, borderColor: `${colour}50` }]}>
          <Ionicons name={(lesson.icon || 'star-outline') as any} size={28} color={colour} />
        </View>

        <Text style={[styles.detailTitle, { color: isLocked ? DIM : colour }]}>
          {lesson.title}
        </Text>
        <Text style={styles.detailDesc}>{lesson.subtitle}</Text>

        <View style={[styles.detailXpBadge, { borderColor: `${colour}40` }]}>
          <Ionicons name="flash" size={12} color={colour} />
          <Text style={[styles.detailXpText, { color: colour }]}>+{lesson.xpReward} XP</Text>
        </View>

        <View style={styles.detailStatusRow}>
          {isCompleted && (
            <>
              <Ionicons name="checkmark-circle" size={16} color={colour} />
              <Text style={[styles.detailStatusText, { color: colour }]}>Completed</Text>
            </>
          )}
          {lesson.state === 'current' && (
            <>
              <Ionicons name="play-circle" size={16} color={colour} />
              <Text style={[styles.detailStatusText, { color: colour }]}>In Progress</Text>
            </>
          )}
          {isLocked && (
            <>
              <Ionicons name="lock-closed" size={14} color={MUTED} />
              <Text style={[styles.detailStatusText, { color: MUTED }]}>Complete earlier lessons first</Text>
            </>
          )}
        </View>

        <Text style={styles.detailDismiss}>Tap anywhere to dismiss</Text>
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  topProgress: { paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  topProgressText: { fontSize: 11, fontWeight: '300', color: MUTED, textAlign: 'center' },
  topProgressBarWrap: { height: 3, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' },
  topProgressBar: { height: '100%', backgroundColor: GOLD, borderRadius: 2 },

  scrollContent: { paddingBottom: 40 },

  // ── Section banner (active)
  sectionBanner: {
    marginHorizontal: 12, marginTop: 20, marginBottom: 6,
    borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: BORDER, position: 'relative',
  },
  sectionAccent: { position: 'absolute', top: 0, left: 0, bottom: 0, width: 3 },
  sectionBannerContent: { padding: 16, paddingLeft: 18, gap: 4 },
  sectionNumber: { fontSize: 9, fontWeight: '700', letterSpacing: 2.5 },
  sectionTitle: { fontSize: 22, fontWeight: '300', letterSpacing: -0.3, color: TEXT },
  sectionSubtitle: { fontSize: 11, fontWeight: '300', color: DIM, marginBottom: 4 },
  sectionProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  sectionProgressTrack: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  sectionProgressFill: { height: '100%', borderRadius: 2 },
  sectionProgressLabel: { fontSize: 11, fontWeight: '400', color: DIM },

  // ── Locked section card
  lockedSectionWrap: {
    alignItems: 'center', marginTop: 32, marginBottom: 16, paddingHorizontal: 12,
  },
  upNextPill: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: BORDER,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 5, marginBottom: -14, zIndex: 1,
  },
  upNextText: { fontSize: 9, fontWeight: '700', letterSpacing: 2.5, color: MUTED },
  lockedSectionCard: {
    width: '100%', borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24, gap: 4,
  },
  lockedSectionTitle: { fontSize: 12, fontWeight: '300', color: MUTED, letterSpacing: 0.5 },
  lockedSectionName: { fontSize: 24, fontWeight: '200', color: DIM, letterSpacing: -0.3, marginTop: 2 },
  lockedSectionDesc: { fontSize: 12, fontWeight: '300', color: MUTED, textAlign: 'center', lineHeight: 18, marginTop: 4, maxWidth: 280 },
  lockedSectionMeta: { fontSize: 10, fontWeight: '400', color: MUTED, letterSpacing: 0.5, marginTop: 8, opacity: 0.6 },

  // ── Unit header
  unitHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, marginTop: 20, marginBottom: 4 },
  unitHeaderLine: { flex: 1, height: 1 },
  unitHeaderCenter: { alignItems: 'center', gap: 2 },
  unitHeaderTitle: { fontSize: 13, fontWeight: '400', color: DIM, letterSpacing: 0.2 },
  unitHeaderSub: { fontSize: 9, fontWeight: '300', color: MUTED },

  // ── Lesson path
  lessonPath: { paddingVertical: 8 },
  lessonSlot: { height: 100, position: 'relative' },
  connectorLine: {
    position: 'absolute', left: NODE_SIZE / 2 - 1, top: NODE_SIZE + 4,
    width: 2, height: 34, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 1,
  },

  // ── Lesson node
  lessonNodeWrap: { alignItems: 'center', width: NODE_SIZE + 24, position: 'relative' },
  lessonPulseRing: {
    position: 'absolute',
    width: NODE_SIZE + 20, height: NODE_SIZE + 20,
    borderRadius: (NODE_SIZE + 20) / 2, borderWidth: 2.5,
    top: -10, left: (NODE_SIZE + 24 - NODE_SIZE - 20) / 2,
  },
  lessonCircle: {
    width: NODE_SIZE, height: NODE_SIZE, borderRadius: NODE_SIZE / 2,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },
  lessonCircleLocked: { borderColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(255,255,255,0.02)' },
  lessonLabel: { marginTop: 5, fontSize: 9, fontWeight: '300', color: DIM, textAlign: 'center', maxWidth: NODE_SIZE + 30, letterSpacing: 0.2 },
  lessonStartBadge: { marginTop: 4, paddingHorizontal: 12, paddingVertical: 3, borderRadius: 12 },
  lessonStartText: { fontSize: 8, fontWeight: '800', letterSpacing: 2, color: '#0d0d0d' },

  // ── Reward chest
  rewardChestWrap: { alignItems: 'center', paddingVertical: 8, gap: 4 },
  rewardChestCircle: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },
  rewardChestLocked: { borderColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(255,255,255,0.02)', opacity: 0.4 },
  rewardChestText: { fontSize: 9, fontWeight: '500', color: MUTED, letterSpacing: 0.5 },

  // ── Detail sheet
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'flex-end',
    paddingBottom: 32, paddingHorizontal: 16, zIndex: 100,
  },
  detailSheet: {
    width: '100%', backgroundColor: '#141414', borderRadius: 24,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center',
    paddingVertical: 28, paddingHorizontal: 24, gap: 10, overflow: 'hidden',
  },
  detailAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  detailIconWrap: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  detailTitle: { fontSize: 24, fontWeight: '300', letterSpacing: -0.3 },
  detailDesc: { fontSize: 13, fontWeight: '300', color: DIM, textAlign: 'center', lineHeight: 20 },
  detailXpBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginTop: 2,
  },
  detailXpText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  detailStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  detailStatusText: { fontSize: 12, fontWeight: '400', letterSpacing: 0.3 },
  detailDismiss: { fontSize: 10, fontWeight: '300', color: MUTED, marginTop: 10 },
});
