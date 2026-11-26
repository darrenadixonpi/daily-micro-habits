import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { COLORS } from '../../src/ui/ui_styles';

const ICONS: Record<string, string> = { index: '☀︎', review: '↻', journal: '✎', stats: '▦', settings: '⚙︎' };

function tabIcon(name: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 18, color: focused ? COLORS.accent : COLORS.muted }}>{ICONS[name]}</Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: COLORS.accent }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: tabIcon('index') }} />
      <Tabs.Screen name="review" options={{ title: 'Review', tabBarIcon: tabIcon('review') }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal', tabBarIcon: tabIcon('journal') }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats', tabBarIcon: tabIcon('stats') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
