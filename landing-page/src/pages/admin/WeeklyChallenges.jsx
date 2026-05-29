import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Check, ChevronDown, ChevronUp, Flag, RefreshCw, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import {
	CATALOG,
	CATEGORY_META,
	CATEGORY_ORDER,
	getActiveChallengesForWeek,
	getISOWeek,
} from '../../../../shared/weeklyChallenges.js';

// ── Constants ────────────────────────────────────────────────────────────────

const OVERRIDE_KEY = 'challenge_week_overrides';

const TIER_BG = {
	easy:   'border-[#00CC66]/20 bg-[#00CC66]/10 text-[#00CC66]',
	medium: 'border-[#E8D200]/20 bg-[#E8D200]/10 text-[#E8D200]',
	hard:   'border-[#FF5C00]/20 bg-[#FF5C00]/10 text-[#FF5C00]',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function currentISOWeek() {
	return getISOWeek(new Date());
}

function nextWeekISO() {
	const next = new Date(Date.now() + 7 * 86400000);
	return getISOWeek(next);
}

function weekLabel(isoWeek) {
	const m = /^(\d+)-W(\d+)$/.exec(isoWeek);
	if (!m) return isoWeek;
	const year = parseInt(m[1], 10);
	const week = parseInt(m[2], 10);
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const dow  = jan4.getUTCDay() || 7;
	const monday = new Date(jan4.getTime() + (week - 1) * 7 * 86400000 - (dow - 1) * 86400000);
	const sunday = new Date(monday.getTime() + 6 * 86400000);
	const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	return `${fmt(monday)} – ${fmt(sunday)}`;
}

const logAction = async (adminId, action, metadata = {}) => {
	await supabase.from('admin_audit_log').insert({
		admin_id: adminId,
		action,
		target_type: 'system_config',
		target_id: OVERRIDE_KEY,
		metadata,
	}).catch(() => {});
};

// ── Sub-components ────────────────────────────────────────────────────────────

function TierBadge({ tier }) {
	return (
		<span className={`inline-flex items-center rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-[0.3em] ${TIER_BG[tier] ?? TIER_BG.easy}`}>
			{tier}
		</span>
	);
}

function CatIcon({ category }) {
	const icons = { gym: '🏋️', walking: '🚶', running: '🏃', cycling: '🚴', multi: '🔥' };
	return <span className="text-base leading-none">{icons[category] ?? '⚡'}</span>;
}

function ActiveChallengeCard({ category, challenge, isOverridden, onScrollToCatalog, onClear }) {
	const meta = CATEGORY_META[category];
	return (
		<div className={`rounded-3xl border p-7 flex flex-col gap-5 transition-all ${
			isOverridden
				? 'border-[#FF5C00]/25 bg-[#FF5C00]/5'
				: 'border-[#151515] bg-[#0A0A0A]'
		}`}>
			<div className="flex items-start justify-between gap-4">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-2xl border border-[#E8D200]/20 bg-[#E8D200]/10 flex items-center justify-center">
						<CatIcon category={category} />
					</div>
					<div>
						<div className="text-[9px] uppercase tracking-[0.4em] text-[#555] font-black">{meta?.label ?? category}</div>
						{isOverridden
							? <div className="text-[9px] uppercase tracking-[0.3em] text-[#FF5C00] font-black mt-0.5">Pinned override</div>
							: <div className="text-[9px] uppercase tracking-[0.3em] text-[#333] font-black mt-0.5">Auto rotation</div>
						}
					</div>
				</div>
				<div className="flex items-center gap-2">
					{isOverridden && (
						<button
							onClick={onClear}
							title="Reset to auto"
							className="w-8 h-8 rounded-full border border-[#F43F5E]/20 bg-[#F43F5E]/10 text-[#F43F5E] flex items-center justify-center hover:bg-[#F43F5E]/20 transition-colors"
						>
							<RefreshCw size={12} />
						</button>
					)}
					<button
						onClick={onScrollToCatalog}
						className="h-8 px-4 rounded-full border border-[#E8D200]/20 bg-[#E8D200]/10 text-[#E8D200] text-[9px] font-black uppercase tracking-[0.25em] hover:bg-[#E8D200]/20 transition-colors"
					>
						Change
					</button>
				</div>
			</div>

			<div>
				<div className="flex items-center gap-3 mb-2 flex-wrap">
					<span className="text-xl font-light tracking-tight text-[#F2F2F2]">{challenge.title}</span>
					<TierBadge tier={challenge.tier} />
				</div>
				<p className="text-[#666] text-sm leading-relaxed">{challenge.description}</p>
			</div>

			<div className="flex items-center justify-between pt-3 border-t border-[#111]">
				<span className="text-[9px] uppercase tracking-[0.35em] text-[#444] font-black">Points reward</span>
				<span className="text-lg font-light text-[#E8D200]">+{challenge.points}</span>
			</div>
		</div>
	);
}

function CatalogCategorySection({ category, challenges, weekOverrides, autoChallenge, onPin, onUnpin }) {
	const [open, setOpen] = useState(false);
	const meta = CATEGORY_META[category];
	const activeOverrideId = weekOverrides[category];

	return (
		<div className="rounded-3xl border border-[#151515] bg-[#0A0A0A] overflow-hidden">
			<button
				className="w-full flex items-center justify-between px-8 py-6 hover:bg-[#0D0D0D] transition-colors"
				onClick={() => setOpen((v) => !v)}
			>
				<div className="flex items-center gap-4">
					<div className="w-9 h-9 rounded-xl border border-[#E8D200]/15 bg-[#E8D200]/8 flex items-center justify-center">
						<CatIcon category={category} />
					</div>
					<div className="text-left">
						<div className="text-base font-light text-[#F2F2F2]">{meta?.label ?? category}</div>
						<div className="text-[9px] uppercase tracking-[0.35em] text-[#444] font-black mt-0.5">
							{challenges.length} challenges
							{activeOverrideId ? ' · Override active' : ' · Auto rotation'}
						</div>
					</div>
				</div>
				<div className="flex items-center gap-4">
					{activeOverrideId && (
						<span className="text-[9px] uppercase tracking-[0.3em] text-[#FF5C00] font-black border border-[#FF5C00]/20 bg-[#FF5C00]/10 rounded-full px-3 py-1">
							Pinned
						</span>
					)}
					{open ? <ChevronUp size={16} className="text-[#444]" /> : <ChevronDown size={16} className="text-[#444]" />}
				</div>
			</button>

			{open && (
				<div className="border-t border-[#111] divide-y divide-[#0D0D0D]">
					{challenges.map((c) => {
						const isAuto   = c.id === autoChallenge?.id && !activeOverrideId;
						const isPinned = c.id === activeOverrideId;
						const isHighlight = isAuto || isPinned;
						return (
							<div key={c.id} className={`px-8 py-5 flex items-center gap-6 ${isHighlight ? 'bg-[#0D0D0D]' : ''}`}>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-3 mb-1 flex-wrap">
										<span className={`text-base font-light ${isHighlight ? 'text-[#F2F2F2]' : 'text-[#888]'}`}>
											{c.title}
										</span>
										<TierBadge tier={c.tier} />
										{isAuto && (
											<span className="text-[9px] uppercase tracking-[0.3em] text-[#00CC66] font-black border border-[#00CC66]/20 bg-[#00CC66]/10 rounded-full px-3 py-1">
												Auto
											</span>
										)}
										{isPinned && (
											<span className="text-[9px] uppercase tracking-[0.3em] text-[#E8D200] font-black border border-[#E8D200]/20 bg-[#E8D200]/10 rounded-full px-3 py-1">
												Pinned
											</span>
										)}
									</div>
									<p className="text-[#555] text-sm">{c.description}</p>
									<div className="mt-1 text-[9px] uppercase tracking-[0.3em] text-[#333] font-black">+{c.points} pts</div>
								</div>

								<div className="shrink-0">
									{isPinned ? (
										<button
											onClick={() => onUnpin(category)}
											className="h-9 px-5 rounded-full border border-[#F43F5E]/20 bg-[#F43F5E]/10 text-[#F43F5E] text-[9px] font-black uppercase tracking-[0.25em] flex items-center gap-2 hover:bg-[#F43F5E]/20 transition-colors"
										>
											<RefreshCw size={11} /> Unpin
										</button>
									) : isAuto ? (
										<div className="h-9 px-5 rounded-full border border-[#00CC66]/20 bg-[#00CC66]/10 text-[#00CC66] text-[9px] font-black uppercase tracking-[0.25em] flex items-center gap-2">
											<Check size={11} /> Current
										</div>
									) : (
										<button
											onClick={() => onPin(category, c.id)}
											className="h-9 px-5 rounded-full border border-[#151515] bg-[#050505] text-[#555] text-[9px] font-black uppercase tracking-[0.25em] flex items-center gap-2 hover:border-[#E8D200]/30 hover:text-[#E8D200] transition-colors"
										>
											<Flag size={11} /> Pin
										</button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WeeklyChallenges() {
	const toast  = useToast();
	const { user } = useAuth();

	const [loading, setSaving_]  = useState(true);
	const [saving, setSaving]    = useState(false);
	const [configRowExists, setConfigRowExists] = useState(false);
	const [allOverrides, setAllOverrides] = useState({});

	const thisWeek = useMemo(() => currentISOWeek(), []);
	const nextWeek = useMemo(() => nextWeekISO(), []);
	const [selectedWeek, setSelectedWeek] = useState(thisWeek);

	// ── Load ────────────────────────────────────────────────────────────────

	const loadOverrides = useCallback(async () => {
		setSaving_(true);
		const { data } = await supabase
			.from('system_config')
			.select('value')
			.eq('key', OVERRIDE_KEY)
			.maybeSingle();
		if (data?.value) {
			try {
				const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
				setAllOverrides(parsed ?? {});
				setConfigRowExists(true);
			} catch {
				setAllOverrides({});
			}
		} else {
			setConfigRowExists(false);
		}
		setSaving_(false);
	}, []);

	useEffect(() => { loadOverrides(); }, [loadOverrides]);

	// ── Persist ─────────────────────────────────────────────────────────────

	const persistOverrides = useCallback(async (next, action, metadata = {}) => {
		setSaving(true);
		try {
			const value = JSON.stringify(next);
			const payload = {
				key:         OVERRIDE_KEY,
				value,
				description: 'Per-week challenge overrides: { isoWeek: { category: challengeId } }',
				updated_at:  new Date().toISOString(),
				updated_by:  user?.id ?? null,
			};
			const query = configRowExists
				? supabase.from('system_config').update(payload).eq('key', OVERRIDE_KEY)
				: supabase.from('system_config').insert([payload]);
			const { error } = await query;
			if (error) throw error;
			if (user?.id) await logAction(user.id, action, metadata);
			setAllOverrides(next);
			setConfigRowExists(true);
			return true;
		} catch (e) {
			toast.error(e.message ?? 'Save failed');
			return false;
		} finally {
			setSaving(false);
		}
	}, [configRowExists, user, toast]);

	const pinChallenge = useCallback(async (category, challengeId) => {
		const next = {
			...allOverrides,
			[selectedWeek]: { ...(allOverrides[selectedWeek] ?? {}), [category]: challengeId },
		};
		const ok = await persistOverrides(next, 'challenge_pin', { week: selectedWeek, category, challengeId });
		if (ok) toast.success('Challenge pinned for ' + selectedWeek);
	}, [allOverrides, selectedWeek, persistOverrides, toast]);

	const unpinChallenge = useCallback(async (category) => {
		const weekMap = { ...(allOverrides[selectedWeek] ?? {}) };
		delete weekMap[category];
		const next = { ...allOverrides, [selectedWeek]: weekMap };
		const ok = await persistOverrides(next, 'challenge_unpin', { week: selectedWeek, category });
		if (ok) toast.success('Override cleared — auto rotation restored');
	}, [allOverrides, selectedWeek, persistOverrides, toast]);

	// ── Derived ─────────────────────────────────────────────────────────────

	const autoForWeek   = useMemo(() => getActiveChallengesForWeek(selectedWeek, CATALOG), [selectedWeek]);
	const weekOverrides = allOverrides[selectedWeek] ?? {};

	const resolvedChallenge = useCallback((cat) => {
		const ovId = weekOverrides[cat];
		if (ovId) {
			const found = CATALOG.find((c) => c.id === ovId);
			if (found) return found;
		}
		return autoForWeek.find((c) => c.category === cat);
	}, [weekOverrides, autoForWeek]);

	const overrideCount = Object.keys(weekOverrides).length;
	const totalActive   = CATALOG.filter((c) => c.supported !== false).length;

	const stats = [
		{ label: 'Catalog Size',     value: totalActive,           tone: '#E8D200', icon: Activity },
		{ label: 'Categories',       value: CATEGORY_ORDER.length, tone: '#10B981', icon: Check },
		{ label: 'Overrides Active', value: overrideCount,         tone: overrideCount > 0 ? '#FF5C00' : '#F2F2F2', icon: Flag },
		{ label: 'Selected Week',    value: selectedWeek,          tone: '#0EA5E9', icon: RefreshCw },
	];

	return (
		<div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">

			{/* ── Header ──────────────────────────────────────────────────── */}
			<div className="flex flex-col gap-8 mb-16">
				<div className="flex items-center gap-3">
					<div className="h-[1px] w-12 bg-[#E8D200]" />
					<span className="text-[10px] uppercase tracking-[0.5em] text-[#E8D200] font-black">Subsystem / Challenges</span>
				</div>
				<div>
					<h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-5">Weekly Challenges</h1>
					<p className="text-[#999] text-[11px] max-w-2xl font-black uppercase tracking-[0.4em] leading-relaxed">
						57 challenges auto-rotate weekly across 5 categories. Pin a specific challenge for any week to override the rotation.
					</p>
				</div>
			</div>

			{/* ── Stats ───────────────────────────────────────────────────── */}
			<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-12">
				{stats.map((item) => (
					<div key={item.label} className="rounded-3xl border border-[#151515] bg-[#0A0A0A] p-8">
						<div className="flex items-center justify-between mb-8">
							<div className="text-[10px] uppercase tracking-[0.4em] text-[#333] font-black">{item.label}</div>
							<item.icon size={16} style={{ color: item.tone }} />
						</div>
						<div className="text-4xl font-light tracking-tight" style={{ color: item.tone }}>
							{item.value}
						</div>
					</div>
				))}
			</div>

			{/* ── Week selector ───────────────────────────────────────────── */}
			<div className="flex items-center gap-3 mb-10">
				{[thisWeek, nextWeek].map((week) => (
					<button
						key={week}
						onClick={() => setSelectedWeek(week)}
						className={`h-12 px-8 rounded-full text-[10px] font-black uppercase tracking-[0.3em] border transition-all ${
							selectedWeek === week
								? 'border-[#E8D200]/40 bg-[#E8D200]/10 text-[#E8D200]'
								: 'border-[#151515] bg-[#0A0A0A] text-[#555] hover:text-[#999]'
						}`}
					>
						{week === thisWeek ? 'This Week' : 'Next Week'}
						<span className={`ml-2 normal-case tracking-normal font-normal ${selectedWeek === week ? 'text-[#E8D200]/60' : 'text-[#333]'}`}>
							{weekLabel(week)}
						</span>
					</button>
				))}
				{saving && (
					<span className="ml-4 text-[10px] uppercase tracking-[0.35em] text-[#555] font-black flex items-center gap-2">
						<RefreshCw size={12} className="animate-spin" /> Saving…
					</span>
				)}
			</div>

			{/* ── Active challenges ────────────────────────────────────────── */}
			<div className="mb-6">
				<div className="flex items-center gap-3 mb-2">
					<span className="text-[10px] uppercase tracking-[0.5em] text-[#555] font-black">Active This Week</span>
					{overrideCount > 0 && (
						<span className="text-[9px] uppercase tracking-[0.3em] text-[#FF5C00] font-black border border-[#FF5C00]/20 bg-[#FF5C00]/10 rounded-full px-3 py-1">
							{overrideCount} override{overrideCount !== 1 ? 's' : ''}
						</span>
					)}
				</div>
				<p className="text-[11px] text-[#444] mb-6">
					The 5 challenges shown on the app home screen for {selectedWeek} ({weekLabel(selectedWeek)}).
					Orange border = admin override. Use <strong className="text-[#F2F2F2]">Change</strong> to jump to that category in the catalog below.
				</p>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-5 mb-16">
				{CATEGORY_ORDER.map((cat) => {
					const c = resolvedChallenge(cat);
					if (!c) return null;
					return (
						<ActiveChallengeCard
							key={cat}
							category={cat}
							challenge={c}
							isOverridden={!!weekOverrides[cat]}
							onScrollToCatalog={() => {
								document.getElementById(`catalog-${cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
							}}
							onClear={() => unpinChallenge(cat)}
						/>
					);
				})}
			</div>

			{/* ── How it works ────────────────────────────────────────────── */}
			<div className="rounded-[2rem] border border-[#151515] bg-[#0A0A0A] p-10 mb-12">
				<h2 className="text-2xl font-light tracking-tight text-[#F2F2F2] mb-8">How the rotation works</h2>
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-[#DDD]">
					<div className="rounded-2xl border border-[#151515] bg-[#050505] px-6 py-5">
						<div className="text-[10px] uppercase tracking-[0.35em] text-[#333] font-black mb-3">1. Auto rotation</div>
						<div className="text-sm leading-relaxed">Each week the system picks 1 challenge per category from the catalog, advancing by one slot. No manual action needed.</div>
					</div>
					<div className="rounded-2xl border border-[#151515] bg-[#050505] px-6 py-5">
						<div className="text-[10px] uppercase tracking-[0.35em] text-[#333] font-black mb-3">2. Pin an override</div>
						<div className="text-sm leading-relaxed">Use the <strong className="text-[#F2F2F2]">Pin</strong> button next to any catalog entry to force that challenge for a specific week and category. Saved to <code className="text-[#E8D200] text-xs">system_config</code>.</div>
					</div>
					<div className="rounded-2xl border border-[#151515] bg-[#050505] px-6 py-5">
						<div className="text-[10px] uppercase tracking-[0.35em] text-[#333] font-black mb-3">3. Reset</div>
						<div className="text-sm leading-relaxed">Click <strong className="text-[#F2F2F2]">Unpin</strong> or the reset icon on any overridden card to return it to the auto rotation for that week.</div>
					</div>
				</div>
			</div>

			{/* ── Full catalog ─────────────────────────────────────────────── */}
			<div className="mb-6">
				<span className="text-[10px] uppercase tracking-[0.5em] text-[#555] font-black">Full Catalog — {totalActive} Challenges</span>
				<p className="text-[11px] text-[#444] mt-2">Expand a category to see all challenges and pin one for {selectedWeek}.</p>
			</div>

			<div className="space-y-4">
				{CATEGORY_ORDER.map((cat) => {
					const list = CATALOG
						.filter((c) => c.category === cat && c.supported !== false)
						.sort((a, b) => ({ easy: 0, medium: 1, hard: 2 }[a.tier] - ({ easy: 0, medium: 1, hard: 2 }[b.tier])));
					const autoChallenge = autoForWeek.find((c) => c.category === cat);
					return (
						<div id={`catalog-${cat}`} key={cat}>
							<CatalogCategorySection
								category={cat}
								challenges={list}
								weekOverrides={weekOverrides}
								autoChallenge={autoChallenge}
								onPin={pinChallenge}
								onUnpin={unpinChallenge}
							/>
						</div>
					);
				})}
			</div>

			{/* ── Past override history ─────────────────────────────────── */}
			{Object.keys(allOverrides).filter((w) => w !== thisWeek && w !== nextWeek && Object.keys(allOverrides[w] ?? {}).length > 0).length > 0 && (
				<div className="mt-16">
					<span className="text-[10px] uppercase tracking-[0.5em] text-[#555] font-black">Past Overrides</span>
					<div className="mt-6 rounded-3xl border border-[#151515] bg-[#0A0A0A] overflow-hidden">
						<div className="divide-y divide-[#111]">
							{Object.entries(allOverrides)
								.filter(([w, ov]) => w !== thisWeek && w !== nextWeek && Object.keys(ov ?? {}).length > 0)
								.sort(([a], [b]) => (a < b ? 1 : -1))
								.map(([week, ov]) => (
									<div key={week} className="px-8 py-5 flex items-center gap-6">
										<div className="w-32 shrink-0">
											<div className="text-sm text-[#555]">{week}</div>
											<div className="text-[10px] text-[#333]">{weekLabel(week)}</div>
										</div>
										<div className="flex flex-wrap gap-2 flex-1">
											{Object.entries(ov).map(([cat, id]) => {
												const c = CATALOG.find((x) => x.id === id);
												return (
													<span key={cat} className="inline-flex items-center gap-2 border border-[#151515] rounded-full px-4 py-1.5 text-[10px] text-[#666]">
														<CatIcon category={cat} />
														{c?.title ?? id}
													</span>
												);
											})}
										</div>
										<button
											onClick={async () => {
												const next = { ...allOverrides };
												delete next[week];
												await persistOverrides(next, 'challenge_clear_week', { week });
											}}
											className="shrink-0 w-8 h-8 rounded-full border border-[#222] text-[#444] flex items-center justify-center hover:text-[#F43F5E] hover:border-[#F43F5E]/30 transition-colors"
										>
											<X size={13} />
										</button>
									</div>
								))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

