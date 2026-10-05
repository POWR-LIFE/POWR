import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, Loader2, Send, TriangleAlert, X } from 'lucide-react';
import { accountStatus, CAPTION_MAX, createPost, fmtLondon, HASHTAG_MAX, hashtagCount, KIND_LABEL, kindsFor, londonToDate } from './store';

/**
 * "Post to Instagram" from the admin Studio: what the editor has on screen,
 * to POWR's own account, now or at a Europe/London time. `job` comes from
 * StudioEditor's onPublish: { format, formatInfo, slideCount, hasVideo, thumb, render }.
 */
const londonNowPlus = (mins) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(Date.now() + mins * 60000)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

export default function InstagramPanel({ job, onClose, onDone }) {
    const { kinds, reason } = useMemo(() => kindsFor(job), [job]);
    const [kind, setKind] = useState(kinds[0] ?? null);
    const [caption, setCaption] = useState('');
    const [when, setWhen] = useState('now');
    const [at, setAt] = useState(() => londonNowPlus(60));
    const [account, setAccount] = useState(null);
    const [step, setStep] = useState('edit'); // edit · confirm · working · done
    const [progress, setProgress] = useState(null);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const acRef = useRef(null);

    useEffect(() => {
        accountStatus().then(setAccount, (e) => setAccount({ error: e.message }));
    }, []);

    const tags = hashtagCount(caption);
    const tooLong = caption.length > CAPTION_MAX;
    const tooManyTags = tags > HASHTAG_MAX;
    const scheduledAt = when === 'later' && at ? londonToDate(at) : null;
    const inPast = scheduledAt && scheduledAt.getTime() < Date.now() + 60000;
    const handle = account?.username ? `@${account.username}` : 'POWR’s Instagram';
    const canPost = kind && !tooLong && !tooManyTags && !inPast && account && !account.error && (account.connected || account.dry_run);

    const go = async () => {
        setStep('working');
        setError(null);
        const ac = new AbortController();
        acRef.current = ac;
        try {
            setProgress({ label: 'Making the files', p: 0 });
            const files = await job.render({ signal: ac.signal, onProgress: (p) => setProgress({ label: 'Making the files', p }) });
            setProgress({ label: scheduledAt ? 'Uploading' : 'Uploading and posting', p: null });
            const r = await createPost({ kind, caption, files, thumb: job.thumb, format: job.format, scheduledAt });
            setResult(r);
            setStep('done');
            onDone?.();
        } catch (e) {
            if (e.name === 'AbortError') { setStep('edit'); return; }
            setError(e.message || 'Posting failed.');
            setStep('edit');
        } finally {
            setProgress(null);
            acRef.current = null;
        }
    };

    const F = job.formatInfo;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Post to Instagram">
            <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[#141414] text-white shadow-2xl ring-1 ring-white/10">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                    <div className="flex items-center gap-2 font-semibold"><Send size={16} className="text-[#E8D200]" /> Post to Instagram</div>
                    <button type="button" onClick={() => { acRef.current?.abort(); onClose(); }} className="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close"><X size={18} /></button>
                </div>

                <div className="grid gap-5 p-5 sm:grid-cols-[180px_1fr]">
                    <div>
                        {job.thumb
                            ? <img src={job.thumb} alt="Preview" className="w-full rounded-lg ring-1 ring-white/10" style={{ aspectRatio: `${F.w} / ${F.h}`, objectFit: 'cover' }} />
                            : <div className="w-full rounded-lg bg-white/5" style={{ aspectRatio: `${F.w} / ${F.h}` }} />}
                        <p className="mt-2 text-xs text-white/50">
                            {F.label} · {F.w}×{F.h}{job.slideCount > 1 ? ` · ${job.slideCount} slides` : ''}{job.hasVideo ? ' · MP4' : ' · JPEG'}
                        </p>
                    </div>

                    <div className="space-y-4 text-sm">
                        <AccountLine account={account} />

                        {!kinds.length ? (
                            <div className="flex gap-2 rounded-lg bg-[#3a2a12] p-3 text-[#F5C26B]"><TriangleAlert size={16} className="mt-0.5 shrink-0" /> {reason}</div>
                        ) : step === 'done' ? (
                            <div className="space-y-3">
                                <div className="flex gap-2 rounded-lg bg-[#13301f] p-3 text-[#7BE0A4]">
                                    <CircleCheck size={16} className="mt-0.5 shrink-0" />
                                    <div>
                                        {result?.scheduled ? <>Scheduled for {fmtLondon(scheduledAt.toISOString())} (London).</>
                                            : result?.dry_run ? <>Dry run — nothing went to Instagram. The calls it would have made are on the post in Studio → Instagram.</>
                                                : result?.ok ? <>Posted to {handle}. {result.permalink && <a href={result.permalink} target="_blank" rel="noreferrer" style={{ color: 'inherit' }} className="underline">Open it</a>}</>
                                                    : <>{result?.error ?? 'Saved.'}</>}
                                    </div>
                                </div>
                                <button type="button" onClick={onClose} className="rounded-lg bg-[#E8D200] px-3 py-1.5 font-semibold text-[#111]">Done</button>
                            </div>
                        ) : (
                            <>
                                <div>
                                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">Post as</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {kinds.map((k) => (
                                            <button key={k} type="button" onClick={() => setKind(k)} disabled={step !== 'edit'}
                                                className={`rounded-lg px-3 py-1.5 text-[13px] ${kind === k ? 'bg-[#E8D200] font-semibold text-[#111]' : 'bg-white/5 text-white/70 hover:text-white'}`}>
                                                {KIND_LABEL[k]}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {kind !== 'story' ? (
                                    <label className="block">
                                        <div className="mb-1.5 flex justify-between text-xs">
                                            <span className="font-semibold uppercase tracking-wide text-white/50">Caption</span>
                                            <span className={tooLong || tooManyTags ? 'text-[#FF8A7A]' : 'text-white/45'}>
                                                {caption.length.toLocaleString()} / {CAPTION_MAX.toLocaleString()} · {tags} / {HASHTAG_MAX} hashtags
                                            </span>
                                        </div>
                                        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={6} disabled={step !== 'edit'}
                                            placeholder="Write the caption…"
                                            className="w-full resize-y rounded-lg bg-white/5 p-3 text-[14px] text-white placeholder-white/30 outline-none ring-1 ring-white/10 focus:ring-[#E8D200]/60" />
                                    </label>
                                ) : (
                                    <p className="text-xs text-white/50">Stories go out without a caption.</p>
                                )}

                                <div>
                                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">When</div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {[['now', 'Post now'], ['later', 'Schedule']].map(([id, label]) => (
                                            <button key={id} type="button" onClick={() => setWhen(id)} disabled={step !== 'edit'}
                                                className={`rounded-lg px-3 py-1.5 text-[13px] ${when === id ? 'bg-white font-semibold text-[#111]' : 'bg-white/5 text-white/70 hover:text-white'}`}>
                                                {label}
                                            </button>
                                        ))}
                                        {when === 'later' && (
                                            <>
                                                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} disabled={step !== 'edit'}
                                                    className="rounded-lg bg-white/5 px-2 py-1.5 text-[13px] text-white ring-1 ring-white/10 [color-scheme:dark]" />
                                                <span className="text-xs text-white/45">London time</span>
                                            </>
                                        )}
                                    </div>
                                    {inPast && <p className="mt-1.5 text-xs text-[#FF8A7A]">Pick a time at least a minute from now.</p>}
                                    {when === 'later' && <p className="mt-1.5 text-xs text-white/45">Goes out within 5 minutes of the time.</p>}
                                </div>

                                {error && <div className="flex gap-2 rounded-lg bg-[#3a1616] p-3 text-[#FF8A7A]"><TriangleAlert size={16} className="mt-0.5 shrink-0" /> {error}</div>}

                                {step === 'working' ? (
                                    <div className="flex items-center gap-2 text-white/70">
                                        <Loader2 size={16} className="animate-spin" />
                                        {progress?.label}{progress?.p != null ? ` · ${Math.round(progress.p * 100)}%` : '…'}
                                        <button type="button" onClick={() => acRef.current?.abort()} className="ml-auto text-xs text-white/50 underline">Cancel</button>
                                    </div>
                                ) : step === 'confirm' ? (
                                    <div className="rounded-lg bg-[#E8D200]/10 p-3 ring-1 ring-[#E8D200]/40">
                                        <p className="font-semibold text-[#E8D200]">
                                            {account?.dry_run ? `Dry run: this would post publicly to ${handle}` : `This posts publicly to ${handle}`}
                                            {scheduledAt ? ` on ${fmtLondon(scheduledAt.toISOString())}.` : ' now.'}
                                        </p>
                                        <p className="mt-1 text-xs text-white/60">{KIND_LABEL[kind]}{job.slideCount > 1 ? ` of ${job.slideCount}` : ''}. Instagram posts can be deleted but not edited.</p>
                                        <div className="mt-3 flex gap-2">
                                            <button type="button" onClick={go} className="rounded-lg bg-[#E8D200] px-3 py-1.5 font-semibold text-[#111]">
                                                {scheduledAt ? 'Schedule it' : 'Post it'}
                                            </button>
                                            <button type="button" onClick={() => setStep('edit')} className="rounded-lg px-3 py-1.5 text-white/70 hover:text-white">Back</button>
                                        </div>
                                    </div>
                                ) : (
                                    <button type="button" disabled={!canPost} onClick={() => setStep('confirm')}
                                        className="flex items-center gap-1.5 rounded-lg bg-[#E8D200] px-3 py-1.5 font-semibold text-[#111] disabled:opacity-40">
                                        <Send size={14} /> {when === 'later' ? 'Schedule…' : 'Post now…'}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function AccountLine({ account }) {
    if (!account) return <div className="flex items-center gap-2 text-white/50"><Loader2 size={14} className="animate-spin" /> Checking the account…</div>;
    if (account.error) return <div className="text-[#FF8A7A]">Couldn’t check the account: {account.error}</div>;
    return (
        <div className="flex flex-wrap items-center gap-2">
            {account.connected
                ? <span className="rounded-full bg-[#13301f] px-2.5 py-0.5 text-xs font-semibold text-[#7BE0A4]">Connected · @{account.username}</span>
                : <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/70">Not connected</span>}
            {account.dry_run && <span className="rounded-full bg-[#3a2a12] px-2.5 py-0.5 text-xs font-semibold text-[#F5C26B]">Dry run — nothing posts</span>}
            {!account.connected && !account.dry_run && <span className="text-xs text-white/50">Connect it in Studio → Instagram first.</span>}
        </div>
    );
}
