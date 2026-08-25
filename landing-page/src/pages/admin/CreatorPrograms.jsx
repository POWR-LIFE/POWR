import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus, Trash2, Star, Save, Package, Gift, Coins, X, Truck, Check, ImagePlus, LoaderCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { storageImage, uploadPublicImage } from '../../lib/storage';

/**
 * /admin/creators/programmes — the rules and rewards engine.
 *
 * A programme is a rule set (what converts, what each side is paid, event
 * bonus) plus a ladder of steps (points / product / catalogue reward at N).
 * Every creator points at one; the Default catches everyone else. The
 * vocabulary is copied from the live-events editor on purpose so an admin
 * who has set up an event already knows how to set up a programme.
 *
 * Writes go straight to the tables under the is_admin() RLS policies —
 * creators can't write these tables at all, so the column-grant fence that
 * forces creator edits through the edge function doesn't apply here.
 */

// Mirrors live_events: walking/sleep/dance are left out of the default
// conversion list because wearables record them without any effort.
const ACTIVITIES = ['gym', 'running', 'cycling', 'hiit', 'yoga', 'swimming', 'sports', 'walking', 'dance'];
// Manual is deliberately absent. The trigger refuses it even if written.
const VERIFICATIONS = ['geofence', 'wearable', 'gps', 'hr'];

const BLANK_PROGRAM = {
    name: '', description: '', active: true, is_default: false,
    conversion_verifications: ['geofence', 'wearable'],
    conversion_activities: ['gym', 'running', 'cycling', 'hiit', 'yoga', 'swimming', 'sports'],
    min_session_minutes: 0, conversion_window_days: null,
    invitee_bonus_points: 20, creator_signup_points: 0, creator_conversion_points: 50,
    event_signup_points: 0, event_signup_requires_conversion: true,
    step_counting: 'conversions',
};

const BLANK_STEP = { n: 5, label: '', description: '', points: 0, product_name: '', product_sku: '', reward_id: null, active: true };

// ── Form controls (same shapes as LiveEvents.jsx, gold accent) ───────────────

function Field({ label, hint, children }) {
    return (
        <div className="flex items-start gap-6 flex-wrap">
            <div className="w-56 shrink-0 pt-2">
                <span className="text-[13.5px] font-semibold text-[#1A1A1A] leading-tight block">{label}</span>
                {hint && <span className="text-[11.5px] text-[#999999] leading-snug block mt-0.5">{hint}</span>}
            </div>
            <div className="flex-1 min-w-[240px]">{children}</div>
        </div>
    );
}

function TextInput({ value, onChange, placeholder, mono, wide }) {
    return (
        <input
            type="text"
            value={value ?? ''}
            placeholder={placeholder}
            onChange={e => onChange(e.target.value)}
            className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] placeholder-[#CCCCCC] outline-none transition-all focus:border-[#E8D200]/50 ${mono ? 'font-mono' : ''}`}
        />
    );
}

function NumberInput({ value, onChange, min = 0, max = 100000, unit, nullable }) {
    return (
        <div className="relative inline-block">
            <input
                type="number"
                value={value ?? ''}
                min={min} max={max}
                placeholder={nullable ? 'none' : undefined}
                onChange={e => {
                    if (nullable && e.target.value === '') return onChange(null);
                    onChange(Math.max(min, Math.min(max, parseInt(e.target.value || '0', 10))));
                }}
                className={`w-36 h-11 px-4 ${unit ? 'pr-20' : ''} bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-sm text-[#1A1A1A] placeholder-[#CCCCCC] outline-none focus:border-[#E8D200]/50 transition-all`}
            />
            {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#999999] font-black uppercase tracking-[0.15em] pointer-events-none">{unit}</span>}
        </div>
    );
}

function Toggle({ on, onFlip, labels = ['On', 'Off'] }) {
    return (
        <div className="flex items-center gap-3 pt-1">
            <button
                type="button" role="switch" aria-checked={on} onClick={onFlip}
                className={`relative w-14 h-8 rounded-full transition-colors ${on ? 'bg-[#E8D200]' : 'bg-[#D8D8D2]'}`}
            >
                <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
            </button>
            <span className={`text-[10px] font-black uppercase tracking-[0.3em] ${on ? 'text-[#8a7600]' : 'text-[#BBBBBB]'}`}>{on ? labels[0] : labels[1]}</span>
        </div>
    );
}

function Chip({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`h-9 px-3.5 rounded-full border text-[11px] font-bold tracking-wide transition-all ${
                active
                    ? 'bg-[#E8D200]/15 border-[#E8D200]/50 text-[#8a7600]'
                    : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#888888] hover:text-[#1A1A1A]'
            }`}
        >
            {children}
        </button>
    );
}

function ChipSet({ options, value, onChange }) {
    const list = Array.isArray(value) ? value : [];
    const all = options.every(o => list.includes(o));
    return (
        <div className="flex gap-2 flex-wrap">
            <Chip active={all} onClick={() => onChange(all ? [] : [...options])}>All</Chip>
            {options.map(o => {
                const on = list.includes(o);
                return (
                    <Chip key={o} active={on} onClick={() => onChange(on ? list.filter(x => x !== o) : [...list, o])}>
                        {o}
                    </Chip>
                );
            })}
        </div>
    );
}

// ── Programme editor ────────────────────────────────────────────────────────

function ProgramEditor({ program, rewards, creatorRewards, onSaved, onDeleted, onCancel }) {
    const isNew = !program?.id;
    const [form, setForm] = useState({ ...BLANK_PROGRAM, ...program });
    const [steps, setSteps] = useState([]);
    const [stepsLoaded, setStepsLoaded] = useState(isNew);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const [msg, setMsg] = useState(null);

    const set = (patch) => setForm(f => ({ ...f, ...patch }));

    useEffect(() => {
        if (isNew) return;
        supabase.from('creator_program_steps').select('*').eq('program_id', program.id).order('n')
            .then(({ data }) => { setSteps(data ?? []); setStepsLoaded(true); });
    }, [program?.id, isNew]);

    const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 3000); };

    const saveProgram = async () => {
        if (!form.name.trim()) return setErr('Give the programme a name.');
        if (form.conversion_verifications.length === 0) return setErr('At least one verification must count, or nothing can ever convert.');
        if (form.conversion_activities.length === 0) return setErr('At least one activity must count, or nothing can ever convert.');
        setErr(null); setBusy(true);
        const payload = {
            name: form.name.trim(),
            description: form.description?.trim() || null,
            active: form.active,
            conversion_verifications: form.conversion_verifications,
            conversion_activities: form.conversion_activities,
            min_session_minutes: form.min_session_minutes ?? 0,
            conversion_window_days: form.conversion_window_days ?? null,
            invitee_bonus_points: form.invitee_bonus_points ?? 0,
            creator_signup_points: form.creator_signup_points ?? 0,
            creator_conversion_points: form.creator_conversion_points ?? 0,
            event_signup_points: form.event_signup_points ?? 0,
            event_signup_requires_conversion: !!form.event_signup_requires_conversion,
            step_counting: form.step_counting,
            updated_at: new Date().toISOString(),
        };
        const q = isNew
            ? supabase.from('creator_programs').insert(payload).select().single()
            : supabase.from('creator_programs').update(payload).eq('id', program.id).select().single();
        const { data, error } = await q;
        setBusy(false);
        if (error) return setErr(error.message);
        flash('Programme saved');
        onSaved(data);
    };

    const makeDefault = async () => {
        setBusy(true);
        // Exactly one default — clear the old one first, in order, so the
        // partial unique index never sees two.
        await supabase.from('creator_programs').update({ is_default: false }).eq('is_default', true);
        const { error } = await supabase.from('creator_programs').update({ is_default: true }).eq('id', program.id);
        setBusy(false);
        if (error) return setErr(error.message);
        onSaved({ ...form, is_default: true });
    };

    const remove = async () => {
        if (form.is_default) return setErr("You can't delete the default programme — make another one the default first.");
        if (!window.confirm(`Delete "${form.name}"? Creators on it fall back to the default programme.`)) return;
        setBusy(true);
        const { error } = await supabase.from('creator_programs').delete().eq('id', program.id);
        setBusy(false);
        if (error) return setErr(error.message);
        onDeleted(program.id);
    };

    // ── steps ──
    const setStep = (i, patch) => setSteps(ss => ss.map((s, idx) => idx === i ? { ...s, ...patch } : s));
    const addStep = () => {
        const lastN = steps.reduce((m, s) => Math.max(m, s.n), 0);
        setSteps(ss => [...ss, { ...BLANK_STEP, n: lastN ? lastN * 2 : 5, _new: true }]);
    };
    const saveStep = async (i) => {
        const s = steps[i];
        if (!s.label?.trim()) return setErr('Every step needs a label.');
        setErr(null); setBusy(true);
        const payload = {
            program_id: program.id, n: s.n, label: s.label.trim(),
            description: s.description?.trim() || null,
            points: s.points ?? 0,
            creator_reward_id: s.creator_reward_id || null,
            reward_id: s.reward_id || null,
            active: s.active !== false,
        };
        const q = s.id
            ? supabase.from('creator_program_steps').update(payload).eq('id', s.id).select().single()
            : supabase.from('creator_program_steps').insert(payload).select().single();
        const { data, error } = await q;
        setBusy(false);
        if (error) return setErr(/program_id_n_key/.test(error.message) ? `There's already a step at ${s.n}.` : error.message);
        setStep(i, { ...data, _new: false, _dirty: false });
        flash(`Step "${data.label}" saved`);
    };
    const removeStep = async (i) => {
        const s = steps[i];
        if (s.id) {
            if (!window.confirm(`Remove step "${s.label}"? Creators who already reached it keep their record.`)) return;
            setBusy(true);
            const { error } = await supabase.from('creator_program_steps').delete().eq('id', s.id);
            setBusy(false);
            if (error) return setErr(error.message);
        }
        setSteps(ss => ss.filter((_, idx) => idx !== i));
    };

    const btn = "h-11 px-6 rounded-full text-[10px] uppercase tracking-[0.2em] font-black transition-all disabled:opacity-50";

    return (
        <div className="space-y-6">
            {err && <div className="text-red-500 text-xs bg-red-500/5 p-4 border border-red-500/20 rounded-2xl">{err}</div>}
            {msg && <div className="text-[#8a7600] text-xs bg-[#E8D200]/5 p-4 border border-[#E8D200]/20 rounded-2xl">{msg}</div>}

            {/* Identity */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{isNew ? 'New programme' : 'Programme'}</h2>
                    {form.is_default && (
                        <span className="flex items-center gap-2 px-4 py-1.5 bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full text-[9px] uppercase tracking-[0.2em] font-black text-[#8a7600]">
                            <Star size={11} /> Default
                        </span>
                    )}
                </div>
                <Field label="Name"><TextInput value={form.name} onChange={v => set({ name: v })} placeholder="Gym owners" /></Field>
                <Field label="Description" hint="Admin-only note. Creators never see it."><TextInput wide value={form.description} onChange={v => set({ description: v })} /></Field>
                <Field label="Active" hint="An inactive programme still applies to creators on it — this is just a flag for your own tidiness."><Toggle on={form.active} onFlip={() => set({ active: !form.active })} /></Field>
            </div>

            {/* Conversion rules */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 space-y-6">
                <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">What counts as a conversion</h2>
                <p className="text-[12px] text-[#888] font-light leading-relaxed -mt-2 max-w-2xl">
                    A signup converts on their first workout that passes every rule below. Manually typed workouts never
                    count, whatever is set here — that is the anti-farming line and it isn't configurable.
                </p>
                <Field label="Verifications that count" hint="How the workout was proven. Geofence = checked in at a gym, wearable = synced from a watch.">
                    <ChipSet options={VERIFICATIONS} value={form.conversion_verifications} onChange={v => set({ conversion_verifications: v })} />
                </Field>
                <Field label="Activities that count" hint="Walking and sleep are left out by default because wearables record them without any effort.">
                    <ChipSet options={ACTIVITIES} value={form.conversion_activities} onChange={v => set({ conversion_activities: v })} />
                </Field>
                <Field label="Minimum workout length" hint="A session shorter than this doesn't convert. 0 = any length.">
                    <NumberInput value={form.min_session_minutes} onChange={v => set({ min_session_minutes: v })} max={600} unit="min" />
                </Field>
                <Field label="Conversion deadline" hint="Days after entering the code by which the first workout must happen. Blank = no deadline.">
                    <NumberInput nullable value={form.conversion_window_days} onChange={v => set({ conversion_window_days: v })} min={1} max={365} unit="days" />
                </Field>
            </div>

            {/* Payouts */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 space-y-6">
                <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Points per signup</h2>
                <Field label="Invitee gets, on conversion" hint="Paid to the person who used the code when they convert. This is what makes the code worth typing.">
                    <NumberInput value={form.invitee_bonus_points} onChange={v => set({ invitee_bonus_points: v })} max={5000} unit="pts" />
                </Field>
                <Field label="Creator gets, on conversion" hint="A creator's own override (on their card) beats this.">
                    <NumberInput value={form.creator_conversion_points} onChange={v => set({ creator_conversion_points: v })} max={5000} unit="pts" />
                </Field>
                <Field label="Creator gets, on code entry" hint="Paid the moment a code is entered, BEFORE any workout. Farmable — leave at 0 unless you have a reason.">
                    <NumberInput value={form.creator_signup_points} onChange={v => set({ creator_signup_points: v })} max={5000} unit="pts" />
                </Field>
            </div>

            {/* Event bonus */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 space-y-6">
                <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Live event bonus</h2>
                <Field label="Creator gets, per event signup" hint="Paid when one of their signups joins a scheduled or live event. Once per person per event. 0 = off.">
                    <NumberInput value={form.event_signup_points} onChange={v => set({ event_signup_points: v })} max={5000} unit="pts" />
                </Field>
                <Field label="Only after conversion" hint="Off means a code entry + an event tap with no workout pays out. On is the safe setting.">
                    <Toggle on={form.event_signup_requires_conversion} onFlip={() => set({ event_signup_requires_conversion: !form.event_signup_requires_conversion })} />
                </Field>
            </div>

            {/* Step ladder */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Steps</h2>
                    {!isNew && (
                        <button onClick={addStep} className="flex items-center gap-2 h-9 px-4 bg-[#1A1A1A] text-white rounded-full text-[9px] uppercase tracking-[0.2em] font-black hover:bg-[#333] transition-all">
                            <Plus size={12} /> Add step
                        </button>
                    )}
                </div>
                <Field label="Steps count" hint="Conversions is the safe choice. Signups pays for code entries alone.">
                    <div className="flex gap-2">
                        {['conversions', 'signups'].map(v => (
                            <Chip key={v} active={form.step_counting === v} onClick={() => set({ step_counting: v })}>{v}</Chip>
                        ))}
                    </div>
                </Field>

                {isNew ? (
                    <p className="text-[12px] text-[#999] font-light">Save the programme first, then add steps.</p>
                ) : !stepsLoaded ? (
                    <p className="text-[11px] text-[#CCC] font-black">Loading steps...</p>
                ) : steps.length === 0 ? (
                    <p className="text-[12px] text-[#999] font-light">No steps yet. Each step can pay points, ship a product, grant a catalogue reward — or all three.</p>
                ) : (
                    <div className="space-y-4">
                        {steps.map((s, i) => (
                            <div key={s.id ?? `new-${i}`} className={`p-6 rounded-2xl border ${s._dirty || s._new ? 'border-[#E8D200]/50 bg-[#E8D200]/[0.03]' : 'border-[#E6E6E1] bg-[#FAFAF8]'}`}>
                                <div className="grid grid-cols-[110px_1fr_1fr] gap-4 mb-4">
                                    <div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-2">At</div>
                                        <NumberInput value={s.n} onChange={v => setStep(i, { n: v, _dirty: true })} min={1} max={100000} unit={form.step_counting === 'signups' ? 'signups' : 'conv.'} />
                                    </div>
                                    <div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-2">Label</div>
                                        <TextInput value={s.label} onChange={v => setStep(i, { label: v, _dirty: true })} placeholder="First five" />
                                    </div>
                                    <div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-2">Description (creator sees this)</div>
                                        <TextInput value={s.description} onChange={v => setStep(i, { description: v, _dirty: true })} placeholder="A POWR hoodie in your size" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-[150px_1.4fr_1fr] gap-4 mb-5">
                                    <div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-2 flex items-center gap-1.5"><Coins size={10} /> Points</div>
                                        <NumberInput value={s.points} onChange={v => setStep(i, { points: v, _dirty: true })} max={100000} unit="pts" />
                                    </div>
                                    <div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-2 flex items-center gap-1.5"><Package size={10} /> Reward</div>
                                        <div className="flex items-center gap-3">
                                            {(() => { const r = creatorRewards.find(x => x.id === s.creator_reward_id); return r?.image_url
                                                ? <img src={storageImage(r.image_url, 96)} alt="" className="w-11 h-11 rounded-lg object-cover border border-[#E6E6E1] shrink-0" />
                                                : <div className="w-11 h-11 rounded-lg bg-[#F4F4F1] border border-dashed border-[#D8D8D2] shrink-0" />; })()}
                                            <select
                                                value={s.creator_reward_id ?? ''}
                                                onChange={e => setStep(i, { creator_reward_id: e.target.value || null, _dirty: true })}
                                                className="flex-1 h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/50"
                                            >
                                                <option value="">None — points only</option>
                                                {creatorRewards.map(r => <option key={r.id} value={r.id}>{r.name}{r.value_label ? ` · ${r.value_label}` : ''}{!r.active ? ' (inactive)' : ''}</option>)}
                                            </select>
                                        </div>
                                        {creatorRewards.length === 0 && <p className="text-[10px] text-[#BBBBBB] font-light mt-2">No rewards yet — add them on the <Link to="/admin/creators/rewards" className="underline">Rewards</Link> tab.</p>}
                                    </div>
                                    <div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-2 flex items-center gap-1.5"><Gift size={10} /> Catalogue reward</div>
                                        <select
                                            value={s.reward_id ?? ''}
                                            onChange={e => setStep(i, { reward_id: e.target.value || null, _dirty: true })}
                                            className="w-full max-w-md h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/50"
                                        >
                                            <option value="">None</option>
                                            {rewards.map(r => <option key={r.id} value={r.id}>{r.brand_name ? `${r.brand_name} — ` : ''}{r.title}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => saveStep(i)} disabled={busy} className={`${btn} bg-[#E8D200] text-[#080808] flex items-center gap-2`}>
                                        <Save size={12} /> {s.id ? 'Save step' : 'Create step'}
                                    </button>
                                    <button onClick={() => setStep(i, { active: !(s.active !== false), _dirty: true })} className={`${btn} bg-white border border-[#E6E6E1] text-[#666]`}>
                                        {s.active !== false ? 'Active' : 'Inactive'}
                                    </button>
                                    <button onClick={() => removeStep(i)} disabled={busy} className="ml-auto flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] font-black text-red-400 hover:text-red-600">
                                        <Trash2 size={12} /> Remove
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {!isNew && (
                    <p className="text-[11px] text-[#AAAAAA] font-light leading-relaxed">
                        A step with a product or catalogue reward creates an <span className="font-mono">owed</span> record when reached.
                        Nothing ships itself — you approve it in Fulfilment.
                    </p>
                )}
            </div>

            <div className="flex items-center gap-3">
                <button onClick={saveProgram} disabled={busy} className={`${btn} bg-[#E8D200] text-[#080808] h-12 px-8`}>
                    {busy ? 'Saving...' : isNew ? 'Create programme' : 'Save programme'}
                </button>
                {!isNew && !form.is_default && (
                    <button onClick={makeDefault} disabled={busy} className={`${btn} bg-white border border-[#E6E6E1] text-[#666] h-12 px-6 flex items-center gap-2`}>
                        <Star size={12} /> Make default
                    </button>
                )}
                <button onClick={onCancel} className={`${btn} bg-white border border-[#E6E6E1] text-[#666] h-12 px-6`}>Close</button>
                {!isNew && (
                    <button onClick={remove} disabled={busy || form.is_default} className="ml-auto flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] font-black text-red-400 hover:text-red-600 disabled:opacity-30">
                        <Trash2 size={12} /> Delete programme
                    </button>
                )}
            </div>
        </div>
    );
}

// ── Fulfilment queue ─────────────────────────────────────────────────────────

const NEXT = { owed: 'approved', approved: 'shipped', shipped: 'delivered' };
const NEXT_LABEL = { owed: 'Approve', approved: 'Mark shipped', shipped: 'Mark delivered' };
const STATUS_TONE = {
    owed:      'bg-amber-500/10 border-amber-500/30 text-amber-700',
    approved:  'bg-[#E8D200]/10 border-[#E8D200]/30 text-[#8a7600]',
    shipped:   'bg-[#E8D200]/10 border-[#E8D200]/30 text-[#8a7600]',
    delivered: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#888]',
    cancelled: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#BBBBBB]',
};

function FulfilmentQueue({ rewards }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showDone, setShowDone] = useState(false);
    const [busy, setBusy] = useState(null);
    const [err, setErr] = useState(null);
    const [tracking, setTracking] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from('creator_milestones')
            .select('*, creators(display_name, handle, shipping_name, shipping_address), creator_rewards(name, image_url, sku, kind)')
            .neq('fulfilment_status', 'not_applicable')
            .order('created_at', { ascending: false })
            .limit(500);
        setRows(data ?? []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const rewardTitle = (id) => rewards.find(r => r.id === id)?.title;

    const advance = async (r, status) => {
        setBusy(`${r.creator_id}:${r.step_id}`); setErr(null);
        const t = tracking[`${r.creator_id}:${r.step_id}`] ?? {};
        const { error } = await supabase.rpc('admin_update_creator_fulfilment', {
            p_creator_id: r.creator_id, p_step_id: r.step_id, p_status: status,
            p_carrier: t.carrier || null, p_tracking: t.tracking || null, p_notes: null,
        });
        setBusy(null);
        if (error) return setErr(error.message);
        load();
    };

    const visible = rows.filter(r => showDone || !['delivered', 'cancelled'].includes(r.fulfilment_status));
    const open = rows.filter(r => ['owed', 'approved', 'shipped'].includes(r.fulfilment_status)).length;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{open} open</p>
                <button onClick={() => setShowDone(v => !v)} className="text-[9px] uppercase tracking-[0.2em] font-black text-[#999] hover:text-[#1A1A1A]">
                    {showDone ? 'Hide' : 'Show'} delivered & cancelled
                </button>
            </div>
            {err && <div className="text-red-500 text-xs bg-red-500/5 p-4 border border-red-500/20 rounded-2xl">{err}</div>}

            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" /></div>
                ) : visible.length === 0 ? (
                    <div className="text-center py-24 px-8">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black mb-3">Nothing to send</p>
                        <p className="text-sm text-[#888] font-light">When a creator reaches a step with a product or reward attached, it lands here.</p>
                    </div>
                ) : visible.map(r => {
                    const key = `${r.creator_id}:${r.step_id}`;
                    const addr = r.creators?.shipping_address;
                    const t = tracking[key] ?? {};
                    return (
                        <div key={key} className="border-b border-[#F0F0ED] last:border-0 px-8 py-6">
                            <div className="flex items-start gap-6">
                                {r.creator_rewards?.image_url ? (
                                    <img src={storageImage(r.creator_rewards.image_url, 160)} alt="" className="w-20 h-20 rounded-2xl object-cover border border-[#E6E6E1] shrink-0" />
                                ) : (
                                    <div className="w-20 h-20 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#CCC] shrink-0"><Package size={20} /></div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="text-[14px] font-bold text-[#1A1A1A]">{r.creators?.display_name}</span>
                                        <span className="text-[11px] text-[#BBBBBB] font-black">@{r.creators?.handle}</span>
                                        <span className={`px-3 py-1 rounded-full border text-[9px] uppercase tracking-[0.2em] font-black ${STATUS_TONE[r.fulfilment_status]}`}>{r.fulfilment_status}</span>
                                    </div>
                                    <div className="text-[12px] text-[#666] mb-3">
                                        <span className="font-semibold text-[#1A1A1A]">{r.label}</span> · reached at {r.converted_count}
                                        {(r.creator_rewards?.name || r.product_name) && <> · <Package size={11} className="inline -mt-0.5" /> {r.creator_rewards?.name ?? r.product_name}{(r.creator_rewards?.sku || r.product_sku) ? ` (${r.creator_rewards?.sku ?? r.product_sku})` : ''}</>}
                                        {r.reward_id && <> · <Gift size={11} className="inline -mt-0.5" /> {rewardTitle(r.reward_id) ?? 'catalogue reward'}</>}
                                    </div>
                                    {addr ? (
                                        <div className="text-[11px] text-[#888] font-mono leading-relaxed bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-4 py-3 inline-block">
                                            {r.creators?.shipping_name && <div className="text-[#1A1A1A]">{r.creators.shipping_name}</div>}
                                            {[addr.line1, addr.line2, addr.city, addr.postcode, addr.country].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                                        </div>
                                    ) : (
                                        <div className="text-[11px] text-amber-700 font-black">No shipping address on file — the creator adds one in Settings.</div>
                                    )}
                                    {r.tracking_number && <div className="text-[11px] text-[#888] mt-2 flex items-center gap-2"><Truck size={11} /> {r.carrier ? `${r.carrier} · ` : ''}{r.tracking_number}</div>}
                                </div>
                                <div className="shrink-0 space-y-2 w-64">
                                    {r.fulfilment_status === 'approved' && (
                                        <>
                                            <input placeholder="Carrier" value={t.carrier ?? ''} onChange={e => setTracking(m => ({ ...m, [key]: { ...t, carrier: e.target.value } }))} className="w-full h-10 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm outline-none focus:border-[#E8D200]/50" />
                                            <input placeholder="Tracking number" value={t.tracking ?? ''} onChange={e => setTracking(m => ({ ...m, [key]: { ...t, tracking: e.target.value } }))} className="w-full h-10 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm font-mono outline-none focus:border-[#E8D200]/50" />
                                        </>
                                    )}
                                    {NEXT[r.fulfilment_status] && (
                                        <button onClick={() => advance(r, NEXT[r.fulfilment_status])} disabled={busy === key} className="w-full h-10 bg-[#1A1A1A] text-white rounded-full text-[9px] uppercase tracking-[0.2em] font-black hover:bg-[#333] disabled:opacity-50 flex items-center justify-center gap-2">
                                            <Check size={12} /> {NEXT_LABEL[r.fulfilment_status]}
                                        </button>
                                    )}
                                    {['owed', 'approved'].includes(r.fulfilment_status) && (
                                        <button onClick={() => advance(r, 'cancelled')} disabled={busy === key} className="w-full h-10 bg-white border border-[#E6E6E1] text-red-400 rounded-full text-[9px] uppercase tracking-[0.2em] font-black hover:text-red-600 disabled:opacity-50">Cancel</button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Rewards catalogue ────────────────────────────────────────────────────────
// What a step actually gives. Physical items need a picture and a description
// a creator can look at and want — points alone don't get a hoodie printed.

const KINDS = ['physical', 'digital', 'experience'];
const BLANK_REWARD = { name: '', description: '', image_url: '', kind: 'physical', sku: '', value_label: '', active: true, sort_order: 0 };

function RewardImage({ value, onChange }) {
    const [uploading, setUploading] = useState(false);
    const [err, setErr] = useState(null);
    const handle = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true); setErr(null);
        try {
            // Same public bucket admins already have storage policies for.
            const url = await uploadPublicImage('reward-images', file, 'creator-rewards');
            onChange(url);
        } catch (e2) { setErr(e2.message); } finally { setUploading(false); e.target.value = ''; }
    };
    return (
        <div>
            <label className={`relative block w-40 h-40 rounded-2xl overflow-hidden border cursor-pointer group/img ${value ? 'border-[#E6E6E1]' : 'border-dashed border-[#D8D8D2] bg-[#FAFAF8]'} ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {value ? (
                    <img src={storageImage(value, 320)} alt="" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#999]">
                        {uploading ? <LoaderCircle size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                        <span className="text-[9px] font-black uppercase tracking-[0.18em]">{uploading ? 'Saving' : 'Add image'}</span>
                    </div>
                )}
                {value && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-white text-[9px] font-black uppercase tracking-[0.18em] opacity-0 group-hover/img:opacity-100 transition-opacity">Replace</div>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={handle} disabled={uploading} />
            </label>
            {value && <button type="button" onClick={() => onChange('')} className="mt-2 text-[9px] uppercase tracking-[0.2em] font-black text-red-400 hover:text-red-600">Remove</button>}
            {err && <p className="text-[11px] text-red-500 mt-2">{err}</p>}
        </div>
    );
}

function RewardForm({ item, onSaved, onCancel, onDeleted }) {
    const isNew = !item?.id;
    const [form, setForm] = useState({ ...BLANK_REWARD, ...item });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const set = (patch) => setForm(f => ({ ...f, ...patch }));

    const save = async () => {
        if (!form.name.trim()) return setErr('Give the reward a name.');
        setErr(null); setBusy(true);
        const payload = {
            name: form.name.trim(), description: form.description?.trim() || null,
            image_url: form.image_url || null, kind: form.kind, sku: form.sku?.trim() || null,
            value_label: form.value_label?.trim() || null, active: !!form.active, sort_order: form.sort_order ?? 0,
        };
        const q = isNew
            ? supabase.from('creator_rewards').insert(payload).select().single()
            : supabase.from('creator_rewards').update(payload).eq('id', item.id).select().single();
        const { data, error } = await q;
        setBusy(false);
        if (error) return setErr(error.message);
        onSaved(data);
    };
    const remove = async () => {
        if (!window.confirm(`Delete "${form.name}"? Steps using it fall back to points only; creators already owed it keep their record.`)) return;
        setBusy(true);
        const { error } = await supabase.from('creator_rewards').delete().eq('id', item.id);
        setBusy(false);
        if (error) return setErr(error.message);
        onDeleted(item.id);
    };
    const btn = "h-11 px-6 rounded-full text-[10px] uppercase tracking-[0.2em] font-black transition-all disabled:opacity-50";

    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 space-y-6">
            <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{isNew ? 'New reward' : 'Reward'}</h2>
            {err && <div className="text-red-500 text-xs bg-red-500/5 p-4 border border-red-500/20 rounded-2xl">{err}</div>}
            <div className="grid grid-cols-[176px_1fr] gap-8">
                <RewardImage value={form.image_url} onChange={v => set({ image_url: v })} />
                <div className="space-y-5">
                    <Field label="Name"><TextInput value={form.name} onChange={v => set({ name: v })} placeholder="POWR hoodie" /></Field>
                    <Field label="What it is" hint="Creators read this on their Rewards page. Say the thing — colour, size options, what's in the box.">
                        <textarea value={form.description ?? ''} onChange={e => set({ description: e.target.value })} maxLength={500}
                            className="w-full max-w-2xl h-24 px-4 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/50 resize-y" />
                    </Field>
                    <Field label="Kind" hint="Physical ships to their address. Digital and experience are fulfilled by hand too — they just don't need a parcel.">
                        <div className="flex gap-2">{KINDS.map(k => <Chip key={k} active={form.kind === k} onClick={() => set({ kind: k })}>{k}</Chip>)}</div>
                    </Field>
                    <Field label="Worth" hint='Shown to creators, e.g. "Worth £45".'><TextInput value={form.value_label} onChange={v => set({ value_label: v })} placeholder="Worth £45" /></Field>
                    <Field label="SKU" hint="For whoever packs the box."><TextInput mono value={form.sku} onChange={v => set({ sku: v })} placeholder="HOOD-BLK" /></Field>
                    <Field label="Active" hint="Inactive rewards stay on steps that already use them but can't be added to new ones."><Toggle on={form.active} onFlip={() => set({ active: !form.active })} /></Field>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <button onClick={save} disabled={busy} className={`${btn} bg-[#E8D200] text-[#080808] h-12 px-8`}>{busy ? 'Saving...' : isNew ? 'Create reward' : 'Save reward'}</button>
                <button onClick={onCancel} className={`${btn} bg-white border border-[#E6E6E1] text-[#666] h-12`}>Close</button>
                {!isNew && <button onClick={remove} disabled={busy} className="ml-auto flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] font-black text-red-400 hover:text-red-600"><Trash2 size={12} /> Delete</button>}
            </div>
        </div>
    );
}

function RewardsCatalogue({ items, onChanged }) {
    const [editing, setEditing] = useState(null); // row | 'new' | null
    if (editing) {
        return (
            <RewardForm
                item={editing === 'new' ? null : editing}
                onSaved={() => { setEditing(null); onChanged(); }}
                onDeleted={() => { setEditing(null); onChanged(); }}
                onCancel={() => setEditing(null)}
            />
        );
    }
    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <button onClick={() => setEditing('new')} className="flex items-center gap-3 h-12 px-8 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-[11px] rounded-full hover:translate-y-[-2px] transition-all">
                    <Plus size={16} /> New reward
                </button>
            </div>
            {items.length === 0 ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl text-center py-24 px-8">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black mb-3">No rewards yet</p>
                    <p className="text-sm text-[#888] font-light">Add the hoodie, the kit, the tickets — then attach them to steps on a programme.</p>
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-5">
                    {items.map(r => (
                        <button key={r.id} onClick={() => setEditing(r)} className={`text-left bg-white border rounded-3xl overflow-hidden hover:border-[#E8D200]/50 transition-all ${r.active ? 'border-[#E6E6E1]' : 'border-[#E6E6E1] opacity-60'}`}>
                            {r.image_url ? (
                                <img src={storageImage(r.image_url, 640)} alt="" className="w-full aspect-[4/3] object-cover" />
                            ) : (
                                <div className="w-full aspect-[4/3] bg-[#F4F4F1] flex items-center justify-center text-[#CCC]"><Package size={28} /></div>
                            )}
                            <div className="p-6">
                                <div className="flex items-center justify-between gap-3 mb-1">
                                    <span className="text-[15px] font-bold text-[#1A1A1A] truncate">{r.name}</span>
                                    <span className="px-3 py-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] uppercase tracking-[0.2em] font-black text-[#999] shrink-0">{r.kind}</span>
                                </div>
                                {r.value_label && <div className="text-[11px] text-[#8a7600] font-black">{r.value_label}</div>}
                                {r.description && <p className="text-[12px] text-[#888] font-light mt-2 line-clamp-2">{r.description}</p>}
                                {!r.active && <div className="text-[9px] uppercase tracking-[0.2em] font-black text-[#BBBBBB] mt-3">Inactive</div>}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function CreatorTabs() {
    const { pathname } = useLocation();
    const tabs = [
        { label: 'Creators',   to: '/admin/creators' },
        { label: 'Programmes', to: '/admin/creators/programmes' },
        { label: 'Rewards',    to: '/admin/creators/rewards' },
        { label: 'Fulfilment', to: '/admin/creators/fulfilment' },
    ];
    // Colour lives on the inner span: style.css has an unlayered
    // `a { color: inherit }` that silently beats any text-* utility on an <a>.
    return (
        <div className="flex gap-2 mb-8">
            {tabs.map(t => {
                const active = pathname === t.to;
                return (
                    <Link key={t.to} to={t.to} className={`h-10 px-5 rounded-full flex items-center transition-all group ${
                        active ? 'bg-[#1A1A1A]' : 'bg-white border border-[#E6E6E1] hover:border-[#CCC]'
                    }`}>
                        <span className={`text-[10px] uppercase tracking-[0.2em] font-black ${active ? 'text-white' : 'text-[#BBBBBB] group-hover:text-[#666]'}`}>{t.label}</span>
                    </Link>
                );
            })}
        </div>
    );
}

export default function CreatorPrograms({ view = 'programmes' }) {
    const [programs, setPrograms] = useState([]);
    const [rewards, setRewards] = useState([]);
    const [creatorRewards, setCreatorRewards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null); // program row | 'new' | null

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data: p }, { data: r }, { data: cr }] = await Promise.all([
            supabase.from('creator_programs').select('*, creator_program_steps(count), creators(count)').order('is_default', { ascending: false }).order('name'),
            supabase.from('rewards').select('id, title, brand_name').eq('active', true).order('brand_name').order('title').limit(1000),
            supabase.from('creator_rewards').select('*').order('sort_order').order('name').limit(1000),
        ]);
        setPrograms(p ?? []);
        setRewards(r ?? []);
        setCreatorRewards(cr ?? []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const counts = useMemo(() => Object.fromEntries(programs.map(p => [p.id, {
        steps: p.creator_program_steps?.[0]?.count ?? 0,
        creators: p.creators?.[0]?.count ?? 0,
    }])), [programs]);

    return (
        <div className="space-y-2">
            <div className="flex items-end justify-between mb-2">
                <div>
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2">{{ fulfilment: 'Fulfilment', rewards: 'Rewards' }[view] ?? 'Programmes'}</h1>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                        {{ fulfilment: 'Products and rewards creators have earned', rewards: 'What a step actually gives — with a picture' }[view] ?? 'Rules, points and rewards — per creator group'}
                    </p>
                </div>
                {view === 'programmes' && !editing && (
                    <button onClick={() => setEditing('new')} className="flex items-center gap-3 h-12 px-8 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-[11px] rounded-full hover:translate-y-[-2px] transition-all">
                        <Plus size={16} /> New programme
                    </button>
                )}
            </div>
            <CreatorTabs />

            {view === 'fulfilment' ? (
                <FulfilmentQueue rewards={rewards} />
            ) : view === 'rewards' ? (
                <RewardsCatalogue items={creatorRewards} onChanged={load} />
            ) : editing ? (
                <ProgramEditor
                    program={editing === 'new' ? null : editing}
                    rewards={rewards}
                    creatorRewards={creatorRewards}
                    onSaved={(p) => { setEditing(p); load(); }}
                    onDeleted={() => { setEditing(null); load(); }}
                    onCancel={() => setEditing(null)}
                />
            ) : (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                    {loading ? (
                        <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" /></div>
                    ) : programs.map(p => (
                        <button key={p.id} onClick={() => setEditing(p)} className="w-full flex items-center gap-6 px-8 py-6 border-b border-[#F0F0ED] last:border-0 hover:bg-[#FAFAF8] transition-colors text-left">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3">
                                    <span className="text-[15px] font-bold text-[#1A1A1A]">{p.name}</span>
                                    {p.is_default && <span className="flex items-center gap-1.5 px-3 py-1 bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full text-[9px] uppercase tracking-[0.2em] font-black text-[#8a7600]"><Star size={10} /> Default</span>}
                                    {!p.active && <span className="px-3 py-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] uppercase tracking-[0.2em] font-black text-[#BBBBBB]">Inactive</span>}
                                </div>
                                {p.description && <div className="text-[12px] text-[#999] font-light mt-1 truncate">{p.description}</div>}
                                <div className="text-[10px] text-[#BBBBBB] font-black mt-2 tracking-wide">
                                    {p.creator_conversion_points} pts / conversion · invitee {p.invitee_bonus_points} pts
                                    {p.event_signup_points > 0 && <> · event +{p.event_signup_points}</>}
                                    {p.creator_signup_points > 0 && <> · signup +{p.creator_signup_points}</>}
                                    {p.min_session_minutes > 0 && <> · ≥{p.min_session_minutes} min</>}
                                    {p.conversion_window_days && <> · {p.conversion_window_days}d deadline</>}
                                </div>
                            </div>
                            <div className="text-right w-20 shrink-0">
                                <div className="text-[18px] font-light text-[#1A1A1A] tabular-nums">{counts[p.id]?.steps ?? 0}</div>
                                <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">steps</div>
                            </div>
                            <div className="text-right w-20 shrink-0">
                                <div className="text-[18px] font-light text-[#666] tabular-nums">{counts[p.id]?.creators ?? 0}</div>
                                <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">creators</div>
                            </div>
                            <X size={16} className="shrink-0 text-[#CCC] rotate-45" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
