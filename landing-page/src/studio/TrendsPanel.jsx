import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, Eye, EyeOff, ExternalLink, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { templateById } from './templates';
import { prepareStudio, renderPost } from './render';
import { loadMedia } from './media';
import { compileBlueprint } from './blueprint/compile';

/**
 * Trends — the week's trend drop: what the big fitness and wellness brands'
 * campaigns look like right now, and what the Studio can make of it. Written
 * each week by the "Studio trend drop" routine into studio_trend_drops
 * (admin-only: it names other brands and links their campaigns). "Try it"
 * opens the editor on the trend's template with its words and look.
 *
 * The routine also publishes one new template a week (a blueprint, in
 * studio_templates) — it goes straight into the editor's "Trending" group;
 * here it's previewed, and can be hidden.
 */

// POWR's own footage (the hero clip), so previews never lean on a brand's photo.
let previewMedia = null;
const previewPhoto = () => (previewMedia ??= loadMedia('/studio/preview.jpg'));

const PREVIEW_FOCAL = { x: 0.8, y: 0.45 };

function Preview({ blueprint, format, focal = PREVIEW_FOCAL }) {
    const ref = useRef(null);
    useEffect(() => {
        let live = true;
        (async () => {
            await prepareStudio();
            const media = await previewPhoto().catch(() => null);
            const template = compileBlueprint(blueprint);
            if (!live || !ref.current || !template) return;
            const off = document.createElement('canvas');
            renderPost(off, { template, format, media, focal, scale: format === 'landscape' ? 0.3 : 0.36 });
            const c = ref.current;
            c.width = off.width;
            c.height = off.height;
            c.getContext('2d').drawImage(off, 0, 0);
        })();
        return () => { live = false; };
    }, [blueprint, format, focal]);
    return <canvas ref={ref} className="block h-full w-auto rounded-lg bg-[#111]" />;
}

function TemplateOfWeek({ row, onTry, onStatus }) {
    const bp = row.blueprint;
    const hidden = row.status === 'hidden';
    return (
        <article className={`rounded-2xl border bg-white p-5 ${hidden ? 'border-dashed border-[#DDD] opacity-70' : 'border-[#E8D200]'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#8A6A00]"><Sparkles size={13} /> Template of the week</div>
                    <h4 className="mt-1 text-xl font-bold text-[#111]">{bp.name}</h4>
                    <p className="mt-1 max-w-xl text-sm text-[#555]">{bp.blurb}{bp.trend ? ` From the “${bp.trend}” trend.` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onStatus?.(row.id, hidden ? 'live' : 'hidden')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#E6E6E1] px-3 py-1.5 text-sm text-[#555] hover:border-[#CFCFC8] hover:text-[#111]">
                        {hidden ? <><Eye size={14} /> Show in Studio</> : <><EyeOff size={14} /> Hide from Studio</>}
                    </button>
                    {!hidden && <TryIt onTry={onTry} templateId={bp.id} />}
                </div>
            </div>
            <div className="mt-4 flex h-[250px] gap-3 overflow-x-auto">
                <Preview blueprint={bp} format="post" />
                <Preview blueprint={bp} format="story" />
                <Preview blueprint={bp} format="landscape" />
            </div>
            <p className="mt-3 text-xs text-[#999]">
                {hidden ? 'Hidden: it leaves the picker the next time the Studio opens.' : 'Live in the Studio’s Trending group. Made and checked by the weekly routine.'}
            </p>
        </article>
    );
}
const FIT = {
    template: { label: 'Template', cls: 'bg-[#111] text-white' },
    look: { label: 'Look', cls: 'bg-[#FFF6BF] text-[#6B5A00]' },
    photo: { label: 'Photo', cls: 'bg-[#E8F0FF] text-[#274C8F]' },
};

const weekLabel = (iso) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return `Week of ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).replace('Sept', 'Sep')}`;
};

function Strength({ n }) {
    return (
        <span className="inline-flex gap-0.5" title={`Strength ${n} of 3`}>
            {[1, 2, 3].map((i) => <span key={i} className={`h-1.5 w-3 rounded-full ${i <= n ? 'bg-[#E8D200]' : 'bg-[#E6E6E1]'}`} />)}
        </span>
    );
}

// A brand's campaign image, linked to where it was published. Hotlinked, so
// a source that moves its image just shows the link.
function Example({ ex }) {
    const [broken, setBroken] = useState(!ex.image);
    return (
        <a href={ex.url} target="_blank" rel="noreferrer noopener" className="group block rounded-lg border border-[#EAEAE5] overflow-hidden hover:border-[#CFCFC8]">
            {!broken && (
                <img src={ex.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)}
                    className="block h-28 w-full object-cover bg-[#F2F2EE]" />
            )}
            <div className="px-2 py-1.5">
                <div className="flex items-center gap-1 text-xs font-semibold text-[#111]">{ex.brand}<ExternalLink size={11} className="text-[#999] group-hover:text-[#111]" /></div>
                <div className="text-[11px] text-[#777] leading-snug">{ex.campaign}{ex.date ? ` · ${ex.date}` : ''}</div>
            </div>
        </a>
    );
}

function TryIt({ onTry, templateId, fields, look, children = 'Try it' }) {
    if (!templateId) return null;
    const name = templateById(templateId)?.id === templateId ? templateById(templateId).name : templateId;
    return (
        <button type="button" onClick={() => onTry({ templateId, fields: fields ?? {}, look: look ?? {} })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#E8D200] px-3 py-1.5 text-sm font-semibold text-[#111] hover:bg-[#F5E33A]">
            {children} in {name} <ArrowRight size={14} />
        </button>
    );
}

export default function TrendsPanel({ onTry, published = null, onStatus }) {
    const [drops, setDrops] = useState(null);
    const [error, setError] = useState(null);
    const [week, setWeek] = useState(null);

    useEffect(() => {
        let live = true;
        supabase
            .from('studio_trend_drops')
            .select('id, week_start, title, summary, trends, post_ideas, shot_list, sources')
            .order('week_start', { ascending: false })
            .limit(26)
            .then(({ data, error: e }) => {
                if (!live) return;
                if (e) setError(e.message);
                else {
                    setDrops(data ?? []);
                    setWeek(data?.[0]?.week_start ?? null);
                }
            });
        return () => { live = false; };
    }, []);

    const drop = drops?.find((d) => d.week_start === week);
    const weekTemplates = (published ?? []).filter((r) => r.week_start === week);

    return (
        <div className="max-w-[1180px] space-y-6">
            {drops?.length > 1 && (
                <select value={week ?? ''} onChange={(ev) => setWeek(ev.target.value)}
                    className="rounded-lg border border-[#E6E6E1] bg-white px-3 py-2 text-sm text-[#111]">
                    {drops.map((d) => <option key={d.id} value={d.week_start}>{weekLabel(d.week_start)} — {d.title}</option>)}
                </select>
            )}

            {error && <div className="flex items-center gap-2 rounded-xl bg-[#FFF1F0] p-4 text-sm text-[#A8071A]"><TriangleAlert size={16} /> {error}</div>}
            {!drops && !error && <div className="flex items-center gap-2 text-sm text-[#777]"><Loader2 size={16} className="animate-spin" /> Loading the trend drops…</div>}
            {drops && !drops.length && <p className="text-sm text-[#777]">No trend drops yet. The routine writes one every Monday morning.</p>}

            {drop && (
                <>
                    <section className="rounded-2xl bg-[#111] p-6 text-white">
                        <div className="text-xs uppercase tracking-[0.14em] text-[#E8D200]">{weekLabel(drop.week_start)}</div>
                        <h2 className="mt-1 text-2xl font-bold">{drop.title}</h2>
                        {drop.summary && <p className="mt-2 max-w-3xl text-sm text-white/75">{drop.summary}</p>}
                        <p className="mt-3 text-xs text-white/45">Take the look, never the copy: no brand’s words, marks, patterns or people. POWR stays dark.</p>
                    </section>

                    {weekTemplates.map((row) => <TemplateOfWeek key={row.id} row={row} onTry={onTry} onStatus={onStatus} />)}

                    <section>
                        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[#777]">Trends</h3>
                        <div className="grid gap-4 md:grid-cols-2">
                            {(drop.trends ?? []).map((t) => {
                                const fit = FIT[t.fit] ?? FIT.look;
                                return (
                                    <article key={t.name} className="rounded-2xl border border-[#E6E6E1] bg-white p-5">
                                        <div className="flex items-center justify-between gap-3">
                                            <h4 className="text-lg font-bold text-[#111]">{t.name}</h4>
                                            <div className="flex items-center gap-2">
                                                <Strength n={t.strength ?? 1} />
                                                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${fit.cls}`}>{fit.label}</span>
                                            </div>
                                        </div>
                                        <p className="mt-2 text-sm text-[#444]">{t.what}</p>
                                        {t.examples?.length > 0 && (
                                            <div className="mt-3 grid grid-cols-2 items-start gap-2 sm:grid-cols-3">
                                                {t.examples.map((ex) => <Example key={ex.url + ex.campaign} ex={ex} />)}
                                            </div>
                                        )}
                                        {t.idea && <p className="mt-3 text-sm text-[#111]"><span className="font-semibold">For POWR: </span>{t.idea}</p>}
                                        {t.avoid && <p className="mt-2 text-xs text-[#8A6A00]"><span className="font-semibold">Don’t copy: </span>{t.avoid}</p>}
                                        {t.template?.id && (
                                            <div className="mt-4"><TryIt onTry={onTry} templateId={t.template.id} fields={t.template.fields} look={t.look} /></div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    </section>

                    {drop.post_ideas?.length > 0 && (
                        <section>
                            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[#777]">Posts to make this week</h3>
                            <div className="grid gap-4 md:grid-cols-3">
                                {drop.post_ideas.map((p) => (
                                    <article key={p.title} className="flex flex-col rounded-2xl border border-[#E6E6E1] bg-white p-5">
                                        <h4 className="font-bold text-[#111]">{p.title}</h4>
                                        {p.fields?.headline && <p className="mt-2 whitespace-pre-line text-lg leading-tight text-[#111]">{p.fields.headline.replace(/[{}_]/g, '')}</p>}
                                        <p className="mt-2 flex-1 text-sm text-[#555]">{p.why}</p>
                                        <div className="mt-4"><TryIt onTry={onTry} templateId={p.template} fields={p.fields} look={p.look}>Make it</TryIt></div>
                                    </article>
                                ))}
                            </div>
                        </section>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                        {drop.shot_list?.length > 0 && (
                            <section className="rounded-2xl border border-[#E6E6E1] bg-white p-5">
                                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-[#777]"><Camera size={15} /> Shot list</h3>
                                <ul className="space-y-2 text-sm text-[#333]">
                                    {drop.shot_list.map((s) => <li key={s} className="flex gap-2"><span className="mt-2 h-1 w-1 flex-none rounded-full bg-[#E8D200]" />{s}</li>)}
                                </ul>
                            </section>
                        )}
                        {drop.sources?.length > 0 && (
                            <section className="rounded-2xl border border-[#E6E6E1] bg-white p-5">
                                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[#777]">Sources</h3>
                                <ul className="space-y-1.5 text-sm">
                                    {[...new Map(drop.sources.map((s) => [s.url, s])).values()].map((s) => (
                                        <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[#111] underline decoration-[#DDD] underline-offset-2 hover:decoration-[#111]">{s.label}<ExternalLink size={11} /></a></li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
