import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const ORANGE = '#FF5C00';

/**
 * Live countdown to an ISO deadline. Ticks every second under an hour (so the
 * seconds visibly move when it's getting tense) and every 30s otherwise. When the
 * remaining time drops below `urgentBelowMs` it recolours to orange — the timer
 * starts pulling weight as a completion driver. Renders only a <Text> (or an
 * icon + <Text>), so just this node re-renders on each tick — not the whole card.
 */
export function Countdown({
  endsAt,
  style,
  urgentBelowMs = 3_600_000,
  suffix,
  iconName,
  iconColor,
  iconSize = 11,
}: {
  endsAt: string;
  style?: StyleProp<TextStyle>;
  /** Below this many ms remaining, text (and icon) go orange. Default 1h. */
  urgentBelowMs?: number;
  /** Trailing words, e.g. " to accept". Pass "" for a bare timer; omit for "… left". */
  suffix?: string;
  /** Optional inline icon that recolours with the text on urgency. */
  iconName?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconSize?: number;
}) {
  const { t } = useTranslation();
  const target = useMemo(() => new Date(endsAt).getTime(), [endsAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const remaining = target - Date.now();
    const period = remaining < 3_600_000 ? 1_000 : 30_000;
    const id = setInterval(tick, period);
    return () => clearInterval(id);
  }, [target]);

  const remaining = target - now;
  const urgent = remaining > 0 && remaining < urgentBelowMs;
  const text = (
    <Text style={[style, urgent && styles.urgent]}>{format(remaining, suffix, t)}</Text>
  );

  if (!iconName) return text;
  return (
    <View style={styles.row}>
      <Ionicons name={iconName} size={iconSize} color={urgent ? ORANGE : iconColor} />
      {text}
    </View>
  );
}

function format(ms: number, suffix: string | undefined, t: TFunction): string {
  if (ms <= 0) return t('social:countdown.ended');
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const time =
    d > 0 ? t('social:countdown.daysHours', { d, h })
    : h > 0 ? t('social:countdown.hoursMinutes', { h, m })
    : m > 0 ? t('social:countdown.minutesSeconds', { m, s: String(s).padStart(2, '0') })
    : t('social:countdown.seconds', { s });
  return suffix === undefined ? t('social:countdown.left', { time }) : `${time}${suffix}`;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  urgent: { color: ORANGE },
});
