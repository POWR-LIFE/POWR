import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// ─── Featured calendar ────────────────────────────────────────────────────────
// Month-grid view of the featured-reward schedule. Each slot renders as a big
// logo badge on its start day and another on its end day, joined by a coloured
// line across the days in between. Shared by the admin editor (FeaturedSchedule)
// and the read-only partner view (PartnerFeatured).
//
// Slots are end-exclusive: a window of 9 Jun 00:00 → 16 Jun 00:00 covers
// Jun 9–15 inclusive (the "week of 9 Jun").
//
// A slot carrying `ghost: true` is a *request*, not a booking — it draws
// dashed and hollow so it can never be mistaken for a confirmed week.

const MS_DAY = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Layout constants (px)
const DAY_NUM_H = 26;   // space reserved at the top of a cell for the day number
const LANE_H = 60;      // height of one band lane — the logo badge fills this
const BADGE_INSET = 4;  // gap between the logo badge and the day-cell edges

const PALETTE = ['#E8D200', '#0EA5E9', '#10B981', '#8B5CF6', '#F97316', '#F43F5E', '#14B8A6', '#A855F7'];

function stripTime(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function dayDiff(from, to) {
    return Math.round((stripTime(to).getTime() - stripTime(from).getTime()) / MS_DAY);
}

function startOfWeekMon(d) {
    const x = stripTime(d);
    const day = x.getDay();                 // 0 Sun … 6 Sat
    x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
    return x;
}

function buildWeeks(month) {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const gridStart = startOfWeekMon(first);
    const leadOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
    const numWeeks = Math.ceil((leadOffset + last.getDate()) / 7);
    const weeks = [];
    for (let w = 0; w < numWeeks; w++) {
        const days = [];
        for (let d = 0; d < 7; d++) {
            const cell = new Date(gridStart);
            cell.setDate(gridStart.getDate() + w * 7 + d);
            days.push(cell);
        }
        weeks.push(days);
    }
    return weeks;
}

// Deterministic colour for a slot when the reward has no brand_color.
function hashColor(key = '') {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
}

// Relative luminance (0 dark → 1 light) of a #rrggbb colour.
function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Connecting-line colour for a slot. Skip missing or near-white brand colours
// (they vanish on the white grid) and fall back to a deterministic palette colour.
function bandColor(slot) {
    const c = slot.brandColor;
    if (c && luminance(c) <= 0.85) return c;
    return hashColor(slot.brand_name || slot.label || slot.id || '');
}

// Greedy lane packing so bands that share a week but not days sit on one lane,
// and any genuine overlap falls to the next lane down.
function packLanes(segments) {
    const lanes = []; // each lane = array of {startCol, endCol}
    const placed = [];
    [...segments]
        .sort((a, b) => a.startCol - b.startCol)
        .forEach((seg) => {
            let lane = lanes.findIndex((occupied) =>
                occupied.every((o) => seg.startCol > o.endCol || seg.endCol < o.startCol));
            if (lane === -1) { lane = lanes.length; lanes.push([]); }
            lanes[lane].push(seg);
            placed.push({ ...seg, lane });
        });
    return { placed, laneCount: Math.max(1, lanes.length) };
}

export default function FeaturedCalendar({
    slots = [],
    month,
    onPrevMonth,
    onNextMonth,
    onSlotClick,
    onDayClick,
    canClickDay = null,   // (day) => bool — lets a page grey out days it can't accept
    readOnly = false,
    highlightBrand = null,
}) {
    const weeks = useMemo(() => buildWeeks(month), [month]);
    const todayKey = stripTime(new Date()).getTime();
    const highlight = highlightBrand?.trim().toLowerCase() || null;

    const monthLabel = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
            {/* Month nav */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-[#E6E6E1]">
                <h3 className="text-xl font-light tracking-tight text-[#1A1A1A]">{monthLabel}</h3>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onPrevMonth}
                        className="w-10 h-10 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666] hover:text-[#1A1A1A] hover:border-[#E8D200]/40 transition-all"
                        aria-label="Previous month"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={onNextMonth}
                        className="w-10 h-10 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666] hover:text-[#1A1A1A] hover:border-[#E8D200]/40 transition-all"
                        aria-label="Next month"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>

            {/* Weekday header */}
            <div className="grid grid-cols-7 border-b border-[#E6E6E1]">
                {WEEKDAYS.map((w) => (
                    <div key={w} className="px-3 py-3 text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black text-center">
                        {w}
                    </div>
                ))}
            </div>

            {/* Weeks */}
            <div>
                {weeks.map((days, wi) => {
                    const weekStart = days[0];
                    const weekEndExcl = new Date(days[6]);
                    weekEndExcl.setDate(weekEndExcl.getDate() + 1); // exclusive end (next Monday 00:00)

                    // Segments of slots intersecting this week.
                    const segments = [];
                    slots.forEach((slot) => {
                        const s = new Date(slot.starts_at);
                        const e = new Date(slot.ends_at); // exclusive
                        if (s < weekEndExcl && e > weekStart) {
                            const bandStart = s > weekStart ? s : weekStart;
                            const lastCovered = new Date(Math.min(e.getTime(), weekEndExcl.getTime()) - 1);
                            const startCol = Math.max(0, Math.min(6, dayDiff(weekStart, bandStart)));
                            const endCol = Math.max(0, Math.min(6, dayDiff(weekStart, lastCovered)));
                            segments.push({ ...slot, startCol, endCol, isStart: s >= weekStart, isEnd: e <= weekEndExcl });
                        }
                    });
                    const { placed, laneCount } = packLanes(segments);
                    const weekMinH = DAY_NUM_H + laneCount * LANE_H + 8;

                    return (
                        <div
                            key={wi}
                            className="relative border-b border-[#EFEFEC] last:border-b-0"
                            style={{ minHeight: weekMinH }}
                        >
                            {/* Day cells (background grid) */}
                            <div className="grid grid-cols-7 absolute inset-0">
                                {days.map((day, di) => {
                                    const inMonth = day.getMonth() === month.getMonth();
                                    const isToday = stripTime(day).getTime() === todayKey;
                                    const clickable = !readOnly && inMonth && (!canClickDay || canClickDay(day));
                                    return (
                                        <div
                                            key={di}
                                            onClick={clickable ? () => onDayClick?.(day) : undefined}
                                            className={[
                                                'border-r border-[#EFEFEC] last:border-r-0 px-2 pt-1.5 transition-colors',
                                                inMonth ? 'bg-white' : 'bg-[#FAFAF8]',
                                                clickable ? 'cursor-pointer hover:bg-[#E8D200]/[0.04] group' : '',
                                            ].join(' ')}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className={[
                                                    'inline-flex items-center justify-center text-[11px] font-bold rounded-full w-6 h-6',
                                                    isToday ? 'bg-[#E8D200] text-[#080808]' : inMonth ? 'text-[#444]' : 'text-[#CCCCCC]',
                                                ].join(' ')}>
                                                    {day.getDate()}
                                                </span>
                                                {clickable && (
                                                    <span className="text-[#DDDDDD] opacity-0 group-hover:opacity-100 text-sm leading-none font-light transition-opacity">+</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Bands overlay — logo badge on start & end day, line between */}
                            {placed.map((seg, si) => {
                                const fill = bandColor(seg);
                                const isMine = highlight && (seg.brand_name || '').trim().toLowerCase() === highlight;
                                const onClick = onSlotClick ? () => onSlotClick(seg) : undefined;
                                const laneCenter = DAY_NUM_H + seg.lane * LANE_H + LANE_H / 2;

                                const startCenter = ((seg.startCol + 0.5) / 7) * 100;
                                const endCenter = ((seg.endCol + 0.5) / 7) * 100;
                                // Line runs between the two badge centres; when the slot continues
                                // into an adjacent week it runs to the cell edge instead.
                                const lineLeft = seg.isStart ? startCenter : (seg.startCol / 7) * 100;
                                const lineRight = seg.isEnd ? endCenter : ((seg.endCol + 1) / 7) * 100;

                                const showStart = seg.isStart;
                                const showEnd = seg.isEnd && !(seg.isStart && seg.startCol === seg.endCol);

                                // The logo badge fills the whole day cell (one column wide).
                                const badge = (col, key) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={onClick}
                                        title={seg.ghost ? `${seg.label} — requested` : seg.label}
                                        className={[
                                            'absolute flex items-center justify-center rounded-xl overflow-hidden z-10',
                                            seg.ghost ? 'bg-white border-2 border-dashed' : 'bg-[#1A1A1A]',
                                            onSlotClick ? 'cursor-pointer hover:scale-[1.03] transition-transform' : 'cursor-default',
                                            isMine && !seg.ghost ? 'ring-2 ring-[#E8D200]' : '',
                                            !isMine && !seg.ghost ? 'border border-white/10' : '',
                                        ].join(' ')}
                                        style={{
                                            left: `calc(${(col / 7) * 100}% + ${BADGE_INSET}px)`,
                                            width: `calc(${(1 / 7) * 100}% - ${2 * BADGE_INSET}px)`,
                                            top: DAY_NUM_H + seg.lane * LANE_H + BADGE_INSET,
                                            height: LANE_H - 2 * BADGE_INSET,
                                            ...(seg.ghost ? { borderColor: fill, opacity: 0.85 } : null),
                                        }}
                                    >
                                        {seg.logo
                                            ? <img src={seg.logo} alt={seg.label} className={`w-full h-full object-contain p-1.5 ${seg.ghost ? 'opacity-70' : ''}`} />
                                            : <span className="text-sm font-black" style={{ color: seg.ghost ? fill : '#FFFFFF' }}>{(seg.label || '?')[0]?.toUpperCase()}</span>}
                                    </button>
                                );

                                return (
                                    <React.Fragment key={`${seg.id}-${si}`}>
                                        {lineRight > lineLeft && (
                                            <div
                                                onClick={onClick}
                                                title={seg.label}
                                                className={onSlotClick ? 'cursor-pointer' : ''}
                                                style={{
                                                    position: 'absolute',
                                                    left: `${lineLeft}%`,
                                                    width: `${lineRight - lineLeft}%`,
                                                    top: laneCenter - (seg.ghost ? 3 : 4),
                                                    height: seg.ghost ? 6 : 8,
                                                    background: seg.ghost
                                                        ? `repeating-linear-gradient(90deg, ${fill} 0 7px, transparent 7px 14px)`
                                                        : fill,
                                                    borderRadius: 9999,
                                                    ...(seg.ghost ? { opacity: 0.9 } : null),
                                                }}
                                            />
                                        )}
                                        {showStart && badge(seg.startCol, 'start')}
                                        {showEnd && badge(seg.endCol, 'end')}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
