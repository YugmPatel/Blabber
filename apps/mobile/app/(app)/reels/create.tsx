import { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { updateReelDiscovery } from '@/api/blabber';
import { Button, Input } from '@/components/Primitives';
import { Screen } from '@/components/Screen';
import { ErrorState } from '@/components/States';
import { useTheme } from '@/theme/theme';
import { cancelMobileReelUpload, publishMobileReel, uploadPickedReelForPublishing, type MobileReelUploadState } from '@/uploads/mobile-reel-upload';

function parseTopics(value: string) {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean)
    .slice(0, 3);
}

export default function CreateReel() {
  const theme = useTheme();
  const router = useRouter();
  const [state, setState] = useState<MobileReelUploadState>('idle');
  const [reelId, setReelId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<'followers' | 'public'>('followers');
  const [discoverable, setDiscoverable] = useState(false);
  const [topics, setTopics] = useState('');
  const [error, setError] = useState('');
  const busy = !['idle', 'ready', 'published', 'cancelled', 'upload_interrupted', 'unavailable'].includes(state);

  const selectVideo = async () => {
    setError('');
    try {
      const draft = await uploadPickedReelForPublishing(setState);
      setReelId(draft?.reelId || null);
    } catch {
      setError('The Reel could not be uploaded. Try again with a different video.');
    }
  };

  const publish = async () => {
    if (!reelId) return;
    setError('');
    try {
      const topicIds = parseTopics(topics);
      const reel = await publishMobileReel({ reelId, caption, visibility, topicIds }, setState);
      if (discoverable) await updateReelDiscovery(reel.id || reelId, { reelDiscoverable: true, reelTopicIds: topicIds });
      router.replace(`/reels/${reel.id || reelId}`);
    } catch {
      setError('This Reel is not ready to publish yet.');
    }
  };

  const cancel = async () => {
    await cancelMobileReelUpload(reelId);
    setReelId(null);
    setState('cancelled');
  };

  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Create Reel</Text>
      {error ? <ErrorState message={error} /> : null}
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 10, backgroundColor: theme.surface }}>
        <Text style={{ color: theme.text, fontWeight: '700' }}>Upload</Text>
        <Text style={{ color: theme.muted }}>Status: {state.replaceAll('_', ' ')}</Text>
        <Button label={state === 'upload_interrupted' ? 'Retry upload' : 'Choose video'} onPress={() => void selectVideo()} disabled={busy} />
        {reelId ? <Button label="Cancel upload" onPress={() => void cancel()} disabled={busy && state !== 'processing'} /> : null}
      </View>
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 10, backgroundColor: theme.surface }}>
        <Text style={{ color: theme.text, fontWeight: '700' }}>Publish</Text>
        <Input label="Caption" value={caption} onChangeText={setCaption} maxLength={2200} multiline />
        <Input label="Topics" value={topics} onChangeText={setTopics} placeholder="technology, design" autoCapitalize="none" />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label={visibility === 'followers' ? 'Followers' : 'Public'} onPress={() => setVisibility((value) => value === 'followers' ? 'public' : 'followers')} disabled={busy} />
          <Button label={discoverable ? 'Discoverable' : 'Not discoverable'} onPress={() => setDiscoverable((value) => !value)} disabled={busy || visibility !== 'public'} />
          <Button label="Publish" onPress={() => void publish()} disabled={!reelId || state !== 'ready'} />
        </View>
      </View>
    </Screen>
  );
}
