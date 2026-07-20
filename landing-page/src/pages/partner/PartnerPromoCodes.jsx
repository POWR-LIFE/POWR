import React, { useEffect, useRef, useState } from 'react';
import { Ticket, Upload, FileText, Download, X, ChevronDown, Check, Search, CalendarClock, Edit2, AlertTriangle, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { ChangeMethodLink, GuideLink, StageStrip } from './integrationShared';
import {
    parseCodes,
    parseReconciliationCodes,
    uploadCodes,
    generateCodes,
    toggleCodeStatus,
    fetchCodePool,
    fetchAllCodes,
    fetchCodeStatsDirect,
    fetchExpiryOutlook,
    updateCodeExpiry,
    bulkUpdateExpiry,
    buildScheme,
    getCSVTemplate,
    getSchemeCSVTemplate,
} from '../../lib/promoCodes';

const CODE_POOL_PAGE_SIZE = 25;
const STATUS_FILTERS = ['all', 'available', 'reserved', 'used', 'expired'];

const STATUS_COLOR = {
    available: 'text-[#10B981]',
    reserved: 'text-[#8a7600]',
    used: 'text-[#0EA5E9]',
    expired: 'text-[#999999]',
};

const fmtDate = (d) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';

export default function PartnerPromoCodes() {
    const toast = useToast();
    const { partnerData, deliveryMethod } = useAuth();
    const brand = partnerData?.brand_name;

    const [rewards, setRewards] = useState([]);
    const [availByReward, setAvailByReward] = useState({});
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);

    // Code-pool state for the selected reward
    const [codeStats, setCodeStats] = useState(null);
    const [codeWorkspaceMode, setCodeWorkspaceMode] = useState('manage');
    const [schemeExample, setSchemeExample] = useState('');
    const [generateCount, setGenerateCount] = useState(100);
    const [generatingCodes, setGeneratingCodes] = useState(false);
    const [singleCode, setSingleCode] = useState('');
    const [bulkCodesText, setBulkCodesText] = useState('');
    const [uploadingCodes, setUploadingCodes] = useState(false);
    const [reconciliationText, setReconciliationText] = useState('');
    const [reconciling, setReconciling] = useState(false);
    const [codePool, setCodePool] = useState({ rows: [], total: 0 });
    const [codePoolPage, setCodePoolPage] = useState(0);
    const [codePoolStatus, setCodePoolStatus] = useState('all');
    const [codePoolLoading, setCodePoolLoading] = useState(false);
    const [togglingCodeId, setTogglingCodeId] = useState(null);
    const [codeSearch, setCodeSearch] = useState('');
    const [selectorOpen, setSelectorOpen] = useState(false);
    const selectorRef = useRef(null);

    // Expiry controls — mirrors the admin RewardManager pool tools.
    const [batchExpiry, setBatchExpiry] = useState('');        // YYYY-MM-DD for new generate/upload batches ('' = reward default)
    const [bulkExpiry, setBulkExpiry] = useState('');          // YYYY-MM-DD for the bulk pool set
    const [applyingBulkExpiry, setApplyingBulkExpiry] = useState(false);
    const [editingExpiryId, setEditingExpiryId] = useState(null); // per-row inline editor
    const [editingExpiryVal, setEditingExpiryVal] = useState('');
    const [savingExpiryId, setSavingExpiryId] = useState(null);
    const [expiryOutlook, setExpiryOutlook] = useState(null);

    const parsedScheme = schemeExample ? buildScheme(schemeExample) : null;
    const selectedReward = rewards.find(r => r.id === selectedId) ?? null;

    // A date input yields 'YYYY-MM-DD'. Store expiry at end of that local day so
    // the code stays valid through the whole chosen date (claim checks expires_at > now()).
    const expiryInputToISO = (dateStr) => (dateStr ? new Date(`${dateStr}T23:59:59`).toISOString() : null);
    // Convert a stored timestamp back to the local 'YYYY-MM-DD' a date input expects.
    const toDateInputValue = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    };

    // Close the reward dropdown on outside click
    useEffect(() => {
        if (!selectorOpen) return;
        const onDown = (e) => {
            if (selectorRef.current && !selectorRef.current.contains(e.target)) setSelectorOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [selectorOpen]);

    useEffect(() => {
        if (!brand) return;
        fetchRewards();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [brand]);

    // Debounced server-side code search — re-query page 0, keeping the status filter.
    useEffect(() => {
        if (!selectedId) return;
        const t = setTimeout(() => refreshCodePool(selectedId, 0, codePoolStatus, codeSearch), 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [codeSearch]);

    const fetchRewards = async () => {
        setLoading(true);
        // Code pools only apply to digital, non-affiliate rewards (mirrors admin gating).
        const { data } = await supabase
            .from('rewards')
            .select('id, title, image_url, active, reward_kind, integration_type')
            .ilike('brand_name', brand)
            .order('created_at', { ascending: false });
        const eligible = (data ?? []).filter(
            r => r.reward_kind !== 'physical' && r.integration_type !== 'AFFILIATE'
        );
        setRewards(eligible);

        // Lightweight available-count badge per reward (head-only counts).
        // Filter out date-lapsed codes so the badge matches what users can claim.
        const nowIso = new Date().toISOString();
        const counts = await Promise.all(
            eligible.map(r =>
                supabase
                    .from('redemption_codes')
                    .select('id', { count: 'exact', head: true })
                    .eq('reward_id', r.id)
                    .eq('status', 'available')
                    .gt('expires_at', nowIso)
                    .then(({ count }) => [r.id, count ?? 0])
            )
        );
        setAvailByReward(Object.fromEntries(counts));

        if (eligible.length > 0) selectReward(eligible[0]);
        setLoading(false);
    };

    const refreshCodeStats = async (rewardId) => {
        try {
            const stats = await fetchCodeStatsDirect(rewardId);
            setCodeStats(stats);
            setAvailByReward(prev => ({ ...prev, [rewardId]: stats.available }));
            // Empty pool → the only useful thing to do is add codes, so open
            // the workspace straight on that mode (step 2 of the stage strip).
            if (stats.available + stats.reserved + stats.used + stats.expired === 0) {
                setCodeWorkspaceMode('add');
            }
        } catch {
            setCodeStats(null);
        }
        try {
            setExpiryOutlook(await fetchExpiryOutlook(rewardId));
        } catch {
            setExpiryOutlook(null);
        }
    };

    const refreshCodePool = async (rewardId, page = 0, status = codePoolStatus, search = codeSearch) => {
        setCodePoolLoading(true);
        setCodePoolStatus(status);
        setCodePoolPage(page);
        try {
            const result = await fetchCodePool({ rewardId, status, page, search, pageSize: CODE_POOL_PAGE_SIZE });
            setCodePool(result);
        } catch (err) {
            toast.error(err.message || 'Could not load codes');
            setCodePool({ rows: [], total: 0 });
        } finally {
            setCodePoolLoading(false);
        }
    };

    const selectReward = (reward) => {
        setSelectedId(reward.id);
        setBulkCodesText('');
        setReconciliationText('');
        setSingleCode('');
        setGenerateCount(100);
        setCodePoolPage(0);
        setCodePoolStatus('all');
        setCodeSearch('');
        setBatchExpiry('');
        setBulkExpiry('');
        setEditingExpiryId(null);
        setExpiryOutlook(null);
        setCodeWorkspaceMode('manage');
        // Reuse the scheme hint shared with the admin manager.
        const savedScheme = localStorage.getItem(`powr_scheme_${reward.id}`);
        setSchemeExample(savedScheme || '');
        refreshCodeStats(reward.id);
        refreshCodePool(reward.id, 0, 'all', '');
    };

    const handleSchemeChange = (value) => {
        const v = value.toUpperCase();
        setSchemeExample(v);
        if (!selectedId) return;
        if (v) localStorage.setItem(`powr_scheme_${selectedId}`, v);
        else localStorage.removeItem(`powr_scheme_${selectedId}`);
    };

    const handleGenerate = async () => {
        if (!selectedReward) return;
        if (!generateCount || generateCount < 1) return;
        setGeneratingCodes(true);
        try {
            const result = await generateCodes({ rewardId: selectedReward.id, count: generateCount, scheme: parsedScheme || undefined, expiresAt: expiryInputToISO(batchExpiry) || undefined });
            toast.success(`${result.generated} codes generated${result.duplicatesSkipped ? ` · ${result.duplicatesSkipped} skipped (duplicates)` : ''}`);
            await refreshCodeStats(selectedReward.id);
            await refreshCodePool(selectedReward.id, 0, codePoolStatus);
        } catch (err) {
            toast.error(err.message || 'Generation failed');
        } finally {
            setGeneratingCodes(false);
        }
    };

    const handleBulkUpload = async () => {
        if (!selectedReward) return;
        const codes = parseCodes(bulkCodesText);
        if (codes.length === 0) { toast.error('No codes detected'); return; }
        setUploadingCodes(true);
        try {
            const result = await uploadCodes({ rewardId: selectedReward.id, codes, scheme: parsedScheme || undefined, expiresAt: expiryInputToISO(batchExpiry) || undefined });
            const parts = [`${result.accepted} added`];
            if (result.alreadyInPool) parts.push(`${result.alreadyInPool} already in pool`);
            if (result.rejected.length) parts.push(`${result.rejected.length} rejected`);
            toast.success(parts.join(' · '));
            if (result.rejected.length) console.warn('Rejected codes:', result.rejected);
            setBulkCodesText('');
            await refreshCodeStats(selectedReward.id);
            await refreshCodePool(selectedReward.id, 0, codePoolStatus);
        } catch (err) {
            toast.error(err.message || 'Upload failed');
        } finally {
            setUploadingCodes(false);
        }
    };

    const handleBulkFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            setBulkCodesText(prev => (prev ? prev + '\n' + text : text));
            toast.success(`Loaded ${file.name}`);
        } catch {
            toast.error('Could not read file');
        } finally {
            e.target.value = '';
        }
    };

    const handleReconciliationFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            setReconciliationText(text);
            toast.success(`Loaded ${file.name}`);
        } catch {
            toast.error('Could not read file');
        } finally {
            e.target.value = '';
        }
    };

    const handleReconcile = async () => {
        if (!selectedReward) return;
        const codes = parseReconciliationCodes(reconciliationText);
        if (!codes.length) { toast.error('No codes detected'); return; }
        if (!window.confirm(`Reconcile ${codes.length} store redemption${codes.length === 1 ? '' : 's'}? Only codes already assigned by POWR can be marked used.`)) return;
        setReconciling(true);
        try {
            const { data, error } = await supabase.rpc('reconcile_partner_redemption_codes', {
                p_reward_id: selectedReward.id,
                p_codes: codes,
            });
            if (error) throw error;
            const result = data?.[0] ?? {};
            const parts = [`${result.marked_used_count ?? 0} marked used`];
            if (result.already_used_count) parts.push(`${result.already_used_count} already reconciled`);
            if (result.unavailable_count) parts.push(`${result.unavailable_count} not assigned`);
            if ((result.submitted_count ?? 0) > (result.matched_count ?? 0)) parts.push(`${result.submitted_count - result.matched_count} not in this pool`);
            toast.success(parts.join(' · '));
            setReconciliationText('');
            await refreshCodeStats(selectedReward.id);
            await refreshCodePool(selectedReward.id, 0, codePoolStatus);
        } catch (err) {
            toast.error(err.message || 'Reconciliation failed');
        } finally {
            setReconciling(false);
        }
    };

    const handleAddSingleCode = async () => {
        if (!selectedReward || !singleCode.trim()) return;
        setUploadingCodes(true);
        try {
            const result = await uploadCodes({ rewardId: selectedReward.id, codes: [singleCode], scheme: parsedScheme || undefined, expiresAt: expiryInputToISO(batchExpiry) || undefined });
            if (result.accepted === 1) {
                toast.success('Code added');
                setSingleCode('');
                await refreshCodeStats(selectedReward.id);
                await refreshCodePool(selectedReward.id, 0, codePoolStatus);
            } else if (result.alreadyInPool) {
                toast.success('Code already in pool');
            } else {
                toast.error(`Rejected: ${result.rejected[0]?.reason || 'invalid'}`);
            }
        } catch (err) {
            toast.error(err.message || 'Failed');
        } finally {
            setUploadingCodes(false);
        }
    };

    const handleToggleCodeStatus = async (row) => {
        if (togglingCodeId === row.id) return;
        setTogglingCodeId(row.id);
        try {
            const newStatus = await toggleCodeStatus(row.id, row.status);
            setCodePool(prev => ({ ...prev, rows: prev.rows.map(r => r.id === row.id ? { ...r, status: newStatus } : r) }));
            await refreshCodeStats(selectedReward.id);
        } catch (err) {
            toast.error(err.message || 'Toggle failed');
        } finally {
            setTogglingCodeId(null);
        }
    };

    // Apply one expiry date to every code matching the current ledger filter.
    const handleBulkExpiry = async () => {
        if (!selectedReward) return;
        if (!bulkExpiry) { toast.error('Pick a date first'); return; }
        const scope = codePoolStatus === 'all' ? 'all codes' : `${codePoolStatus} codes`;
        const pretty = new Date(`${bulkExpiry}T23:59:59`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        if (!window.confirm(`Set expiry to ${pretty} for ${scope} in this pool?`)) return;
        setApplyingBulkExpiry(true);
        try {
            const { updated } = await bulkUpdateExpiry({ rewardId: selectedReward.id, expiresAt: expiryInputToISO(bulkExpiry), status: codePoolStatus });
            toast.success(`Expiry updated on ${updated} code${updated === 1 ? '' : 's'}`);
            setBulkExpiry('');
            await refreshCodeStats(selectedReward.id);
            await refreshCodePool(selectedReward.id, codePoolPage, codePoolStatus);
        } catch (err) {
            toast.error(err.message || 'Bulk update failed');
        } finally {
            setApplyingBulkExpiry(false);
        }
    };

    const beginEditExpiry = (row) => {
        setEditingExpiryId(row.id);
        setEditingExpiryVal(toDateInputValue(row.expires_at));
    };

    const handleSaveExpiry = async (row) => {
        if (!editingExpiryVal) { setEditingExpiryId(null); return; }
        setSavingExpiryId(row.id);
        try {
            const iso = await updateCodeExpiry(row.id, expiryInputToISO(editingExpiryVal));
            setCodePool(prev => ({ ...prev, rows: prev.rows.map(r => r.id === row.id ? { ...r, expires_at: iso } : r) }));
            setEditingExpiryId(null);
            toast.success('Expiry updated');
            await refreshCodeStats(selectedReward.id);
        } catch (err) {
            toast.error(err.message || 'Update failed');
        } finally {
            setSavingExpiryId(null);
        }
    };

    const handleDownloadTemplate = () => {
        const csv = parsedScheme ? getSchemeCSVTemplate(parsedScheme) : getCSVTemplate('XXXX');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'POWR-codes-template.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadCodes = async (format) => {
        if (!selectedReward) return;
        try {
            const rows = await fetchAllCodes({ rewardId: selectedReward.id, status: codePoolStatus, search: codeSearch });
            const fmt = d => d ? new Date(d).toISOString().slice(0, 10) : '';
            const data = rows.map(r => ({
                Code: r.code,
                Status: r.status,
                'Claimed At': fmt(r.assigned_at),
                'Used At': fmt(r.used_at),
                'Expires At': fmt(r.expires_at),
                'Created At': fmt(r.created_at),
            }));
            const slug = (selectedReward.title || 'codes').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            const suffix = codePoolStatus !== 'all' ? `-${codePoolStatus}` : '';
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Codes');
            if (format === 'xlsx') XLSX.writeFile(wb, `POWR-${slug}${suffix}-codes.xlsx`);
            else XLSX.writeFile(wb, `POWR-${slug}${suffix}-codes.csv`, { bookType: 'csv' });
            toast.success(`${rows.length} codes exported`);
        } catch (err) {
            toast.error(err.message || 'Export failed');
        }
    };

    // ── Staged setup — per selected reward, derived from live pool state ──
    const poolTotal = codeStats
        ? codeStats.available + codeStats.reserved + codeStats.used + codeStats.expired
        : 0;
    const stageSteps = [
        {
            label: 'Pick a reward',
            done: !!selectedReward,
            hint: 'Choose which reward these codes unlock — each reward keeps its own pool.',
        },
        {
            label: 'Load codes',
            done: poolTotal > 0,
            hint: 'Generate a batch right here or upload the codes from your store — either takes under a minute.',
        },
        {
            label: 'Members redeem',
            done: poolTotal > 0 && (codeStats?.available ?? 0) > 0 && !!selectedReward?.active,
            hint: !selectedReward?.active && poolTotal > 0
                ? 'Codes are ready — once this reward goes live in the app, members draw from the pool automatically.'
                : poolTotal > 0 && (codeStats?.available ?? 0) === 0
                    ? 'The pool has run dry — top it up so members can keep redeeming.'
                    : 'POWR hands a code to each member automatically when they redeem — nothing else to set up.',
        },
    ];

    // ── Render ────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center py-32">
                <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#E8D200]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Code Management</span>
                </div>
                <div className="flex items-end justify-between gap-6 flex-wrap">
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">Promo Codes</h1>
                    <div className="flex items-center gap-3">
                        <ChangeMethodLink />
                        <GuideLink method="manual" />
                    </div>
                </div>
                <p className="text-[12px] text-[#AAAAAA] font-black mt-3 max-w-xl">
                    Upload the discount codes from your store, or let POWR mint them. Members draw one from the pool when they redeem.
                </p>
                {deliveryMethod && deliveryMethod !== 'manual' && (
                    <div className="mt-5 p-4 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-2xl text-[11px] text-[#8a7600] font-bold max-w-xl leading-relaxed">
                        You deliver codes via {deliveryMethod === 'api' ? 'the API' : 'Shopify'} — codes loaded
                        here act as a fallback buffer if your integration is ever unavailable at redemption time.
                    </div>
                )}
            </div>

            {rewards.length === 0 ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl py-20 text-center">
                    <Ticket size={28} className="text-[#E6E6E1] mx-auto mb-4" />
                    <p className="text-[11px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">No digital rewards yet</p>
                    <p className="text-[11px] text-[#CCCCCC] font-black mt-2">Create a digital reward first — its code pool will appear here.</p>
                </div>
            ) : (
                <>
                    <StageStrip
                        steps={stageSteps}
                        doneHint="This reward is live — POWR hands a code to each member automatically. Reconcile used codes or top up the pool anytime below."
                    />

                    {/* Reward selector — dropdown */}
                    <div className="mb-8 relative max-w-2xl" ref={selectorRef}>
                        <span className="block text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">Your Rewards</span>
                        <button
                            type="button"
                            onClick={() => setSelectorOpen(o => !o)}
                            className="w-full flex items-center gap-4 h-16 px-5 bg-white border border-[#E6E6E1] rounded-2xl text-left hover:border-[#E8D200]/40 transition-all"
                        >
                            {selectedReward?.image_url ? (
                                <img src={selectedReward.image_url} alt="" className="w-9 h-9 rounded-xl object-contain bg-[#1a1a1a] p-1 shrink-0" />
                            ) : (
                                <div className="w-9 h-9 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0">
                                    {selectedReward?.title?.[0] ?? '?'}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{selectedReward?.title || 'Select a reward'}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {selectedReward && !selectedReward.active && <span className="text-[8px] uppercase tracking-[0.2em] text-[#BBB] font-black px-1.5 py-0.5 bg-[#F4F4F1] rounded">Inactive</span>}
                                    <span className={`text-[9px] uppercase tracking-[0.2em] font-black ${(availByReward[selectedId] ?? 0) > 0 ? 'text-[#10B981]' : 'text-[#CCCCCC]'}`}>{availByReward[selectedId] ?? 0} available</span>
                                </div>
                            </div>
                            <ChevronDown size={16} className={`text-[#BBBBBB] shrink-0 transition-transform ${selectorOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {selectorOpen && (
                            <div className="absolute z-30 left-0 right-0 mt-2 bg-white border border-[#E6E6E1] rounded-2xl shadow-2xl overflow-hidden">
                                <div className="divide-y divide-[#F4F4F1] max-h-[60vh] overflow-y-auto">
                                {rewards.map(r => {
                                    const active = r.id === selectedId;
                                    const avail = availByReward[r.id] ?? 0;
                                    return (
                                        <button
                                            key={r.id}
                                            type="button"
                                            onClick={() => { selectReward(r); setSelectorOpen(false); }}
                                            className={`w-full flex items-center gap-4 px-6 py-4 text-left transition-colors ${active ? 'bg-[#E8D200]/10' : 'hover:bg-[#FAFAFA]'}`}
                                        >
                                            {r.image_url ? (
                                                <img src={r.image_url} alt="" className="w-9 h-9 rounded-xl object-contain bg-[#1a1a1a] p-1 shrink-0" />
                                            ) : (
                                                <div className="w-9 h-9 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0">
                                                    {r.title?.[0] ?? '?'}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-[13px] font-bold truncate ${active ? 'text-[#1A1A1A]' : 'text-[#444]'}`}>{r.title || 'Untitled reward'}</div>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    {!r.active && <span className="text-[8px] uppercase tracking-[0.2em] text-[#BBB] font-black px-1.5 py-0.5 bg-[#F4F4F1] rounded">Inactive</span>}
                                                    <span className={`text-[9px] uppercase tracking-[0.2em] font-black ${avail > 0 ? 'text-[#10B981]' : 'text-[#CCCCCC]'}`}>{avail} available</span>
                                                </div>
                                            </div>
                                            {active && <Check size={15} className="text-[#8a7600] shrink-0" />}
                                        </button>
                                    );
                                })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Code pool manager — full width */}
                    <div>
                        {selectedReward && (
                            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                                {/* Header + stats */}
                                <div className="flex flex-wrap items-center justify-between gap-4 px-8 pt-8 pb-4">
                                    <div className="flex items-center gap-4">
                                        <Ticket size={16} className="text-[#8a7600]" />
                                        <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">Code Pool</span>
                                        {codeStats && (
                                            <div className="flex items-center gap-5 ml-2 text-[10px] uppercase tracking-[0.3em] font-black">
                                                <span className="text-[#10B981]">{codeStats.available} avail</span>
                                                <span className="text-[#8a7600]">{codeStats.reserved} reserved</span>
                                                <span className="text-[#555555]">{codeStats.used} used</span>
                                                <span className="text-[#999999]">{codeStats.expired} exp</span>
                                            </div>
                                        )}
                                        {expiryOutlook?.expiringSoon > 0 && (
                                            <span className="flex items-center gap-2 px-3 py-1.5 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-full text-[9px] uppercase tracking-[0.25em] text-[#B45309] font-black">
                                                <AlertTriangle size={11} />
                                                {expiryOutlook.expiringSoon} expire by {fmtDate(expiryOutlook.soonestExpiry)} — extend below
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {codeWorkspaceMode === 'add' && <button type="button" onClick={handleDownloadTemplate} className="flex items-center gap-2 h-9 px-5 bg-[#F4F4F1] border border-[#E8D200]/20 rounded-full text-[9px] uppercase tracking-[0.3em] text-[#8a7600] hover:bg-[#E8D200]/5 transition-all font-black"><FileText size={11} /> Template</button>}
                                        <div className="flex bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-1 gap-1">
                                            {[['add', 'Add codes'], ['reconcile', 'Reconcile'], ['manage', 'Manage pool']].map(([mode, label]) => <button key={mode} type="button" onClick={() => setCodeWorkspaceMode(mode)} className={`h-8 px-3 rounded-xl text-[9px] uppercase tracking-[0.18em] font-black transition-all ${codeWorkspaceMode === mode ? 'bg-[#E8D200] text-[#080808]' : 'text-[#888] hover:text-[#333]'}`}>{label}</button>)}
                                        </div>
                                    </div>
                                </div>

                                {/* Code format builder */}
                                <div className={codeWorkspaceMode === 'add' ? 'px-8 py-5 border-b border-[#E6E6E1]' : 'hidden'}>
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">Code Format</div>
                                    <div className="flex gap-3 items-center">
                                        <input
                                            type="text"
                                            placeholder="Enter one example code to define the format — e.g. POWR-BRAND-ABC123"
                                            className="flex-1 h-11 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[11px] font-mono text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none uppercase tracking-[0.05em]"
                                            value={schemeExample}
                                            onChange={e => handleSchemeChange(e.target.value)}
                                        />
                                        {schemeExample && (
                                            <button
                                                type="button"
                                                onClick={() => handleSchemeChange('')}
                                                className="h-11 w-11 flex items-center justify-center bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#999999] hover:text-[#666666] transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                    {parsedScheme && (
                                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black">Detected:</span>
                                            {parsedScheme.segments.map((seg, i) => (
                                                <React.Fragment key={i}>
                                                    {i > 0 && <span className="text-[#AAAAAA] text-xs font-mono">-</span>}
                                                    <span className={`font-mono text-[11px] rounded-lg px-3 py-1 border ${seg.fixed ? 'text-[#8a7600] bg-[#E8D200]/5 border-[#E8D200]/20' : 'text-[#10B981] bg-[#10B981]/5 border-[#10B981]/20'}`}>
                                                        {seg.fixed ? seg.value : seg.pattern}
                                                    </span>
                                                </React.Fragment>
                                            ))}
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black ml-2">· gold = fixed · green = variable</span>
                                        </div>
                                    )}
                                    {schemeExample && !parsedScheme && (
                                        <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-red-400 font-black">
                                            Must start with POWR- and contain only A–Z, 0–9, and dashes
                                        </p>
                                    )}
                                    {!schemeExample && (
                                        <p className="mt-2 text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">
                                            Leave blank to use the default POWR-XXXX-XXXXXX (6-char) format
                                        </p>
                                    )}
                                </div>

                                {/* New-batch expiry — applies to codes added via generate / upload / single-add below */}
                                <div className="px-8 py-5 border-b border-[#E6E6E1]">
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">New Codes Expire</div>
                                    <div className="flex gap-3 items-center flex-wrap">
                                        <div className="relative">
                                            <CalendarClock size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#BBBBBB] pointer-events-none" />
                                            <input
                                                type="date"
                                                value={batchExpiry}
                                                min={new Date().toISOString().slice(0, 10)}
                                                onChange={e => setBatchExpiry(e.target.value)}
                                                className="h-11 pl-10 pr-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[12px] text-[#222222] focus:border-[#E8D200]/40 outline-none"
                                            />
                                        </div>
                                        {batchExpiry && (
                                            <button
                                                type="button"
                                                onClick={() => setBatchExpiry('')}
                                                className="h-11 w-11 flex items-center justify-center bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#999999] hover:text-[#666666] transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                        <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">
                                            {batchExpiry ? 'applied to new batches below' : 'blank = default 90-day expiry'}
                                        </span>
                                    </div>
                                </div>

                                {/* Auto-generate */}
                                <div className={codeWorkspaceMode === 'add' ? 'px-8 py-5 border-b border-[#E6E6E1]' : 'hidden'}>
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">Auto-Generate</div>
                                    <div className="flex flex-wrap gap-3 items-center">
                                        <input
                                            type="number"
                                            min="1"
                                            max="5000"
                                            value={generateCount}
                                            onChange={e => setGenerateCount(Math.max(1, Math.min(5000, parseInt(e.target.value) || 1)))}
                                            className="w-28 h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[13px] font-light text-[#8a7600] text-center focus:border-[#E8D200]/40 outline-none"
                                        />
                                        <span className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black">codes</span>
                                        <button
                                            type="button"
                                            onClick={handleGenerate}
                                            disabled={generatingCodes}
                                            className="h-11 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-2px] disabled:opacity-40"
                                        >
                                            {generatingCodes ? 'Generating...' : 'Generate Batch'}
                                        </button>
                                        <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">
                                            using {parsedScheme ? `${parsedScheme.prefix}•••` : 'default POWR format'}
                                        </span>
                                    </div>
                                </div>

                                {/* Upload */}
                                <div className={codeWorkspaceMode === 'add' ? 'px-8 pb-6 pt-5 border-b border-[#E6E6E1]' : 'hidden'}>
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">Upload Your Codes</div>
                                    <div className="flex flex-wrap gap-3 mb-3">
                                        <input
                                            type="text"
                                            placeholder={parsedScheme ? `${parsedScheme.prefix}XXXXXX  (single code)` : 'POWR-BRAND-XXXXXX  (single code)'}
                                            className="flex-1 min-w-[200px] h-11 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[11px] font-mono text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none uppercase tracking-[0.05em]"
                                            value={singleCode}
                                            onChange={e => setSingleCode(e.target.value.toUpperCase())}
                                        />
                                        <button type="button" onClick={handleAddSingleCode} disabled={uploadingCodes || !singleCode.trim()} className="h-11 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#222222] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black disabled:opacity-40">Add</button>
                                        <label className="flex items-center gap-2 h-11 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#333333] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black cursor-pointer whitespace-nowrap">
                                            <Upload size={12} /> Upload CSV
                                            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleBulkFile} />
                                        </label>
                                    </div>
                                    <textarea
                                        rows={3}
                                        placeholder={'Paste codes or drop a CSV — Status + Deleted at columns are respected automatically'}
                                        className="w-full p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl focus:border-[#E8D200]/40 outline-none transition-all text-xs font-mono text-[#222222] placeholder-[#BBBBBB] resize-none"
                                        value={bulkCodesText}
                                        onChange={e => setBulkCodesText(e.target.value)}
                                    />
                                    <div className="flex justify-between items-center mt-3">
                                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black">
                                            {parseCodes(bulkCodesText).length} codes detected
                                        </span>
                                        <button type="button" onClick={handleBulkUpload} disabled={uploadingCodes || !bulkCodesText.trim()} className="h-11 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-2px] disabled:opacity-40">
                                            {uploadingCodes ? 'Uploading...' : 'Upload Batch'}
                                        </button>
                                    </div>
                                </div>

                                {/* Reconcile store-side redemptions */}
                                <div className={codeWorkspaceMode === 'reconcile' ? 'px-8 pb-6 pt-5 border-b border-[#E6E6E1] bg-[#E8D200]/[0.025]' : 'hidden'}>
                                    <div className="flex items-start justify-between gap-4 mb-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.4em] text-[#8a7600] font-black">
                                                <RefreshCw size={12} /> Reconcile store redemptions
                                            </div>
                                            <p className="text-[11px] text-[#888] mt-2 max-w-2xl leading-relaxed">
                                                Paste or upload the codes your store reports as redeemed. POWR marks only codes already assigned to a member as used; unassigned, expired, and unknown codes stay unchanged.
                                            </p>
                                        </div>
                                        <label className="flex items-center gap-2 h-10 px-5 bg-white border border-[#E6E6E1] rounded-full text-[9px] uppercase tracking-[0.25em] text-[#555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black cursor-pointer whitespace-nowrap">
                                            <Upload size={11} /> Import CSV
                                            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleReconciliationFile} />
                                        </label>
                                    </div>
                                    <textarea
                                        rows={3}
                                        placeholder="Paste a code list or a CSV with a Code column"
                                        className="w-full p-4 bg-white border border-[#E6E6E1] rounded-2xl focus:border-[#E8D200]/40 outline-none transition-all text-xs font-mono text-[#222] placeholder-[#BBB] resize-none"
                                        value={reconciliationText}
                                        onChange={e => setReconciliationText(e.target.value)}
                                    />
                                    <div className="flex justify-between items-center mt-3 gap-4">
                                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#999] font-black">
                                            {parseReconciliationCodes(reconciliationText).length} codes detected
                                        </span>
                                        <button type="button" onClick={handleReconcile} disabled={reconciling || !reconciliationText.trim()} className="flex items-center gap-2 h-11 px-7 bg-[#1A1A1A] text-white text-[10px] uppercase tracking-[0.25em] rounded-full transition-all hover:bg-[#333] disabled:opacity-40 font-black">
                                            <RefreshCw size={13} className={reconciling ? 'animate-spin' : ''} /> {reconciling ? 'Reconciling...' : 'Reconcile Used Codes'}
                                        </button>
                                    </div>
                                </div>

                                {/* Ledger */}
                                <div className={codeWorkspaceMode === 'manage' ? 'px-6 py-5' : 'hidden'}>
                                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                        <div className="flex items-center gap-4">
                                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black whitespace-nowrap">
                                                Ledger {codePool.total > 0 && `· ${codePool.total} total`}
                                            </span>
                                            {codePool.total > 0 && (
                                                <div className="flex gap-2">
                                                    <button type="button" onClick={() => handleDownloadCodes('csv')} className="flex items-center gap-1.5 h-7 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] uppercase tracking-[0.3em] text-[#555555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black">
                                                        <Download size={10} /> CSV
                                                    </button>
                                                    <button type="button" onClick={() => handleDownloadCodes('xlsx')} className="flex items-center gap-1.5 h-7 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] uppercase tracking-[0.3em] text-[#555555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black">
                                                        <Download size={10} /> Excel
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-1 gap-1">
                                            {STATUS_FILTERS.map(s => (
                                                <button
                                                    key={s}
                                                    type="button"
                                                    onClick={() => refreshCodePool(selectedReward.id, 0, s)}
                                                    className={`h-7 px-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all ${codePoolStatus === s ? 'bg-[#E8D200] text-[#080808]' : 'text-[#888888] hover:text-[#333333]'}`}
                                                >
                                                    {s}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Bulk expiry — sets one date across every code matching the current filter */}
                                    {codePool.total > 0 && (
                                        <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 bg-[#FBFBF8] border border-[#E6E6E1] rounded-2xl">
                                            <CalendarClock size={14} className="text-[#8a7600]" />
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black">
                                                Set expiry for {codePoolStatus === 'all' ? 'all codes' : `${codePoolStatus} codes`}
                                            </span>
                                            <input
                                                type="date"
                                                value={bulkExpiry}
                                                min={new Date().toISOString().slice(0, 10)}
                                                onChange={e => setBulkExpiry(e.target.value)}
                                                className="h-9 px-4 bg-white border border-[#E6E6E1] rounded-full text-[12px] text-[#222222] focus:border-[#E8D200]/40 outline-none"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleBulkExpiry}
                                                disabled={!bulkExpiry || applyingBulkExpiry}
                                                className="h-9 px-6 bg-[#E8D200] text-[#080808] text-[9px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-1px] disabled:opacity-40"
                                            >
                                                {applyingBulkExpiry ? 'Applying…' : 'Apply'}
                                            </button>
                                        </div>
                                    )}

                                    {/* Code search */}
                                    <div className="relative mb-4">
                                        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                                        <input
                                            type="text"
                                            value={codeSearch}
                                            onChange={e => setCodeSearch(e.target.value)}
                                            placeholder="Search codes…"
                                            className="w-full h-10 pl-11 pr-10 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[12px] font-mono text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none"
                                        />
                                        {codeSearch && (
                                            <button type="button" onClick={() => setCodeSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#BBBBBB] hover:text-[#666666]">
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>

                                    {codePoolLoading ? (
                                        <div className="flex items-center justify-center py-10 gap-3">
                                            <div className="w-5 h-5 border border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#999999] font-black">Loading</span>
                                        </div>
                                    ) : codePool.rows.length === 0 ? (
                                        <div className="text-center py-12">
                                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black">{codeSearch ? `No codes matching "${codeSearch}"` : `No codes${codePoolStatus !== 'all' ? ` with status "${codePoolStatus}"` : ' uploaded yet'}`}</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="rounded-2xl border border-[#E6E6E1] overflow-x-auto mb-4">
                                                <table className="w-full text-left border-collapse">
                                                    <thead>
                                                        <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                                            {['Code', 'Status', 'Claimed', 'Used', 'Expires', ''].map(h => (
                                                                <th key={h} className="px-3 py-3 text-[9px] font-black uppercase tracking-[0.4em] text-[#999999] whitespace-nowrap">{h}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-[#E6E6E1]">
                                                        {codePool.rows.map(row => (
                                                            <tr key={row.id} className="hover:bg-[#F4F4F1] transition-all">
                                                                <td className="px-3 py-3 font-mono text-[11px] text-[#8a7600] tracking-[0.1em] whitespace-nowrap">{row.code}</td>
                                                                <td className="px-3 py-3">
                                                                    <span className={`text-[9px] font-black uppercase tracking-[0.3em] ${STATUS_COLOR[row.status] ?? 'text-[#666666]'}`}>{row.status}</span>
                                                                </td>
                                                                <td className="px-3 py-3 text-[11px] text-[#888888]">{fmtDate(row.assigned_at)}</td>
                                                                <td className="px-3 py-3 text-[11px] text-[#888888]">{fmtDate(row.used_at)}</td>
                                                                <td className="px-3 py-3 text-[11px] text-[#888888] whitespace-nowrap">
                                                                    {editingExpiryId === row.id ? (
                                                                        <div className="flex items-center gap-1.5">
                                                                            <input
                                                                                type="date"
                                                                                autoFocus
                                                                                value={editingExpiryVal}
                                                                                onChange={e => setEditingExpiryVal(e.target.value)}
                                                                                onKeyDown={e => { if (e.key === 'Enter') handleSaveExpiry(row); if (e.key === 'Escape') setEditingExpiryId(null); }}
                                                                                className="h-7 px-2 bg-white border border-[#E8D200]/40 rounded-lg text-[11px] text-[#222222] outline-none"
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                disabled={savingExpiryId === row.id}
                                                                                onClick={() => handleSaveExpiry(row)}
                                                                                title="Save expiry"
                                                                                className="h-7 w-7 flex items-center justify-center bg-[#E8D200] text-[#080808] rounded-lg disabled:opacity-40"
                                                                            >
                                                                                <Check size={13} />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setEditingExpiryId(null)}
                                                                                title="Cancel"
                                                                                className="h-7 w-7 flex items-center justify-center bg-[#F4F4F1] border border-[#E6E6E1] text-[#999999] rounded-lg hover:text-[#666666]"
                                                                            >
                                                                                <X size={13} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => beginEditExpiry(row)}
                                                                            title="Edit expiry"
                                                                            className="group flex items-center gap-1.5 hover:text-[#8a7600] transition-colors"
                                                                        >
                                                                            {fmtDate(row.expires_at)}
                                                                            <Edit2 size={10} className="opacity-0 group-hover:opacity-100 text-[#BBBBBB] transition-opacity" />
                                                                        </button>
                                                                    )}
                                                                </td>
                                                                <td className="px-3 py-3 text-right">
                                                                    {(row.status === 'available' || row.status === 'expired') && (
                                                                        <button
                                                                            type="button"
                                                                            disabled={togglingCodeId === row.id}
                                                                            onClick={() => handleToggleCodeStatus(row)}
                                                                            title={row.status === 'available' ? 'Expire this code' : 'Re-activate this code'}
                                                                            className={`h-6 w-11 rounded-full relative transition-all shrink-0 ${row.status === 'available' ? 'bg-[#10B981]/30' : 'bg-[#EFEFEC]'} ${togglingCodeId === row.id ? 'opacity-50' : ''}`}
                                                                        >
                                                                            <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${row.status === 'available' ? 'left-[22px] bg-[#10B981]' : 'left-0.5 bg-[#DADAD3]'}`} />
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {codePool.total > CODE_POOL_PAGE_SIZE && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black">
                                                        {codePoolPage * CODE_POOL_PAGE_SIZE + 1}–{Math.min((codePoolPage + 1) * CODE_POOL_PAGE_SIZE, codePool.total)} of {codePool.total}
                                                    </span>
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={codePoolPage === 0}
                                                            onClick={() => refreshCodePool(selectedReward.id, codePoolPage - 1, codePoolStatus)}
                                                            className="h-9 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#888888] hover:text-[#333333] disabled:opacity-30 font-black transition-all"
                                                        >← Prev</button>
                                                        <button
                                                            type="button"
                                                            disabled={(codePoolPage + 1) * CODE_POOL_PAGE_SIZE >= codePool.total}
                                                            onClick={() => refreshCodePool(selectedReward.id, codePoolPage + 1, codePoolStatus)}
                                                            className="h-9 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#888888] hover:text-[#333333] disabled:opacity-30 font-black transition-all"
                                                        >Next →</button>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
