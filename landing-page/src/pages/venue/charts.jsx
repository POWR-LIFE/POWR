import React, { useState } from 'react';
import { fmtNum } from '../../components/portal/ui';

// Charts shared by the portal's Members page. They follow the dataviz rules:
// one hue validated against the white card (#8a7600, the portal's gold ink,
// >= 3:1), thin marks with 4px rounded ends, a recessive hairline grid,
// hover/focus tooltips, a legend only when there are two series, and a
// table behind every chart for screen readers.

export const INK = '#8a7600';
export const GHOST = '#EDE7C4';

// The top gridline: the smallest clean number at or above the peak, so the
// tallest column fills most of the plot (55 → 60, not 100).
export function niceMax(v) {
    if (v <= 0) return 1;
    const mag = 10 ** Math.floor(Math.log10(v));
    const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => s * mag >= v) ?? 10;
    return Math.max(1, Math.round(step * mag));
}

/**
 * Columns from one baseline. `data`: [{ key, tick, value, tip, partial, ghost }].
 * `partial` (the week still running) is drawn at half strength and says so.
 * `ghost`, when any datum has one, is a second series drawn as a light column
 * behind the first (the wider whole the first is part of, e.g. members active
 * anywhere behind members who trained here); `ghostLabel` names it in the legend.
 */
export function Columns({ data, label, unit, height = 160, tickEvery = 1, ghostLabel }) {
    const [hover, setHover] = useState(null);
    const hasGhost = data.some(d => d.ghost != null);
    const max = niceMax(Math.max(0, ...data.map(d => Math.max(d.value, d.ghost ?? 0))));
    const active = hover == null ? null : data[hover];
    const h = (v) => (v > 0 ? `${Math.max(2, (v / max) * 100)}%` : 0);
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
                            onClick={() => setHover((h) => (h === i ? null : i))}
                            onFocus={() => setHover(i)}
                            onBlur={() => setHover(null)}
                            aria-label={`${d.tip}: ${fmtNum(d.value)}${unit ? ` ${unit}` : ''}${d.ghost != null ? `, ${ghostLabel ?? 'total'} ${fmtNum(d.ghost)}` : ''}`}
                        >
                            {d.ghost != null && (
                                <span className="absolute bottom-0 rounded-t-[4px] w-full" style={{ maxWidth: 24, height: h(d.ghost), background: GHOST, opacity: d.partial ? 0.6 : 1 }} />
                            )}
                            <span
                                className="relative block w-full rounded-t-[4px] transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-[#1A1A1A]"
                                style={{ maxWidth: 24, height: h(d.value), background: INK, opacity: d.partial ? 0.45 : hover === i ? 0.8 : 1 }}
                            />
                        </button>
                    ))}
                </div>

                {active && (
                    <div
                        className="absolute -top-2 z-10 -translate-x-1/2 -translate-y-full pointer-events-none bg-[#1A1A1A] text-white rounded-xl px-3 py-2 shadow-lg whitespace-nowrap"
                        style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
                    >
                        <div className="text-[14px] font-bold tabular-nums">{fmtNum(active.value)}{unit ? ` ${unit}` : ''}{active.ghost != null ? <span className="text-white/50 font-bold text-[11px]"> of {fmtNum(active.ghost)}</span> : null}</div>
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

            {hasGhost && (
                <div className="mt-2 flex items-center gap-4 text-[10px] font-bold text-[#888]">
                    <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px]" style={{ background: INK }} />{label}</span>
                    <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px]" style={{ background: GHOST }} />{ghostLabel}</span>
                </div>
            )}

            <table className="sr-only">
                <caption>{label}</caption>
                <tbody>
                    {data.map(d => <tr key={d.key}><th scope="row">{d.tip}</th><td>{d.value}</td>{d.ghost != null && <td>{d.ghost}</td>}</tr>)}
                </tbody>
            </table>
        </figure>
    );
}

/**
 * One horizontal bar split into parts, with a legend that carries the numbers.
 * `segments`: [{ key, label, value, color }] in the order they're drawn.
 */
export function Stacked({ label, segments }) {
    const total = segments.reduce((s, x) => s + (x.value ?? 0), 0);
    return (
        <figure className="m-0" aria-label={label}>
            <div className="h-3 rounded-full bg-[#F4F4F1] flex gap-[2px] overflow-hidden">
                {total > 0 && segments.filter(s => s.value > 0).map(s => (
                    <div key={s.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
                ))}
            </div>
            <ul className="mt-3 space-y-1.5">
                {segments.map(s => (
                    <li key={s.key} className="flex items-center gap-2 text-[11px] leading-snug min-w-0">
                        <i className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.color }} />
                        <span className="text-[#666] truncate">{s.label}</span>
                        <span className="ml-auto font-bold text-[#1A1A1A] tabular-nums shrink-0">{fmtNum(s.value ?? 0)}<span className="text-[#BBBBBB] font-bold"> · {total ? Math.round(((s.value ?? 0) / total) * 100) : 0}%</span></span>
                    </li>
                ))}
            </ul>
            <table className="sr-only"><caption>{label}</caption><tbody>{segments.map(s => <tr key={s.key}><th scope="row">{s.label}</th><td>{s.value ?? 0}</td></tr>)}</tbody></table>
        </figure>
    );
}

/** One labelled bar: the label and value in text ink, the bar in the gold ink. */
export function BarRow({ label, value, max, right, sub }) {
    return (
        <div>
            <div className="flex items-baseline justify-between gap-3 text-[12px] font-bold mb-1.5">
                <span className="text-[#1A1A1A] min-w-0 truncate">{label}{sub && <span className="font-normal text-[#AAAAAA]"> · {sub}</span>}</span>
                <span className="text-[#888] tabular-nums shrink-0">{right ?? fmtNum(value)}</span>
            </div>
            <div className="h-2 rounded-full bg-[#F4F4F1]">
                <div className="h-full rounded-full" style={{ width: `${max ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0}%`, background: INK }} />
            </div>
        </div>
    );
}
