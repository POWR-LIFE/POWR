import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Link2, Users, Gift, Settings, LogOut, ChevronRight, Search, Eye } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';

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
        <div className="min-h-screen bg-[#F4F4F1] font-['Outfit'] flex items-center justify-center p-8">
            <div className="w-full max-w-xl bg-white border border-[#E6E6E1] rounded-3xl p-10 shadow-2xl">
                <div className="flex items-center gap-3 mb-2">
                    <Eye size={16} className="text-[#8a7600]" />
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#8a7600] font-black">Admin Preview</span>
                </div>
                <h1 className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">View portal as...</h1>
                <p className="text-[11px] text-[#AAAAAA] font-black mb-8">You're signed in as an admin. Pick a creator to see their portal exactly as they would.</p>

                <div className="relative mb-6">
                    <Search size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                    <input
                        type="text"
                        autoFocus
                        placeholder="Search creators..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full h-13 pl-12 pr-5 py-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none transition-all"
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
                                <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black mb-4">No creators yet</p>
                                <Link to="/admin/creators" className="text-[10px] uppercase tracking-[0.3em] text-[#8a7600] font-black hover:underline">
                                    Add the first one
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
                                    <div className="w-9 h-9 rounded-full bg-white border border-[#E6E6E1] flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0">
                                        {c.display_name?.[0]}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-[#222] truncate">{c.display_name}</div>
                                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-0.5">
                                        @{c.handle}{c.status !== 'active' ? ` · ${c.status}` : ''}
                                    </div>
                                </div>
                                <ChevronRight size={15} className="text-[#CCCCCC] group-hover:text-[#8a7600] transition-colors shrink-0" />
                            </button>
                        ))}
                    </div>
                )}

                <div className="mt-8 pt-6 border-t border-[#E6E6E1] text-center">
                    <Link to="/admin" className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] hover:text-[#8a7600] font-black transition-colors">Back to Admin</Link>
                </div>
            </div>
        </div>
    );
}

const NAV = [
    { label: 'Overview',    path: '/creator',             icon: LayoutDashboard },
    { label: 'My Link',     path: '/creator/links',       icon: Link2           },
    { label: 'Signups',     path: '/creator/conversions', icon: Users           },
    { label: 'Rewards',     path: '/creator/rewards',     icon: Gift            },
    { label: 'Settings',    path: '/creator/settings',    icon: Settings        },
];

const PATH_LABELS = {
    creator:       'Overview',
    links:         'My Link',
    conversions:   'Signups',
    rewards:       'Rewards',
    settings:      'Settings',
};

export function CreatorLayout({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, creatorData, isAdmin, isActingCreator, setActingCreator } = useAuth();

    const segment = location.pathname.split('/')[2] || 'creator';
    const currentLabel = PATH_LABELS[segment] || segment;

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/creator/login');
    };

    // Admin with no creator link and no preview selection yet → pick one first
    if (!creatorData && isAdmin) {
        return <AdminCreatorPicker onSelect={setActingCreator} />;
    }

    return (
        <div className="flex min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] selection:bg-[#E8D200] selection:text-[#080808]">
            {/* Sidebar */}
            <aside className="w-72 flex-shrink-0 border-r border-[#E6E6E1] bg-white flex flex-col h-screen sticky top-0 z-[100]">
                <div className="px-8 pt-8 pb-5 flex items-center justify-start pointer-events-none">
                    <img src="/powr-logo-black.png" alt="POWR" style={{ height: '28px', width: 'auto', display: 'block' }} />
                </div>

                {/* Creator identity card */}
                {creatorData && (
                    <div className="mx-6 mb-5 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                        <div className="flex items-center gap-3">
                            {creatorData.avatar_url ? (
                                <img
                                    src={creatorData.avatar_url}
                                    alt={creatorData.display_name}
                                    className="w-10 h-10 rounded-full object-cover border border-[#E6E6E1]"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/20 flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase">
                                    {creatorData.display_name?.[0]}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-black text-[#1A1A1A] truncate">{creatorData.display_name}</div>
                                {/* NOT uppercased: the handle is lowercase in powr.life/join/<handle>,
                                    and showing it shouted implies a URL that would 404. */}
                                <div className="text-[10px] tracking-[0.15em] text-[#BBBBBB] font-black mt-0.5">@{creatorData.handle}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* A paused creator's link still works — it just stops earning.
                    Saying so here is kinder than letting them wonder why the
                    numbers stopped moving. */}
                {creatorData && creatorData.status !== 'active' && (
                    <div className="mx-6 mb-5 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                        <div className="text-[9px] uppercase tracking-[0.3em] text-amber-700 font-black mb-1">
                            {creatorData.status}
                        </div>
                        <p className="text-[10px] text-[#888] leading-relaxed font-light">
                            Your link still works, but new signups aren't earning right now. Get in touch and we'll sort it.
                        </p>
                    </div>
                )}

                <nav className="flex-1 px-6 space-y-1.5 overflow-y-auto">
                    <div className="px-4 mb-4">
                        <div className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-2">Creator Portal</div>
                        <div className="h-[2px] w-10 bg-[#E8D200]/60"></div>
                    </div>
                    {NAV.map(item => {
                        const active = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex items-center gap-4 px-5 py-3 rounded-2xl transition-all group ${
                                    active
                                        ? 'bg-[#E8D200] text-[#080808] shadow-[0_20px_50px_rgba(232,210,0,0.2)]'
                                        : 'text-[#BBBBBB] hover:bg-[#EFEFEC] hover:text-[#333333]'
                                }`}
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
                        className="w-full flex items-center justify-center gap-3 h-12 text-[11px] uppercase tracking-[0.3em] font-black text-red-500/40 hover:text-red-500 hover:bg-red-500/5 rounded-2xl transition-all border border-transparent hover:border-red-500/10"
                    >
                        <LogOut size={16} /> Sign Out
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#F4F4F1] border-l border-[#E6E6E1]">
                <header className="h-24 border-b border-[#E6E6E1] flex-shrink-0 flex items-center justify-between px-16 bg-[#F4F4F1]/60 backdrop-blur-3xl sticky top-0 z-50">
                    <div className="flex items-center gap-5">
                        <div className="text-[10px] uppercase tracking-[0.5em] font-black text-[#CCCCCC]">Creator Portal</div>
                        <ChevronRight size={13} className="text-[#CCCCCC]" />
                        <div className="flex items-center gap-3">
                            <div className="h-1.5 w-1.5 rounded-full bg-[#E8D200] shadow-[0_0_10px_rgba(232,210,0,0.6)] animate-pulse"></div>
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
                                className="h-10 px-5 text-[9px] font-black uppercase tracking-[0.2em] bg-white border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#8B5CF6]/40 hover:text-[#8B5CF6] transition-all"
                            >
                                Switch Creator
                            </button>
                        </div>
                    )}
                </header>

                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-[1400px] px-16 py-10">
                        {children}
                    </div>
                    <div className="h-24 w-full" />
                </div>
            </main>
        </div>
    );
}
