import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { API_BASE_URL } from '@/config/api-base';
import {
  createReelComment,
  createReelEventToken,
  createReelPlaybackSession,
  getReel,
  listReelComments,
  recordReelEvent,
  removeReelReaction,
  saveReel,
  setReelReaction,
  unsaveReel,
} from '@/api/blabber';
import { getAccessTokenForSocket } from '@/api/client';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';
import { useLocalSearchParams } from 'expo-router';

const reactions = ['❤️', '😂', '😮', '😢', '🙌'];

export default function ReelDetail() {
  const { reelId = '' } = useLocalSearchParams<{ reelId: string }>();
  const theme = useTheme();
  const reel = useApiResource(() => getReel(reelId), [reelId]);
  const comments = useApiResource(() => listReelComments(reelId), [reelId]);
  const [playback, setPlayback] = useState<{ fallbackUrl: string; posterUrl: string } | null>(null);
  const [eventToken, setEventToken] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [localReel, setLocalReel] = useState<any | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [retryCount, setRetryCount] = useState(0);
  const source = useMemo(() => {
    const token = getAccessTokenForSocket();
    if (!appActive || !playback || !token) return null;
    return { uri: new URL(playback.fallbackUrl, API_BASE_URL).toString(), headers: { Authorization: `Bearer ${token}` } };
  }, [appActive, playback]);
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
  });

  useEffect(() => {
    if (reel.data?.reel) setLocalReel(reel.data.reel);
  }, [reel.data?.reel]);

  useEffect(() => {
    let mounted = true;
    setPlayback(null);
    setEventToken('');
    if (appActive && reel.data?.reel?.id) {
      createReelPlaybackSession(reelId).then((result) => {
        if (mounted) setPlayback(result.playback);
      }).catch(() => {
        if (mounted) setPlayback(null);
        if (mounted && retryCount < 2) setRetryCount((value) => value + 1);
      });
      createReelEventToken(reelId).then((result) => {
        if (mounted) setEventToken(result.eventToken);
      }).catch(() => undefined);
    } else {
      player.pause();
    }
    return () => {
      mounted = false;
      setPlayback(null);
      setEventToken('');
      player.pause();
    };
  }, [appActive, player, reel.data?.reel?.id, reelId, retryCount]);

  useEffect(() => {
    if (appActive && eventToken) void recordReelEvent(reelId, { eventType: 'reel_open', eventToken });
  }, [appActive, eventToken, reelId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const react = async (emoji: string) => {
    const result = localReel?.myReaction === emoji ? await removeReelReaction(reelId) : await setReelReaction(reelId, emoji);
    setLocalReel((current: any) => current ? { ...current, myReaction: result.myReaction, reactionCounts: result.reactionCounts } : current);
  };

  const toggleSave = async () => {
    const result = localReel?.saved ? await unsaveReel(reelId) : await saveReel(reelId);
    setLocalReel((current: any) => current ? { ...current, saved: result.saved } : current);
  };

  const submitComment = async () => {
    const body = commentBody.trim();
    if (!body) return;
    const result = await createReelComment(reelId, body);
    setCommentBody('');
    setLocalReel((current: any) => current ? { ...current, commentCount: result.commentCount } : current);
    await comments.refresh();
  };

  if (reel.loading && !reel.data) return <LoadingState label="Loading Reel..." />;
  if (reel.error) return <Screen><ErrorState message="This Reel is unavailable." /></Screen>;

  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>Reel</Text>
      {source ? (
        <VideoView player={player} style={{ width: '100%', aspectRatio: 9 / 16, backgroundColor: '#000000', borderRadius: 8 }} nativeControls />
      ) : (
        <EmptyState title="Preparing playback" body="Reels remain available only while you are authorized to view them." />
      )}
      <Text style={{ color: theme.text }}>{localReel?.caption || ''}</Text>
      <Text style={{ color: theme.muted }}>{localReel?.durationSeconds ? `${Math.round(localReel.durationSeconds)}s` : ''}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {reactions.map((emoji) => (
          <Pressable key={emoji} onPress={() => void react(emoji)} accessibilityRole="button" style={{ borderWidth: 1, borderColor: localReel?.myReaction === emoji ? theme.primary : theme.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}>
            <Text style={{ color: theme.text }}>{emoji} {localReel?.reactionCounts?.[emoji] || 0}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => void toggleSave()} accessibilityRole="button" style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}>
          <Text style={{ color: theme.text }}>{localReel?.saved ? 'Saved' : 'Save'}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={commentBody} onChangeText={setCommentBody} maxLength={500} placeholder="Add a comment" placeholderTextColor={theme.muted} style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, color: theme.text, paddingHorizontal: 10, paddingVertical: 8 }} />
        <Pressable onPress={() => void submitComment()} accessibilityRole="button" style={{ borderRadius: 8, backgroundColor: theme.primary, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Text style={{ color: '#ffffff', fontWeight: '800' }}>Post</Text>
        </Pressable>
      </View>
      {(comments.data?.comments || []).map((comment) => (
        <View key={comment.id} style={{ borderRadius: 8, padding: 10, gap: 4, backgroundColor: theme.surface }}>
          <Text style={{ color: theme.text, fontWeight: '700' }}>{comment.author?.name || comment.author?.handle || 'Member'}</Text>
          <Text style={{ color: theme.text }}>{comment.body}</Text>
        </View>
      ))}
    </Screen>
  );
}
