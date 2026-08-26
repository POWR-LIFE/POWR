import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Link2, Users, Gift, Settings, LogOut, ChevronRight, Search, Eye, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import { C, INPUT } from './ui';

// --- Admin-only: pick which creator to preview the portal as ---
// Mirrors AdminPartnerPicker. Unlike brands (which have no table of their own),
// creators are a real table, so this is a straight select.
function AdminCreatorPicker({ onSelect }) {
    const [creators, setCreators] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase
            .from('creators')
            .select('id, handle, display_name, avatar_url, status')
            .order('created_at', { ascending: false })
            .limit(1000)
            .then(({ data }) => {
                setCreators(data ?? []);
                setLoading(false);
            });
    }, []);

    const q = search.trim().toLowerCase();
    const filtered = q
        ? creators.filter(c =>
            c.display_name?.toLowerCase().includes(q) || c.handle?.toLowerCase().includes(q))
        : creators;

    return (
        <div className="min-h-screen bg-[#F4F4F1] font-['Outfit'] flex items-center justify-center p-4 sm:p-8">
            <div className="w-full max-w-xl bg-white border border-[#E6E6E1] rounded-3xl p-6 sm:p-10">
                <div className="flex items-center gap-3 mb-2">
                    <Eye size={16} className="text-[#8a7600]" />
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#8a7600] font-black">Admin Preview</span>
                </div>
                <h1 className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">View portal as...</h1>
                <p className="text-[11px] text-[#AAAAAA] font-black mb-8">You're signed in as an admin. Pick an affiliate to see their portal exactly as they would.</p>

                <div className="relative mb-6">
                    <Search size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                    <input
                        type="text"
                        autoFocus
                        placeholder="Search affiliates..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className={`${INPUT} pl-12`}
                    />
                </div>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="w-7 h-7 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : (
                    <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-1">
                        {filtered.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-4">No affiliates yet</p>
                                <Link to="/admin/creators" className="text-[10px] uppercase tracking-[0.3em] font-black hover:underline">
                                    <span className="text-[#8a7600]">Add the first one</span>
                                </Link>
                            </div>
                        ) : filtered.map(c => (
                            <button
                                key={c.id}
                                onClick={() => onSelect(c.id)}
                                className="w-full flex items-center gap-4 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl hover:border-[#E8D200]/40 hover:bg-[#E8D200]/5 transition-all text-left group"
                            >
                                {c.avatar_url ? (
                                    <img src={c.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                                ) : (
                                    <div className="w-9 h-9 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/20 flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0">
                                        {c.display_name?.[0]}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{c.display_name}</div>
                                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-0.5">
                                        @{c.handle}{c.status !== 'active' ? ` · ${c.status}` : ''}
                                    </div>
                                </div>
                                <ChevronRight size={15} className="text-[#BBBBBB] group-hover:text-[#8a7600] transition-colors shrink-0" />
                            </button>
                        ))}
                    </div>
                )}

                <div className="mt-8 pt-6 border-t border-[#E6E6E1] text-center">
                    <Link to="/admin" className="text-[10px] uppercase tracking-[0.3em] font-black transition-colors">
                        <span className="text-[#BBBBBB] hover:text-[#8a7600]">Back to Admin</span>
                    </Link>
                </div>
            </div>
        </div>
    );
}

const NAV = [
    { label: 'Overview', short: 'Home',    path: '/affiliate',           icon: LayoutDashboard },
    { label: 'My Link',  short: 'Link',    path: '/affiliate/links',     icon: Link2           },
    { label: 'Signups',  short: 'Signups', path: '/affiliate/conversions',icon: Users           },
    { label: 'Rewards',  short: 'Rewards', path: '/affiliate/rewards',   icon: Gift            },
    { label: 'Settings', short: 'You',     path: '/affiliate/settings',  icon: Settings        },
];

const PATH_LABELS = {
    affiliate:     'Overview',
    links:         'My Link',
    conversions:   'Signups',
    rewards:       'Rewards',
    settings:      'Settings',
};

function Avatar({ creator, size = 'w-10 h-10' }) {
    return creator.avatar_url ? (
        <img
            src={creator.avatar_url}
            alt={creator.display_name}
            className={`${size} rounded-full object-cover border border-[#E6E6E1] shrink-0`}
        />
    ) : (
        <div className={`${size} rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[11px] font-black text-[#8a7600] uppercase shrink-0`}>
            {creator.display_name?.[0]}
        </div>
    );
}

export function CreatorLayout({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, creatorData, isAdmin, isActingCreator, setActingCreator } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);

    const segment = location.pathname.split('/')[2] || 'affiliate';
    const currentLabel = PATH_LABELS[segment] || segment;

    // Route change closes the mobile account sheet, and the page starts at the top.
    useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); }, [location.pathname]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/affiliate/login');
    };

    // Admin with no creator link and no preview selection yet → pick one first
    if (!creatorData && isAdmin) {
        return <AdminCreatorPicker onSelect={setActingCreator} />;
    }

    const paused = creatorData && creatorData.status !== 'active';

    return (
        <div className="min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] selection:bg-[#E8D200] selection:text-[#080808] lg:flex">
            {/* Ambient light: one warm glow top-left, fixed so it never scrolls
                away. It's what stops the page reading as "a black admin panel". */}
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

                {creatorData && (
                    <div className="mx-6 mb-5 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                        <div className="flex items-center gap-3">
                            <Avatar creator={creatorData} />
                            <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-black text-[#1A1A1A] truncate">{creatorData.display_name}</div>
                                {/* NOT uppercased: the handle is lowercase in powr.life/join/<handle>,
                                    and showing it shouted implies a URL that would 404. */}
                                <div className="text-[10px] tracking-[0.15em] text-[#BBBBBB] font-black mt-0.5">@{creatorData.handle}</div>
                            </div>
                        </div>
                    </div>
                )}

                {paused && <PausedNote status={creatorData.status} className="mx-6 mb-5" />}

                <nav className="flex-1 px-6 space-y-1.5 overflow-y-auto">
                    <div className="px-4 mb-4">
                        <div className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-2">Affiliate Portal</div>
                        <div className="h-[2px] w-10 bg-[#E8D200]/70" />
                    </div>
                    {NAV.map(item => {
                        const active = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex items-center gap-4 px-5 py-3 rounded-2xl transition-all group ${
                                    active
                                        ? 'bg-[#E8D200] shadow-[0_16px_40px_rgba(232,210,0,0.22)]'
                                        : 'hover:bg-[#EFEFEC]'
                                }`}
                                style={{ color: active ? '#080808' : '#BBBBBB' }}
                            >
                                <item.icon size={18} strokeWidth={active ? 3 : 2} className={active ? '' : 'group-hover:text-[#8a7600] transition-colors'} />
                                <span className="text-[11px] uppercase tracking-[0.2em] font-black">{item.label}</span>
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
                    <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-[#E8D200] shadow-[0_0_10px_rgba(232,210,0,0.7)] animate-pulse" />
                        <span className="text-[10px] uppercase tracking-[0.3em] font-black text-[#8a7600]">{currentLabel}</span>
                    </div>
                    {creatorData ? (
                        <button onClick={() => setMenuOpen(o => !o)} aria-label="Account" className="shrink-0">
                            <Avatar creator={creatorData} size="w-9 h-9" />
                        </button>
                    ) : <div className="w-9" />}
                </div>
                {isActingCreator && (
                    <div className="px-5 pb-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-full">
                            <Eye size={12} className="text-[#8B5CF6] shrink-0" />
                            <span className="text-[9px] uppercase tracking-[0.15em] font-black text-[#8B5CF6] truncate">
                                Preview · {creatorData?.display_name}
                            </span>
                        </div>
                        <button
                            onClick={() => setActingCreator(null)}
                            className="h-8 px-4 text-[9px] font-black uppercase tracking-[0.15em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] shrink-0"
                        >
                            Switch
                        </button>
                    </div>
                )}
            </header>

            {/* ── Mobile account sheet ────────────────────────────────────── */}
            {menuOpen && creatorData && (
                <div className="lg:hidden fixed inset-0 z-50" onClick={() => setMenuOpen(false)}>
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
                    <div
                        className="absolute left-0 right-0 bottom-0 bg-white border-t border-[#E6E6E1] rounded-t-3xl p-6 pb-[max(24px,env(safe-area-inset-bottom))]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3 min-w-0">
                                <Avatar creator={creatorData} size="w-12 h-12" />
                                <div className="min-w-0">
                                    <div className="text-[14px] font-black text-[#1A1A1A] truncate">{creatorData.display_name}</div>
                                    <div className="text-[10px] tracking-[0.15em] text-[#BBBBBB] font-black mt-0.5">@{creatorData.handle}</div>
                                </div>
                            </div>
                            <button onClick={() => setMenuOpen(false)} className="w-9 h-9 rounded-full bg-[#F4F4F1] flex items-center justify-center text-[#888]" aria-label="Close">
                                <X size={16} />
                            </button>
                        </div>
                        {paused && <PausedNote status={creatorData.status} className="mb-5" />}
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
                        <div className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB]">Affiliate Portal</div>
                        <ChevronRight size={13} className="text-[#BBBBBB]" />
                        <div className="flex items-center gap-3">
                            <div className="h-1.5 w-1.5 rounded-full bg-[#E8D200] shadow-[0_0_10px_rgba(232,210,0,0.7)] animate-pulse" />
                            <div className="text-[13px] uppercase tracking-[0.3em] font-black text-[#8a7600]">{currentLabel}</div>
                        </div>
                    </div>
                    {isActingCreator && (
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3 px-5 py-2.5 bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-full">
                                <Eye size={13} className="text-[#8B5CF6]" />
                                <span className="text-[10px] uppercase tracking-[0.2em] font-black text-[#8B5CF6]">
                                    Admin preview · {creatorData?.display_name}
                                </span>
                            </div>
                            <button
                                onClick={() => setActingCreator(null)}
                                className="h-10 px-5 text-[9px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#8B5CF6]/40 hover:text-[#8B5CF6] transition-all"
                            >
                                Switch Affiliate
                            </button>
                        </div>
                    )}
                </header>

                <div className="flex-1 lg:overflow-y-auto">
                    <div className="max-w-[1400px] px-5 sm:px-8 lg:px-16 pt-6 sm:pt-8 lg:pt-10 pb-28 lg:pb-24">
                        {children}
                    </div>
                </div>
            </main>

            {/* ── Mobile bottom tabs ──────────────────────────────────────── */}
            <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-xl border-t border-[#E6E6E1] pb-[env(safe-area-inset-bottom)]">
                <div className="grid grid-cols-5 h-16">
                    {NAV.map(item => {
                        const active = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className="flex flex-col items-center justify-center gap-1.5 relative"
                                style={{ color: active ? '#E8D200' : '#AAAAAA' }}
                            >
                                {active && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-[#E8D200] shadow-[0_0_12px_rgba(232,210,0,0.8)]" />}
                                <item.icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                                <span className="text-[9px] uppercase tracking-[0.15em] font-black">{item.short}</span>
                            </Link>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}

// A paused creator's link still works — it just stops earning. Saying so is
// kinder than letting them wonder why the numbers stopped moving.
function PausedNote({ status, className = '' }) {
    return (
        <div className={`p-4 bg-amber-500/[0.06] border border-amber-500/25 rounded-2xl ${className}`}>
            <div className="text-[9px] uppercase tracking-[0.3em] text-amber-700 font-black mb-1">{status}</div>
            <p className="text-[10px] text-[#888] leading-relaxed font-light">
                Your link still works, but new signups aren't earning right now. Get in touch and we'll sort it.
            </p>
        </div>
    );
}
