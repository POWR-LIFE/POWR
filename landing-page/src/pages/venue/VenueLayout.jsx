import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Palette, Tv, Users, UserCog, LogOut, ChevronRight, Search, Eye, X, ChevronDown, Lock, Package } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import { INPUT } from '../../components/portal/ui';
import { fetchGymPackage } from './venueApi';
import { PackageContext, packageLine } from './packages';

const NAV = [
    { label: 'Overview', short: 'Home',    path: '/venue',         icon: LayoutDashboard },
    { label: 'Events',   short: 'Events',  path: '/venue/events',  icon: CalendarDays    },
    { label: 'Studio',   short: 'Studio',  path: '/venue/studio',  icon: Palette,   feature: 'studio'   },
    { label: 'Screens',  short: 'Screens', path: '/venue/screens', icon: Tv              },
    { label: 'Members',  short: 'Members', path: '/venue/members', icon: Users,     feature: 'insights' },
    { label: 'Team',     short: 'Team',    path: '/venue/team',    icon: UserCog         },
];

const PATH_LABELS = { venue: 'Overview', events: 'Events', studio: 'Studio', screens: 'Screens', members: 'Members', team: 'Team', package: 'Package' };

// An event's own pages keep the Events tab lit.
const isActive = (path, current) => current === path || (path !== '/venue' && current.startsWith(`${path}/`));

const ROLE_LABEL = { owner: 'Owner', staff: 'Team', admin: 'POWR admin' };

/** A gym's logo on the tile its artwork was made for ('dark' logos are light marks). */
export function GymLogo({ gym, size = 'w-10 h-10', rounded = 'rounded-xl' }) {
    const dark = gym?.logo_bg === 'dark';
    return gym?.logo_url ? (
        <div className={`${size} ${rounded} shrink-0 border border-[#E6E6E1] flex items-center justify-center overflow-hidden ${dark ? 'bg-[#1A1A1A]' : 'bg-white'}`}>
            <img src={gym.logo_url} alt={gym.name} className="w-[78%] h-[78%] object-contain" />
        </div>
    ) : (
        <div className={`${size} ${rounded} shrink-0 bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[11px] font-black text-[#8a7600] uppercase`}>
            {gym?.name?.[0] ?? '?'}
        </div>
    );
}

// --- Admin-only: pick which gym to preview the portal as ---
// Gyms with the portal switched on come first; any gym can be searched, so an
// admin can look before enabling one.
function AdminGymPicker({ onSelect }) {
    const [enabled, setEnabled] = useState([]);
    const [results, setResults] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase
            .from('gym_portal_settings')
            .select('partner_id, enabled, suspended_at, partners(name, logo_url, logo_bg)')
            .order('created_at', { ascending: false })
            .then(({ data }) => {
                setEnabled((data ?? []).map(r => ({
                    id: r.partner_id, name: r.partners?.name, logo_url: r.partners?.logo_url, logo_bg: r.partners?.logo_bg,
                    status: r.suspended_at ? 'suspended' : r.enabled ? 'portal on' : 'portal off',
                })));
                setLoading(false);
            });
    }, []);

    useEffect(() => {
        const q = search.trim();
        if (q.length < 2) { setResults([]); return; }
        const t = setTimeout(async () => {
            const { data } = await supabase
                .from('partners')
                .select('id, name, logo_url, logo_bg')
                .eq('category', 'gym')
                .ilike('name', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
                .limit(12);
            setResults(data ?? []);
        }, 250);
        return () => clearTimeout(t);
    }, [search]);

    const list = search.trim().length >= 2 ? results : enabled;

    return (
        <div className="min-h-screen bg-[#F4F4F1] font-['Outfit'] flex items-center justify-center p-4 sm:p-8">
            <div className="w-full max-w-xl bg-white border border-[#E6E6E1] rounded-3xl p-6 sm:p-10">
                <div className="flex items-center gap-3 mb-2">
                    <Eye size={16} className="text-[#8a7600]" />
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#8a7600] font-black">Admin Preview</span>
                </div>
                <h1 className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">View portal as...</h1>
                <p className="text-[11px] text-[#AAAAAA] font-black mb-8">You’re signed in as an admin. Pick a gym to see its portal exactly as its team does.</p>

                <div className="relative mb-6">
                    <Search size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                    <input type="text" autoFocus placeholder="Search all gyms..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT} pl-12`} />
                </div>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="w-7 h-7 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : (
                    <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-1">
                        {list.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-4">
                                    {search.trim().length >= 2 ? 'No gyms match' : 'No gym has the portal yet'}
                                </p>
                                <Link to="/admin/gyms" className="text-[10px] uppercase tracking-[0.3em] font-black hover:underline">
                                    <span className="text-[#8a7600]">Switch one on in Gym Portals</span>
                                </Link>
                            </div>
                        ) : list.map(g => (
                            <button
                                key={g.id}
                                onClick={() => onSelect(g.id)}
                                className="w-full flex items-center gap-4 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl hover:border-[#E8D200]/40 hover:bg-[#E8D200]/5 transition-all text-left group"
                            >
                                <GymLogo gym={g} size="w-9 h-9" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{g.name}</div>
                                    {g.status && <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-0.5">{g.status}</div>}
                                </div>
                                <ChevronRight size={15} className="text-[#BBBBBB] group-hover:text-[#8a7600] transition-colors shrink-0" />
                            </button>
                        ))}
                    </div>
                )}

                <div className="mt-8 pt-6 border-t border-[#E6E6E1] text-center">
                    <Link to="/admin/gyms" className="text-[10px] uppercase tracking-[0.3em] font-black transition-colors">
                        <span className="text-[#BBBBBB] hover:text-[#8a7600]">Back to Admin</span>
                    </Link>
                </div>
            </div>
        </div>
    );
}

// Someone on more than one gym's team switches between them here.
function GymSwitcher({ className = '' }) {
    const { gym, gymMemberships, setActiveGym, isActingGym } = useAuth();
    const others = gymMemberships.filter(m => m.active && m.partner_id !== gym?.partner_id);
    const [open, setOpen] = useState(false);
    if (isActingGym || others.length === 0) return null;
    return (
        <div className={`relative ${className}`}>
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 h-9 px-4 bg-white border border-[#E6E6E1] rounded-full text-[9px] uppercase tracking-[0.25em] font-black text-[#888] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all"
            >
                Switch gym <ChevronDown size={12} />
            </button>
            {open && (
                <div className="absolute z-50 left-0 right-0 mt-2 bg-white border border-[#E6E6E1] rounded-2xl shadow-xl overflow-hidden">
                    {others.map(m => (
                        <button
                            key={m.partner_id}
                            onClick={() => { setActiveGym(m.partner_id); setOpen(false); }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#FAFAF8] transition-colors"
                        >
                            <GymLogo gym={m} size="w-7 h-7" rounded="rounded-lg" />
                            <span className="text-[12px] font-bold text-[#1A1A1A] truncate">{m.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function VenueLayout({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, gym, isAdmin, isActingGym, setActingGym } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);

    // The gym's package: what's unlocked (the pages lock themselves from it)
    // and the trial clock. Reloaded when the gym changes, or on request.
    const [pkg, setPkg] = useState(null);
    const partnerId = gym?.partner_id;
    const refreshPkg = useCallback(() => {
        if (!partnerId) return;
        fetchGymPackage(partnerId).then(setPkg).catch(() => setPkg(null));
    }, [partnerId]);
    useEffect(() => { setPkg(null); refreshPkg(); }, [refreshPkg]);
    const locked = (item) => item.feature && pkg && !pkg.features?.[item.feature];

    const segment = location.pathname.split('/')[2] || 'venue';
    const currentLabel = PATH_LABELS[segment] || segment;

    useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); }, [location.pathname]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/venue/login');
    };

    // Admin with no gym of their own and no preview pick yet → pick one first.
    if (!gym && isAdmin) return <AdminGymPicker onSelect={setActingGym} />;

    const roleLabel = ROLE_LABEL[gym?.role] ?? '';

    return (
        <div className="min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] selection:bg-[#E8D200] selection:text-[#080808] lg:flex">
            <div
                aria-hidden
                className="fixed inset-0 pointer-events-none z-0"
                style={{
                    background:
                        'radial-gradient(900px 600px at 10% -10%, rgba(232,210,0,0.09) 0%, transparent 60%),' +
                        'radial-gradient(700px 500px at 100% 100%, rgba(232,210,0,0.04) 0%, transparent 60%)',
                }}
            />

            {/* ── Desktop sidebar ─────────────────────────────────────────── */}
            <aside className="hidden lg:flex w-72 flex-shrink-0 border-r border-[#E6E6E1] bg-white backdrop-blur-xl flex-col h-screen sticky top-0 z-40">
                <div className="px-8 pt-8 pb-6 flex items-center pointer-events-none">
                    <img src="/powr-logo-black.png" alt="POWR" style={{ height: 26, width: 'auto', display: 'block' }} />
                </div>

                {gym && (
                    <div className="mx-6 mb-5 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl space-y-3">
                        <div className="flex items-center gap-3">
                            <GymLogo gym={gym} />
                            <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-black text-[#1A1A1A] truncate">{gym.name}</div>
                                <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-0.5">{roleLabel}</div>
                            </div>
                        </div>
                        {pkg && (
                            <Link to="/venue/package" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#E6E6E1] hover:border-[#E8D200]/50 transition-colors">
                                <Package size={12} className="text-[#8a7600] shrink-0" />
                                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-[#8a7600] truncate">{packageLine(pkg)}</span>
                            </Link>
                        )}
                        <GymSwitcher />
                    </div>
                )}

                <nav className="flex-1 px-6 space-y-1.5 overflow-y-auto">
                    <div className="px-4 mb-4">
                        <div className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-2">Gym Portal</div>
                        <div className="h-[2px] w-10 bg-[#E8D200]/70" />
                    </div>
                    {NAV.map(item => {
                        const active = isActive(item.path, location.pathname);
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex items-center gap-4 px-5 py-3 rounded-2xl transition-all group ${
                                    active ? 'bg-[#E8D200] shadow-[0_16px_40px_rgba(232,210,0,0.22)]' : 'hover:bg-[#EFEFEC]'
                                }`}
                                style={{ color: active ? '#080808' : '#BBBBBB' }}
                            >
                                <item.icon size={18} strokeWidth={active ? 3 : 2} className={active ? '' : 'group-hover:text-[#8a7600] transition-colors'} />
                                <span className="text-[11px] uppercase tracking-[0.2em] font-black">{item.label}</span>
                                {locked(item) && <Lock size={11} className="ml-auto opacity-70" aria-label="Not in your package" />}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-6 mt-auto">
                    {user?.email && (
                        <div className="mb-3 px-4 py-3 bg-[#F4F4F1] rounded-2xl border border-[#E6E6E1]">
                            <div className="text-[9px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-1">Signed in as</div>
                            <div className="text-[11px] text-[#666] truncate font-mono">{user.email}</div>
                        </div>
                    )}
                    <button
                        onClick={handleSignOut}
                        className="w-full flex items-center justify-center gap-3 h-12 text-[11px] uppercase tracking-[0.3em] font-black text-red-500/50 hover:text-red-500 hover:bg-red-500/5 rounded-2xl transition-all border border-transparent hover:border-red-500/10"
                    >
                        <LogOut size={16} /> Sign Out
                    </button>
                </div>
            </aside>

            {/* ── Mobile top bar ──────────────────────────────────────────── */}
            <header className="lg:hidden sticky top-0 z-40 bg-[#F4F4F1]/85 backdrop-blur-xl border-b border-[#E6E6E1]">
                <div className="h-16 px-5 flex items-center justify-between gap-3">
                    <img src="/powr-logo-black.png" alt="POWR" style={{ height: 20, width: 'auto' }} />
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="h-1.5 w-1.5 rounded-full bg-[#E8D200] shadow-[0_0_10px_rgba(232,210,0,0.7)] animate-pulse shrink-0" />
                        <span className="text-[10px] uppercase tracking-[0.3em] font-black text-[#8a7600] truncate">{currentLabel}</span>
                    </div>
                    {gym ? (
                        <button onClick={() => setMenuOpen(o => !o)} aria-label="Account" className="shrink-0">
                            <GymLogo gym={gym} size="w-9 h-9" />
                        </button>
                    ) : <div className="w-9" />}
                </div>
                {isActingGym && (
                    <div className="px-5 pb-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-full">
                            <Eye size={12} className="text-[#8B5CF6] shrink-0" />
                            <span className="text-[9px] uppercase tracking-[0.15em] font-black text-[#8B5CF6] truncate">Preview · {gym?.name}</span>
                        </div>
                        <button onClick={() => setActingGym(null)} className="h-8 px-4 text-[9px] font-black uppercase tracking-[0.15em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] shrink-0">
                            Switch
                        </button>
                    </div>
                )}
            </header>

            {/* ── Mobile account sheet ────────────────────────────────────── */}
            {menuOpen && gym && (
                <div className="lg:hidden fixed inset-0 z-50" onClick={() => setMenuOpen(false)}>
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
                    <div
                        className="absolute left-0 right-0 bottom-0 bg-white border-t border-[#E6E6E1] rounded-t-3xl p-6 pb-[max(24px,env(safe-area-inset-bottom))]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3 min-w-0">
                                <GymLogo gym={gym} size="w-12 h-12" />
                                <div className="min-w-0">
                                    <div className="text-[14px] font-black text-[#1A1A1A] truncate">{gym.name}</div>
                                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-0.5">{roleLabel}</div>
                                </div>
                            </div>
                            <button onClick={() => setMenuOpen(false)} className="w-9 h-9 rounded-full bg-[#F4F4F1] flex items-center justify-center text-[#888]" aria-label="Close">
                                <X size={16} />
                            </button>
                        </div>
                        <GymSwitcher className="mb-4" />
                        {pkg && (
                            <Link to="/venue/package" className="mb-4 flex items-center gap-3 px-4 py-3 bg-[#F4F4F1] rounded-2xl border border-[#E6E6E1]">
                                <Package size={14} className="text-[#8a7600] shrink-0" />
                                <span className="flex-1 text-[11px] font-black uppercase tracking-[0.15em] text-[#8a7600] truncate">{packageLine(pkg)}</span>
                                <ChevronRight size={14} className="text-[#BBBBBB]" />
                            </Link>
                        )}
                        {user?.email && (
                            <div className="mb-4 px-4 py-3 bg-[#F4F4F1] rounded-2xl border border-[#E6E6E1]">
                                <div className="text-[9px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-1">Signed in as</div>
                                <div className="text-[12px] text-[#666] truncate font-mono">{user.email}</div>
                            </div>
                        )}
                        <button
                            onClick={handleSignOut}
                            className="w-full flex items-center justify-center gap-3 h-12 text-[11px] uppercase tracking-[0.3em] font-black text-red-500/70 bg-red-500/5 border border-red-500/10 rounded-2xl"
                        >
                            <LogOut size={16} /> Sign Out
                        </button>
                    </div>
                </div>
            )}

            {/* ── Main ─────────────────────────────────────────────────────── */}
            <main className="relative z-10 flex-1 flex flex-col min-w-0 lg:h-screen lg:overflow-hidden">
                <header className="hidden lg:flex h-24 border-b border-[#E6E6E1] flex-shrink-0 items-center justify-between px-16 bg-[#F4F4F1]/70 backdrop-blur-3xl sticky top-0 z-30">
                    <div className="flex items-center gap-5">
                        <div className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB]">Gym Portal</div>
                        <ChevronRight size={13} className="text-[#BBBBBB]" />
                        <div className="flex items-center gap-3">
                            <div className="h-1.5 w-1.5 rounded-full bg-[#E8D200] shadow-[0_0_10px_rgba(232,210,0,0.7)] animate-pulse" />
                            <div className="text-[13px] uppercase tracking-[0.3em] font-black text-[#8a7600]">{currentLabel}</div>
                        </div>
                    </div>
                    {isActingGym && (
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3 px-5 py-2.5 bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-full">
                                <Eye size={13} className="text-[#8B5CF6]" />
                                <span className="text-[10px] uppercase tracking-[0.2em] font-black text-[#8B5CF6]">Admin preview · {gym?.name}</span>
                            </div>
                            <button
                                onClick={() => setActingGym(null)}
                                className="h-10 px-5 text-[9px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#8B5CF6]/40 hover:text-[#8B5CF6] transition-all"
                            >
                                Switch Gym
                            </button>
                        </div>
                    )}
                </header>

                <div className="flex-1 lg:overflow-y-auto">
                    <div className="max-w-[1400px] px-5 sm:px-8 lg:px-16 pt-6 sm:pt-8 lg:pt-10 pb-28 lg:pb-24">
                        {/* Keyed on the gym: switching gyms remounts the page, so no
                            page can show one gym's data under another's name. */}
                        <PackageContext.Provider value={{ pkg, refresh: refreshPkg }}>
                            <React.Fragment key={gym?.partner_id ?? 'none'}>{children}</React.Fragment>
                        </PackageContext.Provider>
                    </div>
                </div>
            </main>

            {/* ── Mobile bottom tabs ──────────────────────────────────────── */}
            <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-xl border-t border-[#E6E6E1] pb-[env(safe-area-inset-bottom)]">
                <div className="grid grid-cols-6 h-16">
                    {NAV.map(item => {
                        const active = isActive(item.path, location.pathname);
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className="flex flex-col items-center justify-center gap-1.5 relative"
                                style={{ color: active ? '#E8D200' : '#AAAAAA' }}
                            >
                                {active && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-[#E8D200] shadow-[0_0_12px_rgba(232,210,0,0.8)]" />}
                                <span className="relative">
                                    <item.icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                                    {locked(item) && <Lock size={9} className="absolute -right-2 -top-1" aria-label="Not in your package" />}
                                </span>
                                <span className="text-[9px] uppercase tracking-[0.15em] font-black">{item.short}</span>
                            </Link>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}
