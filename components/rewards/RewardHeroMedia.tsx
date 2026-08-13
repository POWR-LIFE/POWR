import { useIsFocused } from '@react-navigation/native';
import { useEventListener } from 'expo';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { reportHandled } from '@/lib/crashHandler';
import { rewardHeroUri } from '@/lib/storageImage';

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
  // Resized CDN copy — hero stills are uploaded at press resolution (1–5 MB).
  // Videos stream progressively and must NOT go through the image transform.
  const posterUri = rewardHeroUri(imageUrl);

  // Reduce Motion with a video-only hero (the live event card ships no still):
  // suppressing the video outright leaves a blank panel, so show its first
  // frame, paused — static, which is what the setting asks for.
  const showStill = !!videoUrl && reduceMotion && !posterUri;

  if (!videoUrl && !posterUri) return null;

  return (
    <View style={style}>
      {posterUri && (
        <ExpoImage
          source={{ uri: posterUri }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          contentPosition={contentPosition}
          transition={150}
        />
      )}
      {(showVideo || showStill) && (
        // Keyed so a live Reduce-Motion toggle remounts the player: the
        // play/still decision is baked in at player creation and the paused
        // mode disarms every resume guard.
        <HeroVideo key={showStill ? 'still' : 'live'} uri={videoUrl!} contentFit={contentFit} still={showStill} />
      )}
    </View>
  );
}

/** Isolated so the expo-video player is only instantiated when a video actually plays.
 *  `still` renders the first frame paused (the Reduce-Motion, no-poster case) —
 *  playback never starts and every resume/stall guard below stays disarmed. */
function HeroVideo({ uri, contentFit, still = false }: { uri: string; contentFit: Fit; still?: boolean }) {
  // Pause whenever this player's screen isn't on top. The redeem modal is a
  // transparent 'modal' route, so the rewards screen (and its expanded card's
  // hero video) stays mounted and decoding underneath while the modal mounts a
  // SECOND player on the same clip. Two hardware H.264 decoders starve the
  // device codec (Android CCodecBufferChannel buffer exhaustion) and can take
  // the app down natively on the Redeem tap. Focus-gating keeps exactly one
  // hero player decoding at a time.
  const isFocused = useIsFocused();

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
    // Still mode never starts playback — the prepared item's first frame is
    // the render.
    if (!still) p.play();
  });

  // Release/reclaim the decoder as focus changes: pause when a screen (e.g. the
  // redeem modal) covers this one, resume when we're back on top. The ref lets
  // the stall/resume guards below read live focus without re-subscribing.
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;
  useEffect(() => {
    if (still) return;
    try {
      if (isFocused) player.play();
      else player.pause();
    } catch {}
  }, [isFocused, player, still]);

  // If the source fails outright, name the failure instead of swallowing it —
  // a wedged player with silent guards is undiagnosable (that blindness cost
  // several build cycles in the 2026-07 iOS incident) — and drop the video
  // layer so the card shows the clean poster, not a broken-player glyph.
  const [videoError, setVideoError] = useState<string | null>(null);

  // The OS pauses the player on app background, screen lock, and audio-session
  // interruptions (calls, Siri), and expo-video never resumes it by itself —
  // the card then sits frozen on one frame. Nudge it whenever it can play but
  // isn't. The guards swallow calls that race the player's native release.
  useEventListener(player, 'statusChange', ({ status, error }) => {
    try {
      if (status === 'error') {
        const message = error?.message ?? 'unknown video error';
        console.warn(`[RewardHeroMedia] video failed: ${message} (${uri})`);
        // console.warn dies with the session — record to app_errors so a
        // user's playback failure is visible from the desk (the 2026-07 iOS
        // "unplayable" incident was invisible until someone shipped a build).
        reportHandled(error ?? new Error(message), { where: 'RewardHeroMedia', uri });
        setVideoError(message);
        return;
      }
      if (!still && status === 'readyToPlay' && !player.playing && focusedRef.current) player.play();
    } catch {}
  });

  // Backstop for the known expo-video stall at the loop point: if the native
  // loop didn't restart playback after the clip ended, restart it ourselves.
  useEventListener(player, 'playToEnd', () => {
    try {
      if (!still && !player.playing && focusedRef.current) player.replay();
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
    if (still) return;
    const id = setInterval(() => {
      try {
        if (!focusedRef.current) return;
        if (player.playing || player.status !== 'readyToPlay') return;
        const { duration, currentTime } = player;
        // duration is 0 until metadata loads; only judge the tail once known.
        if (duration > 0 && currentTime >= duration - 0.5) player.replay();
        else player.play();
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, [player, still]);

  useEffect(() => {
    if (still) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      try {
        if (!player.playing && focusedRef.current) player.play();
      } catch {}
    });
    return () => sub.remove();
  }, [player, still]);

  if (videoError) {
    // Poster-only fallback; in dev builds also print the failure on the card
    // so an Xcode Debug run on a device names the error without log digging.
    if (!__DEV__) return null;
    return (
      <View style={[StyleSheet.absoluteFill, devErrorStyles.box]} pointerEvents="none">
        <Text style={devErrorStyles.text}>video error: {videoError}</Text>
      </View>
    );
  }

  return (
    // Touch-transparency must live on a plain wrapper View: `pointerEvents`
    // set directly on VideoView is dropped on web (it renders a raw <video>)
    // and the native player's own subviews still hit-test on iOS/Android —
    // the hero video was eating the home reward card's Pressable taps.
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        nativeControls={false}
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        // Android's default SurfaceView composites in its own layer and
        // ignores parent clipping, so an expanded list card's video kept
        // drawing over the rewards hero once scrolled past the ScrollView
        // edge. TextureView clips like a normal view — fine for short muted
        // loops (no DRM; the perf cost is negligible at card size).
        surfaceType="textureView"
      />
    </View>
  );
}

const devErrorStyles = StyleSheet.create({
  box: { justifyContent: 'flex-end', padding: 8 },
  text: {
    color: '#ff6b6b',
    fontSize: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 4,
    borderRadius: 4,
  },
});

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
