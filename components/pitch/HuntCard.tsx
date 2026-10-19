import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import { GOLD, GREEN, kit, SECONDARY, SectionHeader, StatusChip } from '@/components/drop/cardKit';
import { Countdown } from '@/components/social/Countdown';
import { useDropPrototype } from '@/lib/dev/dropPrototype';
import { HUNT_CLUES, huntStage, stepsToKm } from '@/lib/pitch';

/** Distance already covered earlier in the hunt week, before today. */
const EARLIER_KM = 1.5;

/** The hunt closes Sunday night. */
function huntEndsIso(now: Date = new Date()): string {
    const d = new Date(now);
    const toSunday = (7 - d.getDay()) % 7;
    d.setDate(d.getDate() + toSunday);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
}

/**
 * HUNT MODE — "Something has landed in London." Every kilometre you move this
 * week reveals more: what it is, where it is, how to claim it. Clue rows are
 * THIS WEEK's row grammar; the reveal replaces the row title as it opens.
 */
export function HuntCard() {
    const drop = useDropPrototype();
    const endsAt = useMemo(() => huntEndsIso(), []);
    const km = EARLIER_KM + stepsToKm(drop.steps);
    const stage = huntStage(km);
    const last = HUNT_CLUES[HUNT_CLUES.length - 1];

    return (
        <View>
            <SectionHeader label="Hunt" />
            <View style={[kit.card, stage.open === HUNT_CLUES.length && kit.cardLit]}>
                <View style={kit.header}>
                    <StatusChip icon="compass-outline" text={`${stage.open} of ${HUNT_CLUES.length} clues`} tone={stage.open > 0 ? 'gold' : 'muted'} />
                    <View style={kit.points}>
                        <Text style={kit.pointsValue}>{km.toFixed(1)}</Text>
                        <Text style={kit.pointsLabel}>of {last.atKm} km</Text>
                    </View>
                </View>

                <View style={kit.titleBlock}>
                    <View style={kit.titleRow}>
                        <Ionicons name="search-outline" size={18} color={GOLD} />
                        <Text style={kit.title} numberOfLines={1}>Something has landed in London</Text>
                    </View>
                    <Text style={kit.goal}>Every kilometre you move this week reveals more.</Text>
                </View>

                <View>
                    {HUNT_CLUES.map((c, i) => {
                        const open = i < stage.open;
                        return (
                            <View key={c.label} style={[kit.row, i < HUNT_CLUES.length - 1 && kit.rowDivider]}>
                                <View style={[kit.rowIcon, open && kit.rowIconOn]}>
                                    <Ionicons name={open ? 'eye-outline' : 'lock-closed-outline'} size={14} color={open ? GOLD : SECONDARY} />
                                </View>
                                <Text style={[kit.rowTitle, !open && { color: SECONDARY }]} numberOfLines={1}>
                                    {open ? c.reveal : c.label}
                                </Text>
                                <Text style={kit.rowReadout}>{open ? c.label : `at ${c.atKm} km`}</Text>
                            </View>
                        );
                    })}
                </View>

                <View style={kit.track}>
                    <View style={[kit.fill, { width: `${stage.pct * 100}%` }]} />
                </View>

                {stage.next ? (
                    <View style={kit.footer}>
                        <Text style={kit.footerGold}>{(stage.next.atKm - km).toFixed(1)} km to the next clue</Text>
                        <Countdown endsAt={endsAt} iconName="time-outline" iconColor={SECONDARY} style={kit.timeText} />
                    </View>
                ) : (
                    <View style={kit.outcomeBlock}>
                        <Ionicons name="checkmark-circle" size={15} color={GREEN} />
                        <Text style={kit.outcomeText}>All three clues open. It’s a race to the pin on Saturday.</Text>
                    </View>
                )}
            </View>
        </View>
    );
}
