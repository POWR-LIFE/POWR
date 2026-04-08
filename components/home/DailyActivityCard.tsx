import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

const GOLD   = '#E8D200';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.45)';
const CARD   = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.12)';

interface DailyActivityCardProps {
  completed: boolean;
}

export function DailyActivityCard({ completed }: DailyActivityCardProps) {
  const router = useRouter();

  if (completed) {
    return null;
  }

  return (
    <Pressable 
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}
      onPress={() => router.push('/manual-log')}
    >
      <View style={[styles.iconWrap, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
        <Ionicons name="calendar-outline" size={20} color={DIM} />
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>ACTION REQUIRED</Text>
        <Text style={styles.mainText}>Complete an activity</Text>
        <Text style={styles.subText}>
          Log a session now to maintain your streak and earn points.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={MUTED} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 12,
    overflow: 'hidden',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: DIM,
    textTransform: 'uppercase',
  },
  mainText: {
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.2,
  },
  subText: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    lineHeight: 14,
  },
});
