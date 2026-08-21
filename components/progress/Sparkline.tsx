import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polyline, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { TrendPoint } from '@/lib/api/bodyTrends';

/**
 * Trend charts for the BODY tab. Two forms, one scale:
 *
 *  - Sparkline: a line for genuinely continuous daily series (resting HR),
 *    with a gradient area fill and its high / low / average annotated in-line.
 *  - RangeDotChart: readings plotted against a band of the user's own typical
 *    range (average ± one standard deviation). For series that are EVENTS, not
 *    a signal — per-workout HRV lands only on days you trained, and joining
 *    those dots with a line would invent a trend across days nothing was
 *    measured.
 *
 * Both take `goodDirection`, and with it the marks judge themselves, green
 * always on the healthy side ('down' for resting HR, 'up' for HRV). The line
 * wears a smooth VERTICAL gradient — colour is encoding value, and value IS
 * the y-axis, so a peak blends into rose and a trough into green with no hard
 * switch mid-line. Discrete marks (dots, labels) use the same judgement as a
 * threshold: past ±0.4σ of the user's own series gets the verdict colour,
 * everyday noise stays neutral ink.
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

export function Sparkline({
    points,
    days,
    height = 64,
    color,
    area = false,
    goodDirection,
}: {
    /** Oldest first, dates within the trailing `days` window. */
    points: TrendPoint[];
    /** Width of the window in days — fixes the x-scale even when data is sparse. */
    days: number;
    height?: number;
    /** Base ink for the line where no verdict applies. */
    color: string;
    /** Gradient fill under the line, fading to transparent at the baseline. */
    area?: boolean;
    /** Which way is healthy — colours the marks green/rose around the average. */
    goodDirection?: GoodDirection;
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
                const coords = points.map(p => ({ x: scale.x(p.date), y: scale.y(p.value) }));
                const last = coords[coords.length - 1];
                const lastPoint = points[points.length - 1];
                const areaPath = coords.length > 1
                    ? `M ${coords[0].x} ${height - 2} `
                        + coords.map(c => `L ${c.x} ${c.y}`).join(' ')
                        + ` L ${last.x} ${height - 2} Z`
                    : null;
                // With verdict colouring on the line, the fill stays neutral —
                // two colour systems in one chart would fight each other.
                const fillColor = goodDirection ? '#ffffff' : color;
                // Ids are document-global on web — the avg fraction folded in
                // keeps two charts' gradients (whose geometry differs) apart.
                const uniq = `${(goodDirection ?? 'plain')}${Math.round(scale.y(scale.avg))}h${height}`;
                const fillId = `sparkfill-${fillColor.replace(/[^a-zA-Z0-9]/g, '')}-${uniq}`;
                const lineId = `sparkline-${uniq}`;
                // Colour encodes value and value IS the y-axis, so a vertical
                // gradient in user space blends the verdict smoothly along the
                // line: unhealthy hue at the range's far edge, neutral at the
                // average, green at the healthy edge — no hard switches.
                const topColor = goodDirection === 'down' ? ROSE : GREEN;
                const bottomColor = goodDirection === 'down' ? GREEN : ROSE;
                const avgFrac = Math.min(Math.max(scale.y(scale.avg) / height, 0.15), 0.85);
                return (
                    <Svg width={width} height={height}>
                        <Defs>
                            {area && areaPath && (
                                <LinearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                                    <Stop offset="0" stopColor={fillColor} stopOpacity={goodDirection ? 0.08 : 0.25} />
                                    <Stop offset="1" stopColor={fillColor} stopOpacity={0.02} />
                                </LinearGradient>
                            )}
                            {goodDirection && (
                                // The verdict colours HOLD across most of their half
                                // and only dissolve to neutral right at the average —
                                // three evenly-spread stops left the middle two-thirds
                                // of the line looking like plain white (device-tested).
                                <LinearGradient
                                    id={lineId}
                                    x1="0" y1="0" x2="0" y2={String(height)}
                                    gradientUnits="userSpaceOnUse"
                                >
                                    <Stop offset="0" stopColor={topColor} />
                                    <Stop offset={String(avgFrac * 0.6)} stopColor={topColor} />
                                    <Stop offset={String(avgFrac)} stopColor={NEUTRAL} />
                                    <Stop offset={String(avgFrac + (1 - avgFrac) * 0.4)} stopColor={bottomColor} />
                                    <Stop offset="1" stopColor={bottomColor} />
                                </LinearGradient>
                            )}
                        </Defs>
                        {area && areaPath && <Path d={areaPath} fill={`url(#${fillId})`} />}
                        <Line
                            x1={PAD} y1={scale.y(scale.avg)} x2={width - PAD} y2={scale.y(scale.avg)}
                            stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="2 4"
                        />
                        {coords.length > 1 && (
                            <Polyline
                                points={coords.map(c => `${c.x},${c.y}`).join(' ')}
                                fill="none"
                                stroke={goodDirection ? `url(#${lineId})` : color}
                                strokeWidth={2}
                                strokeLinejoin="round" strokeLinecap="round"
                            />
                        )}
                        <Circle
                            cx={last.x} cy={last.y} r={2.5}
                            fill={valueTint(lastPoint.value, scale, goodDirection, color)}
                        />
                        <RangeAnnotations points={points} scale={scale} width={width} height={height} dir={goodDirection} />
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
