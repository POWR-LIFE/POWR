import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Polyline, Stop } from 'react-native-svg';

import { ProBadge } from '@/components/ui/ProBadge';
import { ACHIEVEMENTS } from '@/constants/achievements';
import { ACTIVITIES, ACTIVITY_ORDER, type ActivityType } from '@/constants/activities';
import { getLevelInfo } from '@/constants/levels';
import { supabase } from '@/lib/supabase';
import { fetchAchievements, type Achievement } from '@/lib/api/pro-achievements';
import { fetchEarnedAchievementCount } from '@/lib/api/achievement-stats';
import { fetchGallery, type GalleryPhoto } from '@/lib/api/pro-gallery';
import {
    fetchFriendRelationship,
    fetchGymName,
    fetchProfileSocial,
    fetchPublicProfile,
    type FriendRelationship,
    type MutualFriend,
    type ProfileSocial,
    type PublicProfile,
} from '@/lib/api/user';
import { fetchProfileStats, type ProfileStats } from '@/lib/api/user-stats';
import { LEAGUE_TIERS } from '@/lib/journey';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');

const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const RED    = '#ef4444';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const BORDER = 'rgba(255,255,255,0.08)';
const THUMB  = Math.floor((SCREEN_W - 32 - 8) / 3);

interface UserProfileSheetProps {
    userId: string | null;
    myPoints?: number;
    userPoints?: number;
    /**
     * Friendship state with this user, if the caller already knows it (e.g. the
     * friends screen, which holds the whole graph). Omit to resolve it via RPC.
     */
    relationship?: FriendRelationship;
    /** Fired after a friend action succeeds, so parent lists can refresh. */
    onChanged?: () => void;
    onClose: () => void;
}

export function UserProfileSheet({ userId, myPoints, userPoints, relationship, onChanged, onClose }: UserProfileSheetProps) {
    const insets = useSafeAreaInsets();
    const slideAnim = useRef(new Animated.Value(SCREEN_H)).current;
    const [profile, setProfile] = useState<PublicProfile | null>(null);
    const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
    const [achievements, setAchievements] = useState<Achievement[]>([]);
    const [stats, setStats] = useState<ProfileStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [earnedBadgeCount, setEarnedBadgeCount] = useState<number | null>(null);
    const [rel, setRel] = useState<FriendRelationship>('none');
    const [acting, setActing] = useState(false);
    const [gym, setGym] = useState<{ name: string; address: string | null } | null>(null);
    const [social, setSocial] = useState<ProfileSocial | null>(null);

    useEffect(() => {
        if (userId) {
            setLoading(true);
            setProfile(null);
            setGallery([]);
            setAchievements([]);
            setStats(null);
            setEarnedBadgeCount(null);
            setActing(false);
            setGym(null);
            setSocial(null);
            // Seed from the caller's known state for an instant CTA; otherwise resolve.
            setRel(relationship ?? 'none');
            if (relationship === undefined) {
                fetchFriendRelationship(userId).then(setRel);
            }
            fetchPublicProfile(userId).then(p => {
                setProfile(p);
                if (p?.is_pro) {
                    fetchGallery(userId).then(setGallery);
                    fetchAchievements(userId).then(setAchievements);
                }
                if (p?.preferred_gym_id) {
                    fetchGymName(p.preferred_gym_id).then(setGym);
                }
                setLoading(false);
            });
            fetchProfileStats(userId).then(setStats);
            fetchEarnedAchievementCount(userId).then(setEarnedBadgeCount);
            fetchProfileSocial(userId).then(setSocial);
            Animated.spring(slideAnim, {
                toValue: 0,
                useNativeDriver: true,
                tension: 60,
                friction: 12,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: SCREEN_H,
                duration: 220,
                useNativeDriver: true,
            }).start(() => {
                setProfile(null);
                setGallery([]);
                setAchievements([]);
                setStats(null);
            });
        }
    }, [userId]);

    const visible = !!userId;

    const initials = ((profile?.display_name ?? profile?.username) || '?')
        .split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();

    const diff = (userPoints ?? 0) - (myPoints ?? 0);
    const diffSign = diff > 0 ? '+' : '';
    const showComparison = userPoints !== undefined && myPoints !== undefined;
    // Level/tier/ring derive from canonical lifetime-earned (positive ledger all
    // types + pending vault) so the pill matches the home screen and the server
    // level_up push. totalPoints (earn/adjustment only) would render a level too
    // low for anyone holding streak/bonus/vault credit. userPoints is only a
    // pre-load placeholder until stats resolves.
    const profileLevelBasis = stats?.totalEarned ?? userPoints ?? 0;
    const { current: computedLevel } = getLevelInfo(profileLevelBasis);

    const runFriendAction = async (
        action: 'request' | 'accept' | 'decline' | 'remove',
        nextRel: FriendRelationship,
    ) => {
        if (!userId || acting) return;
        setActing(true);
        Haptics.selectionAsync();
        const { error } = await supabase.functions.invoke('manage-friendship', {
            body: { action, target_user_id: userId },
        });
        setActing(false);
        if (error) {
            Alert.alert('Something went wrong', "We couldn't update that just now — please try again.");
            return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setRel(nextRel);
        onChanged?.();
    };

    const confirmRemove = () => {
        const name = profile?.display_name ?? profile?.username ?? 'this person';
        Alert.alert(
            `Remove ${name}?`,
            "They'll be taken off your friends list. Any challenges you're both in keep running, and you can add each other again anytime.",
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => runFriendAction('remove', 'none') },
            ],
        );
    };

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
            {/* Backdrop */}
            <Pressable style={s.backdrop} onPress={onClose} />

            <Animated.View style={[
                s.sheet,
                { paddingBottom: insets.bottom + 16, transform: [{ translateY: slideAnim }] },
            ]}>
                {/* Drag handle */}
                <View style={s.dragHandle} />

                {/* Cover photo */}
                {profile?.cover_url ? (
                    <Image source={{ uri: profile.cover_url }} style={s.cover} contentFit="cover" />
                ) : null}

                <ScrollView
                    style={s.scroll}
                    contentContainerStyle={s.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {loading && (
                        <View style={s.loadingRow}>
                            <Text style={s.loadingText}>Loading…</Text>
                        </View>
                    )}

                    {!loading && profile && (
                        <>
                            {/* Avatar + identity row */}
                            <View style={[s.headerRow, !profile.cover_url && { marginTop: 8 }]}>
                                <AvatarWithRing
                                    avatarUrl={profile.avatar_url}
                                    initials={initials}
                                    totalPoints={profileLevelBasis}
                                    overCover={!!profile.cover_url}
                                />
                                <View style={s.identity}>
                                    <Text style={s.displayName} numberOfLines={1}>
                                        {profile.display_name ?? profile.username ?? 'Unknown'}
                                    </Text>
                                    {profile.username ? (
                                        <Text style={s.userHandle} numberOfLines={1}>@{profile.username}</Text>
                                    ) : null}
                                    <View style={s.identityPills}>
                                        {profile.is_pro && <ProBadge size="sm" />}
                                        <TierPill totalPoints={profileLevelBasis} />
                                        <View style={s.levelPill}>
                                            <Text style={s.levelText}>LVL {computedLevel.level}</Text>
                                        </View>
                                    </View>
                                </View>
                            </View>

                            {/* Home gym · member since */}
                            <ProfileMetaRow gym={gym} memberSince={profile.created_at} />

                            {/* Sports they train */}
                            <SportChips prefs={profile.activity_preferences} />

                            {/* Friend action — the social loop; hidden for yourself / blocked */}
                            {rel !== 'self' && rel !== 'blocked' && (
                                <FriendActionButton
                                    rel={rel}
                                    acting={acting}
                                    onAdd={() => runFriendAction('request', 'pending_outgoing')}
                                    onAccept={() => runFriendAction('accept', 'accepted')}
                                    onDecline={() => runFriendAction('decline', 'none')}
                                    onRemove={confirmRemove}
                                />
                            )}

                            {/* Social proof — mutual friends + their friend count */}
                            {social && (social.mutualCount > 0 || social.friendCount > 0) && (
                                <MutualFriendsRow social={social} />
                            )}

                            {/* Relationship depth — only once you're connected */}
                            {rel === 'accepted' && social && (social.friendsSince || social.challengesTogether > 0) && (
                                <RelationshipDepth social={social} />
                            )}

                            {/* Stat strip: streak | 7-day sparkline | sessions */}
                            {stats && (
                                <StatStrip stats={stats} />
                            )}

                            {/* Badge count pill */}
                            {earnedBadgeCount !== null && earnedBadgeCount > 0 && (
                                <View style={s.badgePillRow}>
                                    <Ionicons name="trophy" size={13} color="#E8D200" />
                                    <Text style={s.badgePillText}>
                                        {earnedBadgeCount} / {ACHIEVEMENTS.length} achievements
                                    </Text>
                                </View>
                            )}

                            {/* Achievements grid (pro only) */}
                            {achievements.length > 0 && (
                                <View style={s.achievementsSection}>
                                    <Text style={s.sectionLabel}>ACHIEVEMENTS</Text>
                                    <AchievementsGrid achievements={achievements} />
                                </View>
                            )}

                            {/* Bio */}
                            {profile.bio ? (
                                <Text style={s.bio}>{profile.bio}</Text>
                            ) : null}

                            {/* Points comparison */}
                            {showComparison && (
                                <View style={s.compareCard}>
                                    <View style={s.compareStat}>
                                        <Text style={s.compareNum}>{(userPoints ?? 0).toLocaleString()}</Text>
                                        <Text style={s.compareLabel}>THEIR PTS</Text>
                                    </View>
                                    <View style={s.compareDivider} />
                                    <View style={s.compareStat}>
                                        <Text style={[s.compareNum, { color: diff > 0 ? RED : GREEN }]}>
                                            {diffSign}{Math.abs(diff).toLocaleString()}
                                        </Text>
                                        <Text style={s.compareLabel}>VS YOU</Text>
                                    </View>
                                    <View style={s.compareDivider} />
                                    <View style={s.compareStat}>
                                        <Text style={s.compareNum}>{(myPoints ?? 0).toLocaleString()}</Text>
                                        <Text style={s.compareLabel}>YOUR PTS</Text>
                                    </View>
                                </View>
                            )}

                            {/* Activity breakdown (last 30 days) */}
                            {stats && stats.activityBreakdown.length > 0 && (
                                <View style={s.breakdownSection}>
                                    <Text style={s.sectionLabel}>ACTIVITY · LAST 30 DAYS</Text>
                                    <ActivityBreakdown breakdown={stats.activityBreakdown} total={stats.sessionCount30d} />
                                </View>
                            )}

                            {/* Gallery */}
                            {gallery.length > 0 && (
                                <View style={s.gallerySection}>
                                    <Text style={s.sectionLabel}>GALLERY</Text>
                                    <View style={s.galleryGrid}>
                                        {gallery.map(photo => (
                                            <Image
                                                key={photo.id}
                                                source={{ uri: photo.url }}
                                                style={{ width: THUMB, height: THUMB, borderRadius: 8 }}
                                                contentFit="cover"
                                            />
                                        ))}
                                    </View>
                                </View>
                            )}
                        </>
                    )}
                </ScrollView>

                {/* Close button */}
                <Pressable style={s.closeBtn} onPress={onClose} hitSlop={12}>
                    <Ionicons name="close" size={18} color={TEXT} />
                </Pressable>
            </Animated.View>
        </Modal>
    );
}

// ─── FriendActionButton — Add / Requested / Accept+Decline / Friends ─────────

function FriendActionButton({
    rel,
    acting,
    onAdd,
    onAccept,
    onDecline,
    onRemove,
}: {
    rel: FriendRelationship;
    acting: boolean;
    onAdd: () => void;
    onAccept: () => void;
    onDecline: () => void;
    onRemove: () => void;
}) {
    if (rel === 'pending_outgoing') {
        return (
            <View style={s.friendPill}>
                <Ionicons name="paper-plane-outline" size={14} color={DIM} />
                <Text style={s.friendPillText}>Requested</Text>
            </View>
        );
    }

    if (rel === 'pending_incoming') {
        return (
            <View style={s.friendRow}>
                <Pressable
                    style={[s.friendPrimary, { flex: 1 }, acting && s.btnDisabled]}
                    onPress={onAccept}
                    disabled={acting}
                >
                    {acting ? <ActivityIndicator color="#0a0a0a" /> : (
                        <>
                            <Ionicons name="checkmark" size={16} color="#0a0a0a" />
                            <Text style={s.friendPrimaryText}>Accept request</Text>
                        </>
                    )}
                </Pressable>
                <Pressable style={s.friendGhost} onPress={onDecline} disabled={acting} hitSlop={8} accessibilityLabel="Decline request">
                    <Ionicons name="close" size={18} color={DIM} />
                </Pressable>
            </View>
        );
    }

    if (rel === 'accepted') {
        // Tapping a "Friends" chip offers to remove — matches the friends-list affordance.
        return (
            <Pressable style={s.friendChip} onPress={onRemove} disabled={acting} accessibilityLabel="Friends — tap to remove">
                <Ionicons name="checkmark-circle" size={15} color={GREEN} />
                <Text style={s.friendChipText}>Friends</Text>
            </Pressable>
        );
    }

    // 'none' — the default add CTA
    return (
        <Pressable style={[s.friendPrimary, acting && s.btnDisabled]} onPress={onAdd} disabled={acting}>
            {acting ? <ActivityIndicator color="#0a0a0a" /> : (
                <>
                    <Ionicons name="person-add" size={15} color="#0a0a0a" />
                    <Text style={s.friendPrimaryText}>Add friend</Text>
                </>
            )}
        </Pressable>
    );
}

// ─── ProfileMetaRow — home gym · member since ────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthYear(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function ProfileMetaRow({
    gym,
    memberSince,
}: {
    gym: { name: string; address: string | null } | null;
    memberSince: string | null;
}) {
    const since = monthYear(memberSince);
    if (!gym && !since) return null;
    return (
        <View style={s.metaRow}>
            {gym && (
                <View style={s.metaItem}>
                    <Ionicons name="location" size={13} color={DIM} />
                    <Text style={s.metaText} numberOfLines={1}>{gym.name}</Text>
                </View>
            )}
            {gym && since && <View style={s.metaDot} />}
            {since && (
                <View style={s.metaItem}>
                    <Ionicons name="calendar-outline" size={12} color={DIM} />
                    <Text style={s.metaText}>Joined {since}</Text>
                </View>
            )}
        </View>
    );
}

// ─── SportChips — the activities they train ──────────────────────────────────

function SportChips({ prefs }: { prefs: string[] | null }) {
    const set = new Set(prefs ?? []);
    const types = ACTIVITY_ORDER.filter(
        (t): t is ActivityType => t !== 'sleep' && set.has(t) && !!ACTIVITIES[t],
    );
    if (types.length === 0) return null;
    return (
        <View style={s.chipsRow}>
            {types.map(t => {
                const cfg = ACTIVITIES[t];
                const Icon = cfg.iconLib === 'material-community' ? MaterialCommunityIcons : Ionicons;
                return (
                    <View
                        key={t}
                        style={[s.chip, { borderColor: `${cfg.colour}40`, backgroundColor: `${cfg.colour}14` }]}
                    >
                        <Icon name={cfg.icon as any} size={12} color={cfg.colour} />
                        <Text style={[s.chipText, { color: cfg.colour }]}>{cfg.labelShort}</Text>
                    </View>
                );
            })}
        </View>
    );
}

// ─── MutualFriendsRow — social proof: friends in common + their friend count ──

function miniInitials(name: string | null): string {
    return (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function MiniAvatar({ url, name, index }: { url: string | null; name: string | null; index: number }) {
    return (
        <View style={[s.miniAvatar, index > 0 && { marginLeft: -8 }]}>
            {url ? (
                <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="cover" />
            ) : (
                <View style={s.miniFallback}>
                    <Text style={s.miniLetter}>{miniInitials(name)}</Text>
                </View>
            )}
        </View>
    );
}

function mutualLabel(preview: MutualFriend[], total: number): string {
    const names = preview
        .map(m => m.display_name ?? (m.username ? `@${m.username}` : 'Someone'))
        .slice(0, 2);
    const remaining = total - names.length;
    const tail = remaining > 0 ? ` +${remaining}` : '';
    return `You both know ${names.join(', ')}${tail}`;
}

function MutualFriendsRow({ social }: { social: ProfileSocial }) {
    const { mutualPreview, mutualCount, friendCount } = social;
    const hasMutuals = mutualCount > 0;
    return (
        <View style={s.socialCard}>
            {hasMutuals && mutualPreview.length > 0 ? (
                <View style={s.avatarStack}>
                    {mutualPreview.map((m, i) => (
                        <MiniAvatar key={m.id} url={m.avatar_url} name={m.display_name ?? m.username} index={i} />
                    ))}
                </View>
            ) : (
                <Ionicons name="people" size={16} color={DIM} />
            )}
            <View style={{ flex: 1 }}>
                {hasMutuals && (
                    <Text style={s.socialTitle} numberOfLines={2}>{mutualLabel(mutualPreview, mutualCount)}</Text>
                )}
                <Text style={[s.socialSub, !hasMutuals && { color: TEXT }]}>
                    {friendCount} {friendCount === 1 ? 'friend' : 'friends'}
                </Text>
            </View>
        </View>
    );
}

// ─── RelationshipDepth — friends-only: how connected you two are ──────────────

function RelationshipDepth({ social }: { social: ProfileSocial }) {
    const since = monthYear(social.friendsSince);
    const items: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string }[] = [];
    if (since) items.push({ icon: 'heart', color: '#f472b6', text: `Friends since ${since}` });
    if (social.challengesTogether > 0) {
        items.push({
            icon: 'trophy',
            color: GOLD,
            text: `${social.challengesTogether} ${social.challengesTogether === 1 ? 'challenge' : 'challenges'} together`,
        });
    }
    if (items.length === 0) return null;
    return (
        <View style={s.depthRow}>
            {items.map((it, i) => (
                <View key={i} style={s.depthItem}>
                    <Ionicons name={it.icon} size={12} color={it.color} />
                    <Text style={s.depthText}>{it.text}</Text>
                </View>
            ))}
        </View>
    );
}

// ─── AvatarWithRing — tier progress ring around avatar ───────────────────────

function AvatarWithRing({
    avatarUrl,
    initials,
    totalPoints,
    overCover,
}: {
    avatarUrl: string | null;
    initials: string;
    totalPoints: number;
    overCover: boolean;
}) {
    const SIZE = 80;
    const RING_PAD = 5;
    const OUTER = SIZE + RING_PAD * 2;
    const R = (OUTER - 3) / 2;
    const C = 2 * Math.PI * R;

    // Tier progression
    const { tier, progress, nextTier } = getTierProgress(totalPoints);
    const tierColour = tier.colour;

    return (
        <View style={[
            { width: OUTER, height: OUTER, alignItems: 'center', justifyContent: 'center' },
            overCover && { marginTop: -OUTER / 2 - 4 },
        ]}>
            {/* Ring */}
            <Svg width={OUTER} height={OUTER} style={{ position: 'absolute' }}>
                <Defs>
                    <SvgLinearGradient id="tierGrad" x1="0" y1="0" x2="1" y2="1">
                        <Stop offset="0" stopColor={tierColour} stopOpacity="1" />
                        <Stop offset="1" stopColor={tierColour} stopOpacity="0.4" />
                    </SvgLinearGradient>
                </Defs>
                <Circle cx={OUTER / 2} cy={OUTER / 2} r={R} stroke="rgba(255,255,255,0.06)" strokeWidth={2.5} fill="none" />
                <Circle
                    cx={OUTER / 2} cy={OUTER / 2} r={R}
                    stroke="url(#tierGrad)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={`${C * progress} ${C}`}
                    transform={`rotate(-90 ${OUTER / 2} ${OUTER / 2})`}
                />
            </Svg>

            {/* Avatar */}
            <View style={{
                width: SIZE, height: SIZE, borderRadius: SIZE / 2,
                overflow: 'hidden',
                borderWidth: 2, borderColor: '#111',
            }}>
                {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={{ flex: 1 }} contentFit="cover" />
                ) : (
                    <View style={{ flex: 1, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 28, fontWeight: '600', color: '#0a0a0a' }}>{initials}</Text>
                    </View>
                )}
            </View>
        </View>
    );
}

function getTierProgress(points: number): {
    tier: typeof LEAGUE_TIERS[number];
    nextTier: typeof LEAGUE_TIERS[number] | null;
    progress: number;
} {
    let tier = LEAGUE_TIERS[0];
    let nextTier: typeof LEAGUE_TIERS[number] | null = LEAGUE_TIERS[1] ?? null;
    for (let i = 0; i < LEAGUE_TIERS.length; i++) {
        if (points >= LEAGUE_TIERS[i].threshold) {
            tier = LEAGUE_TIERS[i];
            nextTier = LEAGUE_TIERS[i + 1] ?? null;
        }
    }
    if (!nextTier) return { tier, nextTier: null, progress: 1 };
    const span = nextTier.threshold - tier.threshold;
    const into = points - tier.threshold;
    const progress = Math.min(1, Math.max(0, into / span));
    return { tier, nextTier, progress };
}

// ─── TierPill ────────────────────────────────────────────────────────────────

function TierPill({ totalPoints }: { totalPoints: number }) {
    const { tier } = getTierProgress(totalPoints);
    return (
        <View style={[s.tierPill, { borderColor: `${tier.colour}55`, backgroundColor: `${tier.colour}14` }]}>
            <View style={[s.tierDot, { backgroundColor: tier.colour }]} />
            <Text style={[s.tierText, { color: tier.colour }]}>{tier.tier.toUpperCase()}</Text>
        </View>
    );
}

// ─── AchievementsGrid — up to 4 highlight pill cards ─────────────────────────

function AchievementsGrid({ achievements }: { achievements: Achievement[] }) {
    const items = achievements.slice(0, 4);
    return (
        <View style={s.achievementsGrid}>
            {items.map(a => (
                <View key={a.id} style={s.achievementCard}>
                    <View style={s.achievementHeader}>
                        <Ionicons name="trophy" size={10} color={GOLD} />
                        <Text style={s.achievementTitle} numberOfLines={1}>{a.title.toUpperCase()}</Text>
                    </View>
                    <Text style={s.achievementValue} numberOfLines={1}>{a.value}</Text>
                    {a.context ? (
                        <Text style={s.achievementContext} numberOfLines={1}>{a.context}</Text>
                    ) : null}
                </View>
            ))}
        </View>
    );
}

// ─── StatStrip — streak | sparkline | sessions ───────────────────────────────

function StatStrip({ stats }: { stats: ProfileStats }) {
    const max = Math.max(1, ...stats.dailyPoints);
    const W = 110;
    const H = 30;
    const stepX = W / Math.max(1, stats.dailyPoints.length - 1);
    const points = stats.dailyPoints
        .map((v, i) => `${i * stepX},${H - (v / max) * (H - 3) - 1}`)
        .join(' ');
    const weekTotal = stats.dailyPoints.reduce((s, v) => s + v, 0);

    return (
        <View style={s.statStrip}>
            <View style={s.statCell}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="flame" size={13} color="#fb923c" />
                    <Text style={s.statNum}>{stats.currentStreak}</Text>
                </View>
                <Text style={s.statLabel}>DAY STREAK</Text>
                {stats.longestStreak > stats.currentStreak && (
                    <Text style={s.statSub}>{stats.longestStreak} best</Text>
                )}
            </View>
            <View style={s.statDivider} />
            <View style={[s.statCell, { flex: 1.4 }]}>
                <Svg width={W} height={H}>
                    <Defs>
                        <SvgLinearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor={GOLD} stopOpacity="0.35" />
                            <Stop offset="1" stopColor={GOLD} stopOpacity="0" />
                        </SvgLinearGradient>
                    </Defs>
                    {/* Fill polygon */}
                    <Path
                        d={`M 0,${H} ${stats.dailyPoints.map((v, i) => `L ${i * stepX},${H - (v / max) * (H - 3) - 1}`).join(' ')} L ${W},${H} Z`}
                        fill="url(#sparkFill)"
                    />
                    <Polyline
                        points={points}
                        fill="none"
                        stroke={GOLD}
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </Svg>
                <Text style={s.statLabel}>{weekTotal.toLocaleString()} PTS / 7D</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statCell}>
                <Text style={s.statNum}>{stats.sessionCount30d}</Text>
                <Text style={s.statLabel}>SESSIONS · 30D</Text>
            </View>
        </View>
    );
}

// ─── ActivityBreakdown — horizontal stacked bar + legend ─────────────────────

const ACTIVITY_COLOURS: Record<string, string> = {
    running: '#4ade80',
    walking: '#22d3ee',
    cycling: '#a78bfa',
    swimming: '#60a5fa',
    gym: '#fb923c',
    strength: '#fb923c',
    yoga: '#f472b6',
    pilates: '#f472b6',
};

function colourFor(type: string): string {
    return ACTIVITY_COLOURS[type.toLowerCase()] ?? '#64748b';
}

function ActivityBreakdown({
    breakdown,
    total,
}: {
    breakdown: { type: string; count: number }[];
    total: number;
}) {
    const top = breakdown.slice(0, 5);
    const shown = top.reduce((s, x) => s + x.count, 0);
    const rest = Math.max(0, total - shown);
    const all = rest > 0 ? [...top, { type: 'other', count: rest }] : top;

    return (
        <View style={{ gap: 10 }}>
            {/* Stacked bar */}
            <View style={s.stackBar}>
                {all.map((row, i) => (
                    <View
                        key={row.type + i}
                        style={{
                            flex: row.count,
                            backgroundColor: colourFor(row.type),
                        }}
                    />
                ))}
            </View>

            {/* Legend */}
            <View style={s.legend}>
                {all.map(row => (
                    <View key={row.type} style={s.legendItem}>
                        <View style={[s.legendDot, { backgroundColor: colourFor(row.type) }]} />
                        <Text style={s.legendType}>{row.type.toUpperCase()}</Text>
                        <Text style={s.legendCount}>{row.count}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.55)',
    },
    sheet: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        backgroundColor: '#111',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: SCREEN_H * 0.88,
        overflow: 'hidden',
    },
    dragHandle: {
        width: 36, height: 4, borderRadius: 2,
        backgroundColor: BORDER,
        alignSelf: 'center',
        marginTop: 12, marginBottom: 8,
    },
    cover: {
        width: '100%', height: 120,
    },
    scroll: { flex: 1 },
    scrollContent: {
        paddingHorizontal: 16, paddingBottom: 16, gap: 14,
    },
    loadingRow: {
        paddingVertical: 48, alignItems: 'center',
    },
    loadingText: {
        fontSize: 13, fontWeight: '300', color: MUTED,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    avatarWrap: {
        borderRadius: 44, overflow: 'hidden',
        borderWidth: 3, borderColor: '#111',
    },
    avatarOverCover: { marginTop: -40 },
    avatar: { width: 80, height: 80 },
    avatarFallback: {
        width: 80, height: 80,
        backgroundColor: GOLD,
        alignItems: 'center', justifyContent: 'center',
    },
    avatarLetter: {
        fontSize: 28, fontWeight: '600', color: '#0a0a0a',
    },
    identity: { flex: 1, gap: 2 },
    displayName: {
        fontSize: 20, fontWeight: '400',
        color: TEXT, letterSpacing: -0.3,
    },
    userHandle: {
        fontSize: 12, fontWeight: '300', color: MUTED,
    },
    identityPills: {
        flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
    },
    levelPill: {
        paddingHorizontal: 10, paddingVertical: 3,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1, borderColor: BORDER,
    },
    levelText: {
        fontSize: 10, fontWeight: '500',
        letterSpacing: 1.5, color: DIM, textTransform: 'uppercase',
    },
    bio: {
        fontSize: 13, fontWeight: '300', color: DIM,
        textAlign: 'center', lineHeight: 19,
    },
    compareCard: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 4, paddingVertical: 6,
    },
    compareStat: { flex: 1, alignItems: 'center', gap: 4 },
    compareNum: {
        fontSize: 18, fontWeight: '300',
        color: TEXT, letterSpacing: -0.5,
    },
    compareLabel: {
        fontSize: 8, fontWeight: '600',
        letterSpacing: 2, color: MUTED, textTransform: 'uppercase',
    },
    compareDivider: {
        width: 1, height: 36, backgroundColor: BORDER,
    },
    sectionLabel: {
        fontSize: 9, fontWeight: '500',
        letterSpacing: 2, color: MUTED, textTransform: 'uppercase',
    },
    // ── Friend action
    friendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    friendPrimary: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
        backgroundColor: GOLD, borderRadius: 100, paddingVertical: 11, paddingHorizontal: 16,
    },
    friendPrimaryText: { fontSize: 14, fontWeight: '700', color: '#0a0a0a', letterSpacing: 0.2 },
    friendGhost: {
        width: 44, height: 44, borderRadius: 22,
        borderWidth: 1, borderColor: BORDER,
        alignItems: 'center', justifyContent: 'center',
    },
    friendPill: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
        borderRadius: 100, paddingVertical: 11,
        borderWidth: 1, borderColor: BORDER,
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    friendPillText: { fontSize: 13, fontWeight: '500', color: DIM, letterSpacing: 0.2 },
    friendChip: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
        borderRadius: 100, paddingVertical: 11,
        borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)',
        backgroundColor: 'rgba(74,222,128,0.07)',
    },
    friendChipText: { fontSize: 13, fontWeight: '600', color: GREEN, letterSpacing: 0.2 },
    btnDisabled: { opacity: 0.6 },

    // ── Meta row (gym · joined)
    metaRow: {
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        marginTop: -4,
    },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
    metaText: { fontSize: 12, fontWeight: '400', color: DIM, flexShrink: 1 },
    metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: MUTED },

    // ── Sport chips
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -2 },
    chip: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingHorizontal: 9, paddingVertical: 4,
        borderRadius: 20, borderWidth: 1,
    },
    chipText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },

    // ── Mutual friends / friend count
    socialCard: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 10, paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1, borderColor: BORDER,
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    avatarStack: { flexDirection: 'row', alignItems: 'center' },
    miniAvatar: {
        width: 24, height: 24, borderRadius: 12,
        overflow: 'hidden', borderWidth: 1.5, borderColor: '#111',
    },
    miniFallback: { flex: 1, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    miniLetter: { fontSize: 9, fontWeight: '700', color: '#0a0a0a' },
    socialTitle: { fontSize: 13, fontWeight: '400', color: TEXT, letterSpacing: -0.2 },
    socialSub: { fontSize: 11, fontWeight: '400', color: DIM, marginTop: 1 },

    // ── Relationship depth (friends-only)
    depthRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14 },
    depthItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    depthText: { fontSize: 12, fontWeight: '400', color: DIM },

    // ── Longest streak sub-label
    statSub: { fontSize: 9, fontWeight: '500', color: '#fb923c', letterSpacing: 0.3 },

    gallerySection: { gap: 8 },
    galleryGrid: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 4,
    },
    closeBtn: {
        position: 'absolute', top: 12, right: 16,
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: 'rgba(40,40,40,0.8)',
        alignItems: 'center', justifyContent: 'center',
    },

    // ── Tier pill
    tierPill: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingHorizontal: 8, paddingVertical: 3,
        borderRadius: 20,
        borderWidth: 1,
    },
    tierDot: { width: 5, height: 5, borderRadius: 3 },
    tierText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },

    // ── Stat strip (floating, no background)
    statStrip: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 4, paddingHorizontal: 4,
    },
    statCell: { flex: 1, alignItems: 'center', gap: 4 },
    statNum: { fontSize: 20, fontWeight: '200', color: TEXT, letterSpacing: -0.3 },
    statLabel: { fontSize: 8, fontWeight: '600', letterSpacing: 1.5, color: MUTED, textTransform: 'uppercase' },
    statDivider: { width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.06)' },

    // ── Achievements
    achievementsSection: { gap: 10 },
    badgePillRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingVertical: 6,
        paddingHorizontal: 10,
        backgroundColor: 'rgba(232,210,0,0.08)',
        borderRadius: 20,
        alignSelf: 'flex-start',
        marginTop: 2,
    },
    badgePillText: {
        fontSize: 12,
        color: '#E8D200',
        fontWeight: '600',
        letterSpacing: 0.3,
    },
    achievementsGrid: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    },
    achievementCard: {
        width: '48.5%',
        paddingVertical: 10, paddingHorizontal: 12,
        borderRadius: 12,
        borderLeftWidth: 2, borderLeftColor: GOLD,
        backgroundColor: 'rgba(232,210,0,0.04)',
        gap: 2,
    },
    achievementHeader: {
        flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2,
    },
    achievementTitle: {
        fontSize: 8, fontWeight: '700', letterSpacing: 1.2,
        color: GOLD, opacity: 0.75, flex: 1,
    },
    achievementValue: {
        fontSize: 16, fontWeight: '300', color: TEXT, letterSpacing: -0.3,
    },
    achievementContext: {
        fontSize: 10, fontWeight: '300', color: DIM,
    },

    // ── Activity breakdown
    breakdownSection: { gap: 10 },
    stackBar: {
        flexDirection: 'row',
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    legend: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    },
    legendItem: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
    },
    legendDot: { width: 6, height: 6, borderRadius: 3 },
    legendType: { fontSize: 9, fontWeight: '600', color: DIM, letterSpacing: 1 },
    legendCount: { fontSize: 10, fontWeight: '400', color: TEXT },
});
