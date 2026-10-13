import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Award, Check, ChevronDown, ChevronRight, Copy, ExternalLink, KeyRound, LocateFixed, MapPin,
    Monitor, Plus, Printer, RotateCcw, ScanLine, Smartphone, Store, Trash2, Users, X,
} from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import GeofenceMap from '../../components/GeofenceMap';
import { INPUT, BTN_DARK, BTN_GHOST, StageStrip } from './integrationShared';
import {
    BARCODE_FORMATS, CHECK_OPTIONS, WHERE_OPTIONS, archiveSite, createStaff, describeInStore,
    fetchInStoreOverview, parseCoordinates, reissueStaff, revokeStaff, rotateStand, saveSite,
    scanPageUrl, setRewardInStore, staffLink, timeAgoShort,
} from '../../lib/inStore';

// In Store: everything a brand needs to take POWR rewards at a physical till.
// Rewards (where + how each reward is used), Sites (shops with a map pin and a
// printable counter stand), Staff (personal scan links, no portal access) and
// the Scan page itself. All writes are brand-scoped RPCs; see
// supabase/migrations/20261013120100_in_store_redemption.sql.

const TABS = [
    { key: 'rewards', label: 'Rewards', icon: Award },
    { key: 'sites', label: 'Sites', icon: MapPin },
    { key: 'staff', label: 'Staff', icon: Users },
    { key: 'scan', label: 'Scan page', icon: ScanLine },
];

const GOLD_BTN = 'h-11 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:brightness-95 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2';
const EYEBROW = 'text-[10px] uppercase tracking-[0.4em] font-black text-[#999]';

function copyText(text, toast, label = 'Copied') {
    navigator.clipboard?.writeText(text).then(() => toast.success(label), () => toast.error('Copy failed. Select the text and copy it.'));
}

export default function PartnerInStore() {
    const { partnerData } = useAuth();
    const brand = partnerData?.brand_name;
    const [params, setParams] = useSearchParams();
    const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'rewards';
    const setTab = (key) => setParams(key === 'rewards' ? {} : { tab: key }, { replace: true });

    const [data, setData] = useState(null);
    const [loadError, setLoadError] = useState(null);

    const load = useCallback(async () => {
        if (!brand) return;
        setLoadError(null);
        try {
            setData(await fetchInStoreOverview(brand));
        } catch (err) {
            setLoadError(err.message);
        }
    }, [brand]);

    useEffect(() => { load(); }, [load]);

    const sites = data?.sites?.filter(s => s.active) ?? [];
    const staff = data?.staff ?? [];
    const rewards = data?.rewards ?? [];
    const inStoreRewards = rewards.filter(r => r.where !== 'online');
    const scanningRewards = inStoreRewards.filter(r => r.check === 'staff_scan');

    const steps = [
        { label: 'Add a shop', done: sites.length > 0, hint: 'Add each shop with a pin on the map, so members see where to use your rewards.' },
        { label: 'Turn on a reward', done: inStoreRewards.length > 0, hint: 'Pick a reward and choose In store or Both.' },
        // Only staff-scan rewards need anything at the till; the other methods are done once a reward is on.
        { label: 'Set up your till', done: inStoreRewards.length > 0 && (!scanningRewards.length || staff.length > 0), hint: 'Give each member of staff their own scan link, or open the scan page on a till tablet.' },
    ];

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <div className="flex items-end justify-between flex-wrap gap-6 mb-10">
                <div>
                    <div className="flex items-center gap-3 mb-5">
                        <div className="h-[1px] w-10 bg-[#8a7600]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">In store</span>
                    </div>
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">Your shops</h1>
                    <p className="text-sm text-[#777] mt-4 max-w-xl leading-relaxed">
                        Members claim a reward with their points, then show a live voucher at your till. It changes every few seconds, so a screenshot won't work.
                    </p>
                </div>
            </div>

            {loadError ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl py-16 px-8 text-center">
                    <Store size={28} className="text-[#E6E6E1] mx-auto mb-5" />
                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black">Couldn't load your shops</p>
                    <p className="text-xs text-[#999] mt-3 max-w-sm mx-auto leading-relaxed">{loadError} Nothing on your account has changed.</p>
                    <button type="button" onClick={load} className={`${BTN_GHOST} mt-8`}>Try again</button>
                </div>
            ) : !data ? (
                <div className="flex items-center justify-center py-32">
                    <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                </div>
            ) : (
                <>
                    <StageStrip steps={steps} doneHint="You're ready. Members can use your rewards at the till." />

                    <div role="tablist" aria-label="In store" className="inline-flex flex-wrap gap-1.5 p-1.5 bg-white border border-[#E6E6E1] rounded-[1.4rem] mb-8">
                        {TABS.map(t => {
                            const count = t.key === 'rewards' ? inStoreRewards.length : t.key === 'sites' ? sites.length : t.key === 'staff' ? staff.length : null;
                            const on = tab === t.key;
                            return (
                                <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                                    className={`h-10 px-5 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2 transition-all ${on ? 'bg-[#1A1A1A] text-[#E8D200]' : 'text-[#666] hover:text-[#1A1A1A]'}`}>
                                    <t.icon size={14} />{t.label}{count != null && count > 0 && <span className={on ? 'text-white/70' : 'text-[#AAA]'}>{count}</span>}
                                </button>
                            );
                        })}
                    </div>

                    {tab === 'rewards' && <RewardsTab brand={brand} rewards={rewards} sites={sites} onSaved={load} goSites={() => setTab('sites')} />}
                    {tab === 'sites' && <SitesTab brand={brand} sites={sites} rewards={inStoreRewards} onSaved={load} />}
                    {tab === 'staff' && <StaffTab brand={brand} staff={staff} sites={sites} onSaved={load} />}
                    {tab === 'scan' && <ScanTab />}
                </>
            )}
        </div>
    );
}

// ── Rewards ──────────────────────────────────────────────────────────────────

function RewardsTab({ brand, rewards, sites, onSaved, goSites }) {
    const [open, setOpen] = useState(null);
    if (!rewards.length) {
        return (
            <div className="bg-white border border-[#E6E6E1] rounded-3xl py-16 px-8 text-center">
                <Award size={28} className="text-[#E6E6E1] mx-auto mb-5" />
                <p className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black">No rewards yet</p>
                <p className="text-xs text-[#999] mt-3 max-w-sm mx-auto leading-relaxed">Create a reward first. Choose "In store" as the delivery and it lands here ready to set up.</p>
                <Link to="/partner/rewards" className={`${GOLD_BTN} mt-8`}>Create a reward <ChevronRight size={12} /></Link>
            </div>
        );
    }
    return (
        <div className="space-y-3">
            {rewards.map(r => (
                <div key={r.id} className={`bg-white border rounded-3xl transition-all ${open === r.id ? 'border-[#E8D200]' : 'border-[#E6E6E1]'}`}>
                    <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}
                        className="w-full flex items-center gap-4 p-5 text-left">
                        {r.image_url
                            ? <img src={r.image_url} alt="" className="w-11 h-11 rounded-xl object-contain bg-[#1a1a1a] p-1 shrink-0" />
                            : <div className="w-11 h-11 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] shrink-0" />}
                        <div className="flex-1 min-w-0">
                            <div className="text-[15px] font-bold text-[#1A1A1A] truncate">{r.title}</div>
                            <div className="text-[12px] text-[#777] mt-0.5">{describeInStore(r)}</div>
                        </div>
                        {!r.active && <span className="hidden sm:inline px-3 py-1 rounded-full bg-[#F4F4F1] text-[#888] text-[9px] font-black uppercase tracking-[0.2em]">Not live</span>}
                        {r.where !== 'online' && <span className="hidden sm:inline px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-[0.2em]">In store</span>}
                        <ChevronDown size={18} className={`text-[#999] shrink-0 transition-transform ${open === r.id ? 'rotate-180' : ''}`} />
                    </button>
                    {open === r.id && (
                        <RewardEditor brand={brand} reward={r} sites={sites} goSites={goSites}
                            onDone={async (saved) => { if (saved) await onSaved(); setOpen(null); }} />
                    )}
                </div>
            ))}
        </div>
    );
}

function OptionCard({ selected, onClick, title, blurb, tag, foot, footTone, disabled }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={selected} disabled={disabled}
            className={`flex-1 min-w-[190px] text-left p-5 rounded-2xl border-2 flex flex-col gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${selected ? 'border-[#E8D200] bg-[#FFFCE5]' : 'border-[#E6E6E1] bg-[#F4F4F1] hover:border-[#1A1A1A]/20'}`}>
            <span className="flex items-center gap-2 flex-wrap">
                <span className="text-[15px] font-bold text-[#1A1A1A]">{title}</span>
                {tag && <span className="px-2 py-0.5 rounded-lg bg-[#1A1A1A] text-[#E8D200] text-[8px] font-black uppercase tracking-[0.15em]">{tag}</span>}
            </span>
            <span className="text-[13px] text-[#555] leading-relaxed">{blurb}</span>
            {foot && <span className={`mt-auto pt-1 text-[9px] font-black uppercase tracking-[0.15em] ${footTone === 'warn' ? 'text-[#A93A08]' : 'text-emerald-700'}`}>Reports: {foot}</span>}
        </button>
    );
}

function Toggle({ on, onChange, label, detail }) {
    return (
        <div className="flex items-start gap-5 py-4 border-t border-[#EFEFEC]">
            <div className="flex-1">
                <div className="text-[14px] font-bold text-[#1A1A1A]">{label}</div>
                <div className="text-[13px] text-[#666] mt-1 leading-relaxed">{detail}</div>
            </div>
            <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
                className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${on ? 'bg-[#1A1A1A]' : 'bg-[#D9D9D4]'}`}>
                <span className={`absolute top-[3px] w-[22px] h-[22px] rounded-full transition-all ${on ? 'left-[23px] bg-[#E8D200]' : 'left-[3px] bg-white'}`} />
            </button>
        </div>
    );
}

function RewardEditor({ brand, reward, sites, goSites, onDone }) {
    const toast = useToast();
    const [s, setS] = useState(() => ({
        where: reward.where, check: reward.check, requires_stand: reward.requires_stand,
        ask_spend: reward.ask_spend, window_minutes: reward.window_minutes,
        barcode_format: reward.barcode_format, site_ids: reward.site_ids ?? null,
    }));
    const [saving, setSaving] = useState(false);
    const set = (patch) => setS(prev => ({ ...prev, ...patch }));
    const inStore = s.where !== 'online';
    const isAffiliate = reward.integration_type === 'AFFILIATE';
    const isBarcode = s.check === 'till_barcode';
    const allSites = s.site_ids == null;

    const steps = useMemo(() => {
        const out = ['Claims the reward with their points.'];
        if (inStore) {
            out.push('At your till, opens it and taps Use in store.');
            if (!isBarcode && s.requires_stand) out.push('Scans the POWR stand on your counter.');
            if (s.check === 'staff_scan') out.push('Shows the live voucher. Your staff scan it.');
            if (s.check === 'look') out.push('Shows the live voucher. Your staff check it and swipe.');
            if (isBarcode) out.push('Shows your barcode. Your till scans it.');
        }
        if (s.where !== 'in_store') out.push(inStore ? 'Or uses the code at your online checkout.' : 'Uses the code at your online checkout.');
        return out;
    }, [s, inStore, isBarcode]);

    const needs = [];
    if (inStore && s.check === 'staff_scan') needs.push('powr.life/scan open on a phone, or a tablet at the till', 'Their own scan link, from the Staff tab');
    if (inStore && s.check === 'look') needs.push('To know the offer, and to swipe the voucher on the member’s phone');
    if (inStore && isBarcode) needs.push('Nothing new. Your till already takes these codes.');
    if (inStore && !isBarcode && s.requires_stand) needs.push('A printed POWR stand on each counter (Sites tab)');
    if (!inStore) needs.push('Nothing. It all happens at your online checkout.');

    const toggleSite = (id) => {
        const current = s.site_ids ?? sites.map(x => x.id);
        const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
        set({ site_ids: next.length === sites.length ? null : next });
    };

    const save = async () => {
        if (inStore && !allSites && !s.site_ids?.length) { toast.error('Pick at least one shop, or all shops.'); return; }
        setSaving(true);
        try {
            await setRewardInStore(brand, reward.id, s);
            toast.success(inStore ? 'Saved. Members see the change straight away.' : 'Saved. This reward is online only.');
            onDone(true);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="px-5 pb-6 md:px-8 md:pb-8">
            <div className="flex flex-wrap gap-6 items-start">
                <div className="flex-[999_1_520px] min-w-0 space-y-6">
                    <section>
                        <h3 className={`${EYEBROW} mb-4`}>Where can members use it?</h3>
                        <div className="flex flex-wrap gap-3">
                            {WHERE_OPTIONS.map(o => (
                                <OptionCard key={o.value} selected={s.where === o.value} onClick={() => set({ where: o.value })} title={o.label} blurb={o.blurb} />
                            ))}
                        </div>
                        {s.where === 'in_store' && reward.integration_type !== 'IN_STORE' && !isBarcode && (
                            <p className="text-[12px] text-[#8a7600] mt-3 leading-relaxed">Members will stop getting a code for this reward and show a live voucher at your till instead. Codes already claimed still work.</p>
                        )}
                        {s.where !== 'in_store' && reward.integration_type === 'IN_STORE' && (
                            <p className="text-[12px] text-[#8a7600] mt-3 leading-relaxed">Online needs codes. Load them in Promo Codes before members claim this online.</p>
                        )}
                    </section>

                    {inStore && (
                        <section>
                            <h3 className={`${EYEBROW} mb-4`}>How does your shop check it?</h3>
                            <div className="flex flex-wrap gap-3">
                                {CHECK_OPTIONS.map(o => (
                                    <OptionCard key={o.value} selected={s.check === o.value} onClick={() => set({ check: o.value })}
                                        title={o.label} blurb={o.blurb} tag={o.recommended ? 'Recommended' : null} foot={o.reports} footTone={o.tone}
                                        disabled={o.value === 'till_barcode' && isAffiliate} />
                                ))}
                            </div>
                            {isBarcode ? (
                                <div className="mt-4 p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                    <div className={`${EYEBROW} mb-3`}>Barcode type your till reads</div>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        {BARCODE_FORMATS.map(f => (
                                            <button key={f.value} type="button" onClick={() => set({ barcode_format: f.value })} aria-pressed={s.barcode_format === f.value}
                                                className={`h-10 px-5 rounded-full text-[10px] font-black uppercase tracking-[0.15em] ${s.barcode_format === f.value ? 'bg-[#1A1A1A] text-[#E8D200]' : 'bg-white border border-[#E6E6E1] text-[#555]'}`}>{f.label}</button>
                                        ))}
                                    </div>
                                    <p className="text-[13px] text-[#555] leading-relaxed">
                                        Upload your codes in Promo Codes. To confirm which were used, upload the used list from your till in Promo Codes &rsaquo; Reconcile. <Link to="/partner/promo-codes" className="font-bold underline">Go to Promo Codes</Link>
                                    </p>
                                </div>
                            ) : (
                                <div className="mt-2">
                                    <Toggle on={s.requires_stand} onChange={(v) => set({ requires_stand: v })}
                                        label="Members scan your QR stand first"
                                        detail="Proves the member is in the shop before the voucher opens. Print a stand for each shop in the Sites tab." />
                                    {s.check === 'staff_scan' && (
                                        <Toggle on={s.ask_spend} onChange={(v) => set({ ask_spend: v })}
                                            label="Ask staff for the spend"
                                            detail="Staff can type what the member spent, so you see what the offer brings in. They can skip it." />
                                    )}
                                    <div className="flex items-center gap-4 flex-wrap pt-4 border-t border-[#EFEFEC]">
                                        <label htmlFor={`win-${reward.id}`} className="text-[14px] font-bold text-[#1A1A1A]">Voucher stays open for</label>
                                        <select id={`win-${reward.id}`} value={s.window_minutes} onChange={(e) => set({ window_minutes: Number(e.target.value) })}
                                            className="h-11 px-4 bg-white border border-[#E6E6E1] rounded-2xl text-sm">
                                            {[3, 5, 10].map(m => <option key={m} value={m}>{m} minutes</option>)}
                                        </select>
                                        <span className="text-[12px] text-[#888] basis-full">Opening it doesn't use it up. If time runs out the member just opens it again.</span>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {inStore && (
                        <section>
                            <h3 className={`${EYEBROW} mb-4`}>Which shops?</h3>
                            {!sites.length ? (
                                <p className="text-[13px] text-[#666]">You haven't added a shop yet. <button type="button" onClick={goSites} className="font-bold underline">Add one in Sites</button> so members see where to use it.</p>
                            ) : (
                                <div className="space-y-3">
                                    <label className="flex items-center gap-3 text-[14px] cursor-pointer">
                                        <input type="checkbox" checked={allSites} onChange={() => set({ site_ids: allSites ? sites.map(x => x.id) : null })} className="w-5 h-5 accent-[#1A1A1A]" />
                                        All shops, including ones you add later
                                    </label>
                                    {!allSites && sites.map(site => (
                                        <label key={site.id} className="flex items-center gap-3 text-[14px] cursor-pointer pl-8">
                                            <input type="checkbox" checked={s.site_ids?.includes(site.id)} onChange={() => toggleSite(site.id)} className="w-5 h-5 accent-[#1A1A1A]" />
                                            {site.name}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    <div className="flex flex-wrap gap-3 pt-2">
                        <button type="button" onClick={save} disabled={saving} className={GOLD_BTN}>{saving ? 'Saving…' : 'Save'}</button>
                        <button type="button" onClick={() => onDone(false)} className={BTN_GHOST + ' !h-11 !px-6'}>Cancel</button>
                    </div>
                </div>

                <aside className="flex-[1_1_260px] min-w-0 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-6 space-y-5">
                    <div>
                        <h3 className={`${EYEBROW} mb-4`}>What the member does</h3>
                        <ol className="space-y-3">
                            {steps.map((t, i) => (
                                <li key={t} className="flex gap-3 items-start">
                                    <span className="w-6 h-6 rounded-full bg-[#1A1A1A] text-[#E8D200] text-[11px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                                    <span className="text-[13px] leading-relaxed text-[#333] pt-0.5">{t}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
                    <div className="border-t border-[#E6E6E1] pt-5">
                        <h3 className={`${EYEBROW} mb-4`}>What your staff need</h3>
                        <ul className="space-y-2.5">
                            {needs.map(t => (
                                <li key={t} className="flex gap-2.5 items-start text-[13px] text-[#333] leading-relaxed">
                                    <Check size={14} className="text-emerald-600 mt-1 shrink-0" strokeWidth={3} />{t}
                                </li>
                            ))}
                        </ul>
                    </div>
                </aside>
            </div>
        </div>
    );
}

// ── Sites ────────────────────────────────────────────────────────────────────

function SitesTab({ brand, sites, rewards, onSaved }) {
    const toast = useToast();
    const [editing, setEditing] = useState(null); // site object, or {} for new
    const rewardsAt = (siteId) => rewards.filter(r => !r.site_ids || r.site_ids.includes(siteId));

    const rotate = async (site) => {
        if (!window.confirm(`Make a new stand for ${site.name}? The stand you printed before stops working, so print and swap the new one straight away.`)) return;
        try {
            await rotateStand(brand, site.id);
            toast.success('New stand ready to print');
            onSaved();
        } catch (err) { toast.error(err.message); }
    };

    return (
        <div className="space-y-5">
            <div className="flex justify-end">
                <button type="button" onClick={() => setEditing({})} className={GOLD_BTN}><Plus size={14} /> Add a shop</button>
            </div>
            {!sites.length && (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl py-14 px-8 text-center">
                    <MapPin size={28} className="text-[#E6E6E1] mx-auto mb-5" />
                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black">No shops yet</p>
                    <p className="text-xs text-[#999] mt-3 max-w-sm mx-auto leading-relaxed">Add each shop with its pin on the map. Members see which shops take your rewards, and each shop gets its own counter stand.</p>
                </div>
            )}
            {sites.map(site => {
                const here = rewardsAt(site.id);
                const lastScan = timeAgoShort(site.last_scan_at);
                const lastSwipe = timeAgoShort(site.last_swipe_at);
                return (
                    <article key={site.id} className="bg-white border border-[#E6E6E1] rounded-3xl p-6 md:p-8">
                        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
                            <div>
                                <h2 className="text-2xl font-light tracking-tight text-[#1A1A1A]">{site.name}</h2>
                                <p className="text-[13px] text-[#666] mt-1">{site.address || 'No address added'}</p>
                            </div>
                            {lastScan ? (
                                <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-[0.15em]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />Last scan {lastScan}
                                </span>
                            ) : lastSwipe ? (
                                <span className="px-3 py-1.5 rounded-full bg-orange-50 text-[#A93A08] text-[9px] font-black uppercase tracking-[0.15em]">Swipes but no scans yet</span>
                            ) : (
                                <span className="px-3 py-1.5 rounded-full bg-[#F4F4F1] text-[#777] text-[9px] font-black uppercase tracking-[0.15em]">No visits yet</span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <div className="flex-[1_1_220px] bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-5 flex flex-col gap-1.5">
                                <span className={EYEBROW}>Map pin</span>
                                <span className="text-[15px] font-bold">Set</span>
                                <span className="text-[13px] text-[#666]">Members within {site.radius_m} m count as in the shop.</span>
                                <button type="button" onClick={() => setEditing(site)} className="mt-1 self-start text-[10px] font-black uppercase tracking-[0.15em] text-[#6b5c00] hover:underline">Edit shop</button>
                            </div>
                            <div className="flex-[1_1_220px] bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-5 flex flex-col gap-1.5">
                                <span className={EYEBROW}>QR stand</span>
                                <span className="text-[15px] font-bold font-mono">{site.stand_code}</span>
                                <span className="text-[13px] text-[#666]">A5, for the counter. Unique to this shop.</span>
                                <div className="flex flex-wrap gap-2 mt-1">
                                    <Link to={`/partner/in-store/stand/${site.id}`} target="_blank" className={`${BTN_GHOST} inline-flex items-center gap-1.5`}><Printer size={12} /> Print stand</Link>
                                    <button type="button" onClick={() => rotate(site)} className={`${BTN_GHOST} inline-flex items-center gap-1.5`} title="Replace a lost or copied stand"><RotateCcw size={12} /> New stand</button>
                                </div>
                            </div>
                            <div className="flex-[1_1_220px] bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-5 flex flex-col gap-1.5">
                                <span className={EYEBROW}>Rewards here</span>
                                <span className="text-[15px] font-bold">{here.length ? `${here.length} in store` : 'None yet'}</span>
                                <span className="text-[13px] text-[#666]">{here.length ? here.map(r => r.title).join(' · ') : 'Turn a reward on in the Rewards tab.'}</span>
                            </div>
                        </div>
                    </article>
                );
            })}
            {editing && (
                <SiteEditor brand={brand} site={editing} onClose={() => setEditing(null)}
                    onSaved={async () => { setEditing(null); await onSaved(); }} />
            )}
        </div>
    );
}

function SiteEditor({ brand, site, onClose, onSaved }) {
    const toast = useToast();
    const isNew = !site.id;
    const [name, setName] = useState(site.name ?? '');
    const [address, setAddress] = useState(site.address ?? '');
    const [pin, setPin] = useState(site.lat != null ? { lat: site.lat, lng: site.lng } : null);
    const [radius, setRadius] = useState(site.radius_m ?? 75);
    const [paste, setPaste] = useState('');
    const [busy, setBusy] = useState(false);

    const applyPasted = (text) => {
        setPaste(text);
        const c = parseCoordinates(text);
        if (c) setPin(c);
    };
    const useHere = () => {
        if (!navigator.geolocation) { toast.error('This browser can’t share its location.'); return; }
        navigator.geolocation.getCurrentPosition(
            (p) => setPin({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }),
            () => toast.error('Couldn’t get your location. Drop the pin on the map instead.'),
            { enableHighAccuracy: true, timeout: 10000 },
        );
    };

    const save = async () => {
        if (!name.trim()) { toast.error('Give the shop a name'); return; }
        if (!pin) { toast.error('Drop a pin on the map for this shop'); return; }
        setBusy(true);
        try {
            await saveSite(brand, { id: site.id, name: name.trim(), address: address.trim() || null, lat: pin.lat, lng: pin.lng, radius_m: radius });
            toast.success(isNew ? 'Shop added' : 'Shop saved');
            onSaved();
        } catch (err) { toast.error(err.message); } finally { setBusy(false); }
    };
    const remove = async () => {
        if (!window.confirm(`Remove ${site.name}? Members stop seeing it, and its stand stops working.`)) return;
        setBusy(true);
        try { await archiveSite(brand, site.id); toast.success('Shop removed'); onSaved(); }
        catch (err) { toast.error(err.message); } finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/40 flex items-start justify-center overflow-y-auto p-4 md:p-10" role="dialog" aria-modal="true" aria-label={isNew ? 'Add a shop' : `Edit ${site.name}`}>
            <div className="w-full max-w-3xl bg-white rounded-3xl p-6 md:p-8 my-auto">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-light tracking-tight">{isNew ? 'Add a shop' : `Edit ${site.name}`}</h2>
                    <button type="button" onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-full hover:bg-[#F4F4F1] flex items-center justify-center"><X size={18} /></button>
                </div>
                <div className="grid gap-4 md:grid-cols-2 mb-4">
                    <div>
                        <label htmlFor="site-name" className={`${EYEBROW} block mb-2`}>Shop name</label>
                        <input id="site-name" className={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Shoreditch" maxLength={80} />
                    </div>
                    <div>
                        <label htmlFor="site-address" className={`${EYEBROW} block mb-2`}>Address</label>
                        <input id="site-address" className={INPUT} value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, postcode" maxLength={200} />
                    </div>
                </div>
                <div className="flex flex-wrap items-end gap-3 mb-4">
                    <div className="flex-1 min-w-[240px]">
                        <label htmlFor="site-paste" className={`${EYEBROW} block mb-2`}>Paste a Google Maps link (optional)</label>
                        <input id="site-paste" className={INPUT} value={paste} onChange={e => applyPasted(e.target.value)} placeholder="https://maps.google.com/… or 51.5246, -0.0786" />
                    </div>
                    <button type="button" onClick={useHere} className={`${BTN_GHOST} !h-14 !px-5 inline-flex items-center gap-2`}><LocateFixed size={14} /> I'm in the shop now</button>
                </div>
                <div className="rounded-2xl overflow-hidden border border-[#E6E6E1] mb-4">
                    <GeofenceMap lat={pin?.lat} lng={pin?.lng} radius={radius} label={name || 'Shop'} onMove={setPin} height={340} approach={false} />
                </div>
                <div className="flex flex-wrap items-center gap-4 mb-6">
                    <label htmlFor="site-radius" className="text-[13px] font-bold">Counts as in the shop within</label>
                    <select id="site-radius" value={radius} onChange={e => setRadius(Number(e.target.value))} className="h-11 px-4 bg-white border border-[#E6E6E1] rounded-2xl text-sm">
                        {[30, 50, 75, 100, 150, 250].map(m => <option key={m} value={m}>{m} m</option>)}
                    </select>
                    <span className="text-[12px] text-[#888]">{pin ? `Pin at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : 'Search, click the map, or paste a link to place the pin.'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={save} disabled={busy} className={GOLD_BTN}>{busy ? 'Saving…' : isNew ? 'Add shop' : 'Save shop'}</button>
                    <button type="button" onClick={onClose} className={`${BTN_GHOST} !h-11 !px-6`}>Cancel</button>
                    {!isNew && <button type="button" onClick={remove} disabled={busy} className="ml-auto inline-flex items-center gap-2 h-11 px-5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-red-600/70 hover:text-red-600 hover:bg-red-50"><Trash2 size={13} /> Remove shop</button>}
                </div>
            </div>
        </div>
    );
}

// ── Staff ────────────────────────────────────────────────────────────────────

function StaffTab({ brand, staff, sites, onSaved }) {
    const toast = useToast();
    const [name, setName] = useState('');
    const [siteId, setSiteId] = useState('');
    const [busy, setBusy] = useState(false);
    const [link, setLink] = useState(null); // { name, url }
    const siteName = (id) => sites.find(s => s.id === id)?.name;

    const add = async (e) => {
        e.preventDefault();
        if (!name.trim()) { toast.error('Add their name'); return; }
        setBusy(true);
        try {
            const res = await createStaff(brand, name.trim(), siteId || null);
            setLink({ name: name.trim(), url: staffLink(res.token) });
            setName('');
            await onSaved();
        } catch (err) { toast.error(err.message); } finally { setBusy(false); }
    };
    const reissue = async (p) => {
        if (!window.confirm(`Make a new link for ${p.name}? Their old link stops working.`)) return;
        try {
            const res = await reissueStaff(brand, p.id);
            setLink({ name: p.name, url: staffLink(res.token) });
        } catch (err) { toast.error(err.message); }
    };
    const revoke = async (p) => {
        if (!window.confirm(`Remove ${p.name}? Their scan link stops working straight away.`)) return;
        try { await revokeStaff(brand, p.id); toast.success(`${p.name} removed`); onSaved(); }
        catch (err) { toast.error(err.message); }
    };

    return (
        <div className="space-y-5">
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-6 md:p-8">
                <p className="text-[14px] text-[#555] leading-relaxed max-w-2xl mb-6">
                    Each person gets their own scan link. They open it once on their phone and it remembers them. A scan link can only check and confirm vouchers: no reports, no settings. Every scan is tied to a person and a shop.
                </p>
                <form onSubmit={add} className="flex flex-wrap items-end gap-3">
                    <div className="flex-[1_1_220px]">
                        <label htmlFor="staff-name" className={`${EYEBROW} block mb-2`}>Name</label>
                        <input id="staff-name" className={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sam" maxLength={60} />
                    </div>
                    <div className="flex-[1_1_200px]">
                        <label htmlFor="staff-site" className={`${EYEBROW} block mb-2`}>Usual shop</label>
                        <select id="staff-site" value={siteId} onChange={e => setSiteId(e.target.value)} className={INPUT}>
                            <option value="">Any shop</option>
                            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    <button type="submit" disabled={busy} className={`${BTN_DARK} !h-14 inline-flex items-center gap-2`}><Plus size={14} /> Make scan link</button>
                </form>
            </div>

            {link && (
                <div className="bg-[#FFFCE5] border-2 border-[#E8D200] rounded-3xl p-6 md:p-8" role="status">
                    <div className="flex items-start justify-between gap-4 mb-4">
                        <div>
                            <div className={EYEBROW}>Scan link for {link.name}</div>
                            <p className="text-[13px] text-[#555] mt-2 leading-relaxed">Send it to them now. For security it's only shown once; you can make a new one any time.</p>
                        </div>
                        <button type="button" onClick={() => setLink(null)} aria-label="Hide link" className="w-9 h-9 rounded-full hover:bg-white flex items-center justify-center shrink-0"><X size={16} /></button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <code className="flex-1 min-w-0 break-all px-4 py-3 bg-white border border-[#E6E6E1] rounded-2xl text-[12px]">{link.url}</code>
                        <button type="button" onClick={() => copyText(link.url, toast, 'Link copied')} className={GOLD_BTN}><Copy size={13} /> Copy</button>
                    </div>
                </div>
            )}

            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-6 md:p-8">
                <h2 className={`${EYEBROW} mb-2`}>Staff with a scan link</h2>
                {!staff.length ? (
                    <p className="text-[13px] text-[#888] py-6">Nobody yet. Signed-in portal users can always scan from powr.life/scan.</p>
                ) : staff.map(p => (
                    <div key={p.id} className="flex flex-wrap items-center gap-4 py-4 border-t border-[#EFEFEC] first:border-0">
                        <div className="w-10 h-10 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[12px] font-black uppercase">{p.name.slice(0, 2)}</div>
                        <div className="flex-[1_1_160px] min-w-0">
                            <div className="text-[15px] font-bold">{p.name}</div>
                            <div className="text-[12px] text-[#666]">{siteName(p.site_id) ?? 'Any shop'}</div>
                        </div>
                        <span className="text-[12px] text-[#666]">{p.last_scan_at ? `Last scan ${timeAgoShort(p.last_scan_at)}` : p.last_seen_at ? 'Link opened, no scans yet' : 'Link not opened yet'}</span>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => reissue(p)} className={`${BTN_GHOST} inline-flex items-center gap-1.5`}><KeyRound size={12} /> New link</button>
                            <button type="button" onClick={() => revoke(p)} className={`${BTN_GHOST} inline-flex items-center gap-1.5 hover:!text-red-600`}><Trash2 size={12} /> Remove</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Scan page ────────────────────────────────────────────────────────────────

function ScanTab() {
    const toast = useToast();
    const url = scanPageUrl();
    return (
        <div className="flex flex-wrap gap-5">
            <div className="flex-[1_1_320px] bg-white border border-[#E6E6E1] rounded-3xl p-6 md:p-8 flex flex-col gap-4">
                <div className="flex items-center gap-3"><Smartphone size={16} className="text-[#999]" /><span className={EYEBROW}>On a phone</span></div>
                <div className="flex items-center gap-3 px-4 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                    <span className="flex-1 text-[15px] font-bold truncate">{url.replace(/^https?:\/\//, '')}</span>
                    <button type="button" onClick={() => copyText(url, toast, 'Link copied')} className={BTN_GHOST}>Copy</button>
                </div>
                <p className="text-[14px] text-[#555] leading-relaxed">Staff open their own scan link once and they're set. You can open it here too while you're signed in.</p>
                <a href="/scan" target="_blank" rel="noreferrer" className={`${BTN_DARK} self-start inline-flex items-center gap-2`}>Open scan page <ExternalLink size={12} /></a>
            </div>
            <div className="flex-[1_1_320px] bg-white border border-[#E6E6E1] rounded-3xl p-6 md:p-8 flex flex-col gap-4">
                <div className="flex items-center gap-3"><Monitor size={16} className="text-[#999]" /><span className={EYEBROW}>On a tablet at the till</span></div>
                <p className="text-[14px] text-[#555] leading-relaxed">
                    Kiosk mode does two jobs. It shows a QR that changes every 30 seconds for members to scan, and it scans members' vouchers with the front camera. It also shows today's tally.
                </p>
                <a href="/scan?kiosk=1" target="_blank" rel="noreferrer" className={`${GOLD_BTN} self-start`}>Open kiosk mode <ExternalLink size={12} /></a>
            </div>
        </div>
    );
}
