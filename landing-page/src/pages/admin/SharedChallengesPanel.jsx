import React, { useState } from 'react';
import { Flame, Minus, Pencil, Plus, Trash2, X, Zap } from 'lucide-react';
import { useToast } from '../../lib/toast';

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

// Seed presets (mock — swap for a shared_challenge_templates table later).
const SEED = [
	{ id: 'gym-back-again', category: 'gym',     title: 'Back Again', goal: 'Check in 3× this week',  tier: 'easy',   basePoints: 25, active: true },
	{ id: 'walk-10k-days',  category: 'walking', title: '10K Days',   goal: '10,000 steps, 4 days',   tier: 'medium', basePoints: 40, active: true },
	{ id: 'run-just-run',   category: 'running', title: 'Just Run',   goal: 'Log 1 run this week',    tier: 'easy',   basePoints: 15, active: true },
	{ id: 'gym-4-from-7',   category: 'gym',     title: '4 From 7',   goal: 'Check in 4× this week',  tier: 'medium', basePoints: 40, active: true },
	{ id: 'walk-35k-week',  category: 'walking', title: '35K Week',   goal: '35,000 steps this week', tier: 'medium', basePoints: 45, active: true },
];

const BONUS_DEFAULTS = { perHead: 5, maxBonus: 30 };

// ── Numeric stepper ───────────────────────────────────────────────────────────
function Stepper({ value, onChange, step = 5, min = 0, max = 999, suffix }) {
	return (
		<div className="flex items-center gap-3">
			<button
				onClick={() => onChange(clamp(value - step, min, max))}
				className="w-9 h-9 rounded-full border border-[#E6E6E1] bg-[#F4F4F1] text-[#666666] flex items-center justify-center hover:border-[#E8D200]/40 transition-colors"
			>
				<Minus size={15} />
			</button>
			<div className="min-w-[64px] text-center text-xl font-light text-[#1A1A1A] tabular-nums">
				{value}{suffix && <span className="text-xs text-[#999999] ml-0.5">{suffix}</span>}
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
	const canSave = draft.title.trim() && draft.goal.trim();
	const set = (patch) => setDraft({ ...draft, ...patch });

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

					<label className="flex flex-col gap-2">
						<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Goal</span>
						<input
							value={draft.goal}
							onChange={(e) => set({ goal: e.target.value })}
							placeholder="e.g. Check in 3× this week"
							className="h-12 px-4 rounded-xl border border-[#E6E6E1] bg-[#F4F4F1] text-[#1A1A1A] text-[15px] outline-none focus:border-[#E8D200]/50"
						/>
					</label>

					<div className="flex flex-col gap-2">
						<span className="text-[10px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black">Category</span>
						<div className="flex flex-wrap gap-2">
							{CATEGORIES.map((c) => {
								const on = draft.category === c.id;
								return (
									<button
										key={c.id}
										onClick={() => set({ category: c.id })}
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
	const [templates, setTemplates] = useState(SEED);
	const [draft, setDraft] = useState(null);

	const activeCount = templates.filter((t) => t.active).length;
	const sampleBonus = groupBonus(6, bonus);
	const sampleTotal = 30 + sampleBonus;

	const openNew = () =>
		setDraft({ id: '', category: 'gym', title: '', goal: '', tier: 'easy', basePoints: 25, active: true });

	const saveTemplate = (t) => {
		setTemplates((prev) => (t.id ? prev.map((x) => (x.id === t.id ? t : x)) : [{ ...t, id: `tmpl-${Date.now()}` }, ...prev]));
		setDraft(null);
		toast.success(t.id ? 'Template updated' : 'Template added');
	};
	const removeTemplate = (id) => { setTemplates((prev) => prev.filter((t) => t.id !== id)); toast.success('Template removed'); };
	const toggleActive = (id) => setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t)));

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
					<Stepper value={bonus.perHead} onChange={(v) => setBonus((b) => ({ ...b, perHead: v }))} step={1} min={0} max={50} />
				</div>
				<div className="flex items-center justify-between px-8 py-6 border-t border-[#EFEFEC]">
					<div>
						<div className="text-base font-light text-[#1A1A1A]">Max bonus</div>
						<div className="text-[11px] text-[#AAAAAA] mt-0.5">Hard cap on the total bonus</div>
					</div>
					<Stepper value={bonus.maxBonus} onChange={(v) => setBonus((b) => ({ ...b, maxBonus: v }))} step={5} min={0} max={200} />
				</div>
				<div className="flex items-center gap-2 px-8 py-5 bg-[#E8D200]/[0.06] border-t border-[#EFEFEC]">
					<Zap size={14} className="text-[#8a7600]" />
					<span className="text-[13px] text-[#666666]">
						Example: base 30 + finish with 6 friends = <strong className="text-[#8a7600] font-semibold">{sampleTotal} pts</strong>
						<span className="text-[#BBBBBB]"> (+{sampleBonus} bonus)</span>
					</span>
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
