import React, { useState } from 'react';
import {
    ScrollView,
    StyleSheet,
    useWindowDimensions,
    View,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';

import { LiveEventCard, showsOnHome } from '@/components/home/LiveEventCard';
import { useLiveEvents } from '@/hooks/useLiveEvents';

const GOLD = '#E8D200';

// Home's content column is inset 10 each side; the rail bleeds back out to the
// screen edge so the next card can peek in from beyond the column.
const HOME_GUTTER = 10;
const GAP = 10;
/** How much of the next card shows — enough to read as "there's another",
 *  not enough to read as a broken layout. */
const PEEK = 26;

/**
 * Home's live-event slot. One event renders exactly the card it always was;
 * two or more become a snapping rail, most relevant first (useLiveEvents
 * orders it), with the next card peeking in and a quiet page marker beneath.
 */
export function LiveEventCarousel() {
    const { width } = useWindowDimensions();
    const { events } = useLiveEvents();
    const [index, setIndex] = useState(0);

    const visible = events.filter(showsOnHome);
    if (visible.length === 0) return null;
    if (visible.length === 1) return <LiveEventCard event={visible[0]} />;

    const cardW = width - HOME_GUTTER * 2 - PEEK;
    const stride = cardW + GAP;

    // Tracked while scrolling, not at rest: the incoming card's video mounts as
    // it crosses halfway instead of popping in after the snap settles.
    const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const next = Math.max(
            0,
            Math.min(visible.length - 1, Math.round(e.nativeEvent.contentOffset.x / stride)),
        );
        if (next !== index) setIndex(next);
    };

    return (
        <View style={styles.wrap}>
            <ScrollView
                horizontal
                style={styles.rail}
                contentContainerStyle={styles.railContent}
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={stride}
                snapToAlignment="start"
                disableIntervalMomentum
                onScroll={onScroll}
                scrollEventThrottle={32}
            >
                {visible.map((event, i) => (
                    <View key={event.id} style={{ width: cardW }}>
                        <LiveEventCard event={event} active={i === index} />
                    </View>
                ))}
            </ScrollView>

            <View style={styles.marks} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {visible.map((event, i) => (
                    <View key={event.id} style={[styles.mark, i === index && styles.markActive]} />
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: 10 },
    rail: { marginHorizontal: -HOME_GUTTER },
    railContent: { paddingHorizontal: HOME_GUTTER, gap: GAP },
    marks: { flexDirection: 'row', justifyContent: 'center', gap: 5 },
    mark: { width: 5, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.18)' },
    markActive: { width: 16, backgroundColor: GOLD },
});
