import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSeason } from '@/components/series/season';

import { colours, components, typography } from '@/constants/tokens';
import { useHealthSync } from '@/hooks/useHealthSync';
import { useLiveEventSignals } from '@/hooks/useLiveEventSignals';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabIconProps {
  name: IoniconName;
  nameActive: IoniconName;
  label: string;
  focused: boolean;
}

function TabIcon({ name, nameActive, label, focused }: TabIconProps) {
  return (
    <View style={styles.tabItem}>
      <Ionicons
        name={focused ? nameActive : name}
        size={26}
        color={focused ? colours.accent : colours.textMuted}
      />
    </View>
  );
}

export default function TabLayout() {
  const { t } = useTranslation();
  useHealthSync();
  // Live-event lifecycle pushed from the DB — the reveal turns every phone
  // over by itself. Above the tabs so it holds whichever tab is showing.
  useLiveEventSignals();
  // While the Series is on for the member (always in dev): the tab bar wears the active Series season (components/series/season).
  const { tint } = useSeason();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [styles.tabBar, tint && { backgroundColor: tint.card, borderTopColor: tint.border }],
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('system:tabs.home'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name="home-outline" nameActive="home" label="HOME" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: t('system:tabs.progress'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name="bar-chart-outline" nameActive="bar-chart" label="PROGRESS" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="league"
        options={{
          title: t('system:tabs.league'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name="trophy-outline" nameActive="trophy" label="LEAGUE" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: t('system:tabs.spend'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name="bag-outline" nameActive="bag" label="SPEND" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: t('system:tabs.discover'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name="compass-outline" nameActive="compass" label="DISCOVER" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: components.tabBar.background,
    borderTopWidth: 1,
    borderTopColor: components.tabBar.border,
    height: Platform.OS === 'ios' ? 84 : 64,
    paddingTop: 8,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 2,
  },
  tabLabel: {
    fontFamily: typography.label.fontFamily,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
  tabLabelActive: {
    color: colours.accent,
  },
});
