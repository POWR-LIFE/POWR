import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { TrendPoint } from '@/lib/api/bodyTrends';

/**
 * Trend charts for the BODY tab. Two forms, one scale:
 *
 *  - Sparkline: a continuous daily series (resting HR, nightly HRV) drawn as
 *    DEVIATION from the user's own average — see the note on the component
 *    itself. The curve breaks at sync gaps rather than bridging them.
 *  - RangeDotChart: readings plotted against a band of the user's own typical
 *    range (average ± one standard deviation). For series that are EVENTS, not
 *    a signal — HRV from a device that only measures it per workout lands on
 *    days you trained, and joining those dots with a line would invent a trend
 *    across days nothing was measured.
 *
 * Both take `goodDirection`, and with it the marks judge themselves, green
 * always on the healthy side ('down' for resting HR, 'up' for HRV). Discrete
 * marks (dots, labels) use that judgement as a threshold: past ±0.4σ of the
 * user's own series gets the verdict colour, everyday noise stays neutral ink.
 *
 * Both place points by DATE, not array index: the series are sparse, and
 * index-spacing would draw a 10-day gap and a 1-day gap the same width.
 * Callers render their own x-axis caption row beneath (see BodyTab.axisRow).
 */

const PAD = 8;
const LABEL = 'rgba(255,255,255,0.35)';
const NEUTRAL = 'rgba(255,255,255,0.6)';
const GREEN = '#4ade80';
const ROSE = '#FB7185';

export type GoodDirection = 'up' | 'down';

type Scale = {
    x: (date: string) => number;
    y: (v: number) => number;
    avg: number;
    sd: number;
    min: number;
    max: number;
};

function makeScale(points: TrendPoint[], days: number, width: number, height: number): Scale {
    const values = points.map(p => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length);
    const span = max - min;
    // Headroom for the high/low labels above and below the marks.
    const vPad = 16;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
        // Flat series sit mid-height rather than hugging an edge.
        y: v => span === 0 ? height / 2 : vPad + (1 - (v - min) / span) * (height - vPad * 2),
        x: date => {
            const d = new Date(`${date}T00:00:00`);
            const daysAgo = Math.round((today.getTime() - d.getTime()) / 86400000);
            const frac = 1 - Math.min(Math.max(daysAgo, 0), days - 1) / (days - 1);
            return PAD + frac * (width - PAD * 2);
        },
        avg, sd, min, max,
    };
}

/**
 * The mark's own verdict: rose on the unhealthy side of the user's average,
 * green on the healthy one, neutral ink inside the everyday ±0.4σ noise.
 */
function valueTint(v: number, scale: Scale, dir: GoodDirection | undefined, fallback: string): string {
    if (!dir || scale.sd === 0) return fallback;
    const hi = scale.avg + 0.4 * scale.sd;
    const lo = scale.avg - 0.4 * scale.sd;
    if (v >= hi) return dir === 'down' ? ROSE : GREEN;
    if (v <= lo) return dir === 'down' ? GREEN : ROSE;
    return fallback;
}

/** Keeps an annotation's x inside the canvas so edge points don't clip. */
function clampX(x: number, width: number): number {
    return Math.min(Math.max(x, 16), width - 16);
}

/**
 * Strictly increasing x, keeping the NEWEST reading wherever several land on
 * one — they are all "at least N days ago" and the freshest is the one that
 * belongs against the window's edge.
 *
 * The line and the per-reading dots BOTH run through this, so a clamped pair
 * can never draw a dot the curve doesn't pass through.
 */
function byIncreasingX<T extends { x: number }>(input: T[]): T[] {
    const out: T[] = [];
    for (const p of input) {
        if (out.length > 0 && p.x <= out[out.length - 1].x) out[out.length - 1] = p;
        else out.push(p);
    }
    return out;
}

/** Whole local days between two 'YYYY-MM-DD' dates. */
function daysBetween(a: string, b: string): number {
    return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);
}

/**
 * Splits a dated series wherever consecutive readings are more than
 * `maxGapDays` apart, so the curve is only ever drawn through days that were
 * actually measured. A smooth ramp across a four-day sync gap is
 * indistinguishable from four real readings; the dots alone were carrying
 * that honesty, and on a busy chart they don't carry it far enough. Exported
 * for the regression test.
 */
export function splitGaps<T extends { date: string }>(input: T[], maxGapDays: number): T[][] {
    const segments: T[][] = [];
    let current: T[] = [];
    for (const p of input) {
        const prev = current[current.length - 1];
        if (prev && daysBetween(prev.date, p.date) > maxGapDays) {
            segments.push(current);
            current = [];
        }
        current.push(p);
    }
    if (current.length > 0) segments.push(current);
    return segments;
}

/**
 * Monotone cubic (Fritsch–Carlson) through the points, as an SVG path.
 *
 * Resting HR wobbles a bpm or two a day, and a straight polyline renders that
 * as a zigzag that reads like jitter rather than a trend. Monotone is the
 * specific curve to use here rather than a plain cubic or Catmull-Rom: it
 * cannot overshoot between samples, so the curve never draws a peak higher
 * than any reading the user actually recorded — a chart that invents a 62 on a
 * day the watch said 59 would be a lie, however smooth.
 *
 * Every slope here divides by the x-gap, so COINCIDENT X IS FATAL: one pair of
 * points sharing an x puts `NaN` in the path, and react-native-svg's native
 * parser then dies on the 'N' rather than ignoring the segment. The x-scale
 * clamps anything outside the window onto the edge, so coincident x is normal
 * input, not a corner case — collapse it here rather than trusting callers.
 */
export function smoothPath(input: { x: number; y: number }[]): string {
    const pts = byIncreasingX(input);
    const n = pts.length;
    if (n < 2) return '';
    const dx: number[] = [], slope: number[] = [];
    for (let i = 0; i < n - 1; i++) {
        dx.push(pts[i + 1].x - pts[i].x);
        slope.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
    }
    // Tangent at each point, flattened to zero at every local extreme — that
    // flattening is what keeps the curve inside the data's own range.
    const t: number[] = [slope[0]];
    for (let i = 1; i < n - 1; i++) {
        if (slope[i - 1] * slope[i] <= 0) {
            t.push(0);
        } else {
            const w1 = 2 * dx[i] + dx[i - 1];
            const w2 = dx[i] + 2 * dx[i - 1];
            t.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]));
        }
    }
    t.push(slope[n - 2]);

    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i] / 3;
        d += ` C ${pts[i].x + h} ${pts[i].y + t[i] * h},`
            + ` ${pts[i + 1].x - h} ${pts[i + 1].y - t[i + 1] * h},`
            + ` ${pts[i + 1].x} ${pts[i + 1].y}`;
    }
    return d;
}

/**
 * "58" over the highest point, "52" under the lowest, "avg 54" on the dashed
 * line — the numbers that turn a bare line into a range the user can read.
 * With a goodDirection the two extremes wear their verdict colour.
 */
function RangeAnnotations({ points, scale, width, height, dir }: {
    points: TrendPoint[]; scale: Scale; width: number; height: number; dir?: GoodDirection;
}) {
    if (scale.max === scale.min) return null;
    const hi = points.find(p => p.value === scale.max)!;
    const lo = points.find(p => p.value === scale.min)!;
    const hiY = scale.y(hi.value);
    const loY = scale.y(lo.value);
    return (
        <>
            <SvgText
                x={clampX(scale.x(hi.date), width)}
                y={hiY < 16 ? hiY + 16 : hiY - 7}
                fontSize={8} fill={valueTint(scale.max, scale, dir, LABEL)} textAnchor="middle"
            >
                {Math.round(scale.max)}
            </SvgText>
            <SvgText
                x={clampX(scale.x(lo.date), width)}
                y={loY > height - 14 ? loY - 7 : loY + 13}
                fontSize={8} fill={valueTint(scale.min, scale, dir, LABEL)} textAnchor="middle"
            >
                {Math.round(scale.min)}
            </SvgText>
            <SvgText
                x={width - PAD} y={scale.y(scale.avg) - 4}
                fontSize={7} fill={LABEL} textAnchor="end"
            >
                {`avg ${Math.round(scale.avg)}`}
            </SvgText>
        </>
    );
}

/**
 * The window's highest and lowest readings, printed over their own dots.
 *
 * `makeScale`'s 16px vPad exists for exactly this: the extremes never reach
 * the canvas edge, so a label above the peak and below the trough always has
 * room. Each still flips to the other side if the geometry ever gets tight.
 *
 * The numerals wear the verdict colours, matching the fill beneath them
 * (Jamie's call). They take the colour from WHICH SIDE they sit on rather
 * than from `valueTint`'s ±0.4σ test, so the high and low always read as a
 * clear rose/green pair — a tightly-clustered series would otherwise leave
 * its own extremes inside the neutral band and print them both grey.
 */
function ExtremeLabels({ points, scale, width, height, dir }: {
    points: TrendPoint[]; scale: Scale; width: number; height: number; dir: GoodDirection;
}) {
    if (scale.max === scale.min) return null;
    const todayDate = points[points.length - 1].date;
    // The max can only sit at or above the average and the min at or below it,
    // so high always takes the above-side hue and low the below-side one.
    const marks = [
        { p: points.find(v => v.value === scale.max)!, above: true, fill: dir === 'down' ? ROSE : GREEN },
        { p: points.find(v => v.value === scale.min)!, above: false, fill: dir === 'down' ? GREEN : ROSE },
    ];
    return (
        <>
            {marks.map(({ p, above, fill }) => {
                // Today is skipped: the headline above already prints its
                // value, and a label here would land on its halo.
                if (p.date === todayDate) return null;
                const y = scale.y(p.value);
                const tight = above ? y < 12 : y > height - 16;
                return (
                    <SvgText
                        key={p.date}
                        x={clampX(scale.x(p.date), width)}
                        y={above === !tight ? y - 8 : y + 13}
                        fontSize={9} fontWeight="500"
                        fill={fill} textAnchor="middle"
                    >
                        {Math.round(p.value)}
                    </SvgText>
                );
            })}
        </>
    );
}

/**
 * A daily series drawn as DEVIATION from the user's own average.
 *
 * The baseline is the average, and the fill hangs off it rather than off the
 * floor: rose where the line runs the unhealthy side, green where it runs the
 * healthy one. That is the honest encoding for these metrics, because a
 * resting HR of 53 means nothing in the absolute and everything relative to
 * YOUR usual 53 — and it puts the colour on the area, whose size is the size
 * of the deviation, instead of on the line, where an earlier pass tinted by
 * absolute value and left every ordinary day a muddy neutral.
 *
 * There is no legend, no on-canvas "avg" label and no floating high/low
 * numerals: the caller's headline already reads "N bpm below your average",
 * which names the baseline, and the caller's axis row carries the range. Three
 * restatements of the average was most of what made the v1 chart feel busy.
 */
export function Sparkline({
    points,
    days,
    height = 64,
    goodDirection,
    maxGapDays = 3,
}: {
    /** Oldest first, dates within the trailing `days` window. */
    points: TrendPoint[];
    /** Width of the window in days — fixes the x-scale even when data is sparse. */
    days: number;
    height?: number;
    /** Which way is healthy — decides which side of the baseline reads green. */
    goodDirection: GoodDirection;
    /** The line breaks wherever readings are further apart than this. */
    maxGapDays?: number;
}) {
    const [width, setWidth] = useState(0);
    if (points.length === 0) return null;

    return (
        // pointerEvents="none": the chart is display-only, and react-native-svg
        // otherwise claims the touch responder — a drag starting on the canvas
        // would reach neither the chart scroller nor the tab carousel.
        <View
            style={{ height, alignSelf: 'stretch' }}
            pointerEvents="none"
            onLayout={e => setWidth(e.nativeEvent.layout.width)}
        >
            {width > 0 && (() => {
                const scale = makeScale(points, days, width, height);
                const coords = byIncreasingX(points.map(p => ({ x: scale.x(p.date), y: scale.y(p.value), date: p.date })));
                const last = coords[coords.length - 1];
                const lastPoint = points[points.length - 1];
                const avgY = scale.y(scale.avg);

                // One curve per run of consecutive readings: the line stops
                // at a sync gap and starts again after it, rather than
                // gliding across days the device never measured.
                const segments = splitGaps(coords, maxGapDays)
                    .map(seg => ({ seg, line: smoothPath(seg) }))
                    .filter(s => s.line !== '');

                // The region BETWEEN the curve and the baseline, as one closed
                // path per segment. It self-intersects wherever the series
                // crosses the average, which is fine and in fact the point:
                // with the default nonzero fill rule every lobe still fills,
                // and a single vertical gradient whose midpoint sits exactly
                // on the baseline then paints the lobes above in one hue and
                // the lobes below in the other. No clip path needed — worth
                // knowing, since react-native-svg does not re-export ClipPath.
                const areaPath = segments.length > 0
                    ? segments.map(({ seg, line }) =>
                        `${line} L ${seg[seg.length - 1].x} ${avgY} L ${seg[0].x} ${avgY} Z`).join(' ')
                    : null;
                const linePath = segments.map(s => s.line).join(' ');

                // 'down' is healthy-is-lower (resting HR): above the baseline
                // is the bad side, so it wears rose and below wears green.
                const aboveColor = goodDirection === 'down' ? ROSE : GREEN;
                const belowColor = goodDirection === 'down' ? GREEN : ROSE;

                // The gradient spans the DATA's extremes rather than the
                // canvas, so full saturation lands on the highest and lowest
                // readings the user actually has and fades out at the average.
                const yTop = scale.y(scale.max);
                const yBottom = scale.y(scale.min);
                // A flat series has no deviation to shade, and would divide by
                // zero here; it renders as the bare line on its baseline.
                const flat = yBottom - yTop < 1;
                const avgFrac = flat ? 0.5 : (avgY - yTop) / (yBottom - yTop);
                // Ids are document-global on web — fold in the geometry so two
                // charts on the tab can never collide on one.
                const fillId = `sparkdev-${goodDirection}${Math.round(avgY)}h${height}`;

                return (
                    <Svg width={width} height={height}>
                        {!flat && areaPath && (
                            <>
                                <Defs>
                                    <LinearGradient
                                        id={fillId}
                                        x1="0" y1={String(yTop)} x2="0" y2={String(yBottom)}
                                        gradientUnits="userSpaceOnUse"
                                    >
                                        <Stop offset="0" stopColor={aboveColor} stopOpacity={0.42} />
                                        {/* Both sides fade to ~nothing at the average, so
                                            the hue swap is invisible; the pair of stops is
                                            nudged a hair apart rather than sharing one
                                            offset, which not every platform's native
                                            gradient handles the same way. */}
                                        <Stop offset={String(avgFrac)} stopColor={aboveColor} stopOpacity={0.02} />
                                        <Stop offset={String(Math.min(avgFrac + 0.001, 1))} stopColor={belowColor} stopOpacity={0.02} />
                                        <Stop offset="1" stopColor={belowColor} stopOpacity={0.42} />
                                    </LinearGradient>
                                </Defs>
                                <Path d={areaPath} fill={`url(#${fillId})`} />
                            </>
                        )}
                        {/* Solid, not dashed: it is the chart's zero now, not a
                            faint annotation floating behind the data. */}
                        <Line
                            x1={PAD} y1={avgY} x2={width - PAD} y2={avgY}
                            stroke="rgba(255,255,255,0.22)" strokeWidth={1}
                        />
                        {linePath && (
                            <Path
                                d={linePath}
                                fill="none"
                                stroke="rgba(255,255,255,0.92)"
                                strokeWidth={1.5}
                                strokeLinejoin="round" strokeLinecap="round"
                            />
                        )}
                        {/* One dot per actual reading, so the chart shows where
                            it was SAMPLED and not just the curve through those
                            samples. This is what keeps a sync gap honest: with
                            the line alone, a smooth ramp across four missing
                            days is indistinguishable from four real ones.
                            Today is excluded — it gets the haloed mark below. */}
                        {coords.slice(0, -1).map(c => (
                            <Circle key={c.date} cx={c.x} cy={c.y} r={2} fill="#ffffff" fillOpacity={0.55} />
                        ))}
                        {/* The window's high and low, each sitting on its own
                            dot. v1 printed these too but left them floating
                            with nothing tying them to a reading; the fix was
                            never to delete the numbers, it was to give them an
                            anchor and real clearance. */}
                        <ExtremeLabels points={points} scale={scale} width={width} height={height} dir={goodDirection} />
                        {/* Today, haloed: the reading the user came for was the
                            smallest mark on the v1 chart. */}
                        <Circle
                            cx={last.x} cy={last.y} r={6.5}
                            fill={valueTint(lastPoint.value, scale, goodDirection, NEUTRAL)}
                            fillOpacity={0.2}
                        />
                        <Circle
                            cx={last.x} cy={last.y} r={3}
                            fill={valueTint(lastPoint.value, scale, goodDirection, NEUTRAL)}
                        />
                    </Svg>
                );
            })()}
        </View>
    );
}

export function RangeDotChart({
    points,
    days,
    height = 64,
    color,
    goodDirection,
}: {
    points: TrendPoint[];
    days: number;
    height?: number;
    /** The band's ink; dots wear their verdict colour when goodDirection is set. */
    color: string;
    goodDirection?: GoodDirection;
}) {
    const [width, setWidth] = useState(0);
    if (points.length === 0) return null;

    return (
        // pointerEvents="none" for the same reason as Sparkline's: touches must
        // fall through the SVG to the scroller behind it.
        <View
            style={{ height, alignSelf: 'stretch' }}
            pointerEvents="none"
            onLayout={e => setWidth(e.nativeEvent.layout.width)}
        >
            {width > 0 && (() => {
                const scale = makeScale(points, days, width, height);
                const lastDate = points[points.length - 1].date;
                // The band: this user's own typical range. Clamped so a wide
                // spread still leaves the outlier dots room to sit outside it.
                const bandTop = Math.max(PAD, scale.y(scale.avg + scale.sd));
                const bandBottom = Math.min(height - PAD, scale.y(scale.avg - scale.sd));
                const avgY = scale.y(scale.avg);
                const glowId = `bandglow-${Math.round(avgY)}h${height}`;
                return (
                    <Svg width={width} height={height}>
                        {/* The band is a GLOW, not a box: full brightness between
                            the ±1σ edges, feathering to nothing at the chart's
                            edges — so even an outlier dot sits in the wash of the
                            band it deviates from, instead of floating on black. */}
                        {scale.sd > 0 && (
                            <>
                                <Defs>
                                    <LinearGradient
                                        id={glowId}
                                        x1="0" y1="0" x2="0" y2={String(height)}
                                        gradientUnits="userSpaceOnUse"
                                    >
                                        <Stop offset="0" stopColor={color} stopOpacity={0} />
                                        <Stop offset={String(bandTop / height)} stopColor={color} stopOpacity={0.16} />
                                        <Stop offset={String(bandBottom / height)} stopColor={color} stopOpacity={0.16} />
                                        <Stop offset="1" stopColor={color} stopOpacity={0} />
                                    </LinearGradient>
                                </Defs>
                                <Rect
                                    x={PAD} y={0}
                                    width={width - PAD * 2} height={height}
                                    rx={4} fill={`url(#${glowId})`}
                                />
                            </>
                        )}
                        <Line
                            x1={PAD} y1={avgY} x2={width - PAD} y2={avgY}
                            stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="2 4"
                        />
                        {/* Each reading hangs off the average by a faint stem, so a
                            far-flung dot reads as "this far from normal" instead of
                            floating unmoored — free-floating dots looked random on
                            device the moment real data put outliers past the band. */}
                        {points.map(p => {
                            const isLast = p.date === lastDate;
                            const tint = valueTint(p.value, scale, goodDirection, color);
                            const y = scale.y(p.value);
                            return (
                                <React.Fragment key={p.date}>
                                    <Line
                                        x1={scale.x(p.date)} y1={avgY}
                                        x2={scale.x(p.date)} y2={y}
                                        stroke={tint} strokeOpacity={0.3}
                                        strokeWidth={1} strokeLinecap="round"
                                    />
                                    <Circle
                                        cx={scale.x(p.date)} cy={y}
                                        r={isLast ? 4 : 3}
                                        fill={tint}
                                        fillOpacity={isLast ? 1 : 0.8}
                                    />
                                </React.Fragment>
                            );
                        })}
                        <RangeAnnotations points={points} scale={scale} width={width} height={height} dir={goodDirection} />
                    </Svg>
                );
            })()}
        </View>
    );
}
