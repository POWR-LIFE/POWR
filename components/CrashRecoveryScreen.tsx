import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * What a member sees when a render error takes the tree down.
 *
 * IT IMPORTS ONE MODULE: react-native. No GeometricBackground (which drags
 * expo-linear-gradient and react-native-svg in), no image asset, no safe-area
 * hook, no animation, no context, no data. There is no error boundary above
 * this component — it IS the boundary's fallback — so anything that throws in
 * here is an uncatchable abort at the worst possible moment. The only defence
 * that actually works is having nothing present that can throw.
 *
 * That is also why every fontFamily is paired with a numeric fontWeight: an
 * error early enough in the launch renders this before Outfit is registered,
 * and the weight is what keeps it legible rather than falling back to a flat
 * system face.
 *
 * Colours are local constants, not constants/tokens.ts — that file's `bg` is
 * #1E1E1E, which is visibly wrong against the app's #0d0d0d, and importing it
 * for two hex values would trade a real risk for no gain.
 */

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_BOLD = 'Outfit_700Bold';

/** Two attempts, then stop offering. retry() remounts RootLayout and re-runs
 *  every provider's startup, so a deterministic error would loop all of it —
 *  a member pressing a button that visibly does nothing is worse than a button
 *  that admits it. */
const MAX_RETRIES = 2;

type Props = {
  error?: unknown;
  onRetry?: () => void;
};

export default function CrashRecoveryScreen({ onRetry }: Props) {
  const [attempts, setAttempts] = useState(0);
  const exhausted = attempts >= MAX_RETRIES;

  const handleRetry = () => {
    setAttempts((n) => n + 1);
    try {
      onRetry?.();
    } catch {
      // A retry that throws must not take the fallback down with it.
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>SOMETHING BROKE</Text>
      <Text style={styles.headline}>
        That didn&rsquo;t load.{'\n'}
        <Text style={styles.headlineGold}>We&rsquo;ve got it.</Text>
      </Text>
      <Text style={styles.body}>
        The problem was recorded and sent to us. Your points and your streak are untouched.
      </Text>

      {exhausted ? (
        <Text style={styles.terminal}>Close POWR and open it again.</Text>
      ) : (
        <>
          <Pressable style={styles.primaryButton} onPress={handleRetry} accessibilityRole="button">
            <Text style={styles.primaryLabel}>TRY AGAIN</Text>
          </Pressable>
          <Text style={styles.caption}>Still stuck? Close POWR and open it again.</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 32,
    paddingTop: 64,
    paddingBottom: 48,
    justifyContent: 'center',
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.22)',
    fontSize: 10,
    fontFamily: FONT_MEDIUM,
    fontWeight: '500',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginBottom: 14,
    textAlign: 'center',
  },
  headline: {
    color: '#F2F2F2',
    fontSize: 38,
    fontFamily: FONT_LIGHT,
    fontWeight: '200',
    letterSpacing: -1,
    lineHeight: 44,
    textAlign: 'center',
    marginBottom: 14,
  },
  headlineGold: {
    color: GOLD,
    fontFamily: FONT_BOLD,
    fontWeight: '700',
  },
  body: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: FONT_LIGHT,
    fontWeight: '300',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryLabel: {
    color: '#0a0a0a',
    fontSize: 12,
    fontFamily: FONT_BOLD,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  caption: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    fontFamily: FONT_LIGHT,
    fontWeight: '300',
    textAlign: 'center',
  },
  terminal: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontFamily: FONT_MEDIUM,
    fontWeight: '500',
    textAlign: 'center',
  },
});
