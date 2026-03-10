import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Easing, SafeAreaView, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { THEMES, useAppTheme } from '@/context/ThemeContext';
import { useRouter } from 'expo-router';

export default function HomeScreen() {
  const { theme, setTheme } = useAppTheme();
  const activeColor = THEMES.find(t => t.name === theme)?.primary || '#CEFF00';
  const router = useRouter();

  // Animation value for the aura pulse
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 2500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Redirect to onboarding after 3 seconds
    const timer = setTimeout(() => {
      router.push('/onboarding');
    }, 3000);

    return () => clearTimeout(timer);
  }, [pulseAnim, router]);

  return (
    <SafeAreaView className="bg-theme-bg" style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>

        {/* Animated Soft Edge Aura (Neon Rectangular Glow) */}
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: pulseAnim,
          }}
          pointerEvents="none"
        >
          <Svg height="100%" width="100%">
            {/* Multiple overlaid strokes to create a soft, gradient-like glowing border */}
            <Rect x="0" y="0" width="100%" height="100%" fill="none" stroke={activeColor} strokeWidth="4" strokeOpacity="0.8" />
            <Rect x="0" y="0" width="100%" height="100%" fill="none" stroke={activeColor} strokeWidth="12" strokeOpacity="0.4" />
            <Rect x="0" y="0" width="100%" height="100%" fill="none" stroke={activeColor} strokeWidth="24" strokeOpacity="0.2" />
            <Rect x="0" y="0" width="100%" height="100%" fill="none" stroke={activeColor} strokeWidth="48" strokeOpacity="0.1" />
            <Rect x="0" y="0" width="100%" height="100%" fill="none" stroke={activeColor} strokeWidth="80" strokeOpacity="0.05" />
          </Svg>
        </Animated.View>

        {/* Centered Main Logo */}
        <View style={{ alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
          <Image
            source={require('@/assets/images/powrlogotext.png')}
            style={{ width: 400, height: 220, maxWidth: '90%' }}
            contentFit="contain"
          />
        </View>

      </View>
    </SafeAreaView>
  );
}
