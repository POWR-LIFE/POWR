import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, PanResponder } from 'react-native';

/**
 * Pull-down-to-dismiss + present/dismiss animation for the app's hand-rolled
 * bottom sheets.
 *
 * The app has no bottom-sheet library — every sheet is a hand-rolled RN <Modal>
 * with a decorative 40x4 handle. This makes that handle honest: spread
 * `panHandlers` onto the sheet's header and drive the sheet's translateY from
 * `dragY`. Only the header claims the gesture, so a scrolling body still scrolls.
 *
 * Extracted from two byte-identical copies (PointsBreakdownSheet,
 * LedgerFilterSheet) which shared the same flaw: they negotiated for the
 * responder on MOVE only. That leaves the gesture at the mercy of whatever else
 * is in the touch path — inside a <Modal> on the New Architecture the move-phase
 * ask is not reliably reached, so the handle did nothing. Here the header claims
 * on touch-down, again during the capture phase, and then refuses to hand the
 * responder back, which is safe precisely because sheet headers hold no
 * interactive children (a tap that never becomes a drag just springs back to 0).
 *
 * Downward only, deliberately: there is no expanded state to pull UP into, so
 * upward drags are ignored rather than rubber-banding to nothing.
 *
 * The hook owns BOTH directions of the transition (see `visible`), because the
 * two halves have to disagree: the sheet slides, the scrim fades. Leaving the
 * entrance to <Modal animationType="slide"> is what produced the "second dark
 * rectangle" on close — Modal slides its whole container, scrim included, so the
 * dimming pane rode down the screen as a visible dark block after our own
 * translateY had already carried the sheet away. Consumers pass
 * animationType="none" and render `backdropOpacity` on a scrim of their own.
 */
export function useSheetDragDismiss(onClose: () => void, visible: boolean) {
    // Full window height, so the sheet is genuinely gone rather than parked just
    // off the bottom of a tall device.
    const travel = useRef(Dimensions.get('window').height).current;

    // Start off-screen/transparent: the presenting effect below only runs after
    // the Modal's first paint, so these are the values that first frame uses.
    const dragY = useRef(new Animated.Value(travel)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    // onClose is an inline arrow in every parent, so it changes identity each
    // render while the PanResponder is created once — read it through a ref so
    // the release handler never calls a stale closure.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!visible) return;
        // Re-seed rather than trusting the last exit: an interrupted animation
        // (fast reopen, backgrounding mid-close) can leave these anywhere.
        dragY.setValue(travel);
        backdropOpacity.setValue(0);
        Animated.parallel([
            Animated.timing(dragY, {
                toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true,
            }),
            // Faster than the slide so the screen behind is already dim by the
            // time the sheet arrives, instead of catching up to it.
            Animated.timing(backdropOpacity, {
                toValue: 1, duration: 180, useNativeDriver: true,
            }),
        ]).start();
    }, [visible, dragY, backdropOpacity, travel]);

    /**
     * Slide the sheet away and fade the scrim together, THEN tell the parent,
     * THEN rearm.
     *
     * `dismiss` is also why Close doesn't feel sluggish: the delay was never the
     * Modal, it's that `onClose` sets state on the parent screen and re-renders
     * it before the sheet visually moves, so the tap looked ignored (worst in dev
     * builds). The exit runs first, on the UI thread, and the re-render happens
     * behind it. Both exits — the button and the drag — go through here, so they
     * match.
     *
     * The rearm matters because the parent keeps this component mounted across a
     * close: left at `travel`/0 the values are already correct for the next
     * open's first frame, and resetting after the parent has stopped rendering
     * the sheet is invisible.
     */
    const dismiss = () => {
        Animated.parallel([
            Animated.timing(dragY, {
                toValue: travel, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true,
            }),
            Animated.timing(backdropOpacity, {
                toValue: 0, duration: 200, useNativeDriver: true,
            }),
        ]).start(() => {
            onCloseRef.current();
            dragY.setValue(travel);
            backdropOpacity.setValue(0);
        });
    };

    const pan = useRef(
        PanResponder.create({
            // Claim on touch-down and again on capture: the header has no
            // interactive children, so there is nothing to steal the gesture from.
            onStartShouldSetPanResponder: () => true,
            onStartShouldSetPanResponderCapture: () => true,
            // Kept as a fallback for the case where a start-phase claim is declined.
            onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
            onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
            // Once the header has the gesture, keep it — an ancestor ScrollView or
            // the Modal's own host view asking politely is what killed this before.
            onPanResponderTerminationRequest: () => false,
            onShouldBlockNativeResponder: () => true,
            onPanResponderRelease: (_, g) => {
                if (g.dy > 90 || g.vy > 0.8) {
                    dismiss();
                } else {
                    Animated.spring(dragY, {
                        toValue: 0, useNativeDriver: true, bounciness: 0,
                    }).start();
                }
            },
            // A cancelled gesture (call, notification shade) must not strand the
            // sheet mid-drag.
            onPanResponderTerminate: () => {
                Animated.spring(dragY, {
                    toValue: 0, useNativeDriver: true, bounciness: 0,
                }).start();
            },
        }),
    ).current;

    return {
        /** Feed into the sheet's `transform: [{ translateY }]`. */
        dragY,
        /** Feed into a full-bleed scrim BEHIND the sheet — never a parent of it. */
        backdropOpacity,
        /** Spread onto the sheet's header view. */
        panHandlers: pan.panHandlers,
        /** Animated close — use for Close buttons and onRequestClose too. */
        dismiss,
    };
}
