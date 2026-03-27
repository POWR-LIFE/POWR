import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { 
    User, Activity, Award, Calendar, Clock, MapPin, 
    ChevronLeft, TrendingUp, Zap, Shield, AlertCircle,
    ArrowUpRight, ArrowDownRight, Gift, Plus, X
} from 'lucide-react';

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

export default function UserProfile() {
    const { userId } = useParams();
    const toast = useToast();
    const { user: adminUser } = useAuth();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [streak, setStreak] = useState(null);
    const [redemptions, setRedemptions] = useState([]);
    const [showAdjust, setShowAdjust] = useState(false);
    const [adjAmount, setAdjAmount] = useState('');
    const [adjDesc, setAdjDesc] = useState('');
    const [adjLoading, setAdjLoading] = useState(false);

    const handlePointAdjust = async () => {
        const amt = parseInt(adjAmount);
        if (isNaN(amt) || amt === 0) { toast.error('Enter a valid non-zero amount'); return; }
        setAdjLoading(true);
        const { error } = await supabase.from('point_transactions').insert({
            user_id: userId, amount: amt, type: 'adjustment',
            description: adjDesc || `Manual adjustment by admin`, multiplier: 1.0
        });
        if (error) { toast.error(error.message); setAdjLoading(false); return; }
        await logAction(adminUser.id, 'point_adjustment', 'user', userId, { amount: amt, description: adjDesc });
        toast.success(`${amt > 0 ? '+' : ''}${amt} points applied`);
        setShowAdjust(false); setAdjAmount(''); setAdjDesc(''); setAdjLoading(false);
        fetchData();
    };

    useEffect(() => {
        if (userId) fetchData();
    }, [userId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [p, s, t, str, r] = await Promise.all([
                supabase.from('profiles').select('*').eq('id', userId).single(),
                supabase.from('activity_sessions').select('*').eq('user_id', userId).order('started_at', { ascending: false }),
                supabase.from('point_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
                supabase.from('user_streaks').select('*').eq('user_id', userId).single(),
                supabase.from('redemptions').select('*, rewards(*)').eq('user_id', userId).order('redeemed_at', { ascending: false })
            ]);

            if (p.error) throw p.error;
            setProfile(p.data);
            setSessions(s.data || []);
            setTransactions(t.data || []);
            setStreak(str.data || null);
            setRedemptions(r.data || []);

        } catch (e) {
            toast.error('Telemetry Sync Failed');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-48 gap-6">
            <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
            <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Decrypting Node Data...</span>
        </div>
    );

    if (!profile) return (
        <div className="py-20 text-center">
            <h2 className="text-2xl font-light text-[#F2F2F2] mb-4">Node Not Found</h2>
            <Link to="/admin/users" className="text-[#E8D200] text-sm uppercase tracking-widest font-black">Back to Registry</Link>
        </div>
    );

    const totalPoints = transactions.reduce((acc, t) => acc + t.amount, 0);

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Nav */}
            <Link to="/admin/users" className="group flex items-center gap-3 mb-12 text-[#222] hover:text-[#F2F2F2] transition-colors">
                <ChevronLeft size={16} />
                <span className="text-[10px] uppercase tracking-[0.4em] font-black">Back to Registry</span>
            </Link>

            {/* Header / Identity */}
            <header className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-12 mb-24">
                <div className="flex items-center gap-10">
                    <div className="w-32 h-32 rounded-[2.5rem] bg-[#0A0A0A] border border-[#151515] flex items-center justify-center overflow-hidden shrink-0 shadow-2xl">
                        {profile.avatar_url ? (
                            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <User size={48} className="text-[#1A1A1A]" />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center gap-4 mb-3">
                            <span className="px-4 py-1.5 rounded-full bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em]">LVL {profile.level || 1}</span>
                            <span className="text-[11px] uppercase tracking-[0.6em] text-[#444] font-black">Established {new Date(profile.created_at).getFullYear()}</span>
                        </div>
                        <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-2">{profile.display_name || profile.username || 'Anonymous Node'}</h1>
                        <p className="text-[#222] text-[12px] font-black uppercase tracking-[0.5em]">UID: {profile.id.substring(0, 18)}...</p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-8">
                    {[
                        { label: 'Available Points', value: totalPoints.toLocaleString(), icon: Zap, color: '#E8D200' },
                        { label: 'Current Streak', value: `${streak?.current_streak || 0}D`, icon: TrendingUp, color: '#10B981' },
                        { label: 'Trust Score', value: '0.98', icon: Shield, color: '#0EA5E9' },
                    ].map(s => (
                        <div key={s.label} className="bg-[#0A0A0A] border border-[#151515] p-8 px-10 rounded-3xl min-w-[180px]">
                            <div className="flex items-center gap-4 mb-4">
                                <s.icon size={16} style={{ color: s.color }} />
                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black">{s.label}</span>
                            </div>
                            <div className="text-4xl font-light tracking-tighter text-[#DDD] leading-none">{s.value}</div>
                        </div>
                    ))}
                </div>

                <button onClick={() => setShowAdjust(true)} className="h-14 px-8 bg-[#E8D200] text-[#080808] rounded-full text-[10px] font-black uppercase tracking-[0.3em] hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 flex items-center gap-3 shrink-0">
                    <Plus size={16} /> Adjust Points
                </button>
            </header>

            {/* Point Adjustment Modal */}
            {showAdjust && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center" onClick={() => setShowAdjust(false)}>
                    <div className="bg-[#0A0A0A] border border-[#1E1E1E] rounded-3xl p-12 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-10">
                            <h3 className="text-2xl font-light tracking-tighter text-[#F2F2F2]">Adjust Points</h3>
                            <button onClick={() => setShowAdjust(false)} className="w-10 h-10 rounded-full bg-[#151515] flex items-center justify-center text-[#555] hover:text-[#F2F2F2] transition-colors"><X size={18} /></button>
                        </div>
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#333] font-black mb-8">Use negative values to debit points</p>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-[#555] font-black mb-3">Amount</label>
                                <input type="number" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} placeholder="e.g. 100 or -50" className="w-full h-14 px-6 bg-[#050505] border border-[#1E1E1E] rounded-xl text-[#F2F2F2] text-lg font-light outline-none focus:border-[#E8D200]/40 transition-all" />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-[#555] font-black mb-3">Reason</label>
                                <input type="text" value={adjDesc} onChange={e => setAdjDesc(e.target.value)} placeholder="Manual correction, bonus, etc." className="w-full h-14 px-6 bg-[#050505] border border-[#1E1E1E] rounded-xl text-[#F2F2F2] text-sm outline-none focus:border-[#E8D200]/40 transition-all" />
                            </div>
                            <button onClick={handlePointAdjust} disabled={adjLoading} className="w-full h-14 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-xs rounded-xl hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 disabled:opacity-50">
                                {adjLoading ? 'Processing...' : 'Apply Adjustment'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
                {/* Left Column: Sessions & Transactions */}
                <div className="lg:col-span-2 space-y-16">
                    {/* Activity Timeline */}
                    <section className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden">
                        <div className="p-10 border-b border-[#151515] flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Activity Logs</h3>
                                <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Historical Telemetry Data</p>
                            </div>
                            <span className="text-[10px] font-black text-[#444] uppercase tracking-[0.3em]">{sessions.length} RECORDED</span>
                        </div>
                        <div className="divide-y divide-[#151515]">
                            {sessions.length === 0 ? (
                                <div className="p-20 text-center text-[#1A1A1A] text-[10px] uppercase tracking-[0.4em] font-black">No activity markers detected</div>
                            ) : sessions.map(session => (
                                <div key={session.id} className="p-10 flex items-center gap-10 group hover:bg-[#050505] transition-all">
                                    <div className="w-14 h-14 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0">
                                        <Activity size={20} className="text-[#333] group-hover:text-[#E8D200] transition-colors" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-lg font-bold text-[#DDD] capitalize">{session.type} session</span>
                                            <span className="text-[10px] text-[#222] font-black uppercase tracking-[0.4em]">{timeAgo(session.started_at)}</span>
                                        </div>
                                        <div className="flex items-center gap-6 text-[10px] font-black text-[#333] uppercase tracking-[0.2em]">
                                            <span className="flex items-center gap-2"><Clock size={12} /> {Math.floor(session.duration_sec / 60)}M</span>
                                            {session.distance_m > 0 && <span className="flex items-center gap-2"><MapPin size={12} /> {(session.distance_m / 1000).toFixed(2)}KM</span>}
                                            <span className={`px-3 py-1 rounded-full border ${session.verification === 'geofence' ? 'border-[#10B981]/20 text-[#10B981]' : 'border-[#151515] text-[#222]'}`}>
                                                {session.verification} verify
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-2xl font-light tracking-tighter text-[#F2F2F2] mb-1">{(session.trust_score * 100).toFixed(0)}%</div>
                                        <div className="text-[8px] uppercase tracking-[0.3em] text-[#222] font-black">TRUST</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Point Ledger */}
                    <section className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden">
                        <div className="p-10 border-b border-[#151515]">
                            <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Points Ledger</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Transaction History</p>
                        </div>
                        <div className="p-6">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-[9px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black border-b border-[#151515]">
                                        <th className="px-6 py-4">Descriptor</th>
                                        <th className="px-6 py-4">Type</th>
                                        <th className="px-6 py-4 text-right">Impact</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#121212]">
                                    {transactions.length === 0 ? (
                                        <tr><td colSpan={3} className="px-6 py-12 text-center text-[#1A1A1A] text-[10px] uppercase tracking-[0.4em] font-black">No transactions recorded</td></tr>
                                    ) : transactions.map(t => (
                                        <tr key={t.id} className="group hover:bg-[#050505] transition-all">
                                            <td className="px-6 py-6">
                                                <div className="text-base font-bold text-[#BBB] group-hover:text-[#F2F2F2] transition-colors mb-1">{t.description || 'System Adjustment'}</div>
                                                <div className="text-[9px] text-[#222] font-black uppercase tracking-[0.4em]">{new Date(t.created_at).toLocaleDateString()}</div>
                                            </td>
                                            <td className="px-6 py-6 font-mono text-[11px] uppercase tracking-widest text-[#444]">{t.type}</td>
                                            <td className="px-6 py-6 text-right">
                                                <div className={`flex items-center justify-end gap-2 font-black text-xl tracking-tighter ${t.amount >= 0 ? 'text-[#10B981]' : 'text-[#F43F5E]'}`}>
                                                    {t.amount >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                                                    {Math.abs(t.amount)}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>

                {/* Right Column: Inventory & Stats */}
                <div className="space-y-16">
                    {/* Inventory / Redemptions */}
                    <section className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden">
                        <div className="p-10 border-b border-[#151515]">
                            <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Inventory</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Acquired Rewards</p>
                        </div>
                        <div className="p-10 space-y-8">
                            {redemptions.length === 0 ? (
                                <div className="text-center py-10">
                                    <Gift size={32} className="mx-auto text-[#151515] mb-4" />
                                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">No rewards redeemed</p>
                                </div>
                            ) : redemptions.map(r => (
                                <div key={r.id} className="bg-[#050505] border border-[#151515] p-8 rounded-3xl group hover:border-[#E8D200]/20 transition-all">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="text-lg font-bold text-[#DDD] group-hover:text-[#F2F2F2] transition-colors leading-tight">{r.rewards?.title}</div>
                                        <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.2em] ${r.status === 'active' ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20' : 'bg-[#151515] text-[#333]'}`}>
                                            {r.status}
                                        </span>
                                    </div>
                                    <div className="font-mono text-xs text-[#E8D200] bg-[#0A0A0A] p-3 rounded-xl border border-[#151515] text-center tracking-[0.3em] mb-4 uppercase">
                                        {r.code}
                                    </div>
                                    <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-[0.3em] text-[#222]">
                                        <span>{r.rewards?.powr_cost} PTS</span>
                                        <span>{new Date(r.redeemed_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Meta / System Diagnostics */}
                    <section className="bg-[#0A0A0A] border border-[#151515] p-10 rounded-[2rem]">
                        <h3 className="text-base font-black uppercase tracking-[0.3em] text-[#444] mb-10">Diagnostic Data</h3>
                        <div className="space-y-6">
                            {[
                                { label: 'Node Uptime', value: '182 Days', icon: Clock },
                                { label: 'Sync Status', value: 'Verified', icon: Shield },
                                { label: 'Risk Factor', value: 'Low (0.02)', icon: AlertCircle },
                            ].map(x => (
                                <div key={x.label} className="flex items-center justify-between p-6 bg-[#050505] border border-[#151515] rounded-2xl">
                                    <div className="flex items-center gap-4">
                                        <x.icon size={14} className="text-[#222]" />
                                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#333] font-black">{x.label}</span>
                                    </div>
                                    <span className="text-[11px] font-medium text-[#BBB]">{x.value}</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-10 p-6 bg-red-500/5 border border-red-500/10 rounded-2xl">
                            <button className="w-full text-[10px] font-black uppercase tracking-[0.4em] text-red-500/60 hover:text-red-500 transition-all">Flag Node for Review</button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
