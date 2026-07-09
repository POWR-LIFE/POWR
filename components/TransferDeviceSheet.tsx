import * as Haptics from 'expo-haptics';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const GOLD = '#E8D200';
const CARD_BG = '#141414';
const BORDER = '#222222';

/**
 * Shown when the device lock reports 'transfer_available' — this account is bound
 * to another device that was seen recently, so we don't migrate silently; we ask.
 * A controlled sheet (AuthContext owns visibility), rendered high in the tree
 * above SafeAreaProvider, so it takes no insets — a fixed bottom pad is fine for
 * a full-screen Modal overlay. Chrome mirrors NotificationPrimeSheet /
 * LocationPrimeSheet so the moment reads as one system.
 *
 * Confirming signs the user in on THIS device and signs the old one out; "Not
 * now" backs out to the login screen (AuthContext signs the pending session out
 * locally) — never a silent move.
 */
export default function TransferDeviceSheet({
  visible,
  fromPlatform,
  fromLastSeen,
  busy,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  fromPlatform?: string | null;
  fromLastSeen?: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!visible) return null;

  const confirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onConfirm();
  };

  const otherDevice =
    fromPlatform === 'ios' ? 'your other iPhone'
    : fromPlatform === 'android' ? 'your other Android'
    : 'another device';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        {/* Tapping the scrim = "Not now" — but not while a move is in flight. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.eyebrow}>MOVE YOUR ACCOUNT</Text>
          <Text style={styles.headline}>
            Bring POWR{'\n'}
            <Text style={styles.headlineGold}>to this phone.</Text>
          </Text>
          <Text style={styles.body}>
            Your POWR account is set up on {otherDevice}
            {fromLastSeen ? ` (last active ${formatLastSeen(fromLastSeen)})` : ''}.
            Move it here to keep earning — {otherDevice} will be signed out. Only
            one phone at a time.
          </Text>

          <Pressable
            style={[styles.primaryButton, busy && { opacity: 0.7 }]}
            onPress={confirm}
            disabled={busy}
          >
            <Text style={styles.primaryLabel}>{busy ? 'MOVING…' : 'MOVE TO THIS PHONE'}</Text>
          </Pressable>

          <Pressable style={styles.skipButton} onPress={onCancel} disabled={busy}>
            <Text style={styles.skipLabel}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** "3 days ago" / "today" — coarse is fine, this is reassurance copy. */
function formatLastSeen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: BORDER,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: 22,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.22)',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  headline: {
    color: '#F2F2F2',
    fontSize: 32,
    fontWeight: '200',
    letterSpacing: -0.8,
    lineHeight: 38,
    textAlign: 'center',
    marginBottom: 12,
  },
  headlineGold: {
    color: GOLD,
    fontWeight: '700',
  },
  body: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13.5,
    fontWeight: '300',
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryButton: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 26,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  primaryLabel: {
    color: '#0a0a0a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipLabel: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 13,
    fontWeight: '300',
    letterSpacing: 0.3,
  },
});
