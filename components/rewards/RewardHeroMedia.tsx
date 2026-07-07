import { useEventListener } from 'expo';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

type Fit = 'cover' | 'contain';
type Position = 'top' | 'center' | 'bottom';

interface RewardHeroMediaProps {
  /** Looping background video. When present (and Reduce Motion is off) it plays over the poster. */
  videoUrl?: string | null;
  /** Still hero image. Poster under the video (instant paint) and the Reduce-Motion / no-video fallback. */
  imageUrl?: string | null;
  /** Sizing/positioning for the media layer — parent hero containers all give it a fixed height. */
  style?: StyleProp<ViewStyle>;
  contentFit?: Fit;
  contentPosition?: Position;
}

/**
 * The visual media for a reward hero. Video-first: if `videoUrl` is set the card
 * plays a muted, looping video with `imageUrl` painted underneath as the poster.
 * With no video (or Reduce Motion enabled) it renders the still image alone.
 *
 * Renders only the media — callers keep their own gradient/overlay/content on top.
 * The shareable RewardShareCard deliberately does NOT use this (view-shot captures
 * a static frame), so it always renders the still image directly.
 */
export function RewardHeroMedia({
  videoUrl,
  imageUrl,
  style,
  contentFit = 'cover',
  contentPosition = 'center',
}: RewardHeroMediaProps) {
  const reduceMotion = useReducedMotion();
  const showVideo = !!videoUrl && !reduceMotion;

  if (!videoUrl && !imageUrl) return null;

  return (
    <View style={style}>
      {imageUrl && (
        <ExpoImage
          source={{ uri: imageUrl }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          contentPosition={contentPosition}
          transition={150}
        />
      )}
      {showVideo && <HeroVideo uri={videoUrl!} contentFit={contentFit} />}
    </View>
  );
}

/** Isolated so the expo-video player is only instantiated when a video actually plays. */
function HeroVideo({ uri, contentFit }: { uri: string; contentFit: Fit }) {
  // useCaching: after the first pass the loop replays from disk, so a slow or
  // flaky connection can't stall playback mid-loop on later iterations.
  const player = useVideoPlayer({ uri, useCaching: true }, (p) => {
    p.loop = true;
    p.muted = true;
    // Decorative background video must never claim audio focus: holding it
    // pauses the user's music, and losing it silently pauses the video.
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  // The OS pauses the player on app background, screen lock, and audio-session
  // interruptions (calls, Siri), and expo-video never resumes it by itself —
  // the card then sits frozen on one frame. Nudge it whenever it can play but
  // isn't. The guards swallow calls that race the player's native release.
  useEventListener(player, 'statusChange', ({ status }) => {
    try {
      if (status === 'readyToPlay' && !player.playing) player.play();
    } catch {}
  });

  // Backstop for the known expo-video stall at the loop point: if the native
  // loop didn't restart playback after the clip ended, restart it ourselves.
  useEventListener(player, 'playToEnd', () => {
    try {
      if (!player.playing) player.replay();
    } catch {}
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      try {
        if (!player.playing) player.play();
      } catch {}
    });
    return () => sub.remove();
  }, [player]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit={contentFit}
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
      pointerEvents="none"
    />
  );
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduce(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduce;
}
