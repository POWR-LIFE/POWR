import GeometricBackground from '@/components/GeometricBackground';
import { fetchNearbyGyms, searchPartners, type Partner } from '@/context/GeofenceContext';
import { createGymRequest } from '@/lib/api/gyms';
import { setPreferredGym } from '@/lib/api/user';
import { MAP_PROVIDER } from '@/lib/mapProvider';
import { ONBOARDING_DOT_COUNT, dotIndexFor } from '@/lib/onboarding/flow';
import { continueLabel, displayedGyms, gymMarkers, hasGymCoords, toggleSelection } from '@/lib/onboarding/gym';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const DIM = 'rgba(255,255,255,0.4)';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_REGULAR = 'Outfit_400Regular';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';

const NEXT_SCREEN = '/onboarding-wearables';

const DEFAULT_REGION = {
    latitude: 51.5074,
    longitude: -0.1278,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
};

const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#1c1c1e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#686868' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#161616' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#282828' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#313131' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#585858' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#131314' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#272727' }] },
];

// Map pin showing the gym's logo (first-letter fallback), mirroring discover's
// PartnerPin. tracksViewChanges stays on until the logo image paints so the
// marker snapshot includes it (otherwise Android renders an empty pin).
function GymPin({ gym, isSelected, onPress }: { gym: Partner; isSelected: boolean; onPress: () => void }) {
    const [imageReady, setImageReady] = useState(!gym.logoUrl);
    const bg = gym.logoBg === 'white' ? '#FFFFFF' : gym.logoBg === 'black' ? '#000000' : '#1a1a1c';
    return (
        <Marker
            coordinate={{ latitude: gym.lat, longitude: gym.lng }}
            onPress={onPress}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={!imageReady || isSelected}
        >
            <View style={[styles.pin, { backgroundColor: bg }, isSelected && styles.pinSelected]}>
                {gym.logoUrl ? (
                    <Image
                        source={{ uri: gym.logoUrl }}
                        style={styles.pinLogoImg}
                        contentFit="contain"
                        onLoad={() => setImageReady(true)}
                        onError={() => setImageReady(true)}
                    />
                ) : (
                    <Text style={[styles.pinLogoText, gym.logoBg === 'white' && { color: '#1a1a1a' }]} numberOfLines={1}>
                        {(gym.name?.trim()[0] ?? '?').toUpperCase()}
                    </Text>
                )}
            </View>
        </Marker>
    );
}

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {Array.from({ length: ONBOARDING_DOT_COUNT }, (_, i) => i).map(i => (
                <View key={i} style={[dotStyles.dot, i === current ? dotStyles.dotActive : dotStyles.dotInactive]} />
            ))}
        </View>
    );
}

const dotStyles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 16 },
    dot: { height: 5, borderRadius: 3 },
    dotActive: { width: 20, backgroundColor: GOLD },
    dotInactive: { width: 5, backgroundColor: 'rgba(255,255,255,0.15)' },
});

export default function OnboardingGymScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapView>(null);

    const [nearby, setNearby] = useState<Partner[]>([]);
    const [loadingNearby, setLoadingNearby] = useState(true);
    const [search, setSearch] = useState('');
    const [searchResults, setSearchResults] = useState<Partner[] | null>(null); // null = show nearby
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [savingPreferred, setSavingPreferred] = useState(false);

    const [requestOpen, setRequestOpen] = useState(false);
    const [reqName, setReqName] = useState('');
    const [reqLocation, setReqLocation] = useState('');
    const [reqSubmitting, setReqSubmitting] = useState(false);
    const [reqSent, setReqSent] = useState(false);

    const fade = useRef(new Animated.Value(0)).current;
    const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Load "near you" via a one-shot location fix (no native geofence stack) ──
    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.getForegroundPermissionsAsync();
                if (status !== 'granted') { setLoadingNearby(false); return; }

                const fix =
                    (await Location.getLastKnownPositionAsync()) ??
                    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
                if (!fix) { setLoadingNearby(false); return; }

                const { latitude, longitude } = fix.coords;
                mapRef.current?.animateToRegion(
                    { latitude, longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 },
                    600,
                );
                const gyms = await fetchNearbyGyms(latitude, longitude, 20);
                setNearby(gyms);
            } catch (e) {
                console.warn('[OnboardingGym] nearby load failed', e);
            } finally {
                setLoadingNearby(false);
            }
        })();

        Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
        return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Debounced whole-DB search ───────────────────────────────────────────────
    function onChangeSearch(text: string) {
        setSearch(text);
        if (searchDebounce.current) clearTimeout(searchDebounce.current);
        const q = text.trim();
        if (!q) { setSearchResults(null); setSearchLoading(false); return; }
        setSearchLoading(true);
        searchDebounce.current = setTimeout(async () => {
            const results = await searchPartners(q);
            setSearchResults(results);
            setSearchLoading(false);
        }, 350);
    }

    // ── Select / deselect home gym (persists immediately) ───────────────────────
    async function selectGym(gym: Partner) {
        const next = toggleSelection(selectedId, gym.dbId);
        setSelectedId(next);
        if (next && hasGymCoords(gym)) {
            mapRef.current?.animateToRegion(
                { latitude: gym.lat, longitude: gym.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 },
                500,
            );
        }
        setSavingPreferred(true);
        await setPreferredGym(next); // fire; UI is optimistic
        setSavingPreferred(false);
    }

    async function submitRequest() {
        const name = reqName.trim();
        if (!name) return;
        setReqSubmitting(true);
        const { error } = await createGymRequest({ name, locationText: reqLocation });
        setReqSubmitting(false);
        if (error) return;
        setReqSent(true);
        setTimeout(() => {
            setRequestOpen(false);
            setReqSent(false);
            setReqName('');
            setReqLocation('');
        }, 1400);
    }

    function openRequest() {
        setReqName(search.trim());
        setReqLocation('');
        setReqSent(false);
        setRequestOpen(true);
    }

    const list = displayedGyms(searchResults, nearby);
    const markers = gymMarkers(list);
    const emptyLabel =
        searchResults !== null
            ? 'No gyms match that search.'
            : loadingNearby
                ? null
                : 'No gyms found near you — try searching by name.';

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <GeometricBackground />

            {/* Back */}
            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/onboarding-permission'); }}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

            <Animated.View style={[styles.body, { paddingTop: insets.top + 64, opacity: fade }]}>
                <Text style={styles.eyebrow}>WHERE YOU TRAIN</Text>
                <Text style={styles.headline}>
                    Your <Text style={styles.headlineGold}>home gym.</Text>
                </Text>
                <Text style={styles.sub}>Set it now to earn faster — or add it later.</Text>

                {/* Map */}
                <View style={styles.mapWrap}>
                    <MapView
                        ref={mapRef}
                        style={StyleSheet.absoluteFill}
                        provider={MAP_PROVIDER}
                        customMapStyle={DARK_MAP_STYLE}
                        initialRegion={DEFAULT_REGION}
                        showsUserLocation
                        showsMyLocationButton={false}
                        toolbarEnabled={false}
                    >
                        {markers.map(gym => (
                            <GymPin
                                key={gym.id}
                                gym={gym}
                                isSelected={gym.dbId === selectedId}
                                onPress={() => selectGym(gym)}
                            />
                        ))}
                    </MapView>
                </View>

                {/* Search */}
                <View style={styles.searchRow}>
                    <Ionicons name="search" size={16} color={DIM} />
                    <TextInput
                        style={styles.searchInput}
                        value={search}
                        onChangeText={onChangeSearch}
                        placeholder="Search for your gym"
                        placeholderTextColor="rgba(255,255,255,0.3)"
                        autoCapitalize="words"
                        autoCorrect={false}
                        returnKeyType="search"
                    />
                    {searchLoading && <ActivityIndicator size="small" color={DIM} />}
                    {!searchLoading && search.length > 0 && (
                        <Pressable onPress={() => onChangeSearch('')} hitSlop={10}>
                            <Ionicons name="close-circle" size={18} color={DIM} />
                        </Pressable>
                    )}
                </View>

                {/* List */}
                <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    {loadingNearby && searchResults === null ? (
                        <View style={styles.emptyBox}><ActivityIndicator color={DIM} /></View>
                    ) : list.length === 0 ? (
                        emptyLabel ? <View style={styles.emptyBox}><Text style={styles.emptyText}>{emptyLabel}</Text></View> : null
                    ) : (
                        list.map(gym => {
                            const isSel = gym.dbId === selectedId;
                            return (
                                <Pressable key={gym.id} style={[styles.gymRow, isSel && styles.gymRowSel]} onPress={() => selectGym(gym)}>
                                    <View
                                        style={[
                                            styles.gymLogo,
                                            { backgroundColor: gym.logoBg === 'white' ? '#FFFFFF' : gym.logoBg === 'black' ? '#000000' : 'rgba(255,255,255,0.06)' },
                                        ]}
                                    >
                                        {gym.logoUrl ? (
                                            <Image source={{ uri: gym.logoUrl }} style={styles.gymLogoImg} contentFit="contain" />
                                        ) : (
                                            <Text style={[styles.gymLogoText, gym.logoBg === 'white' && { color: '#1a1a1a' }]}>
                                                {(gym.name?.trim()[0] ?? '?').toUpperCase()}
                                            </Text>
                                        )}
                                    </View>
                                    <View style={styles.gymMeta}>
                                        <Text style={styles.gymName} numberOfLines={1}>{gym.name}</Text>
                                        {!!gym.address && <Text style={styles.gymAddr} numberOfLines={1}>{gym.address}</Text>}
                                    </View>
                                    <Ionicons
                                        name={isSel ? 'checkmark-circle' : 'ellipse-outline'}
                                        size={22}
                                        color={isSel ? GOLD : 'rgba(255,255,255,0.2)'}
                                    />
                                </Pressable>
                            );
                        })
                    )}

                    {/* Request a gym */}
                    <Pressable style={styles.requestRow} onPress={openRequest}>
                        <Ionicons name="add-circle-outline" size={18} color={DIM} />
                        <Text style={styles.requestText}>Can't find your venue? <Text style={styles.requestLink}>Request it</Text></Text>
                    </Pressable>
                </ScrollView>
            </Animated.View>

            {/* Bottom */}
            <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
                <StepDots current={dotIndexFor('/onboarding-gym')} />
                <Pressable
                    style={[styles.primaryButton, savingPreferred && { opacity: 0.7 }]}
                    onPress={() => router.push(NEXT_SCREEN)}
                >
                    <Text style={styles.primaryLabel}>{continueLabel(selectedId)}</Text>
                </Pressable>
            </View>

            {/* Request modal */}
            <Modal visible={requestOpen} transparent animationType="fade" onRequestClose={() => setRequestOpen(false)}>
                <Pressable style={styles.modalScrim} onPress={() => !reqSubmitting && setRequestOpen(false)}>
                    <Pressable style={styles.modalCard} onPress={() => {}}>
                        {reqSent ? (
                            <View style={styles.sentBox}>
                                <Ionicons name="checkmark-circle" size={42} color={GOLD} />
                                <Text style={styles.sentTitle}>Thanks!</Text>
                                <Text style={styles.sentBody}>We'll take a look and try to add it.</Text>
                            </View>
                        ) : (
                            <>
                                <Text style={styles.modalTitle}>Request a gym</Text>
                                <Text style={styles.modalSub}>Tell us where you train and we'll work on adding it.</Text>
                                <TextInput
                                    style={styles.modalInput}
                                    value={reqName}
                                    onChangeText={setReqName}
                                    placeholder="Gym name"
                                    placeholderTextColor="rgba(255,255,255,0.3)"
                                    autoCapitalize="words"
                                />
                                <TextInput
                                    style={styles.modalInput}
                                    value={reqLocation}
                                    onChangeText={setReqLocation}
                                    placeholder="City or address (optional)"
                                    placeholderTextColor="rgba(255,255,255,0.3)"
                                    autoCapitalize="words"
                                />
                                <Pressable
                                    style={[styles.modalSubmit, (!reqName.trim() || reqSubmitting) && styles.modalSubmitDisabled]}
                                    onPress={submitRequest}
                                    disabled={!reqName.trim() || reqSubmitting}
                                >
                                    {reqSubmitting
                                        ? <ActivityIndicator color="#0a0a0a" size="small" />
                                        : <Text style={styles.modalSubmitLabel}>SEND REQUEST</Text>}
                                </Pressable>
                                <Pressable onPress={() => setRequestOpen(false)} hitSlop={8}>
                                    <Text style={styles.modalCancel}>Cancel</Text>
                                </Pressable>
                            </>
                        )}
                    </Pressable>
                </Pressable>
            </Modal>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    backButton: { position: 'absolute', left: 16, zIndex: 20, padding: 4 },
    body: { flex: 1, paddingHorizontal: 24 },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)', fontSize: 10, fontFamily: FONT_MEDIUM, fontWeight: '500',
        letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 10, textAlign: 'center',
    },
    headline: {
        color: '#F2F2F2', fontSize: 32, fontFamily: FONT_LIGHT, fontWeight: '200',
        letterSpacing: -1, lineHeight: 38, textAlign: 'center',
    },
    headlineGold: { color: GOLD, fontFamily: FONT_SEMIBOLD, fontWeight: '700' },
    sub: {
        color: DIM, fontSize: 13, fontFamily: FONT_LIGHT, fontWeight: '300',
        lineHeight: 20, textAlign: 'center', marginTop: 6, marginBottom: 16,
    },
    mapWrap: {
        height: 170, borderRadius: 18, overflow: 'hidden',
        borderWidth: 1, borderColor: BORDER, backgroundColor: '#131314', marginBottom: 12,
    },
    pin: {
        width: 34, height: 34, borderRadius: 17, padding: 5,
        borderWidth: 1.5, borderColor: 'rgba(232,210,0,0.6)', alignItems: 'center', justifyContent: 'center',
    },
    pinSelected: { borderColor: GOLD, borderWidth: 2.5 },
    pinLogoImg: { width: 24, height: 24, borderRadius: 12 },
    pinLogoText: { color: '#F2F2F2', fontSize: 13, fontFamily: FONT_SEMIBOLD, fontWeight: '700', textAlign: 'center' },
    searchRow: {
        flexDirection: 'row', alignItems: 'center', gap: 8, height: 46,
        borderRadius: 13, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
        paddingHorizontal: 14, marginBottom: 10,
    },
    searchInput: { flex: 1, color: '#F2F2F2', fontSize: 15, fontFamily: FONT_REGULAR, paddingVertical: 0 },
    list: { flex: 1 },
    emptyBox: { paddingVertical: 28, alignItems: 'center' },
    emptyText: { color: DIM, fontSize: 13, fontFamily: FONT_REGULAR, textAlign: 'center' },
    gymRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12,
        borderRadius: 14, marginBottom: 8, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    },
    gymRowSel: { borderColor: GOLD },
    gymLogo: {
        width: 44, height: 44, borderRadius: 11, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)',
        alignItems: 'center', justifyContent: 'center',
    },
    gymLogoImg: { width: '78%', height: '78%' },
    gymLogoText: { color: 'rgba(255,255,255,0.7)', fontSize: 18, fontFamily: FONT_SEMIBOLD, fontWeight: '600' },
    gymMeta: { flex: 1 },
    gymName: { color: '#F2F2F2', fontSize: 15, fontFamily: FONT_MEDIUM, fontWeight: '500' },
    gymAddr: { color: DIM, fontSize: 12, fontFamily: FONT_REGULAR, marginTop: 2 },
    requestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
    requestText: { color: DIM, fontSize: 13, fontFamily: FONT_REGULAR },
    requestLink: { color: GOLD, fontFamily: FONT_SEMIBOLD, fontWeight: '600' },
    bottom: { paddingHorizontal: 24, zIndex: 1 },
    primaryButton: {
        height: 52, borderRadius: 26, backgroundColor: GOLD,
        alignItems: 'center', justifyContent: 'center',
    },
    primaryLabel: { color: '#0a0a0a', fontSize: 12, fontFamily: FONT_SEMIBOLD, fontWeight: '700', letterSpacing: 1.5 },
    // Modal
    modalScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 28 },
    modalCard: { backgroundColor: '#1a1a1c', borderRadius: 20, borderWidth: 1, borderColor: BORDER, padding: 22 },
    modalTitle: { color: '#F2F2F2', fontSize: 20, fontFamily: FONT_SEMIBOLD, fontWeight: '700' },
    modalSub: { color: DIM, fontSize: 13, fontFamily: FONT_REGULAR, lineHeight: 19, marginTop: 6, marginBottom: 16 },
    modalInput: {
        height: 50, borderRadius: 13, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
        paddingHorizontal: 14, color: '#F2F2F2', fontSize: 15, fontFamily: FONT_REGULAR, marginBottom: 10,
    },
    modalSubmit: {
        height: 50, borderRadius: 25, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 4,
    },
    modalSubmitDisabled: { opacity: 0.4 },
    modalSubmitLabel: { color: '#0a0a0a', fontSize: 12, fontFamily: FONT_SEMIBOLD, fontWeight: '700', letterSpacing: 1.5 },
    modalCancel: { color: DIM, fontSize: 14, fontFamily: FONT_REGULAR, textAlign: 'center', paddingVertical: 14 },
    sentBox: { alignItems: 'center', paddingVertical: 16 },
    sentTitle: { color: '#F2F2F2', fontSize: 20, fontFamily: FONT_SEMIBOLD, fontWeight: '700', marginTop: 12 },
    sentBody: { color: DIM, fontSize: 13, fontFamily: FONT_REGULAR, textAlign: 'center', marginTop: 6 },
});
