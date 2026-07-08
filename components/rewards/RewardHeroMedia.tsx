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
  // Deliberately NO `useCaching`: on iOS it swaps in a custom
  // AVAssetResourceLoader that must answer AVFoundation's content-info queries
  // itself, and against our storage host the item never reaches readyToPlay —
  // release builds showed only the poster with the "unplayable" glyph
  // (TestFlight 1.4.9, 2026-07-08). Plain progressive playback is the path
  // proven to work; AVPlayer's own buffer handles the loop replay.
  const player = useVideoPlayer({ uri }, (p) => {
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

  // Primary loop/stall guard on iOS. Two failure modes leave the card frozen on
  // a still frame with no player event to react to:
  //  1) Loop stall — the native loop hangs on AVPlayerItemDidPlayToEndTime,
  //     which AVFoundation does not reliably post when the item stalls a hair
  //     before its last frame, so neither the native seek-to-zero nor the
  //     `playToEnd` listener runs.
  //  2) Mid-clip buffer underrun on the progressive download — playback stops
  //     partway through and expo-video does not auto-resume.
  // In both cases `statusChange` stays silent (status stays readyToPlay) AND
  // `timeUpdate` stops firing (it's driven by playback progress), so nothing
  // event-based catches it. This independent interval polls the player: if it
  // is stopped but ready, restart the loop from the tail or resume mid-clip.
  useEffect(() => {
    const id = setInterval(() => {
      try {
        if (player.playing || player.status !== 'readyToPlay') return;
        const { duration, currentTime } = player;
        // duration is 0 until metadata loads; only judge the tail once known.
        if (duration > 0 && currentTime >= duration - 0.5) player.replay();
        else player.play();
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, [player]);

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
