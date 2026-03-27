import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { Plus, Edit2, Trash2, Ticket, Loader2, X, Search, Award, Activity, ChevronRight, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

const CATEGORIES = ['gym', 'fashion', 'gear', 'nutrition', 'food', 'health'];

const EMPTY_FORM = {
    partner_id: '',
    title: '',
    description: '',
    powr_cost: 100,
    category: 'gym',
    stock: null,
    active: true,
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

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        const [rew, part] = await Promise.all([
            supabase.from('rewards').select('*, partners(name)').order('created_at', { ascending: false }),
            supabase.from('partners').select('id, name').eq('active', true).order('name'),
        ]);
        if (rew.error) toast.error('Failed to load inventory');
        else setRewards(rew.data || []);
        if (part.data) setPartners(part.data);
        setLoading(false);
    };

    const filtered = rewards
        .filter(r => !search || r.title.toLowerCase().includes(search.toLowerCase()))
        .filter(r => filterCat === 'all' || r.category === filterCat)
        .filter(r => filterPartner === 'all' || r.partner_id === filterPartner);

    const openCreate = () => {
        setEditingReward(null);
        setFormData({ ...EMPTY_FORM, partner_id: partners[0]?.id || '' });
        setIsModalOpen(true);
    };

    const openEdit = (reward) => {
        setEditingReward(reward);
        setFormData({
            partner_id: reward.partner_id,
            title: reward.title,
            description: reward.description || '',
            powr_cost: reward.powr_cost,
            category: reward.category,
            stock: reward.stock,
            active: reward.active,
        });
        setIsModalOpen(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        const { error } = editingReward
            ? await supabase.from('rewards').update(formData).eq('id', editingReward.id)
            : await supabase.from('rewards').insert([formData]);
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
                    <p className="text-[#333] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
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
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#1A1A1A] group-focus-within:text-[#E8D200] transition-colors" />
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
                        className="h-12 px-6 bg-[#050505] border border-[#151515] rounded-[1.5rem] text-[10px] text-[#444] font-black uppercase tracking-[0.2em] outline-none cursor-pointer focus:border-[#E8D200]/20"
                    >
                        <option value="all">All Sectors</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                    </select>
                    <select
                        value={filterPartner}
                        onChange={e => setFilterPartner(e.target.value)}
                        className="h-12 px-6 bg-[#050505] border border-[#151515] rounded-[1.5rem] text-[10px] text-[#444] font-black uppercase tracking-[0.2em] outline-none cursor-pointer focus:border-[#E8D200]/20 max-w-[200px]"
                    >
                        <option value="all">All Nodes</option>
                        {partners.map(p => <option key={p.id} value={p.id}>{p.name.toUpperCase()}</option>)}
                    </select>
                </div>
            </div>

            {/* Content Container */}
            <div className="bg-[#0A0A0A] border border-[#151515] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#10B981]/20 border-t-[#10B981] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Syncing Vault...</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#050505] border-b border-[#151515]">
                                    {['Reward / Asset', 'Partner Node', 'Cost / Value', 'Inventory', 'Status', ''].map(h => (
                                        <th key={h} className={`px-12 py-8 text-[10px] font-black uppercase tracking-[0.5em] text-[#1A1A1A] ${h === '' ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#111]">
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-12 py-32 text-center">
                                            <div className="flex flex-col items-center gap-6">
                                                <div className="w-20 h-20 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center">
                                                    <Ticket size={32} className="text-[#151515]" />
                                                </div>
                                                <p className="text-[11px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">Vault Empty</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filtered.map(reward => (
                                    <tr key={reward.id} className="group hover:bg-[#080808] transition-all">
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-8">
                                                <div className="w-14 h-14 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0 group-hover:border-[#E8D200]/20 transition-all shadow-2xl">
                                                    <Award size={22} className="text-[#222] group-hover:text-[#E8D200]/60 transition-colors" />
                                                </div>
                                                <div>
                                                    <span className="text-base font-bold text-[#DDD] group-hover:text-[#F2F2F2] transition-colors block mb-1">{reward.title}</span>
                                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black">{reward.category} SECTOR</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-3">
                                                <div className="w-1.5 h-1.5 rounded-full bg-[#E8D200]"></div>
                                                <span className="text-[11px] font-black text-[#555] uppercase tracking-[0.2em]">
                                                    {reward.partners?.name || 'STANDALONE'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10">
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-3xl font-light tracking-tighter text-[#E8D200]">
                                                    {reward.powr_cost.toLocaleString()}
                                                </span>
                                                <span className="text-[9px] uppercase tracking-[0.2em] text-[#222] font-black">POWR</span>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10">
                                            {reward.stock === null ? (
                                                <div className="flex items-center gap-3">
                                                    <Activity size={12} className="text-[#1A1A1A]" />
                                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black">Unlimited Supply</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <div className={`h-1.5 w-1.5 rounded-full ${reward.stock > 10 ? 'bg-blue-500/50' : reward.stock > 5 ? 'bg-orange-500/50' : 'bg-red-500/50'} shadow-[0_0_8px_rgba(255,255,255,0.1)]`} />
                                                        <span className="text-xs font-bold text-[#555]">{reward.stock} units</span>
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
                                                        : 'bg-[#050505] text-[#222] border-[#151515] hover:border-[#222]'
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
                                                    <button onClick={() => setConfirmDeleteId(null)} className="h-10 px-6 bg-[#050505] text-[#333] text-[10px] font-black uppercase tracking-[0.3em] rounded-full hover:text-[#CCC] transition-all border border-[#151515]">CANCEL</button>
                                                </div>
                                            ) : (
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                    <button onClick={() => openEdit(reward)} className="w-12 h-12 flex items-center justify-center text-[#1A1A1A] hover:text-[#E8D200] hover:bg-[#E8D200]/5 rounded-2xl transition-all"><Edit2 size={16} /></button>
                                                    <button onClick={() => setConfirmDeleteId(reward.id)} className="w-12 h-12 flex items-center justify-center text-[#1A1A1A] hover:text-red-500 hover:bg-red-500/5 rounded-2xl transition-all"><Trash2 size={16} /></button>
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
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-8 bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="bg-[#050505] border border-[#151515] rounded-3xl w-full max-w-3xl overflow-hidden shadow-[0_0_100px_rgba(232,210,0,0.05)]">
                        <form onSubmit={handleSave} className="p-12">
                            <div className="flex items-center justify-between mb-16">
                                <div>
                                    <h2 className="text-4xl font-light tracking-tighter text-[#F2F2F2] mb-3">{editingReward ? 'Edit Host Asset' : 'New Asset Protocol'}</h2>
                                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black">Configure Reward Parameters</p>
                                </div>
                                <button type="button" onClick={() => setIsModalOpen(false)} className="w-14 h-14 bg-[#0A0A0A] border border-[#151515] rounded-3xl flex items-center justify-center text-[#222] hover:text-[#F2F2F2] hover:border-[#E8D200]/40 transition-all"><X size={20} /></button>
                            </div>

                            <div className="grid grid-cols-2 gap-8 mb-8">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">Partner Node</label>
                                    <select required className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#888] tracking-[0.1em] uppercase" value={formData.partner_id} onChange={e => setFormData({ ...formData, partner_id: e.target.value })}>
                                        {partners.length === 0 && <option value="">NO ACTIVE NODES</option>}
                                        {partners.map(p => <option key={p.id} value={p.id}>{p.name.toUpperCase()}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">Market Sector</label>
                                    <select className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#888] tracking-[0.1em] uppercase" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                                        {CATEGORIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">Asset Label</label>
                                <input type="text" required placeholder="PROTOCOL IDENTIFIER..." className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-bold text-[#F2F2F2] placeholder-[#151515] uppercase tracking-[0.2em]" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
                            </div>

                            <div className="mb-8">
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">Intelligence Description</label>
                                <textarea rows={2} className="w-full p-8 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] focus:border-[#E8D200]/40 outline-none transition-all text-sm text-[#888] leading-relaxed resize-none" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                            </div>

                            <div className="grid grid-cols-2 gap-8 mb-12">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">POWR Value Cost</label>
                                    <input type="number" min="1" required className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-2xl font-light tracking-tighter text-[#E8D200]" value={formData.powr_cost} onChange={e => setFormData({ ...formData, powr_cost: parseInt(e.target.value) || 0 })} />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">
                                        Inventory Limit <span className="text-[#151515] normal-case font-black ml-2">— LEAVE EMPTY FOR UNLIMITED</span>
                                    </label>
                                    <input type="number" min="0" placeholder="INF" className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[14px] font-black text-[#F2F2F2] placeholder-[#151515] uppercase" value={formData.stock ?? ''} onChange={e => setFormData({ ...formData, stock: e.target.value === '' ? null : parseInt(e.target.value) })} />
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
                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black">Broadcast Live to Network</span>
                                </div>
                                <div className="flex gap-4">
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="h-16 px-10 text-[11px] uppercase tracking-[0.4em] font-black text-[#222] hover:text-[#555] transition-colors">Abort</button>
                                    <button type="submit" disabled={saving} className="h-16 px-12 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.4em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20 disabled:opacity-50">
                                        {saving ? 'SYNCING...' : 'COMMIT PROTOCOL'}
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
