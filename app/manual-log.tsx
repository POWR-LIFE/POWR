import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import GeometricBackground from '@/components/GeometricBackground';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ACTIVITIES, ACTIVITY_ORDER, type ActivityType } from '@/constants/activities';
import { logManualSession } from '@/lib/api/activity';
import { useHealthData, type VerifyResult } from '@/hooks/useHealthData';

// ─── Design tokens ─────────────────────────────────────────────────────────────

const GOLD   = '#E8D200';
const BG     = '#0d0d0d';
const CARD   = 'rgba(28,28,28,0.95)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.45)';

// ─── Points calculation ────────────────────────────────────────────────────────
// Returns base POWR for each activity given user inputs.
// Manual log penalty (80%) is applied at the end.

function calcBasePoints(type: ActivityType, durationMins: number, steps: number): number {
    switch (type) {
        case 'walking': {
            if (steps < 4000) return 0;
            if (steps < 6000) return 2;
            if (steps < 8000) return 3;
            if (steps < 10000) return 4;
            return 5;
        }
        case 'running': {
            if (durationMins < 15) return 0;
            if (durationMins < 20) return 5;
            if (durationMins < 30) return 6;
            if (durationMins < 60) return 8;
            return 10;
        }
        case 'cycling': {
            if (durationMins < 20) return 0;
            if (durationMins < 30) return 4;
            if (durationMins < 60) return 6;
            if (durationMins < 90) return 8;
            return 10;
        }
        case 'swimming': {
            if (durationMins < 15) return 0;
            if (durationMins < 20) return 5;
            if (durationMins < 40) return 7;
            if (durationMins < 60) return 9;
            return 10;
        }
        case 'gym': {
            if (durationMins < 20) return 0;
            if (durationMins < 45) return 10;
            return 15;
        }
        case 'hiit': {
            if (durationMins < 20) return 0;
            if (durationMins < 30) return 7;
            if (durationMins < 45) return 9;
            return 10;
        }
        case 'sports': {
            if (durationMins < 30) return 0;
            if (durationMins < 60) return 6;
            if (durationMins < 90) return 8;
            return 10;
        }
        case 'yoga': {
            if (durationMins < 20) return 0;
            if (durationMins < 30) return 3;
            if (durationMins < 45) return 4;
            if (durationMins < 60) return 5;
            return 6;
        }
        default:
            return 0;
    }
}

function calcManualPoints(type: ActivityType, durationMins: number, steps: number, healthVerified = false): number {
    const base = calcBasePoints(type, durationMins, steps);
    return Math.floor(base * (healthVerified ? 1.0 : 0.8));
}

function getMinimumNote(type: ActivityType): string {
    switch (type) {
        case 'walking':  return 'Minimum 4,000 steps to earn points';
        case 'running':  return 'Minimum 15 min to qualify';
        case 'cycling':  return 'Minimum 20 min to qualify';
        case 'swimming': return 'Minimum 15 min to qualify';
        case 'gym':      return 'Minimum 20 min to qualify';
        case 'hiit':     return 'Minimum 20 min to qualify';
        case 'sports':   return 'Minimum 30 min to qualify';
        case 'yoga':     return 'Minimum 20 min to qualify';
    }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ManualLogScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const health = useHealthData();

    const [step, setStep] = useState<1 | 2>(1);
    const [selectedType, setSelectedType] = useState<ActivityType | null>(null);

    // Step-2 inputs
    const [durationInput, setDurationInput] = useState('');
    const [stepsInput, setStepsInput]       = useState('');
    const [distanceInput, setDistanceInput] = useState('');

    // Health verification
    const [healthVerified, setHealthVerified] = useState(false);
    const [verifying, setVerifying]           = useState(false);
    const [verifyResult, setVerifyResult]     = useState<VerifyResult | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError]           = useState<string | null>(null);

    // ── Derived ──────────────────────────────────────────────────────────────

    const durationMins = parseInt(durationInput, 10) || 0;
    const steps        = parseInt(stepsInput, 10) || 0;
    const distanceKm   = parseFloat(distanceInput) || 0;

    const isWalking = selectedType === 'walking';
    const hasDistanceInput = selectedType === 'running' || selectedType === 'cycling' || selectedType === 'swimming';

    const previewPoints = selectedType
        ? calcManualPoints(selectedType, durationMins, steps, healthVerified)
        : 0;

    const basePoints = selectedType
        ? calcBasePoints(selectedType, durationMins, steps)
        : 0;

    const inputValid = selectedType && (
        isWalking ? steps > 0 : durationMins > 0
    );

    const activity = selectedType ? ACTIVITIES[selectedType] : null;

    // ── Handlers ──────────────────────────────────────────────────────────────

    function resetVerification() {
        setHealthVerified(false);
        setVerifyResult(null);
    }

    function handleSelectType(type: ActivityType) {
        setSelectedType(type);
        setDurationInput('');
        setStepsInput('');
        setDistanceInput('');
        setError(null);
        resetVerification();
        setStep(2);
    }

    async function handleVerify() {
        if (!selectedType) return;
        // Request permissions if not yet granted
        if (!health.isAuthorized) {
            const granted = await health.requestPermissions();
            if (!granted) return;
        }
        setVerifying(true);
        setVerifyResult(null);
        try {
            const result = isWalking
                ? await health.verifyWalking(steps)
                : await health.verifyWorkout(selectedType, durationMins);
            setVerifyResult(result);
            setHealthVerified(result.verified);
        } finally {
            setVerifying(false);
        }
    }

    async function handleSubmit() {
        if (!selectedType || !inputValid) return;

        const now = new Date();
        const durationSec = isWalking ? 0 : durationMins * 60;
        const started_at = isWalking
            ? now.toISOString()
            : new Date(now.getTime() - durationSec * 1000).toISOString();

        setSubmitting(true);
        setError(null);
        try {
            await logManualSession({
                type: selectedType,
                duration_sec: durationSec,
                distance_m: distanceKm > 0 ? distanceKm * 1000 : undefined,
                steps: isWalking && steps > 0 ? steps : undefined,
                points: previewPoints,
                started_at,
                healthVerified,
            });
            router.back();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to log session');
        } finally {
            setSubmitting(false);
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <KeyboardAvoidingView
            style={[styles.screen, { paddingTop: insets.top }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <GeometricBackground />
            {/* Header */}
            <View style={styles.header}>
                <Pressable
                    style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => {
                        if (step === 2) {
                            setStep(1);
                            setSelectedType(null);
                        } else {
                            router.back();
                        }
                    }}
                >
                    <Ionicons name="chevron-back" size={22} color={TEXT} />
                </Pressable>
                <Text style={styles.headerTitle}>
                    {step === 1 ? 'Log Activity' : activity?.label ?? ''}
                </Text>
                <View style={styles.headerRight} />
            </View>

            {step === 1 ? (
                <ActivityPicker onSelect={handleSelectType} />
            ) : (
                <DetailsForm
                    activity={activity!}
                    isWalking={isWalking}
                    hasDistanceInput={hasDistanceInput}
                    durationInput={durationInput}
                    stepsInput={stepsInput}
                    distanceInput={distanceInput}
                    onDurationChange={(v) => { setDurationInput(v); resetVerification(); }}
                    onStepsChange={(v) => { setStepsInput(v); resetVerification(); }}
                    onDistanceChange={setDistanceInput}
                    previewPoints={previewPoints}
                    basePoints={basePoints}
                    inputValid={!!inputValid}
                    submitting={submitting}
                    error={error}
                    onSubmit={handleSubmit}
                    insets={insets}
                    minimumNote={getMinimumNote(selectedType!)}
                    healthAvailable={health.isAvailable}
                    healthVerified={healthVerified}
                    verifying={verifying}
                    verifyResult={verifyResult}
                    onVerify={handleVerify}
                />
            )}
        </KeyboardAvoidingView>
    );
}

// ─── Step 1: Activity Picker ───────────────────────────────────────────────────

function ActivityPicker({ onSelect }: { onSelect: (type: ActivityType) => void }) {
    return (
        <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.pickerContent}
            showsVerticalScrollIndicator={false}
        >
            <Text style={styles.pickerLabel}>Pick your activity</Text>
            <View style={styles.pickerGrid}>
                {ACTIVITY_ORDER.map(type => {
                    const a = ACTIVITIES[type];
                    return (
                        <Pressable
                            key={type}
                            style={({ pressed }) => [styles.activityCard, pressed && { opacity: 0.75 }]}
                            onPress={() => onSelect(type)}
                        >
                            {/* colour accent bar */}
                            <View style={[styles.activityCardBar, { backgroundColor: a.colour }]} />
                            <Ionicons name={a.iconActive as any} size={28} color={a.colour} />
                            <Text style={styles.activityCardLabel}>{a.label}</Text>
                            <Text style={styles.activityCardTag}>{a.tag}</Text>
                            <View style={styles.activityCardCap}>
                                <Text style={styles.activityCardCapText}>up to {a.dailyCap} pts</Text>
                            </View>
                        </Pressable>
                    );
                })}
            </View>
            <Text style={styles.manualNote}>
                Manual logs earn 80% of base points · Verify with Health for full points
            </Text>
        </ScrollView>
    );
}

// ─── Step 2: Details Form ─────────────────────────────────────────────────────

interface DetailsFormProps {
    activity: (typeof ACTIVITIES)[ActivityType];
    isWalking: boolean;
    hasDistanceInput: boolean;
    durationInput: string;
    stepsInput: string;
    distanceInput: string;
    onDurationChange: (v: string) => void;
    onStepsChange: (v: string) => void;
    onDistanceChange: (v: string) => void;
    previewPoints: number;
    basePoints: number;
    inputValid: boolean;
    submitting: boolean;
    error: string | null;
    onSubmit: () => void;
    insets: { bottom: number };
    minimumNote: string;
    healthAvailable: boolean;
    healthVerified: boolean;
    verifying: boolean;
    verifyResult: VerifyResult | null;
    onVerify: () => void;
}

function DetailsForm({
    activity,
    isWalking,
    hasDistanceInput,
    durationInput,
    stepsInput,
    distanceInput,
    onDurationChange,
    onStepsChange,
    onDistanceChange,
    previewPoints,
    basePoints,
    inputValid,
    submitting,
    error,
    onSubmit,
    insets,
    minimumNote,
    healthAvailable,
    healthVerified,
    verifying,
    verifyResult,
    onVerify,
}: DetailsFormProps) {
    const hasValue = isWalking ? stepsInput.length > 0 : durationInput.length > 0;
    const qualifies = previewPoints > 0;

    return (
        <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[styles.detailsContent, { paddingBottom: Math.max(insets.bottom, 24) + 16 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
        >
            {/* Activity badge */}
            <View style={[styles.activityBadge, { borderColor: activity.colour + '40' }]}>
                <Ionicons name={activity.iconActive as any} size={20} color={activity.colour} />
                <Text style={[styles.activityBadgeText, { color: activity.colour }]}>{activity.tag}</Text>
            </View>

            {/* Inputs */}
            <Text style={styles.sectionLabel}>Session details</Text>

            {isWalking ? (
                <LabelledInput
                    label="Steps"
                    value={stepsInput}
                    onChangeText={onStepsChange}
                    placeholder="e.g. 8000"
                    unit="steps"
                    keyboardType="number-pad"
                />
            ) : (
                <LabelledInput
                    label="Duration"
                    value={durationInput}
                    onChangeText={onDurationChange}
                    placeholder="e.g. 45"
                    unit="min"
                    keyboardType="number-pad"
                />
            )}

            {hasDistanceInput && (
                <LabelledInput
                    label="Distance"
                    value={distanceInput}
                    onChangeText={onDistanceChange}
                    placeholder="Optional"
                    unit={activity.type === 'swimming' ? 'm' : 'km'}
                    keyboardType="decimal-pad"
                    optional
                />
            )}

            {/* Health verification */}
            {hasValue && Platform.OS !== 'web' && healthAvailable && (
                <HealthVerifyButton
                    verified={healthVerified}
                    verifying={verifying}
                    verifyResult={verifyResult}
                    onPress={onVerify}
                />
            )}

            {/* Points preview */}
            <PointsPreview
                hasValue={hasValue}
                qualifies={qualifies}
                previewPoints={previewPoints}
                basePoints={basePoints}
                minimumNote={minimumNote}
                activityColour={activity.colour}
                healthVerified={healthVerified}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            {/* Submit CTA */}
            <Pressable
                style={({ pressed }) => [
                    styles.submitBtn,
                    (!inputValid || !qualifies) && styles.submitBtnDisabled,
                    pressed && inputValid && qualifies && { opacity: 0.85 },
                ]}
                onPress={onSubmit}
                disabled={!inputValid || !qualifies || submitting}
            >
                {submitting ? (
                    <ActivityIndicator color="#0a0a0a" />
                ) : (
                    <Text style={styles.submitBtnText}>
                        {qualifies ? `Log session · ${previewPoints} pts` : 'Log session'}
                    </Text>
                )}
            </Pressable>

            <Text style={styles.submitNote}>
                {healthVerified
                    ? 'Health verified — full points awarded. No streak credit.'
                    : 'Manual logs earn 80% of base points. Verify with Health for full points.'}
            </Text>
        </ScrollView>
    );
}

// ─── Points Preview ───────────────────────────────────────────────────────────

function PointsPreview({
    hasValue,
    qualifies,
    previewPoints,
    basePoints,
    minimumNote,
    activityColour,
    healthVerified,
}: {
    hasValue: boolean;
    qualifies: boolean;
    previewPoints: number;
    basePoints: number;
    minimumNote: string;
    activityColour: string;
    healthVerified: boolean;
}) {
    if (!hasValue) {
        return (
            <View style={styles.previewEmpty}>
                <Ionicons name="flash-outline" size={18} color={MUTED} />
                <Text style={styles.previewEmptyText}>{minimumNote}</Text>
            </View>
        );
    }

    if (!qualifies) {
        return (
            <View style={[styles.previewCard, styles.previewCardFail]}>
                <Ionicons name="close-circle-outline" size={18} color="rgba(239,68,68,0.7)" />
                <View style={{ flex: 1 }}>
                    <Text style={styles.previewFailText}>Doesn't meet minimum threshold</Text>
                    <Text style={styles.previewFailNote}>{minimumNote}</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.previewCard, { borderColor: activityColour + '30' }]}>
            <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Estimated POWR</Text>
                <View style={styles.previewPtsRow}>
                    <Text style={[styles.previewPts, { color: activityColour }]}>{previewPoints}</Text>
                    <Text style={styles.previewPtsUnit}> pts</Text>
                </View>
            </View>
            <View style={styles.previewDivider} />
            <View style={styles.previewPenaltyRow}>
                <View style={styles.previewPenaltyItem}>
                    <Text style={styles.previewPenaltyLabel}>Base</Text>
                    <Text style={styles.previewPenaltyVal}>{basePoints} pts</Text>
                </View>
                <Ionicons name="arrow-forward" size={12} color={MUTED} />
                <View style={styles.previewPenaltyItem}>
                    <Text style={styles.previewPenaltyLabel}>
                        {healthVerified ? 'Health verified (×1.0)' : 'Manual (×0.8)'}
                    </Text>
                    <Text style={[styles.previewPenaltyVal, { color: activityColour }]}>{previewPoints} pts</Text>
                </View>
            </View>
        </View>
    );
}

// ─── Health Verify Button ─────────────────────────────────────────────────────

function HealthVerifyButton({
    verified,
    verifying,
    verifyResult,
    onPress,
}: {
    verified: boolean;
    verifying: boolean;
    verifyResult: VerifyResult | null;
    onPress: () => void;
}) {
    if (verified) {
        return (
            <View style={styles.verifySuccess}>
                <Ionicons name="checkmark-circle" size={16} color="#4AF2A1" />
                <View style={{ flex: 1 }}>
                    <Text style={styles.verifySuccessText}>Health Verified — full points</Text>
                    {verifyResult && (
                        <Text style={styles.verifyDetail}>{verifyResult.detail}</Text>
                    )}
                </View>
            </View>
        );
    }

    if (verifyResult && !verifyResult.verified) {
        return (
            <View style={styles.verifyFail}>
                <Ionicons name="close-circle-outline" size={16} color="rgba(239,68,68,0.7)" />
                <View style={{ flex: 1 }}>
                    <Text style={styles.verifyFailText}>Couldn't verify with Health</Text>
                    <Text style={styles.verifyDetail}>{verifyResult.detail}</Text>
                </View>
            </View>
        );
    }

    return (
        <Pressable
            style={({ pressed }) => [styles.verifyBtn, pressed && { opacity: 0.7 }]}
            onPress={onPress}
            disabled={verifying}
        >
            {verifying ? (
                <ActivityIndicator size="small" color={GOLD} />
            ) : (
                <>
                    <Ionicons name="heart-outline" size={15} color={GOLD} />
                    <Text style={styles.verifyBtnText}>Verify with Health for full points</Text>
                </>
            )}
        </Pressable>
    );
}

// ─── Labelled Input ───────────────────────────────────────────────────────────

function LabelledInput({
    label,
    value,
    onChangeText,
    placeholder,
    unit,
    keyboardType = 'number-pad',
    optional = false,
}: {
    label: string;
    value: string;
    onChangeText: (v: string) => void;
    placeholder: string;
    unit: string;
    keyboardType?: 'number-pad' | 'decimal-pad';
    optional?: boolean;
}) {
    return (
        <View style={styles.inputWrap}>
            <View style={styles.inputLabelRow}>
                <Text style={styles.inputLabel}>{label}</Text>
                {optional && <Text style={styles.inputOptional}>optional</Text>}
            </View>
            <View style={styles.inputRow}>
                <TextInput
                    style={styles.input}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={MUTED}
                    keyboardType={keyboardType}
                    returnKeyType="done"
                    maxLength={6}
                    selectionColor={GOLD}
                />
                <Text style={styles.inputUnit}>{unit}</Text>
            </View>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: BG,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    backBtn: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '400',
        letterSpacing: -0.2,
        color: TEXT,
    },
    headerRight: {
        width: 36,
    },

    // ── Picker ──
    pickerContent: {
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 32,
        gap: 16,
    },
    pickerLabel: {
        fontSize: 13,
        fontWeight: '300',
        color: DIM,
        letterSpacing: 0.2,
    },
    pickerGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    activityCard: {
        width: '47.5%',
        backgroundColor: CARD,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 16,
        padding: 16,
        gap: 8,
        overflow: 'hidden',
    },
    activityCardBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    activityCardLabel: {
        fontSize: 15,
        fontWeight: '400',
        color: TEXT,
        marginTop: 2,
    },
    activityCardTag: {
        fontSize: 10,
        fontWeight: '300',
        color: MUTED,
        letterSpacing: 0.3,
    },
    activityCardCap: {
        marginTop: 4,
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 3,
    },
    activityCardCapText: {
        fontSize: 9,
        fontWeight: '400',
        color: MUTED,
        letterSpacing: 0.5,
    },
    manualNote: {
        fontSize: 11,
        fontWeight: '300',
        color: MUTED,
        textAlign: 'center',
        paddingHorizontal: 8,
    },

    // ── Details ──
    detailsContent: {
        paddingHorizontal: 16,
        paddingTop: 20,
        gap: 16,
    },
    activityBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    activityBadgeText: {
        fontSize: 12,
        fontWeight: '400',
        letterSpacing: 0.3,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: '500',
        letterSpacing: 1.2,
        color: MUTED,
        textTransform: 'uppercase',
        marginTop: 4,
    },

    // ── Input ──
    inputWrap: {
        gap: 8,
    },
    inputLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    inputLabel: {
        fontSize: 13,
        fontWeight: '300',
        color: DIM,
    },
    inputOptional: {
        fontSize: 11,
        fontWeight: '300',
        color: MUTED,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: CARD,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 13,
        gap: 8,
    },
    input: {
        flex: 1,
        fontSize: 22,
        fontWeight: '300',
        color: TEXT,
    },
    inputUnit: {
        fontSize: 14,
        fontWeight: '300',
        color: MUTED,
    },

    // ── Points Preview ──
    previewEmpty: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        padding: 14,
    },
    previewEmptyText: {
        fontSize: 12,
        fontWeight: '300',
        color: MUTED,
    },
    previewCard: {
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderRadius: 12,
        padding: 14,
        gap: 10,
    },
    previewCardFail: {
        borderColor: 'rgba(239,68,68,0.2)',
        flexDirection: 'row',
        gap: 10,
        alignItems: 'flex-start',
    },
    previewFailText: {
        fontSize: 12,
        fontWeight: '400',
        color: 'rgba(239,68,68,0.8)',
    },
    previewFailNote: {
        fontSize: 11,
        fontWeight: '300',
        color: MUTED,
        marginTop: 2,
    },
    previewRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    previewLabel: {
        fontSize: 12,
        fontWeight: '300',
        color: DIM,
    },
    previewPtsRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    previewPts: {
        fontSize: 28,
        fontWeight: '200',
    },
    previewPtsUnit: {
        fontSize: 14,
        fontWeight: '300',
        color: DIM,
    },
    previewDivider: {
        height: 1,
        backgroundColor: BORDER,
    },
    previewPenaltyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    previewPenaltyItem: {
        flex: 1,
        gap: 2,
    },
    previewPenaltyLabel: {
        fontSize: 10,
        fontWeight: '300',
        color: MUTED,
        letterSpacing: 0.3,
    },
    previewPenaltyVal: {
        fontSize: 13,
        fontWeight: '400',
        color: DIM,
    },

    // ── Submit ──
    submitBtn: {
        backgroundColor: GOLD,
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 4,
    },
    submitBtnDisabled: {
        opacity: 0.35,
    },
    submitBtnText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#0a0a0a',
        letterSpacing: -0.2,
    },
    submitNote: {
        fontSize: 11,
        fontWeight: '300',
        color: MUTED,
        textAlign: 'center',
        lineHeight: 16,
    },
    errorText: {
        fontSize: 12,
        fontWeight: '300',
        color: 'rgba(239,68,68,0.8)',
        textAlign: 'center',
    },

    // ── Health verification ──
    verifyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(232,210,0,0.07)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.25)',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    verifyBtnText: {
        fontSize: 13,
        fontWeight: '400',
        color: GOLD,
        flex: 1,
    },
    verifySuccess: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        backgroundColor: 'rgba(74,242,161,0.07)',
        borderWidth: 1,
        borderColor: 'rgba(74,242,161,0.25)',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    verifySuccessText: {
        fontSize: 13,
        fontWeight: '400',
        color: '#4AF2A1',
    },
    verifyFail: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        backgroundColor: 'rgba(239,68,68,0.05)',
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.2)',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    verifyFailText: {
        fontSize: 13,
        fontWeight: '400',
        color: 'rgba(239,68,68,0.8)',
    },
    verifyDetail: {
        fontSize: 11,
        fontWeight: '300',
        color: MUTED,
        marginTop: 2,
    },
});
