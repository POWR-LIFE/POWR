import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket, Upload, FileText, Download, X, ChevronDown, Check, Search, CalendarClock, Edit2, AlertTriangle, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { invokeFn } from '../../lib/invokeFn';
import { formatLocale } from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';
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

// Keys, translated where they render. Status values themselves stay as stored.
const STATUS_LABEL_KEYS = {
    all: 'brandPromo:status.all',
    available: 'brandPromo:status.available',
    reserved: 'brandPromo:status.reserved',
    used: 'brandPromo:status.used',
    expired: 'brandPromo:status.expired',
};
const BULK_EXPIRY_LABEL_KEYS = {
    all: 'brandPromo:bulkExpiry.label.all',
    available: 'brandPromo:bulkExpiry.label.available',
    reserved: 'brandPromo:bulkExpiry.label.reserved',
    used: 'brandPromo:bulkExpiry.label.used',
    expired: 'brandPromo:bulkExpiry.label.expired',
};
const BULK_EXPIRY_CONFIRM_KEYS = {
    all: 'brandPromo:bulkExpiry.confirm.all',
    available: 'brandPromo:bulkExpiry.confirm.available',
    reserved: 'brandPromo:bulkExpiry.confirm.reserved',
    used: 'brandPromo:bulkExpiry.confirm.used',
    expired: 'brandPromo:bulkExpiry.confirm.expired',
};
// uploadCodes() reject reasons (lib/promoCodes.js) → words.
const REJECT_REASON_KEYS = {
    duplicate_in_batch: 'brandPromo:rejectReasons.duplicateInBatch',
    invalid_format: 'brandPromo:rejectReasons.invalidFormat',
    wrong_partner_prefix: 'brandPromo:rejectReasons.wrongPartnerPrefix',
    code_in_different_reward: 'brandPromo:rejectReasons.codeInDifferentReward',
    already_exists: 'brandPromo:rejectReasons.alreadyExists',
    insert_failed: 'brandPromo:rejectReasons.insertFailed',
};
const WORKSPACE_MODES = [
    ['add', 'brandPromo:modes.add'],
    ['reconcile', 'brandPromo:modes.reconcile'],
    ['manage', 'brandPromo:modes.manage'],
];
const LEDGER_COLUMNS = [
    ['code', 'brandPromo:ledger.columns.code'],
    ['status', 'brandPromo:ledger.columns.status'],
    ['claimed', 'brandPromo:ledger.columns.claimed'],
    ['used', 'brandPromo:ledger.columns.used'],
    ['expires', 'brandPromo:ledger.columns.expires'],
    ['actions', null],
];

const fmtDate = (d) =>
    d ? new Date(d).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: '2-digit' }) : '—';

export default function PartnerPromoCodes() {
    const { t } = useTranslation();
    const toast = useToast();
    const { partnerData, deliveryMethod } = useAuth();
    const brand = partnerData?.brand_name;

    const [rewards, setRewards] = useState([]);
    const [availByReward, setAvailByReward] = useState({});
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [selectedId, setSelectedId] = useState(null);

    // Code-pool state for the selected reward
    const [codeStats, setCodeStats] = useState(null);
    // Tracked separately from the counts themselves so a failed count still
    // settles the page instead of holding it on the loading state forever.
    const [statsLoaded, setStatsLoaded] = useState(false);
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
        const timer = setTimeout(() => refreshCodePool(selectedId, 0, codePoolStatus, codeSearch), 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [codeSearch]);

    const fetchRewards = async () => {
        setLoading(true);
        setLoadError(false);
        // Code pools only apply to digital, non-affiliate rewards (mirrors admin gating).
        const { data, error } = await supabase
            .from('rewards')
            .select('id, title, image_url, active, reward_kind, integration_type')
            .ilike('brand_name', brand)
            .order('created_at', { ascending: false });
        // A dropped request or an RLS refusal must not read as "you have no
        // rewards" — a stocked brand would be told to go and create one.
        if (error) {
            setLoadError(true);
            setLoading(false);
            return;
        }
        const eligible = (data ?? []).filter(
            r => r.reward_kind !== 'physical' && r.integration_type !== 'AFFILIATE' && r.integration_type !== 'IN_STORE'
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
        setStatsLoaded(true);
    };

    const refreshCodePool = async (rewardId, page = 0, status = codePoolStatus, search = codeSearch) => {
        setCodePoolLoading(true);
        setCodePoolStatus(status);
        setCodePoolPage(page);
        try {
            const result = await fetchCodePool({ rewardId, status, page, search, pageSize: CODE_POOL_PAGE_SIZE });
            setCodePool(result);
        } catch (err) {
            toast.error(serverErrorText(err, t('brandPromo:toast.loadFailed')));
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
        // Drop the outgoing reward's counts, or an empty pool wears the
        // previous one's totals until the new ones land.
        setCodeStats(null);
        setStatsLoaded(false);
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

    // Codes landing on a reward that isn't live yet is the moment POWR has to
    // act (the approval email promises "we switch it on as soon as codes are
    // in"). Fire-and-forget: a failure here must never block the upload.
    const nudgeTeamIfInactive = (count) => {
        if (!selectedReward || selectedReward.active) return;
        invokeFn('manage-partner-api', { action: 'notify_codes_loaded', reward_id: selectedReward.id, count }).catch(() => {});
    };

    const handleGenerate = async () => {
        if (!selectedReward) return;
        if (!generateCount || generateCount < 1) return;
        setGeneratingCodes(true);
        try {
            const result = await generateCodes({ rewardId: selectedReward.id, count: generateCount, scheme: parsedScheme || undefined, expiresAt: expiryInputToISO(batchExpiry) || undefined });
            toast.success(result.duplicatesSkipped
                ? t('brandPromo:toast.generatedSkipped', { count: result.generated, skipped: result.duplicatesSkipped })
                : t('brandPromo:toast.generated', { count: result.generated }));
            if (result.generated > 0) nudgeTeamIfInactive(result.generated);
            await refreshCodeStats(selectedReward.id);
            await refreshCodePool(selectedReward.id, 0, codePoolStatus);
        } catch (err) {
            toast.error(serverErrorText(err, t('brandPromo:toast.generateFailed')));
        } finally {
            setGeneratingCodes(false);
        }
    };

    const handleBulkUpload = async () => {
        if (!selectedReward) return;
        const codes = parseCodes(bulkCodesText);
        if (codes.length === 0) { toast.error(t('brandPromo:toast.noCodes')); return; }
        setUploadingCodes(true);
        try {
            const result = await uploadCodes({ rewardId: selectedReward.id, codes, scheme: parsedScheme || undefined, expiresAt: expiryInputToISO(batchExpiry) || undefined });
            // Separate counts, joined like a row of stat chips.
            const parts = [t('brandPromo:toast.added', { count: result.accepted })];
            if (result.alreadyInPool) parts.push(t('brandPromo:toast.alreadyInPool', { count: result.alreadyInPool }));
            if (result.rejected.length) parts.push(t('brandPromo:toast.rejected', { count: result.rejected.length }));
            toast.success(parts.join(' · '));
            if (result.accepted > 0) nudgeTeamIfInactive(result.accepted);
            if (result.rejected.length) console.warn('Rejected codes:', result.rejected);
            setBulkCodesText('');
            await refreshCodeStats(selectedReward.id);
            await refreshCodePool(selectedReward.id, 0, codePoolStatus);
        } catch (err) {
            toast.error(serverErrorText(err, t('brandPromo:toast.uploadFailed')));
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
            toast.success(t('brandPromo:toast.fileLoaded', { name: file.name }));
        } catch {
            toast.error(t('brandPromo:toast.fileUnreadable'));
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
            toast.success(t('brandPromo:toast.fileLoaded', { name: file.name }));
        } catch {
            toast.error(t('brandPromo:toast.fileUnreadable'));
        } finally {
            e.target.value = '';
        }
    };

    const handleReconcile = async () => {
        if (!selectedReward) return;
        const codes = parseReconciliationCodes(reconciliationText);
        if (!codes.length) { toast.error(t('brandPromo:toast.noCodes')); return; }
        if (!window.confirm(t('brandPromo:reconcile.confirm', { count: codes.length }))) return;
        setReconciling(true);
        try {
            const { data, error } = await supabase.rpc('reconcile_partner_redemption_codes', {
                p_reward_id: selectedReward.id,
                p_codes: codes,
            });
            if (error) throw error;
            const result = data?.[0] ?? {};
            const parts = [t('brandPromo:toast.markedUsed', { count: result.marked_used_count ?? 0 })];
            if (result.already_used_count) parts.push(t('brandPromo:toast.alreadyReconciled', { count: result.already_used_count }));
            if (result.unavailable_count) parts.push(t('brandPromo:toast.notAssigned', { count: result.unavailable_count }));
            if ((result.submitted_count ?? 0) > (result.matched_count ?? 0)) parts.push(t('brandPromo:toast.notInPool', { count: result.submitted_count - result.matched_count }));
            toast.success(parts.join(' · '));
            setReconciliationText('');
            await refreshCodeStats(selectedReward.id);
            await refreshCodePool(selectedReward.id, 0, codePoolStatus);
        } catch (err) {
            toast.error(serverErrorText(err, t('brandPromo:toast.reconcileFailed')));
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
                nudgeTeamIfInactive(1);
                toast.success(t('brandPromo:toast.codeAdded'));
                setSingleCode('');
                await refreshCodeStats(selectedReward.id);
                await refreshCodePool(selectedReward.id, 0, codePoolStatus);
            } else if (result.alreadyInPool) {
                toast.success(t('brandPromo:toast.codeAlreadyInPool'));
            } else {
                const reason = result.rejected[0]?.reason;
                const reasonText = reason
                    ? (REJECT_REASON_KEYS[reason] ? t(REJECT_REASON_KEYS[reason]) : reason)
                    : t('brandPromo:rejectReasons.invalid');
                toast.error(t('brandPromo:toast.codeRejected', { reason: reasonText }));
            }
        } catch (err) {
            toast.error(serverErrorText(err, t('brandPromo:toast.failed')));
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
            toast.error(serverErrorText(err, t('brandPromo:toast.toggleFailed')));
        } finally {
            setTogglingCodeId(null);
        }
    };

    // Apply one expiry date to every code matching the current ledger filter.
    const handleBulkExpiry = async () => {
        if (!selectedReward) return;
        if (!bulkExpiry) { toast.error(t('brandPromo:toast.pickDate')); return; }
        const pretty = new Date(`${bulkExpiry}T23:59:59`).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
        if (!window.confirm(t(BULK_EXPIRY_CONFIRM_KEYS[codePoolStatus] ?? BULK_EXPIRY_CONFIRM_KEYS.all, { date: pretty }))) return;
        setApplyingBulkExpiry(true);
        try {
            const { updated } = await bulkUpdateExpiry({ rewardId: selectedReward.id, expiresAt: expiryInputToISO(bulkExpiry), status: codePoolStatus });
            toast.success(t('brandPromo:toast.expiryUpdatedOn', { count: updated }));
            setBulkExpiry('');
            await refreshCodeStats(selectedReward.id);
            await refreshCodePool(selectedReward.id, codePoolPage, codePoolStatus);
        } catch (err) {
            toast.error(serverErrorText(err, t('brandPromo:toast.bulkFailed')));
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
            toast.success(t('brandPromo:toast.expiryUpdated'));
            await refreshCodeStats(selectedReward.id);
        } catch (err) {
            toast.error(serverErrorText(err, t('brandPromo:toast.updateFailed')));
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
            // The file stays English (column names, status values, sheet and file
            // names): it's data a brand may load straight back in as a CSV.
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
            toast.success(t('brandPromo:toast.exported', { count: rows.length }));
        } catch (err) {
            toast.error(serverErrorText(err, t('brandPromo:toast.exportFailed')));
        }
    };

    // ── Staged setup — per selected reward, derived from live pool state ──
    const poolTotal = codeStats
        ? codeStats.available + codeStats.reserved + codeStats.used + codeStats.expired
        : 0;
    // Rows in the pool prove nothing — only codes a member could actually be
    // handed count as loaded, so a used-up or date-lapsed pool still asks to
    // be topped up rather than reading as ready to go live.
    const availableCodes = codeStats?.available ?? 0;
    const stageSteps = [
        {
            label: t('brandPromo:stages.pick'),
            done: !!selectedReward,
            hint: t('brandPromo:stages.pickHint'),
        },
        {
            label: t('brandPromo:stages.load'),
            done: availableCodes > 0,
            hint: poolTotal > 0
                ? t('brandPromo:stages.loadHintDry')
                : t('brandPromo:stages.loadHintEmpty'),
        },
        {
            label: t('brandPromo:stages.redeem'),
            done: availableCodes > 0 && !!selectedReward?.active,
            hint: selectedReward?.active
                ? t('brandPromo:stages.redeemHintLive')
                : t('brandPromo:stages.redeemHintReady'),
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
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">{t('brandPromo:header.eyebrow')}</span>
                </div>
                <div className="flex items-end justify-between gap-6 flex-wrap">
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">{t('brandPromo:header.title')}</h1>
                    <div className="flex items-center gap-3">
                        <ChangeMethodLink />
                        <GuideLink method="manual" />
                    </div>
                </div>
                <p className="text-[12px] text-[#AAAAAA] font-black mt-3 max-w-xl">
                    {t('brandPromo:header.intro')}
                </p>
                {deliveryMethod && deliveryMethod !== 'manual' && (
                    <div className="mt-5 p-4 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-2xl text-[11px] text-[#8a7600] font-bold max-w-xl leading-relaxed">
                        {deliveryMethod === 'api' ? t('brandPromo:header.deliveryApi') : t('brandPromo:header.deliveryShopify')}
                    </div>
                )}
            </div>

            {loadError ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl py-20 text-center">
                    <AlertTriangle size={26} className="text-[#DDDDDD] mx-auto mb-4" />
                    <p className="text-[11px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">{t('brandPromo:loadError.title')}</p>
                    <p className="text-xs text-[#BBBBBB] mt-2">{t('brandPromo:loadError.body')}</p>
                    <button
                        type="button"
                        onClick={fetchRewards}
                        className="mt-6 inline-flex items-center gap-2 h-10 px-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all"
                    >
                        <RefreshCw size={12} /> {t('common:actions.retry')}
                    </button>
                </div>
            ) : rewards.length === 0 ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl py-20 text-center">
                    <Ticket size={28} className="text-[#E6E6E1] mx-auto mb-4" />
                    <p className="text-[11px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{t('brandPromo:empty.title')}</p>
                    <p className="text-xs text-[#BBBBBB] mt-2">{t('brandPromo:empty.body')}</p>
                    <Link
                        to="/partner/rewards"
                        className="mt-6 inline-flex items-center h-10 px-6 bg-[#E8D200] text-[#080808] text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:brightness-95 transition-all"
                    >
                        {t('brandPromo:empty.create')}
                    </Link>
                </div>
            ) : (
                <>
                    {/* The counts are a second round-trip after the reward
                        list, so hold the strip rather than paint step 2 as
                        un-started to a brand with a full pool. */}
                    {statsLoaded ? (
                        <StageStrip
                            steps={stageSteps}
                            doneHint={t('brandPromo:stages.done')}
                        />
                    ) : (
                        <div className="mb-8 p-5 px-6 bg-white border border-[#E6E6E1] rounded-3xl flex items-center gap-3">
                            <div className="w-5 h-5 border border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{t('brandPromo:stages.checking')}</span>
                        </div>
                    )}

                    {/* Reward selector — dropdown */}
                    <div className="mb-8 relative max-w-2xl" ref={selectorRef}>
                        <span className="block text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">{t('brandPromo:selector.label')}</span>
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
                                <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{selectedReward?.title || t('brandPromo:selector.placeholder')}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {selectedReward && !selectedReward.active && <span className="text-[8px] uppercase tracking-[0.2em] text-[#BBB] font-black px-1.5 py-0.5 bg-[#F4F4F1] rounded">{t('brandPromo:selector.inactive')}</span>}
                                    <span className={`text-[9px] uppercase tracking-[0.2em] font-black ${(availByReward[selectedId] ?? 0) > 0 ? 'text-[#10B981]' : 'text-[#CCCCCC]'}`}>{t('brandPromo:selector.available', { count: availByReward[selectedId] ?? 0 })}</span>
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
                                                <div className={`text-[13px] font-bold truncate ${active ? 'text-[#1A1A1A]' : 'text-[#444]'}`}>{r.title || t('brandPromo:selector.untitled')}</div>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    {!r.active && <span className="text-[8px] uppercase tracking-[0.2em] text-[#BBB] font-black px-1.5 py-0.5 bg-[#F4F4F1] rounded">{t('brandPromo:selector.inactive')}</span>}
                                                    <span className={`text-[9px] uppercase tracking-[0.2em] font-black ${avail > 0 ? 'text-[#10B981]' : 'text-[#CCCCCC]'}`}>{t('brandPromo:selector.available', { count: avail })}</span>
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
                                        <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">{t('brandPromo:pool.title')}</span>
                                        {statsLoaded ? (codeStats && (
                                            <div className="flex items-center gap-5 ml-2 text-[10px] uppercase tracking-[0.3em] font-black">
                                                <span className="text-[#10B981]">{t('brandPromo:pool.avail', { count: codeStats.available })}</span>
                                                <span className="text-[#8a7600]">{t('brandPromo:pool.reserved', { count: codeStats.reserved })}</span>
                                                <span className="text-[#555555]">{t('brandPromo:pool.used', { count: codeStats.used })}</span>
                                                <span className="text-[#999999]">{t('brandPromo:pool.expired', { count: codeStats.expired })}</span>
                                            </div>
                                        )) : (
                                            <span className="flex items-center gap-2 ml-2 text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                                                <span className="w-3 h-3 border border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                                                {t('brandPromo:pool.counting')}
                                            </span>
                                        )}
                                        {expiryOutlook?.expiringSoon > 0 && (
                                            <span className="flex items-center gap-2 px-3 py-1.5 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-full text-[9px] uppercase tracking-[0.25em] text-[#B45309] font-black">
                                                <AlertTriangle size={11} />
                                                {t('brandPromo:pool.expiringSoon', { count: expiryOutlook.expiringSoon, date: fmtDate(expiryOutlook.soonestExpiry) })}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {codeWorkspaceMode === 'add' && <button type="button" onClick={handleDownloadTemplate} className="flex items-center gap-2 h-9 px-5 bg-[#F4F4F1] border border-[#E8D200]/20 rounded-full text-[9px] uppercase tracking-[0.3em] text-[#8a7600] hover:bg-[#E8D200]/5 transition-all font-black"><FileText size={11} /> {t('brandPromo:pool.template')}</button>}
                                        <div className="flex bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-1 gap-1">
                                            {WORKSPACE_MODES.map(([mode, labelKey]) => <button key={mode} type="button" onClick={() => setCodeWorkspaceMode(mode)} className={`h-8 px-3 rounded-xl text-[9px] uppercase tracking-[0.18em] font-black transition-all ${codeWorkspaceMode === mode ? 'bg-[#E8D200] text-[#080808]' : 'text-[#888] hover:text-[#333]'}`}>{t(labelKey)}</button>)}
                                        </div>
                                    </div>
                                </div>

                                {/* Code format builder */}
                                <div className={codeWorkspaceMode === 'add' ? 'px-8 py-5 border-b border-[#E6E6E1]' : 'hidden'}>
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">{t('brandPromo:format.title')}</div>
                                    <div className="flex gap-3 items-center">
                                        <input
                                            type="text"
                                            placeholder={t('brandPromo:format.placeholder')}
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
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black">{t('brandPromo:format.detected')}</span>
                                            {parsedScheme.segments.map((seg, i) => (
                                                <React.Fragment key={i}>
                                                    {i > 0 && <span className="text-[#AAAAAA] text-xs font-mono">-</span>}
                                                    <span className={`font-mono text-[11px] rounded-lg px-3 py-1 border ${seg.fixed ? 'text-[#8a7600] bg-[#E8D200]/5 border-[#E8D200]/20' : 'text-[#10B981] bg-[#10B981]/5 border-[#10B981]/20'}`}>
                                                        {seg.fixed ? seg.value : seg.pattern}
                                                    </span>
                                                </React.Fragment>
                                            ))}
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black ml-2">{t('brandPromo:format.legend')}</span>
                                        </div>
                                    )}
                                    {schemeExample && !parsedScheme && (
                                        <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-red-400 font-black">
                                            {t('brandPromo:format.invalid')}
                                        </p>
                                    )}
                                    {!schemeExample && (
                                        <p className="mt-2 text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">
                                            {t('brandPromo:format.defaultHint')}
                                        </p>
                                    )}
                                </div>

                                {/* New-batch expiry — applies to codes added via generate / upload / single-add below */}
                                <div className="px-8 py-5 border-b border-[#E6E6E1]">
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">{t('brandPromo:expiry.title')}</div>
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
                                            {batchExpiry ? t('brandPromo:expiry.applied') : t('brandPromo:expiry.default')}
                                        </span>
                                    </div>
                                </div>

                                {/* Auto-generate */}
                                <div className={codeWorkspaceMode === 'add' ? 'px-8 py-5 border-b border-[#E6E6E1]' : 'hidden'}>
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">{t('brandPromo:generate.title')}</div>
                                    <div className="flex flex-wrap gap-3 items-center">
                                        <input
                                            type="number"
                                            min="1"
                                            max="5000"
                                            value={generateCount}
                                            onChange={e => setGenerateCount(Math.max(1, Math.min(5000, parseInt(e.target.value) || 1)))}
                                            className="w-28 h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[13px] font-light text-[#8a7600] text-center focus:border-[#E8D200]/40 outline-none"
                                        />
                                        <span className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black">{t('brandPromo:generate.unit')}</span>
                                        <button
                                            type="button"
                                            onClick={handleGenerate}
                                            disabled={generatingCodes}
                                            className="h-11 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-2px] disabled:opacity-40"
                                        >
                                            {generatingCodes ? t('brandPromo:generate.generating') : t('brandPromo:generate.button')}
                                        </button>
                                        <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">
                                            {parsedScheme ? t('brandPromo:generate.usingScheme', { prefix: parsedScheme.prefix }) : t('brandPromo:generate.usingDefault')}
                                        </span>
                                    </div>
                                </div>

                                {/* Upload */}
                                <div className={codeWorkspaceMode === 'add' ? 'px-8 pb-6 pt-5 border-b border-[#E6E6E1]' : 'hidden'}>
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">{t('brandPromo:upload.title')}</div>
                                    <div className="flex flex-wrap gap-3 mb-3">
                                        <input
                                            type="text"
                                            placeholder={parsedScheme ? t('brandPromo:upload.singlePlaceholderScheme', { prefix: parsedScheme.prefix }) : t('brandPromo:upload.singlePlaceholder')}
                                            className="flex-1 min-w-[200px] h-11 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[11px] font-mono text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none uppercase tracking-[0.05em]"
                                            value={singleCode}
                                            onChange={e => setSingleCode(e.target.value.toUpperCase())}
                                        />
                                        <button type="button" onClick={handleAddSingleCode} disabled={uploadingCodes || !singleCode.trim()} className="h-11 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#222222] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black disabled:opacity-40">{t('brandPromo:upload.add')}</button>
                                        <label className="flex items-center gap-2 h-11 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#333333] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black cursor-pointer whitespace-nowrap">
                                            <Upload size={12} /> {t('brandPromo:upload.csv')}
                                            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleBulkFile} />
                                        </label>
                                    </div>
                                    <textarea
                                        rows={3}
                                        placeholder={t('brandPromo:upload.pastePlaceholder')}
                                        className="w-full p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl focus:border-[#E8D200]/40 outline-none transition-all text-xs font-mono text-[#222222] placeholder-[#BBBBBB] resize-none"
                                        value={bulkCodesText}
                                        onChange={e => setBulkCodesText(e.target.value)}
                                    />
                                    <div className="flex justify-between items-center mt-3">
                                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black">
                                            {t('brandPromo:upload.detected', { count: parseCodes(bulkCodesText).length })}
                                        </span>
                                        <button type="button" onClick={handleBulkUpload} disabled={uploadingCodes || !bulkCodesText.trim()} className="h-11 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-2px] disabled:opacity-40">
                                            {uploadingCodes ? t('brandPromo:upload.uploading') : t('brandPromo:upload.button')}
                                        </button>
                                    </div>
                                </div>

                                {/* Reconcile store-side redemptions */}
                                <div className={codeWorkspaceMode === 'reconcile' ? 'px-8 pb-6 pt-5 border-b border-[#E6E6E1] bg-[#E8D200]/[0.025]' : 'hidden'}>
                                    <div className="flex items-start justify-between gap-4 mb-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.4em] text-[#8a7600] font-black">
                                                <RefreshCw size={12} /> {t('brandPromo:reconcile.title')}
                                            </div>
                                            <p className="text-[11px] text-[#888] mt-2 max-w-2xl leading-relaxed">
                                                {t('brandPromo:reconcile.body')}
                                            </p>
                                        </div>
                                        <label className="flex items-center gap-2 h-10 px-5 bg-white border border-[#E6E6E1] rounded-full text-[9px] uppercase tracking-[0.25em] text-[#555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black cursor-pointer whitespace-nowrap">
                                            <Upload size={11} /> {t('brandPromo:reconcile.import')}
                                            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleReconciliationFile} />
                                        </label>
                                    </div>
                                    <textarea
                                        rows={3}
                                        placeholder={t('brandPromo:reconcile.placeholder')}
                                        className="w-full p-4 bg-white border border-[#E6E6E1] rounded-2xl focus:border-[#E8D200]/40 outline-none transition-all text-xs font-mono text-[#222] placeholder-[#BBB] resize-none"
                                        value={reconciliationText}
                                        onChange={e => setReconciliationText(e.target.value)}
                                    />
                                    <div className="flex justify-between items-center mt-3 gap-4">
                                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#999] font-black">
                                            {t('brandPromo:upload.detected', { count: parseReconciliationCodes(reconciliationText).length })}
                                        </span>
                                        <button type="button" onClick={handleReconcile} disabled={reconciling || !reconciliationText.trim()} className="flex items-center gap-2 h-11 px-7 bg-[#1A1A1A] text-white text-[10px] uppercase tracking-[0.25em] rounded-full transition-all hover:bg-[#333] disabled:opacity-40 font-black">
                                            <RefreshCw size={13} className={reconciling ? 'animate-spin' : ''} /> {reconciling ? t('brandPromo:reconcile.reconciling') : t('brandPromo:reconcile.button')}
                                        </button>
                                    </div>
                                </div>

                                {/* Ledger */}
                                <div className={codeWorkspaceMode === 'manage' ? 'px-6 py-5' : 'hidden'}>
                                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                        <div className="flex items-center gap-4">
                                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black whitespace-nowrap">
                                                {codePool.total > 0 ? t('brandPromo:ledger.titleWithTotal', { total: codePool.total }) : t('brandPromo:ledger.title')}
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
                                                    {t(STATUS_LABEL_KEYS[s])}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Bulk expiry — sets one date across every code matching the current filter */}
                                    {codePool.total > 0 && (
                                        <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 bg-[#FBFBF8] border border-[#E6E6E1] rounded-2xl">
                                            <CalendarClock size={14} className="text-[#8a7600]" />
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black">
                                                {t(BULK_EXPIRY_LABEL_KEYS[codePoolStatus] ?? BULK_EXPIRY_LABEL_KEYS.all)}
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
                                                {applyingBulkExpiry ? t('brandPromo:ledger.applying') : t('brandPromo:ledger.apply')}
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
                                            placeholder={t('brandPromo:ledger.search')}
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
                                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#999999] font-black">{t('brandPromo:ledger.loading')}</span>
                                        </div>
                                    ) : codePool.rows.length === 0 ? (
                                        <div className="text-center py-12">
                                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black">{codeSearch
                                                ? t('brandPromo:ledger.emptySearch', { search: codeSearch })
                                                : codePoolStatus !== 'all'
                                                    ? t('brandPromo:ledger.emptyStatus', { status: STATUS_LABEL_KEYS[codePoolStatus] ? t(STATUS_LABEL_KEYS[codePoolStatus]) : codePoolStatus })
                                                    : t('brandPromo:ledger.emptyNone')}</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="rounded-2xl border border-[#E6E6E1] overflow-x-auto mb-4">
                                                <table className="w-full text-left border-collapse">
                                                    <thead>
                                                        <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                                            {LEDGER_COLUMNS.map(([col, labelKey]) => (
                                                                <th key={col} className="px-3 py-3 text-[9px] font-black uppercase tracking-[0.4em] text-[#999999] whitespace-nowrap">{labelKey ? t(labelKey) : ''}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-[#E6E6E1]">
                                                        {codePool.rows.map(row => (
                                                            <tr key={row.id} className="hover:bg-[#F4F4F1] transition-all">
                                                                <td className="px-3 py-3 font-mono text-[11px] text-[#8a7600] tracking-[0.1em] whitespace-nowrap">{row.code}</td>
                                                                <td className="px-3 py-3">
                                                                    <span className={`text-[9px] font-black uppercase tracking-[0.3em] ${STATUS_COLOR[row.status] ?? 'text-[#666666]'}`}>{STATUS_LABEL_KEYS[row.status] ? t(STATUS_LABEL_KEYS[row.status]) : row.status}</span>
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
                                                                                title={t('brandPromo:ledger.saveExpiry')}
                                                                                className="h-7 w-7 flex items-center justify-center bg-[#E8D200] text-[#080808] rounded-lg disabled:opacity-40"
                                                                            >
                                                                                <Check size={13} />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setEditingExpiryId(null)}
                                                                                title={t('common:actions.cancel')}
                                                                                className="h-7 w-7 flex items-center justify-center bg-[#F4F4F1] border border-[#E6E6E1] text-[#999999] rounded-lg hover:text-[#666666]"
                                                                            >
                                                                                <X size={13} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => beginEditExpiry(row)}
                                                                            title={t('brandPromo:ledger.editExpiry')}
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
                                                                            title={row.status === 'available' ? t('brandPromo:ledger.expireCode') : t('brandPromo:ledger.reactivateCode')}
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
                                                        {t('brandPromo:ledger.range', { from: codePoolPage * CODE_POOL_PAGE_SIZE + 1, to: Math.min((codePoolPage + 1) * CODE_POOL_PAGE_SIZE, codePool.total), total: codePool.total })}
                                                    </span>
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={codePoolPage === 0}
                                                            onClick={() => refreshCodePool(selectedReward.id, codePoolPage - 1, codePoolStatus)}
                                                            className="h-9 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#888888] hover:text-[#333333] disabled:opacity-30 font-black transition-all"
                                                        >{t('brandPromo:ledger.prev')}</button>
                                                        <button
                                                            type="button"
                                                            disabled={(codePoolPage + 1) * CODE_POOL_PAGE_SIZE >= codePool.total}
                                                            onClick={() => refreshCodePool(selectedReward.id, codePoolPage + 1, codePoolStatus)}
                                                            className="h-9 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#888888] hover:text-[#333333] disabled:opacity-30 font-black transition-all"
                                                        >{t('brandPromo:ledger.next')}</button>
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
