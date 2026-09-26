import React, { useEffect, useMemo, useState } from 'react';
import { DoorOpen, Search } from 'lucide-react';
import { Card, Micro, INPUT, BTN_GHOST } from '../../components/portal/ui';
import { fetchEventDoor, checkinAtDoor } from './venueApi';
import { boardName } from '../../../../shared/gymBoard.ts';
import { ukTime } from '../../../../supabase/functions/_shared/eventPushCopy.ts';
import { fmtDay } from './eventUi';

// The door on a finale night. Everyone who registered is the guest list.
// POWR's geofence sees most people arrive and pays the finale bonus by
// itself; the front desk checks in anyone it missed, by hand, and that pays
// the same bonus once. Hand check-ins are capped so the door can't be used
// to hand out points.

const HOUR = 3600_000;

function Avatar({ row }) {
    const name = boardName(row);
    return row.avatar_url
        ? <img src={row.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-[#E6E6E1] shrink-0" />
        : <div className="w-9 h-9 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[11px] font-black text-[#8a7600] uppercase shrink-0">{name?.[0] ?? '?'}</div>;
}

/** Is the door worth showing: a finale bonus, and the night near enough. */
export function doorApplies(ev) {
    if (!ev || ev.managed_by !== 'gym' || !(ev.attendance_bonus_points > 0)) return false;
    if (!['live', 'locked'].includes(ev.status)) return false;
    const from = ev.doors_open_at ? new Date(ev.doors_open_at) : new Date(ev.lock_at ?? ev.window_end_at);
    const to = ev.doors_close_at ? new Date(ev.doors_close_at) : new Date(from.getTime() + 12 * HOUR);
    const now = Date.now();
    return now >= from.getTime() - 24 * HOUR && now <= to.getTime() + 6 * HOUR;
}

export default function EventDoor({ ev, toast }) {
    const [door, setDoor] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [q, setQ] = useState('');

    const load = async () => {
        try { setDoor(await fetchEventDoor(ev.id)); setError(null); } catch (e) { setError(e.message); }
    };
    useEffect(() => { load(); }, [ev.id]); // eslint-disable-line react-hooks/exhaustive-deps
    // People arrive while the page is open.
    useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t); }, [ev.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const open = useMemo(() => {
        if (!door?.band?.from) return false;
        const from = new Date(door.band.from).getTime() - 2 * HOUR;
        const to = (door.band.to ? new Date(door.band.to).getTime() : new Date(door.band.from).getTime() + 12 * HOUR) + 6 * HOUR;
        return Date.now() >= from && Date.now() <= to;
    }, [door]);

    const rows = useMemo(() => {
        const list = door?.rows ?? [];
        const s = q.trim().toLowerCase();
        if (!s) return list;
        return list.filter((r) => boardName(r).toLowerCase().includes(s) || (r.member_id ?? '').toLowerCase().includes(s));
    }, [door, q]);

    const checkin = async (row) => {
        if (!window.confirm(`Check ${boardName(row)} in? They get +${door.points} POWR now.`)) return;
        setBusy(row.user_id);
        try {
            setDoor(await checkinAtDoor(ev.id, row.user_id));
            toast.success(`${boardName(row)} checked in`);
        } catch (e) { toast.error(e.message); }
        finally { setBusy(null); }
    };

    const capLeft = door ? Math.max(0, door.hand_cap - door.by_hand) : 0;

    return (
        <Card className="p-6 sm:p-8" glow={open}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-3"><DoorOpen size={15} className="text-[#8a7600]" /><Micro gold>The door</Micro></div>
                {door && <span className="text-[10px] uppercase tracking-[0.25em] font-black text-[#888]">+{door.points} POWR for coming</span>}
            </div>
            {door?.band?.from && (
                <p className="text-[12px] text-[#888] leading-relaxed">
                    Doors {fmtDay(door.band.from)}, {ukTime(door.band.from)}{door.band.to ? `–${ukTime(door.band.to)}` : ''}. POWR sees most people arrive and pays them itself
                    {door.auto_paid_at ? ' (done)' : ' once the doors close'}. Check in anyone it missed, and they get the bonus now.
                </p>
            )}

            {error && <p className="text-[12px] text-red-600 mt-3">{error} <button type="button" onClick={load} className="underline">Try again</button></p>}
            {!door && !error && <p className="text-[12px] text-[#AAAAAA] mt-3">Loading the door…</p>}

            {door && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                        {[['Registered', door.registered], ['Seen by POWR', door.seen], ['Paid', door.paid], ['By hand', `${door.by_hand} of ${door.hand_cap}`]].map(([l, v]) => (
                            <div key={l} className="rounded-2xl bg-[#F4F4F1] px-4 py-3">
                                <div className="text-2xl font-light tabular-nums text-[#1A1A1A]">{v}</div>
                                <div className="text-[9px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] mt-0.5">{l}</div>
                            </div>
                        ))}
                    </div>

                    {!open && <p className="text-[11px] font-bold text-[#B45309] mt-4">The door opens two hours before the finale and closes six hours after. Until then this is the guest list.</p>}

                    <div className="relative mt-5">
                        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                        <input className={`${INPUT} pl-11`} placeholder="Find someone by name or POWR ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find someone" />
                    </div>

                    {rows.length === 0 ? (
                        <p className="text-sm text-[#888] font-light mt-5">{door.rows.length === 0 ? 'Nobody has joined this event.' : 'Nobody matches that.'}</p>
                    ) : (
                        <div className="divide-y divide-[#F0F0EC] mt-3">
                            {rows.map((row) => {
                                const paid = !!row.paid_at;
                                return (
                                    <div key={row.user_id} className="flex items-center gap-4 py-3">
                                        <Avatar row={row} />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-bold truncate">{boardName(row)}</div>
                                            <div className="text-[10px] font-bold text-[#AAAAAA]">POWR ID {row.member_id ?? '—'}</div>
                                        </div>
                                        {paid ? (
                                            <span className="text-[9px] uppercase tracking-[0.2em] font-black text-[#0B7A57]">Paid{row.paid_source === 'door' ? ' · by hand' : ''}</span>
                                        ) : row.seen ? (
                                            <span className="text-[9px] uppercase tracking-[0.2em] font-black text-[#8a7600]">Here · pays itself</span>
                                        ) : (
                                            <button type="button" disabled={!open || !!busy || capLeft === 0} onClick={() => checkin(row)} className={`${BTN_GHOST} h-9 px-4`}>
                                                {busy === row.user_id ? 'Working…' : 'Check in'}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {capLeft === 0 && door.rows.some((r) => !r.paid_at && !r.seen) && (
                        <p className="text-[11px] font-bold text-[#B45309] mt-4">That’s the limit for check-ins by hand tonight. Ask POWR if more people are here.</p>
                    )}
                </>
            )}
        </Card>
    );
}
