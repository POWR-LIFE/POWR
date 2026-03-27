import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import GeometricBackground from '@/components/GeometricBackground';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';
const RED     = '#ef4444';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();

  // Toggle states
  const [notifWorkouts,  setNotifWorkouts]  = useState(true);
  const [notifChallenges, setNotifChallenges] = useState(true);
  const [notifRewards,   setNotifRewards]   = useState(false);
  const [notifFriends,   setNotifFriends]   = useState(true);
  const [shareActivity,  setShareActivity]  = useState(true);
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      {/* ── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Account ──────────────────────────────────────── */}
        <SectionLabel label="Account" />
        <View style={styles.card}>
          <RowLink
            icon="person-outline"
            label="Edit Profile"
            value="Alex Johnson"
            onPress={() => {}}
          />
          <RowLink
            icon="mail-outline"
            label="Email"
            value="alex@example.com"
            onPress={() => {}}
          />
          <RowLink
            icon="lock-closed-outline"
            label="Change Password"
            onPress={() => {}}
          />
          <RowLink
            icon="card-outline"
            label="Subscription"
            value="Free"
            onPress={() => {}}
            isLast
          />
        </View>

        {/* ── Wearables & Health ────────────────────────────── */}
        <SectionLabel label="Wearables & Health" />
        <View style={styles.card}>
          <RowLink
            icon="watch-outline"
            label="Apple Watch"
            value="Connected"
            valueColor={GOLD}
            onPress={() => {}}
          />
          <RowLink
            icon="fitness-outline"
            label="Apple Health"
            value="Connected"
            valueColor={GOLD}
            onPress={() => {}}
          />
          <RowLink
            icon="logo-google"
            label="Google Fit"
            value="Not connected"
            onPress={() => {}}
            isLast
          />
        </View>

        {/* ── Notifications ─────────────────────────────────── */}
        <SectionLabel label="Notifications" />
        <View style={styles.card}>
          <RowToggle
            icon="barbell-outline"
            label="Workout reminders"
            value={notifWorkouts}
            onValueChange={setNotifWorkouts}
          />
          <RowToggle
            icon="trophy-outline"
            label="New challenges"
            value={notifChallenges}
            onValueChange={setNotifChallenges}
          />
          <RowToggle
            icon="gift-outline"
            label="Reward alerts"
            value={notifRewards}
            onValueChange={setNotifRewards}
          />
          <RowToggle
            icon="people-outline"
            label="Friend activity"
            value={notifFriends}
            onValueChange={setNotifFriends}
            isLast
          />
        </View>

        {/* ── Privacy ───────────────────────────────────────── */}
        <SectionLabel label="Privacy" />
        <View style={styles.card}>
          <RowToggle
            icon="eye-outline"
            label="Share activity"
            sublabel="Friends can see your workouts"
            value={shareActivity}
            onValueChange={setShareActivity}
          />
          <RowToggle
            icon="podium-outline"
            label="Show on leaderboard"
            value={showOnLeaderboard}
            onValueChange={setShowOnLeaderboard}
            isLast
          />
        </View>

        {/* ── Support ───────────────────────────────────────── */}
        <SectionLabel label="Support" />
        <View style={styles.card}>
          <RowLink
            icon="help-circle-outline"
            label="Help Centre"
            onPress={() => {}}
          />
          <RowLink
            icon="document-text-outline"
            label="Terms of Service"
            onPress={() => {}}
          />
          <RowLink
            icon="shield-outline"
            label="Privacy Policy"
            onPress={() => {}}
            isLast
          />
        </View>

        {/* ── App info ──────────────────────────────────────── */}
        <View style={styles.appInfo}>
          <Text style={styles.appVersion}>POWR · Version 1.0.0</Text>
        </View>

        {/* ── Danger zone ───────────────────────────────────── */}
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.dangerRow, pressed && { opacity: 0.7 }]}
            onPress={signOut}
          >
            <Ionicons name="log-out-outline" size={18} color={RED} />
            <Text style={styles.dangerLabel}>Sign out</Text>
          </Pressable>
          <View style={styles.rowDivider} />
          <Pressable
            style={({ pressed }) => [styles.dangerRow, pressed && { opacity: 0.7 }]}
            onPress={() => {}}
          >
            <Ionicons name="trash-outline" size={18} color={RED} />
            <Text style={[styles.dangerLabel, styles.dangerLabelDim]}>
              Delete account
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
  );
}

interface RowLinkProps {
  icon: string;
  label: string;
  value?: string;
  valueColor?: string;
  onPress: () => void;
  isLast?: boolean;
}

function RowLink({ icon, label, value, valueColor, onPress, isLast }: RowLinkProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        !isLast && styles.rowBorder,
        pressed && { opacity: 0.7 },
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon as any} size={18} color={DIM} style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? (
        <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>
          {value}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={14} color={MUTED} />
    </Pressable>
  );
}

interface RowToggleProps {
  icon: string;
  label: string;
  sublabel?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  isLast?: boolean;
}

function RowToggle({ icon, label, sublabel, value, onValueChange, isLast }: RowToggleProps) {
  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <Ionicons name={icon as any} size={18} color={DIM} style={styles.rowIcon} />
      <View style={styles.rowTextBlock}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? (
          <Text style={styles.rowSublabel}>{sublabel}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: 'rgba(255,255,255,0.10)', true: 'rgba(232,210,0,0.4)' }}
        thumbColor={value ? GOLD : 'rgba(255,255,255,0.5)'}
        ios_backgroundColor="rgba(255,255,255,0.10)"
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: 0.5,
    color: TEXT,
  },
  headerSpacer: {
    width: 36,
  },

  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 12,
    gap: 6,
    paddingTop: 8,
  },

  sectionLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: MUTED,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingTop: 10,
    paddingBottom: 4,
  },

  // Card
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },

  // Row shared
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowIcon: {
    flexShrink: 0,
  },
  rowTextBlock: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
  },
  rowSublabel: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
  },
  rowValue: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
    marginRight: 4,
  },

  // App info
  appInfo: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  appVersion: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    letterSpacing: 0.5,
  },

  // Danger
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  dangerLabel: {
    fontSize: 14,
    fontWeight: '300',
    color: RED,
  },
  dangerLabelDim: {
    opacity: 0.6,
  },
});
