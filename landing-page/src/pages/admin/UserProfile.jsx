import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { fetchAllRows } from '../../lib/fetchAll';
import { usePagedList, Pager } from '../../lib/usePagedList';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { levelFromEarned } from '../../lib/levels';
import { formatMemberId, normalizeMemberId } from '../../../../shared/memberId.ts';
import {
    Lock,
    User, Activity, Award, Calendar, Clock, MapPin,
    ChevronLeft, TrendingUp, Zap, Shield, AlertCircle,
    ArrowUpRight, ArrowDownRight, Gift, Plus, X,
    Heart, Moon, Flame, Footprints, Star, Trash2,
    Camera, ImagePlus, Trophy, Check, Link2, RefreshCw, Pencil, Copy,
    Smartphone, Bell,
    Dumbbell, Bike, Waves, Wind, PersonStanding, Music
} from 'lucide-react';

const MIN_USERNAME = 3;
const MAX_USERNAME = 20;
const normalizeUsername = (raw) => raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, MAX_USERNAME);

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

// Live location-permission snapshot (profiles.location_permission, reported by
// newer clients on every launch/foreground). NULL = build predates the
// telemetry — fall back to the legacy write-once onboarding-bonus flag
// (location_granted), which can't see later grants/revokes.
const LOCATION_STATES = {
    always:       { chip: 'Location Always',      detail: 'Always',           cls: 'bg-[#10B981]/10 border border-[#10B981]/20 text-[#10B981]' },
    while_using:  { chip: 'Location While Using', detail: 'While Using only', cls: 'bg-[#F59E0B]/10 border border-[#F59E0B]/25 text-[#B45309]' },
    denied:       { chip: 'Location Off',         detail: 'Denied',           cls: 'bg-red-500/10 border border-red-500/20 text-red-500' },
    undetermined: { chip: 'Location Not Asked',   detail: 'Never asked',      cls: 'bg-[#EFEFEC] text-[#999999]' },
};

// push_send_log status → chip styling + what it actually proves. 'accepted'
// deliberately reads "Accepted by APNs/FCM", not "delivered": the platform
// taking the push is where server-side visibility ends (a device can still
// fail to display it — that gap is the open iOS incident).
const PUSH_STATES = {
    accepted: { label: 'Accepted',  cls: 'border-[#10B981]/20 text-[#10B981]' },
    queued:   { label: 'Queued',    cls: 'border-[#F59E0B]/25 text-[#B45309]' },
    rejected: { label: 'Rejected',  cls: 'border-red-500/20 text-red-500' },
    failed:   { label: 'Failed',    cls: 'border-red-500/20 text-red-500' },
    skipped:  { label: 'Skipped',   cls: 'border-[#E6E6E1] text-[#999999]' },
};

// gym_visit_events → how a visit actually unfolded on the device. 'confirmed_inside'
// is the device proving, with a real GPS fix, that it was still at the gym — the only
// thing that unlocks a claim. The server never credits on a timer.
const VISIT_EVENT_STYLES = {
    check_in:          { label: 'Checked in',        cls: 'text-[#10B981]' },
    nudge_sent:        { label: 'Server woke device', cls: 'text-[#8a7600]' },
    confirmed_inside:  { label: 'Confirmed inside',   cls: 'text-[#10B981]' },
    confirmed_outside: { label: 'Confirmed outside',  cls: 'text-[#B45309]' },
    claimed:           { label: 'Points claimed',     cls: 'text-[#10B981]' },
    upgraded:          { label: 'Bonus upgraded',     cls: 'text-[#10B981]' },
    exit:              { label: 'Exit',               cls: 'text-[#666666]' },
    nudge_failed:      { label: 'Wake failed',        cls: 'text-red-500' },
    abandoned:         { label: 'Abandoned',          cls: 'text-red-500' },
};

const VISIT_STATUS_CLS = {
    open:      'border-[#F59E0B]/25 text-[#B45309]',
    claimed:   'border-[#10B981]/20 text-[#10B981]',
    upgraded:  'border-[#10B981]/20 text-[#10B981]',
    closed:    'border-[#E6E6E1] text-[#666666]',
    abandoned: 'border-red-500/20 text-red-500',
};

const clockTime = (dateStr) =>
    new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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

// raw_gps.partnerId is NOT always a bare partner uuid. Older client rows store the
// composite geofence key `<uuid>-<locationIdx>` (21 prod rows), which is not a valid uuid
// and will 22P02 the whole partners lookup if passed to .in() unfiltered. Take the uuid
// prefix; anything that still isn't a uuid resolves to nothing rather than poisoning the
// query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const sessionPartnerId = (session) => {
    if (session.partner_id) return session.partner_id;
    const raw = session.raw_gps?.partnerId;
    return typeof raw === 'string' ? (raw.match(UUID_RE)?.[0] ?? null) : null;
};

// The two gym writers disagree about raw_gps: the client (GeofenceContext) stamps
// partnerName, the confirm_gym_visit_v2 RPC never has. Both set partner_id, so resolve the
// live partner first and keep the name snapshot as the last resort — same precedence as
// lib/api/share.ts. The snapshot is not dead weight (9 rows point at a since-deleted
// partner and have nothing else) but it is not trustworthy either: one venue is stamped
// "Jamie" on rows whose partner is really "POWR". Live name wins wherever there is one.
const venueName = (session, partnerMap) => {
    const partner = partnerMap[sessionPartnerId(session)];
    if (partner) return partner.name;
    return session.raw_gps?.partnerName || null;
};

// Every activity_sessions.type in prod. A geofence gym row prefers the venue's own logo
// (see the row render); this is the fallback and what every other type gets.
const ACTIVITY_ICONS = {
    gym:      Dumbbell,
    walking:  Footprints,
    running:  Wind,
    cycling:  Bike,
    swimming: Waves,
    sleep:    Moon,
    hiit:     Flame,
    yoga:     PersonStanding,
    sports:   Trophy,
    dance:    Music,
};

export default function UserProfile() {
    const { userId } = useParams();
    const toast = useToast();
    const navigate = useNavigate();
    const { user: adminUser } = useAuth();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [streak, setStreak] = useState(null);
    const [redemptions, setRedemptions] = useState([]);
    // The health tab's summary cards and its snapshot log want different data: the cards
    // need a complete recent window, the log needs deep history a page at a time. Reading
    // both off one capped fetch made the cards depend on how densely the user syncs.
    const [healthSummary, setHealthSummary] = useState(null);
    const [showAdjust, setShowAdjust] = useState(false);
    const [showVaultGrant, setShowVaultGrant] = useState(false);
    const [vgAmount, setVgAmount] = useState('');
    const [vgDays, setVgDays] = useState('');
    const [vgNote, setVgNote] = useState('');
    const [vgLoading, setVgLoading] = useState(false);
    const [vgNotify, setVgNotify] = useState(true);
    const [vaultDeposits, setVaultDeposits] = useState([]);
    const [adjAmount, setAdjAmount] = useState('');
    const [adjDesc, setAdjDesc] = useState('');
    const [adjLoading, setAdjLoading] = useState(false);
    const [proLoading, setProLoading] = useState(false);
    const [editingUsername, setEditingUsername] = useState(false);
    const [usernameEdit, setUsernameEdit] = useState('');
    const [usernameSaving, setUsernameSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deviceBindings, setDeviceBindings] = useState([]);
    const [deviceTransfers, setDeviceTransfers] = useState([]);
    const [deviceReleasing, setDeviceReleasing] = useState(false);
    const [pushTokens, setPushTokens] = useState([]);
    const [gymVisits, setGymVisits] = useState([]);
    const [visitEvents, setVisitEvents] = useState([]);
    const [activeTab, setActiveTab] = useState('activity');
    const [visibleSessions, setVisibleSessions] = useState(10);
    const [visibleTransactions, setVisibleTransactions] = useState(10);

    // Pro profile
    const [bioEdit, setBioEdit] = useState('');
    const [bioSaving, setBioSaving] = useState(false);
    const [adminGallery, setAdminGallery] = useState([]);
    const [adminGalleryLoading, setAdminGalleryLoading] = useState(false);
    const [galleryDeleting, setGalleryDeleting] = useState(null);
    const [galleryUploading, setGalleryUploading] = useState(false);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [coverUploading, setCoverUploading] = useState(false);
    const [coverDeleting, setCoverDeleting] = useState(false);

    // Athlete invite
    const [athleteInvite, setAthleteInvite] = useState(null);
    const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
    const [inviteRegenerating, setInviteRegenerating] = useState(false);

    // Achievements
    const [achievements, setAchievements] = useState([]);
    const [achievementsLoading, setAchievementsLoading] = useState(false);
    const [editingAchId, setEditingAchId] = useState(null); // 'new' for new row, id for existing
    const [achForm, setAchForm] = useState({ title: '', value: '', context: '' });
    const [achSaving, setAchSaving] = useState(false);
    const [achDeleting, setAchDeleting] = useState(null);

    const [activityDateFilter, setActivityDateFilter] = useState('');
    const [activityTypeFilter, setActivityTypeFilter] = useState('');
    const [activityVerificationFilter, setActivityVerificationFilter] = useState('');
    
    const [pointsDateFilter, setPointsDateFilter] = useState('');
    const [pointsTypeFilter, setPointsTypeFilter] = useState('');
    const [pointsSearchFilter, setPointsSearchFilter] = useState('');

    const [preferredGym, setPreferredGym] = useState(null);
    const [partnerMap, setPartnerMap] = useState({});
    const [userEmail, setUserEmail] = useState(null);
    const [memberIdCopied, setMemberIdCopied] = useState(false);

    // The two deep logs. Both run to thousands of rows for an active user, and neither
    // feeds a total elsewhere on the page, so each is served a page at a time with the
    // server's exact count beside it.
    const pushLog = usePagedList(
        () => supabase
            .from('push_send_log')
            .select('id, type, title, body, status, skip_reason, error, receipt_checked_at, created_at', { count: 'exact' })
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false }),
        [userId],
        { pageSize: 15 }
    );

    const healthLog = usePagedList(
        () => supabase
            .from('health_snapshots')
            .select('*', { count: 'exact' })
            .eq('user_id', userId)
            .order('recorded_at', { ascending: false })
            .order('id', { ascending: false }),
        [userId],
        { pageSize: 20 }
    );

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

    // Points earned per session, summed from the ledger (a session can have >1 row).
    const sessionPoints = transactions.reduce((m, t) => {
        if (t.session_id) m[t.session_id] = (m[t.session_id] || 0) + t.amount;
        return m;
    }, {});

    const handleTogglePro = async () => {
        if (proLoading) return;
        setProLoading(true);
        const newValue = !profile.is_pro;
        const { error } = await supabase
            .from('profiles')
            .update({ is_pro: newValue })
            .eq('id', userId);
        if (error) {
            toast.error(error.message);
            setProLoading(false);
            return;
        }
        await logAction(adminUser.id, newValue ? 'grant_pro' : 'revoke_pro', 'user', userId, {});
        setProfile(prev => ({ ...prev, is_pro: newValue }));
        toast.success(newValue ? 'Pro status granted' : 'Pro status revoked');
        setProLoading(false);
    };

    const startEditUsername = () => {
        setUsernameEdit(profile?.username || '');
        setEditingUsername(true);
    };

    const handleSaveUsername = async () => {
        const next = normalizeUsername(usernameEdit);
        if (next === (profile.username || '')) { setEditingUsername(false); return; }
        if (next.length < MIN_USERNAME) {
            toast.error(`Username must be at least ${MIN_USERNAME} characters`);
            return;
        }
        setUsernameSaving(true);
        // Uniqueness pre-check (the DB unique constraint is the authoritative backstop).
        const { data: existing, error: checkErr } = await supabase
            .from('profiles').select('id').eq('username', next).neq('id', userId).limit(1).maybeSingle();
        if (checkErr) { toast.error(checkErr.message); setUsernameSaving(false); return; }
        if (existing) { toast.error('That username is already taken'); setUsernameSaving(false); return; }
        const { error } = await supabase.from('profiles').update({ username: next }).eq('id', userId);
        if (error) {
            toast.error(error.code === '23505' ? 'That username is already taken' : error.message);
            setUsernameSaving(false);
            return;
        }
        await logAction(adminUser.id, 'update_username', 'user', userId, { from: profile.username || null, to: next });
        setProfile(prev => ({ ...prev, username: next }));
        toast.success('Username updated');
        setEditingUsername(false);
        setUsernameSaving(false);
    };

    const handleDeleteUser = async () => {
        setDeleteLoading(true);
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
            `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/admin-manage-user`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({ action: 'delete', user_id: userId }),
            }
        );
        const result = await res.json();
        setDeleteLoading(false);
        if (result.error) { toast.error(result.error); return; }
        toast.success('User deleted');
        navigate('/admin/users');
    };

    const handleReleaseDevices = async () => {
        setDeviceReleasing(true);
        const { data, error } = await supabase.rpc('admin_release_user_devices', { p_user_id: userId });
        setDeviceReleasing(false);
        if (error) { toast.error(error.message); return; }
        await logAction(adminUser.id, 'release_device_lock', 'user', userId, { released: data ?? 0 });
        setDeviceBindings([]);
        toast.success(data > 0 ? `Released ${data} device${data === 1 ? '' : 's'}` : 'No device was locked');
    };

    const handleVaultGrant = async () => {
        const amt = parseInt(vgAmount, 10);
        if (!Number.isFinite(amt) || amt < 1) { toast.error('Enter a valid amount'); return; }
        // Strict digits only — `parseInt || 0` turned junk into 0, and 0 means
        // READY INSTANTLY here. A typo must be an error, not a payout.
        const rawVest = vgDays.trim();
        if (rawVest !== '' && !/^\d+$/.test(rawVest)) {
            toast.error('Vest days must be a whole number — 0 releases instantly, blank uses the default');
            return;
        }
        const vestDays = rawVest === '' ? null : parseInt(rawVest, 10);
        setVgLoading(true);
        const { data, error } = await supabase.rpc('admin_grant_vault_deposit', {
            p_amount: amt, p_user_ids: [userId], p_note: vgNote || null, p_vest_days: vestDays,
            p_notify: vgNotify,
        });
        if (error) { toast.error(error.message); setVgLoading(false); return; }
        await logAction(adminUser.id, 'vault_grant', 'user', userId, {
            amount: amt, vest_days: data?.vest_days, note: vgNote, notify: vgNotify, batch_id: data?.batch_id,
        });
        // Say what is knowable about the push, not a blanket "push sent": the
        // vault_granted kill-switch (pre-launch hold) silently drops it, and so
        // does the rollout gate when this user cannot see a Vault yet.
        let pushNote = '';
        if (vgNotify) {
            const [{ data: notifCfg }, { data: inRollout }] = await Promise.all([
                supabase.from('notification_config').select('enabled').eq('type', 'vault_granted').maybeSingle(),
                supabase.rpc('vault_has_access', { p_user: userId }),
            ]);
            pushNote = notifCfg?.enabled === false
                ? ' · push HELD (vault_granted is disabled in Notifications)'
                : inRollout === false
                    ? ' · no push (user outside the Vault rollout)'
                    : ' · push sent';
        }
        toast.success(`+${amt} POWR banked in the Vault · vests in ${data?.vest_days} day(s)${pushNote}`);
        setShowVaultGrant(false); setVgAmount(''); setVgDays(''); setVgNote(''); setVgNotify(true); setVgLoading(false);
        fetchData();
    };

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

    // /admin/users/<POWR ID> is a valid address too — staff at an event type
    // the 8 chars off a member's screen and land on the profile. Resolve the
    // code to the uuid and swap the URL so every link on the page stays uuid-keyed.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    useEffect(() => {
        if (!userId) return;
        if (UUID_RE.test(userId)) { fetchData(); return; }
        const code = normalizeMemberId(userId);
        let cancelled = false;
        (async () => {
            const { data, error } = code
                ? await supabase.from('profiles').select('id').eq('referral_code', code).maybeSingle()
                : { data: null, error: null };
            if (cancelled) return;
            if (error) { toast.error(error.message); setLoading(false); return; }
            if (!data) { toast.error(`No member with POWR ID ${formatMemberId(code) || userId}`); navigate('/admin/users', { replace: true }); return; }
            navigate(`/admin/users/${data.id}`, { replace: true });
        })();
        return () => { cancelled = true; };
    }, [userId]);

    useEffect(() => {
        if (activeTab === 'pro' && userId) {
            fetchAdminGallery();
            fetchAchievements();
            fetchAthleteInvite();
        }
    }, [activeTab, userId]);

    const fetchAthleteInvite = async () => {
        const { data } = await supabase
            .from('athlete_applications')
            .select('id, invite_token, status, submitted_at')
            .eq('profile_id', userId)
            .maybeSingle();
        setAthleteInvite(data || null);
    };

    const handleRegenerateInvite = async () => {
        if (!athleteInvite) return;
        setInviteRegenerating(true);
        const newToken = crypto.randomUUID();
        const { error } = await supabase
            .from('athlete_applications')
            .update({ invite_token: newToken, status: 'invited' })
            .eq('id', athleteInvite.id);
        if (error) { toast.error(error.message); setInviteRegenerating(false); return; }
        setAthleteInvite(prev => ({ ...prev, invite_token: newToken, status: 'invited' }));
        toast.success('New invite link generated');
        setInviteRegenerating(false);
    };

    const handleCopyInviteLink = () => {
        if (!athleteInvite) return;
        const link = `${window.location.origin}/athlete/${athleteInvite.invite_token}`;
        navigator.clipboard.writeText(link).then(() => {
            setInviteLinkCopied(true);
            setTimeout(() => setInviteLinkCopied(false), 2000);
        });
    };

    const handleGenerateInvite = async () => {
        setInviteRegenerating(true);
        const token = crypto.randomUUID();
        const { data, error } = await supabase
            .from('athlete_applications')
            .insert({
                email: '',
                display_name: profile.display_name || profile.username || '',
                invite_token: token,
                status: 'invited',
                activity_preferences: [],
                achievements: [],
                gallery_urls: [],
                profile_id: userId,
            })
            .select('id, invite_token, status, submitted_at')
            .single();
        if (error) { toast.error(error.message); setInviteRegenerating(false); return; }
        setAthleteInvite(data);
        toast.success('Invite link generated');
        setInviteRegenerating(false);
    };

    const fetchAchievements = async () => {
        setAchievementsLoading(true);
        const { data } = await supabase
            .from('pro_achievements')
            .select('*')
            .eq('user_id', userId)
            .order('display_order', { ascending: true });
        setAchievements(data || []);
        setAchievementsLoading(false);
    };

    const startEditAchievement = (a) => {
        setEditingAchId(a.id);
        setAchForm({ title: a.title, value: a.value, context: a.context ?? '' });
    };

    const startNewAchievement = () => {
        setEditingAchId('new');
        setAchForm({ title: '', value: '', context: '' });
    };

    const cancelEditAchievement = () => {
        setEditingAchId(null);
        setAchForm({ title: '', value: '', context: '' });
    };

    const saveAchievement = async () => {
        if (!achForm.title.trim() || !achForm.value.trim()) {
            toast.error('Title and value are required');
            return;
        }
        setAchSaving(true);
        if (editingAchId === 'new') {
            const nextOrder = (achievements[achievements.length - 1]?.display_order ?? -1) + 1;
            const { data, error } = await supabase
                .from('pro_achievements')
                .insert({
                    user_id: userId,
                    title: achForm.title.trim(),
                    value: achForm.value.trim(),
                    context: achForm.context.trim() || null,
                    display_order: nextOrder,
                })
                .select().single();
            if (error) { toast.error(error.message); setAchSaving(false); return; }
            await logAction(adminUser.id, 'create_achievement', 'user', userId, { title: data.title });
            setAchievements(prev => [...prev, data]);
            toast.success('Achievement added');
        } else {
            const { error } = await supabase
                .from('pro_achievements')
                .update({
                    title: achForm.title.trim(),
                    value: achForm.value.trim(),
                    context: achForm.context.trim() || null,
                })
                .eq('id', editingAchId);
            if (error) { toast.error(error.message); setAchSaving(false); return; }
            await logAction(adminUser.id, 'update_achievement', 'user', userId, { id: editingAchId });
            setAchievements(prev => prev.map(a =>
                a.id === editingAchId
                    ? { ...a, title: achForm.title.trim(), value: achForm.value.trim(), context: achForm.context.trim() || null }
                    : a
            ));
            toast.success('Achievement updated');
        }
        setAchSaving(false);
        cancelEditAchievement();
    };

    const deleteAchievement = async (id) => {
        setAchDeleting(id);
        const { error } = await supabase.from('pro_achievements').delete().eq('id', id);
        if (error) { toast.error(error.message); setAchDeleting(null); return; }
        await logAction(adminUser.id, 'delete_achievement', 'user', userId, { id });
        setAchievements(prev => prev.filter(a => a.id !== id));
        setAchDeleting(null);
    };

    const fetchAdminGallery = async () => {
        setAdminGalleryLoading(true);
        const { data } = await supabase
            .from('pro_gallery_photos')
            .select('*')
            .eq('user_id', userId)
            .order('display_order', { ascending: true });
        setAdminGallery(data || []);
        setAdminGalleryLoading(false);
    };

    const handleSaveBio = async () => {
        setBioSaving(true);
        const { error } = await supabase
            .from('profiles')
            .update({ bio: bioEdit.trim() || null })
            .eq('id', userId);
        if (error) { toast.error(error.message); }
        else {
            setProfile(prev => ({ ...prev, bio: bioEdit.trim() || null }));
            toast.success('Bio saved');
        }
        setBioSaving(false);
    };

    const handleAdminGalleryDelete = async (photo) => {
        setGalleryDeleting(photo.id);
        const storagePath = photo.url.split('/gallery/').pop();
        if (storagePath) await supabase.storage.from('gallery').remove([storagePath]);
        await supabase.from('pro_gallery_photos').delete().eq('id', photo.id);
        setAdminGallery(prev => prev.filter(p => p.id !== photo.id));
        setGalleryDeleting(null);
        toast.success('Photo removed');
    };

    const handleAvatarUpload = async (file) => {
        if (!file) return;
        setAvatarUploading(true);
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${userId}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
            .from('avatars').upload(path, file, { contentType: file.type, upsert: true });
        if (uploadError) { toast.error(uploadError.message); setAvatarUploading(false); return; }
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        const publicUrl = urlData.publicUrl;
        const { error: updateError } = await supabase
            .from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
        if (updateError) { toast.error(updateError.message); setAvatarUploading(false); return; }
        await logAction(adminUser.id, 'update_avatar', 'user', userId, { url: publicUrl });
        setProfile(prev => ({ ...prev, avatar_url: publicUrl }));
        toast.success('Avatar updated');
        setAvatarUploading(false);
    };

    const handleCoverUpload = async (file) => {
        if (!file) return;
        setCoverUploading(true);
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${userId}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
            .from('covers').upload(path, file, { contentType: file.type, upsert: true });
        if (uploadError) { toast.error(uploadError.message); setCoverUploading(false); return; }
        const { data: urlData } = supabase.storage.from('covers').getPublicUrl(path);
        const publicUrl = urlData.publicUrl;
        const { error: updateError } = await supabase
            .from('profiles').update({ cover_url: publicUrl }).eq('id', userId);
        if (updateError) { toast.error(updateError.message); setCoverUploading(false); return; }
        await logAction(adminUser.id, 'update_cover', 'user', userId, { url: publicUrl });
        setProfile(prev => ({ ...prev, cover_url: publicUrl }));
        toast.success('Cover photo updated');
        setCoverUploading(false);
    };

    const handleCoverRemove = async () => {
        if (!profile?.cover_url) return;
        setCoverDeleting(true);
        const storagePath = profile.cover_url.split('/covers/').pop();
        if (storagePath) await supabase.storage.from('covers').remove([storagePath]);
        const { error } = await supabase
            .from('profiles').update({ cover_url: null }).eq('id', userId);
        if (error) { toast.error(error.message); setCoverDeleting(false); return; }
        await logAction(adminUser.id, 'remove_cover', 'user', userId, {});
        setProfile(prev => ({ ...prev, cover_url: null }));
        toast.success('Cover photo removed');
        setCoverDeleting(false);
    };

    const handleAdminGalleryUpload = async (file) => {
        if (adminGallery.length >= 6) { toast.error('Gallery full (max 6 photos)'); return; }
        setGalleryUploading(true);
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${userId}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
            .from('gallery').upload(path, file, { contentType: file.type });
        if (uploadError) { toast.error(uploadError.message); setGalleryUploading(false); return; }
        const { data: urlData } = supabase.storage.from('gallery').getPublicUrl(path);
        const nextOrder = (adminGallery[adminGallery.length - 1]?.display_order ?? -1) + 1;
        const { data: row, error: insertError } = await supabase
            .from('pro_gallery_photos')
            .insert({ user_id: userId, url: urlData.publicUrl, display_order: nextOrder })
            .select().single();
        if (insertError) { toast.error(insertError.message); }
        else { setAdminGallery(prev => [...prev, row]); toast.success('Photo uploaded'); }
        setGalleryUploading(false);
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            // Sessions, ledger and redemptions are read in full rather than capped: the
            // page totals its points from them, counts them in the header stats, and runs
            // its filters over them in the browser, so a partial read is a wrong number
            // and a filter that finds nothing. They page under the hood, so this stays
            // correct as a user's history grows past the server's row cap.
            const [p, s, t, str, r, vd] = await Promise.all([
                supabase.from('profiles').select('*').eq('id', userId).single(),
                fetchAllRows(() => supabase.from('activity_sessions').select('*').eq('user_id', userId)),
                fetchAllRows(() => supabase.from('point_transactions').select('*').eq('user_id', userId)),
                supabase.from('user_streaks').select('*').eq('user_id', userId).single(),
                fetchAllRows(() => supabase.from('redemptions').select('*, rewards(*)').eq('user_id', userId)),
                fetchAllRows(() => supabase.from('vault_deposits').select('amount, vests_at, released_at').eq('user_id', userId)),
            ]);

            if (p.error) throw p.error;
            setProfile(p.data);
            setBioEdit(p.data.bio ?? '');
            // fetchAllRows sorts by id to page safely; restore the display order here.
            setSessions(s.sort((a, b) => new Date(b.started_at) - new Date(a.started_at)));
            setTransactions(t.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
            setStreak(str.data || null);
            setRedemptions(r.sort((a, b) => new Date(b.redeemed_at) - new Date(a.redeemed_at)));
            setVaultDeposits(vd);

            // Venue names for the activity rows. One batched lookup keyed on every partner
            // this user's sessions reference, so a row created by the server RPC (which
            // stores no partnerName) still renders its gym.
            const partnerIds = [...new Set(s.map(sessionPartnerId).filter(Boolean))];
            if (partnerIds.length > 0) {
                const { data: partnerRows } = await supabase
                    .from('partners').select('id, name, logo_url').in('id', partnerIds);
                setPartnerMap(Object.fromEntries((partnerRows || []).map(p => [p.id, p])));
            } else {
                setPartnerMap({});
            }

            // Fetch email (lives in auth.users, not profiles)
            const { data: emailData } = await supabase.rpc('admin_get_user_email', { p_user_id: userId });
            setUserEmail(emailData || null);

            // Device lock: which physical device(s) are bound to this account.
            const { data: devData } = await supabase.rpc('admin_get_user_devices', { p_user_id: userId });
            setDeviceBindings(devData || []);

            // Recent self-serve device transfers — spot abuse of the auto/confirm
            // transfer path (many moves = possible rotating-device farm).
            const { data: xferData } = await supabase.rpc('admin_get_user_device_transfers', { p_user_id: userId, p_limit: 10 });
            setDeviceTransfers(xferData || []);

            // App version per device, reported with the push-token upsert on
            // every launch. NULL app_version = a build predating the telemetry.
            const { data: tokenData } = await supabase
                .from('user_push_tokens')
                .select('platform, app_version, app_build, ota_update_id, ota_channel, updated_at')
                .eq('user_id', userId)
                .order('updated_at', { ascending: false });
            setPushTokens(tokenData || []);

            // The push delivery log and the health snapshot log page themselves — see the
            // usePagedList calls above.

            // Health summary cards. The weekly averages read a complete seven days rather
            // than whatever fell inside a fixed row count, and each "latest" card asks for
            // the most recent snapshot carrying that metric, so a reading stays visible
            // however long ago it was taken.
            const weekAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
            const latestWith = (col) => supabase
                .from('health_snapshots')
                .select('*')
                .eq('user_id', userId)
                .gt(col, 0)
                .order('recorded_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const [week, lSteps, lHR, lCalories, lSleep] = await Promise.all([
                fetchAllRows(() => supabase
                    .from('health_snapshots')
                    .select('steps, hr_avg, sleep_duration_h, calories_active, recorded_at')
                    .eq('user_id', userId)
                    .gte('recorded_at', weekAgoIso)),
                latestWith('steps'),
                latestWith('hr_avg'),
                latestWith('calories_active'),
                latestWith('sleep_duration_h'),
            ]);
            setHealthSummary({
                week,
                latestSteps: lSteps.data,
                latestHR: lHR.data,
                latestCalories: lCalories.data,
                latestSleep: lSleep.data,
            });

            // Gym visit beacons + their lifecycle events. This is how we see what a
            // device actually did during a visit (check-in → nudge → confirmed
            // inside/outside → claim → exit) instead of inferring it from user reports.
            const { data: visitData } = await supabase
                .from('gym_visits')
                .select('id, partner_id, platform, started_at, last_confirmed_at, claimed_at, upgraded_at, ended_at, status, nudge_count')
                .eq('user_id', userId)
                .order('started_at', { ascending: false })
                .limit(20);
            setGymVisits(visitData || []);

            const visitIds = (visitData || []).map(v => v.id);
            if (visitIds.length) {
                const { data: eventData } = await supabase
                    .from('gym_visit_events')
                    .select('id, visit_id, event, detail, created_at')
                    .in('visit_id', visitIds)
                    .order('created_at', { ascending: true });
                setVisitEvents(eventData || []);
            } else {
                setVisitEvents([]);
            }

            // Load preferred gym name if set
            if (p.data.preferred_gym_id) {
                const { data: gymData } = await supabase
                    .from('partners')
                    .select('id, name')
                    .eq('id', p.data.preferred_gym_id)
                    .single();
                setPreferredGym(gymData || null);
            } else {
                setPreferredGym(null);
            }

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
            <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Decrypting Node Data...</span>
        </div>
    );

    if (!profile) return (
        <div className="py-20 text-center">
            <h2 className="text-2xl font-light text-[#1A1A1A] mb-4">Node Not Found</h2>
            <Link to="/admin/users" className="text-[#8a7600] text-sm uppercase tracking-widest font-black">Back to Registry</Link>
        </div>
    );

    const totalPoints = transactions.reduce((acc, t) => acc + t.amount, 0);
    const vaultPending = vaultDeposits.filter(d => !d.released_at).reduce((acc, d) => acc + d.amount, 0);
    // Level basis = lifetime earned (positive ledger + pending vault) — matches
    // get_my_points_summary.total_earned; profiles.level is dead, never read it.
    const totalEarned = transactions.reduce((acc, t) => acc + (t.amount > 0 ? t.amount : 0), 0) + vaultPending;

    // Most recently seen token per platform (tokens are sorted updated_at desc).
    const latestTokenByPlatform = pushTokens.filter(
        (t, i) => pushTokens.findIndex(x => x.platform === t.platform) === i
    );

    const locationState = LOCATION_STATES[profile.location_permission] ?? null;
    const locationCheckedAt = profile.location_permission_checked_at
        ? new Date(profile.location_permission_checked_at).toLocaleDateString()
        : null;
    // Sampled fix accuracy (m) reported with the snapshot. A granted permission
    // with a large radius means reduced accuracy (iOS Precise Location off /
    // Android coarse-only) — geofencing is silently dead despite the grant.
    const locationGranted = profile.location_permission === 'always' || profile.location_permission === 'while_using';
    const reducedAccuracy = locationGranted && profile.location_accuracy_m > 500;
    const accuracyLabel = profile.location_accuracy_m != null
        ? (profile.location_accuracy_m >= 1000
            ? `~${(profile.location_accuracy_m / 1000).toFixed(1)} km`
            : `~${profile.location_accuracy_m} m`)
        : null;

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Nav */}
            <div className="flex items-center justify-between mb-12">
                <Link to="/admin/users" className="group flex items-center gap-3 text-[#666666] hover:text-[#1A1A1A] transition-colors">
                    <ChevronLeft size={16} />
                    <span className="text-[10px] uppercase tracking-[0.4em] font-black">Back to Registry</span>
                </Link>
                <button
                    onClick={() => setDeleteConfirm(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white border border-[#E6E6E1] text-[#999999] hover:text-red-400 hover:border-red-400/30 transition-all text-[10px] font-black uppercase tracking-widest"
                >
                    <Trash2 size={13} /> Delete User
                </button>
            </div>

            {/* Device lock — one account per device. Shown only when a device is bound. */}
            {deviceBindings.length > 0 && (
                <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 rounded-2xl bg-white border border-[#E6E6E1]">
                    <div className="flex items-center gap-3 min-w-0">
                        <Shield size={15} className="text-[#8a7600] shrink-0" />
                        <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[#999999]">Device Lock</div>
                            <div className="text-[13px] text-[#1A1A1A] truncate">
                                {deviceBindings.length === 1
                                    ? `Locked to 1 device · ${deviceBindings[0].platform || 'unknown'}`
                                    : `Locked to ${deviceBindings.length} devices`}
                                {deviceBindings[0]?.last_seen_at && (
                                    <span className="text-[#999999]"> · last seen {new Date(deviceBindings[0].last_seen_at).toLocaleDateString()}</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={handleReleaseDevices}
                        disabled={deviceReleasing}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white border border-[#E6E6E1] text-[#999999] hover:text-[#1A1A1A] hover:border-[#E8D200]/40 transition-all text-[10px] font-black uppercase tracking-widest disabled:opacity-50 shrink-0"
                    >
                        <X size={13} /> {deviceReleasing ? 'Releasing…' : 'Release Lock'}
                    </button>
                </div>
            )}

            {/* Recent self-serve device transfers — a burst here can mean alt-farming
                via the auto/confirm move path. 'auto' = silent stale-device migration,
                'confirmed' = user tapped "Move to this device". */}
            {deviceTransfers.length > 0 && (
                <div className="mb-8 px-5 py-4 rounded-2xl bg-white border border-[#E6E6E1]">
                    <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[#999999] mb-2">
                        Recent Device Transfers · {deviceTransfers.length}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        {deviceTransfers.map((t) => (
                            <div key={t.id} className="flex items-center gap-2 text-[12px] text-[#1A1A1A]">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${t.kind === 'confirmed' ? 'bg-[#E8D200]/20 text-[#8a7600]' : 'bg-[#F0F0EC] text-[#999999]'}`}>
                                    {t.kind === 'confirmed' ? 'Confirmed' : 'Auto'}
                                </span>
                                <span className="text-[#666666]">{t.platform || 'unknown'}</span>
                                <span className="text-[#999999]">· {new Date(t.created_at).toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Header / Identity */}
            <header className="mb-16">
                {/* Row 1: avatar + identity */}
                <div className="flex items-center gap-10 mb-10">
                    <label className={`group relative w-24 h-24 rounded-[2rem] bg-white border border-[#E6E6E1] hover:border-[#E8D200]/40 flex items-center justify-center overflow-hidden shrink-0 shadow-2xl cursor-pointer transition-all ${avatarUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                        {profile.avatar_url ? (
                            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <User size={40} className="text-[#888888]" />
                        )}
                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-all flex items-center justify-center">
                            {avatarUploading ? (
                                <div className="w-6 h-6 border-2 border-[#E8D200]/30 border-t-[#E8D200] rounded-full animate-spin" />
                            ) : (
                                <Camera size={22} className="text-[#8a7600] opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                        </div>
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={avatarUploading}
                            onChange={e => { if (e.target.files?.[0]) handleAvatarUpload(e.target.files[0]); e.target.value = ''; }}
                        />
                    </label>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2 truncate">
                            {profile.display_name || profile.username || userEmail?.split('@')[0] || 'Anonymous Node'}
                        </h1>
                        {/* Username (handle) — editable by admins so users who can't change it in-app can be fixed here */}
                        <div className="flex items-center gap-3 mb-4">
                            {editingUsername ? (
                                <>
                                    <div className="flex items-center h-9 px-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-lg focus-within:border-[#E8D200]/40 transition-[border-color]">
                                        <span className="text-[#999999] text-sm font-medium">@</span>
                                        <input
                                            type="text"
                                            autoFocus
                                            value={usernameEdit}
                                            onChange={e => setUsernameEdit(normalizeUsername(e.target.value))}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleSaveUsername();
                                                if (e.key === 'Escape') setEditingUsername(false);
                                            }}
                                            placeholder="username"
                                            className="w-44 bg-transparent outline-none text-sm text-[#1A1A1A] font-medium ml-0.5"
                                        />
                                    </div>
                                    <button
                                        onClick={handleSaveUsername}
                                        disabled={usernameSaving}
                                        className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-widest hover:translate-y-[-1px] transition-all disabled:opacity-50"
                                    >
                                        <Check size={13} /> {usernameSaving ? 'Saving…' : 'Save'}
                                    </button>
                                    <button
                                        onClick={() => setEditingUsername(false)}
                                        disabled={usernameSaving}
                                        className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-white border border-[#E6E6E1] text-[#999999] text-[10px] font-black uppercase tracking-widest hover:text-[#1A1A1A] transition-all disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <span className="text-[9px] uppercase tracking-[0.2em] text-[#AAAAAA] font-black">{MIN_USERNAME}–{MAX_USERNAME} chars · a–z 0–9 _</span>
                                </>
                            ) : (
                                <>
                                    <span className="text-sm text-[#666666] font-medium">
                                        {profile.username ? `@${profile.username}` : 'No username set'}
                                    </span>
                                    {profile.referral_code && (
                                        <button
                                            onClick={async () => {
                                                try { await navigator.clipboard.writeText(profile.referral_code); setMemberIdCopied(true); setTimeout(() => setMemberIdCopied(false), 1500); }
                                                catch { toast.error('Copy failed'); }
                                            }}
                                            title="POWR ID — the code the member sees under Settings › Account and reads out to be found. Click to copy."
                                            className="flex items-center gap-2 h-7 px-3 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[#555555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all"
                                        >
                                            <span className="text-[9px] font-black uppercase tracking-widest text-[#999999]">POWR ID</span>
                                            <span className="font-mono text-[12px] tracking-[0.15em] text-[#1A1A1A]">{formatMemberId(profile.referral_code)}</span>
                                            {memberIdCopied ? <Check size={11} className="text-[#10B981]" /> : <Copy size={11} />}
                                        </button>
                                    )}
                                    <button
                                        onClick={startEditUsername}
                                        className="group flex items-center gap-1.5 h-7 px-3 rounded-full bg-white border border-[#E6E6E1] text-[#999999] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all text-[9px] font-black uppercase tracking-widest"
                                    >
                                        <Pencil size={11} /> Edit
                                    </button>
                                </>
                            )}
                        </div>
                        <div className="flex items-center flex-wrap gap-3">
                            <span className="px-3 py-1 rounded-full bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em]">LVL {levelFromEarned(totalEarned)}</span>
                            {locationState ? (
                                <span
                                    title={`Live permission snapshot${locationCheckedAt ? ` · reported ${locationCheckedAt}` : ''}${accuracyLabel ? ` · fix accuracy ${accuracyLabel}` : ''}${reducedAccuracy ? ' · reduced accuracy: iOS Precise Location off / Android coarse-only — geofence check-ins cannot fire' : ''}`}
                                    className={`px-3 py-1 rounded-full ${reducedAccuracy ? 'bg-red-500/10 border border-red-500/20 text-red-500' : locationState.cls} text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5`}
                                >
                                    <MapPin size={11} /> {locationState.chip}{reducedAccuracy ? ' · Precise Off' : ''}
                                </span>
                            ) : profile.location_granted ? (
                                <span title="Legacy onboarding-bonus flag — this build doesn't report live permission state" className="px-3 py-1 rounded-full bg-[#10B981]/10 border border-[#10B981]/20 text-[#10B981] text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5">
                                    <MapPin size={11} /> Location
                                </span>
                            ) : (
                                <span title="Legacy onboarding-bonus flag — this build doesn't report live permission state" className="px-3 py-1 rounded-full bg-[#EFEFEC] text-[#999999] text-[10px] font-black uppercase tracking-[0.2em]">No Location</span>
                            )}
                            {latestTokenByPlatform.map(t => (
                                <span
                                    key={t.platform}
                                    title={`Reported with push registration · last seen ${new Date(t.updated_at).toLocaleDateString()}${t.ota_channel ? ` · channel ${t.ota_channel}` : ''}${t.ota_update_id ? ` · OTA update ${t.ota_update_id}` : t.ota_channel ? ' · embedded bundle' : ''}`}
                                    className="px-3 py-1 rounded-full bg-[#EFEFEC] text-[#666666] text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5"
                                >
                                    <Smartphone size={11} />
                                    {t.platform}
                                    {t.app_version
                                        ? ` v${t.app_version}${t.app_build ? ` (${t.app_build})` : ''}${t.ota_update_id ? ` · ${t.ota_update_id.slice(0, 8)}` : ''}`
                                        : ' · older build'}
                                </span>
                            ))}
                            <button
                                onClick={handleTogglePro}
                                disabled={proLoading}
                                className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-[0.2em] transition-all ${
                                    profile.is_pro
                                        ? 'bg-[#E8D200]/10 border-[#E8D200]/40 text-[#8a7600] hover:bg-[#E8D200]/20'
                                        : 'bg-[#EFEFEC] border-[#E6E6E1] text-[#999999] hover:text-[#333333] hover:border-[#DDDDDD]'
                                } disabled:opacity-50`}
                            >
                                <Star size={11} fill={profile.is_pro ? '#E8D200' : 'none'} />
                                {proLoading ? 'Updating...' : profile.is_pro ? 'Pro Athlete' : 'Grant Pro'}
                            </button>
                            <span className="text-[10px] uppercase tracking-[0.4em] text-[#999999] font-black">Est. {new Date(profile.created_at).getFullYear()}</span>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">{profile.id.substring(0, 14)}…</span>
                        </div>
                    </div>
                </div>

                {/* Row 2: stat cards */}
                <div className="flex flex-wrap gap-4">
                    {/* Points card — clickable to adjust */}
                    <button
                        onClick={() => setShowAdjust(true)}
                        className="group bg-white border border-[#E6E6E1] hover:border-[#E8D200]/30 p-6 px-8 rounded-2xl text-left transition-all hover:bg-[#E8D200]/[0.03] min-w-[200px]"
                    >
                        <div className="flex items-center justify-between gap-4 mb-3">
                            <div className="flex items-center gap-3">
                                <Zap size={15} className="text-[#8a7600]" />
                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">Points Balance</span>
                            </div>
                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#8a7600] font-black opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                <Plus size={10} /> Adjust
                            </span>
                        </div>
                        <div className="text-4xl font-light tracking-tighter text-[#8a7600] leading-none">{totalPoints.toLocaleString()}</div>
                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black mt-2">Click to adjust</div>
                    </button>

                    {/* Vault card — clickable to grant a deposit */}
                    <button
                        onClick={() => setShowVaultGrant(true)}
                        className="group bg-white border border-[#E6E6E1] hover:border-[#E8D200]/30 p-6 px-8 rounded-2xl text-left transition-all hover:bg-[#E8D200]/[0.03] min-w-[200px]"
                    >
                        <div className="flex items-center justify-between gap-4 mb-3">
                            <div className="flex items-center gap-3">
                                <Lock size={15} className="text-[#8a7600]" />
                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">Vault</span>
                            </div>
                            <span className="text-[9px] uppercase tracking-[0.3em] text-[#8a7600] font-black opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                <Plus size={10} /> Add
                            </span>
                        </div>
                        <div className="text-4xl font-light tracking-tighter text-[#8a7600] leading-none">{vaultPending.toLocaleString()}</div>
                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#999999] font-black mt-2">Vesting · click to add</div>
                    </button>

                    <div className="bg-white border border-[#E6E6E1] p-6 px-8 rounded-2xl min-w-[160px]">
                        <div className="flex items-center gap-3 mb-3">
                            <TrendingUp size={15} className="text-[#10B981]" />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">Current Streak</span>
                        </div>
                        <div className="text-4xl font-light tracking-tighter text-[#222222] leading-none">{streak?.current_streak || 0}<span className="text-xl text-[#999999] ml-1">d</span></div>
                    </div>

                    <div className="bg-white border border-[#E6E6E1] p-6 px-8 rounded-2xl min-w-[160px]">
                        <div className="flex items-center gap-3 mb-3">
                            <Shield size={15} className="text-[#0EA5E9]" />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">Trust Score</span>
                        </div>
                        <div className="text-4xl font-light tracking-tighter text-[#222222] leading-none">0.98</div>
                    </div>

                    <div className="bg-white border border-[#E6E6E1] p-6 px-8 rounded-2xl min-w-[160px]">
                        <div className="flex items-center gap-3 mb-3">
                            <Activity size={15} className="text-[#A78BFA]" />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">Sessions</span>
                        </div>
                        <div className="text-4xl font-light tracking-tighter text-[#222222] leading-none">{sessions.length}</div>
                    </div>

                    <div className="bg-white border border-[#E6E6E1] p-6 px-8 rounded-2xl min-w-[160px]">
                        <div className="flex items-center gap-3 mb-3">
                            <Gift size={15} className="text-[#F97316]" />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">Redemptions</span>
                        </div>
                        <div className="text-4xl font-light tracking-tighter text-[#222222] leading-none">{redemptions.length}</div>
                    </div>

                    {preferredGym && (
                        <div className="bg-white border border-[#E8D200]/20 p-6 px-8 rounded-2xl min-w-[200px]">
                            <div className="flex items-center gap-3 mb-3">
                                <Star size={15} className="text-[#8a7600]" fill="#E8D200" />
                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">Home Gym</span>
                            </div>
                            <div className="text-base font-medium tracking-tight text-[#1A1A1A] leading-tight">{preferredGym.name}</div>
                        </div>
                    )}
                </div>
            </header>

            {/* Vault Grant Modal */}
            {showVaultGrant && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center" onClick={() => setShowVaultGrant(false)}>
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-12 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-2xl font-light tracking-tighter text-[#1A1A1A]">Add to Vault</h3>
                            <button onClick={() => setShowVaultGrant(false)} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#BBB] hover:text-[#1A1A1A] transition-colors"><X size={18} /></button>
                        </div>
                        <div className="flex items-center justify-between bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl px-6 py-4 mb-8">
                            <div>
                                <div className="text-[9px] uppercase tracking-[0.4em] text-[#999999] font-black mb-1">Currently vesting</div>
                                <div className="text-3xl font-light tracking-tighter text-[#8a7600]">{vaultPending.toLocaleString()} <span className="text-base text-[#999999]">pts</span></div>
                            </div>
                            <Lock size={20} className="text-[#8a7600]" />
                        </div>
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-8">Banks a vesting deposit — 0 days = ready immediately</p>
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-[#BBB] font-black mb-3">Amount</label>
                                    <input type="number" min="1" value={vgAmount} onChange={e => setVgAmount(e.target.value)} placeholder="e.g. 50" className="w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[#1A1A1A] text-lg font-light outline-none focus:border-[#E8D200]/40 transition-all" />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-[#BBB] font-black mb-3">Vest days</label>
                                    <input type="number" min="0" value={vgDays} onChange={e => setVgDays(e.target.value)} placeholder="default" className="w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[#1A1A1A] text-lg font-light outline-none focus:border-[#E8D200]/40 transition-all" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-[#BBB] font-black mb-3">Note (shown to the user)</label>
                                <input type="text" value={vgNote} onChange={e => setVgNote(e.target.value)} placeholder="Launch week drop" className="w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[#1A1A1A] text-sm outline-none focus:border-[#E8D200]/40 transition-all" />
                            </div>
                            <button type="button" onClick={() => setVgNotify(!vgNotify)}
                                className={`w-full h-14 rounded-xl border flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all ${vgNotify ? 'border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                {vgNotify ? 'Push the drop to them' : 'Silent — no push'}
                            </button>
                            <button onClick={handleVaultGrant} disabled={vgLoading} className="w-full h-14 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-xs rounded-xl hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 disabled:opacity-50">
                                {vgLoading ? 'Processing...' : 'Bank It'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Point Adjustment Modal */}
            {showAdjust && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center" onClick={() => setShowAdjust(false)}>
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-12 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-2xl font-light tracking-tighter text-[#1A1A1A]">Adjust Points</h3>
                            <button onClick={() => setShowAdjust(false)} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#BBB] hover:text-[#1A1A1A] transition-colors"><X size={18} /></button>
                        </div>
                        {/* Current balance */}
                        <div className="flex items-center justify-between bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl px-6 py-4 mb-8">
                            <div>
                                <div className="text-[9px] uppercase tracking-[0.4em] text-[#999999] font-black mb-1">Current balance</div>
                                <div className="text-3xl font-light tracking-tighter text-[#8a7600]">{totalPoints.toLocaleString()} <span className="text-base text-[#999999]">pts</span></div>
                            </div>
                            <Zap size={20} className="text-[#8a7600]" />
                        </div>
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-8">Use negative values to debit points</p>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-[#BBB] font-black mb-3">Amount</label>
                                <input type="number" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} placeholder="e.g. 100 or -50" className="w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[#1A1A1A] text-lg font-light outline-none focus:border-[#E8D200]/40 transition-all" />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-[#BBB] font-black mb-3">Reason</label>
                                <input type="text" value={adjDesc} onChange={e => setAdjDesc(e.target.value)} placeholder="Manual correction, bonus, etc." className="w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[#1A1A1A] text-sm outline-none focus:border-[#E8D200]/40 transition-all" />
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
                    <div className="flex items-center gap-8 mb-8 border-b border-[#E6E6E1]">
                        <button
                            onClick={() => setActiveTab('activity')}
                            className={`pb-4 text-[11px] font-black uppercase tracking-[0.2em] transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'activity' ? 'text-[#8a7600] border-[#E8D200]' : 'text-[#BBB] border-transparent hover:text-[#333333]'}`}
                        >
                            <Activity size={14} /> Activity Logs
                        </button>
                        <button
                            onClick={() => setActiveTab('points')}
                            className={`pb-4 text-[11px] font-black uppercase tracking-[0.2em] transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'points' ? 'text-[#8a7600] border-[#E8D200]' : 'text-[#BBB] border-transparent hover:text-[#333333]'}`}
                        >
                            <Zap size={14} /> Points Ledger
                        </button>
                        <button
                            onClick={() => setActiveTab('health')}
                            className={`pb-4 text-[11px] font-black uppercase tracking-[0.2em] transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'health' ? 'text-[#8a7600] border-[#E8D200]' : 'text-[#BBB] border-transparent hover:text-[#333333]'}`}
                        >
                            <Heart size={14} /> Health Data
                        </button>
                        <button
                            onClick={() => setActiveTab('notifications')}
                            className={`pb-4 text-[11px] font-black uppercase tracking-[0.2em] transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'notifications' ? 'text-[#8a7600] border-[#E8D200]' : 'text-[#BBB] border-transparent hover:text-[#333333]'}`}
                        >
                            <Bell size={14} /> Notifications
                        </button>
                        {profile.is_pro && (
                            <button
                                onClick={() => setActiveTab('pro')}
                                className={`pb-4 text-[11px] font-black uppercase tracking-[0.2em] transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'pro' ? 'text-[#8a7600] border-[#E8D200]' : 'text-[#BBB] border-transparent hover:text-[#333333]'}`}
                            >
                                <Star size={14} /> Pro Profile
                            </button>
                        )}
                    </div>

                    {/* Activity Timeline */}
                    {activeTab === 'activity' && (
                        <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Activity Logs</h3>
                                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Historical Telemetry Data</p>
                                </div>
                                <span className="text-[10px] font-black text-[#555555] uppercase tracking-[0.3em]">{filteredSessions.length} RECORDED</span>
                            </div>
                            
                            {/* Activity Filters */}
                            <div className="p-6 bg-[#F4F4F1] border-b border-[#E6E6E1] flex flex-wrap gap-4">
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#BBB] font-black mb-2">Date</label>
                                    <input 
                                        type="date" 
                                        value={activityDateFilter} 
                                        onChange={e => setActivityDateFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-white border border-[#E6E6E1] rounded-lg text-[#333333] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color]"
                                    />
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#BBB] font-black mb-2">Type</label>
                                    <select 
                                        value={activityTypeFilter} 
                                        onChange={e => setActivityTypeFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-white border border-[#E6E6E1] rounded-lg text-[#333333] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color] appearance-none"
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
                                    <label className="block text-[9px] uppercase tracking-widest text-[#BBB] font-black mb-2">Verification</label>
                                    <select 
                                        value={activityVerificationFilter} 
                                        onChange={e => setActivityVerificationFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-white border border-[#E6E6E1] rounded-lg text-[#333333] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color] appearance-none"
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
                                            className="h-10 px-4 text-[10px] uppercase tracking-[0.2em] font-black text-[#222222] hover:text-[#1A1A1A] transition-colors"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="divide-y divide-[#E6E6E1]">
                                {filteredSessions.length === 0 ? (
                                    <div className="p-20 text-center text-[#888888] text-[10px] uppercase tracking-[0.4em] font-black">No activity markers detected</div>
                                ) : filteredSessions.slice(0, visibleSessions).map(session => {
                                    // Link only where the partner actually resolves — older rows carry a
                                    // composite geofence key or a since-deleted partner, and both used to
                                    // produce a dead /admin/performance link.
                                    const resolvedPartnerId = session.verification === 'geofence'
                                        ? sessionPartnerId(session)
                                        : null;
                                    const venuePartner = resolvedPartnerId ? partnerMap[resolvedPartnerId] : null;
                                    const geoPartnerId = venuePartner ? resolvedPartnerId : null;
                                    const venue = session.verification === 'geofence'
                                        ? venueName(session, partnerMap)
                                        : null;
                                    const TypeIcon = ACTIVITY_ICONS[session.type] || Activity;
                                    return (
                                    <div
                                        key={session.id}
                                        onClick={geoPartnerId ? () => navigate(`/admin/performance/${geoPartnerId}`) : undefined}
                                        role={geoPartnerId ? 'button' : undefined}
                                        title={geoPartnerId ? 'View gym performance for this session' : undefined}
                                        className={`p-10 flex items-center gap-10 group transition-all ${geoPartnerId ? 'cursor-pointer hover:bg-[#F4F4F1]' : 'hover:bg-[#F4F4F1]'}`}
                                    >
                                        {/* The venue's logo on a geofence row, else an icon for the activity.
                                            The icon sits BEHIND the logo rather than in an :else — a logo that
                                            404s hides itself and uncovers the icon, with no per-row state. */}
                                        <div className="relative w-14 h-14 rounded-3xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center overflow-hidden shrink-0">
                                            <TypeIcon size={20} className="text-[#666666] group-hover:text-[#8a7600] transition-colors" />
                                            {venuePartner?.logo_url && (
                                                <img
                                                    src={venuePartner.logo_url}
                                                    alt=""
                                                    className="absolute inset-0 w-full h-full object-contain p-2 bg-[#F4F4F1]"
                                                    onError={e => { e.currentTarget.style.display = 'none'; }}
                                                />
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-lg font-bold text-[#222222] capitalize">{session.type} session</span>
                                                <span className="text-[10px] text-[#666666] font-black uppercase tracking-[0.4em]">{timeAgo(session.started_at)}</span>
                                            </div>
                                            {venue && (
                                                <div className="text-[12px] text-[#222222] mb-3 font-medium flex items-center gap-2">
                                                    <MapPin size={12} className="text-[#8a7600]" />
                                                    <span>{venue}</span>
                                                    <span className="text-[#555555]">•</span>
                                                    <span>{formatSessionTime(session.started_at, session.duration_sec)}</span>
                                                    {geoPartnerId && (
                                                        <span className="flex items-center gap-1 text-[#8a7600] opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <span className="text-[9px] uppercase tracking-[0.2em] font-black">View location</span>
                                                            <ArrowUpRight size={12} />
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            {!venue && <div className="mb-2" />}
                                            <div className="flex items-center gap-6 text-[10px] font-black text-[#666666] uppercase tracking-[0.2em]">
                                                <span className="flex items-center gap-2"><Clock size={12} /> {Math.floor(session.duration_sec / 60)}M</span>
                                                {session.distance_m > 0 && <span className="flex items-center gap-2"><MapPin size={12} /> {(session.distance_m / 1000).toFixed(2)}KM</span>}
                                                <span className={`px-3 py-1 rounded-full border ${session.verification === 'geofence' ? 'border-[#10B981]/20 text-[#10B981]' : 'border-[#E6E6E1] text-[#666666]'}`}>
                                                    {session.verification} verify
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-8 shrink-0">
                                            <div className="text-right">
                                                <div className="text-2xl font-light tracking-tighter text-[#8a7600] mb-1">
                                                    {sessionPoints[session.id] != null
                                                        ? `${sessionPoints[session.id] > 0 ? '+' : ''}${sessionPoints[session.id].toLocaleString()}`
                                                        : '—'}
                                                </div>
                                                <div className="text-[8px] uppercase tracking-[0.3em] text-[#666666] font-black">POINTS</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-2xl font-light tracking-tighter text-[#1A1A1A] mb-1">{(session.trust_score * 100).toFixed(0)}%</div>
                                                <div className="text-[8px] uppercase tracking-[0.3em] text-[#666666] font-black">TRUST</div>
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                            {filteredSessions.length > visibleSessions && (
                                <div className="p-6 border-t border-[#E6E6E1] text-center bg-[#F4F4F1] hover:bg-[#EFEFEC] transition-colors">
                                    <button 
                                        onClick={() => setVisibleSessions(prev => prev + 10)}
                                        className="text-[10px] text-[#8a7600] font-black uppercase tracking-[0.3em] transition-colors py-2 px-6"
                                    >
                                        Load More Activity
                                    </button>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Gym visit beacons — what the device actually did during a visit */}
                    {activeTab === 'notifications' && (
                        <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 mb-8">
                            <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Gym Visits</h3>
                                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Check-in → wake → confirm → claim</p>
                                </div>
                                <span className="text-[10px] font-black text-[#555555] uppercase tracking-[0.3em]">{gymVisits.length} RECORDED</span>
                            </div>
                            <div className="px-10 py-4 bg-[#F4F4F1] border-b border-[#E6E6E1] text-[11px] text-[#666666] leading-relaxed">
                                A stationary phone receives no GPS callbacks, so the device can't wake itself to claim. The server holds the timers and sends a <span className="font-bold text-[#333333]">silent push</span> at each threshold; the device then takes a fresh fix and decides. <span className="font-bold text-[#333333]">Confirmed inside</span> is a real location proof — and nothing is ever credited without one.
                            </div>
                            <div className="divide-y divide-[#E6E6E1]">
                                {gymVisits.length === 0 ? (
                                    <div className="p-20 text-center text-[#888888] text-[10px] uppercase tracking-[0.4em] font-black">No gym visits recorded yet</div>
                                ) : gymVisits.map(visit => {
                                    const events = visitEvents.filter(e => e.visit_id === visit.id);
                                    const statusCls = VISIT_STATUS_CLS[visit.status] ?? 'border-[#E6E6E1] text-[#666666]';
                                    const mins = visit.ended_at
                                        ? Math.round((new Date(visit.ended_at) - new Date(visit.started_at)) / 60000)
                                        : Math.round((Date.now() - new Date(visit.started_at)) / 60000);
                                    return (
                                        <div key={visit.id} className="px-10 py-6 hover:bg-[#F4F4F1] transition-all">
                                            <div className="flex items-center justify-between gap-4 mb-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <MapPin size={14} className="text-[#8a7600] shrink-0" />
                                                    <span className="text-[13px] font-bold text-[#222222]">
                                                        {new Date(visit.started_at).toLocaleDateString()} · {clockTime(visit.started_at)}
                                                    </span>
                                                    <span className="text-[11px] text-[#666666]">{mins}m{visit.ended_at ? '' : ' (open)'}</span>
                                                    {visit.platform && <span className="text-[9px] uppercase tracking-[0.2em] font-black text-[#999999]">{visit.platform}</span>}
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    {visit.nudge_count > 0 && (
                                                        <span className="text-[9px] uppercase tracking-[0.2em] font-black text-[#999999]">{visit.nudge_count} wake{visit.nudge_count === 1 ? '' : 's'}</span>
                                                    )}
                                                    <span className={`px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-[0.2em] ${statusCls}`}>{visit.status}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-x-6 gap-y-1 pl-7">
                                                {events.length === 0 ? (
                                                    <span className="text-[11px] text-[#999999]">No events recorded</span>
                                                ) : events.map(ev => {
                                                    const style = VISIT_EVENT_STYLES[ev.event] ?? { label: ev.event, cls: 'text-[#666666]' };
                                                    const dist = ev.detail?.distance_m;
                                                    return (
                                                        <span key={ev.id} className="text-[11px] flex items-center gap-1.5">
                                                            <span className="text-[#999999] tabular-nums">{clockTime(ev.created_at)}</span>
                                                            <span className={`font-medium ${style.cls}`}>{style.label}</span>
                                                            {dist != null && <span className="text-[#999999]">({dist}m)</span>}
                                                            {ev.detail?.reason && <span className="text-[#B45309]">{ev.detail.reason}</span>}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {/* Push delivery log */}
                    {activeTab === 'notifications' && (
                        <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Push Delivery Log</h3>
                                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Every send attempt · last 30 days</p>
                                </div>
                                <span className="text-[10px] font-black text-[#555555] uppercase tracking-[0.3em]">{pushLog.total.toLocaleString()} RECORDED</span>
                            </div>
                            <div className="px-10 py-4 bg-[#F4F4F1] border-b border-[#E6E6E1] text-[11px] text-[#666666] leading-relaxed">
                                <span className="font-bold text-[#333333]">Accepted</span> means APNs/FCM took the push — it does not guarantee the device displayed it.
                                <span className="font-bold text-[#333333]"> Skipped</span> means a server gate stopped the send (reason shown).
                                <span className="font-bold text-[#333333]"> Rejected/Failed</span> carry the exact Expo error. Entries older than this log (pre 13 Jul 2026) were never recorded.
                            </div>
                            <div className="divide-y divide-[#E6E6E1]">
                                {pushLog.loading ? (
                                    <div className="p-20 text-center text-[#888888] text-[10px] uppercase tracking-[0.4em] font-black">Loading push log…</div>
                                ) : pushLog.error ? (
                                    <div className="p-20 text-center text-red-500 text-[10px] uppercase tracking-[0.4em] font-black">Could not load push log — {pushLog.error.message}</div>
                                ) : pushLog.total === 0 ? (
                                    <div className="p-20 text-center text-[#888888] text-[10px] uppercase tracking-[0.4em] font-black">No push attempts logged yet</div>
                                ) : pushLog.rows.map(entry => {
                                    const state = PUSH_STATES[entry.status] ?? { label: entry.status, cls: 'border-[#E6E6E1] text-[#666666]' };
                                    return (
                                        <div key={entry.id} className="px-10 py-6 flex items-start gap-6 hover:bg-[#F4F4F1] transition-all">
                                            <div className="w-11 h-11 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                                                <Bell size={16} className="text-[#666666]" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-center gap-4 mb-1">
                                                    <span className="text-[13px] font-bold text-[#222222] truncate">{entry.title || entry.type}</span>
                                                    <span className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em] shrink-0">{timeAgo(entry.created_at)}</span>
                                                </div>
                                                {entry.body && <div className="text-[12px] text-[#555555] truncate mb-2">{entry.body}</div>}
                                                <div className="flex flex-wrap items-center gap-3 text-[9px] font-black uppercase tracking-[0.2em]">
                                                    <span className="text-[#999999]">{entry.type}</span>
                                                    <span className={`px-3 py-1 rounded-full border ${state.cls}`}>{state.label}</span>
                                                    {entry.skip_reason && <span className="text-[#B45309] normal-case tracking-normal font-medium">{entry.skip_reason}</span>}
                                                    {entry.error && <span className="text-red-500 normal-case tracking-normal font-medium">{entry.error}</span>}
                                                    {entry.status === 'queued' && !entry.receipt_checked_at && (
                                                        <span className="text-[#999999] normal-case tracking-normal font-medium">receipt never confirmed</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <Pager {...pushLog} />
                        </section>
                    )}

                    {/* Point Ledger */}
                    {activeTab === 'points' && (
                        <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Points Ledger</h3>
                                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Transaction History</p>
                                </div>
                                <span className="text-[10px] font-black text-[#555555] uppercase tracking-[0.3em]">{filteredTransactions.length} RECORDED</span>
                            </div>

                            {/* Points Filters */}
                            <div className="p-6 bg-[#F4F4F1] border-b border-[#E6E6E1] flex flex-wrap gap-4">
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#BBB] font-black mb-2">Search</label>
                                    <input 
                                        type="text" 
                                        placeholder="Search description..."
                                        value={pointsSearchFilter} 
                                        onChange={e => setPointsSearchFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-white border border-[#E6E6E1] rounded-lg text-[#333333] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color]"
                                    />
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#BBB] font-black mb-2">Date</label>
                                    <input 
                                        type="date" 
                                        value={pointsDateFilter} 
                                        onChange={e => setPointsDateFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-white border border-[#E6E6E1] rounded-lg text-[#333333] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color]"
                                    />
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[9px] uppercase tracking-widest text-[#BBB] font-black mb-2">Type</label>
                                    <select 
                                        value={pointsTypeFilter} 
                                        onChange={e => setPointsTypeFilter(e.target.value)}
                                        className="w-full h-10 px-4 bg-white border border-[#E6E6E1] rounded-lg text-[#333333] text-sm outline-none focus:border-[#E8D200]/40 transition-[border-color] appearance-none"
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
                                            className="h-10 px-4 text-[10px] uppercase tracking-[0.2em] font-black text-[#222222] hover:text-[#1A1A1A] transition-colors"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="p-6">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black border-b border-[#E6E6E1]">
                                            <th className="px-6 py-4">Descriptor</th>
                                            <th className="px-6 py-4">Type</th>
                                            <th className="px-6 py-4 text-right">Impact</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E6E6E1]">
                                        {filteredTransactions.length === 0 ? (
                                            <tr><td colSpan={3} className="px-6 py-12 text-center text-[#888888] text-[10px] uppercase tracking-[0.4em] font-black">No transactions recorded</td></tr>
                                        ) : filteredTransactions.slice(0, visibleTransactions).map(t => {
                                            const multiplier = t.multiplier ?? 1.0;
                                            const baseAmount = multiplier > 1.0 ? Math.round(Math.abs(t.amount) / multiplier) : Math.abs(t.amount);
                                            const hasMultiplier = multiplier > 1.0;
                                            const isVerified = !!t.session_id;
                                            return (
                                            <tr key={t.id} className="group hover:bg-[#F4F4F1] transition-all">
                                                <td className="px-6 py-6">
                                                    <div className="text-base font-bold text-[#BBB] group-hover:text-[#1A1A1A] transition-colors mb-1">{t.description || 'System Adjustment'}</div>
                                                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                                                        <span className="text-[9px] text-[#666666] font-black uppercase tracking-[0.4em]">{new Date(t.created_at).toLocaleDateString()}</span>
                                                        {t.activity_type && (
                                                            <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-[#E2E2DD] text-[#777777] border border-[#E6E6E1]">{t.activity_type}</span>
                                                        )}
                                                        {isVerified && (
                                                            <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-[#E7F6EE] text-[#10B981] border border-[#10B981]/20">verified</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-6 font-mono text-[11px] uppercase tracking-widest text-[#555555]">{t.type}</td>
                                                <td className="px-6 py-6 text-right">
                                                    <div className={`flex items-center justify-end gap-2 font-black text-xl tracking-tighter ${t.amount >= 0 ? 'text-[#10B981]' : 'text-[#F43F5E]'}`}>
                                                        {t.amount >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                                                        {Math.abs(t.amount)}
                                                    </div>
                                                    {hasMultiplier && (
                                                        <div className="text-[9px] text-[#999999] font-mono mt-1 tracking-wider">
                                                            {baseAmount} base × {multiplier}×
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {filteredTransactions.length > visibleTransactions && (
                                <div className="p-6 border-t border-[#E6E6E1] text-center bg-[#F4F4F1] hover:bg-[#EFEFEC] transition-colors">
                                    <button 
                                        onClick={() => setVisibleTransactions(prev => prev + 10)}
                                        className="text-[10px] text-[#8a7600] font-black uppercase tracking-[0.3em] transition-colors py-2 px-6"
                                    >
                                        Load More Points
                                    </button>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Health Data Tab */}
                    {activeTab === 'health' && (() => {
                        const { week = [], latestSteps: latestWithSteps, latestHR: latestWithHR,
                                latestCalories: latestWithCalories, latestSleep: latestWithSleep } = healthSummary ?? {};

                        // Averages count only the snapshots that carry the metric — health
                        // sources write a row per activity, so most rows are null for most
                        // fields and dividing by the row count would understate every one.
                        const meanOf = (key) => {
                            const vals = week.map(s => s[key]).filter(v => v > 0);
                            return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
                        };
                        const meanSteps = meanOf('steps');
                        const meanSleep = meanOf('sleep_duration_h');
                        const meanHR = meanOf('hr_avg');

                        const avgSteps = meanSteps === null ? 0 : Math.round(meanSteps);
                        const avgSleep = meanSleep === null ? '—' : meanSleep.toFixed(1);
                        const avgHR = meanHR === null ? 0 : Math.round(meanHR);
                        const totalCalories = week.reduce((sum, s) => sum + (s.calories_active > 0 ? s.calories_active : 0), 0);

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
                                        <div key={card.label} className="bg-white border border-[#E6E6E1] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-3">
                                                <card.icon size={14} style={{ color: card.color }} />
                                                <span className="text-[9px] uppercase tracking-[0.3em] text-[#666666] font-black">{card.label}</span>
                                            </div>
                                            <div className="text-2xl font-light tracking-tighter text-[#222222] mb-1">{card.value}</div>
                                            <div className="text-[9px] uppercase tracking-[0.3em] text-[#666666] font-black">{card.sub}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Latest Readings */}
                                <div className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                                    <div className="p-10 border-b border-[#E6E6E1]">
                                        <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Latest Readings</h3>
                                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Most recent health data from device</p>
                                    </div>
                                    <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        {/* Steps */}
                                        <div className="bg-[#F4F4F1] border border-[#E6E6E1] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Footprints size={16} className="text-[#10B981]" />
                                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBB] font-black">Steps</span>
                                            </div>
                                            {latestWithSteps ? (
                                                <>
                                                    <div className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">{latestWithSteps.steps.toLocaleString()}</div>
                                                    <div className="text-[9px] text-[#666666] font-black uppercase tracking-[0.3em]">{timeAgo(latestWithSteps.recorded_at)}</div>
                                                </>
                                            ) : (
                                                <div className="text-[#666666] text-sm">No step data recorded</div>
                                            )}
                                        </div>

                                        {/* Heart Rate */}
                                        <div className="bg-[#F4F4F1] border border-[#E6E6E1] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Heart size={16} className="text-[#F43F5E]" />
                                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBB] font-black">Heart Rate</span>
                                            </div>
                                            {latestWithHR ? (
                                                <>
                                                    <div className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">{latestWithHR.hr_avg} <span className="text-lg text-[#BBB]">bpm avg</span></div>
                                                    <div className="flex gap-6 text-[10px] text-[#555555] font-black uppercase tracking-[0.2em]">
                                                        {latestWithHR.hr_max > 0 && <span>Max: {latestWithHR.hr_max}</span>}
                                                        {latestWithHR.hr_resting > 0 && <span>Resting: {latestWithHR.hr_resting}</span>}
                                                    </div>
                                                    <div className="text-[9px] text-[#666666] font-black uppercase tracking-[0.3em] mt-2">{timeAgo(latestWithHR.recorded_at)}</div>
                                                </>
                                            ) : (
                                                <div className="text-[#666666] text-sm">No heart rate data recorded</div>
                                            )}
                                        </div>

                                        {/* Sleep */}
                                        <div className="bg-[#F4F4F1] border border-[#E6E6E1] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Moon size={16} className="text-[#8B5CF6]" />
                                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBB] font-black">Sleep</span>
                                            </div>
                                            {latestWithSleep ? (
                                                <>
                                                    <div className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">{latestWithSleep.sleep_duration_h}<span className="text-lg text-[#BBB]">h total</span></div>
                                                    <div className="flex gap-4 mt-2">
                                                        {latestWithSleep.sleep_deep_h > 0 && (
                                                            <div className="flex-1 bg-white border border-[#E6E6E1] p-3 rounded-xl text-center">
                                                                <div className="text-[#8B5CF6] text-lg font-light">{latestWithSleep.sleep_deep_h}h</div>
                                                                <div className="text-[8px] uppercase tracking-[0.3em] text-[#666666] font-black">Deep</div>
                                                            </div>
                                                        )}
                                                        {latestWithSleep.sleep_rem_h > 0 && (
                                                            <div className="flex-1 bg-white border border-[#E6E6E1] p-3 rounded-xl text-center">
                                                                <div className="text-[#6366F1] text-lg font-light">{latestWithSleep.sleep_rem_h}h</div>
                                                                <div className="text-[8px] uppercase tracking-[0.3em] text-[#666666] font-black">REM</div>
                                                            </div>
                                                        )}
                                                        {latestWithSleep.sleep_light_h > 0 && (
                                                            <div className="flex-1 bg-white border border-[#E6E6E1] p-3 rounded-xl text-center">
                                                                <div className="text-[#A78BFA] text-lg font-light">{latestWithSleep.sleep_light_h}h</div>
                                                                <div className="text-[8px] uppercase tracking-[0.3em] text-[#666666] font-black">Light</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="text-[9px] text-[#666666] font-black uppercase tracking-[0.3em] mt-3">{timeAgo(latestWithSleep.recorded_at)}</div>
                                                </>
                                            ) : (
                                                <div className="text-[#666666] text-sm">No sleep data recorded</div>
                                            )}
                                        </div>

                                        {/* Calories */}
                                        <div className="bg-[#F4F4F1] border border-[#E6E6E1] p-6 rounded-2xl">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Flame size={16} className="text-[#F97316]" />
                                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBB] font-black">Calories</span>
                                            </div>
                                            {latestWithCalories ? (
                                                <>
                                                    <div className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">{Math.round(latestWithCalories.calories_active)} <span className="text-lg text-[#BBB]">kcal active</span></div>
                                                    {latestWithCalories.calories_total > 0 && (
                                                        <div className="text-[10px] text-[#555555] font-black uppercase tracking-[0.2em]">Total: {Math.round(latestWithCalories.calories_total)} kcal</div>
                                                    )}
                                                    <div className="text-[9px] text-[#666666] font-black uppercase tracking-[0.3em] mt-2">{timeAgo(latestWithCalories.recorded_at)}</div>
                                                </>
                                            ) : (
                                                <div className="text-[#666666] text-sm">No calorie data recorded</div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Snapshot History */}
                                <div className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                                    <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                        <div>
                                            <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Snapshot History</h3>
                                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Raw health telemetry log</p>
                                        </div>
                                        <span className="text-[10px] font-black text-[#555555] uppercase tracking-[0.3em]">{healthLog.total.toLocaleString()} RECORDED</span>
                                    </div>
                                    <div className="divide-y divide-[#E6E6E1]">
                                        {healthLog.loading ? (
                                            <div className="p-20 text-center text-[#888888] text-[10px] uppercase tracking-[0.4em] font-black">Loading snapshots…</div>
                                        ) : healthLog.error ? (
                                            <div className="p-20 text-center text-red-500 text-[10px] uppercase tracking-[0.4em] font-black">Could not load snapshots — {healthLog.error.message}</div>
                                        ) : healthLog.total === 0 ? (
                                            <div className="p-20 text-center text-[#888888] text-[10px] uppercase tracking-[0.4em] font-black">No health snapshots recorded</div>
                                        ) : healthLog.rows.map(snap => (
                                            <div key={snap.id} className="p-6 flex items-center gap-8 group hover:bg-[#F4F4F1] transition-all">
                                                <div className="w-10 h-10 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                                                    {snap.sleep_duration_h > 0 ? <Moon size={16} className="text-[#8B5CF6]" /> :
                                                     snap.hr_avg > 0 ? <Heart size={16} className="text-[#F43F5E]" /> :
                                                     <Activity size={16} className="text-[#666666]" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-3 mb-1">
                                                        <span className="text-sm font-bold text-[#222222] capitalize">{snap.activity_type || 'General'}</span>
                                                        <span className="px-2 py-0.5 rounded-full border border-[#E6E6E1] text-[8px] font-black uppercase tracking-[0.2em] text-[#666666]">{snap.source}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-4 text-[10px] font-black text-[#555555] uppercase tracking-[0.2em]">
                                                        {snap.steps > 0 && <span>{snap.steps.toLocaleString()} steps</span>}
                                                        {snap.hr_avg > 0 && <span>{snap.hr_avg} bpm</span>}
                                                        {snap.calories_active > 0 && <span>{Math.round(snap.calories_active)} kcal</span>}
                                                        {snap.sleep_duration_h > 0 && <span>{snap.sleep_duration_h}h sleep</span>}
                                                        {snap.distance_m > 0 && <span>{(snap.distance_m / 1000).toFixed(1)}km</span>}
                                                        {snap.duration_sec > 0 && <span>{Math.floor(snap.duration_sec / 60)}m</span>}
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em] shrink-0">{timeAgo(snap.recorded_at)}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <Pager {...healthLog} />
                                </div>
                            </section>
                        );
                    })()}

                    {/* ── Pro Profile Tab */}
                    {activeTab === 'pro' && (
                        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* Athlete Invite Link */}
                            <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                                <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                    <div>
                                        <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Athlete Invite</h3>
                                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Onboarding link · share to send or resend</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {athleteInvite ? (
                                            <>
                                                <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] ${
                                                    athleteInvite.status === 'approved' ? 'bg-[#10B981]/10 border border-[#10B981]/20 text-[#10B981]' :
                                                    athleteInvite.status === 'pending' ? 'bg-orange-500/10 border border-orange-500/20 text-orange-400' :
                                                    athleteInvite.status === 'rejected' ? 'bg-red-500/10 border border-red-500/20 text-red-400' :
                                                    'bg-[#EFEFEC] border border-[#E6E6E1] text-[#666666]'
                                                }`}>
                                                    {athleteInvite.status}
                                                </span>
                                                {(athleteInvite.status === 'invited' || athleteInvite.status === 'rejected') && (
                                                    <button
                                                        onClick={handleRegenerateInvite}
                                                        disabled={inviteRegenerating}
                                                        className="h-10 px-5 bg-[#EFEFEC] border border-[#E6E6E1] rounded-full flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#666666] hover:text-[#8a7600] hover:border-[#E8D200]/30 transition-all disabled:opacity-50"
                                                    >
                                                        <RefreshCw size={12} className={inviteRegenerating ? 'animate-spin' : ''} />
                                                        Regenerate
                                                    </button>
                                                )}
                                            </>
                                        ) : (
                                            <button
                                                onClick={handleGenerateInvite}
                                                disabled={inviteRegenerating}
                                                className="h-10 px-6 bg-[#E8D200] text-[#080808] rounded-full flex items-center gap-2 text-[10px] font-black uppercase tracking-widest hover:translate-y-[-1px] transition-all disabled:opacity-50"
                                            >
                                                <Link2 size={12} />
                                                {inviteRegenerating ? 'Generating…' : 'Generate Invite'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="p-10">
                                    {athleteInvite ? (
                                        <div className="flex items-center gap-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl px-6 py-4">
                                            <Link2 size={16} className="text-[#8a7600] shrink-0" />
                                            <span className="flex-1 text-sm font-light text-[#666666] truncate font-mono">
                                                {window.location.origin}/athlete/{athleteInvite.invite_token}
                                            </span>
                                            <button
                                                onClick={handleCopyInviteLink}
                                                className={`h-9 px-5 rounded-full flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all shrink-0 ${
                                                    inviteLinkCopied
                                                        ? 'bg-[#10B981]/10 border border-[#10B981]/20 text-[#10B981]'
                                                        : 'bg-[#EFEFEC] border border-[#E6E6E1] text-[#BBB] hover:text-[#8a7600] hover:border-[#E8D200]/30'
                                                }`}
                                            >
                                                {inviteLinkCopied ? <><Check size={11} /> Copied</> : 'Copy Link'}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-6 gap-3">
                                            <Link2 size={20} className="text-[#BBBBBB]" />
                                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#999999] font-black">No invite link yet</p>
                                            <p className="text-xs text-[#AAAAAA] font-light">Generate a link to send the onboarding form to this athlete</p>
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* Cover photo */}
                            <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                                <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                    <div>
                                        <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Cover Photo</h3>
                                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Banner shown at top of the profile sheet</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {profile.cover_url && (
                                            <button
                                                onClick={handleCoverRemove}
                                                disabled={coverDeleting || coverUploading}
                                                className="h-10 px-5 bg-[#EFEFEC] border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-widest text-[#666666] hover:text-red-400 hover:border-red-200 transition-all disabled:opacity-50"
                                            >
                                                {coverDeleting ? 'Removing…' : 'Remove'}
                                            </button>
                                        )}
                                        <label className={`h-10 px-6 bg-[#EFEFEC] border border-[#E6E6E1] rounded-full flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#BBB] hover:text-[#8a7600] hover:border-[#E8D200]/30 transition-all cursor-pointer ${coverUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                            <ImagePlus size={13} />
                                            {coverUploading ? 'Uploading…' : profile.cover_url ? 'Replace' : 'Upload Cover'}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={e => { if (e.target.files?.[0]) handleCoverUpload(e.target.files[0]); e.target.value = ''; }}
                                            />
                                        </label>
                                    </div>
                                </div>
                                <div className="p-10">
                                    {profile.cover_url ? (
                                        <div className="aspect-[3/1] w-full rounded-2xl overflow-hidden bg-[#F4F4F1] border border-[#E6E6E1]">
                                            <img src={profile.cover_url} alt="" className="w-full h-full object-cover" />
                                        </div>
                                    ) : (
                                        <div className="aspect-[3/1] w-full rounded-2xl border border-dashed border-[#E6E6E1] bg-[#F4F4F1] flex flex-col items-center justify-center gap-3">
                                            <ImagePlus size={24} className="text-[#AAAAAA]" />
                                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#999999] font-black">No cover photo</p>
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* Bio */}
                            <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                                <div className="p-10 border-b border-[#E6E6E1]">
                                    <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Bio</h3>
                                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Shown on public profile and leaderboard card</p>
                                </div>
                                <div className="p-10 space-y-6">
                                    <textarea
                                        value={bioEdit}
                                        onChange={e => setBioEdit(e.target.value)}
                                        maxLength={2000}
                                        rows={10}
                                        placeholder="Write the athlete's bio here…"
                                        className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl px-6 py-5 text-[#1A1A1A] text-sm font-light leading-relaxed outline-none focus:border-[#E8D200]/40 transition-all resize-none"
                                    />
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] uppercase tracking-widest text-[#999999] font-black">{bioEdit.length}/2000</span>
                                        <button
                                            onClick={handleSaveBio}
                                            disabled={bioSaving}
                                            className="h-11 px-8 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-[10px] rounded-full hover:translate-y-[-1px] transition-all shadow-md shadow-[#E8D200]/10 disabled:opacity-50"
                                        >
                                            {bioSaving ? 'Saving…' : 'Save Bio'}
                                        </button>
                                    </div>
                                </div>
                            </section>

                            {/* Achievements */}
                            <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                                <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                    <div>
                                        <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Achievements</h3>
                                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">{achievements.length}/4 highlights · shown as pills on profile</p>
                                    </div>
                                    {achievements.length < 4 && editingAchId !== 'new' && (
                                        <button
                                            onClick={startNewAchievement}
                                            className="h-10 px-6 bg-[#EFEFEC] border border-[#E6E6E1] rounded-full flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#BBB] hover:text-[#8a7600] hover:border-[#E8D200]/30 transition-all"
                                        >
                                            <Plus size={13} />
                                            Add Achievement
                                        </button>
                                    )}
                                </div>
                                <div className="p-10 space-y-4">
                                    {achievementsLoading ? (
                                        <div className="flex justify-center py-6">
                                            <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                                        </div>
                                    ) : (
                                        <>
                                            {achievements.length === 0 && editingAchId !== 'new' && (
                                                <div className="text-center py-8">
                                                    <Trophy size={24} className="mx-auto text-[#AAAAAA] mb-3" />
                                                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#999999] font-black">No achievements yet</p>
                                                    <p className="text-xs text-[#AAAAAA] font-light mt-2">Add up to 4 career highlights</p>
                                                </div>
                                            )}

                                            {achievements.map(a => (
                                                <div key={a.id}>
                                                    {editingAchId === a.id ? (
                                                        <AchievementForm
                                                            form={achForm}
                                                            setForm={setAchForm}
                                                            saving={achSaving}
                                                            onSave={saveAchievement}
                                                            onCancel={cancelEditAchievement}
                                                        />
                                                    ) : (
                                                        <div className="group flex items-center gap-4 bg-[#F4F4F1] border-l-2 border-[#E8D200]/60 border-y border-r border-[#E6E6E1] rounded-xl px-5 py-4 hover:border-[#E8D200]/30 transition-all">
                                                            <Trophy size={16} className="text-[#8a7600] shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-[9px] uppercase tracking-[0.3em] text-[#8a7600] font-black mb-1">{a.title}</div>
                                                                <div className="text-lg font-light text-[#1A1A1A] leading-tight">{a.value}</div>
                                                                {a.context && <div className="text-xs font-light text-[#888888] mt-1">{a.context}</div>}
                                                            </div>
                                                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button
                                                                    onClick={() => startEditAchievement(a)}
                                                                    className="w-8 h-8 rounded-full bg-[#EFEFEC] border border-[#E6E6E1] flex items-center justify-center text-[#666666] hover:text-[#8a7600] hover:border-[#E8D200]/30 transition-all"
                                                                >
                                                                    <Camera size={12} />
                                                                </button>
                                                                <button
                                                                    onClick={() => deleteAchievement(a.id)}
                                                                    disabled={achDeleting === a.id}
                                                                    className="w-8 h-8 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-400 hover:bg-red-100 transition-all disabled:opacity-50"
                                                                >
                                                                    {achDeleting === a.id
                                                                        ? <div className="w-3 h-3 border border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                                                                        : <Trash2 size={12} />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}

                                            {editingAchId === 'new' && (
                                                <AchievementForm
                                                    form={achForm}
                                                    setForm={setAchForm}
                                                    saving={achSaving}
                                                    onSave={saveAchievement}
                                                    onCancel={cancelEditAchievement}
                                                />
                                            )}
                                        </>
                                    )}
                                </div>
                            </section>

                            {/* Gallery */}
                            <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                                <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                    <div>
                                        <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Gallery</h3>
                                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">{adminGallery.length}/6 photos</p>
                                    </div>
                                    {adminGallery.length < 6 && (
                                        <label className={`h-10 px-6 bg-[#EFEFEC] border border-[#E6E6E1] rounded-full flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#BBB] hover:text-[#8a7600] hover:border-[#E8D200]/30 transition-all cursor-pointer ${galleryUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                            <Plus size={13} />
                                            {galleryUploading ? 'Uploading…' : 'Add Photo'}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={e => { if (e.target.files?.[0]) handleAdminGalleryUpload(e.target.files[0]); e.target.value = ''; }}
                                            />
                                        </label>
                                    )}
                                </div>
                                <div className="p-10">
                                    {adminGalleryLoading ? (
                                        <div className="flex justify-center py-10">
                                            <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                                        </div>
                                    ) : adminGallery.length === 0 ? (
                                        <div className="text-center py-12">
                                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#999999] font-black">No gallery photos yet</p>
                                            <p className="text-xs text-[#AAAAAA] font-light mt-2">Upload above or the athlete can add photos from their app</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-3 gap-4">
                                            {adminGallery.map(photo => (
                                                <div key={photo.id} className="relative group aspect-square rounded-2xl overflow-hidden bg-[#F4F4F1] border border-[#E6E6E1]">
                                                    <img src={photo.url} alt="" className="w-full h-full object-cover" />
                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all flex items-center justify-center">
                                                        <button
                                                            onClick={() => handleAdminGalleryDelete(photo)}
                                                            disabled={galleryDeleting === photo.id}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-400 hover:bg-red-100"
                                                        >
                                                            {galleryDeleting === photo.id
                                                                ? <div className="w-4 h-4 border border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                                                                : <Trash2 size={14} />}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </section>
                        </div>
                    )}
                </div>

                {/* Right Column: Inventory & Stats */}
                <div className="space-y-16">
                    {/* Inventory / Redemptions */}
                    <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden">
                        <div className="p-10 border-b border-[#E6E6E1]">
                            <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Inventory</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">Acquired Rewards</p>
                        </div>
                        <div className="p-10 space-y-8">
                            {redemptions.length === 0 ? (
                                <div className="text-center py-10">
                                    <Gift size={32} className="mx-auto text-[#333333] mb-4" />
                                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">No rewards redeemed</p>
                                </div>
                            ) : redemptions.map(r => (
                                <div key={r.id} className="bg-[#F4F4F1] border border-[#E6E6E1] p-8 rounded-3xl group hover:border-[#E8D200]/20 transition-all">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="text-lg font-bold text-[#222222] group-hover:text-[#1A1A1A] transition-colors leading-tight">{r.rewards?.title}</div>
                                        <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.2em] ${r.status === 'active' ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20' : 'bg-[#EFEFEC] text-[#666666]'}`}>
                                            {r.status}
                                        </span>
                                    </div>
                                    <div className="font-mono text-xs text-[#8a7600] bg-white p-3 rounded-xl border border-[#E6E6E1] text-center tracking-[0.3em] mb-4 uppercase">
                                        {r.code}
                                    </div>
                                    <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-[0.3em] text-[#666666]">
                                        <span>{r.rewards?.powr_cost} PTS</span>
                                        <span>{new Date(r.redeemed_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Meta / System Diagnostics */}
                    <section className="bg-white border border-[#E6E6E1] p-10 rounded-[2rem]">
                        <h3 className="text-base font-black uppercase tracking-[0.3em] text-[#555555] mb-10">Diagnostic Data</h3>
                        <div className="space-y-6">
                            {[
                                {
                                    label: 'Location Access',
                                    value: locationState
                                        ? `${locationState.detail}${reducedAccuracy ? ' · PRECISE OFF' : ''}${accuracyLabel ? ` · fix ${accuracyLabel}` : ''}${locationCheckedAt ? ` · as of ${locationCheckedAt}` : ''}`
                                        : (profile.location_granted ? 'Granted (legacy flag)' : 'Unknown (legacy flag)'),
                                    icon: MapPin,
                                    // Reduced accuracy breaks geofencing even on 'always' — never show it green.
                                    highlight: !reducedAccuracy && (profile.location_permission === 'always' || (!profile.location_permission && profile.location_granted)),
                                },
                                { label: 'Node Uptime', value: '182 Days', icon: Clock },
                                { label: 'Sync Status', value: 'Verified', icon: Shield },
                                { label: 'Risk Factor', value: 'Low (0.02)', icon: AlertCircle },
                            ].map(x => (
                                <div key={x.label} className="flex items-center justify-between p-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                    <div className="flex items-center gap-4">
                                        <x.icon size={14} className={x.highlight ? 'text-[#10B981]' : 'text-[#666666]'} />
                                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#666666] font-black">{x.label}</span>
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

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center" onClick={() => setDeleteConfirm(false)}>
                    <div className="bg-white border border-red-200 rounded-3xl p-12 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mb-8">
                            <Trash2 size={22} className="text-red-400" />
                        </div>
                        <h3 className="text-2xl font-light tracking-tighter text-[#1A1A1A] mb-3">Delete User?</h3>
                        <p className="text-[#999999] text-sm font-light mb-2 leading-relaxed">
                            <span className="text-[#333333] font-medium">{profile.display_name || profile.username}</span>
                        </p>
                        <p className="text-[#999999] text-sm font-light mb-10 leading-relaxed">This permanently removes the account, all activity data, and point history. This cannot be undone.</p>
                        <div className="flex gap-4">
                            <button onClick={() => setDeleteConfirm(false)} className="flex-1 h-12 bg-[#EFEFEC] border border-[#E6E6E1] rounded-xl text-[10px] font-black uppercase tracking-widest text-[#666666] hover:text-[#1A1A1A] transition-colors">
                                Cancel
                            </button>
                            <button onClick={handleDeleteUser} disabled={deleteLoading} className="flex-1 h-12 bg-red-50 border border-red-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-100 transition-all disabled:opacity-50">
                                {deleteLoading ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function AchievementForm({ form, setForm, saving, onSave, onCancel }) {
    return (
        <div className="bg-[#F4F4F1] border border-[#E8D200]/25 rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-[9px] uppercase tracking-widest text-[#BBB] font-black mb-2">Title (category)</label>
                    <input
                        type="text"
                        value={form.title}
                        onChange={e => setForm({ ...form, title: e.target.value })}
                        placeholder="Women's Pro Solo"
                        maxLength={60}
                        className="w-full h-11 px-4 bg-white border border-[#E6E6E1] rounded-lg text-[#1A1A1A] text-sm outline-none focus:border-[#E8D200]/40 transition-all"
                    />
                </div>
                <div>
                    <label className="block text-[9px] uppercase tracking-widest text-[#BBB] font-black mb-2">Value</label>
                    <input
                        type="text"
                        value={form.value}
                        onChange={e => setForm({ ...form, value: e.target.value })}
                        placeholder="01:09:30"
                        maxLength={40}
                        className="w-full h-11 px-4 bg-white border border-[#E6E6E1] rounded-lg text-[#1A1A1A] text-sm outline-none focus:border-[#E8D200]/40 transition-all"
                    />
                </div>
            </div>
            <div>
                <label className="block text-[9px] uppercase tracking-widest text-[#BBB] font-black mb-2">Context (optional)</label>
                <input
                    type="text"
                    value={form.context}
                    onChange={e => setForm({ ...form, context: e.target.value })}
                    placeholder="Toulouse · 2024"
                    maxLength={60}
                    className="w-full h-11 px-4 bg-white border border-[#E6E6E1] rounded-lg text-[#1A1A1A] text-sm outline-none focus:border-[#E8D200]/40 transition-all"
                />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
                <button
                    onClick={onCancel}
                    className="h-10 px-5 bg-[#EFEFEC] border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-widest text-[#666666] hover:text-[#1A1A1A] transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={onSave}
                    disabled={saving}
                    className="h-10 px-6 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-[10px] rounded-full hover:translate-y-[-1px] transition-all shadow-md shadow-[#E8D200]/10 disabled:opacity-50 flex items-center gap-2"
                >
                    <Check size={13} />
                    {saving ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>
    );
}
