import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, X, Moon, Calendar, Check } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, PageTitle, Spinner, Empty, INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { createGymEvent, fetchEventTemplates, fetchGymEvent, fetchPointPresets } from './venueApi';
import { fmtDay, isoDay, withGym } from './eventUi';
import { hourLabel } from '../../../../shared/gymBoard.ts';

// A new event is a template plus the few things only the gym knows: a name,
// the first day, and the prizes. Scoring, points and every other date come
// from the template on the server — the preview here is only a preview.

const DAY = 86_400_000;

/** What the template will make of this start date, in UK time. */
export function schedulePreview(tpl, startDate) {
    if (!tpl || !startDate) return null;
    const start = new Date(`${startDate}T12:00:00Z`);
    const end = new Date(start.getTime() + tpl.duration_days * DAY);
    const lastDayIso = new Date(end.getTime() - DAY).toISOString();
    return {
        scoring: `${fmtDay(start.toISOString())} → ${fmtDay(lastDayIso)}`,
        night: tpl.night_start_hour != null
            ? `${fmtDay(end.toISOString())}, ${hourLabel(tpl.night_start_hour)}–${hourLabel((tpl.night_start_hour + tpl.night_hours) % 24)}`
            : null,
        sealed: fmtDay(end.toISOString()),
    };
}

const chip = (on) =>
    `h-10 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-all disabled:opacity-40 ${
        on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600]'
    }`;

/**
 * The fields a gym fills in. `locked` lists keys that can't change any more
 * (the server enforces the same). Rules are the gym's OWN extra lines — the
 * template's rules always lead and are shown read-only.
 */
export function EventForm({ tpl, presets, gymName, value, onChange, locked = [] }) {
    const set = (patch) => onChange({ ...value, ...patch });
    const can = (k) => !locked.includes(k);
    const preview = schedulePreview(tpl, value.start_date);
    const presetOptions = presets.filter(p => tpl.allowed_presets.includes(p.key));
    const prizes = value.prizes.length ? value.prizes : [''];

    return (
        <div className="space-y-8">
            <div>
                <label className={LABEL}>Event name</label>
                <input className={INPUT} value={value.name} maxLength={48} disabled={!can('name')}
                    onChange={e => set({ name: e.target.value })} placeholder={`${gymName} October Challenge`} />
            </div>

            <div>
                <label className={LABEL}>First day</label>
                <input type="date" className={`${INPUT} max-w-xs`} value={value.start_date} disabled={!can('start_date')}
                    min={isoDay(new Date())} max={isoDay(new Date(Date.now() + 89 * DAY))}
                    onChange={e => set({ start_date: e.target.value })} />
                {preview && (
                    <div className="mt-4 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl space-y-2 text-[12px]">
                        <div className="flex items-center gap-2"><Calendar size={13} className="text-[#8a7600]" /><span className="font-bold">Scoring {preview.scoring}</span></div>
                        {preview.night
                            ? <div className="flex items-center gap-2"><Moon size={13} className="text-[#8a7600]" /><span className="font-bold">Finale night {preview.night}</span><span className="text-[#999]">— board sealed until you reveal</span></div>
                            : <div className="text-[#999] pl-5">Board seals after the last day. You reveal the winners, or POWR does about 3 days later.</div>}
                        <div className="text-[#999] pl-5">Members can join until the board seals.</div>
                    </div>
                )}
            </div>

            <div>
                <label className={LABEL}>Prizes, 1st place first</label>
                <div className="space-y-2">
                    {prizes.map((p, i) => (
                        <div key={i} className="flex items-center gap-3">
                            <span className="w-8 text-[11px] font-black text-[#BBBBBB]">{i + 1}{['st', 'nd', 'rd'][i] ?? 'th'}</span>
                            <input className={INPUT} value={p} maxLength={60} disabled={!can('prizes')}
                                placeholder={['A free month', 'A PT session', 'Gym merch'][i] ?? 'Prize'}
                                onChange={e => set({ prizes: prizes.map((x, j) => (j === i ? e.target.value : x)) })} />
                            {can('prizes') && prizes.length > 1 && (
                                <button type="button" onClick={() => set({ prizes: prizes.filter((_, j) => j !== i) })}
                                    className="w-10 h-10 shrink-0 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#999]" aria-label="Remove prize">
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                {can('prizes') && prizes.length < 5 && (
                    <button type="button" onClick={() => set({ prizes: [...prizes, ''] })} className={`${BTN_GHOST} h-10 mt-3`}>
                        <Plus size={13} /> Add a prize
                    </button>
                )}
                <p className="text-[11px] text-[#AAAAAA] mt-3">You give these out. Winners show their POWR ID at the front desk.</p>
            </div>

            {presetOptions.length > 1 && (
                <div>
                    <label className={LABEL}>Finale night bonus</label>
                    <div className="flex flex-wrap gap-2">
                        {presetOptions.map(p => (
                            <button key={p.key} type="button" disabled={!can('points_preset_key')} onClick={() => set({ points_preset_key: p.key })}
                                className={chip(value.points_preset_key === p.key)}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-[#AAAAAA] mt-3">POWR pays it automatically to members who join and are checked in at {gymName} on the night.</p>
                </div>
            )}

            {tpl.radius_choices?.length > 0 && (
                <div>
                    <label className={LABEL}>Also show it to people nearby</label>
                    <div className="flex flex-wrap gap-2">
                        {[null, ...tpl.radius_choices].map(km => (
                            <button key={km ?? 'off'} type="button" disabled={!can('audience_radius_km')} onClick={() => set({ audience_radius_km: km })}
                                className={chip((value.audience_radius_km ?? null) === km)}>
                                {km ? `Within ${km} km` : 'Just my members'}
                            </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-[#AAAAAA] mt-3">Your members and anyone who’s trained at {gymName} lately always see it. Anyone can join from your QR code or link.</p>
                </div>
            )}

            <div>
                <label className={LABEL}>Headline <span className="normal-case tracking-normal text-[#CCCCCC]">— optional</span></label>
                <input className={INPUT} value={value.promo_headline ?? ''} maxLength={80} disabled={!can('promo_headline')}
                    onChange={e => set({ promo_headline: e.target.value })} placeholder="Most sessions in October wins a free month" />
            </div>

            <div>
                <label className={LABEL}>Rules</label>
                <ul className="space-y-1.5 mb-3">
                    {(tpl.default_rules ?? []).map((r, i) => (
                        <li key={i} className="flex gap-2 text-[12px] text-[#666]"><Check size={13} className="text-[#8a7600] mt-0.5 shrink-0" />{withGym(r, gymName)}</li>
                    ))}
                </ul>
                <textarea
                    className={`${INPUT} h-24 py-3 resize-none`}
                    value={(value.extraRules ?? []).join('\n')}
                    disabled={!can('rules')}
                    onChange={e => set({ extraRules: e.target.value.split('\n').slice(0, 8) })}
                    placeholder="Any rules of your own, one per line (optional)"
                />
            </div>
        </div>
    );
}

/** The payload the server wants from the form's value. */
export function toFields(value) {
    return {
        name: value.name,
        start_date: value.start_date,
        prizes: value.prizes.map(p => p.trim()).filter(Boolean),
        rules: (value.extraRules ?? []).map(r => r.trim()).filter(Boolean),
        promo_headline: value.promo_headline ?? '',
        points_preset_key: value.points_preset_key,
        audience_radius_km: value.audience_radius_km ?? null,
    };
}

export default function VenueEventNew() {
    const { gym } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const fromId = params.get('from');

    const [templates, setTemplates] = useState(null);
    const [presets, setPresets] = useState([]);
    const [tplKey, setTplKey] = useState(null);
    const [value, setValue] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        Promise.all([fetchEventTemplates(), fetchPointPresets(), fromId ? fetchGymEvent(fromId).catch(() => null) : null])
            .then(([t, p, prev]) => {
                if (!alive) return;
                setTemplates(t);
                setPresets(p);
                // "Run again": same template and prizes, a fresh date.
                if (prev?.template_key && t.some(x => x.key === prev.template_key)) {
                    const tpl = t.find(x => x.key === prev.template_key);
                    setTplKey(tpl.key);
                    setValue({
                        name: prev.name,
                        start_date: '',
                        prizes: (prev.prizes ?? []).map(p => p.label),
                        extraRules: (prev.rules ?? []).slice(prev.template?.rule_count ?? 0),
                        promo_headline: prev.promo_headline ?? '',
                        points_preset_key: prev.points_preset_key ?? tpl.default_preset,
                        audience_radius_km: prev.audience_radius_km ?? null,
                    });
                }
            })
            .catch(err => alive && setError(err.message));
        return () => { alive = false; };
    }, [fromId]);

    const tpl = useMemo(() => templates?.find(t => t.key === tplKey) ?? null, [templates, tplKey]);

    // Switching template keeps what's been typed; the points option resets
    // when the new template doesn't offer it.
    const pick = (t) => {
        setTplKey(t.key);
        setValue(v => {
            const base = v ?? { name: '', start_date: '', prizes: [''], extraRules: [], promo_headline: '', points_preset_key: t.default_preset, audience_radius_km: null };
            return {
                ...base,
                points_preset_key: t.allowed_presets.includes(base.points_preset_key) ? base.points_preset_key : t.default_preset,
                audience_radius_km: t.radius_choices.includes(base.audience_radius_km) ? base.audience_radius_km : null,
            };
        });
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const ev = await createGymEvent(gym.partner_id, tpl.key, toFields(value));
            toast.success('Draft saved');
            navigate(`/venue/events/${ev.id}`);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (error && !templates) return <Empty title="Couldn't load event types">{error}</Empty>;
    if (!templates) return <Spinner />;

    return (
        <Page>
            <Link to="/venue/events" className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black">
                <ArrowLeft size={13} className="text-[#BBBBBB]" /><span className="text-[#BBBBBB] hover:text-[#8a7600]">Events</span>
            </Link>
            <PageTitle eyebrow={fromId ? 'Run it again' : 'New event'} title={tpl ? tpl.name : 'What kind of event?'} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {templates.map(t => (
                    <button key={t.key} type="button" onClick={() => pick(t)} className="text-left">
                        <Card className={`p-6 h-full transition-all ${tplKey === t.key ? '' : 'hover:border-[#E8D200]/40'}`} glow={tplKey === t.key}>
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <Micro gold={tplKey === t.key}>{t.duration_days} days{t.night_start_hour != null ? ' + finale night' : ''}</Micro>
                                {tplKey === t.key && <Check size={16} className="text-[#8a7600]" />}
                            </div>
                            <div className="text-xl font-light tracking-tight text-[#1A1A1A]">{t.name}</div>
                            <p className="text-[12px] text-[#888] leading-relaxed mt-2">{withGym(t.blurb, gym.name)}</p>
                        </Card>
                    </button>
                ))}
            </div>

            {tpl && value && (
                <Card className="p-6 sm:p-10 max-w-3xl">
                    <EventForm tpl={tpl} presets={presets} gymName={gym.name} value={value} onChange={setValue} />
                    {error && <div className="mt-8 text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}
                    <div className="mt-8 flex flex-wrap items-center gap-4">
                        <button type="button" disabled={saving} onClick={save} className={BTN_GOLD}>{saving ? 'Saving…' : 'Save draft'}</button>
                        <span className="text-[11px] text-[#AAAAAA]">Nothing goes out yet. You’ll check it over and publish on the next page.</span>
                    </div>
                </Card>
            )}
        </Page>
    );
}
