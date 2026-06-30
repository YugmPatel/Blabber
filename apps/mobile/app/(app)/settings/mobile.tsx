import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getDiscoveryPreferences, getNotificationPreferences, updateDiscoveryPreferences, updateNotificationPreferences } from '@/api/blabber';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/Primitives';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { disableMobileNotifications, enableMobileNotifications, readMobilePushStatus, type MobilePushState } from '@/notifications/mobile-push';
import { useTheme } from '@/theme/theme';

export default function MobileSettings() {
  const theme = useTheme();
  const { signOut, user } = useAuth();
  const notifications = useApiResource(async () => user?._id ? getNotificationPreferences(user._id) : { preferences: null }, [user?._id]);
  const discovery = useApiResource(() => getDiscoveryPreferences(), []);
  const [saving, setSaving] = useState(false);
  const [messageNotificationsEnabled, setMessageNotificationsEnabled] = useState(true);
  const [momentUpdatesEnabled, setMomentUpdatesEnabled] = useState(true);
  const [postActivityEnabled, setPostActivityEnabled] = useState(true);
  const [reelActivityEnabled, setReelActivityEnabled] = useState(true);
  const [personalizedDiscoveryEnabled, setPersonalizedDiscoveryEnabled] = useState(true);
  const [mobilePushState, setMobilePushState] = useState<MobilePushState>('not_enabled');

  useEffect(() => {
    const prefs = notifications.data?.preferences;
    if (!prefs) return;
    setMessageNotificationsEnabled(prefs.messageNotificationsEnabled !== false);
    setMomentUpdatesEnabled(prefs.momentUpdatesEnabled !== false);
    setPostActivityEnabled(prefs.postActivityEnabled !== false);
    setReelActivityEnabled(prefs.reelActivityEnabled !== false);
  }, [notifications.data?.preferences]);

  useEffect(() => {
    const prefs = discovery.data?.preferences;
    if (!prefs) return;
    setPersonalizedDiscoveryEnabled(prefs.personalizedDiscoveryEnabled !== false);
  }, [discovery.data?.preferences]);

  useEffect(() => {
    let mounted = true;
    readMobilePushStatus().then((state) => {
      if (mounted) setMobilePushState(state);
    }).catch(() => {
      if (mounted) setMobilePushState('unavailable');
    });
    return () => {
      mounted = false;
    };
  }, []);

  const saveNotifications = async () => {
    if (!user?._id) return;
    setSaving(true);
    try {
      await updateNotificationPreferences(user._id, { messageNotificationsEnabled, momentUpdatesEnabled, postActivityEnabled, reelActivityEnabled });
      await notifications.refresh();
    } finally {
      setSaving(false);
    }
  };

  const saveDiscovery = async () => {
    setSaving(true);
    try {
      await updateDiscoveryPreferences({ personalizedDiscoveryEnabled });
      await discovery.refresh();
    } finally {
      setSaving(false);
    }
  };

  const enablePush = async () => {
    setSaving(true);
    try {
      setMobilePushState(await enableMobileNotifications());
    } finally {
      setSaving(false);
    }
  };

  const disablePush = async () => {
    setSaving(true);
    try {
      setMobilePushState(await disableMobileNotifications());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Mobile settings</Text>
      <EmptyState title="Theme" body="Light, Dark, and System theme support follows the device setting in this foundation release." />
      {notifications.error ? <ErrorState message={notifications.error} /> : null}
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 8, backgroundColor: theme.surface }}>
        <Text style={{ color: theme.text, fontWeight: '700' }}>Notifications</Text>
        <Text style={{ color: theme.muted }}>Device push: {mobilePushState.replaceAll('_', ' ')}</Text>
        <Button label={mobilePushState === 'enabled' ? 'Disable device push' : 'Enable device push'} onPress={() => void (mobilePushState === 'enabled' ? disablePush() : enablePush())} disabled={saving} />
        <Button label={messageNotificationsEnabled ? 'Messages on' : 'Messages off'} onPress={() => setMessageNotificationsEnabled((value) => !value)} disabled={saving} />
        <Button label={momentUpdatesEnabled ? 'Moments on' : 'Moments off'} onPress={() => setMomentUpdatesEnabled((value) => !value)} disabled={saving} />
        <Button label={postActivityEnabled ? 'Posts on' : 'Posts off'} onPress={() => setPostActivityEnabled((value) => !value)} disabled={saving} />
        <Button label={reelActivityEnabled ? 'Reels on' : 'Reels off'} onPress={() => setReelActivityEnabled((value) => !value)} disabled={saving} />
        <Button label="Save notifications" onPress={() => void saveNotifications()} disabled={saving} />
      </View>
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 8, backgroundColor: theme.surface }}>
        <Text style={{ color: theme.text, fontWeight: '700' }}>Discovery</Text>
        <Button label={personalizedDiscoveryEnabled ? 'Personalized For You on' : 'Personalized For You off'} onPress={() => setPersonalizedDiscoveryEnabled((value) => !value)} disabled={saving} />
        <Button label="Save discovery" onPress={() => void saveDiscovery()} disabled={saving} />
      </View>
      <EmptyState title="Reels privacy" body="Reels remain available only while you are authorized to view them." />
      <Button label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
