import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Download, Printer, QrCode } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, PageTitle, Card, Micro, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { fetchGymProfile, fetchGymSummary } from './venueApi';
import { buildJoinKit, joinUrlFor, planJoinKit } from '../../studio/joinKit';
import { mediaFor, renderThumb } from '../../studio/kit';

// Get members on POWR. Everything in the portal counts members who picked
// this gym in the app, so the first job is telling them: a poster with a
// QR for the front desk, the same for the feed, and the link to send.

export const POSTER_KEY = (partnerId) => `powr_join_poster_${partnerId}`;

export default function VenuePoster() {
    const { gym } = useAuth();
    const toast = useToast();
    const [where, setWhere] = useState({ address: '', lat: null, lng: null });
    const [thumbs, setThumbs] = useState({});
    const [busy, setBusy] = useState(null);
    const [done, setDone] = useState(false);
    const abortRef = useRef(null);
    const g = { partner_id: gym.partner_id, name: gym.name, ...where };
    const url = joinUrlFor(g);

    useEffect(() => {
        fetchGymProfile(gym.partner_id)
            .then((p) => setWhere({ address: p?.address ?? '', lat: p?.lat ?? null, lng: p?.lng ?? null }))
            .catch(() => fetchGymSummary(gym.partner_id).then((s) => setWhere({ address: s?.gym?.address ?? '', lat: null, lng: null })).catch(() => {}));
    }, [gym.partner_id]);

    // Small renders of the poster in three shapes.
    useEffect(() => {
        let alive = true;
        const jobs = planJoinKit(g).filter((j) => j.kind === 'png');
        (async () => {
            const next = {};
            for (const job of jobs) {
                try { next[job.format] = await renderThumb(job, await mediaFor(null, new Map()), 0.22); } catch { next[job.format] = null; }
                if (alive) setThumbs({ ...next });
            }
        })();
        return () => { alive = false; };
    }, [gym.partner_id, gym.name, where.address, where.lat, where.lng]); // eslint-disable-line react-hooks/exhaustive-deps

    const make = async () => {
        const ac = new AbortController();
        abortRef.current = ac;
        setBusy({ fraction: 0 });
        try {
            const { blob } = await buildJoinKit({ gym: g, signal: ac.signal, onProgress: (fraction) => setBusy({ fraction }) });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `POWR - ${gym.name} - join poster.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
            try { localStorage.setItem(POSTER_KEY(gym.partner_id), new Date().toISOString()); } catch { /* fine */ }
            setDone(true);
        } catch (e) {
            if (!ac.signal.aborted) toast.error(e.message || 'The poster couldn’t be made.');
        } finally {
            setBusy(null);
            abortRef.current = null;
        }
    };
    const copy = async () => {
        try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { toast.error('Copy failed'); }
    };

    return (
        <Page>
            <PageTitle eyebrow="Members" title="Get your members on POWR" sub={gym.name} />
            <p className="text-[13px] text-[#777] leading-relaxed max-w-2xl mt-4">
                Everything here counts members who picked {gym.name} as their gym in the app. This poster does the telling: a QR that opens the app, and a line that says why.
            </p>

            <div className="mt-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
                <Card className="p-6 sm:p-8">
                    <div className="flex items-center gap-3 mb-6"><Printer size={15} className="text-[#8a7600]" /><Micro>The poster</Micro></div>
                    <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                        {[['post', 'Post', 96, 120], ['story', 'Story', 96, 171], ['square', 'Square', 120, 120]].map(([f, label, w, h]) => (
                            <figure key={f} className="shrink-0 m-0">
                                <div className="rounded-lg overflow-hidden bg-[#111]" style={{ width: w, height: h }}>
                                    {thumbs[f] ? <img src={thumbs[f]} alt="" data-thumb className="w-full h-full object-cover" /> : <div className="w-full h-full animate-pulse bg-[#1A1A1A]" />}
                                </div>
                                <figcaption className="mt-1.5 text-[9px] uppercase tracking-[0.15em] font-black text-[#888]">{label}</figcaption>
                            </figure>
                        ))}
                    </div>
                    <p className="text-[12px] text-[#888] leading-relaxed mt-5 max-w-xl">
                        One ZIP: A4 for the wall and A5 for the counter (3 mm bleed, any printer), plus Post, Story and Square for your feed, and the caption to paste. Type on black, the house look, no photo needed.
                    </p>
                    <div className="flex flex-wrap items-center gap-4 mt-6">
                        {busy ? (
                            <>
                                <div className="w-56">
                                    <div className="h-2 rounded-full bg-[#F4F4F1] overflow-hidden"><div className="h-full rounded-full bg-[#E8D200] transition-[width] duration-300" style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></div>
                                </div>
                                <button type="button" onClick={() => abortRef.current?.abort()} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA]">Cancel</button>
                            </>
                        ) : (
                            <button type="button" onClick={make} className={BTN_GOLD}><Download size={14} /> Download the poster kit</button>
                        )}
                        {done && !busy && <span className="text-[11px] font-bold text-[#0B7A57]">Downloaded. Print the A4, post the rest.</span>}
                    </div>
                </Card>

                <Card className="p-6 sm:p-8">
                    <div className="flex items-center gap-3 mb-6"><QrCode size={15} className="text-[#8a7600]" /><Micro>The link</Micro></div>
                    <div className="flex flex-col items-center gap-4">
                        <div className="p-4 bg-white border border-[#E6E6E1] rounded-2xl"><QRCodeSVG value={url} size={148} level="M" /></div>
                        <code className="w-full text-[11px] font-mono text-[#666] bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2.5 truncate">{url}</code>
                        <button type="button" onClick={copy} className={`${BTN_GHOST} w-full`}><Copy size={13} /> Copy the link</button>
                    </div>
                    <p className="text-[11px] text-[#AAAAAA] leading-relaxed mt-5">
                        Opens the POWR app, or the app store for someone new. Send it in your welcome email or WhatsApp group, and ask people to pick {gym.name} as their gym in the app: that is what puts them on your board.
                    </p>
                </Card>
            </div>

            <Card className="p-6 sm:p-8">
                <Micro className="mb-4">Three places it works</Micro>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-[13px]">
                    {[
                        ['1', 'The front desk', 'The A5 by the till, the A4 on the wall people face when they check in. Staff point at it at induction.'],
                        ['2', 'Your feed', 'The Post and the Story once, then again with the first event. The caption is in the ZIP.'],
                        ['3', 'The welcome email', 'The link, one line: every session here counts, get the app and pick us as your gym.'],
                    ].map(([n, t, body]) => (
                        <div key={n} className="flex gap-3">
                            <span className="w-7 h-7 rounded-full bg-[#F4F4F1] flex items-center justify-center text-[11px] font-black text-[#8a7600] shrink-0">{n}</span>
                            <div><div className="font-bold">{t}</div><p className="text-[12px] text-[#888] leading-relaxed mt-1">{body}</p></div>
                        </div>
                    ))}
                </div>
                <div className="mt-6 pt-5 border-t border-[#F0F0EC] flex flex-wrap gap-3">
                    <Link to="/venue/screens" className={BTN_GHOST}>Put the board on the TV</Link>
                    <Link to="/venue/events/new" className={BTN_GHOST}>Run your first event</Link>
                </div>
            </Card>
        </Page>
    );
}
