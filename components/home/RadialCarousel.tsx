import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { 
  useAnimatedScrollHandler, 
  useSharedValue, 
  useAnimatedStyle, 
  interpolate, 
  Extrapolate,
  runOnJS,
  useAnimatedRef,
  scrollTo,
  SharedValue
} from 'react-native-reanimated';
import { ProgressRadial } from './ProgressRadial';

const { width: WINDOW_WIDTH } = Dimensions.get('window');
const ITEM_WIDTH = WINDOW_WIDTH * 0.8;
const SPACER_WIDTH = (WINDOW_WIDTH - ITEM_WIDTH) / 2;

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
  const flatListRef = useAnimatedRef<Animated.FlatList<RadialData>>();

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
    const index = Math.round(event.contentOffset.x / ITEM_WIDTH);
    if (index >= 0 && index < data.length) {
      if (index !== activeIndex) {
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
        runOnJS(onChange)(index);
      }
    }
  });

  // Sync scroll position when activeIndex changes from parent (tab click)
  useEffect(() => {
    scrollTo(flatListRef, activeIndex * ITEM_WIDTH, 0, true);
  }, [activeIndex]);

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
        ref={flatListRef}
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
      
      {/* Pagination dots */}
      <View style={styles.pagination}>
        {data.map((_, i) => (
          <PaginationDot key={i} index={i} scrollX={scrollX} />
        ))}
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
        pointsValue={item.pointsValue}
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
    height: 250,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  itemContainer: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radialWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagination: {
    flexDirection: 'row',
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#E8D200',
  },
});
