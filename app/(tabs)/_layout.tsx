import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: { height: 80, paddingBottom: 24, paddingTop: 8 },
        tabBarLabelStyle: { fontSize: 10 },
        tabBarIconStyle: { marginBottom: 2 },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '股票分析',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="chart.line.uptrend.xyaxis" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: '強勢雷達',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="flame.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: '我的庫存',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="briefcase.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: '通知設定',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="bell.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
