import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { Plus, Edit2, Trash2, Ticket, Loader2, X, Search, Award, Activity, ChevronRight, AlertTriangle, Upload, Image as ImageIcon, Tag, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { uploadPublicImage } from '../../lib/storage';
import { parseCodes, uploadCodes, fetchCodeStats, fetchCodePool, getCSVTemplate } from '../../lib/promoCodes';

const CATEGORIES = ['gym', 'fashion', 'gear', 'nutrition', 'food', 'health'];
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

const EMPTY_FORM = {
    partner_id: '',
    brand_name: '',
    title: '',
    description: '',
    powr_cost: 100,
    category: 'gym',
    stock: null,
    active: true,
    featured_on_home: false,
    reward_kind: 'digital',
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
    const [isModalOpen, setIsModalOpen] = useState(false);
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
    const CODE_POOL_PAGE_SIZE = 20;

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        const [rew, part] = await Promise.all([
            supabase.from('rewards').select('*, partners(name, partner_code, logo_url)').order('created_at', { ascending: false }),
            supabase.from('partners').select('id, name, partner_code, roles').contains('roles', ['reward_provider']).order('name'),
        ]);
        if (rew.error) toast.error('Failed to load inventory');
        else setRewards(rew.data || []);
        if (part.data) setPartners(part.data);
        setLoading(false);
    };

    const refreshCodeStats = async (rewardId) => {
        if (!rewardId) { setCodeStats(null); return; }
        try { setCodeStats(await fetchCodeStats(rewardId)); }
        catch { setCodeStats(null); }
    };

    const refreshCodePool = async (rewardId, page = 0, status = 'all') => {
        if (!rewardId) { setCodePool({ rows: [], total: 0 }); return; }
        setCodePoolLoading(true);
        try {
            const result = await fetchCodePool({ rewardId, status, page, pageSize: CODE_POOL_PAGE_SIZE });
            setCodePool(result);
            setCodePoolPage(page);
            setCodePoolStatus(status);
        } catch { setCodePool({ rows: [], total: 0 }); }
        finally { setCodePoolLoading(false); }
    };

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
        setFormData({ ...EMPTY_FORM });
        setCodeStats(null);
        setCodePool({ rows: [], total: 0 });
        setCodePoolPage(0);
        setCodePoolStatus('all');
        setBulkCodesText('');
        setSingleCode('');
        setIsModalOpen(true);
    };

    const openEdit = async (reward) => {
        setEditingReward(reward);
        setFormData({
            partner_id: reward.partner_id,
            brand_name: reward.brand_name || '',
            title: reward.title,
            description: reward.description || '',
            powr_cost: reward.powr_cost,
            category: reward.category,
            stock: reward.stock,
            active: reward.active,
            featured_on_home: reward.featured_on_home || false,
            reward_kind: reward.reward_kind || 'digital',
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
        setCodePoolPage(0);
        setCodePoolStatus('all');
        await Promise.all([refreshCodeStats(reward.id), refreshCodePool(reward.id)]);
        setIsModalOpen(true);
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
            const result = await uploadCodes({ rewardId: editingReward.id, codes });
            toast.success(`${result.accepted} accepted · ${result.rejected.length} rejected`);
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

    const handleDownloadTemplate = () => {
        const partner = partners.find(p => p.id === formData.partner_id);
        const partnerCode = partner?.partner_code ?? 'XXXX';
        const csv = getCSVTemplate(partnerCode);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `POWR-${partnerCode}-codes-template.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleAddSingleCode = async () => {
        if (!editingReward) { toast.error('Save the reward first'); return; }
        if (!singleCode.trim()) return;
        setUploadingCodes(true);
        try {
            const result = await uploadCodes({ rewardId: editingReward.id, codes: [singleCode] });
            if (result.accepted === 1) {
                toast.success('Code added');
                setSingleCode('');
                await refreshCodeStats(editingReward.id);
                await refreshCodePool(editingReward.id, 0, codePoolStatus);
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
            partner_id: formData.partner_id || null,
            brand_name: formData.brand_name || null,
            discount_type: formData.discount_type || null,
            discount_value: formData.discount_type && formData.discount_value !== '' ? Number(formData.discount_value) : null,
            max_redemptions_per_user: formData.max_redemptions_per_user !== '' && formData.max_redemptions_per_user !== null
                ? parseInt(formData.max_redemptions_per_user, 10)
                : null,
        };
        // Partial unique index only allows one featured_on_home=true row.
        // Clear any existing featured reward first so the upsert doesn't conflict.
        if (formData.featured_on_home) {
            const excludeId = editingReward?.id;
            const query = supabase.from('rewards').update({ featured_on_home: false }).eq('featured_on_home', true);
            if (excludeId) query.neq('id', excludeId);
            await query;
        }
        const { error } = editingReward
            ? await supabase.from('rewards').update(payload).eq('id', editingReward.id)
            : await supabase.from('rewards').insert([payload]);
        if (error) {
            toast.error(error.message);
        } else {
            toast.success(editingReward ? 'Inventory synchronized' : 'New reward deployed');
            setIsModalOpen(false);
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
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#10B981]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#10B981] font-black">Subsystem / Inventory</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-6">Reward Vault</h1>
                    <p className="text-[#999] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Management of global digital assets and retail partner redemptions.
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    className="flex items-center gap-4 h-16 px-10 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20 shrink-0"
                >
                    <Plus size={18} /> Initialize Reward
                </button>
            </div>

            {/* Controls */}
            <div className="flex flex-col lg:flex-row gap-6 mb-12">
                <div className="relative flex-1 group">
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#777] group-focus-within:text-[#E8D200] transition-colors" />
                    <input
                        type="text"
                        placeholder="SEARCH INVENTORY ASSETS..."
                        className="w-full h-16 pl-16 pr-8 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] text-[11px] font-black tracking-[0.2em] text-[#F2F2F2] placeholder-[#151515] focus:border-[#E8D200]/40 outline-none transition-all uppercase"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex bg-[#0A0A0A] border border-[#151515] rounded-[2rem] p-2 gap-2 overflow-x-auto no-scrollbar">
                    <select
                        value={filterCat}
                        onChange={e => setFilterCat(e.target.value)}
                        className="h-12 px-6 bg-[#050505] border border-[#151515] rounded-[1.5rem] text-[10px] text-[#AAA] font-black uppercase tracking-[0.2em] outline-none cursor-pointer focus:border-[#E8D200]/20"
                    >
                        <option value="all">All Sectors</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                    </select>
                    <select
                        value={filterPartner}
                        onChange={e => setFilterPartner(e.target.value)}
                        className="h-12 px-6 bg-[#050505] border border-[#151515] rounded-[1.5rem] text-[10px] text-[#AAA] font-black uppercase tracking-[0.2em] outline-none cursor-pointer focus:border-[#E8D200]/20 max-w-[200px]"
                    >
                        <option value="all">All Brands</option>
                        <option value="__standalone__">Standalone</option>
                        {partners.map(p => <option key={p.id} value={p.id}>{p.name.toUpperCase()}</option>)}
                    </select>
                </div>
            </div>

            {/* Content Container */}
            <div className="bg-[#0A0A0A] border border-[#151515] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#10B981]/20 border-t-[#10B981] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#999] font-black">Syncing Vault...</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#050505] border-b border-[#151515]">
                                    {['Reward / Asset', 'Partner Node', 'Cost / Value', 'Inventory', 'Status', ''].map(h => (
                                        <th key={h} className={`px-12 py-8 text-[10px] font-black uppercase tracking-[0.5em] text-[#777] ${h === '' ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#111]">
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-12 py-32 text-center">
                                            <div className="flex flex-col items-center gap-6">
                                                <div className="w-20 h-20 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center">
                                                    <Ticket size={32} className="text-[#CCC]" />
                                                </div>
                                                <p className="text-[11px] uppercase tracking-[0.4em] text-[#777] font-black">Vault Empty</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filtered.map(reward => (
                                    <tr key={reward.id} className="group hover:bg-[#080808] transition-all">
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-8">
                                                <div className="w-14 h-14 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0 group-hover:border-[#E8D200]/20 transition-all shadow-2xl">
                                                    <Award size={22} className="text-[#999] group-hover:text-[#E8D200]/60 transition-colors" />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-base font-bold text-[#DDD] group-hover:text-[#F2F2F2] transition-colors">{reward.title}</span>
                                                        {reward.featured_on_home && (
                                                            <span className="px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.3em] bg-[#E8D200]/10 text-[#E8D200] border border-[#E8D200]/20 rounded-full">Home</span>
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black">{reward.category} SECTOR</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-3">
                                                <div className="w-1.5 h-1.5 rounded-full bg-[#E8D200]"></div>
                                                <span className="text-[11px] font-black text-[#BBB] uppercase tracking-[0.2em]">
                                                    {reward.partners?.name || reward.brand_name || 'STANDALONE'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10">
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-3xl font-light tracking-tighter text-[#E8D200]">
                                                    {reward.powr_cost.toLocaleString()}
                                                    </span>
                                                    <span className="text-[9px] uppercase tracking-[0.2em] text-[#999] font-black">POWR</span>
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
                                        <td className="px-12 py-10">
                                            {reward.stock === null ? (
                                                <div className="flex items-center gap-3">
                                                    <Activity size={12} className="text-[#777]" />
                                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black">Unlimited Supply</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <div className={`h-1.5 w-1.5 rounded-full ${reward.stock > 10 ? 'bg-blue-500/50' : reward.stock > 5 ? 'bg-orange-500/50' : 'bg-red-500/50'} shadow-[0_0_8px_rgba(255,255,255,0.1)]`} />
                                                        <span className="text-xs font-bold text-[#BBB]">{reward.stock} units</span>
                                                    </div>
                                                    <div className="w-24 h-[2px] bg-[#111] rounded-full overflow-hidden">
                                                        <div className={`h-full transition-all ${reward.stock > 10 ? 'bg-blue-500/30' : 'bg-red-500/30'}`} style={{ width: `${Math.min(100, reward.stock * 5)}%` }}></div>
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-12 py-10 whitespace-nowrap">
                                            <button
                                                onClick={() => handleToggleActive(reward)}
                                                disabled={togglingId === reward.id}
                                                className={`flex items-center gap-3 px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.3em] border transition-all ${
                                                    reward.active
                                                        ? 'bg-[#10B981]/5 text-[#10B981] border-[#10B981]/20 hover:bg-[#10B981]/10'
                                                        : 'bg-[#050505] text-[#999] border-[#151515] hover:border-[#222]'
                                                }`}
                                            >
                                                <div className={`h-1.5 w-1.5 rounded-full ${reward.active ? 'bg-[#10B981] animate-pulse' : 'bg-[#151515]'}`} />
                                                {reward.active ? 'Network Live' : 'Offline'}
                                            </button>
                                        </td>
                                        <td className="px-12 py-10 text-right">
                                            {confirmDeleteId === reward.id ? (
                                                <div className="flex items-center justify-end gap-3 scale-90 origin-right transition-all">
                                                    <button onClick={() => handleDelete(reward.id)} className="h-10 px-6 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-[0.3em] rounded-full hover:bg-red-500/20 transition-all border border-red-500/20 shadow-lg shadow-red-500/5">DELETE</button>
                                                    <button onClick={() => setConfirmDeleteId(null)} className="h-10 px-6 bg-[#050505] text-[#999] text-[10px] font-black uppercase tracking-[0.3em] rounded-full hover:text-[#CCC] transition-all border border-[#151515]">CANCEL</button>
                                                </div>
                                            ) : (
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                    <button onClick={() => openEdit(reward)} className="w-12 h-12 flex items-center justify-center text-[#777] hover:text-[#E8D200] hover:bg-[#E8D200]/5 rounded-2xl transition-all"><Edit2 size={16} /></button>
                                                    <button onClick={() => setConfirmDeleteId(reward.id)} className="w-12 h-12 flex items-center justify-center text-[#777] hover:text-red-500 hover:bg-red-500/5 rounded-2xl transition-all"><Trash2 size={16} /></button>
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

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="flex min-h-full items-center justify-center p-8">
                    <div className="bg-[#050505] border border-[#151515] rounded-3xl w-full max-w-3xl shadow-[0_0_100px_rgba(232,210,0,0.05)]">
                        <form onSubmit={handleSave} className="p-12">
                            <div className="flex items-center justify-between mb-16">
                                <div>
                                    <h2 className="text-4xl font-light tracking-tighter text-[#F2F2F2] mb-3">{editingReward ? 'Edit Host Asset' : 'New Asset Protocol'}</h2>
                                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black">Configure Reward Parameters</p>
                                </div>
                                <button type="button" onClick={() => setIsModalOpen(false)} className="w-14 h-14 bg-[#0A0A0A] border border-[#151515] rounded-3xl flex items-center justify-center text-[#999] hover:text-[#F2F2F2] hover:border-[#E8D200]/40 transition-all"><X size={20} /></button>
                            </div>

                            <div className="grid grid-cols-2 gap-8 mb-8">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Reward Brand <span className="text-[#555] normal-case font-black ml-2">— optional</span></label>
                                    <select className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#DDD] tracking-[0.1em] uppercase" value={formData.partner_id} onChange={e => setFormData({ ...formData, partner_id: e.target.value })}>
                                        <option value="">— Standalone / No Brand —</option>
                                        {partners.map(p => <option key={p.id} value={p.id}>{p.name.toUpperCase()}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">
                                        Brand Name
                                        {formData.partner_id
                                            ? <span className="text-[#555] normal-case font-black ml-2">— overrides partner name</span>
                                            : <span className="text-[#E8D200]/60 normal-case font-black ml-2">— required for standalone</span>}
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="E.G. TRIBE, BULK, HEADSPACE..."
                                        required={!formData.partner_id}
                                        className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-bold text-[#F2F2F2] placeholder-[#151515] uppercase tracking-[0.1em]"
                                        value={formData.brand_name}
                                        onChange={e => setFormData({ ...formData, brand_name: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-8 mb-8">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Market Sector</label>
                                    <select className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#DDD] tracking-[0.1em] uppercase" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                                        {CATEGORIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Asset Label</label>
                                <input type="text" required placeholder="PROTOCOL IDENTIFIER..." className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-bold text-[#F2F2F2] placeholder-[#151515] uppercase tracking-[0.2em]" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Intelligence Description</label>
                                <textarea rows={2} className="w-full p-8 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] focus:border-[#E8D200]/40 outline-none transition-all text-sm text-[#DDD] leading-relaxed resize-none" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                            </div>

                            {/* Kind + value label */}
                            <div className="grid grid-cols-2 gap-8 mb-8">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Reward Type</label>
                                    <div className="flex bg-[#0A0A0A] border border-[#151515] rounded-3xl p-2 gap-2">
                                        {KINDS.map(k => {
                                            const active = formData.reward_kind === k;
                                            return (
                                                <button key={k} type="button" onClick={() => setFormData({ ...formData, reward_kind: k })} className={`flex-1 h-12 rounded-[1.25rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all ${active ? 'bg-[#E8D200] text-[#080808]' : 'text-[#BBB] hover:text-[#E8D200]'}`}>{k}</button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Value Label <span className="text-[#CCC] normal-case font-black ml-2">— e.g. £20 VALUE / 30% OFF</span></label>
                                    <input type="text" placeholder="£20 VALUE" className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-black text-[#F2F2F2] placeholder-[#151515] uppercase tracking-[0.2em]" value={formData.value_label} onChange={e => setFormData({ ...formData, value_label: e.target.value })} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-8 mb-8">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Discount Type</label>
                                    <select className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#DDD] tracking-[0.1em] uppercase" value={formData.discount_type} onChange={e => setFormData({ ...formData, discount_type: e.target.value, discount_value: e.target.value ? formData.discount_value : '' })}>
                                        {DISCOUNT_TYPES.map(option => <option key={option.value || 'none'} value={option.value}>{option.label.toUpperCase()}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Discount Amount <span className="text-[#CCC] normal-case font-black ml-2">— e.g. 50 or 10</span></label>
                                    <input type="number" min="0" step="0.01" placeholder={formData.discount_type === 'fixed_amount' ? '10' : '50'} disabled={!formData.discount_type} className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-black text-[#F2F2F2] placeholder-[#151515] tracking-[0.2em] disabled:opacity-40" value={formData.discount_value} onChange={e => setFormData({ ...formData, discount_value: e.target.value })} />
                                </div>
                            </div>

                            {getRewardDisplayValue(formData) && (
                                <div className="mb-8 rounded-[2rem] border border-[#151515] bg-[#0A0A0A] px-8 py-6">
                                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-3">Display Preview</div>
                                    <div className="text-sm font-black uppercase tracking-[0.25em]" style={{ color: formData.brand_color || '#E8D200' }}>
                                        {getRewardDisplayValue(formData)}
                                    </div>
                                </div>
                            )}

                            {/* Image upload */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Logo Image</label>
                                <div className="flex gap-6 items-center bg-[#0A0A0A] border border-[#151515] rounded-[2rem] p-6">
                                    <div className="w-24 h-24 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center overflow-hidden shrink-0">
                                        {formData.image_url ? (
                                            <img src={formData.image_url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <ImageIcon size={28} className="text-[#999]" />
                                        )}
                                    </div>
                                    <div className="flex-1 flex items-center gap-4">
                                        <label className="flex items-center gap-3 h-12 px-8 bg-[#050505] border border-[#151515] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#CCC] hover:text-[#E8D200] hover:border-[#E8D200]/40 transition-all font-black cursor-pointer">
                                            <Upload size={14} /> {imageUploading ? 'Uploading...' : (formData.image_url ? 'Replace' : 'Upload')}
                                            <input type="file" accept="image/*" className="hidden" onChange={handleImagePick} disabled={imageUploading} />
                                        </label>
                                        {formData.image_url && (
                                            <button type="button" onClick={() => setFormData({ ...formData, image_url: '' })} className="text-[10px] uppercase tracking-[0.3em] text-[#AAA] hover:text-red-500 transition-colors font-black">Remove</button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Terms */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Terms &amp; Conditions</label>
                                <textarea rows={3} placeholder="E.G. SINGLE USE. VALID 90 DAYS. NOT COMBINABLE WITH OTHER OFFERS." className="w-full p-6 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] focus:border-[#E8D200]/40 outline-none transition-all text-xs text-[#DDD] leading-relaxed resize-none" value={formData.terms} onChange={e => setFormData({ ...formData, terms: e.target.value })} />
                            </div>

                            {/* Offer description */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Offer Description <span className="text-[#CCC] normal-case font-black ml-2">— shown when user expands the reward card</span></label>
                                <textarea rows={3} placeholder="E.G. REDEEM A 6-PACK TRIAL PACK OF TRIBE'S BEST-SELLING PLANT-BASED PROTEIN BARS — FREE WITH YOUR POWR POINTS." className="w-full p-6 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] focus:border-[#E8D200]/40 outline-none transition-all text-sm text-[#DDD] leading-relaxed resize-none" value={formData.offer} onChange={e => setFormData({ ...formData, offer: e.target.value })} />
                            </div>

                            {/* Partner blurb */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Partner Blurb <span className="text-[#CCC] normal-case font-black ml-2">— "About" section on expanded card</span></label>
                                <textarea rows={2} placeholder="E.G. TRIBE MAKES NATURAL, PLANT-BASED PROTEIN BARS AND SHAKES, BUILT FOR REAL PERFORMANCE." className="w-full p-6 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] focus:border-[#E8D200]/40 outline-none transition-all text-sm text-[#DDD] leading-relaxed resize-none" value={formData.partner_blurb} onChange={e => setFormData({ ...formData, partner_blurb: e.target.value })} />
                            </div>

                            {/* Hero image upload */}
                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Hero Banner Image <span className="text-[#CCC] normal-case font-black ml-2">— large image shown on expanded card</span></label>
                                <div className="flex gap-6 items-center bg-[#0A0A0A] border border-[#151515] rounded-[2rem] p-6">
                                    <div className="w-32 h-20 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center overflow-hidden shrink-0">
                                        {formData.hero_image_url ? (
                                            <img src={formData.hero_image_url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <ImageIcon size={28} className="text-[#999]" />
                                        )}
                                    </div>
                                    <div className="flex-1 flex items-center gap-4">
                                        <label className="flex items-center gap-3 h-12 px-8 bg-[#050505] border border-[#151515] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#CCC] hover:text-[#E8D200] hover:border-[#E8D200]/40 transition-all font-black cursor-pointer">
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
                                            <button type="button" onClick={() => setFormData({ ...formData, hero_image_url: '' })} className="text-[10px] uppercase tracking-[0.3em] text-[#AAA] hover:text-red-500 transition-colors font-black">Remove</button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Brand colour + URL */}
                            <div className="grid grid-cols-2 gap-8 mb-8">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Brand Colour <span className="text-[#CCC] normal-case font-black ml-2">— accent hex e.g. #1877C7</span></label>
                                    <div className="flex items-center gap-4">
                                        <input type="text" placeholder="#E8D200" className="flex-1 h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-mono font-bold text-[#F2F2F2] placeholder-[#151515] uppercase tracking-[0.2em]" value={formData.brand_color} onChange={e => setFormData({ ...formData, brand_color: e.target.value })} />
                                        <div className="w-16 h-16 rounded-3xl border border-[#151515] shrink-0" style={{ backgroundColor: formData.brand_color || '#222' }} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">Product / Partner URL <span className="text-[#CCC] normal-case font-black ml-2">— "Visit partner" link</span></label>
                                    <input type="url" placeholder="HTTPS://..." className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-bold text-[#F2F2F2] placeholder-[#151515] tracking-[0.1em]" value={formData.url} onChange={e => setFormData({ ...formData, url: e.target.value })} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-8 mb-12">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">POWR Value Cost</label>
                                    <input type="number" min="1" required className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-2xl font-light tracking-tighter text-[#E8D200]" value={formData.powr_cost} onChange={e => setFormData({ ...formData, powr_cost: parseInt(e.target.value) || 0 })} />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">
                                        Inventory Limit <span className="text-[#CCC] normal-case font-black ml-2">— LEAVE EMPTY FOR UNLIMITED</span>
                                    </label>
                                    <input type="number" min="0" placeholder="INF" className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[14px] font-black text-[#F2F2F2] placeholder-[#151515] uppercase" value={formData.stock ?? ''} onChange={e => setFormData({ ...formData, stock: e.target.value === '' ? null : parseInt(e.target.value) })} />
                                </div>
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#999] font-black mb-4">
                                    Max Claims Per User <span className="text-[#CCC] normal-case font-black ml-2">— LEAVE EMPTY FOR UNLIMITED</span>
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="e.g. 1 = one-time only, empty = unlimited"
                                    className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[14px] font-black text-[#F2F2F2] placeholder-[#333]"
                                    value={formData.max_redemptions_per_user ?? ''}
                                    onChange={e => setFormData({ ...formData, max_redemptions_per_user: e.target.value === '' ? null : e.target.value })}
                                />
                                <p className="mt-3 text-[10px] uppercase tracking-[0.3em] text-[#555] font-black">
                                    User must re-earn enough POWR to claim again (subject to this cap)
                                </p>
                            </div>

                            {/* Code pool — upload + ledger */}
                            {editingReward && formData.reward_kind === 'digital' && (
                                <div className="mb-8 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden">

                                    {/* Header row with stats */}
                                    <div className="flex items-center justify-between px-8 pt-8 pb-4">
                                        <div className="flex items-center gap-4">
                                            <Ticket size={16} className="text-[#E8D200]" />
                                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#CCC] font-black">Code Pool</span>
                                            {codeStats && (
                                                <div className="flex items-center gap-5 ml-4 text-[10px] uppercase tracking-[0.3em] font-black">
                                                    <span className="text-[#10B981]">{codeStats.available} avail</span>
                                                    <span className="text-[#E8D200]">{codeStats.reserved} reserved</span>
                                                    <span className="text-[#AAA]">{codeStats.used} used</span>
                                                    <span className="text-[#666]">{codeStats.expired} exp</span>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleDownloadTemplate}
                                            className="flex items-center gap-2 h-9 px-5 bg-[#050505] border border-[#E8D200]/20 rounded-full text-[9px] uppercase tracking-[0.3em] text-[#E8D200] hover:bg-[#E8D200]/5 transition-all font-black"
                                        >
                                            <FileText size={11} /> Template
                                        </button>
                                    </div>

                                    {/* Upload row */}
                                    <div className="px-8 pb-6 border-b border-[#151515]">
                                        <div className="flex items-center justify-between mb-3 px-4 py-2 bg-[#050505] border border-[#151515] rounded-2xl">
                                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#555] font-black">Send template to partner → they fill it in → upload here</span>
                                        </div>
                                        <div className="flex gap-3 mb-3">
                                            <input
                                                type="text"
                                                placeholder="POWR-TRIBE-XXXXXX  (single code)"
                                                className="flex-1 h-11 px-5 bg-[#050505] border border-[#151515] rounded-full text-[11px] font-mono text-[#F2F2F2] placeholder-[#333] focus:border-[#E8D200]/40 outline-none uppercase tracking-[0.05em]"
                                                value={singleCode}
                                                onChange={e => setSingleCode(e.target.value.toUpperCase())}
                                            />
                                            <button type="button" onClick={handleAddSingleCode} disabled={uploadingCodes || !singleCode.trim()} className="h-11 px-6 bg-[#050505] border border-[#151515] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#DDD] hover:text-[#E8D200] hover:border-[#E8D200]/40 transition-all font-black disabled:opacity-40">Add</button>
                                            <label className="flex items-center gap-2 h-11 px-6 bg-[#050505] border border-[#151515] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#CCC] hover:text-[#E8D200] hover:border-[#E8D200]/40 transition-all font-black cursor-pointer whitespace-nowrap">
                                                <Upload size={12} /> Upload CSV
                                                <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleBulkFile} />
                                            </label>
                                        </div>
                                        <textarea
                                            rows={3}
                                            placeholder={'Paste codes or drop partner CSV — Status + Deleted at columns respected automatically'}
                                            className="w-full p-4 bg-[#050505] border border-[#151515] rounded-2xl focus:border-[#E8D200]/40 outline-none transition-all text-xs font-mono text-[#DDD] placeholder-[#333] resize-none"
                                            value={bulkCodesText}
                                            onChange={e => setBulkCodesText(e.target.value)}
                                        />
                                        <div className="flex justify-between items-center mt-3">
                                            <span className="text-[10px] uppercase tracking-[0.3em] text-[#555] font-black">
                                                {parseCodes(bulkCodesText).length} codes detected
                                            </span>
                                            <button type="button" onClick={handleBulkUpload} disabled={uploadingCodes || !bulkCodesText.trim()} className="h-11 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-2px] disabled:opacity-40">
                                                {uploadingCodes ? 'Uploading...' : 'Upload Batch'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Ledger */}
                                    <div className="px-8 py-5">
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#777] font-black">
                                                Ledger {codePool.total > 0 && `· ${codePool.total} total`}
                                            </span>
                                            <div className="flex bg-[#050505] border border-[#151515] rounded-2xl p-1 gap-1">
                                                {['all', 'available', 'reserved', 'used', 'expired'].map(s => (
                                                    <button
                                                        key={s}
                                                        type="button"
                                                        onClick={() => refreshCodePool(editingReward.id, 0, s)}
                                                        className={`h-7 px-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all ${codePoolStatus === s ? 'bg-[#E8D200] text-[#080808]' : 'text-[#777] hover:text-[#CCC]'}`}
                                                    >
                                                        {s}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {codePoolLoading ? (
                                            <div className="flex items-center justify-center py-10 gap-3">
                                                <div className="w-5 h-5 border border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                                                <span className="text-[10px] uppercase tracking-[0.4em] text-[#555] font-black">Loading</span>
                                            </div>
                                        ) : codePool.rows.length === 0 ? (
                                            <div className="text-center py-10">
                                                <p className="text-[10px] uppercase tracking-[0.4em] text-[#444] font-black">No codes{codePoolStatus !== 'all' ? ` with status "${codePoolStatus}"` : ' uploaded yet'}</p>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="rounded-2xl border border-[#151515] overflow-hidden mb-4">
                                                    <table className="w-full text-left border-collapse">
                                                        <thead>
                                                            <tr className="bg-[#050505] border-b border-[#151515]">
                                                                {['Code', 'Status', 'Claimed by', 'Claimed at', 'Used at', 'Expires'].map(h => (
                                                                    <th key={h} className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.4em] text-[#555]">{h}</th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-[#0d0d0d]">
                                                            {codePool.rows.map(row => {
                                                                const statusColor = {
                                                                    available: 'text-[#10B981]',
                                                                    reserved:  'text-[#E8D200]',
                                                                    used:      'text-[#0EA5E9]',
                                                                    expired:   'text-[#666]',
                                                                }[row.status] ?? 'text-[#999]';
                                                                const claimedBy = row.profiles?.display_name || row.profiles?.username || (row.assigned_user_id ? row.assigned_user_id.slice(0, 8) + '…' : '—');
                                                                const fmt = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
                                                                return (
                                                                    <tr key={row.id} className="hover:bg-[#080808] transition-all">
                                                                        <td className="px-4 py-3 font-mono text-[11px] text-[#E8D200] tracking-[0.15em]">{row.code}</td>
                                                                        <td className="px-4 py-3">
                                                                            <span className={`text-[9px] font-black uppercase tracking-[0.3em] ${statusColor}`}>{row.status}</span>
                                                                        </td>
                                                                        <td className="px-4 py-3 text-[11px] text-[#BBB]">{claimedBy}</td>
                                                                        <td className="px-4 py-3 text-[11px] text-[#777]">{fmt(row.assigned_at)}</td>
                                                                        <td className="px-4 py-3 text-[11px] text-[#777]">{fmt(row.used_at)}</td>
                                                                        <td className="px-4 py-3 text-[11px] text-[#777]">{fmt(row.expires_at)}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                {/* Pagination */}
                                                {codePool.total > CODE_POOL_PAGE_SIZE && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#555] font-black">
                                                            {codePoolPage * CODE_POOL_PAGE_SIZE + 1}–{Math.min((codePoolPage + 1) * CODE_POOL_PAGE_SIZE, codePool.total)} of {codePool.total}
                                                        </span>
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                disabled={codePoolPage === 0}
                                                                onClick={() => refreshCodePool(editingReward.id, codePoolPage - 1, codePoolStatus)}
                                                                className="h-9 px-5 bg-[#050505] border border-[#151515] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#777] hover:text-[#CCC] disabled:opacity-30 font-black transition-all"
                                                            >← Prev</button>
                                                            <button
                                                                type="button"
                                                                disabled={(codePoolPage + 1) * CODE_POOL_PAGE_SIZE >= codePool.total}
                                                                onClick={() => refreshCodePool(editingReward.id, codePoolPage + 1, codePoolStatus)}
                                                                className="h-9 px-5 bg-[#050505] border border-[#151515] rounded-full text-[10px] uppercase tracking-[0.3em] text-[#777] hover:text-[#CCC] disabled:opacity-30 font-black transition-all"
                                                            >Next →</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center gap-4 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] p-8">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, featured_on_home: !formData.featured_on_home })}
                                    className={`w-12 h-7 rounded-full transition-all relative shrink-0 ${formData.featured_on_home ? 'bg-[#E8D200]' : 'bg-[#151515]'}`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 rounded-full transition-all ${formData.featured_on_home ? 'left-[24px] bg-[#000]' : 'left-1 bg-[#222]'}`} />
                                </button>
                                <div>
                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black">Feature on Home Screen</span>
                                    <p className="text-[10px] text-[#555] mt-0.5">Replaces the reward card on the app home screen. Only one reward can be featured at a time.</p>
                                </div>
                            </div>

                            <div className="flex justify-between items-center bg-[#0A0A0A] border border-[#151515] rounded-[2rem] p-8">
                                <div className="flex items-center gap-4">
                                    <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, active: !formData.active })}
                                        className={`w-12 h-7 rounded-full transition-all relative shrink-0 ${formData.active ? 'bg-[#E8D200]' : 'bg-[#151515]'}`}
                                    >
                                        <span className={`absolute top-1 w-5 h-5 rounded-full transition-all ${formData.active ? 'left-[24px] bg-[#000]' : 'left-1 bg-[#222]'}`} />
                                    </button>
                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#999] font-black">Broadcast Live to Network</span>
                                </div>
                                <div className="flex gap-4">
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="h-16 px-10 text-[11px] uppercase tracking-[0.4em] font-black text-[#999] hover:text-[#BBB] transition-colors">Abort</button>
                                    <button type="submit" disabled={saving} className="h-16 px-12 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.4em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20 disabled:opacity-50">
                                        {saving ? 'SYNCING...' : 'COMMIT PROTOCOL'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                    </div>
                </div>
            )}
        </div>
    );
}
