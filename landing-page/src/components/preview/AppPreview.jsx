import React from 'react';
import {
    Ion, StatusBar, PreviewBackground,
    GOLD, TEXT, DIM, MUTED, BORDER, FONT,
    BEZEL, DEVICE_W, DEVICE_H, STATUS_H, TAB_H,
} from '../RewardAppPreview';

// ─────────────────────────────────────────────────────────────────────────────
// AppPreview — a NAVIGABLE recreation of the POWR app for the admin Usage
// panel. Click the tab bar, open the wallet, go back: the preview walks the
// same routes the app does and reports each move, so the heat layer beside it
// always shows the screen you are looking at.
//
// Why not screenshots. A screenshot is a photograph of one state of a screen
// that has tabs, sheets and lists. To ask "where do people tap on Rewards" you
// have to BE on Rewards, with its tab bar lit and its list scrolled — which
// means the preview has to be the app, not a picture of it.
//
// Fidelity follows RewardAppPreview: true device pixels (390×844) taken from
// the RN sources, uniformly CSS-scaled by the caller. Sharing that file's
// tokens and chrome is deliberate — two previews that drift apart would show
// admins an app that does not exist.
//
// These screens are a faithful LIKENESS, not a port. They exist to locate a
// tap, so layout and proportion are what matter; the numbers in them are
// illustrative and are not read from anyone's account.
// ─────────────────────────────────────────────────────────────────────────────

export const PREVIEW_ROUTES = [
    // Tabs
    { route: '/', label: 'Home', group: 'Tabs' },
    { route: '/progress', label: 'Progress', group: 'Tabs' },
    { route: '/league', label: 'League', group: 'Tabs' },
    { route: '/rewards', label: 'Rewards', group: 'Tabs' },
    { route: '/discover', label: 'Discover', group: 'Tabs' },
    // Earning
    { route: '/manual-log', label: 'Manual Log', group: 'Earning' },
    { route: '/progress-detail', label: 'Progress Detail', group: 'Earning' },
    { route: '/points-ledger', label: 'Points Ledger', group: 'Earning' },
    { route: '/achievements', label: 'Levels', group: 'Earning' },
    { route: '/vault', label: 'Vault', group: 'Earning' },
    // Spending
    { route: '/redeem-modal', label: 'Redeem', group: 'Spending' },
    { route: '/wallet', label: 'Wallet', group: 'Spending' },
    // Social
    { route: '/challenges', label: 'Challenges', group: 'Social' },
    { route: '/shared-challenge', label: 'Shared Challenge', group: 'Social' },
    { route: '/friends', label: 'Friends', group: 'Social' },
    { route: '/add-friend', label: 'Add Friend', group: 'Social' },
    { route: '/my-qr', label: 'My QR', group: 'Social' },
    { route: '/share-stats', label: 'Share', group: 'Social' },
    { route: '/notifications', label: 'Activity', group: 'Social' },
    // Account
    { route: '/profile-screen', label: 'Profile', group: 'Account' },
    { route: '/settings-screen', label: 'Settings', group: 'Account' },
    { route: '/edit-profile', label: 'Edit Profile', group: 'Account' },
    { route: '/wearables', label: 'Wearables', group: 'Account' },
    { route: '/activity-preferences', label: 'Activity Prefs', group: 'Account' },
    { route: '/change-password', label: 'Change Password', group: 'Account' },
    { route: '/help-centre', label: 'Help Centre', group: 'Account' },
    // First run
    { route: '/onboarding', label: 'Onboarding', group: 'First run' },
    { route: '/auth-email', label: 'Sign In', group: 'First run' },
];

const TAB_ROUTES = ['/', '/progress', '/league', '/rewards', '/discover'];

// Tiny inline SVGs for the glyphs the shared Ionicons subset does not carry.
const Svg = ({ d, size = 16, color = TEXT, fill = 'none', sw = 1.7 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
        <path d={d} />
    </svg>
);
const ICON = {
    bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
    share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
    back: 'M19 12H5M12 19l-7-7 7-7',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09A1.65 1.65 0 0 0 20.91 10H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    wallet: 'M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z',
    dumbbell: 'M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12',
    walk: 'M13 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM7 21l3-7 3 2 1 5M10 14l-1-5 4-2 2 3 3 1',
    run: 'M13 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 21l4-6-2-4 3-4 3 3 3 1M11 11l2 4 3 6',
    chevR: 'M9 18l6-6-6-6',
    check: 'M20 6L9 17l-5-5',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    flame: 'M12 22c4 0 7-2.7 7-6.5 0-4.5-5-5.5-4-11.5-3 1-6 4.5-6 8 0-1.5-1-3-2-3.5-.7 1.6-2 3.4-2 7C5 19.3 8 22 12 22z',
    map: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z',
    person: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
};

// ── Small building blocks shared across the screens ──────────────────────────

const Row = ({ children, style }) => (
    <div style={{ display: 'flex', alignItems: 'center', ...style }}>{children}</div>
);

const Hit = ({ onClick, children, style }) => (
    <div
        onClick={onClick}
        style={{ cursor: onClick ? 'pointer' : 'default', ...style }}
    >
        {children}
    </div>
);

const Header = ({ title, onBell, onAvatar, onWallet, avatar = 'Q' }) => (
    <Row style={{ padding: '10px 16px', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 28, fontWeight: 200, letterSpacing: '-0.4px', color: TEXT }}>{title}</span>
        <Row style={{ gap: 14 }}>
            {onWallet && <Hit onClick={onWallet}><Svg d={ICON.wallet} size={20} color={TEXT} /></Hit>}
            {onBell && <Hit onClick={onBell}><Svg d={ICON.bell} size={19} color={TEXT} /></Hit>}
            {onAvatar && (
                <Hit onClick={onAvatar}>
                    <div style={{ width: 34, height: 34, borderRadius: 17, background: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#0a0a0a' }}>{avatar}</span>
                    </div>
                </Hit>
            )}
        </Row>
    </Row>
);

const BackBar = ({ title, onBack }) => (
    <Row style={{ padding: '10px 16px', gap: 12 }}>
        <Hit onClick={onBack}><Svg d={ICON.back} size={20} color={TEXT} /></Hit>
        <span style={{ fontSize: 22, fontWeight: 200, letterSpacing: '-0.3px', color: TEXT }}>{title}</span>
    </Row>
);

const Scroll = ({ children }) => (
    <div className="powr-prev-scroll" style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' }}>
        {children}
    </div>
);

const Card = ({ children, style, onClick }) => (
    <Hit onClick={onClick} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, borderRadius: 16, padding: 14, ...style }}>
        {children}
    </Hit>
);

const Ring = ({ icon, label, value, color = GOLD, pct = 0.4 }) => {
    const R = 30, C = 2 * Math.PI * R;
    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', width: 72, height: 72 }}>
                <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="36" cy="36" r={R} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="3" />
                    <circle cx="36" cy="36" r={R} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${C * pct} ${C}`} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Svg d={icon} size={22} color={TEXT} />
                </div>
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', color: DIM }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color }}>{value}</span>
        </div>
    );
};

// ── The tab bar, now interactive ─────────────────────────────────────────────

const NavBar = ({ route, go }) => {
    const items = [
        ['home-outline', '/'],
        ['bar-chart-outline', '/progress'],
        ['trophy-outline', '/league'],
        ['bag', '/rewards'],
        ['compass-outline', '/discover'],
    ];
    return (
        <div style={{ height: TAB_H, background: '#222222', borderTop: '1px solid #303030', display: 'flex', paddingTop: 8, flexShrink: 0 }}>
            {items.map(([name, r]) => (
                <Hit key={r} onClick={() => go(r)}
                    style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 4 }}>
                    <Ion name={name} size={26} color={route === r ? GOLD : 'rgba(255,255,255,0.25)'} />
                </Hit>
            ))}
        </div>
    );
};

// ── Screens ──────────────────────────────────────────────────────────────────

const HomeScreen = ({ go }) => (
    <Scroll>
        <Row style={{ padding: '4px 16px 0', justifyContent: 'space-between' }}>
            <Row style={{ gap: 4, alignItems: 'baseline' }}>
                <span style={{ fontSize: 34, fontWeight: 200, color: GOLD, letterSpacing: '-1px' }}>415</span>
                <span style={{ fontSize: 13, color: GOLD, opacity: 0.7 }}>pts</span>
            </Row>
            <Row style={{ gap: 14 }}>
                <Hit onClick={() => go('/notifications')}><Svg d={ICON.bell} size={19} color={TEXT} /></Hit>
                <Hit onClick={() => go('/profile-screen')}>
                    <div style={{ width: 34, height: 34, borderRadius: 17, background: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#0a0a0a' }}>Q</span>
                    </div>
                </Hit>
            </Row>
        </Row>

        <div style={{ padding: '22px 16px 0' }}>
            <Row style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: TEXT }}>YOUR STREAK</span>
                <Row style={{ gap: 10 }}>
                    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 999, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 5, height: 5, borderRadius: 3, background: '#F43F5E' }} />
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: TEXT }}>UNSTOPPABLE</span>
                    </div>
                    <Hit onClick={() => go('/share-stats')}><Svg d={ICON.share} size={15} color={DIM} /></Hit>
                </Row>
            </Row>

            <Row style={{ gap: 14, marginTop: 16, alignItems: 'flex-start' }}>
                <Row style={{ gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 52, fontWeight: 200, color: GOLD, lineHeight: 1 }}>3</span>
                    <span style={{ fontSize: 13, color: TEXT }}>WEEKS</span>
                </Row>
                <Row style={{ gap: 5, marginLeft: 'auto' }}>
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 8, color: i === 0 ? TEXT : MUTED }}>{d}</span>
                            <div style={{
                                width: 22, height: 22, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: `1px solid ${i === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)'}`,
                            }}>
                                <span style={{ fontSize: 9, color: i === 0 ? TEXT : MUTED }}>{20 + i}</span>
                            </div>
                        </div>
                    ))}
                </Row>
            </Row>
            <span style={{ fontSize: 11, color: DIM, display: 'block', marginTop: 10 }}>
                10:09:21 <span style={{ color: MUTED, fontSize: 9, letterSpacing: '0.14em' }}>RESETS MIDNIGHT</span>
            </span>
        </div>

        <Row style={{ padding: '22px 8px 4px' }}>
            <Ring icon={ICON.dumbbell} label="GYM" value="1 / 3" pct={0.33} />
            <Ring icon={ICON.walk} label="WALK" value="10k / 50k" color="#34D399" pct={0.2} />
            <Ring icon={ICON.run} label="RUN" value="0 / 3" color="#F97316" pct={0} />
        </Row>

        <div style={{ padding: '16px 16px 0' }}>
            <Card onClick={() => go('/achievements')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg,#d8d8e8,#9aa0b5)' }} />
                <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, color: TEXT, display: 'block', marginBottom: 6 }}>Touching Grass</span>
                    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.10)' }}>
                        <div style={{ width: '72%', height: 3, borderRadius: 2, background: GOLD }} />
                    </div>
                    <span style={{ fontSize: 10, color: GOLD, display: 'block', marginTop: 6 }}>
                        85 <span style={{ color: MUTED }}>pts to next level</span>
                    </span>
                </div>
                <Svg d={ICON.chevR} size={14} color={MUTED} />
            </Card>
        </div>

        <div style={{ padding: '20px 16px 0' }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: TEXT }}>TOGETHER</span>
                <span style={{ fontSize: 11, color: GOLD, fontWeight: 600 }}>+ Challenge friends</span>
            </Row>
            <span style={{ fontSize: 11, color: DIM }}>Take one on with friends — everyone earns a growing bonus.</span>
            <Card onClick={() => go('/challenges')} style={{ marginTop: 12 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                    <Svg d={ICON.dumbbell} size={18} color={TEXT} />
                    <Row style={{ gap: 3, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 20, fontWeight: 300, color: GOLD }}>+25</span>
                        <span style={{ fontSize: 9, color: MUTED }}>PTS</span>
                    </Row>
                </Row>
                <span style={{ fontSize: 19, color: TEXT, display: 'block', marginTop: 18 }}>Back Again</span>
                <span style={{ fontSize: 11, color: DIM, display: 'block', marginTop: 4 }}>Check in on 7 different days</span>
            </Card>
        </div>
        <div style={{ height: 28 }} />
    </Scroll>
);

const ProgressScreen = ({ go }) => (
    <Scroll>
        <Header title="Progress" onBell={() => go('/notifications')} onAvatar={() => go('/profile-screen')} avatar="?" />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: TEXT, padding: '0 16px', display: 'block' }}>ACTIVITY OVERVIEW</span>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 0 8px' }}>
            <div style={{ position: 'relative', width: 170, height: 170 }}>
                <svg width="170" height="170" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="85" cy="85" r="66" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="6" />
                    <circle cx="85" cy="85" r="66" fill="none" stroke={GOLD} strokeWidth="6" strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 66 * 0.35} ${2 * Math.PI * 66}`} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 34, fontWeight: 200, color: TEXT }}>2<span style={{ fontSize: 15, color: MUTED }}>/5</span></span>
                    <span style={{ fontSize: 8, letterSpacing: '0.2em', color: MUTED, marginTop: 4 }}>RUN SESSIONS</span>
                </div>
            </div>
        </div>
        <div style={{ height: 1, background: BORDER, margin: '18px 16px' }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: TEXT, padding: '0 16px', display: 'block' }}>BREAKDOWN</span>
        <Row style={{ padding: '14px 16px 0', justifyContent: 'space-between' }}>
            {['GYM', 'RUN', 'WALK'].map((t, i) => (
                <Hit key={t} onClick={() => go('/progress-detail')} style={{ flex: 1, textAlign: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color: i === 0 ? GOLD : MUTED }}>{t}</span>
                </Hit>
            ))}
        </Row>
        <div style={{ height: 1, background: BORDER, margin: '12px 16px' }} />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
            <Row style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: 4, gap: 2 }}>
                {['D', 'W', 'M'].map((s, i) => (
                    <Hit key={s} style={{
                        padding: '5px 20px', borderRadius: 999,
                        background: i === 2 ? GOLD : 'transparent',
                    }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: i === 2 ? '#0a0a0a' : MUTED }}>{s}</span>
                    </Hit>
                ))}
            </Row>
        </div>
        <span style={{ display: 'block', textAlign: 'center', fontSize: 12, color: DIM, marginTop: 16 }}>Last 30 Days</span>
        <div style={{ padding: '26px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <Svg d={ICON.dumbbell} size={22} color={MUTED} />
            <span style={{ fontSize: 14, color: DIM }}>4 gym sessions in 30 days.</span>
        </div>
    </Scroll>
);

const LeagueScreen = ({ go }) => (
    <Scroll>
        <Header title="League" onBell={() => go('/notifications')} onAvatar={() => go('/profile-screen')} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 90 }}>
            <div style={{ position: 'relative', width: 150, height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="150" height="150" style={{ position: 'absolute' }}>
                    <circle cx="75" cy="75" r="62" fill="none" stroke={GOLD} strokeWidth="1.4" strokeOpacity="0.75" strokeDasharray="300 90" />
                    <circle cx="75" cy="75" r="52" fill="none" stroke={GOLD} strokeWidth="0.8" strokeOpacity="0.4" strokeDasharray="230 90" />
                </svg>
                <div style={{ width: 34, height: 26, background: TEXT, transform: 'skewX(-12deg)', clipPath: 'polygon(0 0,55% 0,100% 100%,45% 100%)' }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.26em', color: GOLD, marginTop: 28 }}>KEEP MOVING</span>
            <span style={{ fontSize: 21, fontWeight: 300, color: TEXT, marginTop: 12 }}>The league is waiting for you.</span>
            <span style={{ fontSize: 12, color: DIM, marginTop: 10, textAlign: 'center', padding: '0 40px', lineHeight: 1.5 }}>
                Train consistently to unlock weekly podiums and rankings.
            </span>
        </div>
    </Scroll>
);

const REWARDS = [
    { logo: 'TS', title: 'Free gym class', sub: 'Third Space · Any l...', badge: '£20 VALUE', pts: 800, locked: true },
    { logo: 'NOTTO', title: '25% off y...', sub: 'Notto Pasta ·...', badge: 'UP TO £15 OFF', pts: 500 },
    { logo: 'bulk', title: '30% off ...', sub: 'bulk® · Any ...', badge: 'UP TO £20 OFF', pts: 400 },
    { logo: 'calm', title: '3 months free', sub: 'Calm · Premium su...', badge: '£45 VALUE', pts: 600 },
    { logo: 'eight', title: '£50 off mattress', sub: 'Eight Sleep · Any model', badge: '£50 OFF', pts: 1200, locked: true },
];

const RewardsScreen = ({ go }) => (
    <Scroll>
        <Header title="Rewards" onWallet={() => go('/wallet')} onBell={() => go('/notifications')} onAvatar={() => go('/profile-screen')} />
        <div style={{ padding: '4px 16px 0' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.24em', color: MUTED }}>AVAILABLE BALANCE</span>
            <Row style={{ gap: 8, alignItems: 'baseline', marginTop: 6 }}>
                <span style={{ fontSize: 54, fontWeight: 200, color: GOLD, letterSpacing: '-2px', lineHeight: 1 }}>415</span>
                <span style={{ fontSize: 14, color: TEXT }}>Points</span>
            </Row>
            <Row style={{ gap: 6, marginTop: 8 }}>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: GOLD }} />
                <span style={{ fontSize: 11, color: GOLD }}>+18 today</span>
            </Row>
        </div>
        <Row style={{ padding: '18px 16px 0', gap: 18 }}>
            {['ALL', 'EAT', 'MOVE', 'MIND', 'SLEEP'].map((c, i) => (
                <Hit key={c} style={{ position: 'relative', paddingBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: i === 0 ? TEXT : MUTED }}>{c}</span>
                    {i === 0 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1.5, background: TEXT }} />}
                </Hit>
            ))}
        </Row>
        <div style={{ height: 1, background: BORDER, marginTop: -1 }} />
        {REWARDS.map((r, i) => (
            <Hit key={i} onClick={() => go('/redeem-modal')}
                style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12, opacity: r.locked ? 0.4 : 1 }}>
                <div style={{
                    width: 46, height: 46, borderRadius: 10, flexShrink: 0,
                    background: r.logo === 'NOTTO' || r.logo === 'WH' ? '#fff' : 'rgba(255,255,255,0.07)',
                    border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: r.logo === 'NOTTO' ? '#111' : TEXT }}>{r.logo}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, color: TEXT, display: 'block' }}>{r.title}</span>
                    <span style={{ fontSize: 10, color: MUTED }}>{r.sub}</span>
                </div>
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 999, padding: '6px 10px', flexShrink: 0 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: TEXT }}>{r.badge}</span>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, width: 42 }}>
                    <span style={{ fontSize: 17, fontWeight: 300, color: r.locked ? MUTED : GOLD, display: 'block' }}>{r.pts}</span>
                    <span style={{ fontSize: 7, letterSpacing: '0.15em', color: MUTED }}>PTS</span>
                </div>
            </Hit>
        ))}
    </Scroll>
);

const DiscoverScreen = ({ go }) => (
    <Scroll>
        <Header title="Discover" onBell={() => go('/notifications')} onAvatar={() => go('/profile-screen')} />
        <span style={{ fontSize: 11, color: DIM, padding: '0 16px', display: 'block' }}>Fitness partners near you</span>
        <div style={{ margin: '14px 16px 0', height: 210, borderRadius: 16, border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.03)', position: 'relative', overflow: 'hidden' }}>
            <svg width="100%" height="100%" viewBox="0 0 360 210" preserveAspectRatio="none">
                {[30, 70, 110, 150, 190].map((y) => <line key={y} x1="0" y1={y} x2="360" y2={y} stroke="rgba(255,255,255,0.06)" />)}
                {[60, 130, 200, 270].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="210" stroke="rgba(255,255,255,0.06)" />)}
                <circle cx="150" cy="105" r="9" fill={GOLD} fillOpacity="0.9" />
                <circle cx="150" cy="105" r="24" fill={GOLD} fillOpacity="0.12" />
                <circle cx="255" cy="70" r="6" fill="#34D399" fillOpacity="0.85" />
                <circle cx="85" cy="150" r="6" fill="#34D399" fillOpacity="0.85" />
            </svg>
            <div style={{ position: 'absolute', left: 12, bottom: 12, background: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: '6px 10px' }}>
                <span style={{ fontSize: 9, letterSpacing: '0.15em', color: TEXT }}>3 NEARBY</span>
            </div>
        </div>
        {['Third Space Soho', 'F45 Shoreditch', 'ONE LDN'].map((g, i) => (
            <Hit key={g} style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Svg d={ICON.map} size={17} color={GOLD} />
                <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, color: TEXT, display: 'block' }}>{g}</span>
                    <span style={{ fontSize: 10, color: MUTED }}>{(0.4 + i * 0.6).toFixed(1)} km away</span>
                </div>
                <Svg d={ICON.chevR} size={13} color={MUTED} />
            </Hit>
        ))}
    </Scroll>
);

const WalletScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Wallet" onBack={() => go('/rewards')} />
        <Row style={{ padding: '6px 16px 0', gap: 8 }}>
            {['Active', 'History'].map((t, i) => (
                <Hit key={t} style={{
                    flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 999,
                    background: i === 0 ? 'rgba(255,255,255,0.10)' : 'transparent',
                    border: `1px solid ${i === 0 ? 'transparent' : BORDER}`,
                }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: i === 0 ? TEXT : MUTED }}>{t}</span>
                </Hit>
            ))}
        </Row>
        <div style={{ padding: '18px 16px 0' }}>
            <Card>
                <Row style={{ gap: 12 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#111' }}>NOTTO</span>
                    </div>
                    <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 13, color: TEXT, display: 'block' }}>25% off your bill</span>
                        <span style={{ fontSize: 10, color: MUTED }}>Notto Pasta</span>
                    </div>
                </Row>
                <Hit style={{ marginTop: 14, borderRadius: 12, border: `1px dashed ${BORDER}`, padding: '12px 0', textAlign: 'center' }}>
                    <span style={{ fontSize: 8, letterSpacing: '0.25em', color: MUTED, display: 'block' }}>CODE</span>
                    <span style={{ fontSize: 19, fontWeight: 300, letterSpacing: '0.14em', color: TEXT, display: 'block', marginTop: 4 }}>NOTTO-A1B2C3</span>
                    <Row style={{ gap: 5, justifyContent: 'center', marginTop: 7 }}>
                        <Ion name="copy-outline" size={11} color={MUTED} />
                        <span style={{ fontSize: 9, color: MUTED }}>Tap to copy</span>
                    </Row>
                </Hit>
                <span style={{ fontSize: 10, color: MUTED, display: 'block', marginTop: 10, textAlign: 'center' }}>Expires in 26 days</span>
                <Row style={{ gap: 8, marginTop: 12 }}>
                    <Hit style={{ flex: 1, background: GOLD, borderRadius: 999, padding: '10px 0', textAlign: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#0a0a0a' }}>Use at Notto</span>
                    </Hit>
                    <Hit style={{ width: 46, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '10px 0', display: 'flex', justifyContent: 'center' }}>
                        <Svg d={ICON.share} size={14} color={DIM} />
                    </Hit>
                </Row>
            </Card>
        </div>
    </Scroll>
);

const VaultScreen = ({ go }) => (
    <Scroll>
        <Row style={{ padding: '10px 16px', justifyContent: 'space-between' }}>
            <Hit onClick={() => go('/rewards')}><Svg d={ICON.back} size={20} color={TEXT} /></Hit>
            <Hit><span style={{ fontSize: 15, color: DIM }}>ⓘ</span></Hit>
        </Row>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 40 }}>
            <div style={{ width: 150, height: 150, borderRadius: 20, border: `1px solid rgba(56,220,255,0.35)`, background: 'radial-gradient(circle at 50% 40%, rgba(56,220,255,0.16), rgba(0,0,0,0) 70%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Svg d={ICON.lock} size={44} color="#38DCFF" />
            </div>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.26em', color: '#38DCFF', marginTop: 26 }}>THE VAULT</span>
            <Row style={{ gap: 6, alignItems: 'baseline', marginTop: 12 }}>
                <span style={{ fontSize: 46, fontWeight: 200, color: TEXT, lineHeight: 1 }}>120</span>
                <span style={{ fontSize: 13, color: DIM }}>pts vesting</span>
            </Row>
            <span style={{ fontSize: 11, color: MUTED, marginTop: 12, textAlign: 'center', padding: '0 44px', lineHeight: 1.5 }}>
                Bonus POWR unlocks 60 days after you earn it. Keep training to add more.
            </span>
        </div>
    </Scroll>
);

const NotificationsScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Activity" onBack={() => go('/')} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 130 }}>
            <div style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Svg d={ICON.check} size={19} color={GOLD} />
            </div>
            <span style={{ fontSize: 15, color: TEXT, marginTop: 18 }}>You&apos;re all caught up</span>
            <span style={{ fontSize: 11, color: MUTED, marginTop: 8, textAlign: 'center', padding: '0 54px', lineHeight: 1.5 }}>
                Friend requests, challenge invites and your recent activity will show up here.
            </span>
        </div>
    </Scroll>
);

const ProfileScreen = ({ go }) => (
    <Scroll>
        <Row style={{ padding: '10px 16px', justifyContent: 'space-between' }}>
            <Hit onClick={() => go('/')}><Svg d={ICON.back} size={20} color={TEXT} /></Hit>
            <Hit onClick={() => go('/settings-screen')}><Svg d={ICON.gear} size={19} color={TEXT} /></Hit>
        </Row>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 14 }}>
            <div style={{ width: 82, height: 82, borderRadius: 41, background: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: '#0a0a0a' }}>Q</span>
            </div>
            <span style={{ fontSize: 21, fontWeight: 300, color: TEXT, marginTop: 14 }}>QA Screens</span>
            <span style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>@qascreens</span>
        </div>
        <Row style={{ padding: '24px 16px 0', gap: 10 }}>
            {[['415', 'POWR'], ['22', 'SESSIONS'], ['3', 'STREAK']].map(([v, l]) => (
                <Card key={l} style={{ flex: 1, textAlign: 'center', padding: '14px 6px' }}>
                    <span style={{ fontSize: 22, fontWeight: 300, color: TEXT, display: 'block' }}>{v}</span>
                    <span style={{ fontSize: 7, letterSpacing: '0.2em', color: MUTED }}>{l}</span>
                </Card>
            ))}
        </Row>
        <div style={{ padding: '20px 16px 0' }}>
            {[['Achievements', '/achievements'], ['Friends', '/friends'], ['My QR code', '/my-qr'], ['Points ledger', '/points-ledger']].map(([label, r]) => (
                <Hit key={label} onClick={() => go(r)} style={{ padding: '14px 0', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: TEXT, flex: 1 }}>{label}</span>
                    <Svg d={ICON.chevR} size={13} color={MUTED} />
                </Hit>
            ))}
        </div>
    </Scroll>
);

const SettingsScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Settings" onBack={() => go('/profile-screen')} />
        {[
            ['Account', [['Edit profile', '/edit-profile'], ['Change email', null], ['Change password', '/change-password']]],
            ['Tracking', [['Wearables', '/wearables'], ['Activity preferences', '/activity-preferences'], ['Home gym', null]]],
            ['App', [['Notifications', '/notifications'], ['Help centre', '/help-centre'], ['Privacy policy', null]]],
        ].map(([section, rows]) => (
            <div key={section} style={{ padding: '14px 16px 0' }}>
                <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.24em', color: MUTED }}>{section.toUpperCase()}</span>
                <div style={{ marginTop: 8 }}>
                    {rows.map(([label, target]) => (
                        <Hit key={label} onClick={target ? () => go(target) : undefined}
                            style={{ padding: '13px 0', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center' }}>
                            <span style={{ fontSize: 13, color: TEXT, flex: 1 }}>{label}</span>
                            <Svg d={ICON.chevR} size={13} color={MUTED} />
                        </Hit>
                    ))}
                </div>
            </div>
        ))}
    </Scroll>
);

const LedgerScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Points" onBack={() => go('/')} />
        {[
            ['Gym session', 'Third Space', '+20'],
            ['Daily steps', '10,412 steps', '+12'],
            ['Streak bonus', 'Week 3', '+25'],
            ['Redeemed', 'Notto Pasta', '-500'],
            ['Gym session', 'F45 Shoreditch', '+20'],
        ].map(([t, s, v], i) => (
            <Row key={i} style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, color: TEXT, display: 'block' }}>{t}</span>
                    <span style={{ fontSize: 10, color: MUTED }}>{s}</span>
                </div>
                <span style={{ fontSize: 15, fontWeight: 300, color: v.startsWith('-') ? '#F43F5E' : GOLD }}>{v}</span>
            </Row>
        ))}
    </Scroll>
);

const ManualLogScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Log a session" onBack={() => go('/')} />
        <Row style={{ padding: '10px 16px 0', gap: 8, flexWrap: 'wrap' }}>
            {['GYM', 'RUN', 'WALK', 'CYCLE', 'YOGA'].map((t, i) => (
                <Hit key={t} style={{
                    padding: '9px 14px', borderRadius: 999,
                    border: `1px solid ${i === 0 ? GOLD : BORDER}`,
                    background: i === 0 ? 'rgba(232,210,0,0.12)' : 'transparent',
                }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: i === 0 ? GOLD : MUTED }}>{t}</span>
                </Hit>
            ))}
        </Row>
        <div style={{ padding: '22px 16px 0' }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.24em', color: MUTED }}>DURATION</span>
            <Card style={{ marginTop: 10, textAlign: 'center', padding: '20px 0' }}>
                <span style={{ fontSize: 40, fontWeight: 200, color: TEXT }}>45</span>
                <span style={{ fontSize: 13, color: MUTED, marginLeft: 6 }}>min</span>
            </Card>
        </div>
        <div style={{ padding: '22px 16px 0' }}>
            <Hit style={{ background: GOLD, borderRadius: 999, padding: '15px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0a0a0a' }}>Log session · 15 pts</span>
            </Hit>
        </div>
    </Scroll>
);

// ── Remaining screens ────────────────────────────────────────────────────────

const LEVELS = [
    ['Touching Grass', 1, 500, true],
    ['Getting Warm', 2, 1200, true],
    ['Regular', 3, 2500, false],
    ['Committed', 4, 4500, false],
    ['Relentless', 5, 7000, false],
    ['Unstoppable', 6, 10000, false],
];

const AchievementsScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Levels" onBack={() => go('/profile-screen')} />
        <div style={{ padding: '10px 16px 0' }}>
            <Card style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 52, height: 52, borderRadius: 12, background: 'linear-gradient(135deg,#d8d8e8,#9aa0b5)' }} />
                <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 9, letterSpacing: '0.22em', color: MUTED, display: 'block' }}>CURRENT LEVEL</span>
                    <span style={{ fontSize: 19, color: TEXT, display: 'block', marginTop: 3 }}>Touching Grass</span>
                    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.10)', marginTop: 9 }}>
                        <div style={{ width: '72%', height: 3, borderRadius: 2, background: GOLD }} />
                    </div>
                    <span style={{ fontSize: 10, color: GOLD, display: 'block', marginTop: 6 }}>
                        85 <span style={{ color: MUTED }}>pts to Getting Warm</span>
                    </span>
                </div>
            </Card>
        </div>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.24em', color: MUTED, padding: '20px 16px 0', display: 'block' }}>ALL LEVELS</span>
        <div style={{ padding: '10px 16px 0' }}>
            {LEVELS.map(([name, lvl, pts, earned]) => (
                <Row key={lvl} style={{ padding: '12px 0', borderBottom: `1px solid ${BORDER}`, gap: 12, opacity: earned ? 1 : 0.45 }}>
                    <div style={{
                        width: 30, height: 30, borderRadius: 15, flexShrink: 0,
                        border: `1px solid ${earned ? GOLD : BORDER}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <span style={{ fontSize: 11, color: earned ? GOLD : MUTED }}>{lvl}</span>
                    </div>
                    <span style={{ fontSize: 13, color: TEXT, flex: 1 }}>{name}</span>
                    <span style={{ fontSize: 11, color: MUTED }}>{pts.toLocaleString()} pts</span>
                    {earned && <Svg d={ICON.check} size={13} color={GOLD} />}
                </Row>
            ))}
        </div>
    </Scroll>
);

const ChallengesScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Challenges" onBack={() => go('/')} />
        <Row style={{ padding: '6px 16px 0', gap: 8 }}>
            {['This week', 'Together'].map((t, i) => (
                <Hit key={t} onClick={() => i === 1 && go('/shared-challenge')} style={{
                    flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 999,
                    background: i === 0 ? 'rgba(255,255,255,0.10)' : 'transparent',
                    border: `1px solid ${i === 0 ? 'transparent' : BORDER}`,
                }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: i === 0 ? TEXT : MUTED }}>{t}</span>
                </Hit>
            ))}
        </Row>
        <div style={{ padding: '18px 16px 0' }}>
            {[
                ['Gym 3 times', 'Check in at any partner gym', 25, 0.33],
                ['Walk 50k steps', 'Across the week', 30, 0.2],
                ['Run 3 times', 'Any distance', 25, 0],
            ].map(([title, sub, pts, pct]) => (
                <Card key={title} style={{ marginBottom: 12 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 15, color: TEXT }}>{title}</span>
                        <Row style={{ gap: 3, alignItems: 'baseline' }}>
                            <span style={{ fontSize: 17, fontWeight: 300, color: GOLD }}>+{pts}</span>
                            <span style={{ fontSize: 8, color: MUTED }}>PTS</span>
                        </Row>
                    </Row>
                    <span style={{ fontSize: 11, color: DIM, display: 'block', marginTop: 4 }}>{sub}</span>
                    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.10)', marginTop: 12 }}>
                        <div style={{ width: `${pct * 100}%`, height: 3, borderRadius: 2, background: GOLD }} />
                    </div>
                </Card>
            ))}
        </div>
    </Scroll>
);

const SharedChallengeScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Together" onBack={() => go('/challenges')} />
        <div style={{ padding: '10px 16px 0' }}>
            <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                    <Svg d={ICON.dumbbell} size={18} color={TEXT} />
                    <Row style={{ gap: 3, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 20, fontWeight: 300, color: GOLD }}>+25</span>
                        <span style={{ fontSize: 9, color: MUTED }}>PTS EACH</span>
                    </Row>
                </Row>
                <span style={{ fontSize: 19, color: TEXT, display: 'block', marginTop: 16 }}>Back Again</span>
                <span style={{ fontSize: 11, color: DIM, display: 'block', marginTop: 4 }}>Check in on 7 different days</span>
                <Row style={{ gap: 8, marginTop: 14 }}>
                    <div style={{ border: `1px solid rgba(52,211,153,0.5)`, borderRadius: 999, padding: '4px 10px' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#34D399' }}>EASY</span>
                    </div>
                    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 999, padding: '4px 10px' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: DIM }}>1 week</span>
                    </div>
                </Row>
            </Card>
        </div>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.24em', color: MUTED, padding: '22px 16px 0', display: 'block' }}>WHO&apos;S IN · 3 / 4</span>
        <div style={{ padding: '12px 16px 0' }}>
            {[['JAMIE', '5 / 7', 0.71], ['Sorine', '4 / 7', 0.57], ['Noä', '2 / 7', 0.28]].map(([n, prog, pct]) => (
                <Row key={n} style={{ padding: '11px 0', borderBottom: `1px solid ${BORDER}`, gap: 11 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 15, background: 'rgba(255,255,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 11, color: TEXT }}>{n[0]}</span>
                    </div>
                    <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 12, color: TEXT, display: 'block', marginBottom: 5 }}>{n}</span>
                        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.10)' }}>
                            <div style={{ width: `${pct * 100}%`, height: 3, borderRadius: 2, background: GOLD }} />
                        </div>
                    </div>
                    <span style={{ fontSize: 11, color: GOLD }}>{prog}</span>
                </Row>
            ))}
        </div>
        <div style={{ padding: '20px 16px 0' }}>
            <Hit onClick={() => go('/add-friend')} style={{ border: `1px solid ${BORDER}`, borderRadius: 999, padding: '13px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>+ Invite a friend</span>
            </Hit>
        </div>
    </Scroll>
);

const FriendsScreen = ({ go }) => (
    <Scroll>
        <Row style={{ padding: '10px 16px', justifyContent: 'space-between' }}>
            <Row style={{ gap: 12 }}>
                <Hit onClick={() => go('/profile-screen')}><Svg d={ICON.back} size={20} color={TEXT} /></Hit>
                <span style={{ fontSize: 22, fontWeight: 200, color: TEXT }}>Friends</span>
            </Row>
            <Hit onClick={() => go('/add-friend')}><span style={{ fontSize: 20, color: GOLD }}>+</span></Hit>
        </Row>
        {[['Sorine', '2,410 pts'], ['Noä jansen', '1,180 pts'], ['Elliot', '860 pts']].map(([n, p]) => (
            <Row key={n} style={{ padding: '13px 16px', borderBottom: `1px solid ${BORDER}`, gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 18, background: 'rgba(255,255,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 13, color: TEXT }}>{n[0]}</span>
                </div>
                <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, color: TEXT, display: 'block' }}>{n}</span>
                    <span style={{ fontSize: 10, color: MUTED }}>{p}</span>
                </div>
                <Svg d={ICON.chevR} size={13} color={MUTED} />
            </Row>
        ))}
    </Scroll>
);

const AddFriendScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Add friend" onBack={() => go('/friends')} />
        <div style={{ padding: '10px 16px 0' }}>
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '13px 14px' }}>
                <span style={{ fontSize: 13, color: MUTED }}>Search by username</span>
            </div>
        </div>
        <Row style={{ padding: '20px 16px 0', gap: 10 }}>
            <Hit onClick={() => go('/my-qr')} style={{ flex: 1, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 22, color: GOLD, display: 'block' }}>▦</span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: TEXT, marginTop: 8, display: 'block' }}>My QR code</span>
            </Hit>
            <Hit style={{ flex: 1, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 22, color: GOLD, display: 'block' }}>⛶</span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: TEXT, marginTop: 8, display: 'block' }}>Scan a code</span>
            </Hit>
        </Row>
    </Scroll>
);

const MyQrScreen = ({ go }) => (
    <Scroll>
        <BackBar title="My code" onBack={() => go('/add-friend')} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 40 }}>
            <div style={{ width: 190, height: 190, background: '#fff', borderRadius: 18, padding: 14 }}>
                <svg width="162" height="162" viewBox="0 0 21 21" shapeRendering="crispEdges">
                    <rect width="21" height="21" fill="#fff" />
                    {Array.from({ length: 21 }).map((_, y) =>
                        Array.from({ length: 21 }).map((_, x) => {
                            const corner = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
                            const on = corner
                                ? (x % 6 === 0 || y % 6 === 0 || (x > 1 && x < 5 && y > 1 && y < 5))
                                : (x * 7 + y * 13) % 3 === 0;
                            return on ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0a0a0a" /> : null;
                        }),
                    )}
                </svg>
            </div>
            <span style={{ fontSize: 15, color: TEXT, marginTop: 22 }}>@qascreens</span>
            <span style={{ fontSize: 11, color: MUTED, marginTop: 8, textAlign: 'center', padding: '0 50px', lineHeight: 1.5 }}>
                Let a friend scan this to send you a friend request.
            </span>
        </div>
    </Scroll>
);

const RedeemScreen = ({ go }) => (
    <Scroll>
        <BackBar title="" onBack={() => go('/rewards')} />
        <div style={{ margin: '0 16px', height: 150, borderRadius: 16, background: 'linear-gradient(135deg,#2a2a2a,#111)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 14, bottom: 12 }}>
                <span style={{ fontSize: 20, color: TEXT }}>25% off your bill</span>
                <span style={{ fontSize: 11, color: DIM, display: 'block', marginTop: 3 }}>Notto Pasta · Any branch</span>
            </div>
        </div>
        <div style={{ padding: '20px 16px 0' }}>
            <Row style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: DIM }}>Your balance</span>
                <span style={{ fontSize: 11, color: TEXT }}>415 pts</span>
            </Row>
            <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
                <span style={{ fontSize: 11, color: DIM }}>This reward</span>
                <span style={{ fontSize: 11, color: GOLD }}>-500 pts</span>
            </Row>
            <div style={{ height: 1, background: BORDER, margin: '14px 0' }} />
            <Hit onClick={() => go('/wallet')} style={{ background: GOLD, borderRadius: 999, padding: '15px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0a0a0a' }}>Confirm Redemption</span>
            </Hit>
            <Hit onClick={() => go('/rewards')} style={{ padding: '14px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 12, color: DIM }}>Cancel</span>
            </Hit>
            <span style={{ fontSize: 10, color: MUTED, display: 'block', textAlign: 'center', lineHeight: 1.5 }}>
                Codes are single-use and valid for 30 days.
            </span>
        </div>
    </Scroll>
);

const ShareStatsScreen = ({ go }) => (
    <Scroll>
        <BackBar title="" onBack={() => go('/')} />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 16px 0' }}>
            <div style={{ width: 250, height: 330, borderRadius: 18, background: 'linear-gradient(160deg,#1e1e1e,#0a0a0a)', border: `1px solid ${BORDER}`, padding: 20, position: 'relative' }}>
                <span style={{ fontSize: 9, letterSpacing: '0.22em', color: GOLD }}>POWR</span>
                <span style={{ fontSize: 40, fontWeight: 200, color: TEXT, display: 'block', marginTop: 60 }}>3</span>
                <span style={{ fontSize: 13, color: DIM, display: 'block' }}>week streak</span>
                <span style={{ fontSize: 30, fontWeight: 200, color: GOLD, display: 'block', marginTop: 26 }}>415</span>
                <span style={{ fontSize: 11, color: DIM, display: 'block' }}>POWR earned</span>
            </div>
        </div>
        <Row style={{ padding: '20px 16px 0', gap: 10 }}>
            <Hit style={{ flex: 1, background: GOLD, borderRadius: 999, padding: '13px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0a0a0a' }}>Share</span>
            </Hit>
            <Hit style={{ flex: 1, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '13px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: DIM }}>Post</span>
            </Hit>
        </Row>
    </Scroll>
);

const ProgressDetailScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Gym" onBack={() => go('/progress')} />
        <div style={{ padding: '10px 16px 0' }}>
            <Row style={{ gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 44, fontWeight: 200, color: TEXT }}>4</span>
                <span style={{ fontSize: 13, color: DIM }}>sessions · 30 days</span>
            </Row>
        </div>
        <div style={{ padding: '20px 16px 0' }}>
            <Row style={{ alignItems: 'flex-end', gap: 5, height: 120 }}>
                {[40, 65, 30, 80, 55, 95, 70, 45, 85, 60, 35, 75].map((h, i) => (
                    <div key={i} style={{ flex: 1, height: `${h}%`, background: i === 5 ? GOLD : 'rgba(232,210,0,0.28)', borderRadius: '3px 3px 0 0' }} />
                ))}
            </Row>
            <div style={{ height: 1, background: BORDER, marginTop: 8 }} />
        </div>
        <div style={{ padding: '18px 16px 0' }}>
            {[['Third Space Soho', '52 min', '+20'], ['F45 Shoreditch', '48 min', '+20'], ['ONE LDN', '61 min', '+20']].map(([g, d, p]) => (
                <Row key={g} style={{ padding: '12px 0', borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 13, color: TEXT, display: 'block' }}>{g}</span>
                        <span style={{ fontSize: 10, color: MUTED }}>{d}</span>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 300, color: GOLD }}>{p}</span>
                </Row>
            ))}
        </div>
    </Scroll>
);

const EditProfileScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Edit profile" onBack={() => go('/settings-screen')} />
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 14 }}>
            <div style={{ position: 'relative' }}>
                <div style={{ width: 76, height: 76, borderRadius: 38, background: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 30, fontWeight: 700, color: '#0a0a0a' }}>Q</span>
                </div>
                <div style={{ position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, background: '#1a1a1a', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 12, color: TEXT }}>✎</span>
                </div>
            </div>
        </div>
        <div style={{ padding: '24px 16px 0' }}>
            {[['Display name', 'QA Screens'], ['Username', '@qascreens'], ['Bio', 'Add a short bio']].map(([l, v], i) => (
                <div key={l} style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.24em', color: MUTED }}>{l.toUpperCase()}</span>
                    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '13px 14px', marginTop: 7 }}>
                        <span style={{ fontSize: 13, color: i === 2 ? MUTED : TEXT }}>{v}</span>
                    </div>
                </div>
            ))}
            <Hit style={{ background: GOLD, borderRadius: 999, padding: '14px 0', textAlign: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0a0a0a' }}>Save</span>
            </Hit>
        </div>
    </Scroll>
);

const WearablesScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Wearables" onBack={() => go('/settings-screen')} />
        <span style={{ fontSize: 11, color: DIM, padding: '0 16px', display: 'block', lineHeight: 1.5 }}>
            Connect a tracker so sessions verify automatically.
        </span>
        <div style={{ padding: '16px 16px 0' }}>
            {[['Apple Health', true], ['Whoop', false], ['Garmin', false], ['Oura', false], ['Fitbit', false]].map(([n, on]) => (
                <Row key={n} style={{ padding: '14px 0', borderBottom: `1px solid ${BORDER}`, gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.07)', border: `1px solid ${BORDER}` }} />
                    <span style={{ fontSize: 13, color: TEXT, flex: 1 }}>{n}</span>
                    {on ? (
                        <Row style={{ gap: 5 }}>
                            <Svg d={ICON.check} size={12} color="#34D399" />
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#34D399' }}>Connected</span>
                        </Row>
                    ) : (
                        <span style={{ fontSize: 11, color: GOLD }}>Connect</span>
                    )}
                </Row>
            ))}
        </div>
    </Scroll>
);

const ActivityPrefsScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Activities" onBack={() => go('/settings-screen')} />
        <span style={{ fontSize: 11, color: DIM, padding: '0 16px', display: 'block', lineHeight: 1.5 }}>
            Pick what you train. Your goals and Progress follow these.
        </span>
        <Row style={{ padding: '18px 16px 0', gap: 9, flexWrap: 'wrap' }}>
            {[['GYM', true], ['RUN', true], ['WALK', true], ['CYCLE', false], ['SWIM', false], ['YOGA', false], ['HIIT', false], ['SPORTS', false]].map(([t, on]) => (
                <Hit key={t} style={{
                    padding: '10px 15px', borderRadius: 999,
                    border: `1px solid ${on ? GOLD : BORDER}`,
                    background: on ? 'rgba(232,210,0,0.12)' : 'transparent',
                }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: on ? GOLD : MUTED }}>{t}</span>
                </Hit>
            ))}
        </Row>
    </Scroll>
);

const ChangePasswordScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Password" onBack={() => go('/settings-screen')} />
        <div style={{ padding: '10px 16px 0' }}>
            {['Current password', 'New password', 'Confirm new password'].map((l) => (
                <div key={l} style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.24em', color: MUTED }}>{l.toUpperCase()}</span>
                    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '13px 14px', marginTop: 7 }}>
                        <span style={{ fontSize: 13, color: MUTED, letterSpacing: '0.2em' }}>••••••••</span>
                    </div>
                </div>
            ))}
            <Hit style={{ background: GOLD, borderRadius: 999, padding: '14px 0', textAlign: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0a0a0a' }}>Update password</span>
            </Hit>
        </div>
    </Scroll>
);

const HelpCentreScreen = ({ go }) => (
    <Scroll>
        <BackBar title="Help" onBack={() => go('/settings-screen')} />
        <div style={{ padding: '10px 16px 0' }}>
            {[
                'Why did my session not count?',
                'How do gym check-ins work?',
                'When do my points expire?',
                'What is the Vault?',
                'Connecting a wearable',
                'Contact support',
            ].map((q, i) => (
                <Row key={q} style={{ padding: '15px 0', borderBottom: `1px solid ${BORDER}` }}>
                    <span style={{ fontSize: 13, color: i === 5 ? GOLD : TEXT, flex: 1 }}>{q}</span>
                    <Svg d={ICON.chevR} size={13} color={MUTED} />
                </Row>
            ))}
        </div>
    </Scroll>
);

const OnboardingScreen = ({ go }) => (
    <Scroll>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 90 }}>
            <div style={{ width: 46, height: 34, background: TEXT, transform: 'skewX(-12deg)', clipPath: 'polygon(0 0,55% 0,100% 100%,45% 100%)' }} />
            <span style={{ fontSize: 30, fontWeight: 200, color: TEXT, marginTop: 40, textAlign: 'center', lineHeight: 1.25, padding: '0 30px' }}>
                Get paid to<br />move.
            </span>
            <span style={{ fontSize: 12, color: DIM, marginTop: 16, textAlign: 'center', padding: '0 44px', lineHeight: 1.55 }}>
                Earn POWR for every workout, then spend it with brands you actually want.
            </span>
        </div>
        <div style={{ padding: '80px 16px 0' }}>
            <Hit onClick={() => go('/auth-email')} style={{ background: GOLD, borderRadius: 999, padding: '15px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0a0a0a' }}>Get started</span>
            </Hit>
            <Hit onClick={() => go('/auth-email')} style={{ padding: '15px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 12, color: DIM }}>I already have an account</span>
            </Hit>
        </div>
    </Scroll>
);

const AuthEmailScreen = ({ go }) => (
    <Scroll>
        <BackBar title="" onBack={() => go('/onboarding')} />
        <div style={{ padding: '20px 16px 0' }}>
            <span style={{ fontSize: 26, fontWeight: 200, color: TEXT }}>Welcome back.</span>
            <div style={{ marginTop: 26 }}>
                <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.24em', color: MUTED }}>EMAIL</span>
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '13px 14px', marginTop: 7 }}>
                    <span style={{ fontSize: 13, color: MUTED }}>you@example.com</span>
                </div>
            </div>
            <div style={{ marginTop: 16 }}>
                <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.24em', color: MUTED }}>PASSWORD</span>
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '13px 14px', marginTop: 7 }}>
                    <span style={{ fontSize: 13, color: MUTED, letterSpacing: '0.2em' }}>••••••••</span>
                </div>
            </div>
            <Hit onClick={() => go('/')} style={{ background: GOLD, borderRadius: 999, padding: '15px 0', textAlign: 'center', marginTop: 24 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0a0a0a' }}>LOG IN</span>
            </Hit>
            <span style={{ fontSize: 11, color: DIM, display: 'block', textAlign: 'center', marginTop: 16 }}>Forgot your password?</span>
        </div>
    </Scroll>
);

const SCREENS = {
    '/': HomeScreen,
    '/progress': ProgressScreen,
    '/league': LeagueScreen,
    '/rewards': RewardsScreen,
    '/discover': DiscoverScreen,
    '/wallet': WalletScreen,
    '/vault': VaultScreen,
    '/notifications': NotificationsScreen,
    '/profile-screen': ProfileScreen,
    '/settings-screen': SettingsScreen,
    '/points-ledger': LedgerScreen,
    '/manual-log': ManualLogScreen,
    '/achievements': AchievementsScreen,
    '/challenges': ChallengesScreen,
    '/shared-challenge': SharedChallengeScreen,
    '/friends': FriendsScreen,
    '/add-friend': AddFriendScreen,
    '/my-qr': MyQrScreen,
    '/redeem-modal': RedeemScreen,
    '/share-stats': ShareStatsScreen,
    '/progress-detail': ProgressDetailScreen,
    '/edit-profile': EditProfileScreen,
    '/wearables': WearablesScreen,
    '/activity-preferences': ActivityPrefsScreen,
    '/change-password': ChangePasswordScreen,
    '/help-centre': HelpCentreScreen,
    '/onboarding': OnboardingScreen,
    '/auth-email': AuthEmailScreen,
};

/**
 * @param route    the route to display
 * @param onNavigate(route)  fired when something inside the phone is clicked
 * @param overlay  rendered above the screen (the heat canvas)
 * @param scale    uniform CSS scale for the whole device
 */
export default function AppPreview({ route = '/', onNavigate, overlay, scale = 1, exportRef }) {
    const Screen = SCREENS[route];
    const go = (r) => { if (onNavigate) onNavigate(r); };

    const PHONE_W = DEVICE_W + BEZEL * 2;
    const PHONE_H = DEVICE_H + BEZEL * 2;

    return (
        <div style={{ width: PHONE_W * scale, height: PHONE_H * scale, position: 'relative', fontFamily: FONT }}>
            <style>{`
                @font-face { font-family: 'PreviewIonicons'; src: url('/Ionicons.ttf') format('truetype'); font-display: block; }
                .powr-prev-scroll::-webkit-scrollbar{display:none;}
            `}</style>
            <div style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
                <div style={{ width: PHONE_W, height: PHONE_H, background: '#0a0a0a', borderRadius: 56, padding: BEZEL, boxShadow: '0 40px 90px rgba(0,0,0,0.45)' }}>
                    {/* exportRef deliberately lands HERE, on the screen itself,
                        and not on the phone or the wrapper around it. Those
                        outer elements carry the CSS scale that fits the preview
                        into its column, and rasterising a transformed subtree is
                        what html-to-image gets wrong — exporting the wrapper
                        returned a bare background polygon with the entire screen
                        missing, while the screen node on its own exports
                        perfectly. */}
                    <div ref={exportRef} style={{ position: 'relative', width: DEVICE_W, height: DEVICE_H, borderRadius: 44, overflow: 'hidden', background: '#060606' }}>
                        <PreviewBackground />
                        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 120, height: 34, background: '#000', borderRadius: 18, zIndex: 5 }} />
                        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 140, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.45)', zIndex: 6 }} />

                        {/* Explicit pixel height, not 100%. A percentage height
                            resolves against a parent that has no definite height
                            once this subtree is serialised into an SVG
                            foreignObject for the PNG export, so the whole column
                            collapsed to zero and the export came back as nothing
                            but the background polygon. */}
                        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: DEVICE_H }}>
                            <StatusBar />
                            {Screen ? <Screen go={go} /> : (
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30 }}>
                                    <span style={{ fontSize: 11, color: MUTED, textAlign: 'center', letterSpacing: '0.15em' }}>
                                        {route}<br />not recreated in the preview yet
                                    </span>
                                </div>
                            )}
                            {TAB_ROUTES.includes(route) && <NavBar route={route} go={go} />}
                        </div>

                        {/* Heat sits above the UI but must not eat the clicks that
                            make the preview navigable. */}
                        {overlay && (
                            <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>{overlay}</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
