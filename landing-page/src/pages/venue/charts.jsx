import React, { useState } from 'react';
import { fmtNum } from '../../components/portal/ui';

// Charts shared by the portal's Members page. They follow the dataviz rules:
// one series each (so no legend; the card title names it), one hue validated
// against the white card (#8a7600, the portal's gold ink, >= 3:1), columns
// <= 24px with 4px rounded tops and a gap, a recessive hairline grid,
// hover/focus tooltips, and a table behind every chart for screen readers.

export const INK = '#8a7600';

// The top gridline: the smallest clean number at or above the peak, so the
// tallest column fills most of the plot (55 → 60, not 100).
export function niceMax(v) {
    if (v <= 0) return 1;
    const mag = 10 ** Math.floor(Math.log10(v));
    const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => s * mag >= v) ?? 10;
    return Math.max(1, Math.round(step * mag));
}

/**
 * Columns from one baseline. `data`: [{ key, tick, value, tip, partial }].
 * `partial` (the week still running) is drawn at half strength and says so.
 */
export function Columns({ data, label, unit, height = 160, tickEvery = 1 }) {
    const [hover, setHover] = useState(null);
    const max = niceMax(Math.max(0, ...data.map(d => d.value)));
    const active = hover == null ? null : data[hover];
    return (
        <figure className="m-0" aria-label={label}>
            <div className="relative" style={{ height }}>
                {/* Hairline grid: baseline + the clean max, labelled. */}
                <div className="absolute inset-x-0 bottom-0 border-t border-[#E6E6E1]" />
                <div className="absolute inset-x-0 top-0 border-t border-[#F0F0EC]" />
                <span className="absolute right-0 -top-5 text-[10px] font-bold text-[#BBBBBB] tabular-nums">{fmtNum(max)}{unit ? ` ${unit}` : ''}</span>

                <div className="absolute inset-0 flex items-end justify-between gap-[2px]" onMouseLeave={() => setHover(null)}>
                    {data.map((d, i) => (
                        <button
                            key={d.key}
                            type="button"
                            className="relative flex-1 h-full flex items-end justify-center outline-none group"
                            onMouseEnter={() => setHover(i)}
                            onFocus={() => setHover(i)}
                            onBlur={() => setHover(null)}
                            aria-label={`${d.tip}: ${fmtNum(d.value)}${unit ? ` ${unit}` : ''}`}
                        >
                            <span
                                className="block w-full rounded-t-[4px] transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-[#1A1A1A]"
                                style={{
                                    maxWidth: 24,
                                    height: d.value > 0 ? `${Math.max(2, (d.value / max) * 100)}%` : 0,
                                    background: INK,
                                    opacity: d.partial ? 0.45 : hover === i ? 0.8 : 1,
                                }}
                            />
                        </button>
                    ))}
                </div>

                {active && (
                    <div
                        className="absolute -top-2 z-10 -translate-x-1/2 -translate-y-full pointer-events-none bg-[#1A1A1A] text-white rounded-xl px-3 py-2 shadow-lg whitespace-nowrap"
                        style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
                    >
                        <div className="text-[14px] font-bold tabular-nums">{fmtNum(active.value)}{unit ? ` ${unit}` : ''}</div>
                        <div className="text-[10px] text-white/60 font-bold">{active.tip}{active.partial ? ' (so far)' : ''}</div>
                    </div>
                )}
            </div>

            {/* Ticks sit on their column's centre and may be wider than it; they
                count back from the newest column so "Now" always shows. */}
            <div className="relative h-4 mt-2">
                {data.map((d, i) => ((data.length - 1 - i) % tickEvery === 0 ? (
                    <span
                        key={d.key}
                        className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] font-black uppercase tracking-[0.1em] text-[#BBBBBB]"
                        style={{ left: `${((i + 0.5) / data.length) * 100}%` }}
                    >
                        {d.tick}
                    </span>
                ) : null))}
            </div>

            <table className="sr-only">
                <caption>{label}</caption>
                <tbody>
                    {data.map(d => <tr key={d.key}><th scope="row">{d.tip}</th><td>{d.value}</td></tr>)}
                </tbody>
            </table>
        </figure>
    );
}
