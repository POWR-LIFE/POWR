import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarClock, Edit2, Eye, Plus, Save, Target, Trash2, X, Zap } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import {
	ACTIVE_WEEKLY_CHALLENGE,
	computeExpiresIn,
	getActiveWeeklyChallenge,
	normalizeWeeklyChallenges,
	parseWeeklyChallengesConfig,
	serializeWeeklyChallenges,
} from '../../../../shared/weeklyChallenges.js';

/** Convert a UTC ISO string to the value format datetime-local inputs expect. */
function toDatetimeLocal(isoString) {
	if (!isoString) return '';
	const d = new Date(isoString);
	const offset = d.getTimezoneOffset();
	const local = new Date(d.getTime() - offset * 60_000);
	return local.toISOString().slice(0, 16);
}

const CONFIG_KEY = 'weekly_challenges';

const ALL_ACTIVITY_TYPES = [
	{ value: 'gym', label: 'Gym' },
	{ value: 'hiit', label: 'HIIT' },
	{ value: 'running', label: 'Running' },
	{ value: 'cycling', label: 'Cycling' },
	{ value: 'swimming', label: 'Swimming' },
	{ value: 'sports', label: 'Sports' },
	{ value: 'yoga', label: 'Yoga' },
	{ value: 'dance', label: 'Dance' },
	{ value: 'walking', label: 'Walking' },
];

const EMPTY_FORM = {
	id: '',
	active: false,
	status: 'draft',
	title: '',
	description: '',
	bonusLabel: '',
	expiresAt: '',
	imageUri: '',
	imageOffsetY: 0,
	hint: '',
	xpReward: 0,
	powrRewardText: '',
	cadenceLabel: 'Rotates weekly',
	scheduleLabel: '',
	audienceLabel: 'All members',
	requiredSessions: 1,       // how many sessions needed to complete
	qualifyingTypes: [],       // which activity types count toward this challenge
	steps: [],                 // step labels (auto-generated on card if empty)
	startBeforeHour: null,     // null = no time restriction; number = must start before this local hour
};

const statusTone = {
	live: 'text-[#10B981] border-[#10B981]/20 bg-[#10B981]/10',
	draft: 'text-[#F59E0B] border-[#F59E0B]/20 bg-[#F59E0B]/10',
	archived: 'text-[#999] border-[#333] bg-[#111]',
};

const formatStatus = (status) => status.charAt(0).toUpperCase() + status.slice(1);
const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const logAction = async (adminId, action, metadata = {}) => {
	await supabase.from('admin_audit_log').insert({
		admin_id: adminId,
		action,
		target_type: 'system_config',
		target_id: CONFIG_KEY,
		metadata,
	});
};

function ChallengePreview({ challenge }) {
	return (
		<div className="relative h-[248px] overflow-hidden rounded-[20px] border border-[#1A1A1A] bg-[#050505]">
			<img
				src={challenge.imageUri}
				alt={challenge.title}
				className="absolute inset-0 h-full w-full object-cover"
				style={{ transform: `translateY(${challenge.imageOffsetY || 0}px) scale(1.02)` }}
			/>
			<div className="absolute inset-0 bg-gradient-to-r from-[rgba(10,10,10,0.85)] via-[rgba(10,10,10,0.35)] to-transparent" />
			<div className="absolute inset-0 bg-gradient-to-t from-[rgba(10,10,10,0.95)] via-[rgba(10,10,10,0.6)] to-transparent" />

			<div className="absolute left-7 right-7 top-5 flex items-center justify-between gap-6">
				<div className="rounded-lg border border-[#E8D200]/25 bg-[#E8D200]/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.35em] text-[#E8D200]">
					Weekly Challenge
				</div>
				<div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/25 px-4 py-2 text-[#F2F2F2]">
					<div className="h-2 w-2 rounded-full bg-[#E8D200] shadow-[0_0_15px_rgba(232,210,0,0.45)]" />
					<span className="text-sm font-medium">{computeExpiresIn(challenge.expiresAt) || challenge.expiresIn || 'No timer'}</span>
				</div>
			</div>

			<div className="absolute bottom-7 left-7 right-7">
				<h2 className="mb-2 text-5xl font-light tracking-tight text-[#F2F2F2]">{challenge.title || 'Untitled challenge'}</h2>
				<p className="mb-5 max-w-2xl text-2xl font-light text-[#F2F2F2]">{challenge.description || 'No description yet'}</p>
				<div className="mb-4 flex flex-wrap items-center gap-4 text-[#F2F2F2]">
					<div className="rounded-lg border border-[#E8D200]/25 bg-[#E8D200]/10 px-4 py-2 text-base font-black uppercase tracking-[0.15em] text-[#E8D200]">
						{challenge.bonusLabel || 'Bonus'}
					</div>
					<span className="text-xl">+{challenge.xpReward || 0} XP</span>
					<span className="text-[#777]">·</span>
					<span className="text-xl">{challenge.powrRewardText || 'Reward TBC'}</span>
				</div>
				<p className="text-xl text-[#F2F2F2]">{challenge.hint || 'Hint goes here'}</p>
			</div>
		</div>
	);
}

export default function WeeklyChallenges() {
	const toast = useToast();
	const { user } = useAuth();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [configRow, setConfigRow] = useState(null);
	const [challenges, setChallenges] = useState(() => normalizeWeeklyChallenges([ACTIVE_WEEKLY_CHALLENGE]));
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingId, setEditingId] = useState(null);
	const [form, setForm] = useState(EMPTY_FORM);

	const activeChallenge = useMemo(() => getActiveWeeklyChallenge(challenges), [challenges]);
	const liveCount = challenges.filter((challenge) => challenge.active).length;

	useEffect(() => {
		fetchChallenges();
	}, []);

	const fetchChallenges = async () => {
		setLoading(true);
		try {
			const { data, error } = await supabase
				.from('system_config')
				.select('*')
				.eq('key', CONFIG_KEY)
				.maybeSingle();

			if (error) throw error;

			setConfigRow(data || null);
			setChallenges(parseWeeklyChallengesConfig(data?.value));
		} catch (error) {
			toast.error('Failed to load weekly challenges');
			console.error(error);
			setChallenges(normalizeWeeklyChallenges([ACTIVE_WEEKLY_CHALLENGE]));
		} finally {
			setLoading(false);
		}
	};

	const persistChallenges = async (nextChallenges, action, metadata = {}) => {
		setSaving(true);
		const normalized = normalizeWeeklyChallenges(nextChallenges);
		const value = serializeWeeklyChallenges(normalized);

		try {
			const payload = {
				key: CONFIG_KEY,
				value,
				description: 'Admin-managed weekly challenges shown on the app home screen',
				updated_at: new Date().toISOString(),
				updated_by: user?.id || null,
			};

			const query = configRow?.key
				? supabase.from('system_config').update(payload).eq('key', CONFIG_KEY)
				: supabase.from('system_config').insert([payload]);

			const { error } = await query;
			if (error) throw error;

			if (user?.id) {
				await logAction(user.id, action, { count: normalized.length, ...metadata });
			}

			setChallenges(normalized);
			setConfigRow((prev) => ({ ...(prev || {}), ...payload }));
			return true;
		} catch (error) {
			toast.error(error.message || 'Failed to save weekly challenges');
			console.error(error);
			return false;
		} finally {
			setSaving(false);
		}
	};

	const openCreate = () => {
		setEditingId(null);
		setForm({
			...EMPTY_FORM,
			id: `challenge-${Date.now()}`,
			active: challenges.length === 0,
		});
		setIsModalOpen(true);
	};

	const openEdit = (challenge) => {
		setEditingId(challenge.id);
		setForm({ ...challenge });
		setIsModalOpen(true);
	};

	const closeModal = () => {
		setIsModalOpen(false);
		setEditingId(null);
		setForm(EMPTY_FORM);
	};

	const handleSave = async (event) => {
		event.preventDefault();

		const rawSteps = Array.isArray(form.steps) ? form.steps.filter(Boolean) : [];
		const numSessions = Math.max(1, parseInt(form.requiredSessions, 10) || 1);
		// Auto-generate step labels if none were provided manually
		const steps = rawSteps.length === numSessions
			? rawSteps
			: Array.from({ length: numSessions }, (_, i) =>
					i === 0 ? 'First session'
					: i === numSessions - 1 ? 'Final session'
					: `Session ${i + 1}`);

		const normalizedForm = {
			...form,
			id: slugify(form.id || form.title) || `challenge-${Date.now()}`,
			imageOffsetY: Number(form.imageOffsetY) || 0,
			xpReward: Number(form.xpReward) || 0,
			requiredSessions: numSessions,
			qualifyingTypes: Array.isArray(form.qualifyingTypes) ? form.qualifyingTypes : [],
			steps,
			startBeforeHour: form.startBeforeHour != null && form.startBeforeHour !== '' ? Number(form.startBeforeHour) : null,
		};

		const nextChallenges = editingId
			? challenges.map((challenge) => (challenge.id === editingId ? normalizedForm : challenge))
			: [...challenges, normalizedForm];

		const finalChallenges = normalizedForm.active
			? nextChallenges.map((challenge) => ({ ...challenge, active: challenge.id === normalizedForm.id }))
			: nextChallenges;

		const didSave = await persistChallenges(finalChallenges, editingId ? 'weekly_challenge_update' : 'weekly_challenge_create', {
			challenge_id: normalizedForm.id,
			title: normalizedForm.title,
		});

		if (didSave) {
			toast.success(editingId ? 'Weekly challenge updated' : 'Weekly challenge created');
			closeModal();
		}
	};

	const handleDelete = async (challengeId) => {
		const target = challenges.find((challenge) => challenge.id === challengeId);
		const nextChallenges = challenges.filter((challenge) => challenge.id !== challengeId);
		const safeChallenges = nextChallenges.length ? nextChallenges : [ACTIVE_WEEKLY_CHALLENGE];
		const didSave = await persistChallenges(safeChallenges, 'weekly_challenge_delete', {
			challenge_id: challengeId,
			title: target?.title,
		});

		if (didSave) {
			toast.success('Weekly challenge deleted');
		}
	};

	const handleSetLive = async (challengeId) => {
		const nextChallenges = challenges.map((challenge) => ({
			...challenge,
			active: challenge.id === challengeId,
			status: challenge.id === challengeId ? 'live' : challenge.status,
		}));

		const didSave = await persistChallenges(nextChallenges, 'weekly_challenge_activate', { challenge_id: challengeId });
		if (didSave) {
			toast.success('Live challenge updated');
		}
	};

	const summary = [
		{ label: 'Challenge Count', value: challenges.length, icon: Activity, tone: '#E8D200' },
		{ label: 'Live This Week', value: liveCount, icon: Eye, tone: '#10B981' },
		{ label: 'XP Reward', value: activeChallenge.xpReward, icon: Zap, tone: '#0EA5E9' },
		{ label: 'Window', value: activeChallenge.scheduleLabel || 'Unset', icon: CalendarClock, tone: '#F97316' },
	];

	return (
		<div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
			<div className="flex flex-col gap-8 mb-16">
				<div className="flex items-center gap-3">
					<div className="h-[1px] w-12 bg-[#E8D200]" />
					<span className="text-[10px] uppercase tracking-[0.5em] text-[#E8D200] font-black">Subsystem / Challenges</span>
				</div>
				<div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-8">
					<div>
						<h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-5">Weekly Challenges</h1>
						<p className="text-[#999] text-[11px] max-w-2xl font-black uppercase tracking-[0.4em] leading-relaxed">
							Add, edit, delete, and publish the weekly challenges that appear on the app home screen.
						</p>
					</div>
					<button
						onClick={openCreate}
						className="flex items-center gap-4 h-16 px-10 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20 shrink-0"
					>
						<Plus size={18} /> Add Challenge
					</button>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8 mb-16">
				{summary.map((item) => (
					<div key={item.label} className="rounded-3xl border border-[#151515] bg-[#0A0A0A] p-10">
						<div className="flex items-center justify-between mb-10">
							<div className="text-[10px] uppercase tracking-[0.4em] text-[#333] font-black">{item.label}</div>
							<item.icon size={18} style={{ color: item.tone }} />
						</div>
						<div className="text-5xl font-light tracking-tight text-[#F2F2F2]">
							{typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
						</div>
					</div>
				))}
			</div>

			<div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)] gap-12 mb-16">
				<div className="rounded-[2rem] border border-[#151515] bg-[#0A0A0A] p-8">
					<div className="flex items-center justify-between gap-6 mb-8">
						<div>
							<h2 className="text-3xl font-light tracking-tight text-[#F2F2F2] mb-2">Live Preview</h2>
							<p className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black">Shows the currently active weekly challenge</p>
						</div>
						<div className={`rounded-full border px-5 py-3 text-[10px] font-black uppercase tracking-[0.3em] ${statusTone[activeChallenge.status] || statusTone.archived}`}>
							{formatStatus(activeChallenge.status)}
						</div>
					</div>
					<ChallengePreview challenge={activeChallenge} />
				</div>

				<div className="rounded-[2rem] border border-[#151515] bg-[#0A0A0A] p-10">
					<div className="flex items-center gap-4 mb-10">
						<Target size={18} className="text-[#E8D200]" />
						<h2 className="text-2xl font-light tracking-tight text-[#F2F2F2]">How It Works</h2>
					</div>
					<div className="space-y-6 text-[#DDD]">
						<div className="rounded-2xl border border-[#151515] bg-[#050505] px-6 py-5">
							<div className="text-[10px] uppercase tracking-[0.35em] text-[#333] font-black mb-2">1. Create or edit</div>
							<div className="text-lg">Use Add Challenge or Edit to change copy, timer, rewards, imagery, and schedule labels.</div>
						</div>
						<div className="rounded-2xl border border-[#151515] bg-[#050505] px-6 py-5">
							<div className="text-[10px] uppercase tracking-[0.35em] text-[#333] font-black mb-2">2. Set live</div>
							<div className="text-lg">Use Set Live on one challenge to publish it to the app home screen.</div>
						</div>
						<div className="rounded-2xl border border-[#151515] bg-[#050505] px-6 py-5">
							<div className="text-[10px] uppercase tracking-[0.35em] text-[#333] font-black mb-2">3. Delete safely</div>
							<div className="text-lg">Delete removes a challenge from the stored catalogue. The live preview updates immediately after save.</div>
						</div>
					</div>
				</div>
			</div>

			<div className="rounded-[2rem] border border-[#151515] bg-[#0A0A0A] overflow-hidden">
				<div className="flex items-center justify-between gap-6 border-b border-[#151515] px-10 py-8 bg-[#050505]">
					<div>
						<h2 className="text-2xl font-light tracking-tight text-[#F2F2F2] mb-2">Challenge Catalogue</h2>
						<p className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black">Manage the stored weekly challenge list used by the product</p>
					</div>
					<div className="text-[10px] uppercase tracking-[0.35em] text-[#333] font-black">{saving ? 'Saving...' : `${challenges.length} configured`}</div>
				</div>

				{loading ? (
					<div className="flex items-center justify-center py-24 text-[10px] uppercase tracking-[0.5em] text-[#666] font-black">Loading challenge config...</div>
				) : (
					<div className="divide-y divide-[#111]">
						{challenges.map((challenge) => (
							<div key={challenge.id} className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_260px] gap-8 px-10 py-8 items-center">
								<div className="aspect-[1.35] overflow-hidden rounded-[1.25rem] border border-[#151515] bg-[#050505]">
									<img
										src={challenge.imageUri}
										alt={challenge.title}
										className="h-full w-full object-cover"
										style={{ transform: `translateY(${challenge.imageOffsetY || 0}px) scale(1.02)` }}
									/>
								</div>

								<div>
									<div className="flex items-center gap-4 mb-3 flex-wrap">
										<h3 className="text-2xl font-light tracking-tight text-[#F2F2F2]">{challenge.title}</h3>
										<div className={`rounded-full border px-4 py-2 text-[10px] font-black uppercase tracking-[0.3em] ${statusTone[challenge.status] || statusTone.archived}`}>
											{formatStatus(challenge.status)}
										</div>
										{challenge.active && (
											<div className="rounded-full border border-[#E8D200]/20 bg-[#E8D200]/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.3em] text-[#E8D200]">
												Live
											</div>
										)}
									</div>
									<p className="text-[#DDD] text-lg mb-4">{challenge.description}</p>
									<div className="flex flex-wrap items-center gap-4 text-sm uppercase tracking-[0.25em] font-black text-[#666]">
										<span>{challenge.scheduleLabel}</span>
										<span className="text-[#222]">•</span>
										<span>{challenge.audienceLabel}</span>
										<span className="text-[#222]">•</span>
										<span>{challenge.cadenceLabel}</span>
										<span className="text-[#222]">•</span>
										<span>{challenge.bonusLabel}</span>
									</div>
								</div>

								<div className="flex flex-wrap justify-end gap-3">
									{!challenge.active && (
										<button
											onClick={() => handleSetLive(challenge.id)}
											disabled={saving}
											className="h-12 px-5 rounded-full border border-[#10B981]/20 bg-[#10B981]/10 text-[#10B981] text-[10px] font-black uppercase tracking-[0.25em] disabled:opacity-50"
										>
											Set Live
										</button>
									)}
									<button
										onClick={() => openEdit(challenge)}
										className="h-12 px-5 rounded-full border border-[#151515] bg-[#050505] text-[#F2F2F2] text-[10px] font-black uppercase tracking-[0.25em] flex items-center gap-2"
									>
										<Edit2 size={14} /> Edit
									</button>
									<button
										onClick={() => handleDelete(challenge.id)}
										disabled={saving || challenges.length <= 1}
										className="h-12 px-5 rounded-full border border-[#F43F5E]/20 bg-[#F43F5E]/10 text-[#F43F5E] text-[10px] font-black uppercase tracking-[0.25em] flex items-center gap-2 disabled:opacity-40"
									>
										<Trash2 size={14} /> Delete
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{isModalOpen && (
				<div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
					<div className="w-full max-w-5xl rounded-[2rem] border border-[#151515] bg-[#0A0A0A] max-h-[92vh] overflow-y-auto">
						<div className="sticky top-0 z-10 flex items-center justify-between px-8 py-6 border-b border-[#151515] bg-[#0A0A0A]">
							<div>
								<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-2">Challenge Editor</div>
								<h2 className="text-2xl font-light tracking-tight text-[#F2F2F2]">{editingId ? 'Edit Weekly Challenge' : 'Add Weekly Challenge'}</h2>
							</div>
							<button onClick={closeModal} className="w-12 h-12 rounded-full border border-[#151515] bg-[#050505] text-[#999] flex items-center justify-center">
								<X size={18} />
							</button>
						</div>

						<form onSubmit={handleSave} className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-10 p-8">
							<div className="space-y-6">
								<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Title</div>
										<input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" required />
									</label>
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">ID</div>
										<input value={form.id} onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" required />
									</label>
								</div>

								<label className="block">
									<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Description</div>
									<textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} className="w-full min-h-28 px-5 py-4 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" required />
								</label>

								<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Bonus Label</div>
										<input value={form.bonusLabel} onChange={(e) => setForm((prev) => ({ ...prev, bonusLabel: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" />
									</label>
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">
											Expires At
											{form.expiresAt && (
												<span className="ml-3 text-[#E8D200] normal-case tracking-normal">
													({computeExpiresIn(form.expiresAt) || 'Expired'})
												</span>
											)}
										</div>
										<input
											type="datetime-local"
											value={toDatetimeLocal(form.expiresAt)}
											onChange={(e) => setForm((prev) => ({
												...prev,
												expiresAt: e.target.value ? new Date(e.target.value).toISOString() : '',
											}))}
											className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none [color-scheme:dark]"
										/>
									</label>
								</div>

								<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">XP Reward</div>
										<input type="number" value={form.xpReward} onChange={(e) => setForm((prev) => ({ ...prev, xpReward: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" />
									</label>
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">POWR Reward Text</div>
										<input value={form.powrRewardText} onChange={(e) => setForm((prev) => ({ ...prev, powrRewardText: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" />
									</label>
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Image Offset Y</div>
										<input type="number" value={form.imageOffsetY} onChange={(e) => setForm((prev) => ({ ...prev, imageOffsetY: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" />
									</label>
								</div>

								<label className="block">
									<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Image URL</div>
									<input value={form.imageUri} onChange={(e) => setForm((prev) => ({ ...prev, imageUri: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" required />
								</label>

								<label className="block">
									<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Hint</div>
									<input value={form.hint} onChange={(e) => setForm((prev) => ({ ...prev, hint: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" />
								</label>

								<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Status</div>
										<select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none">
											<option value="draft">Draft</option>
											<option value="live">Live</option>
											<option value="archived">Archived</option>
										</select>
									</label>
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Schedule Label</div>
										<input value={form.scheduleLabel} onChange={(e) => setForm((prev) => ({ ...prev, scheduleLabel: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" />
									</label>
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Audience Label</div>
										<input value={form.audienceLabel} onChange={(e) => setForm((prev) => ({ ...prev, audienceLabel: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" />
									</label>
								</div>

								<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">Cadence Label</div>
										<input value={form.cadenceLabel} onChange={(e) => setForm((prev) => ({ ...prev, cadenceLabel: e.target.value }))} className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none" />
									</label>
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">
											Sessions Required
											<span className="ml-2 normal-case tracking-normal text-[#444]">(1–10)</span>
										</div>
										<input
											type="number"
											min="1"
											max="10"
											value={form.requiredSessions ?? 1}
											onChange={(e) => setForm((prev) => ({ ...prev, requiredSessions: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)), steps: [] }))}
											className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none"
										/>
									</label>
									<label className="block">
										<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">
											Start Before Hour
											<span className="ml-2 normal-case tracking-normal text-[#444]">(local, 0–23; blank = no restriction)</span>
										</div>
										<input
											type="number"
											min="0"
											max="23"
											placeholder="e.g. 12"
											value={form.startBeforeHour ?? ''}
											onChange={(e) => {
												const val = e.target.value === '' ? null : Math.min(23, Math.max(0, parseInt(e.target.value, 10)));
												setForm((prev) => ({ ...prev, startBeforeHour: isNaN(val) ? null : val }));
											}}
											className="w-full h-14 px-5 bg-[#050505] border border-[#151515] rounded-2xl text-[#F2F2F2] outline-none"
										/>
									</label>
								</div>

								<div>
									<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black mb-3">
										Qualifying Activity Types
										<span className="ml-2 normal-case tracking-normal text-[#444]">(sessions of these types count toward completion)</span>
									</div>
									<div className="flex flex-wrap gap-3">
										{ALL_ACTIVITY_TYPES.map(({ value, label }) => {
											const checked = (form.qualifyingTypes ?? []).includes(value);
											return (
												<button
													type="button"
													key={value}
													onClick={() => setForm((prev) => ({
														...prev,
														qualifyingTypes: checked
															? (prev.qualifyingTypes ?? []).filter((t) => t !== value)
															: [...(prev.qualifyingTypes ?? []), value],
													}))}
													className={`h-10 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.25em] transition-colors ${
														checked
															? 'border-[#E8D200]/40 bg-[#E8D200]/15 text-[#E8D200]'
															: 'border-[#222] bg-[#050505] text-[#555]'
													}`}
												>
													{label}
												</button>
											);
										})}
									</div>
									{(form.qualifyingTypes ?? []).length === 0 && (
										<p className="mt-3 text-[11px] text-[#F43F5E]">⚠ No types selected — no session will ever qualify</p>
									)}
								</div>

								<label className="flex items-center gap-4">
									<input type="checkbox" checked={form.active} onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked, status: e.target.checked ? 'live' : prev.status }))} className="h-5 w-5" />
									<span className="text-[11px] uppercase tracking-[0.3em] text-[#DDD] font-black">Set as live challenge</span>
								</label>
							</div>

							<div className="space-y-6">
								<div className="text-[10px] uppercase tracking-[0.35em] text-[#555] font-black">Preview</div>
								<ChallengePreview challenge={{ ...EMPTY_FORM, ...form, xpReward: Number(form.xpReward) || 0, imageOffsetY: Number(form.imageOffsetY) || 0 }} />
								<div className="flex items-center justify-end gap-4 pt-4">
									<button type="button" onClick={closeModal} className="h-14 px-6 rounded-full border border-[#151515] bg-[#050505] text-[#999] text-[10px] font-black uppercase tracking-[0.25em]">
										Cancel
									</button>
									<button type="submit" disabled={saving} className="h-14 px-6 rounded-full bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.25em] flex items-center gap-3 disabled:opacity-60">
										<Save size={14} /> Save Challenge
									</button>
								</div>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}