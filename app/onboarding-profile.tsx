import { useAuth } from '@/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';
import {
    fetchProfile,
    isUsernameAvailable,
    updateProfile,
    uploadAvatar,
} from '@/lib/api/user';
import { ONBOARDING_DOT_COUNT, dotIndexFor } from '@/lib/onboarding/flow';
import {
    MAX_USERNAME,
    MIN_USERNAME,
    canSubmitProfile,
    normalizeUsername,
    suggestUsernameBase,
    type UsernameStatus,
} from '@/lib/onboarding/username';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_REGULAR = 'Outfit_400Regular';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';

const NEXT_SCREEN = '/onboarding-permission';

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {Array.from({ length: ONBOARDING_DOT_COUNT }, (_, i) => i).map(i => (
                <View
                    key={i}
                    style={[
                        dotStyles.dot,
                        i === current ? dotStyles.dotActive : dotStyles.dotInactive,
                    ]}
                />
            ))}
        </View>
    );
}

const dotStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 6,
        justifyContent: 'center',
        marginBottom: 20,
    },
    dot: {
        height: 5,
        borderRadius: 3,
    },
    dotActive: {
        width: 20,
        backgroundColor: GOLD,
    },
    dotInactive: {
        width: 5,
        backgroundColor: 'rgba(255,255,255,0.15)',
    },
});

export default function OnboardingProfileScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { session } = useAuth();

    const [displayName, setDisplayName] = useState('');
    const [username, setUsername] = useState('');
    const [avatarUri, setAvatarUri] = useState<string | null>(null);
    const [avatarChanged, setAvatarChanged] = useState(false);
    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const checkSeq = useRef(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fade = useRef(new Animated.Value(0)).current;

    // ── Prefill from existing profile / OAuth metadata ────────────────────────
    useEffect(() => {
        (async () => {
            const meta = session?.user?.user_metadata ?? {};
            const metaName: string | undefined = meta.full_name ?? meta.name;
            const email: string | undefined = session?.user?.email ?? undefined;

            const profile = await fetchProfile();
            const initialName = (profile?.display_name ?? metaName ?? '').trim();
            setDisplayName(initialName);
            if (profile?.avatar_url) setAvatarUri(profile.avatar_url);

            if (profile?.username) {
                setUsername(profile.username);
                setUsernameStatus('available'); // their own handle
            } else {
                // Auto-suggest from name, falling back to the email local-part
                const base = suggestUsernameBase(initialName, email);
                if (base.length >= MIN_USERNAME) {
                    await suggestUsername(base);
                }
            }
        })();

        Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Picks a free handle close to `base`, appending digits on collision.
    async function suggestUsername(base: string) {
        const trimmed = base.slice(0, MAX_USERNAME);
        const { available } = await isUsernameAvailable(trimmed);
        if (available) {
            setUsername(trimmed);
            setUsernameStatus('available');
            return;
        }
        const suffixed = `${trimmed.slice(0, MAX_USERNAME - 3)}${Math.floor(100 + Math.random() * 900)}`;
        const second = await isUsernameAvailable(suffixed);
        setUsername(suffixed);
        setUsernameStatus(second.available ? 'available' : 'idle');
    }

    // ── Live username availability (debounced) ────────────────────────────────
    function onChangeUsername(raw: string) {
        const next = normalizeUsername(raw);
        setUsername(next);
        setError(null);

        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (next.length < MIN_USERNAME) {
            setUsernameStatus(next.length === 0 ? 'idle' : 'invalid');
            return;
        }

        setUsernameStatus('checking');
        const seq = ++checkSeq.current;
        debounceRef.current = setTimeout(async () => {
            const { available, error: checkErr } = await isUsernameAvailable(next);
            if (seq !== checkSeq.current) return; // a newer keystroke superseded us
            if (checkErr) { setUsernameStatus('idle'); return; }
            setUsernameStatus(available ? 'available' : 'taken');
        }, 400);
    }

    const trimmedName = displayName.trim();
    const canContinue = canSubmitProfile(displayName, username, usernameStatus) && !saving;

    // ── Avatar picker ─────────────────────────────────────────────────────────
    async function pickImage(source: 'library' | 'camera') {
        try {
            const perm =
                source === 'camera'
                    ? await ImagePicker.requestCameraPermissionsAsync()
                    : await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (perm.status !== 'granted') {
                Alert.alert(
                    'Permission required',
                    source === 'camera'
                        ? 'Please allow camera access in Settings to take a photo.'
                        : 'Please allow photo library access in Settings to choose a photo.',
                );
                return;
            }

            // On Android, allowsEditing opens a separate crop Activity that can
            // destroy the RN Activity (losing state). Keep editing iOS-only.
            const allowsEditing = Platform.OS !== 'android';
            const result =
                source === 'camera'
                    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing, aspect: [1, 1], quality: 0.8 })
                    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing, aspect: [1, 1], quality: 0.8 });

            if (!result.canceled && result.assets[0]) {
                setAvatarUri(result.assets[0].uri);
                setAvatarChanged(true);
            }
        } catch (e) {
            console.warn('[OnboardingProfile] Image picker error:', e);
            Alert.alert('Could not select photo', 'Please try again.');
        }
    }

    function showPhotoOptions() {
        Alert.alert('Profile photo', 'Choose a source', [
            { text: 'Take photo', onPress: () => pickImage('camera') },
            { text: 'Choose from library', onPress: () => pickImage('library') },
            ...(avatarUri
                ? [{ text: 'Remove photo', style: 'destructive' as const, onPress: () => { setAvatarUri(null); setAvatarChanged(true); } }]
                : []),
            { text: 'Cancel', style: 'cancel' },
        ]);
    }

    // ── Continue ──────────────────────────────────────────────────────────────
    async function handleContinue() {
        if (!canContinue) return;
        setSaving(true);
        setError(null);
        try {
            const updates: Parameters<typeof updateProfile>[0] = {
                display_name: trimmedName,
                username,
            };

            // Only re-upload when the user picked a new local image. A remote
            // OAuth avatar prefilled into avatarUri is already persisted.
            if (avatarChanged) {
                if (avatarUri) {
                    const { url, error: uploadErr } = await uploadAvatar(avatarUri);
                    if (uploadErr) {
                        setError(uploadErr);
                        setSaving(false);
                        return;
                    }
                    updates.avatar_url = url;
                } else {
                    updates.avatar_url = null;
                }
            }

            const { error: saveErr } = await updateProfile(updates);
            if (saveErr) {
                // Unique-violation backstop: the handle was claimed mid-flow.
                const taken = /duplicate|unique/i.test(saveErr);
                setError(taken ? 'That username was just taken — try another.' : saveErr);
                if (taken) setUsernameStatus('taken');
                setSaving(false);
                return;
            }

            router.push(NEXT_SCREEN);
        } catch (e: any) {
            setError(e?.message ?? 'Something went wrong');
        } finally {
            setSaving(false);
        }
    }

    const initials = trimmedName
        ? trimmedName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
        : '';

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <GeometricBackground />

            {/* Back button */}
            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => {
                    if (router.canGoBack()) router.back();
                    else router.replace('/onboarding-account');
                }}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

            <Animated.View style={[styles.center, { paddingTop: insets.top + 70, opacity: fade }]}>
                <Text style={styles.eyebrow}>YOUR PROFILE</Text>
                <Text style={styles.headline}>
                    Claim your <Text style={styles.headlineGold}>name.</Text>
                </Text>
                <Text style={styles.body}>
                    This is how you'll show up on the leaderboard.
                </Text>

                {/* Avatar */}
                <Pressable style={styles.avatarWrap} onPress={showPhotoOptions}>
                    {avatarUri ? (
                        <Image key={avatarUri} source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
                    ) : (
                        <View style={[styles.avatar, styles.avatarPlaceholder]}>
                            <Text style={styles.avatarInitials}>{initials || ' '}</Text>
                        </View>
                    )}
                    <View style={styles.avatarBadge}>
                        <Ionicons name="camera" size={15} color="#0a0a0a" />
                    </View>
                </Pressable>
                <Text style={styles.avatarHint}>Add a photo (optional)</Text>

                {/* Display name */}
                <View style={styles.fieldBlock}>
                    <Text style={styles.label}>Display name</Text>
                    <TextInput
                        style={styles.input}
                        value={displayName}
                        onChangeText={(t) => { setDisplayName(t); setError(null); }}
                        placeholder="Your name"
                        placeholderTextColor="rgba(255,255,255,0.25)"
                        autoCapitalize="words"
                        maxLength={40}
                        returnKeyType="next"
                    />
                </View>

                {/* Username */}
                <View style={styles.fieldBlock}>
                    <Text style={styles.label}>Username</Text>
                    <View style={styles.usernameRow}>
                        <Text style={styles.atSign}>@</Text>
                        <TextInput
                            style={styles.usernameInput}
                            value={username}
                            onChangeText={onChangeUsername}
                            placeholder="username"
                            placeholderTextColor="rgba(255,255,255,0.25)"
                            autoCapitalize="none"
                            autoCorrect={false}
                            maxLength={MAX_USERNAME}
                            returnKeyType="done"
                        />
                        <View style={styles.usernameStatus}>
                            {usernameStatus === 'checking' && <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />}
                            {usernameStatus === 'available' && <Ionicons name="checkmark-circle" size={20} color={GOLD} />}
                            {usernameStatus === 'taken' && <Ionicons name="close-circle" size={20} color="#ff6b6b" />}
                        </View>
                    </View>
                    <Text style={styles.helper}>
                        {usernameStatus === 'taken'
                            ? 'That username is taken.'
                            : usernameStatus === 'invalid'
                                ? `At least ${MIN_USERNAME} characters — letters, numbers or _.`
                                : 'Lowercase letters, numbers and underscores.'}
                    </Text>
                </View>

                {error && (
                    <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}
            </Animated.View>

            {/* Bottom */}
            <View style={[styles.bottom, { paddingBottom: insets.bottom + 28 }]}>
                <StepDots current={dotIndexFor('/onboarding-profile')} />
                <Pressable
                    style={[styles.primaryButton, !canContinue && styles.primaryButtonDisabled]}
                    onPress={handleContinue}
                    disabled={!canContinue}
                >
                    {saving
                        ? <ActivityIndicator color="#0a0a0a" size="small" />
                        : <Text style={styles.primaryLabel}>CONTINUE</Text>}
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BG,
    },
    backButton: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
        padding: 4,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 28,
    },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 10,
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 12,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 36,
        fontFamily: FONT_LIGHT,
        fontWeight: '200',
        letterSpacing: -1,
        lineHeight: 42,
        textAlign: 'center',
        marginBottom: 8,
    },
    headlineGold: {
        color: GOLD,
        fontFamily: FONT_SEMIBOLD,
        fontWeight: '700',
    },
    body: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 14,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        lineHeight: 22,
        textAlign: 'center',
        marginBottom: 24,
    },
    avatarWrap: {
        width: 104,
        height: 104,
        marginBottom: 8,
    },
    avatar: {
        width: 104,
        height: 104,
        borderRadius: 52,
        backgroundColor: CARD_BG,
    },
    avatarPlaceholder: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: BORDER,
    },
    avatarInitials: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 32,
        fontFamily: FONT_SEMIBOLD,
        fontWeight: '600',
    },
    avatarBadge: {
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 3,
        borderColor: BG,
    },
    avatarHint: {
        color: 'rgba(255,255,255,0.3)',
        fontSize: 12,
        fontFamily: FONT_REGULAR,
        marginBottom: 24,
    },
    fieldBlock: {
        width: '100%',
        marginBottom: 16,
    },
    label: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 12,
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
        letterSpacing: 0.4,
        marginBottom: 8,
        marginLeft: 4,
    },
    input: {
        height: 52,
        borderRadius: 14,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 16,
        color: '#F2F2F2',
        fontSize: 16,
        fontFamily: FONT_REGULAR,
    },
    usernameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 52,
        borderRadius: 14,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 16,
    },
    atSign: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 16,
        fontFamily: FONT_REGULAR,
        marginRight: 2,
    },
    usernameInput: {
        flex: 1,
        color: '#F2F2F2',
        fontSize: 16,
        fontFamily: FONT_REGULAR,
        paddingVertical: 0,
    },
    usernameStatus: {
        width: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    helper: {
        color: 'rgba(255,255,255,0.3)',
        fontSize: 12,
        fontFamily: FONT_REGULAR,
        marginTop: 6,
        marginLeft: 4,
    },
    errorBox: {
        width: '100%',
        backgroundColor: 'rgba(255,60,60,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,60,60,0.25)',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginTop: 4,
    },
    errorText: {
        color: '#ff6b6b',
        fontSize: 13,
        fontFamily: FONT_REGULAR,
        textAlign: 'center',
        lineHeight: 18,
    },
    bottom: {
        paddingHorizontal: 24,
        zIndex: 1,
    },
    primaryButton: {
        height: 52,
        borderRadius: 26,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButtonDisabled: {
        opacity: 0.4,
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontFamily: FONT_SEMIBOLD,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
});
