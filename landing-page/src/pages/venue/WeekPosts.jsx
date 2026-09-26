import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Images, Lock } from 'lucide-react';
import { Card, Micro } from '../../components/portal/ui';
import { useToast } from '../../lib/toast';
import { fetchGymProfile } from './venueApi';
import { eventFacts, fetchImage, shortName } from '../../studio/data';
import { gymStudioData } from '../../studio/gymData';
import { FORMATS } from '../../studio/formats';
import { assetFrom, mediaFor, postsOf, releaseMedia, renderStill, renderThumb } from '../../studio/kit';
import { buildWeekKit, planWeekKit } from '../../studio/weekKit';
import { PACKAGE_LABEL } from './packages';
import { statusKey } from './eventUi';
import PostLightbox from './PostLightbox';

// The week's posts, ready to go: drawn in the browser from the gym's own
// numbers and photo (studio/weekKit.js decides which the week can carry and
// what they say). Tap one to see it at every size; download one, or all of
// them in one ZIP with the captions. Every package sees them; downloading is
// Clash Pro (it's the Studio), except the join poster, which is on every
// package because it puts members on the board.

const DAY = 86_400_000;
const THUMB_SCALE = 0.3;     // 324×405 for a post: sharp at 168px wide on a 2× screen
const RESULTS_FOR = 14 * DAY;

const PILL = 'inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.12em] whitespace-nowrap transition-all disabled:opacity-50';

function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|]+/g, '-');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// A post's look on screen changes only when one of these does.
const keyOf = (job) => JSON.stringify([job.template, job.fields, job.look, job.style, job.asset?.id ?? null]);

/** "21–27 Sep", or "29 Sep – 5 Oct" across a month. */
function weekDates(startIso, tz) {
    if (!startIso) return 'this week';
    const f = (d, o) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }).format(d);
    const month = (d) => f(d, { month: 'short' }).replace('Sept', 'Sep');
    // Monday to Sunday: six days on from the start, whatever the clock change does to the end.
    const a = new Date(startIso);
    const b = new Date(a.getTime() + 6 * DAY + 12 * 3_600_000);
    return month(a) === month(b)
        ? `${f(a, { day: 'numeric' })}–${f(b, { day: 'numeric' })} ${month(b)}`
        : `${f(a, { day: 'numeric' })} ${month(a)} – ${f(b, { day: 'numeric' })} ${month(b)}`;
}

/** 0 = Monday, in the gym's time. */
function dayIndexIn(tz) {
    const d = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(new Date());
    return Math.max(0, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(d));
}

export default function WeekPosts({ gym, name, summary, insights, standing, events, pkg, tz }) {
    const toast = useToast();
    const canDownload = !!pkg?.features?.studio;
    const [where, setWhere] = useState(null);          // { address, lat, lng }: the join QR opens the gym's card
    const [photo, setPhoto] = useState(undefined);     // the gym's picture as an asset; null when there's none; undefined while loading
    const [eventPhoto, setEventPhoto] = useState(null);
    const [results, setResults] = useState(null);      // a recently revealed event's facts, with its standings
    const [thumbs, setThumbs] = useState({});
    const [open, setOpen] = useState(null);
    const [bigFormat, setBigFormat] = useState('post');
    const [busy, setBusy] = useState(null);            // { fraction } while the ZIP is made
    const [edges, setEdges] = useState({ left: false, right: false });
    const media = useRef(new Map());                   // loaded pictures, by asset id; shared with the ZIP
    const drawn = useRef(new Map());                   // keyOf(job) → thumbnail, across refreshes
    const abortRef = useRef(null);
    const scroller = useRef(null);

    useEffect(() => {
        let alive = true;
        fetchGymProfile(gym.partner_id)
            .then((p) => { if (alive) setWhere({ address: p?.address ?? '', lat: p?.lat ?? null, lng: p?.lng ?? null }); })
            .catch(() => { if (alive) setWhere({ address: summary.gym?.address ?? '', lat: null, lng: null }); });
        return () => { alive = false; };
    }, [gym.partner_id]); // eslint-disable-line react-hooks/exhaustive-deps

    // The gym's own picture, from its POWR listing (our storage, so the canvas can export it).
    const photoUrl = summary.gym?.image_url || null;
    useEffect(() => {
        let alive = true;
        if (!photoUrl) { setPhoto(null); return undefined; }
        setPhoto(undefined);
        fetchImage(photoUrl, 'gym-photo')
            .then((file) => { if (alive) setPhoto(assetFrom(file, `gym:${photoUrl}`)); })
            .catch(() => { if (alive) setPhoto(null); });
        return () => { alive = false; };
    }, [photoUrl]);

    // The next published event, and one of the gym's own revealed in the last fortnight.
    const { next, revealed } = useMemo(() => {
        const rows = (events ?? []).filter((e) => !e.hidden);
        const upcoming = rows
            .filter((e) => ['scheduled', 'live'].includes(statusKey(e)))
            .sort((a, b) => String(a.window_start_at).localeCompare(String(b.window_start_at)))[0] ?? null;
        const done = rows
            .filter((e) => e.managed_by === 'gym' && e.revealed_at && Date.now() - new Date(e.revealed_at).getTime() < RESULTS_FOR)
            .sort((a, b) => String(b.revealed_at).localeCompare(String(a.revealed_at)))[0] ?? null;
        return { next: upcoming, revealed: done };
    }, [events]);
    const place = useMemo(() => ({ name, address: where?.address ?? summary.gym?.address ?? '' }), [name, where, summary.gym?.address]);

    useEffect(() => {
        let alive = true;
        if (!revealed) { setResults(null); return undefined; }
        gymStudioData({ partner_id: gym.partner_id, ...place }).eventStandings(revealed.id, 5)
            .then((standings) => { if (alive) setResults({ ...eventFacts({ ...revealed, partners: place }), standings }); })
            .catch(() => { if (alive) setResults(null); });
        return () => { alive = false; };
    }, [revealed, gym.partner_id, place]);

    const eventPhotoUrl = (results ? revealed : next)?.promo_media_url || null;
    useEffect(() => {
        let alive = true;
        if (!eventPhotoUrl) { setEventPhoto(null); return undefined; }
        fetchImage(eventPhotoUrl, eventPhotoUrl.split('/').pop().split('?')[0] || 'event')
            .then((file) => { if (alive) setEventPhoto(assetFrom(file, `event:${eventPhotoUrl}`)); })
            .catch(() => { if (alive) setEventPhoto(null); });
        return () => { alive = false; };
    }, [eventPhotoUrl]);

    const week = useMemo(() => {
        if (!where || photo === undefined) return null;
        const weeks = insights?.weeks ?? [];
        return {
            gym: { partner_id: gym.partner_id, name, address: where.address, lat: where.lat, lng: where.lng },
            photo, eventPhoto,
            label: weekDates(summary.week_start_at, tz),
            dayIndex: dayIndexIn(tz),
            now: { sessions: summary.week?.sessions ?? 0, athletes: summary.week?.athletes ?? 0, newFaces: summary.new_faces ?? 0 },
            last: { sessions: summary.last_week?.sessions ?? 0, athletes: summary.last_week?.athletes ?? 0, newFaces: weeks.length >= 2 ? (weeks[weeks.length - 2].new_athletes ?? 0) : 0 },
            top: (insights?.top ?? []).map((r) => ({ name: shortName(r.display_name || r.username), points: r.points ?? 0 })),
            league: standing?.host && standing.local.length >= 2 && standing.rival
                ? { rank: standing.rank, count: standing.local.length, radiusKm: standing.radius, rival: { name: standing.rival.name }, ahead: standing.ahead, gap: standing.gap }
                : null,
            next: next ? eventFacts({ ...next, partners: place }) : null,
            results,
        };
    }, [where, photo, eventPhoto, insights, gym.partner_id, name, summary, tz, standing, next, place, results]);

    const jobs = useMemo(() => (week ? planWeekKit(week) : []), [week]);
    const posts = useMemo(() => postsOf(jobs), [jobs]);
    const allowed = useCallback((job) => canDownload || !!job.free, [canDownload]);

    // Small renders, one at a time; a post whose words and picture haven't
    // changed keeps its thumbnail across the minute-by-minute refresh.
    useEffect(() => {
        let alive = true;
        (async () => {
            for (const job of posts) {
                const k = keyOf(job);
                if (drawn.current.has(k)) continue;
                try {
                    const m = await mediaFor(job.asset, media.current);
                    if (!alive) return;
                    drawn.current.set(k, await renderThumb(job, m, THUMB_SCALE));
                } catch { drawn.current.set(k, null); }
                if (alive) setThumbs(Object.fromEntries(drawn.current));
            }
            if (alive) setThumbs(Object.fromEntries(drawn.current));
        })();
        return () => { alive = false; };
    }, [posts]);
    useEffect(() => { const m = media.current; return () => { for (const x of m.values()) releaseMedia(x); m.clear(); }; }, []);

    // The arrows show only when there's more to scroll to.
    const measure = useCallback(() => {
        const el = scroller.current;
        if (!el) return;
        setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    }, []);
    useEffect(() => {
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [measure, posts.length]);
    const slide = (dir) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: 'smooth' });

    const downloadOne = async (job) => {
        try {
            const m = await mediaFor(job.asset, media.current);
            save(await renderStill(job, m), `${name} - ${job.label} - ${FORMATS[job.format].label}.${job.kind}`);
        } catch (e) { toast.error(e.message || 'That post couldn’t be made.'); }
    };
    const downloadAll = async () => {
        const ac = new AbortController();
        abortRef.current = ac;
        setBusy({ fraction: 0 });
        try {
            const { blob, names } = await buildWeekKit({ week, jobs, signal: ac.signal, mediaCache: media.current, onProgress: (fraction) => setBusy({ fraction }) });
            save(blob, `POWR - ${name} - ${week.label}.zip`);
            toast.success(`${posts.length} posts, ${names.length} files`);
        } catch (e) {
            if (!ac.signal.aborted) toast.error(e.message || 'The posts couldn’t be made.');
        } finally {
            setBusy(null);
            abortRef.current = null;
        }
    };

    const sub = !week ? 'Making this week’s posts…'
        : canDownload ? `Made from your week${photo ? ', over your gym’s photo' : ''}. Tap one to see it big; Download all gets every post at three sizes, with the captions.`
        : `Made from your week. Downloading them comes with ${PACKAGE_LABEL.pro}; the join poster is free.`;

    return (
        <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-x-6 gap-y-3 mb-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5"><Images size={14} className="text-[#8a7600]" /><Micro>Posts for this week</Micro></div>
                    <p className="text-[12px] text-[#888] leading-snug mt-1.5">
                        {sub}
                        {week && !photo && (
                            <> Add your gym’s photo in <Link to="/venue/settings" className="font-bold"><span className="text-[#8a7600]">Settings</span></Link> and it goes behind them.</>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <div className={`${edges.left || edges.right ? 'hidden sm:flex' : 'hidden'} items-center gap-1.5 mr-1`}>
                        <button type="button" onClick={() => slide(-1)} disabled={!edges.left} aria-label="Earlier posts"
                            className="w-9 h-9 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#1A1A1A] disabled:opacity-30 hover:border-[#E8D200]/50"><ChevronLeft size={15} /></button>
                        <button type="button" onClick={() => slide(1)} disabled={!edges.right} aria-label="More posts"
                            className="w-9 h-9 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#1A1A1A] disabled:opacity-30 hover:border-[#E8D200]/50"><ChevronRight size={15} /></button>
                    </div>
                    {canDownload ? (
                        busy ? (
                            <div className="flex items-center gap-3">
                                <div className="w-32 h-2 rounded-full bg-[#F4F4F1] overflow-hidden" role="progressbar" aria-valuenow={Math.round(busy.fraction * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Making the posts">
                                    <div className="h-full rounded-full bg-[#E8D200] transition-[width] duration-300" style={{ width: `${Math.round(busy.fraction * 100)}%` }} />
                                </div>
                                <button type="button" onClick={() => abortRef.current?.abort()} className="text-[10px] uppercase tracking-[0.2em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">Cancel</button>
                            </div>
                        ) : (
                            <button type="button" onClick={downloadAll} disabled={!week || !posts.length} className={`${PILL} bg-[#E8D200] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(232,210,0,0.25)]`}>
                                <Download size={12} style={{ color: '#080808' }} /><span style={{ color: '#080808' }}>Download all</span>
                            </button>
                        )
                    ) : (
                        <Link to="/venue/package" className={`${PILL} bg-[#F4F4F1] border border-[#E6E6E1] hover:border-[#E8D200]/50`} title={`Downloading every post comes with ${PACKAGE_LABEL.pro}`}>
                            <Lock size={11} className="text-[#8a7600]" /><span className="text-[#8a7600]">{PACKAGE_LABEL.pro}</span>
                        </Link>
                    )}
                </div>
            </div>

            <div ref={scroller} onScroll={measure} className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-1" style={{ scrollbarWidth: 'none' }} aria-label="This week’s posts">
                {!week
                    ? Array.from({ length: 5 }, (_, i) => <div key={i} className="shrink-0 w-[150px] sm:w-[168px] aspect-[4/5] rounded-xl bg-[#1A1A1A] animate-pulse" />)
                    : posts.map((job, i) => {
                        const src = thumbs[keyOf(job)];
                        return (
                            <figure key={job.stem} className="shrink-0 w-[150px] sm:w-[168px] m-0 snap-start">
                                <button type="button" onClick={() => { setBigFormat('post'); setOpen(i); }} aria-label={`See ${job.label} large`}
                                    className="block w-full aspect-[4/5] rounded-xl overflow-hidden bg-[#111] border-2 border-transparent hover:border-[#E8D200] focus-visible:border-[#E8D200] outline-none transition-colors">
                                    {src ? <img src={src} alt="" data-thumb className="w-full h-full object-cover" /> : src === null ? <div className="w-full h-full flex items-center justify-center text-[10px] text-white/50">Couldn’t draw this one</div> : <div className="w-full h-full animate-pulse bg-[#1A1A1A]" />}
                                </button>
                                <figcaption className="mt-2 flex items-center justify-between gap-2">
                                    <span className="min-w-0 truncate text-[10px] uppercase tracking-[0.15em] font-black text-[#1A1A1A]">{job.label}</span>
                                    {allowed(job) ? (
                                        <button type="button" onClick={() => downloadOne(job)} aria-label={`Download ${job.label}`} title="Download the Post size"
                                            className="w-7 h-7 shrink-0 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center hover:border-[#E8D200]/60">
                                            <Download size={12} className="text-[#8a7600]" />
                                        </button>
                                    ) : (
                                        <Link to="/venue/package" aria-label={`Downloading comes with ${PACKAGE_LABEL.pro}`} title={`Downloading comes with ${PACKAGE_LABEL.pro}`}
                                            className="w-7 h-7 shrink-0 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                                            <Lock size={11} className="text-[#BBBBBB]" />
                                        </Link>
                                    )}
                                </figcaption>
                            </figure>
                        );
                    })}
            </div>

            {open !== null && posts[open] && (
                <PostLightbox posts={posts} jobs={jobs} index={open} setIndex={setOpen} format={bigFormat} setFormat={setBigFormat}
                    onClose={() => setOpen(null)} cache={media.current}
                    onDownload={downloadOne} locked={(job) => !allowed(job)} lockLabel={PACKAGE_LABEL.pro} />
            )}
        </Card>
    );
}
