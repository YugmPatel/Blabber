import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/theme';

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: 'home-outline',
  discover: 'compass-outline',
  moments: 'ellipse-outline',
  reels: 'play-circle-outline',
  messages: 'chatbubbles-outline',
  notifications: 'notifications-outline',
  profile: 'person-outline',
};

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name] || 'ellipse-outline'} color={color} size={size} />,
      })}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="moments" options={{ title: 'Moments' }} />
      <Tabs.Screen name="reels" options={{ title: 'Reels' }} />
      <Tabs.Screen name="messages" options={{ title: 'Convo' }} />
      <Tabs.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
