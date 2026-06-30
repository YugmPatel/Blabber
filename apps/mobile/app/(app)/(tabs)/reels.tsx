import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { API_BASE_URL } from '@/config/api-base';
import {
  createReelComment,
  createReelEventToken,
  createReelPlaybackSession,
  listReelComments,
  listReelsBrowse,
  listReelsForYou,
  muteReelCreator,
  notInterestedReel,
  recordReelEvent,
  removeReelReaction,
  reportReel,
  refreshReelsForYou,
  saveReel,
  setReelReaction,
  unsaveReel,
} from '@/api/blabber';
import { getAccessTokenForSocket } from '@/api/client';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';

const reactions = ['❤️', '😂', '😮', '😢', '🙌'];

function ActiveReelVideo({ reelId, allowSignals, appActive, muted }: { reelId: string; allowSignals: boolean; appActive: boolean; muted: boolean }) {
  const [playback, setPlayback] = useState<{ fallbackUrl: string; posterUrl: string } | null>(null);
  const [eventToken, setEventToken] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const source = useMemo(() => {
    const token = getAccessTokenForSocket();
    if (!appActive || !playback || !token) return null;
    return { uri: new URL(playback.fallbackUrl, API_BASE_URL).toString(), headers: { Authorization: `Bearer ${token}` } };
  }, [appActive, playback]);
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = true;
    instance.muted = muted;
  });

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    let mounted = true;
    setPlayback(null);
    setEventToken('');
    if (!appActive) {
      player.pause();
      return () => {
        mounted = false;
      };
    }
    createReelPlaybackSession(reelId).then((result) => {
      if (mounted) setPlayback(result.playback);
    }).catch(() => {
      if (mounted && retryCount < 2) setRetryCount((value) => value + 1);
    });
    if (allowSignals) {
      createReelEventToken(reelId).then((result) => {
        if (mounted) setEventToken(result.eventToken);
      }).catch(() => undefined);
    }
    return () => {
      mounted = false;
      setPlayback(null);
      setEventToken('');
      player.pause();
    };
  }, [allowSignals, appActive, player, reelId, retryCount]);

  useEffect(() => {
    if (!appActive || !eventToken || !allowSignals) return;
    void recordReelEvent(reelId, { eventType: 'reel_open', eventToken });
  }, [allowSignals, appActive, eventToken, reelId]);

  if (!source) return <View style={[styles.video, styles.videoEmpty]}><Text style={{ color: '#ffffff' }}>Preparing playback</Text></View>;
  return <VideoView player={player} style={styles.video} nativeControls />;
}

function ReelCard({ reel, allowSignals, appActive, active, prepared, onActivate, onHidden, onChanged }: { reel: any; allowSignals: boolean; appActive: boolean; active: boolean; prepared: boolean; onActivate: () => void; onHidden: () => void; onChanged: (patch: Partial<any>) => void }) {
  const theme = useTheme();
  const [muted, setMuted] = useState(true);
  const [commentBody, setCommentBody] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const comments = useApiResource(() => listReelComments(reel.id), [reel.id, commentsOpen]);

  const react = async (emoji: string) => {
    const result = reel.myReaction === emoji ? await removeReelReaction(reel.id) : await setReelReaction(reel.id, emoji);
    onChanged({ myReaction: result.myReaction, reactionCounts: result.reactionCounts });
  };

  const toggleSave = async () => {
    const result = reel.saved ? await unsaveReel(reel.id) : await saveReel(reel.id);
    onChanged({ saved: result.saved });
  };

  const submitComment = async () => {
    const body = commentBody.trim();
    if (!body) return;
    const result = await createReelComment(reel.id, body);
    setCommentBody('');
    onChanged({ commentCount: result.commentCount });
    await comments.refresh();
  };

  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      {active ? (
        <ActiveReelVideo reelId={reel.id} allowSignals={allowSignals} appActive={appActive} muted={muted} />
      ) : (
        <Pressable onPress={onActivate} accessibilityRole="button" style={[styles.video, styles.videoEmpty]}>
          <Text style={{ color: '#ffffff', fontWeight: '800' }}>{prepared ? 'Next Reel ready' : 'Play Reel'}</Text>
        </Pressable>
      )}
      <View style={styles.row}>
        <Link href={`/reels/${reel.id}`} style={{ color: theme.primary, fontWeight: '800' }}>{reel.author?.name || reel.author?.handle || 'Creator'}</Link>
        <Pressable onPress={() => setMuted((value) => !value)} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.border }]}>
          <Text style={{ color: theme.text }}>{muted ? 'Unmute' : 'Mute'}</Text>
        </Pressable>
      </View>
      {reel.caption ? <Text style={{ color: theme.text }}>{reel.caption}</Text> : null}
      {reel.explanation?.text ? (
        <View style={{ gap: 6 }}>
          <Pressable onPress={() => setWhyOpen((value) => !value)} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}>
            <Text style={{ color: theme.text }}>Why am I seeing this?</Text>
          </Pressable>
          {whyOpen ? <Text style={{ color: theme.muted }}>{reel.explanation.text}</Text> : null}
        </View>
      ) : null}
      <View style={styles.wrap}>
        {reactions.map((emoji) => (
          <Pressable key={emoji} onPress={() => void react(emoji)} accessibilityRole="button" style={[styles.smallButton, { borderColor: reel.myReaction === emoji ? theme.primary : theme.border }]}>
            <Text style={{ color: theme.text }}>{emoji} {reel.reactionCounts?.[emoji] || 0}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.wrap}>
        <Pressable onPress={() => void toggleSave()} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>{reel.saved ? 'Saved' : 'Save'}</Text></Pressable>
        <Pressable onPress={() => setCommentsOpen((value) => !value)} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>Comments {reel.commentCount || 0}</Text></Pressable>
        <Pressable onPress={() => notInterestedReel(reel.id).then(onHidden).catch(() => undefined)} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>Not interested</Text></Pressable>
        <Pressable onPress={() => muteReelCreator(reel.id).then(onHidden).catch(() => undefined)} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>Mute creator</Text></Pressable>
        <Pressable onPress={() => reportReel(reel.id).catch(() => undefined)} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>Report</Text></Pressable>
      </View>
      {commentsOpen ? (
        <View style={styles.comments}>
          <View style={styles.row}>
            <TextInput value={commentBody} onChangeText={setCommentBody} maxLength={500} placeholder="Add a comment" placeholderTextColor={theme.muted} style={[styles.input, { color: theme.text, borderColor: theme.border }]} />
            <Pressable onPress={() => void submitComment()} accessibilityRole="button" style={[styles.postButton, { backgroundColor: theme.primary }]}><Text style={styles.postText}>Post</Text></Pressable>
          </View>
          {(comments.data?.comments || []).map((comment) => (
            <View key={comment.id} style={[styles.comment, { backgroundColor: theme.bg }]}>
              <Text style={{ color: theme.text, fontWeight: '700' }}>{comment.author?.name || comment.author?.handle || 'Member'}</Text>
              <Text style={{ color: theme.text }}>{comment.body}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function Reels() {
  const theme = useTheme();
  const [tab, setTab] = useState<'for-you' | 'browse'>('for-you');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [patches, setPatches] = useState<Record<string, Partial<any>>>({});
  const [activeReelId, setActiveReelId] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const browse = useApiResource(() => listReelsBrowse(), []);
  const forYou = useApiResource(() => listReelsForYou(), []);
  const active = tab === 'for-you' ? forYou : browse;
  const visible = (active.data?.reels || [])
    .map((reel) => ({ ...reel, ...(patches[reel.id] || {}) }))
    .filter((reel) => !hiddenIds.has(reel.id));
  const currentActiveId = activeReelId && visible.some((reel) => reel.id === activeReelId) ? activeReelId : visible[0]?.id || null;
  const currentIndex = visible.findIndex((reel) => reel.id === currentActiveId);
  const preparedAdjacentId = currentIndex >= 0 ? visible[currentIndex + 1]?.id || null : null;

  useEffect(() => {
    if (currentActiveId && currentActiveId !== activeReelId) setActiveReelId(currentActiveId);
  }, [activeReelId, currentActiveId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  if (active.loading && !active.data) return <LoadingState label="Loading Reels..." />;

  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Reels</Text>
      <Link href="/reels/create" style={{ color: theme.primary, fontWeight: '800' }}>Create Reel</Link>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => setTab('for-you')} accessibilityRole="button" style={[styles.smallButton, { borderColor: tab === 'for-you' ? theme.primary : theme.border }]}><Text style={{ color: theme.text }}>For You</Text></Pressable>
        <Pressable onPress={() => setTab('browse')} accessibilityRole="button" style={[styles.smallButton, { borderColor: tab === 'browse' ? theme.primary : theme.border }]}><Text style={{ color: theme.text }}>Browse</Text></Pressable>
        {tab === 'for-you' ? <Pressable onPress={() => refreshReelsForYou().then(() => forYou.refresh()).catch(() => undefined)} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>Refresh</Text></Pressable> : null}
      </View>
      {tab === 'for-you' && forYou.data?.personalized === false ? <Text style={{ color: theme.muted }}>Personalized discovery is off. You are seeing the latest public Reels.</Text> : null}
      {active.error ? <ErrorState message={active.error} /> : null}
      {visible.length ? visible.map((reel) => (
        <ReelCard
          key={reel.id}
          reel={reel}
          allowSignals={tab === 'browse' || Boolean(forYou.data?.personalized)}
          appActive={appActive}
          active={reel.id === currentActiveId}
          prepared={reel.id === preparedAdjacentId}
          onActivate={() => setActiveReelId(reel.id)}
          onHidden={() => setHiddenIds((current) => new Set(current).add(reel.id))}
          onChanged={(patch) => setPatches((current) => ({ ...current, [reel.id]: { ...(current[reel.id] || {}), ...patch } }))}
        />
      )) : <EmptyState title="No Reels" body="Public opted-in Reels will appear here newest first." />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 10 },
  video: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#000000', borderRadius: 8 },
  videoEmpty: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallButton: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  comments: { gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  postButton: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  postText: { color: '#ffffff', fontWeight: '800' },
  comment: { borderRadius: 8, padding: 10, gap: 4 },
});
