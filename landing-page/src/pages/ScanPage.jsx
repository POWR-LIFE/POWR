import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import { AlertCircle, Camera as CameraIcon, Check, ChevronDown, Clock, LogOut, Monitor, X } from 'lucide-react';
import { useAuth } from '../App';
import {
    formatPence, kioskStand, scanCheck, scanConfirm, scanSession, scanToday,
} from '../lib/inStore';
import {
    STAND_STEP_SECONDS, normaliseTypedCode, parseInStoreScan, standRotatingKey, standUrl,
} from '../../../shared/inStore.ts';

// powr.life/scan: the staff side of in-store redemption.
//
// Who can use it: a member of staff with their personal scan link
// (/scan#k=<token>, remembered on the device), or a signed-in partner portal
// user. ?kiosk=1 is the till-tablet layout: it shows the shop's rotating QR
// for members to scan, scans vouchers with the front camera, and keeps the
// screen awake.
//
// Flow: scan (or type) -> in_store_scan_check says valid / used / other /
// stale / closed -> staff tap Confirm (optional spend) -> in_store_scan_confirm.
// Nothing is used up until Confirm.

const TOKEN_KEY = 'powr:scan:token';
const SITE_KEY = 'powr:scan:site';

const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function readToken() {
    const m = /(?:^|[#&])k=([0-9a-f]{32})(?:&|$)/i.exec(window.location.hash || '');
    if (m) {
        store.set(TOKEN_KEY, m[1].toLowerCase());
        // Drop the token from the address bar so it isn't shared by accident.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        return m[1].toLowerCase();
    }
    return store.get(TOKEN_KEY);
}

const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// ── Camera ───────────────────────────────────────────────────────────────────

function Camera({ facing, paused, onCode, label }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const onCodeRef = useRef(onCode);
    const pausedRef = useRef(paused);
    const [state, setState] = useState('starting'); // starting | live | denied | unavailable
    onCodeRef.current = onCode;
    pausedRef.current = paused;

    useEffect(() => {
        let stream = null;
        let raf = 0;
        let stopped = false;
        let last = 0;
        let lastText = '';
        let lastAt = 0;
        (async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera'), { name: 'NotFoundError' });
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
                });
                if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
                const v = videoRef.current;
                v.srcObject = stream;
                await v.play().catch(() => {});
                setState('live');
                const tick = (t) => {
                    if (stopped) return;
                    raf = requestAnimationFrame(tick);
                    if (pausedRef.current || t - last < 160 || v.readyState < 2 || !v.videoWidth) return;
                    last = t;
                    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
                    const w = Math.round(v.videoWidth * scale);
                    const h = Math.round(v.videoHeight * scale);
                    const c = canvasRef.current;
                    if (c.width !== w) c.width = w;
                    if (c.height !== h) c.height = h;
                    const ctx = c.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(v, 0, 0, w, h);
                    const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
                    if (!found?.data) return;
                    const now = Date.now();
                    if (found.data === lastText && now - lastAt < 4000) return;
                    lastText = found.data;
                    lastAt = now;
                    onCodeRef.current(found.data);
                };
                raf = requestAnimationFrame(tick);
            } catch (err) {
                setState(err?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
            }
        })();
        return () => {
            stopped = true;
            cancelAnimationFrame(raf);
            stream?.getTracks().forEach(t => t.stop());
        };
    }, [facing]);

    return (
        <div className="relative w-full aspect-square max-h-[60vh] rounded-3xl bg-[#111] overflow-hidden flex items-center justify-center">
            <video ref={videoRef} playsInline muted autoPlay aria-label={label}
                className={`absolute inset-0 w-full h-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${state === 'live' ? '' : 'opacity-0'}`} />
            <canvas ref={canvasRef} className="hidden" />
            {['left-6 top-6 border-l-[3px] border-t-[3px] rounded-tl-xl', 'right-6 top-6 border-r-[3px] border-t-[3px] rounded-tr-xl',
              'left-6 bottom-6 border-l-[3px] border-b-[3px] rounded-bl-xl', 'right-6 bottom-6 border-r-[3px] border-b-[3px] rounded-br-xl'].map(c => (
                <div key={c} className={`absolute w-10 h-10 border-[#E8D200] ${c}`} />
            ))}
            {state === 'live' && !paused && <div className="absolute left-9 right-9 top-10 h-[2px] bg-[#E8D200]/70 animate-[powrScan_2.6s_ease-in-out_infinite]" />}
            {state !== 'live' && (
                <div className="relative z-10 px-8 text-center text-white/75 text-[14px] leading-relaxed">
                    {state === 'starting' && 'Starting the camera…'}
                    {state === 'denied' && 'Camera blocked. Allow camera access for this site in your browser settings, or type the code below.'}
                    {state === 'unavailable' && 'No camera here. Type the 6-character code from the member’s phone below.'}
                </div>
            )}
            {state === 'live' && <span className="absolute bottom-8 inset-x-0 text-center text-white/70 text-[13px]">{label}</span>}
            <style>{'@keyframes powrScan{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(min(60vh,100vw) - 110px))}}'}</style>
        </div>
    );
}

// ── Results ──────────────────────────────────────────────────────────────────

function ResultCard({ result, offset, site, askSpend, onConfirm, onReset, busy }) {
    const [spend, setSpend] = useState('');
    const [now, setNow] = useState(() => Date.now() + offset);
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now() + offset), 1000);
        return () => clearInterval(t);
    }, [offset]);

    const banner = (tone, icon, text) => (
        <div className={`px-5 py-3.5 flex items-center gap-2.5 text-[12px] font-black tracking-[0.15em] ${tone}`}>{icon}{text}</div>
    );
    const shell = (head, body) => (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden" role="status" aria-live="assertive">{head}<div className="p-5 flex flex-col gap-3">{body}</div></div>
    );
    const again = (label = 'Scan another') => (
        <button type="button" onClick={onReset} className="mt-1 h-13 py-4 rounded-full border border-[#E6E6E1] bg-white text-[11px] font-black uppercase tracking-[0.15em]">{label}</button>
    );

    if (result.result === 'done') {
        return (
            <div className="py-10 flex flex-col items-center gap-3 text-center" role="status" aria-live="assertive">
                <div className="w-28 h-28 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center"><Check size={48} strokeWidth={2.2} /></div>
                <div className="text-3xl font-light tracking-tight mt-2">Discount applied</div>
                <p className="text-[14px] text-[#666]">Logged{site ? ` for ${site}` : ''} at {hhmm(result.confirmed_at)}.</p>
                <button type="button" onClick={onReset} className="mt-6 w-full h-14 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.15em]">Scan next</button>
            </div>
        );
    }
    if (result.result === 'valid') {
        const left = Math.max(0, Math.round((new Date(result.expires_at).getTime() - now) / 1000));
        const pence = spend.trim() ? Math.round(parseFloat(spend.replace(/[^0-9.]/g, '')) * 100) : null;
        return shell(
            banner('bg-emerald-50 text-emerald-800', <Check size={18} strokeWidth={3} />, 'VALID'),
            <>
                <div className="text-[28px] font-light tracking-tight leading-tight">{result.reward_title}</div>
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-[#E8D200] text-[#080808] flex items-center justify-center text-[13px] font-extrabold">{result.member_label.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}</div>
                    <div>
                        <div className="text-[15px] font-semibold">{result.member_label}</div>
                        <div className="text-[12px] text-[#666]">
                            Opened {hhmm(result.opened_at)}{result.swiped ? ' · already swiped on their phone' : left > 0 ? ` · closes in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}
                        </div>
                    </div>
                </div>
                {askSpend && (
                    <div className="flex flex-col gap-2">
                        <label htmlFor="scan-spend" className="text-[9px] font-black tracking-[0.2em] text-[#888]">WHAT DID THEY SPEND? (OPTIONAL)</label>
                        <div className="flex items-center h-12 rounded-2xl border border-[#E6E6E1] bg-[#F4F4F1] px-4 gap-1.5">
                            <span className="text-[16px] text-[#666]">£</span>
                            <input id="scan-spend" inputMode="decimal" value={spend} onChange={e => setSpend(e.target.value)} placeholder="0.00"
                                className="flex-1 min-w-0 bg-transparent outline-none text-[16px]" />
                        </div>
                    </div>
                )}
                <button type="button" disabled={busy} onClick={() => onConfirm(Number.isFinite(pence) ? pence : null)}
                    className="h-14 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.15em] disabled:opacity-50">
                    {busy ? 'Confirming…' : 'Confirm and apply discount'}
                </button>
                <button type="button" onClick={onReset} className="h-11 text-[10px] font-black uppercase tracking-[0.15em] text-[#666]">Cancel</button>
            </>,
        );
    }
    const RED = 'bg-[#FDEDE3] text-[#A93A08]';
    const GREY = 'bg-[#EFEFEC] text-[#444]';
    switch (result.result) {
        case 'used':
            return shell(banner(RED, <X size={18} strokeWidth={3} />, 'ALREADY USED'), <>
                {result.reward_title && <div className="text-[24px] font-light tracking-tight">{result.reward_title}</div>}
                <p className="text-[14px] text-[#555] leading-relaxed">
                    {result.used_at ? `Used${result.used_site_name ? ` at ${result.used_site_name}` : ''} on ${new Date(result.used_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${hhmm(result.used_at)}.` : 'This reward has been used.'}
                </p>
                <p className="text-[15px] font-bold">Don't apply the discount.</p>{again()}
            </>);
        case 'other':
            return shell(banner(GREY, <AlertCircle size={18} />, 'NOT ONE OF YOUR REWARDS'), <>
                <p className="text-[14px] text-[#555]">This voucher is for a different shop.</p>
                <p className="text-[15px] font-bold">Don't apply a discount.</p>{again()}
            </>);
        case 'stale':
            return shell(banner(RED, <AlertCircle size={18} />, 'OLD CODE'), <>
                <p className="text-[14px] text-[#555] leading-relaxed">That code is more than a minute old, which usually means a screenshot. Ask the member to show the live voucher in the POWR app.</p>{again('Scan again')}
            </>);
        case 'closed':
            return shell(banner(GREY, <Clock size={18} />, 'VOUCHER CLOSED'), <>
                <p className="text-[14px] text-[#555] leading-relaxed">Time ran out on this one. Ask the member to tap Use in store again for a fresh voucher.</p>{again('Scan again')}
            </>);
        case 'not_found':
            return shell(banner(GREY, <AlertCircle size={18} />, 'NO MATCH'), <>
                <p className="text-[14px] text-[#555] leading-relaxed">No live voucher matches that code. Check the code on the member's phone, or scan the QR instead.</p>{again('Try again')}
            </>);
        case 'not_powr':
            return shell(banner(GREY, <AlertCircle size={18} />, 'NOT A POWR VOUCHER'), <>
                <p className="text-[14px] text-[#555] leading-relaxed">{result.message ?? 'That code isn’t a POWR voucher. Scan the QR on the member’s phone.'}</p>{again('Scan again')}
            </>);
        default:
            return shell(banner(RED, <AlertCircle size={18} />, 'SOMETHING WENT WRONG'), <>
                <p className="text-[14px] text-[#555] leading-relaxed">{result.message ?? 'Check the connection and scan again.'}</p>{again('Scan again')}
            </>);
    }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ScanPage() {
    const { user, loading: authLoading } = useAuth();
    const [params, setParams] = useSearchParams();
    const kiosk = params.get('kiosk') === '1';
    const [token, setToken] = useState(() => readToken());
    const [session, setSession] = useState(null);
    const [sessionError, setSessionError] = useState(null);
    const [offset, setOffset] = useState(0);
    const [siteId, setSiteId] = useState(null);
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const [typed, setTyped] = useState('');
    const [today, setToday] = useState(null);
    const [kioskMode, setKioskMode] = useState('show'); // show | scan

    useEffect(() => { document.title = 'POWR · Scan'; }, []);

    useEffect(() => {
        if (authLoading) return;
        if (!token && !user) { setSessionError('signed_out'); return; }
        let cancelled = false;
        scanSession(token).then((s) => {
            if (cancelled) return;
            setSession(s);
            setOffset(new Date(s.server_now).getTime() - Date.now());
            const remembered = store.get(SITE_KEY);
            const pick = [remembered, s.staff?.site_id, s.sites[0]?.id].find(id => id && s.sites.some(x => x.id === id));
            setSiteId(pick ?? null);
        }).catch((err) => { if (!cancelled) setSessionError(err.message); });
        return () => { cancelled = true; };
    }, [token, user, authLoading]);

    const site = session?.sites.find(s => s.id === siteId) ?? null;
    const askSpend = result?.ask_spend ?? false;

    const loadToday = useCallback(() => {
        if (!session) return;
        scanToday(token, siteId).then(setToday).catch(() => {});
    }, [session, token, siteId]);
    useEffect(() => {
        loadToday();
        const t = setInterval(loadToday, 60_000);
        return () => clearInterval(t);
    }, [loadToday]);

    // Kiosk: keep the screen on.
    useEffect(() => {
        if (!kiosk || !('wakeLock' in navigator)) return;
        let lock = null;
        const grab = () => navigator.wakeLock.request('screen').then(l => { lock = l; }).catch(() => {});
        grab();
        const onVis = () => { if (document.visibilityState === 'visible') grab(); };
        document.addEventListener('visibilitychange', onVis);
        return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); };
    }, [kiosk]);

    const runCheck = useCallback(async (q) => {
        setBusy(true);
        try {
            const r = await scanCheck(token, siteId, q);
            setResult(r);
            navigator.vibrate?.(r.result === 'valid' ? 60 : [40, 60, 40]);
        } catch (err) {
            setResult({ result: 'error', message: err.message });
        } finally {
            setBusy(false);
        }
    }, [token, siteId]);

    const onCode = useCallback((text) => {
        if (busy || result) return;
        const parsed = parseInStoreScan(text);
        if (!parsed) { setResult({ result: 'not_powr' }); return; }
        if (parsed.kind === 'stand') {
            setResult({ result: 'not_powr', message: 'That’s a shop stand. Scan the voucher on the member’s phone.' });
            return;
        }
        runCheck(parsed.kind === 'voucher' ? { voucherId: parsed.voucherId, proof: parsed.proof } : { code: parsed.code });
    }, [busy, result, runCheck]);

    const submitTyped = (e) => {
        e.preventDefault();
        const code = normaliseTypedCode(typed);
        if (!code) { setResult({ result: 'not_found' }); return; }
        setTyped('');
        runCheck({ code });
    };

    const confirm = async (pence) => {
        setBusy(true);
        try {
            const r = await scanConfirm(token, siteId, result.voucher_id, result.ticket, pence);
            if (r?.error === 'CHECK_AGAIN') { setResult({ result: 'error', message: 'That took a while. Scan the voucher again to confirm.' }); return; }
            if (r?.error === 'ALREADY_USED') { setResult({ result: 'used' }); return; }
            if (r?.error) { setResult({ result: 'error', message: 'Couldn’t confirm. Scan the voucher again.' }); return; }
            setResult({ result: 'done', confirmed_at: r.confirmed_at });
            navigator.vibrate?.(80);
            loadToday();
        } catch (err) {
            setResult({ result: 'error', message: err.message });
        } finally {
            setBusy(false);
        }
    };

    const pickSite = (id) => { setSiteId(id); store.set(SITE_KEY, id); };
    const forgetLink = () => {
        if (!window.confirm('Forget this scan link on this device? You’ll need the link again to scan.')) return;
        store.set(TOKEN_KEY, null);
        setToken(null);
        setSession(null);
        setSessionError(user ? null : 'signed_out');
    };

    // ── Gates ──
    if (sessionError) {
        return (
            <Shell>
                <div className="max-w-md mx-auto text-center py-20 px-6">
                    <div className="text-[22px] font-black tracking-wide mb-8">POWR</div>
                    <h1 className="text-3xl font-light tracking-tight mb-4">Scan POWR rewards</h1>
                    <p className="text-[15px] text-[#555] leading-relaxed mb-8">
                        {sessionError === 'signed_out'
                            ? 'Open the scan link your manager sent you. It signs this phone in for scanning.'
                            : sessionError}
                    </p>
                    <Link to="/partner/login" className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6b5c00] underline">Manager? Sign in to the partner portal</Link>
                </div>
            </Shell>
        );
    }
    if (!session) {
        return <Shell><div className="flex items-center justify-center py-40"><div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" /></div></Shell>;
    }

    const who = session.staff ? session.staff.name : 'Manager';
    const header = (
        <header className="bg-white border-b border-[#E6E6E1] px-5 py-4">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-[22px] font-black tracking-wide">POWR</span>
                <span className="text-[13px] text-[#666] truncate">{session.brand_name} · {who}</span>
                <div className="flex-1" />
                {session.sites.length > 1 ? (
                    <label className="relative">
                        <span className="sr-only">Shop</span>
                        <select value={siteId ?? ''} onChange={e => pickSite(e.target.value)}
                            className="appearance-none h-10 pl-4 pr-9 rounded-full border border-[#E6E6E1] bg-[#F4F4F1] text-[10px] font-black uppercase tracking-[0.15em]">
                            {session.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </label>
                ) : site ? (
                    <span className="h-10 px-4 rounded-full border border-[#E6E6E1] bg-[#F4F4F1] text-[10px] font-black uppercase tracking-[0.15em] flex items-center">{site.name}</span>
                ) : null}
                {kiosk ? (
                    <button type="button" onClick={() => { if (window.confirm('Leave kiosk mode?')) setParams({}); }}
                        className="h-10 px-4 rounded-full border border-[#E6E6E1] text-[10px] font-black uppercase tracking-[0.15em] text-[#555]">Exit kiosk</button>
                ) : (
                    <button type="button" onClick={() => setParams({ kiosk: '1' })} title="Kiosk mode for a till tablet"
                        className="h-10 w-10 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#555]" aria-label="Kiosk mode"><Monitor size={15} /></button>
                )}
                {session.staff && (
                    <button type="button" onClick={forgetLink} aria-label="Forget this scan link" title="Forget this scan link"
                        className="h-10 w-10 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#999]"><LogOut size={14} /></button>
                )}
            </div>
        </header>
    );

    const scanner = result ? (
        <ResultCard key={result.ticket ?? result.result} result={result} offset={offset} site={site?.name} askSpend={askSpend}
            onConfirm={confirm} onReset={() => setResult(null)} busy={busy} />
    ) : (
        <>
            <Camera facing={kiosk ? 'user' : 'environment'} paused={busy} onCode={onCode}
                label={kiosk ? 'Hold the voucher up to the camera' : 'Point at the member’s voucher'} />
            <form onSubmit={submitTyped} className="flex flex-col gap-2">
                <label htmlFor="typed-code" className="text-[9px] font-black tracking-[0.2em] text-[#888]">CAMERA NOT WORKING?</label>
                <div className="flex gap-2">
                    <input id="typed-code" value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} placeholder="Type the 6-character code"
                        autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={8}
                        className="flex-1 min-w-0 h-12 px-4 rounded-2xl border border-[#E6E6E1] bg-white text-[15px] tracking-[0.15em] outline-none focus:border-[#E8D200]" />
                    <button type="submit" disabled={busy} className="h-12 px-5 rounded-full border border-[#E6E6E1] bg-white text-[10px] font-black uppercase tracking-[0.15em]">Check</button>
                </div>
            </form>
        </>
    );

    if (kiosk) {
        return (
            <Shell>
                {header}
                <main className="max-w-6xl mx-auto p-5 md:p-7 flex flex-wrap gap-6 items-start">
                    <section className="flex-[1.15_1_420px] bg-white border border-[#E6E6E1] rounded-[2rem] p-6 md:p-8 flex flex-col items-center gap-5 min-w-0">
                        {!result && (
                            <div className="flex p-1 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] gap-1" role="tablist">
                                {[['show', 'Members scan this'], ['scan', 'Scan a member']].map(([k, label]) => (
                                    <button key={k} type="button" role="tab" aria-selected={kioskMode === k} onClick={() => setKioskMode(k)}
                                        className={`h-10 px-5 rounded-full text-[10px] font-black uppercase tracking-[0.15em] ${kioskMode === k ? 'bg-[#E8D200] text-[#080808]' : 'text-[#666]'}`}>{label}</button>
                                ))}
                            </div>
                        )}
                        {kioskMode === 'show' && !result
                            ? <KioskStand token={token} siteId={siteId} offset={offset} />
                            : <div className="w-full max-w-md flex flex-col gap-4">{scanner}</div>}
                    </section>
                    <TodayPanel today={today} siteName={site?.name} />
                </main>
            </Shell>
        );
    }

    return (
        <Shell>
            {header}
            <main className="max-w-md mx-auto p-5 flex flex-col gap-4">
                {!session.sites.length && (
                    <p className="text-[13px] text-[#8a7600] bg-[#FFFCE5] border border-[#E8D200]/50 rounded-2xl p-4">No shops added yet. Scans still work; add your shops in the partner portal's In Store page so they're logged by shop.</p>
                )}
                {scanner}
                {today && (
                    <div className="flex items-center justify-between text-[10px] font-black tracking-[0.15em] text-[#6b5c00] pt-2">
                        <span>TODAY{site ? ` AT ${site.name.toUpperCase()}` : ''}: {today.confirmed} CONFIRMED</span>
                        {today.spend_pence > 0 && <span>{formatPence(today.spend_pence)} LOGGED</span>}
                    </div>
                )}
            </main>
        </Shell>
    );
}

function Shell({ children }) {
    return <div className="min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit']">{children}</div>;
}

function KioskStand({ token, siteId, offset }) {
    const [stand, setStand] = useState(null);
    const [error, setError] = useState(null);
    const [now, setNow] = useState(() => Date.now() + offset);

    useEffect(() => {
        setStand(null);
        setError(null);
        kioskStand(token, siteId).then((s) => {
            if (s?.error) setError('Add a shop in the partner portal to show its stand here.');
            else setStand(s);
        }).catch((err) => setError(err.message));
    }, [token, siteId]);
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now() + offset), 1000);
        return () => clearInterval(t);
    }, [offset]);

    const step = Math.floor(now / 1000 / STAND_STEP_SECONDS);
    const value = useMemo(
        () => (stand ? standUrl(stand.stand_code, standRotatingKey(stand.stand_secret, step)) : null),
        [stand, step],
    );
    const left = STAND_STEP_SECONDS - (Math.floor(now / 1000) % STAND_STEP_SECONDS);

    if (error) return <p className="text-[14px] text-[#666] py-16 text-center max-w-sm">{error}</p>;
    if (!value) return <div className="py-24"><div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" /></div>;
    return (
        <>
            <div className="text-center leading-[1.05]">
                <div className="text-[40px] font-extralight tracking-tight">Got a POWR reward?</div>
                <div className="text-[40px] font-extrabold tracking-tight">Scan here.</div>
            </div>
            <div className="p-4 rounded-3xl border border-[#E6E6E1] bg-white">
                <QRCodeSVG value={value} size={280} level="M" fgColor="#1A1A1A" bgColor="#FFFFFF" />
            </div>
            <div className="w-[312px] max-w-full h-1.5 rounded-full bg-[#EFEFEC] overflow-hidden">
                <div className="h-full bg-[#E8D200] transition-[width] duration-1000 ease-linear" style={{ width: `${(left / STAND_STEP_SECONDS) * 100}%` }} />
            </div>
            <span className="text-[13px] text-[#666] text-center">New code in {left}s · scan with the POWR app, not your camera</span>
        </>
    );
}

function TodayPanel({ today, siteName }) {
    const tone = {
        confirmed: ['CONFIRMED', 'bg-emerald-50 text-emerald-800'],
        swiped: ['SWIPED', 'bg-[#FDEDE3] text-[#A93A08]'],
        closed: ['CLOSED UNUSED', 'bg-[#EAF0FB] text-[#2F4F99]'],
        open: ['OPEN NOW', 'bg-[#FFFCE5] text-[#6b5c00]'],
    };
    return (
        <section className="flex-[1_1_320px] bg-white border border-[#E6E6E1] rounded-[2rem] p-6 md:p-8 flex flex-col gap-5 min-w-0">
            <span className="text-[10px] font-black tracking-[0.3em] text-[#888]">TODAY{siteName ? ` AT ${siteName.toUpperCase()}` : ''}</span>
            <div className="flex gap-3">
                <div className="flex-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-4">
                    <div className="text-[9px] font-black tracking-[0.2em] text-[#888]">CONFIRMED</div>
                    <div className="text-4xl font-light tracking-tight mt-1">{today?.confirmed ?? '–'}</div>
                </div>
                <div className="flex-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-4">
                    <div className="text-[9px] font-black tracking-[0.2em] text-[#888]">SPEND LOGGED</div>
                    <div className="text-4xl font-light tracking-tight mt-1">{today ? formatPence(today.spend_pence) : '–'}</div>
                </div>
            </div>
            <span className="text-[10px] font-black tracking-[0.3em] text-[#888] mt-1">LATEST</span>
            {!today?.latest?.length ? (
                <p className="text-[13px] text-[#888]">Nothing yet today.</p>
            ) : (
                <ul>
                    {today.latest.map((row, i) => {
                        const [label, cls] = tone[row.status] ?? tone.closed;
                        return (
                            <li key={`${row.at}-${i}`} className="flex items-center gap-3 py-3 border-t border-[#EFEFEC] first:border-0">
                                <span className="w-12 text-[13px] text-[#666]">{hhmm(row.at)}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[14px] font-semibold truncate">{row.member}</div>
                                    <div className="text-[12px] text-[#666] truncate">{row.reward}</div>
                                </div>
                                <span className={`px-2.5 py-1 rounded-full text-[9px] font-black tracking-[0.12em] ${cls}`}>{label}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
            <p className="text-[12px] text-[#888] flex items-center gap-2 mt-auto"><CameraIcon size={13} /> Vouchers change every few seconds. Screenshots won't scan.</p>
        </section>
    );
}
