import { useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

/**
 * Pull-down-to-dismiss for the app's hand-rolled bottom sheets.
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
 */
export function useSheetDragDismiss(onClose: () => void) {
    const dragY = useRef(new Animated.Value(0)).current;

    // onClose is an inline arrow in every parent, so it changes identity each
    // render while the PanResponder is created once — read it through a ref so
    // the release handler never calls a stale closure.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    /**
     * Slide the sheet away, THEN tell the parent, THEN rearm.
     *
     * The rearm is why no open-time reset is needed. These sheets are rendered
     * with visible=false rather than unmounted, so dragY survives a close — left
     * at 700 it would render the next open 700px down, i.e. off-screen. Zeroing
     * it here happens after the parent has already stopped rendering the sheet,
     * so it is invisible, and the value is always clean before the next paint.
     *
     * Resetting at OPEN time can't do that: during render it is a side effect in
     * render, and from Modal's onShow it is too late — react-native-web fires
     * onShow from its animationEnd callback, so the sheet would sit off-screen
     * for the whole slide-in and then pop into place.
     */
    const dismiss = () => {
        Animated.timing(dragY, {
            toValue: 700, duration: 160, useNativeDriver: true,
        }).start(() => {
            onCloseRef.current();
            dragY.setValue(0);
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
        /** Spread onto the sheet's header view. */
        panHandlers: pan.panHandlers,
        /** Animated close — use for Close buttons and onRequestClose too. */
        dismiss,
    };
}
