import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Award, Gift, Settings, LogOut, ChevronRight, Search, Eye } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';

// --- Admin-only: pick which reward brand to preview the portal as ---
// Brands come from rewards.brand_name — partners (gyms) are unrelated.
function AdminPartnerPicker({ onSelect }) {
    const [brands, setBrands] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase
            .from('rewards')
            .select('brand_name, image_url, category, created_at')
            .not('brand_name', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1000)
            .then(({ data }) => {
                const seen = new Map();
                (data ?? []).forEach(r => {
                    const key = r.brand_name.trim().toLowerCase();
                    if (key && !seen.has(key)) {
                        seen.set(key, { name: r.brand_name.trim(), logo_url: r.image_url, category: r.category });
                    }
                });
                setBrands([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
                setLoading(false);
            });
    }, []);

    const filtered = search.trim()
        ? brands.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()))
        : brands;

    return (
        <div className="min-h-screen bg-[#F4F4F1] font-['Outfit'] flex items-center justify-center p-8">
            <div className="w-full max-w-xl bg-white border border-[#E6E6E1] rounded-3xl p-10 shadow-2xl">
                <div className="flex items-center gap-3 mb-2">
                    <Eye size={16} className="text-[#8a7600]" />
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#8a7600] font-black">Admin Preview</span>
                </div>
                <h1 className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">View portal as...</h1>
                <p className="text-[11px] text-[#AAAAAA] font-black mb-8">You're signed in as an admin. Pick a reward brand to see their portal exactly as they would.</p>

                <div className="relative mb-6">
                    <Search size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                    <input
                        type="text"
                        autoFocus
                        placeholder="Search partners..."
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
                            <p className="text-center py-8 text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">No brands found</p>
                        ) : filtered.map(p => (
                            <button
                                key={p.name.toLowerCase()}
                                onClick={() => onSelect(p.name)}
                                className="w-full flex items-center gap-4 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl hover:border-[#E8D200]/40 hover:bg-[#E8D200]/5 transition-all text-left group"
                            >
                                {p.logo_url ? (
                                    <img src={p.logo_url} alt="" className="w-9 h-9 rounded-xl object-contain bg-[#1a1a1a] p-1 shrink-0" />
                                ) : (
                                    <div className="w-9 h-9 rounded-xl bg-white border border-[#E6E6E1] flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0">
                                        {p.name[0]}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-[#222] truncate">{p.name}</div>
                                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-0.5">{p.category ?? 'reward brand'}</div>
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

const NAV_ITEMS = [
    { label: 'Overview',    path: '/partner',             icon: LayoutDashboard },
    { label: 'My Rewards',  path: '/partner/rewards',     icon: Award           },
    { label: 'Redemptions', path: '/partner/redemptions', icon: Gift            },
    { label: 'Settings',    path: '/partner/settings',    icon: Settings        },
];

const PATH_LABELS = {
    partner:     'Overview',
    rewards:     'My Rewards',
    redemptions: 'Redemptions',
    settings:    'Settings',
};

export function PartnerLayout({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, partnerData, isAdmin, isActingPartner, setActingPartner } = useAuth();

    const segment = location.pathname.split('/')[2] || 'partner';
    const currentLabel = PATH_LABELS[segment] || segment;

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/partner/login');
    };

    // Admin with no partner link and no preview selection yet → pick one first
    if (!partnerData && isAdmin) {
        return <AdminPartnerPicker onSelect={setActingPartner} />;
    }

    return (
        <div className="flex min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] selection:bg-[#E8D200] selection:text-[#080808]">
            {/* Sidebar */}
            <aside className="w-72 flex-shrink-0 border-r border-[#E6E6E1] bg-white flex flex-col h-screen sticky top-0 z-[100]">
                <div className="p-10 mb-6 flex items-center justify-start pointer-events-none">
                    <img src="/powr-logo-black.png" alt="POWR" style={{ height: '28px', width: 'auto', display: 'block' }} />
                </div>

                {/* Partner identity card */}
                {partnerData && (
                    <div className="mx-8 mb-8 p-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                        <div className="flex items-center gap-4">
                            {partnerData.logo_url ? (
                                <img
                                    src={partnerData.logo_url}
                                    alt={partnerData.name}
                                    className="w-10 h-10 rounded-xl object-contain border border-[#E6E6E1]"
                                    style={{ background: partnerData.logo_bg === 'white' ? '#fff' : partnerData.logo_bg === 'black' ? '#000' : '#1a1a1a' }}
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-xl bg-[#E8D200]/10 border border-[#E8D200]/20 flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase">
                                    {partnerData.name?.[0]}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-black text-[#1A1A1A] truncate">{partnerData.name}</div>
                                <div className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mt-0.5">{partnerData.category}</div>
                            </div>
                        </div>
                    </div>
                )}

                <nav className="flex-1 px-6 space-y-2 overflow-y-auto">
                    <div className="px-4 mb-6">
                        <div className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-2">Partner Portal</div>
                        <div className="h-[2px] w-10 bg-[#E8D200]/60"></div>
                    </div>
                    {NAV_ITEMS.map(item => {
                        const active = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex items-center gap-5 px-6 py-4 rounded-2xl transition-all group ${
                                    active
                                        ? 'bg-[#E8D200] text-[#080808] shadow-[0_20px_50px_rgba(232,210,0,0.2)]'
                                        : 'text-[#BBBBBB] hover:bg-[#EFEFEC] hover:text-[#333333]'
                                }`}
                            >
                                <item.icon size={20} strokeWidth={active ? 3 : 2} className={active ? '' : 'group-hover:text-[#8a7600] transition-colors'} />
                                <span className="text-[12px] uppercase tracking-[0.2em] font-black">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-10 mt-auto">
                    {user?.email && (
                        <div className="mb-6 p-6 bg-[#F4F4F1] rounded-2xl border border-[#E6E6E1]">
                            <div className="text-[9px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-2">Signed in as</div>
                            <div className="text-[11px] text-[#666] truncate font-mono">{user.email}</div>
                        </div>
                    )}
                    <button
                        onClick={handleSignOut}
                        className="w-full flex items-center justify-center gap-3 h-16 text-[11px] uppercase tracking-[0.3em] font-black text-red-500/40 hover:text-red-500 hover:bg-red-500/5 rounded-2xl transition-all border border-transparent hover:border-red-500/10"
                    >
                        <LogOut size={18} /> Sign Out
                    </button>
                    <div className="mt-6 text-center">
                        <span className="text-[9px] uppercase tracking-[0.5em] text-[#CCCCCC] font-black">Partner Portal</span>
                    </div>
                </div>
            </aside>

            {/* Main */}
            {/* h-screen + overflow-hidden makes the inner div the true scroll
                container — required for position:sticky inside pages to work */}
            <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#F4F4F1] border-l border-[#E6E6E1]">
                <header className="h-24 border-b border-[#E6E6E1] flex-shrink-0 flex items-center justify-between px-16 bg-[#F4F4F1]/60 backdrop-blur-3xl sticky top-0 z-50">
                    <div className="flex items-center gap-5">
                        <div className="text-[10px] uppercase tracking-[0.5em] font-black text-[#CCCCCC]">Partner Portal</div>
                        <ChevronRight size={13} className="text-[#CCCCCC]" />
                        <div className="flex items-center gap-3">
                            <div className="h-1.5 w-1.5 rounded-full bg-[#E8D200] shadow-[0_0_10px_rgba(232,210,0,0.6)] animate-pulse"></div>
                            <div className="text-[13px] uppercase tracking-[0.3em] font-black text-[#8a7600]">{currentLabel}</div>
                        </div>
                    </div>
                    {isActingPartner && (
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3 px-5 py-2.5 bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-full">
                                <Eye size={13} className="text-[#8B5CF6]" />
                                <span className="text-[10px] uppercase tracking-[0.2em] font-black text-[#8B5CF6]">
                                    Admin preview · {partnerData?.name}
                                </span>
                            </div>
                            <button
                                onClick={() => setActingPartner(null)}
                                className="h-10 px-5 text-[9px] font-black uppercase tracking-[0.2em] bg-white border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#8B5CF6]/40 hover:text-[#8B5CF6] transition-all"
                            >
                                Switch Partner
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
