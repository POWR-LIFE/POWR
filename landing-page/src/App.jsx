import {
    Activity, Award,
    BarChart3,
    Building2,
    CalendarDays,
    ChevronLeft, ChevronRight,
    Gift,
    Inbox,
    LayoutDashboard,
    LogOut,
    MapPin,
    Megaphone,
    MessageSquare,
    ScrollText,
    Settings,
    Shield,
    Star,
    Target,
    TrendingUp,
    Users,
    Zap,
    ArrowUpRight,
    ArrowDownRight,
} from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { initLandingPage } from '../main.js';
import { supabase } from './lib/supabase';
import { ToastProvider } from './lib/toast';

import PartnerPortalHome from './pages/partner/PartnerHome';
import { PartnerLayout } from './pages/partner/PartnerLayout';
import PartnerPortalPromoCodes from './pages/partner/PartnerPromoCodes';
import PartnerPortalRedemptions from './pages/partner/PartnerRedemptions';
import PartnerPortalRewards from './pages/partner/PartnerRewards';
import PartnerPortalFeatured from './pages/partner/PartnerFeatured';
import PartnerPortalPlacements from './pages/partner/PartnerPlacements';
import PartnerPortalSettings from './pages/partner/PartnerSettings';
import PartnerSetup from './pages/partner/PartnerSetup';

import Analytics from './pages/admin/Analytics';
import AthleteApplications from './pages/admin/AthleteApplications';
import AuditLog from './pages/admin/AuditLog';
import Broadcast from './pages/admin/Broadcast';
import Campaigns from './pages/admin/Campaigns';
import FeaturedSchedule from './pages/admin/FeaturedSchedule';
import GymDetail from './pages/admin/GymDetail';
import GymRequests from './pages/admin/GymRequests';
import PartnerManager from './pages/admin/PartnerManager';
import PartnerPerformance from './pages/admin/PartnerPerformance';
import PartnerProfile from './pages/admin/PartnerProfile';
import RedemptionTracker from './pages/admin/RedemptionTracker';
import RewardManager from './pages/admin/RewardManager';
import RewardPlacements from './pages/admin/RewardPlacements';
import RewardSubmissions from './pages/admin/RewardSubmissions';
import SessionReview from './pages/admin/SessionReview';
import SupportTickets from './pages/admin/SupportTickets';
import SystemConfig from './pages/admin/SystemConfig';
import UserManager from './pages/admin/UserManager';
import UserProfile from './pages/admin/UserProfile';
import WeeklyChallenges from './pages/admin/WeeklyChallenges';
import AthleteSignup from './pages/AthleteSignup';
import CookiePolicy from './pages/CookiePolicy';
import DeleteAccount from './pages/DeleteAccount';
import PartnerRewardSubmit from './pages/PartnerRewardSubmit';
import PrivacyPolicy from './pages/PrivacyPolicy';
import SupportPage from './pages/SupportPage';
import TermsOfService from './pages/TermsOfService';

// --- Auth Context ---
const AuthContext = createContext({ user: null, isAdmin: false, isPartner: false, partnerData: null, placementsEnabled: false, loading: true });

const ACTING_BRAND_KEY = 'powr_acting_brand';

// Brands have no table of their own — identity comes from rewards.brand_name,
// with the logo borrowed from the brand's most recent reward.
const fetchBrandProfile = async (brandName) => {
    const { data } = await supabase
        .from('rewards')
        .select('image_url, category')
        .ilike('brand_name', brandName)
        .order('created_at', { ascending: false })
        .limit(1);
    return {
        brand_name: brandName,
        name: brandName,
        logo_url: data?.[0]?.image_url ?? null,
        logo_bg: 'dark',
        category: data?.[0]?.category ?? null,
    };
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isPartner, setIsPartner] = useState(false);
    const [partnerData, setPartnerData] = useState(null);
    const [actingPartner, setActingPartnerState] = useState(null);
    const [placementsEnabled, setPlacementsEnabled] = useState(false);
    const [loading, setLoading] = useState(true);

    // Admin-only: preview the portal as any reward brand
    const setActingPartner = async (brandName) => {
        if (!brandName) {
            localStorage.removeItem(ACTING_BRAND_KEY);
            setActingPartnerState(null);
            return;
        }
        const profile = await fetchBrandProfile(brandName);
        localStorage.setItem(ACTING_BRAND_KEY, brandName);
        setActingPartnerState(profile);
    };

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

    const checkPartner = async (userId) => {
        try {
            const { data } = await supabase
                .from('reward_brand_users')
                .select('brand_name')
                .eq('user_id', userId)
                .single();
            if (!data) return null;
            return await fetchBrandProfile(data.brand_name);
        } catch {
            return null;
        }
    };

    // Self-serve reward placements are gated behind this flag (default off).
    // system_config SELECT is admin-only except this one key (see migration
    // 20260704000006). Fails safe to disabled; admins see the page regardless.
    const fetchPlacementsFlag = async () => {
        try {
            const { data } = await supabase
                .from('system_config')
                .select('value')
                .eq('key', 'partner_placements_enabled')
                .maybeSingle();
            return data?.value === 'true';
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
                const [adminStatus, partnerResult, flagOn] = await Promise.all([
                    checkAdmin(session.user.id),
                    checkPartner(session.user.id),
                    fetchPlacementsFlag(),
                ]);
                // Restore admin preview selection (admins with no brand link)
                let restoredActing = null;
                if (adminStatus && !partnerResult) {
                    const storedBrand = localStorage.getItem(ACTING_BRAND_KEY);
                    if (storedBrand) restoredActing = await fetchBrandProfile(storedBrand);
                }
                if (mounted) {
                    setIsAdmin(adminStatus);
                    setIsPartner(!!partnerResult);
                    setPartnerData(partnerResult);
                    setActingPartnerState(restoredActing);
                    setPlacementsEnabled(flagOn);
                    setLoading(false);
                }
            } else {
                lastUserId = null;
                setUser(null);
                setIsAdmin(false);
                setIsPartner(false);
                setPartnerData(null);
                setActingPartnerState(null);
                setPlacementsEnabled(false);
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
        <AuthContext.Provider value={{
            user, isAdmin, isPartner,
            partnerData: partnerData ?? actingPartner,
            isActingPartner: !partnerData && !!actingPartner,
            setActingPartner,
            placementsEnabled,
            loading,
        }}>
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
    'gym-requests': 'Gym Requests',
    placements: 'Placements',
    challenges: 'Challenges',
    users: 'Users',
    athletes: 'Athletes',
    profile: 'Profile',
    analytics: 'Analytics',
    sessions: 'Sessions',
    performance: 'Performance',
    redemptions: 'Redemptions',
    audit: 'Audit Log',
    support: 'Support Tickets',
    broadcast: 'Broadcast',
    campaigns: 'Campaigns',
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

// --- Partner Login ---
const PartnerLogin = () => {
    const navigate = useNavigate();
    const { isAdmin, isPartner, user } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState(null);

    useEffect(() => {
        // Admins are allowed into the partner portal too (preview mode)
        if (user && (isPartner || isAdmin)) navigate('/partner');
    }, [user, isAdmin, isPartner, navigate]);

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
            setStatus('Loading your portal...');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] fixed inset-0 z-[100]">
            <div className="w-full max-w-md p-8 bg-white border border-[#E6E6E1] rounded-2xl shadow-2xl">
                <div className="flex justify-center mb-8">
                    <img src="/powr-logo-black.png" alt="POWR" className="h-12" />
                </div>
                <h2 className="text-2xl font-light text-center mb-2 tracking-tight">Partner Portal</h2>
                <p className="text-center text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-8">Manage your rewards</p>
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
                        <Link to="/" className="text-[10px] uppercase tracking-widest text-[#AAAAAA] hover:text-[#8a7600] transition-colors">Back to home</Link>
                    </div>
                </form>
            </div>
        </div>
    );
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

// --- Partner Protected Route ---
// Admins are allowed in too: they can preview the portal as any partner.
const PartnerProtectedRoute = ({ children }) => {
    const { user, isPartner, isAdmin, loading } = useAuth();
    const location = useLocation();

    if (loading) return (
        <div className="min-h-screen bg-[#F4F4F1] flex items-center justify-center fixed inset-0 z-[100]">
            <div className="flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-2 border-[#E8D200] border-t-transparent rounded-full animate-spin" />
                <p className="text-[10px] uppercase tracking-widest text-[#AAAAAA]">Loading portal...</p>
            </div>
        </div>
    );

    if (!user || (!isPartner && !isAdmin)) return <Navigate to="/partner/login" state={{ from: location }} replace />;
    return children;
};

// --- Admin Home ---
const AdminHome = () => {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        users: 0, newUsers7d: 0,
        partners: 0,
        rewards: 0, rewardBrands: 0,
        flaggedSessions: 0, totalSessions: 0, weeklyActive: 0,
        redemptions: 0, activeRedemptions: 0,
        totalPoints: 0,
        pendingAthletes: 0, pendingSubmissions: 0, openTickets: 0, pendingGymRequests: 0,
        sessions7d: 0, sessionsPrev7d: 0,
    });
    // 14-day daily session trend [{ day, count }] and activity-type mix [{ type, count }]
    const [trend, setTrend] = useState([]);
    const [activityMix, setActivityMix] = useState([]);

    useEffect(() => {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const fetchAll = async () => {
            try {
                const [
                    usersRes, newUsersRes, partnersRes,
                    rewardsRes, brandsRes,
                    flaggedRes, sessionsRes, weeklyRes,
                    redemptionsRes, pointsRes,
                    athletesRes, submissionsRes, ticketsRes,
                    trendRes, gymRequestsRes,
                ] = await Promise.all([
                    supabase.from('profiles').select('id', { count: 'exact', head: true }),
                    supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
                    supabase.from('partners').select('id', { count: 'exact', head: true }).eq('active', true),
                    supabase.from('rewards').select('id', { count: 'exact', head: true }).eq('active', true),
                    supabase.from('rewards').select('brand_name'),
                    supabase.from('activity_sessions').select('id', { count: 'exact', head: true }).eq('flagged', true),
                    supabase.from('activity_sessions').select('id', { count: 'exact', head: true }),
                    supabase.from('activity_sessions').select('user_id').gte('started_at', weekAgo),
                    supabase.from('redemptions').select('id, status'),
                    supabase.from('point_transactions').select('amount').gt('amount', 0),
                    supabase.from('athlete_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
                    supabase.from('reward_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
                    supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
                    // last 14 days of sessions: drives the trend sparkline, 7d-over-7d delta, and activity mix
                    supabase.from('activity_sessions').select('type, started_at').gte('started_at', twoWeeksAgo),
                    supabase.from('gym_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
                ]);

                const weeklyUsers = new Set((weeklyRes.data || []).map(s => s.user_id));
                const allRedemptions = redemptionsRes.data || [];
                const brands = new Set((brandsRes.data || []).map(r => r.brand_name?.toLowerCase()).filter(Boolean));
                const totalPts = (pointsRes.data || []).reduce((a, p) => a + (p.amount || 0), 0);

                // --- Build 14-day daily trend, 7d delta, and activity mix from one pull ---
                const sessRows = trendRes.data || [];
                const dayKey = (d) => d.toISOString().slice(0, 10);
                const counts = new Map();        // 'YYYY-MM-DD' -> count
                const mix = new Map();           // type -> count (last 7d)
                let sess7d = 0, sessPrev7d = 0;
                const now = Date.now();
                for (const r of sessRows) {
                    if (!r.started_at) continue;
                    const t = new Date(r.started_at);
                    counts.set(dayKey(t), (counts.get(dayKey(t)) || 0) + 1);
                    const ageDays = (now - t.getTime()) / 86_400_000;
                    if (ageDays <= 7) {
                        sess7d++;
                        const ty = r.type || 'other';
                        mix.set(ty, (mix.get(ty) || 0) + 1);
                    } else {
                        sessPrev7d++;
                    }
                }
                // dense 14-day series so the line has no gaps
                const series = [];
                for (let i = 13; i >= 0; i--) {
                    const d = new Date(now - i * 86_400_000);
                    series.push({ day: dayKey(d), count: counts.get(dayKey(d)) || 0 });
                }
                setTrend(series);
                setActivityMix([...mix.entries()]
                    .map(([type, count]) => ({ type, count }))
                    .sort((a, b) => b.count - a.count));

                setStats({
                    users: usersRes.count || 0,
                    newUsers7d: newUsersRes.count || 0,
                    partners: partnersRes.count || 0,
                    rewards: rewardsRes.count || 0,
                    rewardBrands: brands.size,
                    flaggedSessions: flaggedRes.count || 0,
                    totalSessions: sessionsRes.count || 0,
                    weeklyActive: weeklyUsers.size,
                    redemptions: allRedemptions.length,
                    activeRedemptions: allRedemptions.filter(r => r.status === 'active').length,
                    totalPoints: totalPts,
                    pendingAthletes: athletesRes.count || 0,
                    pendingSubmissions: submissionsRes.count || 0,
                    openTickets: ticketsRes.count || 0,
                    pendingGymRequests: gymRequestsRes.count || 0,
                    sessions7d: sess7d,
                    sessionsPrev7d: sessPrev7d,
                });
            } catch (e) {
                console.error('[Overview] Error:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchAll();
    }, []);

    const fmt = (n) => loading ? '—' : n.toLocaleString();
    const fmtPts = (n) => {
        if (loading) return '—';
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
        return n.toLocaleString();
    };

    // 7d-over-7d session momentum
    const sessDelta = stats.sessionsPrev7d > 0
        ? Math.round(((stats.sessions7d - stats.sessionsPrev7d) / stats.sessionsPrev7d) * 100)
        : (stats.sessions7d > 0 ? 100 : 0);
    // engagement = weekly active / total users
    const engagementPct = stats.users > 0 ? Math.round((stats.weeklyActive / stats.users) * 100) : 0;
    // active-code health = active codes / total redemptions
    const codeHealthPct = stats.redemptions > 0 ? Math.round((stats.activeRedemptions / stats.redemptions) * 100) : 0;

    const kpiCards = [
        { label: 'Total Users',     value: fmt(stats.users),         sub: `+${fmt(stats.newUsers7d)} this week`,         icon: Users,      color: '#8a7600' },
        { label: 'Active Partners', value: fmt(stats.partners),       sub: 'Live gym locations',                           icon: Activity,   color: '#0EA5E9' },
        { label: 'Active Rewards',  value: fmt(stats.rewards),        sub: `${fmt(stats.rewardBrands)} brands`,            icon: Award,      color: '#10B981' },
        { label: 'Weekly Active',   value: fmt(stats.weeklyActive),   sub: 'Unique users (7d)',                            icon: TrendingUp, color: '#E8D200' },
        { label: 'Redemptions',     value: fmt(stats.redemptions),    sub: `${fmt(stats.activeRedemptions)} active codes`, icon: Gift,       color: '#8B5CF6' },
        { label: 'Points Issued',   value: fmtPts(stats.totalPoints), sub: 'All-time total earned',                        icon: Zap,        color: '#F97316' },
    ];

    const attentionItems = [
        { label: 'Flagged Sessions',     count: stats.flaggedSessions,    to: '/admin/sessions',           color: '#F43F5E', icon: Shield,        desc: 'Duplicate / multi-device' },
        { label: 'Gym Requests',         count: stats.pendingGymRequests, to: '/admin/gym-requests',       color: '#E8D200', icon: Building2,     desc: 'Members couldn\'t find gym' },
        { label: 'Reward Submissions',   count: stats.pendingSubmissions, to: '/admin/reward-submissions', color: '#F97316', icon: Inbox,         desc: 'Pending brand review'     },
        { label: 'Athlete Applications', count: stats.pendingAthletes,    to: '/admin/athletes',           color: '#8B5CF6', icon: Star,          desc: 'Awaiting approval'        },
        { label: 'Support Tickets',      count: stats.openTickets,        to: '/admin/support',            color: '#0EA5E9', icon: MessageSquare, desc: 'Open & in-progress'       },
    ];

    // Activity-mix colors (matched to type)
    const MIX_COLORS = {
        walking: '#0EA5E9', sleep: '#8B5CF6', gym: '#E8D200', running: '#F97316',
        hiit: '#F43F5E', cycling: '#10B981', yoga: '#A78BFA', sports: '#8a7600', other: '#CCCCCC',
    };
    const maxMix = Math.max(1, ...activityMix.map(d => d.count));
    const totalMix = activityMix.reduce((a, d) => a + d.count, 0) || 1;

    // All sections — compact nav grid
    const sections = [
        { label: 'Partners',    path: '/admin/partners',           icon: Activity,      color: '#0EA5E9' },
        { label: 'Rewards',     path: '/admin/rewards',            icon: Award,         color: '#10B981' },
        { label: 'Submissions', path: '/admin/reward-submissions', icon: Inbox,         color: '#F97316' },
        { label: 'Users',       path: '/admin/users',              icon: Users,         color: '#8a7600' },
        { label: 'Athletes',    path: '/admin/athletes',           icon: Star,          color: '#8B5CF6' },
        { label: 'Featured',    path: '/admin/featured',           icon: Star,          color: '#AAAAAA' },
        { label: 'Challenges',  path: '/admin/challenges',         icon: Target,        color: '#AAAAAA' },
        { label: 'Analytics',   path: '/admin/analytics',          icon: BarChart3,     color: '#E8D200' },
        { label: 'Sessions',    path: '/admin/sessions',           icon: Shield,        color: '#F43F5E' },
        { label: 'Performance', path: '/admin/performance',        icon: TrendingUp,    color: '#F97316' },
        { label: 'Redemptions', path: '/admin/redemptions',        icon: Gift,          color: '#8B5CF6' },
        { label: 'Support',     path: '/admin/support',            icon: MessageSquare, color: '#0EA5E9' },
        { label: 'Audit Log',   path: '/admin/audit',              icon: ScrollText,    color: '#AAAAAA' },
        { label: 'Config',      path: '/admin/config',             icon: Settings,      color: '#AAAAAA' },
    ];

    // --- SVG trend area chart (14d sessions) ---
    const TrendChart = () => {
        const W = 560, H = 160, P = 6;
        if (!trend.length) return <div className="h-40" />;
        const max = Math.max(1, ...trend.map(d => d.count));
        const stepX = (W - P * 2) / Math.max(1, trend.length - 1);
        const pts = trend.map((d, i) => {
            const x = P + i * stepX;
            const y = H - P - (d.count / max) * (H - P * 2);
            return [x, y];
        });
        const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
        return (
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-40">
                <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#E8D200" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#E8D200" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <path d={area} fill="url(#trendFill)" />
                <path d={line} fill="none" stroke="#8a7600" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 0} fill="#8a7600" />
                ))}
            </svg>
        );
    };

    // --- SVG donut gauge ---
    const Donut = ({ pct, color, label, value }) => {
        const r = 32, c = 2 * Math.PI * r;
        const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
        return (
            <div className="flex flex-col items-center gap-2">
                <div className="relative w-[84px] h-[84px]">
                    <svg viewBox="0 0 84 84" className="w-full h-full -rotate-90">
                        <circle cx="42" cy="42" r={r} fill="none" stroke="#F0F0EC" strokeWidth="8" />
                        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="8"
                            strokeLinecap="round" strokeDasharray={`${dash} ${c}`}
                            style={{ transition: 'stroke-dasharray 0.8s ease' }} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-lg font-light tracking-tighter text-[#1A1A1A]">{loading ? '—' : value}</span>
                    </div>
                </div>
                <span className="text-[8px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black text-center leading-tight">{label}</span>
            </div>
        );
    };

    return (
        <div className="py-8 animate-in fade-in duration-500">

            {/* Compact header */}
            <div className="mb-8">
                <div className="text-[10px] uppercase tracking-[0.6em] text-[#8a7600] font-black mb-2">Control Centre</div>
                <h1 className="text-4xl font-light tracking-tighter text-[#1A1A1A]">Overview</h1>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
                {kpiCards.map(c => (
                    <div key={c.label} className="bg-white border border-[#E6E6E1] px-5 py-4 rounded-xl">
                        <div className="flex items-center gap-2 mb-3">
                            <c.icon size={12} style={{ color: c.color }} />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black truncate">{c.label}</span>
                        </div>
                        <div className="text-3xl font-light tracking-tighter text-[#1A1A1A] leading-none mb-1">{c.value}</div>
                        <div className="text-[8px] text-[#CCCCCC] font-black uppercase tracking-[0.3em]">{c.sub}</div>
                    </div>
                ))}
            </div>

            {/* Hero: 14-day trend + engagement gauges */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                {/* Trend area chart 2/3 */}
                <div className="lg:col-span-2 bg-white border border-[#E6E6E1] rounded-2xl p-6">
                    <div className="flex items-start justify-between mb-2">
                        <div>
                            <div className="text-[10px] uppercase tracking-[0.5em] text-[#AAAAAA] font-black mb-1">Session Activity</div>
                            <div className="flex items-baseline gap-3">
                                <span className="text-4xl font-light tracking-tighter text-[#1A1A1A]">{loading ? '—' : stats.sessions7d}</span>
                                <span className="text-[9px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">last 7 days</span>
                                {!loading && (
                                    <span className="flex items-center gap-1 text-[11px] font-black"
                                        style={{ color: sessDelta >= 0 ? '#10B981' : '#F43F5E' }}>
                                        {sessDelta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                                        {Math.abs(sessDelta)}%
                                    </span>
                                )}
                            </div>
                        </div>
                        <Link to="/admin/analytics" className="text-[#DDDDDD] hover:text-[#8a7600] transition-colors">
                            <BarChart3 size={18} />
                        </Link>
                    </div>
                    <TrendChart />
                    <div className="flex justify-between mt-2 text-[8px] uppercase tracking-[0.2em] text-[#CCCCCC] font-black">
                        <span>14 days ago</span>
                        <span>Today</span>
                    </div>
                </div>

                {/* Engagement gauges 1/3 */}
                <div className="bg-white border border-[#E6E6E1] rounded-2xl p-6 flex flex-col">
                    <div className="text-[10px] uppercase tracking-[0.5em] text-[#AAAAAA] font-black mb-5">Engagement</div>
                    <div className="grid grid-cols-2 gap-4 flex-1 place-items-center">
                        <Donut pct={engagementPct} color="#E8D200" value={`${engagementPct}%`} label="Weekly Active" />
                        <Donut pct={codeHealthPct} color="#8B5CF6" value={`${codeHealthPct}%`} label="Active Codes" />
                    </div>
                    <div className="mt-5 pt-4 border-t border-[#F4F4F1] flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
                        <span className="text-[8px] uppercase tracking-[0.35em] text-[#CCCCCC] font-black">All systems operational</span>
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left 2/3 */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Needs Attention — visual triage cards */}
                    <div className="bg-white border border-[#E6E6E1] rounded-2xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-[#F0F0EE] flex items-center gap-3">
                            <div className="h-[2px] w-5 bg-[#E8D200]"></div>
                            <span className="text-[11px] uppercase tracking-[0.5em] font-black text-[#1A1A1A]">Needs Attention</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-[#F4F4F1]">
                            {attentionItems.map(item => {
                                const urgent = !loading && item.count > 0;
                                return (
                                    <Link key={item.to} to={item.to}
                                        className="group relative flex flex-col items-center justify-center text-center gap-2 px-3 py-6 hover:bg-[#FAFAF8] transition-colors"
                                        style={urgent ? { background: `${item.color}0A` } : undefined}>
                                        {urgent && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: item.color }} />}
                                        <item.icon size={16} style={{ color: urgent ? item.color : '#D8D8D4' }} />
                                        <span className="text-3xl font-light tracking-tighter leading-none"
                                            style={{ color: urgent ? item.color : '#D0D0CC' }}>
                                            {loading ? '—' : item.count}
                                        </span>
                                        <span className="text-[8px] font-black uppercase tracking-[0.2em] leading-tight"
                                            style={{ color: urgent ? '#444444' : '#BBBBBB' }}>{item.label}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>

                    {/* Activity Mix — horizontal bars */}
                    <div className="bg-white border border-[#E6E6E1] rounded-2xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-[#F0F0EE] flex items-center gap-3">
                            <div className="h-[2px] w-5 bg-[#0EA5E9]/60"></div>
                            <span className="text-[11px] uppercase tracking-[0.5em] font-black text-[#1A1A1A]">Activity Mix</span>
                            <span className="ml-auto text-[8px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">Sessions · 7d</span>
                        </div>
                        <div className="px-6 py-5 space-y-3.5">
                            {loading ? (
                                <div className="h-32 flex items-center justify-center text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">Loading…</div>
                            ) : activityMix.length === 0 ? (
                                <div className="h-32 flex items-center justify-center text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">No sessions in last 7 days</div>
                            ) : activityMix.map(d => (
                                <div key={d.type}>
                                    <div className="flex justify-between items-center mb-1.5">
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#888888] capitalize">{d.type}</span>
                                        <span className="text-[10px] font-black text-[#AAAAAA]">{d.count} · {Math.round((d.count / totalMix) * 100)}%</span>
                                    </div>
                                    <div className="w-full h-2.5 bg-[#F0F0EC] rounded-full overflow-hidden">
                                        <div className="h-full rounded-full transition-all duration-700"
                                            style={{ width: `${(d.count / maxMix) * 100}%`, backgroundColor: MIX_COLORS[d.type] || '#E8D200' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right 1/3 — section nav grid */}
                <div className="bg-white border border-[#E6E6E1] rounded-2xl overflow-hidden h-fit">
                    <div className="px-6 py-4 border-b border-[#F0F0EE] flex items-center gap-3">
                        <div className="h-[2px] w-5 bg-[#8B5CF6]/60"></div>
                        <span className="text-[11px] uppercase tracking-[0.5em] font-black text-[#1A1A1A]">Jump To</span>
                    </div>
                    <div className="grid grid-cols-3 gap-px bg-[#F4F4F1]">
                        {sections.map(s => (
                            <Link key={s.label} to={s.path}
                                className="group bg-white flex flex-col items-center justify-center gap-2 py-5 hover:bg-[#FAFAF8] transition-colors">
                                <s.icon size={16} style={{ color: s.color }} className="opacity-70 group-hover:opacity-100 transition-opacity" />
                                <span className="text-[8px] font-black uppercase tracking-[0.15em] text-[#AAAAAA] group-hover:text-[#1A1A1A] transition-colors text-center leading-tight px-1">{s.label}</span>
                            </Link>
                        ))}
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
    const [pendingGymRequests, setPendingGymRequests] = useState(0);
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem('admin_sidebar') === '1');

    const toggleSidebar = () => setCollapsed(c => {
        const next = !c;
        localStorage.setItem('admin_sidebar', next ? '1' : '0');
        return next;
    });

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
        supabase
            .from('gym_requests')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending')
            .then(({ count }) => setPendingGymRequests(count ?? 0));
    }, [location.pathname]);

    const navItems = [
        { label: 'Overview',    path: '/admin',                    icon: LayoutDashboard },
        { label: 'Partners',    path: '/admin/partners',           icon: Activity        },
        { label: 'Gym Requests',path: '/admin/gym-requests',       icon: Building2,      badge: pendingGymRequests },
        { label: 'Rewards',     path: '/admin/rewards',            icon: Award           },
        { label: 'Submissions', path: '/admin/reward-submissions', icon: Inbox,          badge: pendingSubmissions },
        { label: 'Featured',    path: '/admin/featured',           icon: Star            },
        { label: 'Placements',  path: '/admin/placements',         icon: MapPin          },
        { label: 'Challenges',  path: '/admin/challenges',         icon: Target          },
        { label: 'Users',       path: '/admin/users',              icon: Users           },
        { label: 'Athletes',    path: '/admin/athletes',           icon: Star,           badge: pendingAthletes },
    ];

    const opsItems = [
        { label: 'Analytics',   path: '/admin/analytics',   icon: BarChart3     },
        { label: 'Sessions',    path: '/admin/sessions',    icon: Shield        },
        { label: 'Performance', path: '/admin/performance', icon: Activity      },
        { label: 'Redemptions', path: '/admin/redemptions', icon: Gift          },
        { label: 'Audit Log',   path: '/admin/audit',       icon: ScrollText    },
        { label: 'Support',     path: '/admin/support',     icon: MessageSquare },
        { label: 'Broadcast',   path: '/admin/broadcast',   icon: Megaphone     },
        { label: 'Campaigns',   path: '/admin/campaigns',   icon: CalendarDays  },
        { label: 'Config',      path: '/admin/config',      icon: Settings      },
    ];

    const segment = location.pathname.split('/')[2] || 'admin';
    const currentLabel = PATH_LABELS[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/admin/login');
    };

    const NavLink = ({ item }) => {
        const active = location.pathname === item.path;
        return (
            <Link
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={`relative flex items-center rounded-xl transition-all duration-150 group ${
                    collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
                } ${active
                    ? 'bg-[#E8D200] text-[#080808]'
                    : 'text-[#BBBBBB] hover:bg-[#F4F4F1] hover:text-[#333333]'
                }`}
            >
                <item.icon size={18} strokeWidth={active ? 2.5 : 1.8}
                    className={active ? '' : 'group-hover:text-[#8a7600] transition-colors'} />
                {!collapsed && (
                    <span className={`text-[12px] uppercase tracking-[0.25em] flex-1 leading-none ${active ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
                )}
                {item.badge > 0 && !collapsed && (
                    <span className={`min-w-[18px] h-4 px-1 rounded-full text-[8px] font-black flex items-center justify-center ${
                        active ? 'bg-[#F4F4F1] text-[#8a7600]' : 'bg-[#f97316] text-white'
                    }`}>{item.badge}</span>
                )}
                {item.badge > 0 && collapsed && (
                    <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-[#f97316] border border-white" />
                )}
            </Link>
        );
    };

    return (
        <div className="flex min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] selection:bg-[#E8D200] selection:text-[#080808]">
            {/* Sidebar */}
            <aside className={`flex-shrink-0 border-r border-[#E6E6E1] bg-white flex flex-col h-screen sticky top-0 z-[100] transition-[width] duration-300 ease-in-out ${collapsed ? 'w-[68px]' : 'w-64'}`}>

                {/* Logo + toggle */}
                <div className={`flex items-center h-20 border-b border-[#F0F0EE] flex-shrink-0 ${collapsed ? 'justify-center px-3' : 'justify-between px-6'}`}>
                    {!collapsed && (
                        <div className="flex-1 flex justify-center">
                            <img src="/powr-logo-black.png" alt="POWR" className="h-10 w-auto" />
                        </div>
                    )}
                    <button
                        onClick={toggleSidebar}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#CCCCCC] hover:text-[#555555] hover:bg-[#F4F4F1] transition-all flex-shrink-0"
                    >
                        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                    </button>
                </div>

                {/* Nav */}
                <nav className={`flex-1 py-4 overflow-y-auto overflow-x-hidden ${collapsed ? 'px-3 space-y-1' : 'px-3 space-y-0.5'}`}>
                    {!collapsed && (
                        <div className="px-3 pt-1 pb-3">
                            <div className="text-[9px] uppercase tracking-[0.6em] text-[#CCCCCC] font-semibold mb-1.5">Core</div>
                            <div className="h-[1.5px] w-6 bg-[#E8D200]/70"></div>
                        </div>
                    )}
                    {collapsed && <div className="h-2" />}

                    {navItems.map(item => <NavLink key={item.path} item={item} />)}

                    {!collapsed && (
                        <div className="px-3 pt-5 pb-3">
                            <div className="text-[9px] uppercase tracking-[0.6em] text-[#CCCCCC] font-semibold mb-1.5">Operations</div>
                            <div className="h-[1.5px] w-6 bg-[#8B5CF6]/60"></div>
                        </div>
                    )}
                    {collapsed && <div className="h-3" />}

                    {opsItems.map(item => <NavLink key={item.path} item={item} />)}
                </nav>

                {/* Footer */}
                <div className={`border-t border-[#F0F0EE] flex-shrink-0 ${collapsed ? 'p-3 flex flex-col items-center gap-2' : 'p-4 space-y-3'}`}>
                    {user?.email && !collapsed && (
                        <div className="px-3 py-2.5 bg-[#F4F4F1] rounded-xl border border-[#EFEFEC]">
                            <div className="text-[8px] uppercase tracking-[0.5em] text-[#CCCCCC] font-semibold mb-1">Admin</div>
                            <div className="text-[11px] text-[#888888] truncate font-mono">{user.email.split('@')[0]}</div>
                        </div>
                    )}
                    <button
                        onClick={handleSignOut}
                        title={collapsed ? 'Sign out' : undefined}
                        className={`flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.3em] font-medium text-red-400/50 hover:text-red-500 hover:bg-red-500/5 rounded-xl transition-all ${
                            collapsed ? 'w-10 h-10' : 'w-full h-9'
                        }`}
                    >
                        <LogOut size={15} />
                        {!collapsed && 'Sign out'}
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 flex flex-col min-h-screen bg-[#F4F4F1] overflow-x-hidden min-w-0">
                <header className="h-14 border-b border-[#E6E6E1] flex-shrink-0 flex items-center justify-between px-8 bg-[#F4F4F1]/80 backdrop-blur-xl sticky top-0 z-50">
                    <div className="flex items-center gap-3">
                        <div className="h-1.5 w-1.5 rounded-full bg-[#E8D200] shadow-[0_0_8px_rgba(232,210,0,0.7)] animate-pulse"></div>
                        <span className="text-[12px] uppercase tracking-[0.4em] font-black text-[#8a7600]">{currentLabel}</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-white border border-[#E6E6E1] rounded-full">
                        <div className="h-1.5 w-1.5 rounded-full bg-[#10B981] shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"></div>
                        <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">Live</span>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-[1600px] px-8 py-8">
                        {children}
                    </div>
                    <div className="h-20 w-full" />
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
                    <Route path="/partner/login" element={<PartnerLogin />} />
                    <Route path="/partner/setup/:token" element={<PartnerSetup />} />
                    <Route path="/partner" element={<PartnerProtectedRoute><PartnerLayout><PartnerPortalHome /></PartnerLayout></PartnerProtectedRoute>} />
                    <Route path="/partner/rewards" element={<PartnerProtectedRoute><PartnerLayout><PartnerPortalRewards /></PartnerLayout></PartnerProtectedRoute>} />
                    <Route path="/partner/promo-codes" element={<PartnerProtectedRoute><PartnerLayout><PartnerPortalPromoCodes /></PartnerLayout></PartnerProtectedRoute>} />
                    <Route path="/partner/featured" element={<PartnerProtectedRoute><PartnerLayout><PartnerPortalFeatured /></PartnerLayout></PartnerProtectedRoute>} />
                    <Route path="/partner/placements" element={<PartnerProtectedRoute><PartnerLayout><PartnerPortalPlacements /></PartnerLayout></PartnerProtectedRoute>} />
                    <Route path="/partner/redemptions" element={<PartnerProtectedRoute><PartnerLayout><PartnerPortalRedemptions /></PartnerLayout></PartnerProtectedRoute>} />
                    <Route path="/partner/settings" element={<PartnerProtectedRoute><PartnerLayout><PartnerPortalSettings /></PartnerLayout></PartnerProtectedRoute>} />
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin" element={<ProtectedRoute><AdminLayout><AdminHome /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/partners" element={<ProtectedRoute><AdminLayout><PartnerManager /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/gym-requests" element={<ProtectedRoute><AdminLayout><GymRequests /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/rewards" element={<ProtectedRoute><AdminLayout><RewardManager /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/reward-submissions" element={<ProtectedRoute><AdminLayout><RewardSubmissions /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/featured" element={<ProtectedRoute><AdminLayout><FeaturedSchedule /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/placements" element={<ProtectedRoute><AdminLayout><RewardPlacements /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/challenges" element={<ProtectedRoute><AdminLayout><WeeklyChallenges /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/users" element={<ProtectedRoute><AdminLayout><UserManager /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/users/:userId" element={<ProtectedRoute><AdminLayout><UserProfile /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/partners/:partnerId" element={<ProtectedRoute><AdminLayout><PartnerProfile /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/analytics" element={<ProtectedRoute><AdminLayout><Analytics /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/sessions" element={<ProtectedRoute><AdminLayout><SessionReview /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/performance" element={<ProtectedRoute><AdminLayout><PartnerPerformance /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/performance/:partnerId" element={<ProtectedRoute><AdminLayout><GymDetail /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/redemptions" element={<ProtectedRoute><AdminLayout><RedemptionTracker /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/audit" element={<ProtectedRoute><AdminLayout><AuditLog /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/config" element={<ProtectedRoute><AdminLayout><SystemConfig /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/support" element={<ProtectedRoute><AdminLayout><SupportTickets /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/broadcast" element={<ProtectedRoute><AdminLayout><Broadcast /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/campaigns" element={<ProtectedRoute><AdminLayout><Campaigns /></AdminLayout></ProtectedRoute>} />
                    <Route path="/admin/athletes" element={<ProtectedRoute><AdminLayout><AthleteApplications /></AdminLayout></ProtectedRoute>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </AuthProvider>
        </ToastProvider>
    );
}
