import { useEffect, useState } from 'react';

/**
 * Live once-per-second countdown to an ISO timestamp.
 * Returns "20d 04:12:33" (or "04:12:33" inside the final day), clamped at
 * zero; null when no target. Digits are stable-width when rendered with
 * fontVariant: ['tabular-nums'].
 */
export function useCountdown(targetIso: string | null): string | null {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!targetIso) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [targetIso]);

    if (!targetIso) return null;

    const totalSec = Math.max(0, Math.floor((new Date(targetIso).getTime() - now) / 1000));
    const days = Math.floor(totalSec / 86400);
    const hh = String(Math.floor((totalSec % 86400) / 3600)).padStart(2, '0');
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');

    return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}
