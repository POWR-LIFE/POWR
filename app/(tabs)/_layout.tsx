import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { colours, components, typography } from '@/constants/tokens';

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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="home-outline" nameActive="home" label="HOME" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="bar-chart-outline" nameActive="bar-chart" label="PROGRESS" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="league"
        options={{
          title: 'League',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="trophy-outline" nameActive="trophy" label="LEAGUE" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Spend',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="bag-outline" nameActive="bag" label="SPEND" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
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
