import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EventLockup } from '@/components/events/EventLockup';
import type { LiveEvent } from '@/lib/api/liveEvents';
import { eventStatusLine } from '@/components/league/EventHeaderCard';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';

/**
 * The one-line identity strip above the leaderboard segment. The full hero
 * (media, dates, venue, JOIN) lives on the EVENT segment; once scoring is
 * live the board is the job, and this row only has to say WHICH event and
 * where it's up to before the ranks start.
 */
export function EventBoardHeader({ event }: { event: LiveEvent }) {
    return (
        <View style={styles.row}>
            <EventLockup event={event} />
            <View style={styles.right}>
                {!event.logo_only && (
                    <Text style={styles.name} numberOfLines={1}>{event.name}</Text>
                )}
                <Text style={styles.status} numberOfLines={1}>{eventStatusLine(event)}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        marginHorizontal: 18,
        marginTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    right: { flex: 1, alignItems: 'flex-end', gap: 3 },
    name: { fontSize: 15, fontWeight: '300', color: TEXT, letterSpacing: -0.2 },
    status: { fontSize: 10, fontWeight: '400', color: GOLD, textAlign: 'right' },
});
