import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { Plus, Edit2, Trash2, MapPin, Loader2, X, Search, Activity, ChevronRight, Globe, Satellite, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';

// --- Location row editor ---
const LocationEditor = ({ locations, onChange }) => {
    const add = () => onChange([...locations, { name: '', lat: '', lng: '', radius: 100 }]);
    const remove = (i) => onChange(locations.filter((_, idx) => idx !== i));
    const update = (i, field, val) => {
        const next = [...locations];
        next[i] = { ...next[i], [field]: val };
        onChange(next);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-[#050505] p-6 rounded-[1.5rem] border border-[#151515]">
                <div className="flex items-center gap-4">
                    <Satellite size={16} className="text-[#E8D200]" />
                    <label className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black">
                        Active Nodes <span className="text-[#E8D200] ml-2">[{locations.length}]</span>
                    </label>
                </div>
                <button type="button" onClick={add} className="flex items-center gap-3 px-6 py-3 bg-[#0A0A0A] border border-[#151515] rounded-full text-[9px] uppercase tracking-[0.3em] text-[#333] hover:text-[#E8D200] hover:border-[#E8D200]/40 transition-all font-black">
                    <Plus size={12} /> Add Point
                </button>
            </div>

            {locations.length === 0 ? (
                <div className="p-16 bg-[#050505] border border-dashed border-[#151515] rounded-[2rem] text-center">
                    <MapPin size={24} className="mx-auto text-[#151515] mb-4" />
                    <p className="text-[10px] text-[#151515] uppercase tracking-[0.5em] font-black">No Geofence Data</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {locations.map((loc, i) => (
                        <div key={i} className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_1fr_60px] gap-4 items-center bg-[#050505] p-4 rounded-2xl border border-[#151515] group/loc hover:border-[#E8D200]/20 transition-all">
                            <input
                                type="text"
                                placeholder="NODE LABEL (e.g. SYDNEY CBD)..."
                                className="h-12 px-6 bg-[#0A0A0A] border border-[#151515] rounded-xl text-[11px] font-black tracking-[0.1em] text-[#F2F2F2] placeholder-[#151515] focus:border-[#E8D200]/40 outline-none transition-all uppercase"
                                value={loc.name}
                                onChange={e => update(i, 'name', e.target.value)}
                            />
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-[#151515] uppercase">LAT</span>
                                <input
                                    type="number"
                                    step="any"
                                    className="w-full h-12 pl-12 pr-4 bg-[#0A0A0A] border border-[#151515] rounded-xl text-[11px] font-mono text-[#888] focus:border-[#E8D200]/40 outline-none"
                                    value={loc.lat}
                                    onChange={e => update(i, 'lat', e.target.value)}
                                />
                            </div>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-[#151515] uppercase">LNG</span>
                                <input
                                    type="number"
                                    step="any"
                                    className="w-full h-12 pl-12 pr-4 bg-[#0A0A0A] border border-[#151515] rounded-xl text-[11px] font-mono text-[#888] focus:border-[#E8D200]/40 outline-none"
                                    value={loc.lng}
                                    onChange={e => update(i, 'lng', e.target.value)}
                                />
                            </div>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-[#151515] uppercase">RAD</span>
                                <input
                                    type="number"
                                    min="1"
                                    className="w-full h-12 pl-12 pr-4 bg-[#0A0A0A] border border-[#151515] rounded-xl text-[11px] font-mono text-[#888] focus:border-[#E8D200]/40 outline-none"
                                    value={loc.radius}
                                    onChange={e => update(i, 'radius', e.target.value)}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => remove(i)}
                                className="h-12 w-12 flex items-center justify-center text-[#151515] hover:text-red-500 hover:bg-red-500/5 rounded-xl transition-all"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const CATEGORIES = ['gym', 'fashion', 'gear', 'nutrition', 'food', 'health'];
const EMPTY_FORM = { name: '', logo_url: '', category: 'gym', active: true, locations: [] };

export default function PartnerManager() {
    const toast = useToast();
    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterCat, setFilterCat] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPartner, setEditingPartner] = useState(null);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [togglingId, setTogglingId] = useState(null);

    useEffect(() => { fetchPartners(); }, []);

    const fetchPartners = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('partners').select('*').order('created_at', { ascending: false });
        if (error) toast.error('Failed to load fleet');
        else setPartners(data || []);
        setLoading(false);
    };

    const filtered = partners
        .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
        .filter(p => filterCat === 'all' || p.category === filterCat)
        .filter(p => filterStatus === 'all' || (filterStatus === 'active' ? p.active : !p.active));

    const openCreate = () => {
        setEditingPartner(null);
        setFormData(EMPTY_FORM);
        setIsModalOpen(true);
    };

    const openEdit = (partner) => {
        setEditingPartner(partner);
        setFormData({
            name: partner.name,
            logo_url: partner.logo_url || '',
            category: partner.category,
            active: partner.active,
            locations: partner.locations || [],
        });
        setIsModalOpen(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        const payload = {
            ...formData,
            locations: formData.locations.map(loc => ({
                name: loc.name,
                lat: parseFloat(loc.lat) || 0,
                lng: parseFloat(loc.lng) || 0,
                radius: parseFloat(loc.radius) || 100,
            })),
        };
        const { error } = editingPartner
            ? await supabase.from('partners').update(payload).eq('id', editingPartner.id)
            : await supabase.from('partners').insert([payload]);

        if (error) {
            toast.error(error.message);
        } else {
            toast.success(editingPartner ? 'Node synchronized' : 'New node deployed');
            setIsModalOpen(false);
            fetchPartners();
        }
        setSaving(false);
    };

    const handleToggleActive = async (partner) => {
        if (togglingId === partner.id) return;
        setTogglingId(partner.id);
        const newActive = !partner.active;
        const { error } = await supabase.from('partners').update({ active: newActive }).eq('id', partner.id);
        if (error) {
            toast.error('Sync failed');
        } else {
            setPartners(prev => prev.map(p => p.id === partner.id ? { ...p, active: newActive } : p));
            toast.success(newActive ? 'Node Active' : 'Node Inactive');
        }
        setTogglingId(null);
    };

    const handleDelete = async (id) => {
        const { error } = await supabase.from('partners').delete().eq('id', id);
        if (error) {
            toast.error('Termination failed');
        } else {
            toast.success('Node decommissioned');
            setPartners(prev => prev.filter(p => p.id !== id));
        }
        setConfirmDeleteId(null);
    };

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#0EA5E9]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#0EA5E9] font-black">Subsystem / Logistics</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-6">Partner Fleet</h1>
                    <p className="text-[#333] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Authorized retail locations and geofence telemetry orchestration.
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    className="flex items-center gap-4 h-16 px-10 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20 shrink-0"
                >
                    <Plus size={18} /> Initialize Node
                </button>
            </div>

            {/* Controls */}
            <div className="flex flex-col lg:flex-row gap-6 mb-12">
                <div className="relative flex-1 group">
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#1A1A1A] group-focus-within:text-[#E8D200] transition-colors" />
                    <input
                        type="text"
                        placeholder="SEARCH RETAIL IDENTIFIER..."
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
                        value={filterStatus}
                        onChange={e => setFilterStatus(e.target.value)}
                        className="h-12 px-6 bg-[#050505] border border-[#151515] rounded-[1.5rem] text-[10px] text-[#444] font-black uppercase tracking-[0.2em] outline-none cursor-pointer focus:border-[#E8D200]/20"
                    >
                        <option value="all">All Status</option>
                        <option value="active">Active Nodes</option>
                        <option value="inactive">Inactive Nodes</option>
                    </select>
                </div>
            </div>

            {/* Content Container */}
            <div className="bg-[#0A0A0A] border border-[#151515] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#0EA5E9]/20 border-t-[#0EA5E9] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Syncing Fleet...</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#050505] border-b border-[#151515]">
                                    {['Node Identity', 'Sector', 'Points of Interest', 'Status', ''].map(h => (
                                        <th key={h} className={`px-12 py-8 text-[10px] font-black uppercase tracking-[0.5em] text-[#1A1A1A] ${h === '' ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#111]">
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-12 py-32 text-center">
                                            <div className="flex flex-col items-center gap-6">
                                                <div className="w-20 h-20 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center">
                                                    <Globe size={32} className="text-[#151515]" />
                                                </div>
                                                <p className="text-[11px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">Fleet Empty</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filtered.map(partner => (
                                    <tr key={partner.id} className="group hover:bg-[#080808] transition-all">
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-8">
                                                {partner.logo_url ? (
                                                    <img src={partner.logo_url} className="w-14 h-14 rounded-[1.5rem] bg-[#050505] object-contain border border-[#151515] group-hover:border-[#E8D200]/20 transition-all p-2 shadow-2xl" alt="" />
                                                ) : (
                                                    <div className="w-14 h-14 rounded-[1.5rem] bg-[#050505] border border-[#151515] flex items-center justify-center text-xs font-black text-[#151515] group-hover:text-[#E8D200] group-hover:border-[#E8D200]/20 transition-all shadow-2xl uppercase">
                                                        {partner.name[0]}
                                                    </div>
                                                )}
                                                <div>
                                                    <span className="text-base font-bold text-[#DDD] group-hover:text-[#F2F2F2] transition-colors block mb-1">{partner.name}</span>
                                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black font-mono">ID: {partner.id.slice(0,8)}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10">
                                            <span className="px-4 py-1.5 bg-[#050505] border border-[#151515] rounded-full text-[9px] uppercase font-black tracking-[0.3em] text-[#333] group-hover:text-[#888] transition-colors">
                                                {partner.category}
                                            </span>
                                        </td>
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-4 text-[#555] group-hover:text-[#EEE] transition-colors font-black">
                                                <MapPin size={16} className="text-[#151515] group-hover:text-[#E8D200]" />
                                                <span className="text-[12px] uppercase tracking-[0.2em]">{partner.locations?.length || 0} NODES</span>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10 whitespace-nowrap">
                                            <button
                                                onClick={() => handleToggleActive(partner)}
                                                disabled={togglingId === partner.id}
                                                className={`flex items-center gap-3 px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.3em] border transition-all ${
                                                    partner.active
                                                        ? 'bg-[#10B981]/5 text-[#10B981] border-[#10B981]/20 hover:bg-[#10B981]/10'
                                                        : 'bg-[#050505] text-[#222] border-[#151515] hover:border-[#333]'
                                                }`}
                                            >
                                                <div className={`h-1.5 w-1.5 rounded-full ${partner.active ? 'bg-[#10B981] animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-[#151515]'}`} />
                                                {partner.active ? 'LIVE NODE' : 'INACTIVE'}
                                            </button>
                                        </td>
                                        <td className="px-12 py-10 text-right">
                                            {confirmDeleteId === partner.id ? (
                                                <div className="flex items-center justify-end gap-3 scale-90 origin-right transition-all">
                                                    <button onClick={() => handleDelete(partner.id)} className="h-10 px-6 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-[0.3em] rounded-full hover:bg-red-500/20 transition-all border border-red-500/20 shadow-lg shadow-red-500/5">DELETE</button>
                                                    <button onClick={() => setConfirmDeleteId(null)} className="h-10 px-6 bg-[#050505] text-[#333] text-[10px] font-black uppercase tracking-[0.3em] rounded-full hover:text-[#CCC] transition-all border border-[#151515]">CANCEL</button>
                                                </div>
                                            ) : (
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                    <Link to={`/admin/partners/${partner.id}`} className="w-12 h-12 flex items-center justify-center text-[#1A1A1A] hover:text-[#0EA5E9] hover:bg-[#0EA5E9]/5 rounded-2xl transition-all"><Eye size={16} /></Link>
                                                    <button onClick={() => openEdit(partner)} className="w-12 h-12 flex items-center justify-center text-[#1A1A1A] hover:text-[#E8D200] hover:bg-[#E8D200]/5 rounded-2xl transition-all"><Edit2 size={16} /></button>
                                                    <button onClick={() => setConfirmDeleteId(partner.id)} className="w-12 h-12 flex items-center justify-center text-[#1A1A1A] hover:text-red-500 hover:bg-red-500/5 rounded-2xl transition-all"><Trash2 size={16} /></button>
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
                    <div className="bg-[#050505] border border-[#151515] rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-auto shadow-[0_0_100px_rgba(14,165,233,0.05)] scrollbar-hide">
                        <form onSubmit={handleSave} className="p-12">
                            <div className="flex items-center justify-between mb-16">
                                <div>
                                    <h2 className="text-4xl font-light tracking-tighter text-[#F2F2F2] mb-3">{editingPartner ? 'Edit Fleet Node' : 'Initialize Fleet Node'}</h2>
                                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black">Configure Retail Logistics & Geofencing</p>
                                </div>
                                <button type="button" onClick={() => setIsModalOpen(false)} className="w-14 h-14 bg-[#0A0A0A] border border-[#151515] rounded-3xl flex items-center justify-center text-[#222] hover:text-[#F2F2F2] hover:border-[#0EA5E9]/40 transition-all"><X size={20} /></button>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-12">
                                <div className="space-y-8">
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">Node Brand Name</label>
                                        <input type="text" required className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-base font-bold text-[#F2F2F2] placeholder-[#151515]" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">Operating Sector</label>
                                        <select className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#888] tracking-[0.1em] uppercase" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                                            {CATEGORIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">Logo Asset URL</label>
                                        <input type="url" placeholder="https://cdn.powr.com/assets/..." className="w-full h-16 px-8 bg-[#0A0A0A] border border-[#151515] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-mono text-[#444] placeholder-[#151515]" value={formData.logo_url} onChange={e => setFormData({ ...formData, logo_url: e.target.value })} />
                                    </div>
                                    <div className="p-8 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] flex items-center gap-6">
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, active: !formData.active })}
                                            className={`w-12 h-7 rounded-full transition-all relative shrink-0 ${formData.active ? 'bg-[#10B981]' : 'bg-[#151515]'}`}
                                        >
                                            <span className={`absolute top-1 w-5 h-5 rounded-full transition-all ${formData.active ? 'left-[24px] bg-[#000]' : 'left-1 bg-[#222]'}`} />
                                        </button>
                                        <span className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black">Enable Real-time Discovery</span>
                                    </div>
                                </div>

                                <div className="space-y-8">
                                    <LocationEditor
                                        locations={formData.locations}
                                        onChange={locs => setFormData({ ...formData, locations: locs })}
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-6 pt-12 border-t border-[#151515]">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="h-16 px-12 text-[11px] uppercase tracking-[0.4em] font-black text-[#222] hover:text-[#555] transition-colors">Abort Mission</button>
                                <button type="submit" disabled={saving} className="h-16 px-16 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.4em] rounded-full transition-all hover:translate-y-[-4px] shadow-2xl shadow-[#E8D200]/20 disabled:opacity-50">
                                    {saving ? 'COMMITTING...' : 'INITIALIZE NODE'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
