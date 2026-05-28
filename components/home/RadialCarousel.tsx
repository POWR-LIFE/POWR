import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef } from 'react';
import { Dimensions, FlatList, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Extrapolate,
    interpolate,
    runOnJS,
    SharedValue,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue
} from 'react-native-reanimated';
import { ProgressRadial } from './ProgressRadial';

const { width: WINDOW_WIDTH } = Dimensions.get('window');
const ITEM_WIDTH = WINDOW_WIDTH * 0.85;
const SPACER_WIDTH = (WINDOW_WIDTH - ITEM_WIDTH) / 2;
const RADIAL_SIZE = 155;
const POINTS_PANEL_WIDTH = 72;
const ICON_PANEL_WIDTH = 56;

const GOLD  = '#E8D200';
const MUTED = 'rgba(255,255,255,0.25)';
const TEXT  = '#F2F2F2';

interface RadialData {
  id: string;
  pct: number;
  value: string;
  maxLabel: string;
  subLabel: string;
  gradientColors: string[];
  ticks?: { label: string; active: boolean; isToday: boolean }[];
  iconName?: any;
  iconLib?: 'ionicons' | 'material-community';
  pointsValue?: number;
}

interface RadialCarouselProps {
  data: RadialData[];
  activeIndex: number;
  onChange: (index: number) => void;
}

export function RadialCarousel({ data, activeIndex, onChange }: RadialCarouselProps) {
  const scrollX = useSharedValue(0);
  const flatListRef = useRef<FlatList<RadialData>>(null);
  // Keep activeIndex in a shared value so the worklet always sees the latest value
  const activeIndexSV = useSharedValue(activeIndex);
  // Flag to suppress onChange during programmatic (tab-click) scrolls
  const isProgrammaticScroll = useSharedValue(false);

  useEffect(() => {
    activeIndexSV.value = activeIndex;
  }, [activeIndex]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
    if (isProgrammaticScroll.value) return;
    const index = Math.round(event.contentOffset.x / ITEM_WIDTH);
    if (index >= 0 && index < data.length) {
      if (index !== activeIndexSV.value) {
        activeIndexSV.value = index;
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
        runOnJS(onChange)(index);
      }
    }
  });

  // Sync scroll position when activeIndex changes from parent (tab click)
  useEffect(() => {
    isProgrammaticScroll.value = true;
    flatListRef.current?.scrollToOffset({ offset: activeIndex * ITEM_WIDTH, animated: false });
    const timer = requestAnimationFrame(() => {
      isProgrammaticScroll.value = false;
    });
    return () => cancelAnimationFrame(timer);
  }, [activeIndex]);

  const setRef = useCallback((node: any) => {
    flatListRef.current = node;
  }, []);

  const renderItem = ({ item, index }: { item: RadialData; index: number }) => {
    return (
      <View style={styles.itemContainer}>
        <AnimatedRadialItem 
          item={item} 
          index={index} 
          scrollX={scrollX} 
        />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Animated.FlatList
        ref={setRef}
        data={data}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_WIDTH}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingHorizontal: SPACER_WIDTH,
        }}
        keyExtractor={(item) => item.id}
      />

      {/* Static POWR earned panel — always visible, left of centre */}
      <View style={styles.pointsPanel} pointerEvents="none">
        <Text style={styles.pointsNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{data[activeIndex]?.pointsValue ?? 0}</Text>
        <Text style={styles.pointsLbl}>{`POWR\nEARNED`}</Text>
      </View>

      {/* Static icon panel — always visible, right of centre */}
      <View style={styles.iconPanel} pointerEvents="none">
        {data[activeIndex]?.iconName && (
          data[activeIndex].iconLib === 'material-community'
            ? <MaterialCommunityIcons name={data[activeIndex].iconName} size={28} color={data[activeIndex].gradientColors[0]} />
            : <Ionicons name={data[activeIndex].iconName} size={28} color={data[activeIndex].gradientColors[0]} />
        )}
      </View>

    </View>
  );
}

function AnimatedRadialItem({ item, index, scrollX }: { item: RadialData; index: number; scrollX: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * ITEM_WIDTH,
      index * ITEM_WIDTH,
      (index + 1) * ITEM_WIDTH,
    ];

    const scale = interpolate(
      scrollX.value,
      inputRange,
      [0.8, 1, 0.8],
      Extrapolate.CLAMP
    );

    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0.4, 1, 0.4],
      Extrapolate.CLAMP
    );

    return {
      transform: [{ scale }],
      opacity,
    };
  });

  return (
    <Animated.View style={[styles.radialWrapper, animatedStyle]}>

      <ProgressRadial
        pct={item.pct}
        value={item.value}
        maxLabel={item.maxLabel}
        subLabel={item.subLabel}
        gradientColors={item.gradientColors}
        ticks={item.ticks}
        iconName={item.iconName}
        iconLib={item.iconLib}
        size={RADIAL_SIZE}
      />
    </Animated.View>
  );
}

function PaginationDot({ index, scrollX }: { index: number; scrollX: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * ITEM_WIDTH,
      index * ITEM_WIDTH,
      (index + 1) * ITEM_WIDTH,
    ];

    const width = interpolate(
      scrollX.value,
      inputRange,
      [6, 12, 6],
      Extrapolate.CLAMP
    );

    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0.2, 1, 0.2],
      Extrapolate.CLAMP
    );

    return {
      width,
      opacity,
    };
  });

  return (
    <Animated.View style={[styles.dot, animatedStyle]} />
  );
}

const styles = StyleSheet.create({
  container: {
    height: 192,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  itemContainer: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radialWrapper: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Static points panel — absolute overlay, left of the centred radial
  pointsPanel: {
    position: 'absolute',
    left: (WINDOW_WIDTH - RADIAL_SIZE) / 2 - POINTS_PANEL_WIDTH - 12,
    top: '50%',
    marginTop: -28,
    width: POINTS_PANEL_WIDTH,
    alignItems: 'center',
    gap: 5,
  },
  pointsNum: {
    fontSize: 34,
    fontWeight: '100',
    color: GOLD,
    letterSpacing: -1,
  },
  pointsLbl: {
    fontSize: 7,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: MUTED,
    textAlign: 'center',
    textTransform: 'uppercase',
    lineHeight: 11,
  },
  iconPanel: {
    position: 'absolute',
    right: (WINDOW_WIDTH - RADIAL_SIZE) / 2 - ICON_PANEL_WIDTH - 12,
    top: '50%',
    marginTop: -14,
    width: ICON_PANEL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagination: {
    flexDirection: 'row',
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: GOLD,
  },
});
