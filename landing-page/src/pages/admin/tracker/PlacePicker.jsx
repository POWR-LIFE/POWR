import React from 'react';
import { SURFACES, surfaceOf, areaOf } from './taxonomy';
import { Label, selectClass } from './ui';

/**
 * Where in POWR an issue lives. The full picker walks surface → area →
 * feature with the blurbs and code paths on show; `compact` is three selects
 * for the drawer's side column.
 */
export default function PlacePicker({ value, onChange, compact = false }) {
    const surface = surfaceOf(value.surface);
    const area = areaOf(value.surface, value.area);

    const setSurface = (key) => onChange({ surface: key, area: null, feature: null });
    const setArea = (key) => onChange({ surface: value.surface, area: key || null, feature: null });
    const setFeature = (label) => onChange({ surface: value.surface, area: value.area, feature: label || null });

    if (compact) {
        return (
            <div className="space-y-2">
                <select aria-label="Surface" className={`${selectClass} w-full`} value={value.surface ?? ''} onChange={e => setSurface(e.target.value)}>
                    {SURFACES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <select aria-label="Area" className={`${selectClass} w-full`} value={value.area ?? ''} onChange={e => setArea(e.target.value)}>
                    <option value="">Area…</option>
                    {surface?.areas.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                {area?.features?.length ? (
                    <select aria-label="Feature" className={`${selectClass} w-full`} value={value.feature ?? ''} onChange={e => setFeature(e.target.value)}>
                        <option value="">Feature (optional)…</option>
                        {area.features.map(f => <option key={f} value={f}>{f}</option>)}
                        {value.feature && !area.features.includes(value.feature) ? <option value={value.feature}>{value.feature}</option> : null}
                    </select>
                ) : null}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div>
                <Label className="mb-2">Which part of POWR</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {SURFACES.map(s => {
                        const active = s.key === value.surface;
                        return (
                            <button
                                key={s.key}
                                type="button"
                                onClick={() => setSurface(s.key)}
                                aria-pressed={active}
                                className={`text-left p-3 rounded-2xl border transition-all ${active ? 'border-[#1A1A1A] bg-white' : 'border-[#E6E6E1] bg-white/60 hover:border-[#BBBBBB]'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                                    <span className="text-[12px] font-bold text-[#1A1A1A] truncate">{s.label}</span>
                                </div>
                                <div className="text-[10px] text-[#888888] leading-snug mt-1 line-clamp-2">{s.blurb}</div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {surface ? (
                <div>
                    <Label className="mb-2">Which area of {surface.label}</Label>
                    <div className="flex flex-wrap gap-2">
                        {surface.areas.map(a => {
                            const active = a.key === value.area;
                            return (
                                <button
                                    key={a.key}
                                    type="button"
                                    onClick={() => setArea(active ? null : a.key)}
                                    aria-pressed={active}
                                    className={`h-8 px-3 rounded-full border text-[11px] font-bold transition-all ${active ? 'border-transparent text-white' : 'border-[#E6E6E1] bg-white text-[#444444] hover:border-[#BBBBBB]'}`}
                                    style={active ? { background: surface.ink } : undefined}
                                >
                                    {a.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            {area ? (
                <div>
                    <Label className="mb-2">Which piece <span className="normal-case tracking-normal font-bold text-[#BBBBBB]">(optional)</span></Label>
                    <div className="flex flex-wrap gap-2">
                        {(area.features ?? []).map(f => {
                            const active = f === value.feature;
                            return (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => setFeature(active ? null : f)}
                                    aria-pressed={active}
                                    className={`h-7 px-3 rounded-full border text-[11px] transition-all ${active ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white' : 'border-[#E6E6E1] bg-white text-[#555555] hover:border-[#BBBBBB]'}`}
                                >
                                    {f}
                                </button>
                            );
                        })}
                    </div>
                    {area.paths?.length ? (
                        <div className="mt-3 text-[11px] text-[#888888]">
                            Code: {area.paths.map((p, i) => <code key={p} className="font-mono text-[10px] text-[#666666]">{i ? ', ' : ''}{p}</code>)}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
