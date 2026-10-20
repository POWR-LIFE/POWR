import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { BORDER, CARD_BG, GOLD, kit, MUTED, SECONDARY, SectionHeader, TEXT } from '@/components/drop/cardKit';
import { fontFamily } from '@/constants/tokens';
import { useDropPrototype } from '@/lib/dev/dropPrototype';
import { doorProgress, stepsToKm } from '@/lib/pitch';

interface Door {
    id: string;
    brand: string;
    /** Short enough to read through a half-open door: "£15" over "credit". */
    value: string;
    unit: string;
    need: string;
    done: number;
    of: number;
}

const DOOR_H = 170;

/**
 * LIVE DOORS — the Rewards tab as doors you work toward instead of a shop.
 * Pick one; as you move it opens and the reward behind it shows through the
 * gap. HUEL, REP and MAJIC are real partners (the pitch's Nike and FORM are
 * not); POWR Black is the status door.
 */
export function RewardDoors() {
    const drop = useDropPrototype();
    const [picked, setPicked] = useState('huel');

    const doors: Door[] = [
        { id: 'huel', brand: 'HUEL', value: '£15', unit: 'credit', need: 'Walk 40 km this month', done: 18 + stepsToKm(drop.steps), of: 40 },
        { id: 'rep', brand: 'REP', value: '25%', unit: 'off', need: '10 gym visits this month', done: 4 + (drop.minutes >= 30 ? 1 : 0), of: 10 },
        { id: 'majic', brand: 'MAJIC', value: '20%', unit: 'off', need: '12 workouts this month', done: 7 + Math.floor(drop.minutes / 20), of: 12 },
        { id: 'black', brand: 'POWR BLACK', value: 'VIP', unit: 'nights', need: 'Reach level 10', done: 1, of: 10 },
    ];

    return (
        <View style={{ marginBottom: 8 }}>
            <SectionHeader label="Doors" />
            <Text style={styles.intro}>Pick the door you’re working toward. Every move opens it a little more.</Text>
            <View style={styles.grid}>
                {doors.map(d => (
                    <DoorTile
                        key={d.id}
                        door={d}
                        picked={picked === d.id}
                        onPick={() => {
                            Haptics.selectionAsync().catch(() => {});
                            setPicked(d.id);
                        }}
                    />
                ))}
            </View>
        </View>
    );
}

function DoorTile({ door, picked, onPick }: { door: Door; picked: boolean; onPick: () => void }) {
    const p = doorProgress(door.done, door.of);
    const [w, setW] = useState(0);
    const open = useSharedValue(0);
    useEffect(() => {
        open.value = withTiming(p, { duration: 900, easing: Easing.out(Easing.cubic) });
    }, [p, open]);

    // Each half slides out by up to 85% of its own width.
    const leftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -open.value * (w / 2) * 0.85 }] }));
    const rightStyle = useAnimatedStyle(() => ({ transform: [{ translateX: open.value * (w / 2) * 0.85 }] }));

    return (
        <Pressable
            onPress={onPick}
            accessibilityRole="button"
            accessibilityLabel={`${door.brand} door`}
            accessibilityState={{ selected: picked }}
            style={[styles.tile, picked && styles.tilePicked]}
        >
            <Text style={styles.brand} numberOfLines={1}>{door.brand}</Text>
            <View style={styles.door} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
                {/* Behind the door */}
                <View style={styles.behind}>
                    <Text style={styles.behindValue}>{door.value}</Text>
                    <Text style={styles.behindUnit}>{door.unit}</Text>
                </View>
                <Animated.View style={[styles.half, styles.halfLeft, leftStyle]}>
                    <View style={[styles.handle, { right: 8 }]} />
                </Animated.View>
                <Animated.View style={[styles.half, styles.halfRight, rightStyle]}>
                    <View style={[styles.handle, { left: 8 }]} />
                </Animated.View>
            </View>

            <View style={{ gap: 6 }}>
                <Text style={styles.need} numberOfLines={2}>{door.need}</Text>
                <View style={kit.track}>
                    <View style={[kit.fill, { width: `${p * 100}%` }]} />
                </View>
                <Text style={styles.pct}>
                    {picked ? <Text style={{ color: GOLD }}>Working toward  ·  </Text> : null}
                    {Math.round(p * 100)}%
                </Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    intro: { fontFamily: fontFamily.light, fontSize: 12.5, color: SECONDARY, paddingHorizontal: 14, marginBottom: 12, lineHeight: 17 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: {
        width: '48.5%',
        backgroundColor: CARD_BG,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: BORDER,
        padding: 10,
        gap: 10,
    },
    tilePicked: { borderColor: 'rgba(232,210,0,0.45)' },
    door: { height: DOOR_H, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0A0A0A' },
    behind: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(232,210,0,0.08)',
        paddingHorizontal: 8,
    },
    behindValue: { fontFamily: fontFamily.extraLight, fontSize: 26, color: GOLD, textAlign: 'center', letterSpacing: -0.5 },
    behindUnit: { fontFamily: fontFamily.medium, fontSize: 8.5, letterSpacing: 1.8, color: SECONDARY, marginTop: 2, textTransform: 'uppercase' },
    brand: { fontFamily: fontFamily.semiBold, fontSize: 10, letterSpacing: 1.6, color: TEXT, paddingHorizontal: 2 },
    half: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: '50%',
        backgroundColor: '#1A1A1A',
        borderColor: '#2A2A2A',
        borderWidth: StyleSheet.hairlineWidth,
    },
    halfLeft: { left: 0 },
    halfRight: { right: 0 },
    handle: { position: 'absolute', top: DOOR_H / 2 - 14, width: 2, height: 28, borderRadius: 1, backgroundColor: '#3A3A3A' },
    need: { fontFamily: fontFamily.regular, fontSize: 11.5, lineHeight: 15, color: TEXT, minHeight: 30 },
    pct: { fontFamily: fontFamily.regular, fontSize: 10.5, color: MUTED },
});
