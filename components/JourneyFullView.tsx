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
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle as SvgCircle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

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
const CURRENT_NODE_SIZE = 70;

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

// ─── Animation hooks ─────────────────────────────────────────────────────────

function useSparkle(delay = 0) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = withDelay(delay, withRepeat(
      withSequence(
        withTiming(1, { duration: 600 }),
        withTiming(0.2, { duration: 800 }),
      ),
      -1, false,
    ));
    scale.value = withDelay(delay, withRepeat(
      withSequence(
        withTiming(1, { duration: 600 }),
        withTiming(0.6, { duration: 800 }),
      ),
      -1, false,
    ));
  }, []);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
}

function usePulseGlow(duration = 2000) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: duration / 2 }),
        withTiming(0.3, { duration: duration / 2 }),
      ),
      -1, false,
    );
  }, []);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JourneyFullView() {
  const [selected, setSelected] = useState<JourneyLesson | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const sections = resolveSections(JOURNEY_SECTIONS, COMPLETED_IDS);
  const lessons  = allLessons(sections);
  const completed = lessons.filter(l => l.state === 'completed').length;
  const pct = lessons.length > 0 ? completed / lessons.length : 0;

  // Auto-scroll to current lesson
  useEffect(() => {
    const currentIdx = lessons.findIndex(l => l.state === 'current');
    if (currentIdx < 0) return;
    const timer = setTimeout(() => {
      let y = 0;
      let count = 0;
      for (const s of sections) {
        if (isSectionLocked(s)) break;
        y += 120;
        for (const u of s.units) {
          y += 56;
          for (const l of u.lessons) {
            if (count === currentIdx) {
              scrollRef.current?.scrollTo({ y: Math.max(0, y - 200), animated: true });
              return;
            }
            y += 110;
            count++;
          }
          y += 64;
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      {/* Overall progress */}
      <TopProgressCard completed={completed} total={lessons.length} pct={pct} />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {sections.map((section, si) => {
          const locked = isSectionLocked(section);

          if (locked) {
            return (
              <LockedSectionCard
                key={section.id}
                section={section}
                index={si + 1}
              />
            );
          }

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
                          <LessonNode
                            lesson={lesson}
                            colour={section.colour}
                            isFirstLocked={lesson.state === 'locked' && li > 0 && unit.lessons[li - 1].state === 'current'}
                            onPress={() => setSelected(lesson)}
                            showConnector={li < unit.lessons.length - 1}
                            connectorState={li < unit.lessons.length - 1 ? {
                              fromState: lesson.state,
                              toState: unit.lessons[li + 1].state,
                            } : undefined}
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

        <View style={{ height: 120 }} />
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

// ─── Top Progress Card ───────────────────────────────────────────────────────

function TopProgressCard({ completed, total, pct }: { completed: number; total: number; pct: number }) {
  const milestones = [0.25, 0.5, 0.75, 1];

  return (
    <View style={styles.topProgressCard}>
      <View style={styles.topProgressHeader}>
        <Text style={styles.topProgressLabel}>JOURNEY PROGRESS</Text>
        <Text style={styles.topProgressText}>
          {completed} / {total}
        </Text>
      </View>
      <View style={styles.topProgressBarWrap}>
        <LinearGradient
          colors={['#4ade80', GOLD, '#fb923c']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.topProgressBar, { width: `${Math.max(pct * 100, 1)}%` as any }]}
        />
        {/* Milestone diamonds */}
        {milestones.map((m) => (
          <View
            key={m}
            style={[
              styles.milestoneDiamond,
              { left: `${m * 100}%` as any },
              pct >= m && styles.milestoneDiamondActive,
            ]}
          />
        ))}
        {/* Glow tip */}
        {pct > 0.02 && (
          <View style={[styles.progressGlowTip, { left: `${pct * 100}%` as any }]} />
        )}
      </View>
    </View>
  );
}

// ─── Section Banner (active/completed) ────────────────────────────────────────

function SectionBanner({ section, index }: { section: JourneySection; index: number }) {
  const sLessons  = allLessons([section]);
  const completed = sLessons.filter(l => l.state === 'completed').length;
  const total     = sLessons.length;
  const pct       = total > 0 ? completed / total : 0;
  const isComplete = completed === total;

  return (
    <View style={styles.sectionBanner}>
      <LinearGradient
        colors={[`${section.colour}40`, `${section.colour}15`, `${section.colour}05`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.sectionAccent, { backgroundColor: section.colour }]} />

      {/* Section number badge */}
      <View style={[styles.sectionBadge, { backgroundColor: `${section.colour}20`, borderColor: `${section.colour}40` }]}>
        <Text style={[styles.sectionBadgeText, { color: section.colour }]}>{index}</Text>
      </View>

      <View style={styles.sectionBannerContent}>
        <Text style={[styles.sectionNumber, { color: section.colour }]}>
          SECTION {index}
        </Text>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>

        {/* Rich progress bar */}
        <View style={styles.sectionProgressRow}>
          <View style={styles.sectionProgressTrack}>
            <LinearGradient
              colors={[`${section.colour}90`, section.colour]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.sectionProgressFill, { width: `${pct * 100}%` as any }]}
            />
            {pct > 0.05 && pct < 1 && (
              <View style={[styles.sectionProgressTip, { left: `${pct * 100}%` as any, backgroundColor: section.colour }]} />
            )}
          </View>
          <Text style={[styles.sectionProgressLabel, { color: isComplete ? section.colour : DIM }]}>
            {completed}/{total}
          </Text>
          {isComplete && (
            <Ionicons name="checkmark-circle" size={14} color={section.colour} />
          )}
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
  const glowStyle = usePulseGlow(3000);

  return (
    <View style={styles.lockedSectionWrap}>
      {/* "UP NEXT" pill */}
      <View style={[styles.upNextPill, { borderColor: `${section.colour}30` }]}>
        <Text style={[styles.upNextText, { color: `${section.colour}80` }]}>UP NEXT</Text>
      </View>

      {/* Card */}
      <View style={styles.lockedSectionCard}>
        <LinearGradient
          colors={['rgba(30,30,30,0.5)', 'rgba(20,20,20,0.95)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Section colour hint line at top */}
        <View style={[styles.lockedTopLine, { backgroundColor: `${section.colour}40` }]} />

        {/* Lock icon with glow */}
        <View style={styles.lockIconWrap}>
          <Animated.View style={[styles.lockGlow, { backgroundColor: `${section.colour}15` }, glowStyle]} />
          <View style={[styles.lockCircle, { borderColor: `${section.colour}25` }]}>
            <Ionicons name="lock-closed" size={20} color={`${section.colour}60`} />
          </View>
        </View>

        <Text style={styles.lockedSectionTitle}>
          Section {index}
        </Text>
        <Text style={[styles.lockedSectionName, { color: `${section.colour}90` }]}>
          {section.title}
        </Text>
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
      {/* Gradient fade lines */}
      <View style={styles.unitLineWrap}>
        <LinearGradient
          colors={['transparent', `${colour}30`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.unitGradientLine}
        />
      </View>

      {/* Center pill */}
      <View style={[
        styles.unitPill,
        { backgroundColor: `${colour}10`, borderColor: `${colour}25` },
        done && { backgroundColor: `${colour}18`, borderColor: `${colour}40` },
      ]}>
        {done && <Ionicons name="checkmark-circle" size={12} color={colour} style={{ marginRight: 4 }} />}
        <Text style={[styles.unitHeaderTitle, done && { color: colour }]}>
          {unit.title}
        </Text>
        <Text style={[styles.unitHeaderSub, done && { color: `${colour}80` }]}>
          {completed}/{total}
        </Text>
      </View>

      <View style={styles.unitLineWrap}>
        <LinearGradient
          colors={[`${colour}30`, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.unitGradientLine}
        />
      </View>
    </View>
  );
}

// ─── Connector Line ──────────────────────────────────────────────────────────

function ConnectorLine({
  fromState,
  toState,
  colour,
}: {
  fromIndex: number;
  toIndex: number;
  fromState: string;
  toState: string;
  colour: string;
}) {
  const isLocked = toState === 'locked';
  const isCompleted = fromState === 'completed' && toState !== 'locked';

  const lineHeight = 36;
  const lineWidth = 20;

  return (
    <View style={styles.connectorWrap} pointerEvents="none">
      <Svg width={lineWidth} height={lineHeight}>
        <Defs>
          <SvgGradient id={`conn-${fromState}-${toState}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={isCompleted ? colour : 'rgba(255,255,255,0.15)'} stopOpacity={isCompleted ? 0.5 : 0.15} />
            <Stop offset="100%" stopColor={isCompleted ? colour : 'rgba(255,255,255,0.05)'} stopOpacity={isCompleted ? 0.2 : 0.05} />
          </SvgGradient>
        </Defs>
        <Path
          d={`M ${lineWidth / 2} 0 L ${lineWidth / 2} ${lineHeight}`}
          stroke={isLocked ? 'rgba(255,255,255,0.06)' : `url(#conn-${fromState}-${toState})`}
          strokeWidth={2}
          strokeLinecap="round"
          fill="none"
          {...(isLocked ? { strokeDasharray: '3,5' } : {})}
        />
      </Svg>
    </View>
  );
}

// ─── Lesson Node ──────────────────────────────────────────────────────────────

function LessonNode({
  lesson,
  colour,
  isFirstLocked,
  onPress,
  showConnector,
  connectorState,
}: {
  lesson: JourneyLesson;
  colour: string;
  isFirstLocked?: boolean;
  onPress: () => void;
  showConnector?: boolean;
  connectorState?: { fromState: string; toState: string };
}) {
  const isCompleted = lesson.state === 'completed';
  const isCurrent   = lesson.state === 'current';
  const isLocked    = lesson.state === 'locked';

  const nodeSize = isCurrent ? CURRENT_NODE_SIZE : NODE_SIZE;

  // Pulse animations for current lesson
  const pulseScale   = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.5);
  const pulse2Scale  = useSharedValue(1);
  const pulse2Opacity = useSharedValue(0.3);
  const bounceY      = useSharedValue(0);

  useEffect(() => {
    if (!isCurrent) return;
    // Inner pulse ring
    pulseScale.value = withRepeat(
      withSequence(withTiming(1.35, { duration: 1200 }), withTiming(1, { duration: 900 })),
      -1, false,
    );
    pulseOpacity.value = withRepeat(
      withSequence(withTiming(0, { duration: 1200 }), withTiming(0.5, { duration: 900 })),
      -1, false,
    );
    // Outer slower pulse ring
    pulse2Scale.value = withDelay(400, withRepeat(
      withSequence(withTiming(1.6, { duration: 1600 }), withTiming(1, { duration: 1200 })),
      -1, false,
    ));
    pulse2Opacity.value = withDelay(400, withRepeat(
      withSequence(withTiming(0, { duration: 1600 }), withTiming(0.3, { duration: 1200 })),
      -1, false,
    ));
    // Subtle START badge bounce
    bounceY.value = withRepeat(
      withSequence(
        withTiming(-3, { duration: 800, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 600, easing: Easing.in(Easing.quad) }),
      ),
      -1, false,
    );
  }, [isCurrent]);

  const pulseRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  const pulse2RingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse2Scale.value }],
    opacity: pulse2Opacity.value,
  }));

  const bounceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bounceY.value }],
  }));

  // Sparkle for completed nodes
  const sparkle1 = useSparkle(0);
  const sparkle2 = useSparkle(500);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.lessonNodeWrap,
        isCurrent && { width: CURRENT_NODE_SIZE + 24 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {/* Completed glow ring */}
      {isCompleted && (
        <View style={[styles.completedGlow, { backgroundColor: `${colour}12`, width: NODE_SIZE + 12, height: NODE_SIZE + 12, borderRadius: (NODE_SIZE + 12) / 2 }]} />
      )}

      {/* Current: double pulse rings */}
      {isCurrent && (
        <>
          <Animated.View
            style={[
              styles.lessonPulseRing,
              {
                borderColor: colour,
                backgroundColor: `${colour}08`,
                width: CURRENT_NODE_SIZE + 24,
                height: CURRENT_NODE_SIZE + 24,
                borderRadius: (CURRENT_NODE_SIZE + 24) / 2,
                top: -12,
                left: (CURRENT_NODE_SIZE + 24 - CURRENT_NODE_SIZE - 24) / 2,
              },
              pulseRingStyle,
            ]}
            pointerEvents="none"
          />
          <Animated.View
            style={[
              styles.lessonPulseRing,
              {
                borderColor: `${colour}60`,
                width: CURRENT_NODE_SIZE + 40,
                height: CURRENT_NODE_SIZE + 40,
                borderRadius: (CURRENT_NODE_SIZE + 40) / 2,
                top: -20,
                left: (CURRENT_NODE_SIZE + 24 - CURRENT_NODE_SIZE - 40) / 2,
              },
              pulse2RingStyle,
            ]}
            pointerEvents="none"
          />
        </>
      )}

      {/* Node circle */}
      <View style={[
        styles.lessonCircle,
        { width: nodeSize, height: nodeSize, borderRadius: nodeSize / 2 },
        isCompleted && { borderColor: colour, borderWidth: 2.5 },
        isCurrent   && { borderColor: colour, borderWidth: 3 },
        isLocked    && styles.lessonCircleLocked,
        isFirstLocked && { borderColor: `${colour}20`, backgroundColor: `${colour}06` },
      ]}>
        {/* Gradient fill for completed/current */}
        {isCompleted && (
          <LinearGradient
            colors={[colour, `${colour}CC`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFillObject, { borderRadius: nodeSize / 2 }]}
          />
        )}
        {isCurrent && (
          <LinearGradient
            colors={[`${colour}30`, `${colour}15`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFillObject, { borderRadius: nodeSize / 2 }]}
          />
        )}

        {isCompleted && <Ionicons name="checkmark" size={26} color="#0d0d0d" />}
        {isCurrent && <Ionicons name={(lesson.icon || 'star-outline') as any} size={26} color={colour} />}
        {isLocked && (
          <Svg width={nodeSize} height={nodeSize} style={StyleSheet.absoluteFillObject}>
            <SvgCircle
              cx={nodeSize / 2}
              cy={nodeSize / 2}
              r={nodeSize / 2 - 2}
              stroke={isFirstLocked ? `${colour}20` : 'rgba(255,255,255,0.06)'}
              strokeWidth={1.5}
              strokeDasharray="3,5"
              fill="none"
            />
          </Svg>
        )}
        {isLocked && <Ionicons name="lock-closed" size={18} color={isFirstLocked ? `${colour}30` : 'rgba(255,255,255,0.12)'} />}
      </View>

      {/* Sparkle dots for completed */}
      {isCompleted && (
        <>
          <Animated.View style={[styles.sparkleDot, { backgroundColor: colour, top: 2, right: 6 }, sparkle1]} />
          <Animated.View style={[styles.sparkleDot, { backgroundColor: colour, top: 14, right: 0 }, sparkle2]} />
        </>
      )}

      <Text
        style={[
          styles.lessonLabel,
          isCompleted && { color: colour, fontWeight: '400' },
          isCurrent   && { color: TEXT, fontWeight: '500', fontSize: 10 },
          isLocked    && { color: MUTED },
          isFirstLocked && { color: `${colour}40` },
        ]}
        numberOfLines={1}
      >
        {lesson.title}
      </Text>

      {isCurrent && (
        <Animated.View style={bounceStyle}>
          <LinearGradient
            colors={[colour, `${colour}DD`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.lessonStartBadge}
          >
            <Text style={styles.lessonStartText}>START</Text>
          </LinearGradient>
        </Animated.View>
      )}

      {/* Connector to next node — rendered inside the node wrap so it inherits padding position */}
      {showConnector && connectorState && (
        <ConnectorLine
          fromIndex={0}
          toIndex={0}
          fromState={connectorState.fromState}
          toState={connectorState.toState}
          colour={colour}
        />
      )}
    </Pressable>
  );
}

// ─── Reward Chest ─────────────────────────────────────────────────────────────

function RewardChest({ unit, complete, colour }: { unit: JourneyUnit; complete: boolean; colour: string }) {
  const sparkleA = useSparkle(0);
  const sparkleB = useSparkle(700);

  return (
    <View style={styles.rewardChestWrap}>
      {/* Divider line above */}
      <View style={[styles.rewardDivider, { backgroundColor: complete ? `${colour}20` : BORDER }]} />

      <View style={styles.rewardChestInner}>
        {/* Outer glow for unlocked */}
        {complete && (
          <View style={[styles.rewardGlow, { backgroundColor: `${colour}10` }]} />
        )}

        <View
          style={[
            styles.rewardChestCircle,
            complete
              ? { borderColor: `${colour}60` }
              : styles.rewardChestLocked,
          ]}
        >
          {complete && (
            <LinearGradient
              colors={[`${colour}30`, `${colour}15`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFillObject, { borderRadius: 28 }]}
            />
          )}
          <Ionicons
            name={complete ? 'gift' : 'gift-outline'}
            size={24}
            color={complete ? colour : MUTED}
          />
        </View>

        {/* Sparkle dots */}
        {complete && (
          <>
            <Animated.View style={[styles.sparkleDot, { backgroundColor: colour, top: 4, right: -4 }, sparkleA]} />
            <Animated.View style={[styles.sparkleDot, { backgroundColor: colour, bottom: 4, left: -4 }, sparkleB]} />
          </>
        )}
      </View>

      <Text style={[styles.rewardChestText, complete && { color: colour, fontWeight: '600' }]}>
        {complete ? `+${unit.bonusXp} XP` : `${unit.bonusXp} XP`}
      </Text>

      {/* Divider line below */}
      <View style={[styles.rewardDivider, { backgroundColor: complete ? `${colour}20` : BORDER }]} />
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
  const isCurrent   = lesson.state === 'current';

  let sectionColour = GOLD;
  for (const s of sections) {
    for (const u of s.units) {
      if (u.lessons.some(l => l.id === lesson.id)) {
        sectionColour = s.colour;
      }
    }
  }
  const colour = isLocked ? MUTED : sectionColour;

  // Spring entrance
  const translateY = useSharedValue(300);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSpring(0, { damping: 22, stiffness: 180 });
    overlayOpacity.value = withTiming(1, { duration: 250 });
  }, []);

  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const overlayAnimStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  return (
    <Pressable style={styles.overlay} onPress={onClose}>
      <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.88)' }, overlayAnimStyle]} />
      <Animated.View style={[styles.detailSheet, sheetAnimStyle]}>
        {/* Gradient accent bar */}
        <LinearGradient
          colors={isLocked ? ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.02)'] : [`${colour}CC`, `${colour}40`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.detailAccent}
        />
        {/* Glow zone below accent */}
        {!isLocked && (
          <View style={[styles.detailAccentGlow, { backgroundColor: `${colour}15` }]} />
        )}

        {/* Double-ring icon */}
        <View style={styles.detailIconOuter}>
          <View style={[styles.detailIconOuterRing, { borderColor: `${colour}20` }]} />
          <View style={[styles.detailIconWrap, { backgroundColor: `${colour}15`, borderColor: `${colour}40` }]}>
            <Ionicons name={(lesson.icon || 'star-outline') as any} size={30} color={colour} />
          </View>
        </View>

        <Text style={[styles.detailTitle, { color: isLocked ? DIM : colour }]}>
          {lesson.title}
        </Text>
        <Text style={styles.detailDesc}>{lesson.subtitle}</Text>

        <View style={[styles.detailXpBadge, { borderColor: `${colour}40`, backgroundColor: `${colour}08` }]}>
          <Ionicons name="flash" size={13} color={colour} />
          <Text style={[styles.detailXpText, { color: colour }]}>+{lesson.xpReward} XP</Text>
        </View>

        <View style={styles.detailStatusRow}>
          {isCompleted && (
            <>
              <Ionicons name="checkmark-circle" size={16} color={colour} />
              <Text style={[styles.detailStatusText, { color: colour }]}>Completed</Text>
            </>
          )}
          {isCurrent && (
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

        {/* CTA for current lesson */}
        {isCurrent && (
          <Pressable style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
            <LinearGradient
              colors={[colour, `${colour}DD`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.detailCta}
            >
              <Ionicons name="play" size={16} color="#0d0d0d" />
              <Text style={styles.detailCtaText}>Start Lesson</Text>
            </LinearGradient>
          </Pressable>
        )}

        <Text style={styles.detailDismiss}>Tap anywhere to dismiss</Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Top progress card
  topProgressCard: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    gap: 8,
  },
  topProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topProgressLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: DIM },
  topProgressText: { fontSize: 12, fontWeight: '400', color: TEXT },
  topProgressBarWrap: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 3,
    overflow: 'visible',
    position: 'relative',
  },
  topProgressBar: { height: '100%', borderRadius: 3 },
  milestoneDiamond: {
    position: 'absolute',
    top: -2,
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    transform: [{ rotate: '45deg' }, { translateX: -5 }],
  },
  milestoneDiamondActive: {
    backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  progressGlowTip: {
    position: 'absolute',
    top: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    transform: [{ translateX: -6 }],
  },

  scrollContent: { paddingBottom: 40 },

  // ── Section banner (active)
  sectionBanner: {
    marginHorizontal: 12, marginTop: 24, marginBottom: 8,
    borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: BORDER, position: 'relative',
  },
  sectionAccent: { position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, borderTopLeftRadius: 18, borderBottomLeftRadius: 18 },
  sectionBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionBadgeText: { fontSize: 15, fontWeight: '600' },
  sectionBannerContent: { padding: 18, paddingLeft: 20, gap: 4 },
  sectionNumber: { fontSize: 9, fontWeight: '700', letterSpacing: 2.5 },
  sectionTitle: { fontSize: 24, fontWeight: '200', letterSpacing: -0.3, color: TEXT },
  sectionSubtitle: { fontSize: 11, fontWeight: '300', color: DIM, marginBottom: 6 },
  sectionProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  sectionProgressTrack: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'visible', position: 'relative' },
  sectionProgressFill: { height: '100%', borderRadius: 3, position: 'absolute', left: 0, top: 0 },
  sectionProgressTip: {
    position: 'absolute',
    top: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    transform: [{ translateX: -5 }],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  sectionProgressLabel: { fontSize: 12, fontWeight: '500' },

  // ── Locked section card
  lockedSectionWrap: {
    alignItems: 'center', marginTop: 36, marginBottom: 20, paddingHorizontal: 12,
  },
  upNextPill: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 18, paddingVertical: 6, marginBottom: -14, zIndex: 1,
  },
  upNextText: { fontSize: 9, fontWeight: '700', letterSpacing: 2.5 },
  lockedSectionCard: {
    width: '100%', borderRadius: 22, overflow: 'hidden',
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 6,
  },
  lockedTopLine: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  lockIconWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  lockGlow: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  lockCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedSectionTitle: { fontSize: 11, fontWeight: '300', color: MUTED, letterSpacing: 0.5 },
  lockedSectionName: { fontSize: 26, fontWeight: '200', letterSpacing: -0.3, marginTop: 2 },
  lockedSectionDesc: { fontSize: 12, fontWeight: '300', color: MUTED, textAlign: 'center', lineHeight: 18, marginTop: 4, maxWidth: 280 },
  lockedSectionMeta: { fontSize: 10, fontWeight: '400', color: MUTED, letterSpacing: 0.5, marginTop: 10, opacity: 0.5 },

  // ── Unit header
  unitHeader: { flexDirection: 'row', alignItems: 'center', gap: 0, paddingHorizontal: 20, marginTop: 24, marginBottom: 8 },
  unitLineWrap: { flex: 1, height: 1 },
  unitGradientLine: { flex: 1, height: 1 },
  unitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  unitHeaderTitle: { fontSize: 12, fontWeight: '400', color: DIM, letterSpacing: 0.2 },
  unitHeaderSub: { fontSize: 9, fontWeight: '300', color: MUTED },

  // ── Lesson path
  lessonPath: { paddingVertical: 8 },
  lessonSlot: { height: 110, position: 'relative' },

  // ── Connector line
  connectorWrap: {
    alignSelf: 'center',
    marginTop: 2,
    width: 20,
    height: 36,
  },

  // ── Lesson node
  lessonNodeWrap: { alignItems: 'center', width: NODE_SIZE + 24, position: 'relative' },
  completedGlow: {
    position: 'absolute',
    top: (NODE_SIZE - NODE_SIZE - 12) / 2,
    alignSelf: 'center',
  },
  lessonPulseRing: {
    position: 'absolute',
    borderWidth: 2,
  },
  lessonCircle: {
    width: NODE_SIZE, height: NODE_SIZE, borderRadius: NODE_SIZE / 2,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  lessonCircleLocked: { borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.02)' },
  sparkleDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  lessonLabel: { marginTop: 6, fontSize: 9, fontWeight: '300', color: DIM, textAlign: 'center', maxWidth: NODE_SIZE + 34, letterSpacing: 0.2 },
  lessonStartBadge: {
    marginTop: 5,
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  lessonStartText: { fontSize: 9, fontWeight: '800', letterSpacing: 2, color: '#0d0d0d' },

  // ── Reward chest
  rewardChestWrap: { alignItems: 'center', paddingVertical: 6, gap: 6 },
  rewardDivider: { width: 40, height: 1, borderRadius: 0.5 },
  rewardChestInner: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  rewardGlow: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  rewardChestCircle: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 1.5, backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  rewardChestLocked: { borderColor: 'rgba(255,255,255,0.06)', opacity: 0.3 },
  rewardChestText: { fontSize: 10, fontWeight: '400', color: MUTED, letterSpacing: 0.5 },

  // ── Detail sheet
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'flex-end',
    paddingBottom: 32, paddingHorizontal: 16, zIndex: 100,
  },
  detailSheet: {
    width: '100%', backgroundColor: '#141414', borderRadius: 26,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center',
    paddingVertical: 28, paddingHorizontal: 24, gap: 10, overflow: 'hidden',
  },
  detailAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  detailAccentGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 40, opacity: 0.6 },
  detailIconOuter: { alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  detailIconOuterRing: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
  },
  detailIconWrap: {
    width: 64, height: 64, borderRadius: 32, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  detailTitle: { fontSize: 24, fontWeight: '300', letterSpacing: -0.3 },
  detailDesc: { fontSize: 13, fontWeight: '300', color: DIM, textAlign: 'center', lineHeight: 20 },
  detailXpBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginTop: 2,
  },
  detailXpText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  detailStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  detailStatusText: { fontSize: 12, fontWeight: '400', letterSpacing: 0.3 },
  detailCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 6,
  },
  detailCtaText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.5, color: '#0d0d0d' },
  detailDismiss: { fontSize: 10, fontWeight: '300', color: MUTED, marginTop: 10 },
});
