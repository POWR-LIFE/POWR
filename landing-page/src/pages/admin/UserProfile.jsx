import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import {
    User, Activity, Award, Calendar, Clock, MapPin,
    ChevronLeft, TrendingUp, Zap, Shield, AlertCircle,
    ArrowUpRight, ArrowDownRight, Gift, Plus, X,
    Heart, Moon, Flame, Footprints
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

const formatSessionTime = (start, sec) => {
    const dStart = new Date(start);
    const dEnd = new Date(dStart.getTime() + sec * 1000);
    const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
    return `${dStart.toLocaleTimeString([], timeOptions)} - ${dEnd.toLocaleTimeString([], timeOptions)}`;
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
    const [healthSnapshots, setHealthSnapshots] = useState([]);
    const [showAdjust, setShowAdjust] = useState(false);
    const [adjAmount, setAdjAmount] = useState('');
    const [adjDesc, setAdjDesc] = useState('');
    const [adjLoading, setAdjLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('activity');
    const [visibleSessions, setVisibleSessions] = useState(10);
    const [visibleTransactions, setVisibleTransactions] = useState(10);

    const [activityDateFilter, setActivityDateFilter] = useState('');
    const [activityTypeFilter, setActivityTypeFilter] = useState('');
    const [activityVerificationFilter, setActivityVerificationFilter] = useState('');
    
    const [pointsDateFilter, setPointsDateFilter] = useState('');
    const [pointsTypeFilter, setPointsTypeFilter] = useState('');
    const [pointsSearchFilter, setPointsSearchFilter] = useState('');

    const filteredSessions = sessions.filter(s => {
        let match = true;
        if (activityDateFilter) match = match && s.started_at.startsWith(activityDateFilter);
        if (activityTypeFilter) match = match && s.type.toLowerCase() === activityTypeFilter.toLowerCase();
        if (activityVerificationFilter) match = match && s.verification.toLowerCase() === activityVerificationFilter.toLowerCase();
        return match;
    });

    const filteredTransactions = transactions.filter(t => {
        let match = true;
        if (pointsDateFilter) match = match && t.created_at.startsWith(pointsDateFilter);
        if (pointsTypeFilter) match = match && t.type.toLowerCase() === pointsTypeFilter.toLowerCase();
        if (pointsSearchFilter) match = match && (t.description || '').toLowerCase().includes(pointsSearchFilter.toLowerCase());
        return match;
    });

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
            const [p, s, t, str, r, hs] = await Promise.all([
                supabase.from('profiles').select('*').eq('id', userId).single(),
                supabase.from('activity_sessions').select('*').eq('user_id', userId).order('started_at', { ascending: false }),
                supabase.from('point_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
                supabase.from('user_streaks').select('*').eq('user_id', userId).single(),
                supabase.from('redemptions').select('*, rewards(*)').eq('user_id', userId).order('redeemed_at', { ascending: false }),
                supabase.from('health_snapshots').select('*').eq('user_id', userId).order('recorded_at', { ascending: false }).limit(100)
            ]);

            if (p.error) throw p.error;
            setProfile(p.data);
            setSessions(s.data || []);
            setTransactions(t.data || []);
            setStreak(str.data || null);
            setRedemptions(r.data || []);
            setHealthSnapshots(hs.data || []);

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
                            {profile.location_granted ? (
                                <span className="px-4 py-1.5 rounded-full bg-[#10B981]/10 border border-[#10B981]/20 text-[#10B981] text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                                    <MapPin size={12} /> Location
                                </span>
                            ) : (
                                <span className="px-4 py-1.5 rounded-full bg-[#151515] text-[#333] text-[10px] font-black uppercase tracking-[0.2em]">No Location</span>
                            )}
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
                <div className="lg:col-span-2">
                    {/* Tabs Header */}
                    <div className="flex items-center gap-8 mb-8 border-b border-[#151515]">
                        <button
                            onClick={() => setActiveTab('activity')}
                            className={`pb-4 text-[11px] font-black uppercase tracking-[0.2em] transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'activity' ? 'text-[#E8D200] border-[#E8D200]' : 'text-[#555] border-transparent hover:text-[#CCC]'}`}
                        >
                            <Activity size={14} /> Activity Logs
                        </button>
                        <button
                            onClick={() => setActiveTab('points')}
                            className={`pb-4 text-[11px] font-black uppercase tracking-[0.2em] transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'points' ? 'text-[#E8D200] border-[#E8D200]' : 'text-[#555] border-transparent hover:text-[#CCC]'}`}
                        >
                            <Zap size={14} /> Points Ledger
                        </button>
                        <button
                            onClick={() => setActiveTab('health')}
                            className={`pb-4 text-[11px] font-black uppercase tracking-[0.2em] transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'health' ? 'text-[#E8D200] border-[#E8D200]' : 'text-[#555] border-transparent hover:text-[#CCC]'}`}
                        >
                            <Heart size={14} /> Health Data
                        </button>
                    </div>

                    {/* Activity Timeline */}
                    {activeTab === 'activity' && (
                        <section className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="p-10 border-b border-[#151515] flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Activity Logs</h3>
                                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Historical Telemetry Data</p>
                                </div>
                                <span className="text-[10px] font-black text-[#444] uppercase tracking-[0.3em]">{filteredSessions.length} RECORDED</span>
                            </div>
                            
                            {/* Activity Filters */}
                            <div className="p-6 bg-[#050505] border-b border-[#151515] flex flex-wrap gap-4">
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#555] font-black mb-2">Date</label>
                                    <input 
                                        type="date" 
                                        value={activityDateFilter} 
                                        onChange={e => setActivityDateFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#1E1E1E] rounded-lg text-[#CCC] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color]"
                                    />
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#555] font-black mb-2">Type</label>
                                    <select 
                                        value={activityTypeFilter} 
                                        onChange={e => setActivityTypeFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#1E1E1E] rounded-lg text-[#CCC] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color] appearance-none"
                                    >
                                        <option value="">All Types</option>
                                        <option value="gym">Gym</option>
                                        <option value="running">Running</option>
                                        <option value="walking">Walking</option>
                                        <option value="cycling">Cycling</option>
                                        <option value="swimming">Swimming</option>
                                    </select>
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#555] font-black mb-2">Verification</label>
                                    <select 
                                        value={activityVerificationFilter} 
                                        onChange={e => setActivityVerificationFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#1E1E1E] rounded-lg text-[#CCC] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color] appearance-none"
                                    >
                                        <option value="">All Methods</option>
                                        <option value="wearable">Wearable</option>
                                        <option value="geofence">Geofence</option>
                                        <option value="manual">Manual</option>
                                    </select>
                                </div>
                                {(activityDateFilter || activityTypeFilter || activityVerificationFilter) && (
                                    <div className="flex items-end">
                                        <button 
                                            onClick={() => { setActivityDateFilter(''); setActivityTypeFilter(''); setActivityVerificationFilter(''); }}
                                            className="h-10 px-4 text-[10px] uppercase tracking-[0.2em] font-black text-[#888] hover:text-[#F2F2F2] transition-colors"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="divide-y divide-[#151515]">
                                {filteredSessions.length === 0 ? (
                                    <div className="p-20 text-center text-[#1A1A1A] text-[10px] uppercase tracking-[0.4em] font-black">No activity markers detected</div>
                                ) : filteredSessions.slice(0, visibleSessions).map(session => (
                                    <div key={session.id} className="p-10 flex items-center gap-10 group hover:bg-[#050505] transition-all">
                                        <div className="w-14 h-14 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0">
                                            <Activity size={20} className="text-[#333] group-hover:text-[#E8D200] transition-colors" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-lg font-bold text-[#DDD] capitalize">{session.type} session</span>
                                                <span className="text-[10px] text-[#222] font-black uppercase tracking-[0.4em]">{timeAgo(session.started_at)}</span>
                                            </div>
                                            {session.verification === 'geofence' && session.raw_gps?.partnerName && (
                                                <div className="text-[12px] text-[#A0A0A0] mb-3 font-medium flex items-center gap-2">
                                                    <MapPin size={12} className="text-[#E8D200]" />
                                                    <span>{session.raw_gps.partnerName}</span>
                                                    <span className="text-[#444]">•</span>
                                                    <span>{formatSessionTime(session.started_at, session.duration_sec)}</span>
                                                </div>
                                            )}
                                            {(!session.raw_gps || session.verification !== 'geofence') && <div className="mb-2" />}
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
                            {filteredSessions.length > visibleSessions && (
                                <div className="p-6 border-t border-[#151515] text-center bg-[#050505] hover:bg-[#111] transition-colors">
                                    <button 
                                        onClick={() => setVisibleSessions(prev => prev + 10)}
                                        className="text-[10px] text-[#E8D200] font-black uppercase tracking-[0.3em] transition-colors py-2 px-6"
                                    >
                                        Load More Activity
                                    </button>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Point Ledger */}
                    {activeTab === 'points' && (
                        <section className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="p-10 border-b border-[#151515] flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Points Ledger</h3>
                                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Transaction History</p>
                                </div>
                                <span className="text-[10px] font-black text-[#444] uppercase tracking-[0.3em]">{filteredTransactions.length} RECORDED</span>
                            </div>

                            {/* Points Filters */}
                            <div className="p-6 bg-[#050505] border-b border-[#151515] flex flex-wrap gap-4">
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#555] font-black mb-2">Search</label>
                                    <input 
                                        type="text" 
                                        placeholder="Search description..."
                                        value={pointsSearchFilter} 
                                        onChange={e => setPointsSearchFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#1E1E1E] rounded-lg text-[#CCC] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color]"
                                    />
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#555] font-black mb-2">Date</label>
                                    <input 
                                        type="date" 
                                        value={pointsDateFilter} 
                                        onChange={e => setPointsDateFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#1E1E1E] rounded-lg text-[#CCC] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color]"
                                    />
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#555] font-black mb-2">Type</label>
                                    <select 
                                        value={pointsTypeFilter} 
                                        onChange={e => setPointsTypeFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-[#0A0A0A] border border-[#1E1E1E] rounded-lg text-[#CCC] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color] appearance-none"
                                    >
                                        <option value="">All Types</option>
                                        <option value="earn">Earn</option>
                                        <option value="spend">Spend</option>
                                        <option value="adjustment">Adjustment</option>
                                    </select>
                                </div>
                                {(pointsSearchFilter || pointsDateFilter || pointsTypeFilter) && (
                                    <div className="flex items-end">
                                        <button 
                                            onClick={() => { setPointsSearchFilter(''); setPointsDateFilter(''); setPointsTypeFilter(''); }}
                                            className="h-10 px-4 text-[10px] uppercase tracking-[0.2em] font-black text-[#888] hover:text-[#F2F2F2] transition-colors"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                )}
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
                                        {filteredTransactions.length === 0 ? (
                                            <tr><td colSpan={3} className="px-6 py-12 text-center text-[#1A1A1A] text-[10px] uppercase tracking-[0.4em] font-black">No transactions recorded</td></tr>
                                        ) : filteredTransactions.slice(0, visibleTransactions).map(t => (
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
                            {filteredTransactions.length > visibleTransactions && (
                                <div className="p-6 border-t border-[#151515] text-center bg-[#050505] hover:bg-[#111] transition-colors">
                                    <button 
                                        onClick={() => setVisibleTransactions(prev => prev + 10)}
                                        className="text-[10px] text-[#E8D200] font-black uppercase tracking-[0.3em] transition-colors py-2 px-6"
                                    >
                                        Load More Points
                                    </button>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Health Data Tab */}
                    {activeTab === 'health' && (() => {
                        // Aggregate latest health metrics
                        const latestWithSteps = healthSnapshots.find(s => s.steps > 0);
                        const latestWithHR = healthSnapshots.find(s => s.hr_avg > 0);
                        const latestWithCalories = healthSnapshots.find(s => s.calories_active > 0);
                        const latestWithSleep = healthSnapshots.find(s => s.sleep_duration_h > 0);

                        // Last 7 days of snapshots for trends
                        const weekAgo = new Date();
                        weekAgo.setDate(weekAgo.getDate() - 7);
                        const weekSnapshots = healthSnapshots.filter(s => new Date(s.recorded_at) >= weekAgo);

                        const avgSteps = weekSnapshots.filter(s => s.steps > 0).length > 0
                            ? Math.round(weekSnapshots.filter(s => s.steps > 0).reduce((sum, s) => sum + s.steps, 0) / weekSnapshots.filter(s => s.steps > 0).length)
                            : 0;
                        const avgSleep = weekSnapshots.filter(s => s.sleep_duration_h > 0).length > 0
                            ? (weekSnapshots.filter(s => s.sleep_duration_h > 0).reduce((sum, s) => sum + s.sleep_duration_h, 0) / weekSnapshots.filter(s => s.sleep_duration_h > 0).length).toFixed(1)
                            : '—';
                        const avgHR = weekSnapshots.filter(s => s.hr_avg > 0).length > 0
                            ? Math.round(weekSnapshots.filter(s => s.hr_avg > 0).reduce((sum, s) => sum + s.hr_avg, 0) / weekSnapshots.filter(s => s.hr_avg > 0).length)
                            : 0;
                        const totalCalories = weekSnapshots.filter(s => s.calories_active > 0).reduce((sum, s) => sum + s.calories_active, 0);

                        return (
                            <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
                                {/* Summary Cards */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    {[
                                        { label: 'Avg Daily Steps', value: avgSteps > 0 ? avgSteps.toLocaleString() : '—', sub: '7-day avg', icon: Footprints, color: '#10B981' },
                                        { label: 'Avg Sleep', value: avgSleep !== '—' ? `${avgSleep}h` : '—', sub: '7-day avg', icon: Moon, color: '#8B5CF6' },
                                        { label: 'Avg Heart Rate', value: avgHR > 0 ? `${avgHR} bpm` : '—', sub: '7-day avg', icon: Heart, color: '#F43F5E' },
                                        { label: 'Active Calories', value: totalCalories > 0 ? totalCalories.toLocaleString() : '—', sub: '7-day total', icon: Flame, color: '#F97316' },
                                    ].map(card => (
                                        <div key={card.label} className="bg-[#0A0A0A] border border-[#151515] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-3">
                                                <card.icon size={14} style={{ color: card.color }} />
                                                <span className="text-[9px] uppercase tracking-[0.3em] text-[#333] font-black">{card.label}</span>
                                            </div>
                                            <div className="text-2xl font-light tracking-tighter text-[#DDD] mb-1">{card.value}</div>
                                            <div className="text-[9px] uppercase tracking-[0.3em] text-[#222] font-black">{card.sub}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Latest Readings */}
                                <div className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden">
                                    <div className="p-10 border-b border-[#151515]">
                                        <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Latest Readings</h3>
                                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Most recent health data from device</p>
                                    </div>
                                    <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        {/* Steps */}
                                        <div className="bg-[#050505] border border-[#151515] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Footprints size={16} className="text-[#10B981]" />
                                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#555] font-black">Steps</span>
                                            </div>
                                            {latestWithSteps ? (
                                                <>
                                                    <div className="text-3xl font-light tracking-tighter text-[#F2F2F2] mb-2">{latestWithSteps.steps.toLocaleString()}</div>
                                                    <div className="text-[9px] text-[#333] font-black uppercase tracking-[0.3em]">{timeAgo(latestWithSteps.recorded_at)}</div>
                                                </>
                                            ) : (
                                                <div className="text-[#222] text-sm">No step data recorded</div>
                                            )}
                                        </div>

                                        {/* Heart Rate */}
                                        <div className="bg-[#050505] border border-[#151515] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Heart size={16} className="text-[#F43F5E]" />
                                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#555] font-black">Heart Rate</span>
                                            </div>
                                            {latestWithHR ? (
                                                <>
                                                    <div className="text-3xl font-light tracking-tighter text-[#F2F2F2] mb-2">{latestWithHR.hr_avg} <span className="text-lg text-[#555]">bpm avg</span></div>
                                                    <div className="flex gap-6 text-[10px] text-[#444] font-black uppercase tracking-[0.2em]">
                                                        {latestWithHR.hr_max > 0 && <span>Max: {latestWithHR.hr_max}</span>}
                                                        {latestWithHR.hr_resting > 0 && <span>Resting: {latestWithHR.hr_resting}</span>}
                                                    </div>
                                                    <div className="text-[9px] text-[#333] font-black uppercase tracking-[0.3em] mt-2">{timeAgo(latestWithHR.recorded_at)}</div>
                                                </>
                                            ) : (
                                                <div className="text-[#222] text-sm">No heart rate data recorded</div>
                                            )}
                                        </div>

                                        {/* Sleep */}
                                        <div className="bg-[#050505] border border-[#151515] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Moon size={16} className="text-[#8B5CF6]" />
                                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#555] font-black">Sleep</span>
                                            </div>
                                            {latestWithSleep ? (
                                                <>
                                                    <div className="text-3xl font-light tracking-tighter text-[#F2F2F2] mb-2">{latestWithSleep.sleep_duration_h}<span className="text-lg text-[#555]">h total</span></div>
                                                    <div className="flex gap-4 mt-2">
                                                        {latestWithSleep.sleep_deep_h > 0 && (
                                                            <div className="flex-1 bg-[#0A0A0A] border border-[#151515] p-3 rounded-xl text-center">
                                                                <div className="text-[#8B5CF6] text-lg font-light">{latestWithSleep.sleep_deep_h}h</div>
                                                                <div className="text-[8px] uppercase tracking-[0.3em] text-[#333] font-black">Deep</div>
                                                            </div>
                                                        )}
                                                        {latestWithSleep.sleep_rem_h > 0 && (
                                                            <div className="flex-1 bg-[#0A0A0A] border border-[#151515] p-3 rounded-xl text-center">
                                                                <div className="text-[#6366F1] text-lg font-light">{latestWithSleep.sleep_rem_h}h</div>
                                                                <div className="text-[8px] uppercase tracking-[0.3em] text-[#333] font-black">REM</div>
                                                            </div>
                                                        )}
                                                        {latestWithSleep.sleep_light_h > 0 && (
                                                            <div className="flex-1 bg-[#0A0A0A] border border-[#151515] p-3 rounded-xl text-center">
                                                                <div className="text-[#A78BFA] text-lg font-light">{latestWithSleep.sleep_light_h}h</div>
                                                                <div className="text-[8px] uppercase tracking-[0.3em] text-[#333] font-black">Light</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="text-[9px] text-[#333] font-black uppercase tracking-[0.3em] mt-3">{timeAgo(latestWithSleep.recorded_at)}</div>
                                                </>
                                            ) : (
                                                <div className="text-[#222] text-sm">No sleep data recorded</div>
                                            )}
                                        </div>

                                        {/* Calories */}
                                        <div className="bg-[#050505] border border-[#151515] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Flame size={16} className="text-[#F97316]" />
                                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#555] font-black">Calories</span>
                                            </div>
                                            {latestWithCalories ? (
                                                <>
                                                    <div className="text-3xl font-light tracking-tighter text-[#F2F2F2] mb-2">{Math.round(latestWithCalories.calories_active)} <span className="text-lg text-[#555]">kcal active</span></div>
                                                    {latestWithCalories.calories_total > 0 && (
                                                        <div className="text-[10px] text-[#444] font-black uppercase tracking-[0.2em]">Total: {Math.round(latestWithCalories.calories_total)} kcal</div>
                                                    )}
                                                    <div className="text-[9px] text-[#333] font-black uppercase tracking-[0.3em] mt-2">{timeAgo(latestWithCalories.recorded_at)}</div>
                                                </>
                                            ) : (
                                                <div className="text-[#222] text-sm">No calorie data recorded</div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Snapshot History */}
                                <div className="bg-[#0A0A0A] border border-[#151515] rounded-[2rem] overflow-hidden">
                                    <div className="p-10 border-b border-[#151515] flex items-center justify-between">
                                        <div>
                                            <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Snapshot History</h3>
                                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Raw health telemetry log</p>
                                        </div>
                                        <span className="text-[10px] font-black text-[#444] uppercase tracking-[0.3em]">{healthSnapshots.length} RECORDED</span>
                                    </div>
                                    <div className="divide-y divide-[#151515]">
                                        {healthSnapshots.length === 0 ? (
                                            <div className="p-20 text-center text-[#1A1A1A] text-[10px] uppercase tracking-[0.4em] font-black">No health snapshots recorded</div>
                                        ) : healthSnapshots.slice(0, 20).map(snap => (
                                            <div key={snap.id} className="p-6 flex items-center gap-8 group hover:bg-[#050505] transition-all">
                                                <div className="w-10 h-10 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0">
                                                    {snap.sleep_duration_h > 0 ? <Moon size={16} className="text-[#8B5CF6]" /> :
                                                     snap.hr_avg > 0 ? <Heart size={16} className="text-[#F43F5E]" /> :
                                                     <Activity size={16} className="text-[#333]" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-3 mb-1">
                                                        <span className="text-sm font-bold text-[#DDD] capitalize">{snap.activity_type || 'General'}</span>
                                                        <span className="px-2 py-0.5 rounded-full border border-[#151515] text-[8px] font-black uppercase tracking-[0.2em] text-[#333]">{snap.source}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-4 text-[10px] font-black text-[#444] uppercase tracking-[0.2em]">
                                                        {snap.steps > 0 && <span>{snap.steps.toLocaleString()} steps</span>}
                                                        {snap.hr_avg > 0 && <span>{snap.hr_avg} bpm</span>}
                                                        {snap.calories_active > 0 && <span>{Math.round(snap.calories_active)} kcal</span>}
                                                        {snap.sleep_duration_h > 0 && <span>{snap.sleep_duration_h}h sleep</span>}
                                                        {snap.distance_m > 0 && <span>{(snap.distance_m / 1000).toFixed(1)}km</span>}
                                                        {snap.duration_sec > 0 && <span>{Math.floor(snap.duration_sec / 60)}m</span>}
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-[#222] font-black uppercase tracking-[0.3em] shrink-0">{timeAgo(snap.recorded_at)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        );
                    })()}
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
                                { label: 'Location Access', value: profile.location_granted ? 'Granted' : 'Denied', icon: MapPin, highlight: profile.location_granted },
                                { label: 'Node Uptime', value: '182 Days', icon: Clock },
                                { label: 'Sync Status', value: 'Verified', icon: Shield },
                                { label: 'Risk Factor', value: 'Low (0.02)', icon: AlertCircle },
                            ].map(x => (
                                <div key={x.label} className="flex items-center justify-between p-6 bg-[#050505] border border-[#151515] rounded-2xl">
                                    <div className="flex items-center gap-4">
                                        <x.icon size={14} className={x.highlight ? 'text-[#10B981]' : 'text-[#222]'} />
                                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#333] font-black">{x.label}</span>
                                    </div>
                                    <span className={`text-[11px] font-medium ${x.highlight ? 'text-[#10B981]' : 'text-[#BBB]'}`}>{x.value}</span>
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
