import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { Plus, Edit2, Trash2, Ticket, Loader2, X, Search, Award, Activity, ChevronLeft, ChevronRight, AlertTriangle, Upload, Image as ImageIcon, Tag, FileText, Download, GripVertical, Save, Pin, Send, KeyRound, Building2, Link2, Palette } from 'lucide-react';
import { Link } from 'react-router-dom';
import { uploadPublicImage } from '../../lib/storage';
import * as XLSX from 'xlsx';
import { parseCodes, uploadCodes, fetchCodeStats, fetchCodePool, fetchAllCodes, getCSVTemplate, buildScheme, isValidForScheme, getSchemeCSVTemplate, generateCodes, toggleCodeStatus } from '../../lib/promoCodes';
import BrandPortalAccess from '../../components/BrandPortalAccess';
import BrandAccessPanel from '../../components/BrandAccessPanel';
import BrandRewardLimit from '../../components/BrandRewardLimit';
import RewardAppPreview from '../../components/RewardAppPreview';

const CATEGORIES = ['eat', 'move', 'mind', 'sleep'];
const normalizeRewardCategory = (category) => {
    switch (category) {
        case 'eat':
        case 'nutrition':
        case 'food':
            return 'eat';
        case 'move':
        case 'gym':
            return 'move';
        case 'mind':
        case 'health':
            return 'mind';
        case 'sleep':
        case 'gear':
        case 'fashion':
            return 'sleep';
        default:
            return 'move';
    }
};
const toLegacyRewardCategory = (category) => {
    switch (category) {
        case 'eat':
            return 'food';
        case 'move':
            return 'gym';
        case 'mind':
            return 'health';
        case 'sleep':
            return 'gear';
        default:
            return 'gym';
    }
};
const KINDS = ['digital', 'physical'];
const DISCOUNT_TYPES = [
    { value: '', label: 'None' },
    { value: 'percentage', label: '% Off' },
    { value: 'fixed_amount', label: '£ Off' },
];

const formatDiscountValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    return Number.isInteger(numeric) ? `${numeric}` : numeric.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
};

const getRewardDisplayValue = (reward) => {
    if (reward.discount_type && reward.discount_value !== null && reward.discount_value !== undefined && reward.discount_value !== '') {
        const amount = formatDiscountValue(reward.discount_value);
        return reward.discount_type === 'percentage' ? `${amount}% OFF` : `£${amount} OFF`;
    }
    return reward.value_label || '';
};

// Strip a promo-code name down to the brand segment used in the redeem screen.
const cleanPrefix = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

// Pull the brand segment from a code scheme example: 'POWR-TRIBE-A1B2C3' → 'TRIBE'.
const prefixFromScheme = (scheme, fallbackName) => {
    const parts = String(scheme ?? '').toUpperCase().split('-').filter(Boolean);
    if (parts[0] === 'POWR') parts.shift();
    return cleanPrefix(parts[0] ?? fallbackName ?? '');
};

// Map the admin edit form onto RewardAppPreview's props so the phone mirrors it live.
const previewFromForm = (form, schemeExample) => ({
    brandName: form.brand_name || '',
    title: form.title,
    description: form.description,
    partnerBlurb: form.partner_blurb,
    offer: form.offer,
    valueLabel: form.value_label,
    discountType: form.discount_type,
    discountValue: form.discount_value,
    pts: form.powr_cost,
    logoUrl: form.image_url || null,
    heroUrl: form.hero_image_url || null,
    codePrefix: prefixFromScheme(schemeExample, form.brand_name),
});

const EMPTY_FORM = {
    partner_id: '',
    brand_name: '',
    title: '',
    description: '',
    powr_cost: 100,
    category: 'move',
    stock: null,
    active: true,
    reward_kind: 'digital',
    integration_type: 'POOL',
    value_label: '',
    discount_type: '',
    discount_value: '',
    terms: '',
    image_url: '',
    offer: '',
    hero_image_url: '',
    brand_color: '',
    url: '',
    partner_blurb: '',
    max_redemptions_per_user: null,
};

export default function RewardManager() {
    const toast = useToast();
    const [rewards, setRewards] = useState([]);
    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterCat, setFilterCat] = useState('all');
    const [filterPartner, setFilterPartner] = useState('all');
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingReward, setEditingReward] = useState(null);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [togglingId, setTogglingId] = useState(null);
    const [imageUploading, setImageUploading] = useState(false);
    const [codeStats, setCodeStats] = useState(null);
    const [bulkCodesText, setBulkCodesText] = useState('');
    const [uploadingCodes, setUploadingCodes] = useState(false);
    const [singleCode, setSingleCode] = useState('');
    const [codePool, setCodePool] = useState({ rows: [], total: 0 });
    const [codePoolPage, setCodePoolPage] = useState(0);
    const [codePoolStatus, setCodePoolStatus] = useState('all');
    const [codePoolLoading, setCodePoolLoading] = useState(false);
    const [codeSearch, setCodeSearch] = useState('');
    const [schemeExample, setSchemeExample] = useState('');
    const [generateCount, setGenerateCount] = useState(100);
    const [generatingCodes, setGeneratingCodes] = useState(false);
    const [togglingCodeId, setTogglingCodeId] = useState(null);
    const [dragId, setDragId] = useState(null);
    const [dragOverId, setDragOverId] = useState(null);
    const [unsavedOrder, setUnsavedOrder] = useState(false);
    const [savingOrder, setSavingOrder] = useState(false);
    const [portalAccessOpen, setPortalAccessOpen] = useState(false);
    const [editorTab, setEditorTab] = useState('details'); // 'details' | 'codes' | 'partner'

    // Distinct reward brands (case-insensitive) for the Portal Access modal
    const portalBrands = (() => {
        const seen = new Map();
        rewards.forEach(r => {
            const name = (r.brand_name ?? '').trim();
            if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
        });
        return [...seen.values()].sort((a, b) => a.localeCompare(b));
    })();
    const CODE_POOL_PAGE_SIZE = 20;
    const parsedScheme = schemeExample ? buildScheme(schemeExample) : null;

    // Promo codes only exist for a saved digital reward that isn't an affiliate link,
    // so the Promo Codes tab is only offered for those. If it's selected but no longer
    // applies (e.g. the reward kind was changed), fall back to Reward Details.
    const codesEligible = !!editingReward && formData.reward_kind === 'digital' && formData.integration_type !== 'AFFILIATE';
    const activeTab = editorTab === 'codes' && !codesEligible ? 'details' : editorTab;

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        const [rew, part] = await Promise.all([
            supabase.from('rewards').select('*, partners(name, partner_code, logo_url)').order('sort_order', { ascending: true }).order('created_at', { ascending: false }),
            supabase.from('partners').select('id, name, partner_code, roles').contains('roles', ['reward_provider']).order('name'),
        ]);
        if (rew.error) toast.error('Failed to load inventory');
        else {
            const normalized = (rew.data || []).map((reward) => ({
                ...reward,
                category: normalizeRewardCategory(reward.category),
            }));
            setRewards(normalized);
        }
        if (part.data) setPartners(part.data);
        setLoading(false);
        setUnsavedOrder(false);
    };

    const refreshCodeStats = async (rewardId) => {
        if (!rewardId) { setCodeStats(null); return; }
        try { setCodeStats(await fetchCodeStats(rewardId)); }
        catch { setCodeStats(null); }
    };

    const refreshCodePool = async (rewardId, page = 0, status = 'all', search = codeSearch) => {
        if (!rewardId) { setCodePool({ rows: [], total: 0 }); return; }
        setCodePoolLoading(true);
        try {
            const result = await fetchCodePool({ rewardId, status, page, search, pageSize: CODE_POOL_PAGE_SIZE });
            setCodePool(result);
            setCodePoolPage(page);
            setCodePoolStatus(status);
        } catch { setCodePool({ rows: [], total: 0 }); }
        finally { setCodePoolLoading(false); }
    };

    // Debounced server-side code search within the open reward's pool.
    useEffect(() => {
        if (!editingReward) return;
        const t = setTimeout(() => refreshCodePool(editingReward.id, 0, codePoolStatus, codeSearch), 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [codeSearch]);

    const filtered = rewards
        .filter(r => !search || r.title.toLowerCase().includes(search.toLowerCase()))
        .filter(r => filterCat === 'all' || r.category === filterCat)
        .filter(r => {
            if (filterPartner === 'all') return true;
            if (filterPartner === '__standalone__') return !r.partner_id;
            return r.partner_id === filterPartner;
        });

    const openCreate = () => {
        setEditingReward(null);
        setEditorTab('details');
        setFormData({ ...EMPTY_FORM });
        setCodeStats(null);
        setCodePool({ rows: [], total: 0 });
        setCodePoolPage(0);
        setCodePoolStatus('all');
        setCodeSearch('');
        setBulkCodesText('');
        setSingleCode('');
        setEditorOpen(true);
        window.scrollTo({ top: 0 });
    };

    const openEdit = async (reward) => {
        setEditingReward(reward);
        setEditorTab('details');
        setFormData({
            partner_id: reward.partner_id ?? '',
            brand_name: reward.brand_name || '',
            title: reward.title,
            description: reward.description || '',
            powr_cost: reward.powr_cost,
            category: normalizeRewardCategory(reward.category),
            stock: reward.stock,
            active: reward.active,
            reward_kind: reward.reward_kind || 'digital',
            integration_type: reward.integration_type || 'POOL',
            value_label: reward.value_label || '',
            discount_type: reward.discount_type || '',
            discount_value: reward.discount_value ?? '',
            terms: reward.terms || '',
            image_url: reward.image_url || '',
            offer: reward.offer || '',
            hero_image_url: reward.hero_image_url || '',
            brand_color: reward.brand_color || '',
            url: reward.url || '',
            partner_blurb: reward.partner_blurb || '',
            max_redemptions_per_user: reward.max_redemptions_per_user ?? null,
        });
        setBulkCodesText('');
        setSingleCode('');
        setGenerateCount(100);
        setCodePoolPage(0);
        setCodePoolStatus('all');
        setCodeSearch('');
        // Restore persisted scheme for this reward, or fall back to partner-code pre-seed
        const foundPartner = partners.find(p => p.id === reward.partner_id);
        const savedScheme = localStorage.getItem(`powr_scheme_${reward.id}`);
        if (savedScheme) {
            setSchemeExample(savedScheme);
        } else if (foundPartner?.partner_code) {
            setSchemeExample(`POWR-${foundPartner.partner_code}-A1B2C3`);
        } else {
            setSchemeExample('');
        }
        await Promise.all([refreshCodeStats(reward.id), refreshCodePool(reward.id)]);
        setEditorOpen(true);
        window.scrollTo({ top: 0 });
    };

    const handleImagePick = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImageUploading(true);
        try {
            const url = await uploadPublicImage('reward-images', file, 'rewards');
            setFormData(prev => ({ ...prev, image_url: url }));
            toast.success('Image uploaded');
        } catch (err) {
            toast.error(err.message || 'Upload failed');
        } finally {
            setImageUploading(false);
            e.target.value = '';
        }
    };

    const handleBulkUpload = async () => {
        if (!editingReward) { toast.error('Save the reward first, then upload codes'); return; }
        const codes = parseCodes(bulkCodesText);
        if (codes.length === 0) { toast.error('No codes detected'); return; }
        setUploadingCodes(true);
        try {
            const result = await uploadCodes({ rewardId: editingReward.id, codes, scheme: parsedScheme || undefined });
            const parts = [`${result.accepted} added`];
            if (result.alreadyInPool) parts.push(`${result.alreadyInPool} already in pool`);
            if (result.rejected.length) parts.push(`${result.rejected.length} rejected`);
            toast.success(parts.join(' · '));
            if (result.rejected.length) {
                console.warn('Rejected codes:', result.rejected);
            }
            setBulkCodesText('');
            await refreshCodeStats(editingReward.id);
            await refreshCodePool(editingReward.id, 0, codePoolStatus);
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

    const handleGenerate = async () => {
        if (!editingReward) { toast.error('Save the reward first, then generate codes'); return; }
        if (!generateCount || generateCount < 1) return;
        setGeneratingCodes(true);
        try {
            const result = await generateCodes({ rewardId: editingReward.id, count: generateCount, scheme: parsedScheme || undefined });
            toast.success(`${result.generated} codes generated${result.duplicatesSkipped ? ` · ${result.duplicatesSkipped} skipped (duplicates)` : ''}`);
            await refreshCodeStats(editingReward.id);
            await refreshCodePool(editingReward.id, 0, codePoolStatus);
        } catch (err) {
            toast.error(err.message || 'Generation failed');
        } finally {
            setGeneratingCodes(false);
        }
    };

    const handleToggleCodeStatus = async (row) => {
        if (togglingCodeId === row.id) return;
        setTogglingCodeId(row.id);
        try {
            const newStatus = await toggleCodeStatus(row.id, row.status);
            setCodePool(prev => ({
                ...prev,
                rows: prev.rows.map(r => r.id === row.id ? { ...r, status: newStatus } : r),
            }));
            await refreshCodeStats(editingReward.id);
        } catch (err) {
            toast.error(err.message || 'Toggle failed');
        } finally {
            setTogglingCodeId(null);
        }
    };

    const handleDownloadTemplate = () => {
        const partner = partners.find(p => p.id === formData.partner_id);
        const partnerCode = partner?.partner_code ?? 'XXXX';
        const csv = parsedScheme ? getSchemeCSVTemplate(parsedScheme) : getCSVTemplate(partnerCode);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `POWR-${parsedScheme ? parsedScheme.prefix.replace(/-$/, '').replace(/^POWR-/, '') : partnerCode}-codes-template.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadCodes = async (format) => {
        if (!editingReward) return;
        try {
            const rows = await fetchAllCodes({ rewardId: editingReward.id, status: codePoolStatus, search: codeSearch });
            const fmt = d => d ? new Date(d).toISOString().slice(0, 10) : '';
            const data = rows.map(r => ({
                Code: r.code,
                Status: r.status,
                Source: r.source,
                'Claimed By': r.profiles?.display_name || r.profiles?.username || '',
                'Claimed At': fmt(r.assigned_at),
                'Used At': fmt(r.used_at),
                'Expires At': fmt(r.expires_at),
                'Created At': fmt(r.created_at),
            }));
            const rewardSlug = (editingReward.title || 'codes').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            const filterSuffix = codePoolStatus !== 'all' ? `-${codePoolStatus}` : '';
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Codes');
            if (format === 'xlsx') {
                XLSX.writeFile(wb, `POWR-${rewardSlug}${filterSuffix}-codes.xlsx`);
            } else {
                XLSX.writeFile(wb, `POWR-${rewardSlug}${filterSuffix}-codes.csv`, { bookType: 'csv' });
            }
            toast.success(`${rows.length} codes exported`);
        } catch (err) {
            toast.error(err.message || 'Export failed');
        }
    };

    const handleAddSingleCode = async () => {
        if (!editingReward) { toast.error('Save the reward first'); return; }
        if (!singleCode.trim()) return;
        setUploadingCodes(true);
        try {
            const result = await uploadCodes({ rewardId: editingReward.id, codes: [singleCode], scheme: parsedScheme || undefined });
            if (result.accepted === 1) {
                toast.success('Code added');
                setSingleCode('');
                await refreshCodeStats(editingReward.id);
                await refreshCodePool(editingReward.id, 0, codePoolStatus);
            } else if (result.alreadyInPool) {
                toast.success('Code already in pool');
            } else {
                const reason = result.rejected[0]?.reason || 'rejected';
                toast.error(`Rejected: ${reason}`);
            }
        } catch (err) {
            toast.error(err.message || 'Failed');
        } finally {
            setUploadingCodes(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        const payload = {
            ...formData,
            category: toLegacyRewardCategory(formData.category),
            partner_id: formData.partner_id || null,
            brand_name: formData.brand_name || null,
            discount_type: formData.discount_type || null,
            discount_value: formData.discount_type && formData.discount_value !== '' ? Number(formData.discount_value) : null,
            integration_type: formData.integration_type || 'POOL',
            max_redemptions_per_user: formData.max_redemptions_per_user !== '' && formData.max_redemptions_per_user !== null
                ? parseInt(formData.max_redemptions_per_user, 10)
                : null,
        };
        const { error } = editingReward
            ? await supabase.from('rewards').update(payload).eq('id', editingReward.id)
            : await supabase.from('rewards').insert([payload]);
        if (error) {
            toast.error(error.message);
        } else {
            toast.success(editingReward ? 'Inventory synchronized' : 'New reward deployed');
            setEditorOpen(false);
            fetchData();
        }
        setSaving(false);
    };

    const handleToggleActive = async (reward) => {
        if (togglingId === reward.id) return;
        setTogglingId(reward.id);
        const newActive = !reward.active;
        const { error } = await supabase.from('rewards').update({ active: newActive }).eq('id', reward.id);
        if (error) {
            toast.error('Sync failed');
        } else {
            setRewards(prev => prev.map(r => r.id === reward.id ? { ...r, active: newActive } : r));
            toast.success(newActive ? 'Network Live' : 'Network Offline');
        }
        setTogglingId(null);
    };

    const isDragEnabled = !search && filterCat === 'all' && filterPartner === 'all';

    const handleDragStart = (e, id) => {
        setDragId(id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e, id) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (id !== dragId) setDragOverId(id);
    };

    const handleDrop = (e, targetId) => {
        e.preventDefault();
        if (!dragId || dragId === targetId) {
            setDragId(null);
            setDragOverId(null);
            return;
        }
        setRewards(prev => {
            const next = [...prev];
            const fromIdx = next.findIndex(r => r.id === dragId);
            const toIdx = next.findIndex(r => r.id === targetId);
            const [moved] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, moved);
            return next;
        });
        setUnsavedOrder(true);
        setDragId(null);
        setDragOverId(null);
    };

    const handleDragEnd = () => {
        setDragId(null);
        setDragOverId(null);
    };

    const handleSaveOrder = async () => {
        setSavingOrder(true);
        const results = await Promise.all(
            rewards.map((r, i) =>
                supabase.from('rewards').update({ sort_order: i }).eq('id', r.id)
            )
        );
        setSavingOrder(false);
        const firstError = results.find(r => r.error);
        if (firstError) {
            toast.error(firstError.error.message || 'Failed to save order');
            return;
        }
        setUnsavedOrder(false);
        toast.success('Display order saved');
    };

    const handleDelete = async (id) => {
        const { error } = await supabase.from('rewards').delete().eq('id', id);
        if (error) {
            toast.error('Deletion failed');
        } else {
            toast.success('Asset removed');
            setRewards(prev => prev.filter(r => r.id !== id));
        }
        setConfirmDeleteId(null);
    };

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {!editorOpen && (
            <>
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#10B981]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#10B981] font-black">Subsystem / Inventory</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Reward Vault</h1>
                    <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Management of global digital assets and retail partner redemptions.
                    </p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                    {unsavedOrder && (
                        <button
                            onClick={handleSaveOrder}
                            disabled={savingOrder}
                            className="flex items-center gap-3 h-16 px-10 bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30 text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:bg-[#10B981]/20 disabled:opacity-50"
                        >
                            {savingOrder ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            Save Order
                        </button>
                    )}
                    <button
                        onClick={() => setPortalAccessOpen(true)}
                        className="flex items-center gap-3 h-16 px-8 bg-white text-[#666666] border border-[#E6E6E1] text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:text-[#8a7600] hover:border-[#E8D200]/30"
                    >
                        <KeyRound size={16} /> Portal Access
                    </button>
                    <Link
                        to="/admin/reward-submissions"
                        className="flex items-center gap-3 h-16 px-8 bg-white text-[#666666] border border-[#E6E6E1] text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:text-[#8a7600] hover:border-[#E8D200]/30"
                    >
                        <Send size={16} /> Invite Partner
                    </Link>
                    <button
                        onClick={openCreate}
                        className="flex items-center gap-4 h-16 px-10 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20"
                    >
                        <Plus size={18} /> Initialize Reward
                    </button>
                </div>
            </div>

            {/* Featured hero is now scheduled via the Featured calendar */}
            <Link
                to="/admin/featured"
                className="mb-12 flex items-center gap-5 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-3xl px-10 py-7 hover:bg-[#E8D200]/10 transition-all group"
            >
                <div className="w-10 h-10 rounded-2xl bg-[#E8D200]/10 flex items-center justify-center shrink-0">
                    <Pin size={16} className="text-[#8a7600]" />
                </div>
                <div className="flex-1">
                    <div className="text-sm font-bold text-[#1A1A1A]">Featured hero is now scheduled</div>
                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black mt-0.5">The large card at the top of the app rewards page rotates by date — manage it on the Featured calendar</div>
                </div>
                <ChevronRight size={16} className="text-[#BBBBBB] group-hover:text-[#8a7600] transition-colors shrink-0" />
            </Link>

            {/* Controls */}
            <div className="flex flex-col lg:flex-row gap-6 mb-12">
                <div className="relative flex-1 group">
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#888888] group-focus-within:text-[#8a7600] transition-colors" />
                    <input
                        type="text"
                        placeholder="SEARCH INVENTORY ASSETS..."
                        className="w-full h-16 pl-16 pr-8 bg-white border border-[#E6E6E1] rounded-[2rem] text-[11px] font-black tracking-[0.2em] text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none transition-all uppercase"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex bg-white border border-[#E6E6E1] rounded-[2rem] p-2 gap-2 overflow-x-auto no-scrollbar">
                    <select
                        value={filterCat}
                        onChange={e => setFilterCat(e.target.value)}
                        className="h-12 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-[1.5rem] text-[10px] text-[#555555] font-black uppercase tracking-[0.2em] outline-none cursor-pointer focus:border-[#E8D200]/20"
                    >
                        <option value="all">All Sectors</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                    </select>
                    <select
                        value={filterPartner}
                        onChange={e => setFilterPartner(e.target.value)}
                        className="h-12 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-[1.5rem] text-[10px] text-[#555555] font-black uppercase tracking-[0.2em] outline-none cursor-pointer focus:border-[#E8D200]/20 max-w-[200px]"
                    >
                        <option value="all">All Brands</option>
                        <option value="__standalone__">Standalone</option>
                        {partners.map(p => <option key={p.id} value={p.id}>{p.name.toUpperCase()}</option>)}
                    </select>
                </div>
            </div>

            {/* Drag hint */}
            {!isDragEnabled && (search || filterCat !== 'all' || filterPartner !== 'all') && (
                <div className="flex items-center gap-3 mb-6 px-6 py-3 bg-white border border-[#E6E6E1] rounded-2xl">
                    <GripVertical size={14} className="text-[#AAAAAA]" />
                    <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black">Clear filters to enable drag-to-reorder</span>
                </div>
            )}

            {/* Content Container */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#10B981]/20 border-t-[#10B981] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Syncing Vault...</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                    <th className="w-10 pl-6 py-5" />
                                    {['Reward / Asset', 'Partner Node', 'Cost / Value', 'Inventory', 'Status', ''].map(h => (
                                        <th key={h} className={`px-6 py-5 text-[10px] font-black uppercase tracking-[0.5em] text-[#888888] ${h === '' ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E6E6E1]">
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-24 text-center">
                                            <div className="flex flex-col items-center gap-6">
                                                <div className="w-20 h-20 rounded-3xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                                                    <Ticket size={32} className="text-[#333333]" />
                                                </div>
                                                <p className="text-[11px] uppercase tracking-[0.4em] text-[#888888] font-black">Vault Empty</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filtered.map(reward => (
                                    <tr
                                        key={reward.id}
                                        draggable={isDragEnabled}
                                        onDragStart={isDragEnabled ? (e) => handleDragStart(e, reward.id) : undefined}
                                        onDragOver={isDragEnabled ? (e) => handleDragOver(e, reward.id) : undefined}
                                        onDrop={isDragEnabled ? (e) => handleDrop(e, reward.id) : undefined}
                                        onDragEnd={isDragEnabled ? handleDragEnd : undefined}
                                        className={`group transition-all ${
                                            dragId === reward.id ? 'opacity-40' :
                                            dragOverId === reward.id ? 'bg-[#E8D200]/5 border-t-2 border-t-[#E8D200]/30' :
                                            'hover:bg-[#F4F4F1]'
                                        }`}
                                    >
                                        <td className={`pl-6 py-5 ${isDragEnabled ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                                            <GripVertical size={16} className={isDragEnabled ? 'text-[#BBBBBB] group-hover:text-[#999999] transition-colors' : 'text-[#CCCCCC]'} />
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex items-center gap-8">
                                                <div className="w-14 h-14 rounded-3xl bg-[#111111] border border-[#333333] flex items-center justify-center shrink-0 group-hover:border-[#E8D200]/20 transition-all shadow-2xl overflow-hidden">
                                                    {(reward.image_url || reward.partners?.logo_url) ? (
                                                        <img src={reward.image_url || reward.partners.logo_url} alt="" className="w-full h-full object-contain p-2" />
                                                    ) : (
                                                        <Award size={22} className="text-[#666666] group-hover:text-[#8a7600] transition-colors" />
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-base font-bold text-[#222222] group-hover:text-[#1A1A1A] transition-colors">{reward.title}</span>
                                                    </div>
                                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">{reward.category} SECTOR</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-1.5 h-1.5 rounded-full bg-[#E8D200]"></div>
                                                <span className="text-[11px] font-black text-[#BBB] uppercase tracking-[0.2em]">
                                                    {reward.brand_name || reward.partners?.name || 'STANDALONE'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-2xl font-light tracking-tighter text-[#8a7600]">
                                                    {reward.powr_cost.toLocaleString()}
                                                    </span>
                                                    <span className="text-[9px] uppercase tracking-[0.2em] text-[#666666] font-black">POWR</span>
                                                </div>
                                                {getRewardDisplayValue(reward) && (
                                                    <span
                                                        className="text-[10px] font-black uppercase tracking-[0.25em]"
                                                        style={{ color: reward.brand_color || '#E8D200' }}
                                                    >
                                                        {getRewardDisplayValue(reward)}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            {reward.stock === null ? (
                                                <div className="flex items-center gap-3">
                                                    <Activity size={12} className="text-[#888888]" />
                                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">Unlimited Supply</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <div className={`h-1.5 w-1.5 rounded-full ${reward.stock > 10 ? 'bg-blue-500/50' : reward.stock > 5 ? 'bg-orange-500/50' : 'bg-red-500/50'} shadow-[0_0_8px_rgba(255,255,255,0.1)]`} />
                                                        <span className="text-xs font-bold text-[#BBB]">{reward.stock} units</span>
                                                    </div>
                                                    <div className="w-24 h-[2px] bg-[#EFEFEC] rounded-full overflow-hidden">
                                                        <div className={`h-full transition-all ${reward.stock > 10 ? 'bg-blue-500/30' : 'bg-red-500/30'}`} style={{ width: `${Math.min(100, reward.stock * 5)}%` }}></div>
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <button
                                                onClick={() => handleToggleActive(reward)}
                                                disabled={togglingId === reward.id}
                                                className={`flex items-center gap-3 px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.3em] border transition-all ${
                                                    reward.active
                                                        ? 'bg-[#10B981]/5 text-[#10B981] border-[#10B981]/20 hover:bg-[#10B981]/10'
                                                        : 'bg-[#F4F4F1] text-[#666666] border-[#E6E6E1] hover:border-[#E6E6E1]'
                                                }`}
                                            >
                                                <div className={`h-1.5 w-1.5 rounded-full ${reward.active ? 'bg-[#10B981] animate-pulse' : 'bg-[#EFEFEC]'}`} />
                                                {reward.active ? 'Network Live' : 'Offline'}
                                            </button>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            {confirmDeleteId === reward.id ? (
                                                <div className="flex items-center justify-end gap-3 scale-90 origin-right transition-all">
                                                    <button onClick={() => handleDelete(reward.id)} className="h-10 px-6 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-[0.3em] rounded-full hover:bg-red-500/20 transition-all border border-red-500/20 shadow-lg shadow-red-500/5">DELETE</button>
                                                    <button onClick={() => setConfirmDeleteId(null)} className="h-10 px-6 bg-[#F4F4F1] text-[#666666] text-[10px] font-black uppercase tracking-[0.3em] rounded-full hover:text-[#333333] transition-all border border-[#E6E6E1]">CANCEL</button>
                                                </div>
                                            ) : (
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                    <button onClick={() => openEdit(reward)} className="w-12 h-12 flex items-center justify-center text-[#888888] hover:text-[#8a7600] hover:bg-[#E8D200]/5 rounded-2xl transition-all"><Edit2 size={16} /></button>
                                                    <button onClick={() => setConfirmDeleteId(reward.id)} className="w-12 h-12 flex items-center justify-center text-[#888888] hover:text-red-500 hover:bg-red-500/5 rounded-2xl transition-all"><Trash2 size={16} /></button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            </>
            )}

            {/* Inline editor page — replaces the vault list while open */}
            {editorOpen && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <button
                        type="button"
                        onClick={() => setEditorOpen(false)}
                        className="flex items-center gap-3 mb-10 text-[10px] uppercase tracking-[0.4em] text-[#666666] hover:text-[#8a7600] font-black transition-colors"
                    >
                        <ChevronLeft size={14} /> Back to Reward Vault
                    </button>
                    <div className="bg-[#F4F4F1] border border-[#E6E6E1] rounded-3xl w-full shadow-[0_0_100px_rgba(232,210,0,0.05)]">
                        <form onSubmit={handleSave} className="p-8 sm:p-12">
                            <div className="flex items-center justify-between mb-16">
                                <div className="flex items-center gap-8 min-w-0 flex-1 pr-8">
                                    <div className="w-24 h-24 rounded-3xl bg-white border border-[#E6E6E1] flex items-center justify-center shrink-0 overflow-hidden shadow-2xl">
                                        {(formData.image_url || editingReward?.partners?.logo_url) ? (
                                            <img src={formData.image_url || editingReward?.partners?.logo_url} alt="" className="w-full h-full object-contain p-3" />
                                        ) : (
                                            <Award size={32} className="text-[#BBBBBB]" />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-4xl font-light tracking-tighter text-[#1A1A1A] mb-3 truncate">{editingReward ? (formData.title || 'Edit Host Asset') : 'New Asset Protocol'}</h2>
                                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">
                                            {editingReward
                                                ? `${formData.brand_name ? `${formData.brand_name} — ` : ''}Edit Host Asset`
                                                : 'Configure Reward Parameters'}
                                        </p>
                                    </div>
                                </div>
                                <button type="button" onClick={() => setEditorOpen(false)} className="w-14 h-14 shrink-0 bg-white border border-[#E6E6E1] rounded-3xl flex items-center justify-center text-[#666666] hover:text-[#1A1A1A] hover:border-[#E8D200]/40 transition-all"><X size={20} /></button>
                            </div>

                            {/* Editor tabs — reward details · promo codes · partner brand & portal access */}
                            <div className="flex bg-white border border-[#E6E6E1] rounded-3xl p-2 gap-2 mb-12 max-w-2xl">
                                {[
                                    ['details', 'Reward Details', Award],
                                    ...(codesEligible ? [['codes', 'Promo Codes', Ticket]] : []),
                                    ['partner', 'Partner & Access', Building2],
                                ].map(([val, label, Icon]) => {
                                    const active = activeTab === val;
                                    return (
                                        <button
                                            key={val}
                                            type="button"
                                            onClick={() => setEditorTab(val)}
                                            className={`flex-1 flex items-center justify-center gap-3 h-12 rounded-[1.25rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all ${active ? 'bg-[#E8D200] text-[#080808]' : 'text-[#BBB] hover:text-[#8a7600]'}`}
                                        >
                                            <Icon size={14} /> {label}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className={activeTab === 'details' ? 'grid 2xl:grid-cols-[minmax(0,1fr)_360px] gap-x-16 gap-y-12 items-start' : 'hidden'}>
                            {/* Form fields — two columns when there's no phone beside them,
                                back to a single column once the live preview claims the right rail. */}
                            <div className="grid lg:grid-cols-2 2xl:grid-cols-1 gap-x-12 gap-y-0 min-w-0">
                            {/* Left column — identity & copy */}
                            <div>
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Brand Name <span className="text-[#999999] normal-case font-black ml-2">— shown on the reward card</span></label>
                                <input
                                    type="text"
                                    placeholder="E.G. TRIBE, BULK, HEADSPACE..."
                                    required
                                    className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-bold text-[#1A1A1A] placeholder-[#BBBBBB] uppercase tracking-[0.1em]"
                                    value={formData.brand_name}
                                    onChange={e => setFormData({ ...formData, brand_name: e.target.value })}
                                />
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Market Sector</label>
                                <select className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#222222] tracking-[0.1em] uppercase" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                                    {CATEGORIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                                </select>
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Asset Label</label>
                                <input type="text" required placeholder="PROTOCOL IDENTIFIER..." className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-bold text-[#1A1A1A] placeholder-[#BBBBBB] uppercase tracking-[0.2em]" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
                            </div>

                            {/* Image upload */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Logo Image</label>
                                <div className="flex gap-6 items-center bg-white border border-[#E6E6E1] rounded-[2rem] p-6">
                                    <div className="w-24 h-24 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center overflow-hidden shrink-0">
                                        {formData.image_url ? (
                                            <img src={formData.image_url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <ImageIcon size={28} className="text-[#666666]" />
                                        )}
                                    </div>
                                    <div className="flex-1 flex items-center gap-4">
                                        <label className="flex items-center gap-3 h-12 px-8 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#333333] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black cursor-pointer">
                                            <Upload size={14} /> {imageUploading ? 'Uploading...' : (formData.image_url ? 'Replace' : 'Upload')}
                                            <input type="file" accept="image/*" className="hidden" onChange={handleImagePick} disabled={imageUploading} />
                                        </label>
                                        {formData.image_url && (
                                            <button type="button" onClick={() => setFormData({ ...formData, image_url: '' })} className="text-[10px] uppercase tracking-[0.3em] text-[#555555] hover:text-red-500 transition-colors font-black">Remove</button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Intelligence Description</label>
                                <textarea rows={2} className="w-full p-8 bg-white border border-[#E6E6E1] rounded-[2rem] focus:border-[#E8D200]/40 outline-none transition-all text-sm text-[#222222] leading-relaxed resize-none" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                            </div>

                            {/* Offer description */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Offer Description <span className="text-[#333333] normal-case font-black ml-2">— shown when user expands the reward card</span></label>
                                <textarea rows={3} placeholder="E.G. REDEEM A 6-PACK TRIAL PACK OF TRIBE'S BEST-SELLING PLANT-BASED PROTEIN BARS — FREE WITH YOUR POWR POINTS." className="w-full p-6 bg-white border border-[#E6E6E1] rounded-[2rem] focus:border-[#E8D200]/40 outline-none transition-all text-sm text-[#222222] leading-relaxed resize-none" value={formData.offer} onChange={e => setFormData({ ...formData, offer: e.target.value })} />
                            </div>

                            {/* Partner blurb */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Partner Blurb <span className="text-[#333333] normal-case font-black ml-2">— "About" section on expanded card</span></label>
                                <textarea rows={2} placeholder="E.G. TRIBE MAKES NATURAL, PLANT-BASED PROTEIN BARS AND SHAKES, BUILT FOR REAL PERFORMANCE." className="w-full p-6 bg-white border border-[#E6E6E1] rounded-[2rem] focus:border-[#E8D200]/40 outline-none transition-all text-sm text-[#222222] leading-relaxed resize-none" value={formData.partner_blurb} onChange={e => setFormData({ ...formData, partner_blurb: e.target.value })} />
                            </div>

                            {/* Terms */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Terms &amp; Conditions</label>
                                <textarea rows={3} placeholder="E.G. SINGLE USE. VALID 90 DAYS. NOT COMBINABLE WITH OTHER OFFERS." className="w-full p-6 bg-white border border-[#E6E6E1] rounded-[2rem] focus:border-[#E8D200]/40 outline-none transition-all text-xs text-[#222222] leading-relaxed resize-none" value={formData.terms} onChange={e => setFormData({ ...formData, terms: e.target.value })} />
                            </div>
                            </div>

                            {/* Right column — pricing, media & config */}
                            <div>
                            {/* Kind + code source */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Reward Type</label>
                                <div className="flex bg-white border border-[#E6E6E1] rounded-3xl p-2 gap-2">
                                    {KINDS.map(k => {
                                        const active = formData.reward_kind === k;
                                        return (
                                            <button key={k} type="button" onClick={() => setFormData({ ...formData, reward_kind: k })} className={`flex-1 h-12 rounded-[1.25rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all ${active ? 'bg-[#E8D200] text-[#080808]' : 'text-[#BBB] hover:text-[#8a7600]'}`}>{k}</button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-1">Code Source</label>
                                <p className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black mb-3">Pool = upload codes · Auto = generate per user · Affiliate = shared link, no code</p>
                                <div className="flex bg-white border border-[#E6E6E1] rounded-3xl p-2 gap-2">
                                    {[['POOL', 'Pool'], ['API_VALIDATED', 'Auto'], ['AFFILIATE', 'Affiliate']].map(([val, label]) => {
                                        const active = formData.integration_type === val;
                                        return (
                                            <button key={val} type="button" onClick={() => setFormData({ ...formData, integration_type: val })} className={`flex-1 h-12 rounded-[1.25rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all ${active ? 'bg-[#E8D200] text-[#080808]' : 'text-[#BBB] hover:text-[#8a7600]'}`}>{label}</button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Value label */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Value Label <span className="text-[#333333] normal-case font-black ml-2">— e.g. £20 VALUE / 30% OFF</span></label>
                                <input type="text" placeholder="£20 VALUE" className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-black text-[#1A1A1A] placeholder-[#BBBBBB] uppercase tracking-[0.2em]" value={formData.value_label} onChange={e => setFormData({ ...formData, value_label: e.target.value })} />
                            </div>

                            <div className="grid grid-cols-2 gap-8 mb-8">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Discount Type</label>
                                    <select className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#222222] tracking-[0.1em] uppercase" value={formData.discount_type} onChange={e => setFormData({ ...formData, discount_type: e.target.value, discount_value: e.target.value ? formData.discount_value : '' })}>
                                        {DISCOUNT_TYPES.map(option => <option key={option.value || 'none'} value={option.value}>{option.label.toUpperCase()}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Discount Amount <span className="text-[#333333] normal-case font-black ml-2">— e.g. 50 or 10</span></label>
                                    <input type="number" min="0" step="0.01" placeholder={formData.discount_type === 'fixed_amount' ? '10' : '50'} disabled={!formData.discount_type} className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-black text-[#1A1A1A] placeholder-[#BBBBBB] tracking-[0.2em] disabled:opacity-40" value={formData.discount_value} onChange={e => setFormData({ ...formData, discount_value: e.target.value })} />
                                </div>
                            </div>

                            {getRewardDisplayValue(formData) && (
                                <div className="mb-8 rounded-[2rem] border border-[#E6E6E1] bg-white px-8 py-6">
                                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-3">Display Preview</div>
                                    <div className="text-sm font-black uppercase tracking-[0.25em]" style={{ color: formData.brand_color || '#E8D200' }}>
                                        {getRewardDisplayValue(formData)}
                                    </div>
                                </div>
                            )}

                            {/* Hero image upload */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Hero Banner Image <span className="text-[#333333] normal-case font-black ml-2">— large image shown on expanded card</span></label>
                                <div className="flex gap-6 items-center bg-white border border-[#E6E6E1] rounded-[2rem] p-6">
                                    <div className="w-32 h-20 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center overflow-hidden shrink-0">
                                        {formData.hero_image_url ? (
                                            <img src={formData.hero_image_url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <ImageIcon size={28} className="text-[#666666]" />
                                        )}
                                    </div>
                                    <div className="flex-1 flex items-center gap-4">
                                        <label className="flex items-center gap-3 h-12 px-8 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#333333] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black cursor-pointer">
                                            <Upload size={14} /> {formData.hero_image_url ? 'Replace' : 'Upload'}
                                            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                try {
                                                    const url = await uploadPublicImage('reward-images', file, 'heroes');
                                                    setFormData(prev => ({ ...prev, hero_image_url: url }));
                                                    toast.success('Hero image uploaded');
                                                } catch (err) {
                                                    toast.error(err.message || 'Upload failed');
                                                } finally {
                                                    e.target.value = '';
                                                }
                                            }} />
                                        </label>
                                        {formData.hero_image_url && (
                                            <button type="button" onClick={() => setFormData({ ...formData, hero_image_url: '' })} className="text-[10px] uppercase tracking-[0.3em] text-[#555555] hover:text-red-500 transition-colors font-black">Remove</button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Brand colour + URL */}
                            <div className="grid grid-cols-2 gap-8 mb-8">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Brand Colour <span className="text-[#333333] normal-case font-black ml-2">— accent hex e.g. #1877C7</span></label>
                                    <div className="flex items-center gap-4">
                                        <input type="text" placeholder="#E8D200" className="flex-1 h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-mono font-bold text-[#1A1A1A] placeholder-[#BBBBBB] uppercase tracking-[0.2em]" value={formData.brand_color} onChange={e => setFormData({ ...formData, brand_color: e.target.value })} />
                                        <div className="w-16 h-16 rounded-3xl border border-[#E6E6E1] shrink-0" style={{ backgroundColor: formData.brand_color || '#E6E6E1' }} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Product / Partner URL <span className="text-[#333333] normal-case font-black ml-2">— "Visit partner" link{formData.integration_type === 'AFFILIATE' ? ' · used as the affiliate destination' : ''}</span></label>
                                    <input type="url" placeholder="HTTPS://..." className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-bold text-[#1A1A1A] placeholder-[#BBBBBB] tracking-[0.1em]" value={formData.url} onChange={e => setFormData({ ...formData, url: e.target.value })} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-8 mb-12">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">POWR Value Cost</label>
                                    <input type="number" min="1" required className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-2xl font-light tracking-tighter text-[#8a7600]" value={formData.powr_cost} onChange={e => setFormData({ ...formData, powr_cost: parseInt(e.target.value) || 0 })} />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">
                                        Inventory Limit <span className="text-[#333333] normal-case font-black ml-2">— LEAVE EMPTY FOR UNLIMITED</span>
                                    </label>
                                    <input type="number" min="0" placeholder="INF" className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[14px] font-black text-[#1A1A1A] placeholder-[#BBBBBB] uppercase" value={formData.stock ?? ''} onChange={e => setFormData({ ...formData, stock: e.target.value === '' ? null : parseInt(e.target.value) })} />
                                </div>
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">
                                    Max Claims Per User <span className="text-[#333333] normal-case font-black ml-2">— LEAVE EMPTY FOR UNLIMITED</span>
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="e.g. 1 = one-time only, empty = unlimited"
                                    className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[14px] font-black text-[#1A1A1A] placeholder-[#BBBBBB]"
                                    value={formData.max_redemptions_per_user ?? ''}
                                    onChange={e => setFormData({ ...formData, max_redemptions_per_user: e.target.value === '' ? null : e.target.value })}
                                />
                                <p className="mt-3 text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black">
                                    User must re-earn enough POWR to claim again (subject to this cap)
                                </p>
                            </div>
                            </div>
                            </div>
                            {/* end two-column form fields */}

                            {/* Live app preview — mirrors the form, identical to the partner portal */}
                            <div className="hidden 2xl:block">
                                <div className="sticky top-8">
                                    <div className="flex items-center gap-3 mb-6 justify-center">
                                        <div className="h-[1px] w-8 bg-[#E8D200]" />
                                        <span className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black">In-App Preview</span>
                                    </div>
                                    <RewardAppPreview pageTheme="light" {...previewFromForm(formData, schemeExample)} />
                                </div>
                            </div>
                            </div>

                            {/* Promo Codes tab — code pool: format builder, generate/upload, ledger */}
                            {activeTab === 'codes' && codesEligible && (
                                <div className="mb-8 bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">

                                    {/* Header row with stats */}
                                    <div className="flex items-center justify-between px-8 pt-8 pb-4">
                                        <div className="flex items-center gap-4">
                                            <Ticket size={16} className="text-[#8a7600]" />
                                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">Code Pool</span>
                                            {codeStats && (
                                                <div className="flex items-center gap-5 ml-4 text-[10px] uppercase tracking-[0.3em] font-black">
                                                    <span className="text-[#10B981]">{codeStats.available} avail</span>
                                                    <span className="text-[#8a7600]">{codeStats.reserved} reserved</span>
                                                    <span className="text-[#555555]">{codeStats.used} used</span>
                                                    <span className="text-[#999999]">{codeStats.expired} exp</span>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleDownloadTemplate}
                                            className="flex items-center gap-2 h-9 px-5 bg-[#F4F4F1] border border-[#E8D200]/20 rounded-full text-[9px] uppercase tracking-[0.3em] text-[#8a7600] hover:bg-[#E8D200]/5 transition-all font-black"
                                        >
                                            <FileText size={11} /> Template
                                        </button>
                                    </div>

                                    {/* Code Format Builder */}
                                    <div className="px-8 py-5 border-b border-[#E6E6E1]">
                                        <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">Code Format</div>
                                        <div className="flex gap-3 items-center">
                                            <input
                                                type="text"
                                                placeholder="Enter one example code to define the format — e.g. POWR-TRIBE-ABC123"
                                                className="flex-1 h-11 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[11px] font-mono text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none uppercase tracking-[0.05em]"
                                                value={schemeExample}
                                                onChange={e => {
                                                    const v = e.target.value.toUpperCase();
                                                    setSchemeExample(v);
                                                    if (editingReward?.id) {
                                                        if (v) localStorage.setItem(`powr_scheme_${editingReward.id}`, v);
                                                        else localStorage.removeItem(`powr_scheme_${editingReward.id}`);
                                                    }
                                                }}
                                            />
                                            {schemeExample && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setSchemeExample('');
                                                        if (editingReward?.id) localStorage.removeItem(`powr_scheme_${editingReward.id}`);
                                                    }}
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

                                    {/* Auto-generate row */}
                                    <div className="px-8 py-5 border-b border-[#E6E6E1]">
                                        <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">Auto-Generate</div>
                                        <div className="flex gap-3 items-center">
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
                                                disabled={generatingCodes || !editingReward}
                                                className="h-11 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-2px] disabled:opacity-40"
                                            >
                                                {generatingCodes ? 'Generating...' : 'Generate Batch'}
                                            </button>
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">
                                                using {parsedScheme ? `${parsedScheme.prefix}•••` : 'default POWR format'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Upload row */}
                                    <div className="px-8 pb-6 border-b border-[#E6E6E1]">
                                        <div className="flex items-center justify-between mb-3 px-4 py-2 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black">Send template to partner → they fill it in → upload here</span>
                                        </div>
                                        <div className="flex gap-3 mb-3">
                                            <input
                                                type="text"
                                                placeholder={parsedScheme ? `${parsedScheme.prefix}XXXXXX  (single code)` : 'POWR-TRIBE-XXXXXX  (single code)'}
                                                className="flex-1 h-11 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[11px] font-mono text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none uppercase tracking-[0.05em]"
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
                                            placeholder={'Paste codes or drop partner CSV — Status + Deleted at columns respected automatically'}
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

                                    {/* Ledger */}
                                    <div className="px-6 py-5">
                                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                            <div className="flex items-center gap-4">
                                                <span className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black whitespace-nowrap">
                                                    Ledger {codePool.total > 0 && `· ${codePool.total} total`}
                                                </span>
                                                {codePool.total > 0 && (
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDownloadCodes('csv')}
                                                            className="flex items-center gap-1.5 h-7 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] uppercase tracking-[0.3em] text-[#555555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black"
                                                        >
                                                            <Download size={10} /> CSV
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDownloadCodes('xlsx')}
                                                            className="flex items-center gap-1.5 h-7 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] uppercase tracking-[0.3em] text-[#555555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all font-black"
                                                        >
                                                            <Download size={10} /> Excel
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-1 gap-1">
                                                {['all', 'available', 'reserved', 'used', 'expired'].map(s => (
                                                    <button
                                                        key={s}
                                                        type="button"
                                                        onClick={() => refreshCodePool(editingReward.id, 0, s)}
                                                        className={`h-7 px-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all ${codePoolStatus === s ? 'bg-[#E8D200] text-[#080808]' : 'text-[#888888] hover:text-[#333333]'}`}
                                                    >
                                                        {s}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

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
                                            <div className="text-center py-10">
                                                <p className="text-[10px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black">{codeSearch ? `No codes matching "${codeSearch}"` : `No codes${codePoolStatus !== 'all' ? ` with status "${codePoolStatus}"` : ' uploaded yet'}`}</p>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="rounded-2xl border border-[#E6E6E1] overflow-x-auto mb-4">
                                                    <table className="w-full text-left border-collapse">
                                                        <thead>
                                                            <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                                                {['Code', 'Status', 'Claimed by', 'Claimed at', 'Used at', 'Expires', ''].map(h => (
                                                                    <th key={h} className="px-3 py-3 text-[9px] font-black uppercase tracking-[0.4em] text-[#999999] whitespace-nowrap">{h}</th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-[#E6E6E1]">
                                                            {codePool.rows.map(row => {
                                                                const statusColor = {
                                                                    available: 'text-[#10B981]',
                                                                    reserved:  'text-[#8a7600]',
                                                                    used:      'text-[#0EA5E9]',
                                                                    expired:   'text-[#999999]',
                                                                }[row.status] ?? 'text-[#666666]';
                                                                const claimedBy = row.profiles?.display_name || row.profiles?.username || (row.assigned_user_id ? row.assigned_user_id.slice(0, 8) + '…' : '—');
                                                                const fmt = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
                                                                return (
                                                                    <tr key={row.id} className="hover:bg-[#F4F4F1] transition-all">
                                                                        <td className="px-3 py-3 font-mono text-[11px] text-[#8a7600] tracking-[0.1em] whitespace-nowrap">{row.code}</td>
                                                                        <td className="px-3 py-3">
                                                                            <span className={`text-[9px] font-black uppercase tracking-[0.3em] ${statusColor}`}>{row.status}</span>
                                                                        </td>
                                                                        <td className="px-3 py-3 text-[11px] text-[#BBB]">{claimedBy}</td>
                                                                        <td className="px-3 py-3 text-[11px] text-[#888888]">{fmt(row.assigned_at)}</td>
                                                                        <td className="px-3 py-3 text-[11px] text-[#888888]">{fmt(row.used_at)}</td>
                                                                        <td className="px-3 py-3 text-[11px] text-[#888888]">{fmt(row.expires_at)}</td>
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
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                {/* Pagination */}
                                                {codePool.total > CODE_POOL_PAGE_SIZE && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black">
                                                            {codePoolPage * CODE_POOL_PAGE_SIZE + 1}–{Math.min((codePoolPage + 1) * CODE_POOL_PAGE_SIZE, codePool.total)} of {codePool.total}
                                                        </span>
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                disabled={codePoolPage === 0}
                                                                onClick={() => refreshCodePool(editingReward.id, codePoolPage - 1, codePoolStatus)}
                                                                className="h-9 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#888888] hover:text-[#333333] disabled:opacity-30 font-black transition-all"
                                                            >← Prev</button>
                                                            <button
                                                                type="button"
                                                                disabled={(codePoolPage + 1) * CODE_POOL_PAGE_SIZE >= codePool.total}
                                                                onClick={() => refreshCodePool(editingReward.id, codePoolPage + 1, codePoolStatus)}
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

                            {/* Partner & Access tab — brand identity summary + portal logins */}
                            {activeTab === 'partner' && (
                                <div className="mb-8 space-y-8">
                                    {/* Brand identity card */}
                                    <div className="bg-white border border-[#E6E6E1] rounded-[2rem] p-8">
                                        <div className="flex items-center gap-3 mb-8">
                                            <Building2 size={16} className="text-[#8a7600]" />
                                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">Reward Partner</span>
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black ml-1">— edit these on the Reward Details tab</span>
                                        </div>

                                        <div className="flex items-start gap-8 mb-10">
                                            <div className="w-20 h-20 rounded-3xl bg-[#111111] border border-[#333333] flex items-center justify-center shrink-0 overflow-hidden">
                                                {(formData.image_url || editingReward?.partners?.logo_url) ? (
                                                    <img src={formData.image_url || editingReward?.partners?.logo_url} alt="" className="w-full h-full object-contain p-2" />
                                                ) : (
                                                    <Award size={28} className="text-[#666666]" />
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-2xl font-light tracking-tight text-[#1A1A1A] mb-2 truncate">
                                                    {formData.brand_name || 'Unnamed brand'}
                                                </div>
                                                <span className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">{formData.category} sector</span>
                                            </div>
                                        </div>

                                        <dl className="grid sm:grid-cols-2 gap-x-10 gap-y-6">
                                            <div>
                                                <dt className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2 flex items-center gap-2"><Palette size={11} /> Brand Colour</dt>
                                                <dd className="flex items-center gap-3">
                                                    <span className="w-6 h-6 rounded-lg border border-[#E6E6E1] shrink-0" style={{ backgroundColor: formData.brand_color || '#E6E6E1' }} />
                                                    <span className="text-[12px] font-mono font-bold text-[#222222]">{formData.brand_color || '—'}</span>
                                                </dd>
                                            </div>
                                            <div className="min-w-0">
                                                <dt className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2 flex items-center gap-2"><Link2 size={11} /> Partner URL</dt>
                                                <dd className="text-[12px] font-bold text-[#222222] truncate">
                                                    {formData.url ? (
                                                        <a href={formData.url} target="_blank" rel="noreferrer" className="text-[#8a7600] hover:underline">{formData.url}</a>
                                                    ) : '—'}
                                                </dd>
                                            </div>
                                            <div className="sm:col-span-2">
                                                <dt className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2">Partner Blurb</dt>
                                                <dd className="text-sm text-[#444444] leading-relaxed">{formData.partner_blurb || '—'}</dd>
                                            </div>
                                        </dl>
                                    </div>

                                    {/* Per-brand reward cap */}
                                    <BrandRewardLimit brandName={formData.brand_name?.trim() || ''} />

                                    {/* Portal logins / email management */}
                                    <BrandAccessPanel brandName={formData.brand_name?.trim() || ''} />
                                </div>
                            )}

                            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-10 bg-white border border-[#E6E6E1] rounded-[2rem] p-8">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-8 sm:gap-14">
                                    <div className="flex items-center gap-4">
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, active: !formData.active })}
                                            className={`w-12 h-7 rounded-full transition-all relative shrink-0 ${formData.active ? 'bg-[#E8D200]' : 'bg-[#EFEFEC]'}`}
                                        >
                                            <span className={`absolute top-1 w-5 h-5 rounded-full transition-all ${formData.active ? 'left-[24px] bg-white' : 'left-1 bg-white'}`} />
                                        </button>
                                        <span className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black whitespace-nowrap">Broadcast Live to Network</span>
                                    </div>
                                </div>
                                <div className="flex gap-4 shrink-0">
                                    <button type="button" onClick={() => setEditorOpen(false)} className="h-16 px-10 text-[11px] uppercase tracking-[0.4em] font-black text-[#666666] hover:text-[#BBB] transition-colors">Abort</button>
                                    <button type="submit" disabled={saving} className="h-16 px-12 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.4em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20 disabled:opacity-50">
                                        {saving ? 'SYNCING...' : 'COMMIT PROTOCOL'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Portal Access modal — manage brand logins for the partner portal */}
            {portalAccessOpen && (
                <BrandPortalAccess brands={portalBrands} onClose={() => setPortalAccessOpen(false)} />
            )}
        </div>
    );
}
