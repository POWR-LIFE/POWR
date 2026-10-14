import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import { AlertCircle, Camera as CameraIcon, Check, ChevronDown, Clock, LogOut, Monitor, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { formatLocale } from '../lib/i18n';
import { serverErrorText } from '../lib/serverErrors';
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
//
// Language: the browser's (lib/i18n), staff addressed as vous/usted. There's no
// picker here; a till tablet just follows its own settings.

const TOKEN_KEY = 'powr:scan:token';
const SITE_KEY = 'powr:scan:site';

const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// A staff token anywhere in a pasted link or the address bar: #k=… is what
// the portal hands out (fragments never reach a server log), ?k=… covers
// apps that drop the fragment when they open a link.
const tokenFrom = (text) => /(?:^|[#?&])k=([0-9a-f]{32})(?:&|$)/i.exec(text ?? '')?.[1]?.toLowerCase()
    ?? (/^\s*([0-9a-f]{32})\s*$/i.exec(text ?? '')?.[1]?.toLowerCase() ?? null);

function readToken() {
    const fromUrl = tokenFrom(window.location.hash) ?? tokenFrom(window.location.search);
    if (fromUrl) {
        store.set(TOKEN_KEY, fromUrl);
        // Drop the token from the address bar so it isn't shared by accident.
        const rest = new URLSearchParams(window.location.search);
        rest.delete('k');
        const qs = rest.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
        return fromUrl;
    }
    return store.get(TOKEN_KEY);
}

const hhmm = (iso) => new Date(iso).toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit' });

// What staff typed in the spend box -> pence. A comma before the last one or
// two digits is a decimal comma, how French and Spanish staff write it
// ("12,50", "1.234,56"); "1,250" and "1,250.50" read as before.
function spendToPence(text) {
    const raw = text.trim();
    if (!raw) return null;
    const decimalComma = /,\d{1,2}$/.test(raw) && raw.lastIndexOf(',') > raw.lastIndexOf('.');
    const clean = (decimalComma ? raw.replace(/\./g, '').replace(/,(?=\d{1,2}$)/, '.') : raw).replace(/[^0-9.]/g, '');
    return Math.round(parseFloat(clean) * 100);
}

// ── Camera ───────────────────────────────────────────────────────────────────

function Camera({ facing, paused, onCode, label }) {
    const { t } = useTranslation();
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
                    {state === 'starting' && t('scan:camera.starting')}
                    {state === 'denied' && t('scan:camera.denied')}
                    {state === 'unavailable' && t('scan:camera.unavailable')}
                </div>
            )}
            {state === 'live' && <span className="absolute bottom-8 inset-x-0 text-center text-white/70 text-[13px]">{label}</span>}
            <style>{'@keyframes powrScan{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(min(60vh,100vw) - 110px))}}'}</style>
        </div>
    );
}

// ── Results ──────────────────────────────────────────────────────────────────

function ResultCard({ result, offset, site, askSpend, onConfirm, onReset, busy }) {
    const { t } = useTranslation();
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
    const again = (label = t('scan:result.scanAnother')) => (
        <button type="button" onClick={onReset} className="mt-1 h-13 py-4 rounded-full border border-[#E6E6E1] bg-white text-[11px] font-black uppercase tracking-[0.15em]">{label}</button>
    );

    if (result.result === 'done') {
        return (
            <div className="py-10 flex flex-col items-center gap-3 text-center" role="status" aria-live="assertive">
                <div className="w-28 h-28 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center"><Check size={48} strokeWidth={2.2} /></div>
                <div className="text-3xl font-light tracking-tight mt-2">{t('scan:result.applied')}</div>
                <p className="text-[14px] text-[#666]">{site ? t('scan:result.loggedAtSite', { site, time: hhmm(result.confirmed_at) }) : t('scan:result.loggedAt', { time: hhmm(result.confirmed_at) })}</p>
                <button type="button" onClick={onReset} className="mt-6 w-full h-14 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.15em]">{t('scan:result.scanNext')}</button>
            </div>
        );
    }
    if (result.result === 'valid') {
        const left = Math.max(0, Math.round((new Date(result.expires_at).getTime() - now) / 1000));
        const pence = spendToPence(spend);
        const opened = hhmm(result.opened_at);
        return shell(
            banner('bg-emerald-50 text-emerald-800', <Check size={18} strokeWidth={3} />, t('scan:result.valid')),
            <>
                <div className="text-[28px] font-light tracking-tight leading-tight">{result.reward_title}</div>
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-[#E8D200] text-[#080808] flex items-center justify-center text-[13px] font-extrabold">{result.member_label.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}</div>
                    <div>
                        <div className="text-[15px] font-semibold">{result.member_label}</div>
                        <div className="text-[12px] text-[#666]">
                            {result.swiped ? t('scan:result.openedSwiped', { time: opened })
                                : left > 0 ? t('scan:result.openedClosesIn', { time: opened, left: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })
                                    : t('scan:result.opened', { time: opened })}
                        </div>
                    </div>
                </div>
                {askSpend && (
                    <div className="flex flex-col gap-2">
                        <label htmlFor="scan-spend" className="text-[9px] font-black tracking-[0.2em] text-[#888]">{t('scan:result.spendLabel')}</label>
                        <div className="flex items-center h-12 rounded-2xl border border-[#E6E6E1] bg-[#F4F4F1] px-4 gap-1.5">
                            <span className="text-[16px] text-[#666]">£</span>
                            <input id="scan-spend" inputMode="decimal" value={spend} onChange={e => setSpend(e.target.value)} placeholder={t('scan:result.spendPlaceholder')}
                                className="flex-1 min-w-0 bg-transparent outline-none text-[16px]" />
                        </div>
                    </div>
                )}
                <button type="button" disabled={busy} onClick={() => onConfirm(Number.isFinite(pence) ? pence : null)}
                    className="h-14 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.15em] disabled:opacity-50">
                    {busy ? t('scan:result.confirming') : t('scan:result.confirm')}
                </button>
                <button type="button" onClick={onReset} className="h-11 text-[10px] font-black uppercase tracking-[0.15em] text-[#666]">{t('common:actions.cancel')}</button>
            </>,
        );
    }
    const RED = 'bg-[#FDEDE3] text-[#A93A08]';
    const GREY = 'bg-[#EFEFEC] text-[#444]';
    switch (result.result) {
        case 'used':
            return shell(banner(RED, <X size={18} strokeWidth={3} />, t('scan:result.used')), <>
                {result.reward_title && <div className="text-[24px] font-light tracking-tight">{result.reward_title}</div>}
                <p className="text-[14px] text-[#555] leading-relaxed">
                    {result.used_at
                        ? t(result.used_site_name ? 'scan:result.usedAtSite' : 'scan:result.usedOn', {
                            site: result.used_site_name,
                            date: new Date(result.used_at).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short' }),
                            time: hhmm(result.used_at),
                        })
                        : t('scan:result.usedNoDate')}
                </p>
                <p className="text-[15px] font-bold">{t('scan:result.dontApplyThe')}</p>{again()}
            </>);
        case 'other':
            return shell(banner(GREY, <AlertCircle size={18} />, t('scan:result.other')), <>
                <p className="text-[14px] text-[#555]">{t('scan:result.otherBody')}</p>
                <p className="text-[15px] font-bold">{t('scan:result.dontApplyA')}</p>{again()}
            </>);
        case 'stale':
            return shell(banner(RED, <AlertCircle size={18} />, t('scan:result.stale')), <>
                <p className="text-[14px] text-[#555] leading-relaxed">{t('scan:result.staleBody')}</p>{again(t('scan:result.scanAgain'))}
            </>);
        case 'closed':
            return shell(banner(GREY, <Clock size={18} />, t('scan:result.closed')), <>
                <p className="text-[14px] text-[#555] leading-relaxed">{t('scan:result.closedBody')}</p>{again(t('scan:result.scanAgain'))}
            </>);
        case 'not_found':
            return shell(banner(GREY, <AlertCircle size={18} />, t('scan:result.notFound')), <>
                <p className="text-[14px] text-[#555] leading-relaxed">{t('scan:result.notFoundBody')}</p>{again(t('common:actions.retry'))}
            </>);
        case 'not_powr':
            return shell(banner(GREY, <AlertCircle size={18} />, t('scan:result.notPowr')), <>
                <p className="text-[14px] text-[#555] leading-relaxed">{result.message ?? t('scan:result.notPowrBody')}</p>{again(t('scan:result.scanAgain'))}
            </>);
        default:
            return shell(banner(RED, <AlertCircle size={18} />, t('scan:result.error')), <>
                <p className="text-[14px] text-[#555] leading-relaxed">{result.message ?? t('scan:result.errorBody')}</p>{again(t('scan:result.scanAgain'))}
            </>);
    }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ScanPage() {
    const { t } = useTranslation();
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
    const [pasted, setPasted] = useState('');
    const [pasteError, setPasteError] = useState(null);

    useEffect(() => { document.title = t('scan:docTitle'); }, [t]);

    useEffect(() => {
        if (authLoading) return;
        if (!token && !user) { setSessionError('signed_out'); return; }
        let cancelled = false;
        setSessionError(null);
        scanSession(token).then((s) => {
            if (cancelled) return;
            setSession(s);
            setOffset(new Date(s.server_now).getTime() - Date.now());
            const remembered = store.get(SITE_KEY);
            const pick = [remembered, s.staff?.site_id, s.sites[0]?.id].find(id => id && s.sites.some(x => x.id === id));
            setSiteId(pick ?? null);
        }).catch((err) => {
            if (cancelled) return;
            // A link that was revoked or replaced. Pasting a new one swaps it.
            if (token) { setSessionError('link_revoked'); return; }
            setSessionError(user ? 'not_partner' : serverErrorText(err));
        });
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
            setResult({ result: 'error', message: serverErrorText(err) });
        } finally {
            setBusy(false);
        }
    }, [token, siteId]);

    const onCode = useCallback((text) => {
        if (busy || result) return;
        const parsed = parseInStoreScan(text);
        if (!parsed) { setResult({ result: 'not_powr' }); return; }
        if (parsed.kind === 'stand') {
            setResult({ result: 'not_powr', message: t('scan:result.isStand') });
            return;
        }
        runCheck(parsed.kind === 'voucher' ? { voucherId: parsed.voucherId, proof: parsed.proof } : { code: parsed.code });
    }, [busy, result, runCheck, t]);

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
            if (r?.error === 'CHECK_AGAIN') { setResult({ result: 'error', message: t('scan:result.checkAgain') }); return; }
            if (r?.error === 'ALREADY_USED') { setResult({ result: 'used' }); return; }
            if (r?.error) { setResult({ result: 'error', message: t('scan:result.confirmFailed') }); return; }
            setResult({ result: 'done', confirmed_at: r.confirmed_at });
            navigator.vibrate?.(80);
            loadToday();
        } catch (err) {
            setResult({ result: 'error', message: serverErrorText(err) });
        } finally {
            setBusy(false);
        }
    };

    const pickSite = (id) => { setSiteId(id); store.set(SITE_KEY, id); };
    const forgetLink = () => {
        if (!window.confirm(t('scan:header.forgetConfirm'))) return;
        store.set(TOKEN_KEY, null);
        setToken(null);
        setSession(null);
        setSessionError(user ? null : 'signed_out');
    };

    const openPastedLink = (e) => {
        e.preventDefault();
        const linkToken = tokenFrom(pasted.trim());
        if (!linkToken) { setPasteError(t('scan:gate.pasteError')); return; }
        setPasteError(null);
        setPasted('');
        store.set(TOKEN_KEY, linkToken);
        setToken(linkToken);
    };

    // ── Gates ──
    if (sessionError) {
        const why = sessionError === 'signed_out'
            ? t('scan:gate.signedOut')
            : sessionError === 'not_partner'
                ? (user?.email ? t('scan:gate.notPartner', { email: user.email }) : t('scan:gate.notPartnerNoEmail'))
                : sessionError === 'link_revoked'
                    ? t('scan:gate.revoked')
                    : sessionError;
        return (
            <Shell>
                <div className="max-w-md mx-auto text-center py-20 px-6">
                    <div className="text-[22px] font-black tracking-wide mb-8">POWR</div>
                    <h1 className="text-3xl font-light tracking-tight mb-4">{t('scan:gate.title')}</h1>
                    <p className="text-[15px] text-[#555] leading-relaxed mb-8">{why}</p>
                    <form onSubmit={openPastedLink} className="text-left flex flex-col gap-2 mb-10">
                        <label htmlFor="paste-link" className="text-[9px] font-black tracking-[0.2em] text-[#888]">{t('scan:gate.pasteLabel')}</label>
                        <div className="flex gap-2">
                            <input id="paste-link" value={pasted} onChange={e => setPasted(e.target.value)} placeholder="https://powr.life/scan#k=…"
                                autoComplete="off" spellCheck={false}
                                className="flex-1 min-w-0 h-12 px-4 rounded-2xl border border-[#E6E6E1] bg-white text-[14px] outline-none focus:border-[#E8D200]" />
                            <button type="submit" className="h-12 px-5 rounded-full bg-[#1A1A1A] text-[#E8D200] text-[10px] font-black uppercase tracking-[0.15em]">{t('scan:gate.open')}</button>
                        </div>
                        {pasteError && <p className="text-[12px] text-[#A93A08]">{pasteError}</p>}
                    </form>
                    <Link to="/partner/login" className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6b5c00] underline">{t('scan:gate.managerSignIn')}</Link>
                </div>
            </Shell>
        );
    }
    if (!session) {
        return <Shell><div className="flex items-center justify-center py-40"><div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" /></div></Shell>;
    }

    const who = session.staff ? session.staff.name : t('scan:header.manager');
    const header = (
        <header className="bg-white border-b border-[#E6E6E1] px-5 py-4">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-[22px] font-black tracking-wide">POWR</span>
                <span className="text-[13px] text-[#666] truncate">{session.brand_name} · {who}</span>
                <div className="flex-1" />
                {session.sites.length > 1 ? (
                    <label className="relative">
                        <span className="sr-only">{t('scan:header.shop')}</span>
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
                    <button type="button" onClick={() => { if (window.confirm(t('scan:header.leaveKiosk'))) setParams({}); }}
                        className="h-10 px-4 rounded-full border border-[#E6E6E1] text-[10px] font-black uppercase tracking-[0.15em] text-[#555]">{t('scan:header.exitKiosk')}</button>
                ) : (
                    <button type="button" onClick={() => setParams({ kiosk: '1' })} title={t('scan:header.kioskTitle')}
                        className="h-10 w-10 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#555]" aria-label={t('scan:header.kioskLabel')}><Monitor size={15} /></button>
                )}
                {session.staff && (
                    <button type="button" onClick={forgetLink} aria-label={t('scan:header.forget')} title={t('scan:header.forget')}
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
                label={kiosk ? t('scan:camera.kioskLabel') : t('scan:camera.phoneLabel')} />
            <form onSubmit={submitTyped} className="flex flex-col gap-2">
                <label htmlFor="typed-code" className="text-[9px] font-black tracking-[0.2em] text-[#888]">{t('scan:camera.notWorking')}</label>
                <div className="flex gap-2">
                    <input id="typed-code" value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} placeholder={t('scan:camera.typePlaceholder')}
                        autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={8}
                        className="flex-1 min-w-0 h-12 px-4 rounded-2xl border border-[#E6E6E1] bg-white text-[15px] tracking-[0.15em] outline-none focus:border-[#E8D200]" />
                    <button type="submit" disabled={busy} className="h-12 px-5 rounded-full border border-[#E6E6E1] bg-white text-[10px] font-black uppercase tracking-[0.15em]">{t('scan:camera.check')}</button>
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
                                {[['show', t('scan:kiosk.showTab')], ['scan', t('scan:kiosk.scanTab')]].map(([k, label]) => (
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
                    <p className="text-[13px] text-[#8a7600] bg-[#FFFCE5] border border-[#E8D200]/50 rounded-2xl p-4">{t('scan:phone.noShops')}</p>
                )}
                {scanner}
                {today && (
                    <div className="flex items-center justify-between text-[10px] font-black tracking-[0.15em] text-[#6b5c00] pt-2">
                        <span>{site ? t('scan:phone.todayAt', { site: site.name.toUpperCase(), count: today.confirmed }) : t('scan:phone.today', { count: today.confirmed })}</span>
                        {today.spend_pence > 0 && <span>{t('scan:phone.logged', { amount: formatPence(today.spend_pence) })}</span>}
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
    const { t } = useTranslation();
    const [stand, setStand] = useState(null);
    const [error, setError] = useState(null);
    const [now, setNow] = useState(() => Date.now() + offset);

    useEffect(() => {
        setStand(null);
        setError(null);
        kioskStand(token, siteId).then((s) => {
            if (s?.error) setError(t('scan:kiosk.noShop'));
            else setStand(s);
        }).catch((err) => setError(serverErrorText(err)));
    }, [token, siteId, t]);
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
                <div className="text-[40px] font-extralight tracking-tight">{t('scan:kiosk.headline')}</div>
                <div className="text-[40px] font-extrabold tracking-tight">{t('scan:kiosk.headlineBold')}</div>
            </div>
            <div className="p-4 rounded-3xl border border-[#E6E6E1] bg-white">
                <QRCodeSVG value={value} size={280} level="M" fgColor="#1A1A1A" bgColor="#FFFFFF" />
            </div>
            <div className="w-[312px] max-w-full h-1.5 rounded-full bg-[#EFEFEC] overflow-hidden">
                <div className="h-full bg-[#E8D200] transition-[width] duration-1000 ease-linear" style={{ width: `${(left / STAND_STEP_SECONDS) * 100}%` }} />
            </div>
            <span className="text-[13px] text-[#666] text-center">{t('scan:kiosk.newCode', { seconds: left })}</span>
        </>
    );
}

function TodayPanel({ today, siteName }) {
    const { t } = useTranslation();
    const tone = {
        confirmed: [t('scan:today.status.confirmed'), 'bg-emerald-50 text-emerald-800'],
        swiped: [t('scan:today.status.swiped'), 'bg-[#FDEDE3] text-[#A93A08]'],
        closed: [t('scan:today.status.closed'), 'bg-[#EAF0FB] text-[#2F4F99]'],
        open: [t('scan:today.status.open'), 'bg-[#FFFCE5] text-[#6b5c00]'],
    };
    return (
        <section className="flex-[1_1_320px] bg-white border border-[#E6E6E1] rounded-[2rem] p-6 md:p-8 flex flex-col gap-5 min-w-0">
            <span className="text-[10px] font-black tracking-[0.3em] text-[#888]">{siteName ? t('scan:today.titleAt', { site: siteName.toUpperCase() }) : t('scan:today.title')}</span>
            <div className="flex gap-3">
                <div className="flex-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-4">
                    <div className="text-[9px] font-black tracking-[0.2em] text-[#888]">{t('scan:today.confirmed')}</div>
                    <div className="text-4xl font-light tracking-tight mt-1">{today?.confirmed ?? '–'}</div>
                </div>
                <div className="flex-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-4">
                    <div className="text-[9px] font-black tracking-[0.2em] text-[#888]">{t('scan:today.spend')}</div>
                    <div className="text-4xl font-light tracking-tight mt-1">{today ? formatPence(today.spend_pence) : '–'}</div>
                </div>
            </div>
            <span className="text-[10px] font-black tracking-[0.3em] text-[#888] mt-1">{t('scan:today.latest')}</span>
            {!today?.latest?.length ? (
                <p className="text-[13px] text-[#888]">{t('scan:today.nothing')}</p>
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
            <p className="text-[12px] text-[#888] flex items-center gap-2 mt-auto"><CameraIcon size={13} /> {t('scan:today.screenshots')}</p>
        </section>
    );
}
