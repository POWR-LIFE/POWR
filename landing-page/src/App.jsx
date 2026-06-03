import React, { useEffect, useState, createContext, useContext } from 'react';
import { initLandingPage } from '../main.js';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { ToastProvider } from './lib/toast';
import {
    LayoutDashboard, Users, ClipboardList, LogOut, ChevronRight,
    Activity, Award, AlertTriangle, BarChart3, Shield, Settings, ScrollText, Gift, Target, MessageSquare, Star, Inbox
} from 'lucide-react';

import PartnerManager from './pages/admin/PartnerManager';
import RewardManager from './pages/admin/RewardManager';
import RewardSubmissions from './pages/admin/RewardSubmissions';
import PartnerRewardSubmit from './pages/PartnerRewardSubmit';
import WeeklyChallenges from './pages/admin/WeeklyChallenges';
import WaitlistManager from './pages/admin/WaitlistManager';
import UserManager from './pages/admin/UserManager';
import UserProfile from './pages/admin/UserProfile';
import SessionReview from './pages/admin/SessionReview';
import Analytics from './pages/admin/Analytics';
import PartnerPerformance from './pages/admin/PartnerPerformance';
import RedemptionTracker from './pages/admin/RedemptionTracker';
import AuditLog from './pages/admin/AuditLog';
import SystemConfig from './pages/admin/SystemConfig';
import SupportTickets from './pages/admin/SupportTickets';
import PartnerProfile from './pages/admin/PartnerProfile';
import FeaturedSchedule from './pages/admin/FeaturedSchedule';
import PrivacyPolicy from './pages/PrivacyPolicy';
import CookiePolicy from './pages/CookiePolicy';
import TermsOfService from './pages/TermsOfService';
import SupportPage from './pages/SupportPage';
import AthleteSignup from './pages/AthleteSignup';
import AthleteApplications from './pages/admin/AthleteApplications';
import DeleteAccount from './pages/DeleteAccount';

// --- Auth Context ---
const AuthContext = createContext({ user: null, isAdmin: false, loading: true });

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    const checkAdmin = async (userId) => {
        try {
            const { data, error } = await supabase
                .from('admin_roles')
                .select('user_id')
                .eq('user_id', userId)
                .single();
            if (error && error.code !== 'PGRST116') return false;
            return !!data?.user_id;
        } catch {
            return false;
        }
    };

    useEffect(() => {
        let mounted = true;
        let lastUserId = null;

        const handleAuth = async (session) => {
            if (!mounted) return;
            if (session) {
                if (session.user.id === lastUserId) return;
                lastUserId = session.user.id;
                setUser(session.user);
                const adminStatus = await checkAdmin(session.user.id);
                if (mounted) { setIsAdmin(adminStatus); setLoading(false); }
            } else {
                lastUserId = null;
                setUser(null);
                setIsAdmin(false);
                if (mounted) setLoading(false);
            }
        };

        const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
            handleAuth(session);
        });

        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) handleAuth(session);
            else if (mounted) setLoading(false);
        });

        return () => { mounted = false; authListener.subscription.unsubscribe(); };
    }, []);

    return (
        <AuthContext.Provider value={{ user, isAdmin, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);

// --- Helpers ---
const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const PATH_LABELS = {
    admin: 'Overview',
    partners: 'Partners',
    rewards: 'Rewards',
    'reward-submissions': 'Submissions',
    challenges: 'Challenges',
    waitlist: 'Waitlist',
    users: 'Users',
    athletes: 'Athletes',
    profile: 'Profile',
    analytics: 'Analytics',
    sessions: 'Sessions',
    performance: 'Performance',
    redemptions: 'Redemptions',
    audit: 'Audit Log',
    support: 'Support Tickets',
    config: 'Config',
};

// --- Landing Page ---
const LandingPage = () => {
    useEffect(() => {
        const landing = document.getElementById('landing-content');
        if (landing) landing.style.display = 'block';
        initLandingPage();
        return () => { if (landing) landing.style.display = 'none'; };
    }, []);
    return null;
};

// --- Admin Login ---
const AdminLogin = () => {
    const navigate = useNavigate();
    const { isAdmin, user } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState(null);

    useEffect(() => {
        if (user && isAdmin) navigate('/admin');
    }, [user, isAdmin, navigate]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setStatus('Authenticating...');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            setError(error.message);
            setStatus(null);
            setLoading(false);
        } else {
            setStatus('Checking permissions...');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] fixed inset-0 z-[100]">
            <div className="w-full max-w-md p-8 bg-white border border-[#E6E6E1] rounded-2xl shadow-2xl">
                <div className="flex justify-center mb-8">
                    <img src="/powr-logo-black.png" alt="POWR" className="h-12" />
                </div>
                <h2 className="text-2xl font-light text-center mb-8 tracking-tight">Admin Portal</h2>
                <form onSubmit={handleLogin} className="space-y-6">
                    <div>
                        <label className="block text-[10px] uppercase tracking-widest text-[#777777] font-bold mb-2">Email address</label>
                        <input type="email" className="w-full h-12 px-4 bg-white border border-[#E6E6E1] rounded-lg focus:border-[#E8D200] outline-none transition-all text-sm text-[#1A1A1A]" value={email} onChange={e => setEmail(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-widest text-[#777777] font-bold mb-2">Password</label>
                        <input type="password" className="w-full h-12 px-4 bg-white border border-[#E6E6E1] rounded-lg focus:border-[#E8D200] outline-none transition-all text-sm text-[#1A1A1A]" value={password} onChange={e => setPassword(e.target.value)} required />
                    </div>
                    {error && <div className="text-red-400 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-lg">{error}</div>}
                    {status && <div className="text-[#8a7600] text-xs bg-[#E8D200]/5 p-3 border border-[#E8D200]/20 rounded-lg animate-pulse">{status}</div>}
                    <button type="submit" disabled={loading} className="w-full h-12 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-xs rounded-lg hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 disabled:opacity-50">
                        {loading ? 'Processing...' : 'Sign In'}
                    </button>
                    <div className="text-center pt-2">
                        <Link to="/" className="text-[10px] uppercase tracking-widest text-[#AAAAAA] hover:text-[#8a7600] transition-colors">Back to Landing Page</Link>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Protected Route ---
const ProtectedRoute = ({ children }) => {
    const { user, isAdmin, loading } = useAuth();
    const location = useLocation();

    if (loading) return (
        <div className="min-h-screen bg-[#F4F4F1] flex items-center justify-center fixed inset-0 z-[100]">
            <div className="flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-2 border-[#E8D200] border-t-transparent rounded-full animate-spin" />
                <p className="text-[10px] uppercase tracking-widest text-[#AAAAAA]">Verifying access...</p>
            </div>
        </div>
    );

    if (!user || !isAdmin) return <Navigate to="/admin/login" state={{ from: location }} replace />;
    return children;
};

// --- Admin Home ---
const AdminHome = () => {
    const [stats, setStats] = useState({ users: 0, partners: 0, rewards: 0, waitlist: 0 });
    const [recentSignups, setRecentSignups] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAll = async () => {
            try {
                const [u, p, r, w, signups] = await Promise.all([
                    supabase.from('profiles').select('id', { count: 'exact', head: true }),
                    supabase.from('partners').select('id', { count: 'exact', head: true }).eq('active', true),
                    supabase.from('rewards').select('id', { count: 'exact', head: true }).eq('active', true),
                    supabase.from('waitlist').select('id', { count: 'exact', head: true }),
                    supabase.from('waitlist').select('email, typ, created_at').order('created_at', { ascending: false }).limit(6),
                ]);
                setStats({ users: u.count || 0, partners: p.count || 0, rewards: r.count || 0, waitlist: w.count || 0 });
                if (signups.data) setRecentSignups(signups.data);
            } catch (e) {
                console.error('[Dashboard] Error:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchAll();
    }, []);

    const cards = [
        { label: 'Network Users', value: stats.users, icon: Users, color: '#8a7600', desc: 'ACTIVE NODE' },
        { label: 'Retail Partners', value: stats.partners, icon: Activity, color: '#0EA5E9', desc: 'LIVE' },
        { label: 'Active Rewards', value: stats.rewards, icon: Award, color: '#10B981', desc: 'SATELLITE' },
        { label: 'Access Queue', value: stats.waitlist, icon: ClipboardList, color: '#F43F5E', desc: 'DEMAND' },
    ];

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <header className="mb-20">
                <div className="flex items-center gap-4 mb-8">
                    <div className="h-[1px] w-12 bg-[#E8D200]"></div>
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#8a7600] font-black">Admin Intelligence Layer</span>
                </div>
                <h1 className="text-7xl font-light tracking-tighter text-[#1A1A1A] mb-6">Control Centre</h1>
                <p className="text-[#BBBBBB] text-[11px] max-w-2xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Real-time telemetry and management logic for the global POWR ecosystem.
                </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-24">
                {cards.map((c, i) => (
                    <div key={c.label} className="group relative bg-white border border-[#E6E6E1] p-12 rounded-3xl transition-all hover:border-[#E8D200]/40 hover:bg-white overflow-hidden">
                        <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-100 transition-opacity">
                            <span className="text-[9px] font-black text-[#BBBBBB] group-hover:text-[#8a7600] uppercase tracking-[0.4em] transition-colors">{c.desc}</span>
                        </div>
                        <div className="relative z-10 text-center flex flex-col items-center">
                            <div className="w-16 h-16 rounded-[2rem] bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center mb-10 group-hover:border-[#E8D200]/20 transition-all group-hover:scale-110 shadow-2xl">
                                <c.icon size={28} style={{ color: c.color }} />
                            </div>
                            <div className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-2 leading-none">
                                {loading ? '...' : c.value.toLocaleString()}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black group-hover:text-[#999999] transition-colors">
                                {c.label}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
                <div className="lg:col-span-2 space-y-12">
                    <div className="bg-white border border-[#E6E6E1] p-16 rounded-3xl relative overflow-hidden">
                        <div className="flex items-center justify-between mb-20 whitespace-nowrap overflow-hidden">
                            <div>
                                <h3 className="text-3xl font-light tracking-tighter text-[#1A1A1A]">Inbound Pipeline</h3>
                                <p className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mt-3">Processing Latest Foundation Requests</p>
                            </div>
                            <Link to="/admin/waitlist" className="group flex items-center gap-3 px-8 py-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full hover:border-[#E8D200]/40 transition-all ml-4">
                                <span className="text-[10px] font-black text-[#BBBBBB] group-hover:text-[#1A1A1A] uppercase tracking-[0.3em]">Query Archive</span>
                                <ChevronRight size={14} className="text-[#BBBBBB] group-hover:text-[#8a7600]" />
                            </Link>
                        </div>
                        
                        <div className="space-y-4">
                            {recentSignups.map((s, i) => (
                                <div key={i} className="flex items-center gap-10 p-10 rounded-[2.5rem] bg-[#F4F4F1] border border-transparent hover:border-[#E6E6E1] transition-all group">
                                    <div className={`w-14 h-14 rounded-3xl border transition-all flex items-center justify-center pointer-events-none ${s.typ === 'partner' ? 'bg-[#E8D200]/5 border-[#E8D200]/20 text-[#8a7600]' : 'bg-white border-[#E6E6E1] text-[#BBBBBB]'}`}>
                                        {s.typ === 'partner' ? <Activity size={22} /> : <Users size={22} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-base font-bold text-[#222222] group-hover:text-[#1A1A1A] transition-colors truncate">{s.email}</span>
                                            <span className="text-[10px] text-[#BBBBBB] font-black uppercase tracking-[0.4em] whitespace-nowrap ml-4">{timeAgo(s.created_at)}</span>
                                        </div>
                                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] group-hover:text-[#999999] transition-all font-black">
                                            {s.typ === 'partner' ? 'Strategic Retail Node Inquiry' : 'Foundation Tier User Request'}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-12">
                    <div className="bg-white border border-[#E6E6E1] p-16 rounded-3xl">
                        <h3 className="text-2xl font-light tracking-tighter text-[#1A1A1A] mb-16">Global Control</h3>
                        <div className="space-y-8">
                            {[
                                { label: 'Partner Fleet', sub: 'Location Management', to: '/admin/partners', icon: Activity },
                                { label: 'Reward Hub', sub: 'Inventory Health', to: '/admin/rewards', icon: Award },
                                { label: 'User Queue', sub: 'Access Admission', to: '/admin/waitlist', icon: Users }
                            ].map(item => (
                                <Link key={item.to} to={item.to} className="group block">
                                    <div className="p-10 bg-[#F4F4F1] border border-[#E6E6E1] rounded-3xl group-hover:border-[#E8D200]/40 transition-all flex items-center justify-between">
                                        <div>
                                            <div className="text-[14px] font-black uppercase tracking-[0.3em] text-[#AAAAAA] group-hover:text-[#1A1A1A] transition-colors mb-2">{item.label}</div>
                                            <div className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black leading-none">{item.sub}</div>
                                        </div>
                                        <div className="w-12 h-12 rounded-3xl bg-white border border-[#E6E6E1] flex items-center justify-center group-hover:bg-[#E8D200] transition-all">
                                            <ChevronRight size={20} className="text-[#BBBBBB] group-hover:text-[#080808]" />
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const AdminLayout = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [pendingAthletes, setPendingAthletes] = useState(0);
    const [pendingSubmissions, setPendingSubmissions] = useState(0);

    useEffect(() => {
        supabase
            .from('athlete_applications')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending')
            .then(({ count }) => setPendingAthletes(count ?? 0));
        supabase
            .from('reward_submissions')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending')
            .then(({ count }) => setPendingSubmissions(count ?? 0));
    }, [location.pathname]);

    const navItems = [
        { label: 'Overview',    path: '/admin',                    icon: LayoutDashboard },
        { label: 'Partners',    path: '/admin/partners',           icon: Activity        },
        { label: 'Rewards',     path: '/admin/rewards',            icon: Award           },
        { label: 'Submissions', path: '/admin/reward-submissions', icon: Inbox, badge: pendingSubmissions },
        { label: 'Featured',    path: '/admin/featured',           icon: Star            },
        { label: 'Challenges', path: '/admin/challenges', icon: Target         },
        { label: 'Waitlist',   path: '/admin/waitlist',  icon: ClipboardList   },
        { label: 'Users',      path: '/admin/users',     icon: Users           },
        { label: 'Athletes',   path: '/admin/athletes',  icon: Star, badge: pendingAthletes },
    ];

    const opsItems = [
        { label: 'Analytics',    path: '/admin/analytics',    icon: BarChart3   },
        { label: 'Sessions',     path: '/admin/sessions',     icon: Shield      },
        { label: 'Performance',  path: '/admin/performance',  icon: Activity    },
        { label: 'Redemptions',  path: '/admin/redemptions',  icon: Gift        },
        { label: 'Audit Log',    path: '/admin/audit',        icon: ScrollText     },
        { label: 'Support',      path: '/admin/support',      icon: MessageSquare  },
        { label: 'Config',       path: '/admin/config',       icon: Settings       },
    ];

    const segment = location.pathname.split('/')[2] || 'admin';
    const currentLabel = PATH_LABELS[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/admin/login');
    };

    return (
        <div className="flex min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] selection:bg-[#E8D200] selection:text-[#080808]">
            {/* Sidebar */}
            <aside className="w-80 flex-shrink-0 border-r border-[#E6E6E1] bg-white flex flex-col h-screen sticky top-0 z-[100]">
                <div className="p-16 mb-12 flex items-center justify-start pointer-events-none">
                    <img
                        src="/powr-logo-black.png"
                        alt="POWR"
                        style={{ height: '32px', width: 'auto', display: 'block' }}
                    />
                </div>
                
                <nav className="flex-1 px-8 space-y-3 overflow-y-auto">
                    <div className="px-8 mb-12">
                        <div className="text-[11px] uppercase tracking-[0.6em] text-[#BBBBBB] font-black mb-3">Core Subsystem</div>
                        <div className="h-[2px] w-12 bg-[#E8D200]/60"></div>
                    </div>
                    {navItems.map(item => {
                        const active = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex items-center gap-6 px-8 py-5 rounded-2xl transition-all group ${
                                    active
                                    ? 'bg-[#E8D200] text-[#080808] shadow-[0_25px_60px_rgba(232,210,0,0.25)]'
                                    : 'text-[#BBBBBB] hover:bg-[#EFEFEC] hover:text-[#333333]'
                                }`}
                            >
                                <item.icon size={22} className={active ? '' : 'group-hover:text-[#8a7600] transition-colors shadow-2xl'} strokeWidth={active ? 3 : 2} />
                                <span className="text-[13px] uppercase tracking-[0.25em] font-black flex-1">{item.label}</span>
                                {item.badge > 0 && (
                                    <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[9px] font-black flex items-center justify-center ${active ? 'bg-[#F4F4F1] text-[#8a7600]' : 'bg-[#f97316] text-white'}`}>
                                        {item.badge}
                                    </span>
                                )}
                            </Link>
                        );
                    })}

                    <div className="px-8 mt-12 mb-8">
                        <div className="text-[11px] uppercase tracking-[0.6em] text-[#BBBBBB] font-black mb-3">Operations</div>
                        <div className="h-[2px] w-12 bg-[#8B5CF6]/60"></div>
                    </div>
                    {opsItems.map(item => {
                        const active = location.pathname === item.path;
                        return (
                            <Link 
                                key={item.path} 
                                to={item.path} 
                                className={`flex items-center gap-6 px-8 py-5 rounded-2xl transition-all group ${
                                    active 
                                    ? 'bg-[#E8D200] text-[#080808] shadow-[0_25px_60px_rgba(232,210,0,0.25)]' 
                                    : 'text-[#BBBBBB] hover:bg-[#EFEFEC] hover:text-[#333333]'
                                }`}
                            >
                                <item.icon size={22} className={active ? '' : 'group-hover:text-[#8a7600] transition-colors shadow-2xl'} strokeWidth={active ? 3 : 2} />
                                <span className="text-[13px] uppercase tracking-[0.25em] font-black">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-12 mt-auto">
                    {user?.email && (
                        <div className="mx-2 mb-10 p-8 bg-[#F4F4F1] rounded-3xl border border-[#E6E6E1] group">
                            <div className="flex items-center gap-6">
                                <div className="w-12 h-12 rounded-3xl bg-[#EFEFEC] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                                    <Users size={16} className="text-[#BBBBBB]" />
                                </div>
                                <div className="overflow-hidden">
                                    <div className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black leading-none mb-3">Authorized Host</div>
                                    <div className="text-[12px] text-[#AAAAAA] truncate font-mono uppercase tracking-widest">{user.email.split('@')[0]}</div>
                                </div>
                            </div>
                        </div>
                    )}
                    <button 
                        onClick={handleSignOut} 
                        className="w-full flex items-center justify-center gap-4 h-20 text-[12px] uppercase tracking-[0.4em] font-black text-red-500/40 hover:text-red-500 hover:bg-red-500/5 rounded-3xl transition-all border border-transparent hover:border-red-500/10"
                    >
                        <LogOut size={20} /> Terminate
                    </button>
                    <div className="mt-8 text-center">
                        <span className="text-[9px] uppercase tracking-[0.6em] text-[#CCCCCC] font-black">SATELLITE DOWNLINK v3.0</span>
                    </div>
                </div>
            </aside>
            
            <style>{`
                .admin-padding-fix {
                    padding-left: 80px !important;
                    padding-right: 48px !important;
                }
                @media (max-width: 1024px) {
                    .admin-padding-fix {
                        padding-left: 40px !important;
                        padding-right: 24px !important;
                    }
                }
            `}</style>
            
            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-h-screen bg-[#F4F4F1] overflow-x-hidden border-l border-[#E6E6E1]">
                <header className="h-28 border-b border-[#E6E6E1] flex-shrink-0 flex items-center justify-between admin-padding-fix bg-[#F4F4F1]/60 backdrop-blur-3xl sticky top-0 z-50">
                    <div className="flex items-center gap-6">
                        <div className="text-[11px] uppercase tracking-[0.6em] font-black text-[#CCCCCC]">Intelligence Node</div>
                        <ChevronRight size={14} className="text-[#CCCCCC]" />
                        <div className="flex items-center gap-4">
                            <div className="h-2 w-2 rounded-full bg-[#E8D200] shadow-[0_0_15px_rgba(232,210,0,0.6)] animate-pulse"></div>
                            <div className="text-[14px] uppercase tracking-[0.4em] font-black text-[#8a7600]">{currentLabel}</div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-10">
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-2">Relay Health</span>
                            <div className="flex items-center gap-4 px-5 py-3 bg-white border border-[#E6E6E1] rounded-full">
                                <div className="h-2 w-2 rounded-full bg-[#10B981] shadow-[0_0_15px_rgba(16,185,129,0.5)] animate-pulse"></div>
                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#999999] font-black">99.9% UPTIME</span>
                            </div>
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-[1800px] admin-padding-fix py-10">
                        {children}
                    </div>
                    <div className="h-32 w-full"></div> {/* Bottom Buffer */}
                </div>
            </main>
        </div>
    );
};

// --- App Root ---
export default function App() {
    const location = useLocation();

    useEffect(() => {
        const landing = document.getElementById('landing-content');
        if (landing) landing.style.display = location.pathname === '/' ? 'block' : 'none';
    }, [location]);

    return (
        <ToastProvider>
            <AuthProvider>
                <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/privacy" element={<PrivacyPolicy />} />
                    <Route path="/terms" element={<TermsOfService />} />
                    <Route path="/cookies" element={<CookiePolicy />} />
                    <Route path="/support" element={<SupportPage />} />
                    <Route path="/delete-account" element={<DeleteAccount />} />
                    <Route path="/athlete/:token" element={<AthleteSignup />} />
                    <Route path="/partner-reward/:token" element={<PartnerRewardSubmit />} />
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin" element={<ProtectedRoute><AdminLayout><AdminHome /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/partners" element={<ProtectedRoute><AdminLayout><PartnerManager /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/rewards" element={<ProtectedRoute><AdminLayout><RewardManager /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/reward-submissions" element={<ProtectedRoute><AdminLayout><RewardSubmissions /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/featured" element={<ProtectedRoute><AdminLayout><FeaturedSchedule /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/challenges" element={<ProtectedRoute><AdminLayout><WeeklyChallenges /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/waitlist" element={<ProtectedRoute><AdminLayout><WaitlistManager /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/users" element={<ProtectedRoute><AdminLayout><UserManager /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/users/:userId" element={<ProtectedRoute><AdminLayout><UserProfile /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/partners/:partnerId" element={<ProtectedRoute><AdminLayout><PartnerProfile /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/analytics" element={<ProtectedRoute><AdminLayout><Analytics /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/sessions" element={<ProtectedRoute><AdminLayout><SessionReview /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/performance" element={<ProtectedRoute><AdminLayout><PartnerPerformance /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/redemptions" element={<ProtectedRoute><AdminLayout><RedemptionTracker /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/audit" element={<ProtectedRoute><AdminLayout><AuditLog /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/config" element={<ProtectedRoute><AdminLayout><SystemConfig /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/support" element={<ProtectedRoute><AdminLayout><SupportTickets /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/athletes" element={<ProtectedRoute><AdminLayout><AthleteApplications /></AdminLayout></ProtectedRoute>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </AuthProvider>
        </ToastProvider>
    );
}
