import { Image } from 'expo-image';
import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { LEVEL_IMAGE } from '@/constants/levels';

interface LevelIconProps {
  level: number;
  size?: number;
  color: string;
  strokeWidth?: number;
  /** When false, image-based levels render dimmed to signal a locked state. */
  unlocked?: boolean;
}

// 5-pointed star path centered in a 40×40 viewBox
function star(cx: number, cy: number, r1: number, r2: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = ((i * 36) - 90) * (Math.PI / 180);
    const r = i % 2 === 0 ? r1 : r2;
    pts.push(`${+(cx + r * Math.cos(a)).toFixed(2)},${+(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

// Regular polygon path (hexagon, pentagon, etc.)
function poly(cx: number, cy: number, r: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i * (360 / n)) - 90) * (Math.PI / 180);
    pts.push(`${+(cx + r * Math.cos(a)).toFixed(2)},${+(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

export function LevelIcon({ level, size = 40, color, strokeWidth = 1.8, unlocked = true }: LevelIconProps) {
  const sw = strokeWidth;

  // Pre-rendered artwork takes precedence over the generated SVG. The image is
  // its own colour, so instead of recolouring we dim it when the level is locked.
  const imageUri = LEVEL_IMAGE[level];
  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={{ width: size, height: size, opacity: unlocked ? 1 : 0.28 }}
        contentFit="contain"
        transition={200}
      />
    );
  }

  const icon = (() => {
    switch (level) {
      case 1: // BEGINNER — target circle
        return <>
          <Circle cx="20" cy="20" r="13" stroke={color} strokeWidth={sw} fill="none" />
          <Circle cx="20" cy="20" r="3.5" fill={color} />
        </>;

      case 2: // STARTER — star outline
        return <Path d={star(20, 20, 13, 5.5)} stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />;

      case 3: // CONTENDER — ascending bar chart
        return <>
          <Rect x="6" y="26" width="7.5" height="8"  fill={color} rx="1" />
          <Rect x="16" y="20" width="7.5" height="14" fill={color} rx="1" />
          <Rect x="26" y="13" width="7.5" height="21" fill={color} rx="1" />
        </>;

      case 4: // CLIMBER — up arrow
        return <Path
          d="M20,30 L20,10 M13,18 L20,10 L27,18"
          stroke={color} strokeWidth={sw + 0.2} fill="none"
          strokeLinecap="round" strokeLinejoin="round"
        />;

      case 5: // GRAFTER — person silhouette
        return <>
          <Circle cx="20" cy="12" r="5.5" stroke={color} strokeWidth={sw} fill="none" />
          <Path d="M8,32 Q14,22 20,22 Q26,22 32,32"
            stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
        </>;

      case 6: // ATHLETE — triangle (mountain)
        return <Path d="M20,8 L32,30 L8,30 Z"
          stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />;

      case 7: // COMPETITOR — circle with checkmark
        return <>
          <Circle cx="20" cy="20" r="13" stroke={color} strokeWidth={sw} fill="none" />
          <Path d="M13,20 L18,26 L27,14"
            stroke={color} strokeWidth={sw} fill="none"
            strokeLinecap="round" strokeLinejoin="round" />
        </>;

      case 8: // PERFORMER — rounded square with center dot
        return <>
          <Rect x="8" y="8" width="24" height="24" rx="5"
            stroke={color} strokeWidth={sw} fill="none" />
          <Circle cx="20" cy="20" r="3.5" fill={color} />
        </>;

      case 9: // SPECIALIST — eye
        return <>
          <Path d="M7,20 Q20,9 33,20 Q20,31 7,20 Z"
            stroke={color} strokeWidth={sw} fill="none" />
          <Circle cx="20" cy="20" r="4" fill={color} />
        </>;

      case 10: // VETERAN — star with subtle fill
        return <Path d={star(20, 20, 13, 5.5)}
          stroke={color} strokeWidth={sw} fill={`${color}55`} strokeLinejoin="round" />;

      case 11: // PRO — star inside circle
        return <>
          <Circle cx="20" cy="20" r="13" stroke={color} strokeWidth={sw} fill="none" />
          <Path d={star(20, 20, 8.5, 3.6)}
            stroke={color} strokeWidth={sw - 0.2} fill="none" strokeLinejoin="round" />
        </>;

      case 12: // OPERATOR — hexagon
        return <Path d={poly(20, 20, 14, 6)}
          stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />;

      case 13: // ENFORCER — arch with hanging pendulum dot
        return <>
          <Path d="M8,22 Q20,6 32,22"
            stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
          <Line x1="20" y1="22" x2="20" y2="30"
            stroke={color} strokeWidth={sw} strokeLinecap="round" />
          <Circle cx="20" cy="32.5" r="2.5" fill={color} />
        </>;

      case 14: // TITAN — pentagon with center dot
        return <>
          <Path d={poly(20, 20, 13, 5)}
            stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
          <Circle cx="20" cy="20" r="3" fill={color} />
        </>;

      case 15: // IRONCLAD — ECG / heartbeat pulse
        return <Path
          d="M4,20 L10,20 L13,11 L17,29 L20,16 L23,24 L26,20 L36,20"
          stroke={color} strokeWidth={sw} fill="none"
          strokeLinecap="round" strokeLinejoin="round"
        />;

      case 16: // CHAMPION — star in circle with fill
        return <>
          <Circle cx="20" cy="20" r="13" stroke={color} strokeWidth={sw} fill="none" />
          <Path d={star(20, 20, 8.5, 3.6)}
            stroke={color} strokeWidth={sw - 0.2} fill={`${color}70`} strokeLinejoin="round" />
        </>;

      case 17: // ICON — star inside hexagon
        return <>
          <Path d={poly(20, 20, 13, 6)}
            stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
          <Path d={star(20, 20, 7.5, 3.2)}
            stroke={color} strokeWidth={sw - 0.3} fill="none" strokeLinejoin="round" />
        </>;

      case 18: // LEGEND — circle with checkmark
        return <>
          <Circle cx="20" cy="20" r="13" stroke={color} strokeWidth={sw} fill="none" />
          <Path d="M12,20 L17,26.5 L28,13"
            stroke={color} strokeWidth={sw + 0.5} fill="none"
            strokeLinecap="round" strokeLinejoin="round" />
        </>;

      case 19: // IMMORTAL — sharp pointed star
        return <Path d={star(20, 20, 13, 4.5)}
          stroke={color} strokeWidth={sw} fill={`${color}30`} strokeLinejoin="round" />;

      case 20: // POWR — layered gold star
        return <>
          <Path d={star(20, 20, 13, 5.5)}
            stroke={color} strokeWidth={sw} fill={`${color}50`} strokeLinejoin="round" />
          <Path d={star(20, 20, 6.5, 2.8)} fill={color} />
        </>;

      default:
        return <Circle cx="20" cy="20" r="10" stroke={color} strokeWidth={sw} fill="none" />;
    }
  })();

  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      {icon}
    </Svg>
  );
}
