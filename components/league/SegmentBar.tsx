import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const GOLD = '#E8D200';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';

const SCREEN_W = Dimensions.get('window').width;

export type SegmentItem<T extends string> = { key: T; label: string };

/**
 * The League tab's one switch: equal-width labels over a single sliding gold
 * indicator. Event mode (LEADERBOARD | EVENT) and the between-events page
 * (LEADERBOARD | EVENTS) both use it, so the tab never grows a second
 * vocabulary of tabs.
 */
export function SegmentBar<T extends string>({
    items,
    value,
    onChange,
}: {
    items: SegmentItem<T>[];
    value: T;
    onChange: (key: T) => void;
}) {
    const tabW = SCREEN_W / Math.max(1, items.length);
    const index = Math.max(0, items.findIndex(i => i.key === value));
    const x = useSharedValue(index * tabW);
    useEffect(() => {
        x.value = withTiming(index * tabW, { duration: 220 });
    }, [index, tabW, x]);
    const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

    return (
        <View style={styles.bar}>
            {items.map(item => {
                const selected = item.key === value;
                return (
                    <Pressable
                        key={item.key}
                        style={styles.tab}
                        onPress={() => {
                            if (selected) return;
                            void Haptics.selectionAsync();
                            onChange(item.key);
                        }}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                    >
                        <Text style={[styles.label, selected && styles.labelActive]}>{item.label}</Text>
                    </Pressable>
                );
            })}
            <Animated.View style={[styles.indicator, { width: tabW }, indicator]} />
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
        position: 'relative',
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
    },
    label: {
        fontSize: 9,
        fontWeight: '500',
        letterSpacing: 1.5,
        color: MUTED,
        textTransform: 'uppercase',
    },
    labelActive: {
        color: TEXT,
        fontWeight: '500',
    },
    indicator: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: 1.5,
        backgroundColor: GOLD,
        borderRadius: 1,
    },
});
