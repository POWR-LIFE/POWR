import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    FlatList,
    Modal,
    PanResponder,
    Pressable,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { rankLabel } from '@/components/events/EventPrizeList';
import type { LiveEventPrize } from '@/lib/api/liveEvents';
import { prizeArtUri } from '@/lib/storageImage';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.5)';

/** Vertical travel that reads as "let go" rather than "wobbled". */
const DISMISS_DISTANCE = 90;
/** Or a flick — the distance can be short if the intent is unmistakable. */
const DISMISS_VELOCITY = 0.9;

/**
 * The prize spotlight — what a tap on a gallery card opens.
 *
 * Deliberately not a sheet and not a dialog: the screen drops to near-black,
 * the artwork scales up into the middle, and the ordinal + label sit beneath
 * it. That is the whole UI. Swipe sideways to move between prizes, pull down
 * (or tap the dark) to leave. The restraint is the premium — a lightbox that
 * does anything else stops feeling like one.
 *
 * Artwork uses `prizeArtUri` — the same transform the gallery card already
 * loaded — so the open is a cache hit and the picture is simply *there* when
 * the scale-in lands, rather than fading in a beat later.
 *
 * Presentation is owned here (animationType="none"): the scrim fades and the
 * content scales; letting <Modal> animate would slide the scrim as a block.
 * The pull-down lives on the artwork page and only claims a clearly VERTICAL
 * gesture, so the horizontal pager underneath still pages.
 */
export function EventPrizeViewer({
    prizes,
    initialIndex,
    visible,
    onClose,
    onShare,
}: {
    prizes: LiveEventPrize[];
    /** Which prize opens first — the one that was tapped. */
    initialIndex: number;
    visible: boolean;
    onClose: () => void;
    /**
     * Share the prize on screen. Fires AFTER the spotlight has animated away
     * (and `onClose` has run) — routing while an RN Modal is still mounted
     * leaves the router's modal presented underneath it on iOS. Omit to hide
     * the button.
     */
    onShare?: (index: number) => void;
}) {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [index, setIndex] = useState(initialIndex);
    const listRef = useRef<FlatList<LiveEventPrize>>(null);
    // Real aspect ratio (w/h) of each artwork once expo-image reports it, so
    // the frame is cut to the picture — a poster gets a portrait frame, a
    // product shot a square — and nothing is ever cropped to fit a shape we
    // guessed. Until it lands the frame is square and the image is CONTAINED,
    // so the worst case is a beat of letterboxing, never a missing edge.
    const [aspects, setAspects] = useState<Record<number, number>>({});

    // Presentation: scrim opacity + content scale/opacity, and the pull-down.
    const scrim = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(0.94)).current;
    const dragY = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!visible) return;
        setIndex(initialIndex);
        dragY.setValue(0);
        scale.setValue(0.94);
        scrim.setValue(0);
        Animated.parallel([
            Animated.timing(scrim, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.spring(scale, { toValue: 1, damping: 18, stiffness: 220, mass: 0.8, useNativeDriver: true }),
        ]).start();
    }, [visible, initialIndex, scrim, scale, dragY]);

    const dismiss = (after?: () => void) => {
        Animated.parallel([
            Animated.timing(scrim, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            Animated.timing(scale, { toValue: 0.96, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]).start(() => {
            onClose();
            after?.();
        });
    };

    // Hand off to the share screen once the lightbox is gone — the index is
    // read at tap time, so paging after the tap can't change what's shared.
    const share = () => {
        if (!onShare) return;
        const which = index;
        Haptics.selectionAsync();
        dismiss(() => onShare(which));
    };

    // Pull-down on the artwork. Claim only a decisively vertical, downward
    // move so the pager keeps horizontal swipes and a plain tap stays a tap.
    const pan = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
            onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
            onPanResponderMove: (_, g) => dragY.setValue(Math.max(0, g.dy)),
            onPanResponderRelease: (_, g) => {
                if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
                    Animated.parallel([
                        Animated.timing(dragY, { toValue: height, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
                        Animated.timing(scrim, { toValue: 0, duration: 200, useNativeDriver: true }),
                    ]).start(() => onClose());
                } else {
                    Animated.spring(dragY, { toValue: 0, damping: 20, stiffness: 240, useNativeDriver: true }).start();
                }
            },
            onPanResponderTerminate: () => {
                Animated.spring(dragY, { toValue: 0, damping: 20, stiffness: 240, useNativeDriver: true }).start();
            },
        }),
    ).current;

    // The scrim thins as the artwork is pulled away, so the pull reads as
    // "letting the page back through" rather than dragging a card on black.
    const scrimOpacity = Animated.multiply(
        scrim,
        dragY.interpolate({ inputRange: [0, height * 0.5], outputRange: [1, 0.35], extrapolate: 'clamp' }),
    );

    // The frame's ceiling: nearly the full width, and enough height that a
    // tall poster still leaves room for the ordinal, label and share button
    // beneath it.
    const maxW = width - 48;
    const maxH = height * 0.58;
    const frameFor = (rank: number) => {
        const a = aspects[rank] ?? 1;
        let h = Math.min(maxH, maxW / a);
        let w = h * a;
        if (w > maxW) { w = maxW; h = w / a; }
        return { width: Math.round(w), height: Math.round(h) };
    };

    if (prizes.length === 0) return null;

    return (
        <Modal visible={visible} transparent statusBarTranslucent animationType="none" onRequestClose={() => dismiss()}>
            <View style={styles.container}>
                <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]} />
                <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityLabel="Close" />

                <Animated.View
                    style={[styles.content, { opacity: scrim, transform: [{ scale }, { translateY: dragY }] }]}
                    pointerEvents="box-none"
                >
                    <FlatList
                        ref={listRef}
                        data={prizes}
                        style={styles.pager}
                        horizontal
                        pagingEnabled
                        initialScrollIndex={initialIndex}
                        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
                        showsHorizontalScrollIndicator={false}
                        keyExtractor={(p) => String(p.rank)}
                        onMomentumScrollEnd={(e) => {
                            const next = Math.round(e.nativeEvent.contentOffset.x / width);
                            if (next !== index) {
                                setIndex(next);
                                Haptics.selectionAsync();
                            }
                        }}
                        renderItem={({ item }) => {
                            const uri = prizeArtUri(item.image_url);
                            return (
                                <View style={[styles.page, { width, height }]} {...pan.panHandlers}>
                                    <View style={[styles.art, frameFor(item.rank)]}>
                                        {uri ? (
                                            <ExpoImage
                                                source={{ uri }}
                                                style={StyleSheet.absoluteFill}
                                                contentFit="contain"
                                                transition={120}
                                                cachePolicy="memory-disk"
                                                accessibilityIgnoresInvertColors
                                                onLoad={(e) => {
                                                    const { width: w, height: h } = e.source;
                                                    if (w > 0 && h > 0) {
                                                        setAspects((prev) =>
                                                            prev[item.rank] ? prev : { ...prev, [item.rank]: w / h },
                                                        );
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <Text style={styles.monogram}>{item.rank}</Text>
                                        )}
                                    </View>
                                    <Text style={styles.rank}>{rankLabel(item.rank)}</Text>
                                    <Text style={styles.label}>{item.label}</Text>
                                    {onShare && (
                                        <Pressable
                                            onPress={share}
                                            hitSlop={8}
                                            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.75 }]}
                                            accessibilityRole="button"
                                            accessibilityLabel={`Share ${rankLabel(item.rank)} prize`}
                                        >
                                            <Ionicons name="paper-plane" size={14} color="#0a0a0a" />
                                            <Text style={styles.shareText}>SHARE</Text>
                                        </Pressable>
                                    )}
                                </View>
                            );
                        }}
                    />

                    {prizes.length > 1 && (
                        <View style={styles.dots} pointerEvents="none">
                            {prizes.map((p, i) => (
                                <View key={p.rank} style={[styles.dot, i === index && styles.dotActive]} />
                            ))}
                        </View>
                    )}
                </Animated.View>

                <Animated.View style={[styles.closeWrap, { top: insets.top + 10, opacity: scrim }]}>
                    <Pressable
                        onPress={() => dismiss()}
                        hitSlop={12}
                        style={({ pressed }) => [styles.close, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                    >
                        <Ionicons name="close" size={18} color={TEXT} />
                    </Pressable>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,6,6,0.96)' },
    content: { flex: 1 },
    pager: { flex: 1 },
    // A horizontal pager gives its pages no height of their own — each page
    // takes the window's, and centres its artwork a touch above true centre
    // (the optical middle once the label sits beneath the picture).
    page: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 48 },
    art: {
        borderRadius: 24,
        overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.28)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    monogram: { fontSize: 120, fontWeight: '100', color: GOLD, letterSpacing: -4 },
    rank: { marginTop: 26, fontSize: 10, fontWeight: '800', color: GOLD, letterSpacing: 3, opacity: 0.85 },
    label: {
        marginTop: 8,
        fontSize: 22,
        fontWeight: '200',
        color: TEXT,
        textAlign: 'center',
        lineHeight: 28,
        letterSpacing: -0.3,
        maxWidth: 320,
    },
    // Solid gold, black type — the same chip language as the gallery card's
    // ordinal, so it reads on the near-black scrim without shouting.
    shareBtn: {
        marginTop: 24,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 100,
        backgroundColor: GOLD,
    },
    shareText: { fontSize: 11, fontWeight: '800', color: '#0a0a0a', letterSpacing: 2 },
    dots: {
        position: 'absolute',
        bottom: 56,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
    },
    dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: DIM, opacity: 0.4 },
    dotActive: { backgroundColor: GOLD, opacity: 1, width: 16 },
    closeWrap: { position: 'absolute', right: 16 },
    close: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
