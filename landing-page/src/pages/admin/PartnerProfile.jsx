import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import {
    ChevronLeft, MapPin, Globe, Mail, Phone, Upload, Save,
    Activity, Award, Edit2, Trash2, Image, X, Calendar, Building2
} from 'lucide-react';

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

export default function PartnerProfile() {
    const { partnerId } = useParams();
    const toast = useToast();
    const { user: adminUser } = useAuth();
    const fileInputRef = useRef(null);

    const [loading, setLoading] = useState(true);
    const [partner, setPartner] = useState(null);
    const [rewards, setRewards] = useState([]);
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    useEffect(() => { if (partnerId) fetchData(); }, [partnerId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [pRes, rRes] = await Promise.all([
                supabase.from('partners').select('*').eq('id', partnerId).single(),
                supabase.from('rewards').select('*').eq('partner_id', partnerId).order('created_at', { ascending: false }),
            ]);
            if (pRes.error) throw pRes.error;
            setPartner(pRes.data);
            setForm(pRes.data);
            setRewards(rRes.data || []);
        } catch (e) {
            toast.error('Failed to load partner data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleLogoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
        setUploading(true);
        try {
            const ext = file.name.split('.').pop();
            const filePath = `${partnerId}.${ext}`;
            
            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('partner-logos')
                .upload(filePath, file, { upsert: true });
            if (uploadError) throw uploadError;

            // Get public URL
            const { data: urlData } = supabase.storage.from('partner-logos').getPublicUrl(filePath);
            const newUrl = urlData.publicUrl + `?t=${Date.now()}`; // cache bust

            // Update partner record
            const { error: updateError } = await supabase
                .from('partners')
                .update({ logo_url: newUrl })
                .eq('id', partnerId);
            if (updateError) throw updateError;

            await logAction(adminUser.id, 'logo_upload', 'partner', partnerId, { file_path: filePath });
            setPartner(prev => ({ ...prev, logo_url: newUrl }));
            setForm(prev => ({ ...prev, logo_url: newUrl }));
            toast.success('Logo asset deployed');
        } catch (e) {
            toast.error('Upload failed: ' + e.message);
            console.error(e);
        } finally {
            setUploading(false);
        }
    };

    const updateLocation = (i, field, value) => {
        const locs = [...(form.locations || [])];
        locs[i] = { ...locs[i], [field]: field === 'name' ? value : parseFloat(value) || 0 };
        setForm({ ...form, locations: locs });
    };

    const handleSave = async () => {
        setSaving(true);
        const payload = {
            name: form.name,
            category: form.category,
            contact_email: form.contact_email || null,
            contact_phone: form.contact_phone || null,
            website: form.website || null,
            description: form.description || null,
            address: form.address || null,
            active: form.active,
            locations: (form.locations || []).map(loc => ({
                name: loc.name, lat: parseFloat(loc.lat) || 0,
                lng: parseFloat(loc.lng) || 0, radius: parseFloat(loc.radius) || 100,
            })),
        };
        const { error } = await supabase.from('partners').update(payload).eq('id', partnerId);
        if (error) { toast.error(error.message); setSaving(false); return; }
        await logAction(adminUser.id, 'partner_update', 'partner', partnerId, payload);
        toast.success('Partner data synchronized');
        setEditing(false);
        setSaving(false);
        fetchData();
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-48 gap-6">
            <div className="w-12 h-12 border-2 border-[#0EA5E9]/20 border-t-[#0EA5E9] rounded-full animate-spin" />
            <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Loading Partner Node...</span>
        </div>
    );

    if (!partner) return (
        <div className="py-20 text-center">
            <h2 className="text-2xl font-light text-[#F2F2F2] mb-4">Partner Not Found</h2>
            <Link to="/admin/partners" className="text-[#0EA5E9] text-sm uppercase tracking-widest font-black">Back to Fleet</Link>
        </div>
    );

    const CATEGORIES = ['gym', 'fashion', 'gear', 'nutrition', 'food', 'health'];

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Nav */}
            <Link to="/admin/partners" className="group flex items-center gap-3 mb-12 text-[#222] hover:text-[#F2F2F2] transition-colors">
                <ChevronLeft size={16} />
                <span className="text-[10px] uppercase tracking-[0.4em] font-black">Back to Fleet</span>
            </Link>

            {/* Header */}
            <header className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-12 mb-24">
                <div className="flex items-center gap-10">
                    {/* Logo with upload overlay */}
                    <div className="relative group/logo">
                        <div className="w-32 h-32 rounded-[2.5rem] bg-[#0A0A0A] border border-[#151515] flex items-center justify-center overflow-hidden shrink-0 shadow-2xl">
                            {partner.logo_url ? (
                                <img src={partner.logo_url} alt="" className="w-full h-full object-contain p-4" />
                            ) : (
                                <Building2 size={48} className="text-[#1A1A1A]" />
                            )}
                        </div>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-[2.5rem] flex flex-col items-center justify-center gap-2 opacity-0 group-hover/logo:opacity-100 transition-all cursor-pointer"
                        >
                            {uploading ? (
                                <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Upload size={24} className="text-[#E8D200]" />
                                    <span className="text-[8px] uppercase tracking-[0.3em] font-black text-[#E8D200]">Change Logo</span>
                                </>
                            )}
                        </button>
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    </div>

                    <div>
                        <div className="flex items-center gap-4 mb-3">
                            <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] ${partner.active ? 'bg-[#10B981] text-[#080808]' : 'bg-[#151515] text-[#555]'}`}>
                                {partner.active ? 'LIVE' : 'INACTIVE'}
                            </span>
                            <span className="px-4 py-1.5 rounded-full bg-[#050505] border border-[#151515] text-[10px] font-black uppercase tracking-[0.2em] text-[#444]">
                                {partner.category}
                            </span>
                        </div>
                        <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-2">{partner.name}</h1>
                        <p className="text-[#222] text-[12px] font-black uppercase tracking-[0.5em]">NID: {partner.id.substring(0, 18)}...</p>
                    </div>
                </div>

                <button
                    onClick={() => editing ? handleSave() : setEditing(true)}
                    disabled={saving}
                    className={`h-14 px-8 rounded-full text-[10px] font-black uppercase tracking-[0.3em] transition-all shadow-lg flex items-center gap-3 shrink-0 ${
                        editing 
                            ? 'bg-[#10B981] text-[#080808] shadow-[#10B981]/10 hover:translate-y-[-2px]' 
                            : 'bg-[#0A0A0A] border border-[#151515] text-[#444] hover:text-[#E8D200] hover:border-[#E8D200]/40'
                    }`}
                >
                    {editing ? <><Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}</> : <><Edit2 size={16} /> Edit Partner</>}
                </button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
                {/* Left: Contact & Details */}
                <div className="lg:col-span-2 space-y-16">
                    {/* Contact Info */}
                    <section className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden">
                        <div className="p-10 border-b border-[#151515]">
                            <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Contact & Details</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Partner Intelligence</p>
                        </div>
                        <div className="p-10 space-y-6">
                            {[
                                { label: 'Contact Email', key: 'contact_email', icon: Mail, type: 'email', placeholder: 'partner@company.com' },
                                { label: 'Phone', key: 'contact_phone', icon: Phone, type: 'tel', placeholder: '+61 400 000 000' },
                                { label: 'Website', key: 'website', icon: Globe, type: 'url', placeholder: 'https://example.com' },
                                { label: 'Address', key: 'address', icon: MapPin, type: 'text', placeholder: '123 King St, Sydney NSW' },
                            ].map(field => (
                                <div key={field.key} className="flex items-center gap-6 p-6 bg-[#050505] border border-[#151515] rounded-2xl group hover:border-[#202020] transition-all">
                                    <div className="w-12 h-12 rounded-xl bg-[#0A0A0A] border border-[#151515] flex items-center justify-center shrink-0">
                                        <field.icon size={16} className="text-[#333]" />
                                    </div>
                                    <div className="flex-1">
                                        <label className="block text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mb-2">{field.label}</label>
                                        {editing ? (
                                            <input
                                                type={field.type}
                                                value={form[field.key] || ''}
                                                onChange={e => setForm({ ...form, [field.key]: e.target.value })}
                                                placeholder={field.placeholder}
                                                className="w-full bg-transparent text-sm text-[#F2F2F2] outline-none placeholder-[#222]"
                                            />
                                        ) : (
                                            <span className="text-sm text-[#BBB]">{partner[field.key] || '—'}</span>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {/* Description */}
                            <div className="p-6 bg-[#050505] border border-[#151515] rounded-2xl">
                                <label className="block text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">Description</label>
                                {editing ? (
                                    <textarea
                                        value={form.description || ''}
                                        onChange={e => setForm({ ...form, description: e.target.value })}
                                        placeholder="Brief description of the partner..."
                                        rows={3}
                                        className="w-full bg-transparent text-sm text-[#F2F2F2] outline-none resize-none placeholder-[#222]"
                                    />
                                ) : (
                                    <p className="text-sm text-[#BBB] leading-relaxed">{partner.description || '—'}</p>
                                )}
                            </div>

                            {/* Category (editable) */}
                            {editing && (
                                <div className="p-6 bg-[#050505] border border-[#151515] rounded-2xl">
                                    <label className="block text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mb-4">Category</label>
                                    <select
                                        value={form.category}
                                        onChange={e => setForm({ ...form, category: e.target.value })}
                                        className="w-full bg-transparent text-sm text-[#F2F2F2] outline-none uppercase tracking-wider"
                                    >
                                        {CATEGORIES.map(c => <option key={c} value={c} className="bg-[#0A0A0A]">{c.toUpperCase()}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Locations Map List */}
                    <section className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden">
                        <div className="p-10 border-b border-[#151515] flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Geofence Points</h3>
                                <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Active Location Nodes</p>
                            </div>
                            <span className="text-[10px] font-black text-[#444] uppercase tracking-[0.3em]">{partner.locations?.length || 0} NODES</span>
                        </div>
                        <div className="divide-y divide-[#151515]">
                            {!(editing ? form.locations : partner.locations)?.length ? (
                                <div className="p-20 text-center">
                                    <MapPin size={48} className="mx-auto text-[#151515] mb-6" />
                                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">No locations configured</p>
                                </div>
                            ) : (editing ? form.locations : partner.locations).map((loc, i) => (
                                <div key={i} className="p-10 flex items-center gap-8 group hover:bg-[#050505] transition-all">
                                    <div className="w-14 h-14 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0">
                                        <MapPin size={20} className="text-[#0EA5E9] group-hover:text-[#E8D200] transition-colors" />
                                    </div>
                                    {editing ? (
                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
                                            <div>
                                                <label className="block text-[8px] uppercase tracking-[0.3em] text-[#222] font-black mb-1">Name</label>
                                                <input type="text" value={loc.name || ''} onChange={e => updateLocation(i, 'name', e.target.value)} className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#151515] rounded-lg text-xs text-[#F2F2F2] outline-none focus:border-[#E8D200]/40 transition-all" />
                                            </div>
                                            <div>
                                                <label className="block text-[8px] uppercase tracking-[0.3em] text-[#222] font-black mb-1">Latitude</label>
                                                <input type="number" step="any" value={loc.lat} onChange={e => updateLocation(i, 'lat', e.target.value)} className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#151515] rounded-lg text-xs font-mono text-[#888] outline-none focus:border-[#E8D200]/40 transition-all" />
                                            </div>
                                            <div>
                                                <label className="block text-[8px] uppercase tracking-[0.3em] text-[#222] font-black mb-1">Longitude</label>
                                                <input type="number" step="any" value={loc.lng} onChange={e => updateLocation(i, 'lng', e.target.value)} className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#151515] rounded-lg text-xs font-mono text-[#888] outline-none focus:border-[#E8D200]/40 transition-all" />
                                            </div>
                                            <div>
                                                <label className="block text-[8px] uppercase tracking-[0.3em] text-[#E8D200] font-black mb-1">Radius (m)</label>
                                                <input type="number" min="1" value={loc.radius} onChange={e => updateLocation(i, 'radius', e.target.value)} className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#E8D200]/20 rounded-lg text-xs font-mono text-[#E8D200] outline-none focus:border-[#E8D200]/40 transition-all" />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex-1">
                                            <div className="text-base font-bold text-[#DDD] mb-1">{loc.name || `Location ${i + 1}`}</div>
                                            <div className="flex items-center gap-6 text-[10px] font-black text-[#333] uppercase tracking-[0.2em]">
                                                <span>LAT {loc.lat?.toFixed(4)}</span>
                                                <span>LNG {loc.lng?.toFixed(4)}</span>
                                                <span className="px-3 py-1 rounded-full border border-[#151515] text-[#444]">{loc.radius}m radius</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                </div>

                {/* Right: Rewards & Metadata */}
                <div className="space-y-16">
                    {/* Linked Rewards */}
                    <section className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden">
                        <div className="p-10 border-b border-[#151515]">
                            <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Linked Rewards</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">{rewards.length} Active Offers</p>
                        </div>
                        <div className="p-10 space-y-6">
                            {rewards.length === 0 ? (
                                <div className="text-center py-10">
                                    <Award size={32} className="mx-auto text-[#151515] mb-4" />
                                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">No rewards linked</p>
                                </div>
                            ) : rewards.map(r => (
                                <div key={r.id} className="bg-[#050505] border border-[#151515] p-6 rounded-2xl group hover:border-[#E8D200]/20 transition-all">
                                    <div className="flex justify-between items-center mb-3">
                                        <span className="text-sm font-bold text-[#DDD]">{r.title}</span>
                                        <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.2em] ${r.active ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20' : 'bg-[#151515] text-[#333]'}`}>
                                            {r.active ? 'LIVE' : 'OFF'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-[0.3em] text-[#333]">
                                        <span>{r.powr_cost} PTS</span>
                                        <span>{r.stock !== null ? `${r.stock} left` : '∞ stock'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* System Metadata */}
                    <section className="bg-[#0A0A0A] border border-[#151515] p-10 rounded-[2rem]">
                        <h3 className="text-base font-black uppercase tracking-[0.3em] text-[#444] mb-10">System Data</h3>
                        <div className="space-y-6">
                            {[
                                { label: 'Node ID', value: partner.id.substring(0, 18) + '...' },
                                { label: 'Created', value: new Date(partner.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) },
                                { label: 'Status', value: partner.active ? 'Active' : 'Inactive' },
                                { label: 'Linked Rewards', value: `${rewards.length}` },
                            ].map(x => (
                                <div key={x.label} className="flex items-center justify-between p-6 bg-[#050505] border border-[#151515] rounded-2xl">
                                    <span className="text-[10px] uppercase tracking-[0.3em] text-[#333] font-black">{x.label}</span>
                                    <span className="text-[11px] font-medium text-[#BBB] font-mono">{x.value}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
