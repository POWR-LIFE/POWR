import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

const GOLD = '#E8D200';

/**
 * A non-interactive mock of the OS permission surface the user is about to
 * see, with the option we want them to pick ringed in gold and a pointing
 * hand. Shown on the onboarding priming screens so the real dialog is never
 * a surprise — the user already knows which button to press and why.
 *
 * Deliberately styled like the OS (light card, system font), not like POWR:
 * it has to read as "this is the dialog that's coming", not as app UI.
 */

export type PermissionMockKind =
    | 'location-foreground'
    | 'location-background'
    | 'notifications';

interface MockOption {
    label: string;
    highlighted?: boolean;
    /** Render a settings-style radio circle before the label (Android list). */
    radio?: boolean;
}

interface MockSpec {
    title: string;
    message?: string;
    /** Small blue section header above the options (Android settings list). */
    sectionHeader?: string;
    /** 'alert' = centred dialog rows; 'radio-list' = left-aligned settings rows. */
    layout: 'alert' | 'radio-list';
    /** Android 12+ location dialog shows a Precise/Approximate selector. */
    accuracyChips?: boolean;
    /** iOS location dialog shows a "Precise: On" indicator over its map. */
    preciseBadge?: boolean;
    options: MockOption[];
}

function specFor(kind: PermissionMockKind): MockSpec {
    const ios = Platform.OS === 'ios';
    switch (kind) {
        case 'location-foreground':
            return ios
                ? {
                      title: 'Allow “POWR” to use your location?',
                      message:
                          'POWR uses your location to verify your sessions and surface rewards near you.',
                      layout: 'alert',
                      preciseBadge: true,
                      options: [
                          { label: 'Allow Once' },
                          { label: 'Allow While Using App', highlighted: true },
                          { label: 'Don’t Allow' },
                      ],
                  }
                : {
                      title: 'Allow POWR to access this device’s location?',
                      layout: 'alert',
                      accuracyChips: true,
                      options: [
                          { label: 'While using the app', highlighted: true },
                          { label: 'Only this time' },
                          { label: 'Don’t allow' },
                      ],
                  };
        case 'location-background':
            return ios
                ? {
                      title: 'Allow “POWR” to also use your location even when you are not using the app?',
                      message: 'Automatic check-ins only work with “Always” access.',
                      layout: 'alert',
                      options: [
                          { label: 'Keep Only While Using' },
                          { label: 'Change to Always Allow', highlighted: true },
                      ],
                  }
                : {
                      title: 'Location permission',
                      sectionHeader: 'Location access for this app',
                      layout: 'radio-list',
                      options: [
                          { label: 'Allow all the time', highlighted: true, radio: true },
                          { label: 'Allow only while using the app', radio: true },
                          { label: 'Ask every time', radio: true },
                          { label: 'Don’t allow', radio: true },
                      ],
                  };
        case 'notifications':
            return ios
                ? {
                      title: '“POWR” Would Like to Send You Notifications',
                      message: 'Notifications may include alerts, sounds and icon badges.',
                      layout: 'alert',
                      options: [
                          { label: 'Allow', highlighted: true },
                          { label: 'Don’t Allow' },
                      ],
                  }
                : {
                      title: 'Allow POWR to send you notifications?',
                      layout: 'alert',
                      options: [
                          { label: 'Allow', highlighted: true },
                          { label: 'Don’t allow' },
                      ],
                  };
    }
}

function PointingHand() {
    const nudge = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(nudge, {
                    toValue: 1,
                    duration: 460,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(nudge, {
                    toValue: 0,
                    duration: 460,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
            ]),
        );
        loop.start();
        return () => loop.stop();
    }, [nudge]);

    const translateX = nudge.interpolate({ inputRange: [0, 1], outputRange: [0, -7] });

    return (
        <Animated.View style={[styles.hand, { transform: [{ translateX }] }]} pointerEvents="none">
            <MaterialCommunityIcons name="hand-pointing-left" size={36} color={GOLD} />
        </Animated.View>
    );
}

function Radio({ selected }: { selected: boolean }) {
    return (
        <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
            {selected && <View style={styles.radioInner} />}
        </View>
    );
}

export default function PermissionPrimeMock({ kind }: { kind: PermissionMockKind }) {
    const spec = specFor(kind);
    const alert = spec.layout === 'alert';

    return (
        <View style={styles.wrap}>
            <View style={[styles.card, alert ? styles.cardAlert : styles.cardList]}>
                <Text style={[styles.title, alert && styles.titleCentered]}>{spec.title}</Text>
                {spec.message ? <Text style={styles.message}>{spec.message}</Text> : null}
                {spec.sectionHeader ? (
                    <Text style={styles.sectionHeader}>{spec.sectionHeader}</Text>
                ) : null}
                {spec.accuracyChips ? (
                    <View style={styles.chipRow}>
                        <View style={[styles.chip, styles.chipSelected]}>
                            <Text style={styles.chipLabelSelected}>Precise</Text>
                        </View>
                        <View style={styles.chip}>
                            <Text style={styles.chipLabel}>Approximate</Text>
                        </View>
                    </View>
                ) : null}
                {spec.preciseBadge ? (
                    <View style={styles.precisePill}>
                        <MaterialCommunityIcons name="navigation-variant" size={11} color={IOS_BLUE} />
                        <Text style={styles.precisePillLabel}>Precise: On</Text>
                    </View>
                ) : null}

                <View style={alert ? styles.alertOptions : undefined}>
                    {spec.options.map((opt) => (
                        <View
                            key={opt.label}
                            style={[
                                styles.row,
                                alert ? styles.rowAlert : styles.rowList,
                                opt.highlighted && styles.rowHighlighted,
                            ]}
                        >
                            {opt.radio ? <Radio selected={!!opt.highlighted} /> : null}
                            <Text
                                style={[
                                    alert ? styles.rowAlertLabel : styles.rowListLabel,
                                    alert && opt.highlighted && styles.rowAlertLabelBold,
                                ]}
                                numberOfLines={1}
                            >
                                {opt.label}
                            </Text>
                            {opt.highlighted && <PointingHand />}
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}

const IOS_BLUE = '#007AFF';
const ANDROID_BLUE = '#0B57D0';
const ACTION_BLUE = Platform.OS === 'ios' ? IOS_BLUE : ANDROID_BLUE;

const styles = StyleSheet.create({
    wrap: {
        alignItems: 'center',
        alignSelf: 'stretch',
        // Leave room for the hand overhanging the card's right edge.
        paddingHorizontal: 26,
    },
    card: {
        width: '100%',
        maxWidth: 300,
        backgroundColor: '#F7F8FA',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.28)',
        overflow: 'visible',
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
        elevation: 12,
    },
    cardAlert: {
        borderRadius: Platform.OS === 'ios' ? 16 : 24,
        paddingTop: 18,
        paddingBottom: 10,
        paddingHorizontal: 14,
    },
    cardList: {
        borderRadius: 18,
        paddingVertical: 16,
        paddingHorizontal: 14,
    },
    title: {
        color: '#111114',
        fontSize: 14.5,
        fontWeight: '600',
        lineHeight: 19,
    },
    titleCentered: {
        textAlign: 'center',
        paddingHorizontal: 6,
    },
    message: {
        color: 'rgba(20,20,25,0.62)',
        fontSize: 11.5,
        lineHeight: 15,
        textAlign: 'center',
        marginTop: 5,
        paddingHorizontal: 4,
    },
    sectionHeader: {
        color: ANDROID_BLUE,
        fontSize: 11,
        fontWeight: '600',
        marginTop: 14,
        marginBottom: 2,
    },
    alertOptions: {
        marginTop: 12,
    },
    chipRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
        marginTop: 12,
    },
    chip: {
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: 'rgba(20,20,25,0.18)',
        paddingHorizontal: 12,
        paddingVertical: 5,
    },
    chipSelected: {
        borderColor: ANDROID_BLUE,
        backgroundColor: 'rgba(11,87,208,0.08)',
    },
    chipLabel: {
        color: 'rgba(20,20,25,0.55)',
        fontSize: 11.5,
    },
    chipLabelSelected: {
        color: ANDROID_BLUE,
        fontSize: 11.5,
        fontWeight: '600',
    },
    precisePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'center',
        backgroundColor: 'rgba(0,122,255,0.10)',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginTop: 10,
    },
    precisePillLabel: {
        color: IOS_BLUE,
        fontSize: 11.5,
        fontWeight: '600',
    },
    row: {
        position: 'relative',
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    rowAlert: {
        justifyContent: 'center',
        paddingVertical: 10,
        marginTop: 2,
    },
    rowList: {
        paddingVertical: 9,
        paddingHorizontal: 6,
        gap: 12,
    },
    rowHighlighted: {
        borderColor: GOLD,
        backgroundColor: 'rgba(232,210,0,0.10)',
    },
    rowAlertLabel: {
        color: ACTION_BLUE,
        fontSize: 15,
        fontWeight: '400',
    },
    rowAlertLabelBold: {
        fontWeight: '700',
    },
    rowListLabel: {
        color: '#1B1B1F',
        fontSize: 13.5,
        flexShrink: 1,
    },
    hand: {
        position: 'absolute',
        right: -20,
        alignSelf: 'center',
    },
    radioOuter: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: 'rgba(20,20,25,0.4)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioOuterSelected: {
        borderColor: ANDROID_BLUE,
    },
    radioInner: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: ANDROID_BLUE,
    },
});
