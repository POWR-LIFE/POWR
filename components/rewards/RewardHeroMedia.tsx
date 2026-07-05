import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

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
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

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
