import React, { useEffect, useState } from 'react';
import { Clock, Flame, Minus, Pencil, Plus, Trash2, X, Zap } from 'lucide-react';
import { useToast } from '../../lib/toast';
import { supabase } from '../../lib/supabase';

// Run lengths a template can be authored at. The duration is part of the
// challenge's design — the same goal is a different game (difficulty, fair
// points) over 24h vs 2 weeks — so it lives HERE, next to target/tier/points,
// not on a global menu. Members make no timing choice in the app.
const DURATION_PRESETS = [
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
  { label: '3 days', hours: 72 },
  { label: '5 days', hours: 120 },
  { label: '1 week', hours: 168 },
  { label: '2 weeks', hours: 336 },
];
const durationPresetLabel = (h) =>
  DURATION_PRESETS.find((d) => d.hours === h)?.label ?? (h % 24 === 0 ? `${h / 24} days` : `${h}h`);

// DB row (snake_case + measure jsonb) ↔ the flat draft the editor works with.
const dbToDraft = (row) => {
  const m = row.measure ?? {};
  return {
    id: row.id, category: row.category, title: row.title, tier: row.tier,
    basePoints: row.base_points, measure: m.measure, target: m.target,
    unit: m.unit ?? null, days: m.days ?? null, window: m.window ?? null,
    mode: row.mode ?? 'solo', durationHours: row.duration_hours ?? 168,
    goal: row.goal, active: row.active, sort_order: row.sort_order,
  };
};
const draftToDb = (d, goal) => ({
  category: d.category, title: d.title.trim(), tier: d.tier, base_points: d.basePoints,
  goal, measure: { measure: d.measure, target: d.target, unit: d.unit ?? null, days: d.days ?? null, window: d.window ?? null },
  mode: d.mode ?? 'solo', duration_hours: d.durationHours ?? 168, active: d.active ?? true,
});

// Day-based goals ("N different days", "X steps a day for N days") physically
// need at least that many days on the clock — shorter runs are unwinnable.
const minHoursFor = (d) => {
  const m = measureCfg(d.category, d.measure);
  const days = m.id === 'distinct_days' ? (d.target || 0) : (m.perDay ? (d.days || 0) : 0);
  return days * 24;
};

// ── Group-size bonus (mirror of app lib/social/bonus.ts §6a) ──────────────────
// base + min(maxBonus, perHead × co-completers). Keep in sync with the app +
// the eventual server-side completion edge function.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function groupBonus(coCompleters, { perHead, maxBonus }) {
	return Math.min(maxBonus, perHead * Math.max(0, Math.floor(coCompleters)));
}

const TIER_BG = {
	easy:   'border-[#00CC66]/20 bg-[#00CC66]/10 text-[#00CC66]',
	medium: 'border-[#E8D200]/20 bg-[#E8D200]/10 text-[#8a7600]',
	hard:   'border-[#FF5C00]/20 bg-[#FF5C00]/10 text-[#FF5C00]',
};
const TIERS = ['easy', 'medium', 'hard'];

const CAT_ICON = { gym: '🏋️', walking: '🚶', running: '🏃', cycling: '🚴', multi: '🔥' };
const CATEGORIES = [
	{ id: 'gym', label: 'Gym' },
	{ id: 'walking', label: 'Walking' },
	{ id: 'running', label: 'Running' },
	{ id: 'cycling', label: 'Cycling' },
	{ id: 'multi', label: 'All' },
];

const BONUS_DEFAULTS = { perHead: 5, maxBonus: 30 };

// ── Per-category measures ─────────────────────────────────────────────────────
// Each category exposes the ways its goal can be measured, with sensible step
// sizes + units. The goal string is generated from {measure, target, unit, days}
// — this also seeds the real rule (kind/target) when the backend lands.
// `noPool: true` — the pool engine sums a metric across the group (steps, km,
// sessions); "different days" and "categories" aren't summable, so offering
// them pooled would silently create a challenge that plays as something else.
const MEASURES = {
	gym: [
		{ id: 'checkins',      label: 'Check-ins',     unit: 'check-ins', step: 1, min: 1, max: 14, default: 3, window: true },
		{ id: 'distinct_days', label: 'Different days', unit: 'days',     step: 1, min: 1, max: 7,  default: 5, noPool: true },
	],
	walking: [
		{ id: 'steps_week', label: 'Total steps', unit: 'steps', step: 5000, min: 10000, max: 200000, default: 35000 },
		{ id: 'steps_day',  label: 'Steps / day', unit: 'steps', step: 1000, min: 3000, max: 30000, default: 10000, perDay: true, window: true },
	],
	running: [
		{ id: 'distance', label: 'Distance',        distance: true, step: 1, min: 1, max: 100, default: 5 },
		{ id: 'runs',     label: 'Number of runs',  unit: 'runs',   step: 1, min: 1, max: 14,  default: 1 },
	],
	cycling: [
		{ id: 'distance', label: 'Distance',        distance: true, step: 5, min: 5, max: 300, default: 20 },
		{ id: 'rides',    label: 'Number of rides', unit: 'rides',  step: 1, min: 1, max: 14,  default: 1 },
	],
	multi: [
		{ id: 'sessions',   label: 'Sessions',   unit: 'sessions',   step: 1, min: 1, max: 14, default: 3 },
		{ id: 'categories', label: 'Categories', unit: 'categories', step: 1, min: 2, max: 5,  default: 4, noPool: true },
	],
};

// Time windows usable by windowed measures (gym check-ins, walking steps/day).
const WINDOWS = [
	{ id: 'any',        label: 'Any time',  phrase: '' },
	{ id: 'before_9am', label: 'Before 9am', phrase: 'before 9am' },
	{ id: 'midday',     label: '12–2pm',     phrase: 'between 12–2pm' },
	{ id: 'after_6pm',  label: 'After 6pm',  phrase: 'after 6pm' },
];

const measuresFor = (cat, mode) => {
	const all = MEASURES[cat] ?? MEASURES.gym;
	return mode === 'pooled' ? all.filter((m) => !m.noPool) : all;
};
// Unfiltered lookup — goal text must resolve even for rows saved before the
// pooled exclusions existed.
const measureCfg = (cat, id) => (MEASURES[cat] ?? MEASURES.gym).find((m) => m.id === id) ?? (MEASURES[cat] ?? MEASURES.gym)[0];

/** Structured defaults for a category+measure (target, unit, days, window). */
function measureDefaults(cat, measureId) {
	const m = measureId ? measureCfg(cat, measureId) : measuresFor(cat)[0];
	return {
		measure: m.id,
		target: m.default,
		unit: m.distance ? 'km' : null,
		days: m.perDay ? 4 : null,
		window: m.window ? 'any' : null,
	};
}

/** Human goal string generated from the structured fields. NEVER names a
 *  timeframe — the template's run length is the single source of timing (shown
 *  as a countdown in the app); "in total" marks cumulative goals so a bare
 *  number isn't read as a single effort. */
function goalText(d) {
	const m = measureCfg(d.category, d.measure);
	const v = d.target;
	// Leading-space window phrase, e.g. " before 9am" (empty for "any" / unsupported).
	const win = m.window && d.window && d.window !== 'any'
		? ' ' + (WINDOWS.find((w) => w.id === d.window)?.phrase ?? '')
		: '';
	if (m.distance) return `${d.category === 'running' ? 'Run' : 'Cycle'} ${v}${d.unit} in total`;
	switch (m.id) {
		case 'checkins':      return `Check in ${v}×${win}`;
		case 'distinct_days': return `Check in on ${v} different ${v === 1 ? 'day' : 'days'}`;
		case 'steps_week':    return `${v.toLocaleString()} steps in total`;
		case 'steps_day':     return win
			? `${v.toLocaleString()} steps${win}, ${d.days} ${d.days === 1 ? 'day' : 'days'}`
			: `${v.toLocaleString()} steps a day, ${d.days} ${d.days === 1 ? 'day' : 'days'}`;
		case 'runs':       return `Log ${v} ${v === 1 ? 'run' : 'runs'}`;
		case 'rides':      return `Log ${v} ${v === 1 ? 'ride' : 'rides'}`;
		case 'sessions':   return `Log ${v} ${v === 1 ? 'session' : 'sessions'}`;
		case 'categories': return `Try ${v} different activities`;
		default:           return `${v} ${m.unit}`;
	}
}

// Pooled (combined-total) goal string — describes the GROUP target.
function poolGoalText(d) {
	const m = measureCfg(d.category, d.measure);
	const v = d.target;
	if (m.distance) return `Together: ${v}${d.unit || 'km'} ${d.category === 'running' ? 'running' : 'cycling'}`;
	switch (m.id) {
		case 'checkins':   return `Together: ${v} gym check-ins`;
		case 'steps_week':
		case 'steps_day':  return `Together: ${v.toLocaleString()} steps`;
		case 'runs':       return `Together: ${v} runs`;
		case 'rides':      return `Together: ${v} rides`;
		case 'sessions':   return `Together: ${v} sessions`;
		default:           return `Together: ${v} ${m.unit || ''}`.trim();
	}
}
/** Goal string for either mode — solo (per-person) or pooled (combined). */
const goalTextFor = (d) => (d.mode === 'pooled' ? poolGoalText(d) : goalText(d));

// ── Numeric stepper ───────────────────────────────────────────────────────────
function Stepper({ value, onChange, step = 5, min = 0, max = 999, suffix, format, minWidth = 64 }) {
	const shown = format ? format(value) : value;
	return (
		<div className="flex items-center gap-3">
			<button
				onClick={() => onChange(clamp(value - step, min, max))}
				className="w-9 h-9 rounded-full border border-[#E6E6E1] bg-[#F4F4F1] text-[#666666] flex items-center justify-center hover:border-[#E8D200]/40 transition-colors"
			>
				<Minus size={15} />
			</button>
			<div className="text-center text-xl font-light text-[#1A1A1A] tabular-nums" style={{ minWidth }}>
				{shown}{suffix && <span className="text-xs text-[#999999] ml-1">{suffix}</span>}
			</div>
			<button
				onClick={() => onChange(clamp(value + step, min, max))}
				className="w-9 h-9 rounded-full border border-[#E6E6E1] bg-[#F4F4F1] text-[#666666] flex items-center justify-center hover:border-[#E8D200]/40 transition-colors"
			>
				<Plus size={15} />
			</button>
		</div>
	);
}

// ── Editor modal ──────────────────────────────────────────────────────────────
function TemplateEditor({ draft, setDraft, onSave, onClose }) {
	if (!draft) return null;
	const canSave = draft.title.trim().length > 0;
	// Every change re-fits the run length: a goal needing N days can't sit on a
	// shorter clock, so bumping the target auto-bumps an infeasible duration.
	const set = (patch) => {
		const next = { ...draft, ...patch };
		const minH = minHoursFor(next);
		if ((next.durationHours ?? 168) < minH) {
			next.durationHours = DURATION_PRESETS.find((p) => p.hours >= minH)?.hours ?? minH;
		}
		setDraft(next);
	};
	const measures = measuresFor(draft.category, draft.mode);
	const m = measureCfg(draft.category, draft.measure);
	const stepsLike = m.id === 'steps_week' || m.id === 'steps_day';
	const minHours = minHoursFor(draft);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			<div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
			<div className="relative w-full max-w-lg rounded-[2rem] border border-[#E6E6E1] bg-white p-10 shadow-2xl">
				<div className="flex items-center justify-between mb-8">
					<h2 className="text-2xl font-light tracking-tight text-[#1A1A1A]">
						{draft.id ? 'Edit template' : 'New template'}
					</h2>
					<button onClick={onClose} className="w-9 h-9 rounded-full border border-[#E6E6E1] text-[#AAAAAA] flex items-center justify-center hover:text-[#1A1A1A] transition-colors">
						<X size={16} />
					</button>
				</div>

				<div className="flex flex-col gap-6">
					<label className="flex flex-col gap-2">
						<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Title</span>
						<input
							value={draft.title}
							onChange={(e) => set({ title: e.target.value })}
							placeholder="e.g. Back Again"
							className="h-12 px-4 rounded-xl border border-[#E6E6E1] bg-[#F4F4F1] text-[#1A1A1A] text-[15px] outline-none focus:border-[#E8D200]/50"
						/>
					</label>

					<div className="flex flex-col gap-2">
						<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Activity</span>
						<div className="flex flex-wrap gap-2">
							{CATEGORIES.map((c) => {
								const on = draft.category === c.id;
								return (
									<button
										key={c.id}
										onClick={() => set({ category: c.id, ...measureDefaults(c.id) })}
										className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-all ${
											on ? 'border-[#E8D200] bg-[#E8D200] text-[#0a0a0a]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#666666] hover:border-[#E8D200]/40'
										}`}
									>
										<span className="text-sm leading-none">{CAT_ICON[c.id]}</span>{c.label}
									</button>
								);
							})}
						</div>
					</div>

					{/* Type — solo co-op (each hits the goal) vs pooled (combined total) */}
					<div className="flex flex-col gap-2">
						<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Type</span>
						<div className="flex gap-2">
							{[
								{ id: 'solo', label: 'Solo', sub: 'Each hits the goal' },
								{ id: 'pooled', label: 'Pooled', sub: 'Combined total' },
							].map((opt) => {
								const on = (draft.mode ?? 'solo') === opt.id;
								return (
									<button
										key={opt.id}
										onClick={() => set({
											mode: opt.id,
											// A measure that can't pool (different days, categories)
											// falls back to the first poolable one for this category.
											...(opt.id === 'pooled' && m.noPool
												? measureDefaults(draft.category, measuresFor(draft.category, 'pooled')[0]?.id)
												: {}),
										})}
										className={`flex-1 rounded-xl border px-4 py-3 text-left transition-all ${
											on ? 'border-[#E8D200] bg-[#E8D200] text-[#0a0a0a]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#666666] hover:border-[#E8D200]/40'
										}`}
									>
										<div className="text-sm font-medium">{opt.label}</div>
										<div className={`text-[11px] ${on ? 'text-[#0a0a0a]/70' : 'text-[#AAAAAA]'}`}>{opt.sub}</div>
									</button>
								);
							})}
						</div>
					</div>

					{/* Measure (only when the activity has more than one option) */}
					{measures.length > 1 && (
						<div className="flex flex-col gap-2">
							<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Measure by</span>
							<div className="flex flex-wrap gap-2">
								{measures.map((opt) => {
									const on = m.id === opt.id;
									return (
										<button
											key={opt.id}
											onClick={() => set(measureDefaults(draft.category, opt.id))}
											className={`rounded-full border px-4 py-2 text-xs font-medium transition-all ${
												on ? 'border-[#E8D200] bg-[#E8D200] text-[#0a0a0a]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#666666] hover:border-[#E8D200]/40'
											}`}
										>
											{opt.label}
										</button>
									);
								})}
							</div>
						</div>
					)}

					{/* Target — value control appropriate to the measure */}
					<div className="flex flex-col gap-2">
						<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Target</span>

						{/* Distance unit toggle (km / mi) */}
						{m.distance && (
							<div className="flex gap-2">
								{['km', 'mi'].map((u) => {
									const on = draft.unit === u;
									return (
										<button
											key={u}
											onClick={() => set({ unit: u })}
											className={`rounded-full border px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${
												on ? 'border-[#E8D200] bg-[#E8D200] text-[#0a0a0a]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#999999] hover:border-[#E8D200]/40'
											}`}
										>
											{u}
										</button>
									);
								})}
							</div>
						)}

						<div className="flex items-center justify-between rounded-xl border border-[#E6E6E1] bg-[#F4F4F1] px-5 py-3">
							<span className="text-sm text-[#666666]">{m.distance ? 'Distance' : m.label}</span>
							<Stepper
								value={draft.target}
								onChange={(v) => set({ target: v })}
								step={m.step}
								min={m.min}
								max={m.max}
								suffix={m.distance ? draft.unit : m.unit}
								format={stepsLike ? (v) => v.toLocaleString() : undefined}
								minWidth={stepsLike ? 90 : 56}
							/>
						</div>

						{/* Days control for per-day measures */}
						{m.perDay && (
							<div className="flex items-center justify-between rounded-xl border border-[#E6E6E1] bg-[#F4F4F1] px-5 py-3">
								<span className="text-sm text-[#666666]">For how many days</span>
								<Stepper value={draft.days} onChange={(v) => set({ days: v })} step={1} min={1} max={7} suffix="days" minWidth={36} />
							</div>
						)}

						{/* Time window for windowed measures */}
						{m.window && (
							<div className="flex flex-col gap-2 mt-1">
								<span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">Time window</span>
								<div className="flex flex-wrap gap-2">
									{WINDOWS.map((w) => {
										const on = (draft.window ?? 'any') === w.id;
										return (
											<button
												key={w.id}
												onClick={() => set({ window: w.id })}
												className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-all ${
													on ? 'border-[#E8D200] bg-[#E8D200] text-[#0a0a0a]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#666666] hover:border-[#E8D200]/40'
												}`}
											>
												{w.label}
											</button>
										);
									})}
								</div>
							</div>
						)}

						{/* Generated goal preview */}
						<div className="flex items-center gap-2 mt-1">
							<span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">Shows as</span>
							<span className="text-sm text-[#1A1A1A]">
								“{goalTextFor(draft)}” <span className="text-[#999999]">· {durationPresetLabel(draft.durationHours ?? 168)}</span>
							</span>
						</div>
					</div>

					{/* Run length — part of the design: price the tier/points against THIS
					    window. Chips too short for a day-based goal are disabled. */}
					<div className="flex flex-col gap-2">
						<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Run length</span>
						<div className="flex flex-wrap gap-2">
							{DURATION_PRESETS.map((p) => {
								const on = (draft.durationHours ?? 168) === p.hours;
								const tooShort = p.hours < minHours;
								return (
									<button
										key={p.hours}
										disabled={tooShort}
										onClick={() => set({ durationHours: p.hours })}
										className={`rounded-full border px-4 py-2 text-xs font-medium transition-all ${
											on ? 'border-[#E8D200] bg-[#E8D200] text-[#0a0a0a]'
											: tooShort ? 'border-[#EFEFEC] bg-[#FAFAF8] text-[#D5D5D0] cursor-not-allowed line-through'
											: 'border-[#E6E6E1] bg-[#F4F4F1] text-[#666666] hover:border-[#E8D200]/40'
										}`}
									>
										{p.label}
									</button>
								);
							})}
						</div>
						{minHours > 0 && (
							<span className="text-[11px] text-[#AAAAAA]">
								This goal spans {minHours / 24} days, so it needs a run of at least {durationPresetLabel(DURATION_PRESETS.find((p) => p.hours >= minHours)?.hours ?? minHours)}.
							</span>
						)}
					</div>

					<div className="flex flex-col gap-2">
						<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Difficulty</span>
						<div className="flex gap-2">
							{TIERS.map((tier) => {
								const on = draft.tier === tier;
								return (
									<button
										key={tier}
										onClick={() => set({ tier })}
										className={`rounded-full border px-5 py-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${
											on ? TIER_BG[tier] + ' ring-1 ring-inset' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#999999] hover:border-[#E8D200]/40'
										}`}
									>
										{tier}
									</button>
								);
							})}
						</div>
					</div>

					<div className="flex items-center justify-between">
						<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Base points</span>
						<Stepper value={draft.basePoints} onChange={(v) => set({ basePoints: v })} step={5} min={5} max={150} suffix="pts" />
					</div>
				</div>

				<button
					onClick={() => canSave && onSave(draft)}
					disabled={!canSave}
					className={`mt-10 w-full h-12 rounded-full text-[11px] font-black uppercase tracking-[0.3em] transition-all ${
						canSave ? 'bg-[#E8D200] text-[#0a0a0a] hover:bg-[#E8D200]/90' : 'bg-[#EFEFEC] text-[#BBBBBB] cursor-not-allowed'
					}`}
				>
					{draft.id ? 'Save changes' : 'Add template'}
				</button>
			</div>
		</div>
	);
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function SharedChallengesPanel() {
	const toast = useToast();
	const [bonus, setBonus] = useState({ ...BONUS_DEFAULTS });
	const [timer, setTimer] = useState({ acceptWindowHours: 48, challengeCap: 3 });
	const [templates, setTemplates] = useState([]);
	const [draft, setDraft] = useState(null);
	const [loading, setLoading] = useState(true);

	const activeCount = templates.filter((t) => t.active).length;
	const sampleBonus = groupBonus(6, bonus);
	const sampleTotal = 30 + sampleBonus;

	// ── Load config + templates ──
	useEffect(() => { load(); }, []);
	async function load() {
		const [{ data: cfg }, { data: tmpls, error: tErr }] = await Promise.all([
			supabase.from('shared_challenge_config').select('*').eq('id', 1).maybeSingle(),
			supabase.from('shared_challenge_templates').select('*').order('sort_order', { ascending: true }),
		]);
		if (cfg) {
			setBonus({ perHead: cfg.per_head, maxBonus: cfg.max_bonus });
			setTimer({ acceptWindowHours: cfg.accept_window_hours, challengeCap: cfg.challenge_cap });
		}
		if (!tErr && tmpls) setTemplates(tmpls.map(dbToDraft));
		setLoading(false);
	}

	// Write a partial config update (DB column names). Local state is updated by the caller.
	async function patchConfig(partial) {
		const { error } = await supabase
			.from('shared_challenge_config')
			.update({ ...partial, updated_at: new Date().toISOString() })
			.eq('id', 1);
		if (error) toast.error('Could not save config');
	}

	const openNew = () =>
		setDraft({ id: '', category: 'gym', title: '', tier: 'easy', basePoints: 25, active: true, mode: 'solo', durationHours: 72, ...measureDefaults('gym') });

	const saveTemplate = async (t) => {
		const goal = goalTextFor(t);
		const row = draftToDb(t, goal);
		if (t.id) {
			const { error } = await supabase.from('shared_challenge_templates')
				.update({ ...row, updated_at: new Date().toISOString() }).eq('id', t.id);
			if (error) return toast.error('Update failed');
		} else {
			const sort_order = (templates.reduce((m, x) => Math.max(m, x.sort_order ?? 0), 0)) + 1;
			const { error } = await supabase.from('shared_challenge_templates').insert({ ...row, sort_order });
			if (error) return toast.error('Add failed');
		}
		setDraft(null);
		toast.success(t.id ? 'Template updated' : 'Template added');
		load();
	};
	const removeTemplate = async (id) => {
		const { error } = await supabase.from('shared_challenge_templates').delete().eq('id', id);
		if (error) return toast.error('Remove failed');
		setTemplates((prev) => prev.filter((t) => t.id !== id));
		toast.success('Template removed');
	};
	const toggleActive = async (id) => {
		const t = templates.find((x) => x.id === id);
		if (!t) return;
		setTemplates((prev) => prev.map((x) => (x.id === id ? { ...x, active: !x.active } : x)));
		const { error } = await supabase.from('shared_challenge_templates').update({ active: !t.active }).eq('id', id);
		if (error) { toast.error('Save failed'); load(); }
	};

	return (
		<div>
			{/* ── Group bonus config ── */}
			<div className="mb-6">
				<span className="text-[10px] uppercase tracking-[0.5em] text-[#999999] font-black">Group Bonus</span>
				<p className="text-[11px] text-[#AAAAAA] mt-2 max-w-2xl">
					Each finisher earns base points plus a bonus for every friend who also finishes — capped so large groups can't farm points.
				</p>
			</div>

			<div className="rounded-3xl border border-[#E6E6E1] bg-white overflow-hidden mb-12">
				<div className="flex items-center justify-between px-8 py-6">
					<div>
						<div className="text-base font-light text-[#1A1A1A]">Points per friend</div>
						<div className="text-[11px] text-[#AAAAAA] mt-0.5">Added for each co-completer</div>
					</div>
					<Stepper value={bonus.perHead} onChange={(v) => { setBonus((b) => ({ ...b, perHead: v })); patchConfig({ per_head: v }); }} step={1} min={0} max={50} />
				</div>
				<div className="flex items-center justify-between px-8 py-6 border-t border-[#EFEFEC]">
					<div>
						<div className="text-base font-light text-[#1A1A1A]">Max bonus</div>
						<div className="text-[11px] text-[#AAAAAA] mt-0.5">Hard cap on the total bonus</div>
					</div>
					<Stepper value={bonus.maxBonus} onChange={(v) => { setBonus((b) => ({ ...b, maxBonus: v })); patchConfig({ max_bonus: v }); }} step={5} min={0} max={200} />
				</div>
				<div className="flex items-center gap-2 px-8 py-5 bg-[#E8D200]/[0.06] border-t border-[#EFEFEC]">
					<Zap size={14} className="text-[#8a7600]" />
					<span className="text-[13px] text-[#666666]">
						Example: base 30 + finish with 6 friends = <strong className="text-[#8a7600] font-semibold">{sampleTotal} pts</strong>
						<span className="text-[#BBBBBB]"> (+{sampleBonus} bonus)</span>
					</span>
				</div>
			</div>

			{/* ── Timer config ── */}
			<div className="mb-6">
				<span className="text-[10px] uppercase tracking-[0.5em] text-[#999999] font-black flex items-center gap-2">
					<Clock size={12} /> Timer
				</span>
				<p className="text-[11px] text-[#AAAAAA] mt-2 max-w-2xl">
					The clock starts once everyone accepts. Each template sets its own run length (edit it on the template) — here you configure the accept window and how many challenges someone can run at once.
				</p>
			</div>

			<div className="rounded-3xl border border-[#E6E6E1] bg-white overflow-hidden mb-12">
				<div className="flex items-center justify-between px-8 py-6">
					<div>
						<div className="text-base font-light text-[#1A1A1A]">Accept window</div>
						<div className="text-[11px] text-[#AAAAAA] mt-0.5">How long invitees have to respond (hours)</div>
					</div>
					<Stepper value={timer.acceptWindowHours} onChange={(v) => { setTimer((t) => ({ ...t, acceptWindowHours: v })); patchConfig({ accept_window_hours: v }); }} step={12} min={12} max={168} suffix="h" />
				</div>
				<div className="flex items-center justify-between px-8 py-6 border-t border-[#EFEFEC]">
					<div>
						<div className="text-base font-light text-[#1A1A1A]">Concurrency cap</div>
						<div className="text-[11px] text-[#AAAAAA] mt-0.5">Max challenges a member can run at once</div>
					</div>
					<Stepper value={timer.challengeCap} onChange={(v) => { setTimer((t) => ({ ...t, challengeCap: v })); patchConfig({ challenge_cap: v }); }} step={1} min={1} max={10} />
				</div>
			</div>

			{/* ── Templates ── */}
			<div className="flex items-center justify-between mb-2">
				<span className="text-[10px] uppercase tracking-[0.5em] text-[#999999] font-black">Templates · {activeCount} live</span>
				<button
					onClick={openNew}
					className="h-9 px-5 rounded-full bg-[#E8D200] text-[#0a0a0a] text-[10px] font-black uppercase tracking-[0.25em] flex items-center gap-2 hover:bg-[#E8D200]/90 transition-colors"
				>
					<Plus size={13} /> New
				</button>
			</div>
			<p className="text-[11px] text-[#AAAAAA] mb-6 max-w-2xl">
				Presets members pick from when they start a challenge with friends. Toggle <strong className="text-[#1A1A1A]">Live</strong> to show or hide a preset in the app.
			</p>

			<div className="space-y-3">
				{templates.map((t) => (
					<div
						key={t.id}
						className={`rounded-2xl border border-[#E6E6E1] bg-white px-6 py-5 flex items-center gap-5 transition-opacity ${t.active ? '' : 'opacity-50'}`}
					>
						<div className="w-10 h-10 rounded-xl border border-[#E8D200]/15 bg-[#E8D200]/[0.08] flex items-center justify-center shrink-0">
							<span className="text-base leading-none">{CAT_ICON[t.category] ?? '⚡'}</span>
						</div>
						<div className="flex-1 min-w-0">
							<div className="text-[15px] font-medium text-[#1A1A1A] truncate">{t.title}</div>
							<div className="text-[13px] text-[#999999] truncate">{t.goal}</div>
							<div className="flex items-center gap-3 mt-1.5">
								<span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.25em] ${TIER_BG[t.tier]}`}>{t.tier}</span>
								{t.mode === 'pooled' && (
									<span className="inline-flex items-center rounded-full border border-[#E8D200]/30 bg-[#E8D200]/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.25em] text-[#8a7600]">Pooled</span>
								)}
								<span className="inline-flex items-center gap-1 text-[11px] text-[#999999]">
									<Clock size={11} /> {durationPresetLabel(t.durationHours ?? 168)}
								</span>
								<span className="text-[12px] text-[#8a7600]">+{t.basePoints} pts</span>
							</div>
						</div>
						<div className="flex items-center gap-3 shrink-0">
							<button
								onClick={() => toggleActive(t.id)}
								className={`h-8 px-4 rounded-full border text-[9px] font-black uppercase tracking-[0.2em] transition-colors ${
									t.active
										? 'border-[#00CC66]/30 bg-[#00CC66]/10 text-[#00CC66]'
										: 'border-[#E6E6E1] bg-[#F4F4F1] text-[#AAAAAA]'
								}`}
							>
								{t.active ? 'Live' : 'Off'}
							</button>
							<button onClick={() => setDraft(t)} className="w-8 h-8 rounded-full border border-[#E6E6E1] text-[#AAAAAA] flex items-center justify-center hover:text-[#1A1A1A] transition-colors">
								<Pencil size={14} />
							</button>
							<button onClick={() => removeTemplate(t.id)} className="w-8 h-8 rounded-full border border-[#E6E6E1] text-[#AAAAAA] flex items-center justify-center hover:text-[#F43F5E] hover:border-[#F43F5E]/30 transition-colors">
								<Trash2 size={14} />
							</button>
						</div>
					</div>
				))}

				{templates.length === 0 && (
					<div className="rounded-2xl border border-dashed border-[#E6E6E1] bg-white px-6 py-12 flex flex-col items-center gap-3 text-center">
						<Flame size={22} className="text-[#BBBBBB]" />
						<div className="text-sm text-[#999999]">No templates yet. Add one for members to pick.</div>
					</div>
				)}
			</div>

			<TemplateEditor draft={draft} setDraft={setDraft} onSave={saveTemplate} onClose={() => setDraft(null)} />
		</div>
	);
}
