import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * Rolls a displayed number toward its new value when it INCREASES — the
 * "points arriving" tick for balance surfaces. Deliberately restrained:
 *
 *  - No roll on data loads: pass `ready=false` while the source is loading;
 *    the first ready value (and any value seen before ready) snaps into
 *    place silently. Only an increase between two loaded values animates —
 *    a screen mount must never look like a payout.
 *  - Decreases snap instantly: spending points is not a celebration.
 *
 * Render with fontVariant: ['tabular-nums'] so digits don't jitter mid-roll.
 */
export function useRollingNumber(value: number, ready: boolean, duration = 800): number {
    const [display, setDisplay] = useState(value);
    const prevRef = useRef<{ value: number; ready: boolean }>({ value, ready: false });
    const animRef = useRef<Animated.Value | null>(null);

    useEffect(() => {
        const prev = prevRef.current;
        prevRef.current = { value, ready };

        if (value === prev.value && display === value) return;

        // Not a loaded→loaded increase: track silently.
        if (!ready || !prev.ready || value <= prev.value) {
            animRef.current?.stopAnimation();
            animRef.current = null;
            setDisplay(value);
            return;
        }

        // Loaded increase: roll from wherever the display currently is.
        const from = display;
        animRef.current?.stopAnimation();
        const anim = new Animated.Value(0);
        animRef.current = anim;
        const id = anim.addListener(({ value: t }) => {
            setDisplay(Math.round(from + (value - from) * t));
        });
        Animated.timing(anim, {
            toValue: 1,
            duration,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
        }).start(() => {
            anim.removeListener(id);
            setDisplay(value);
        });
        return () => anim.removeListener(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, ready]);

    return display;
}
