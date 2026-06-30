import { useState } from 'react';
import { Text, View } from 'react-native';
import { createPost, createPostComment, listFeed, reportPost, setPostReaction } from '@/api/blabber';
import { PostCard } from '@/components/Cards';
import { Button, Input } from '@/components/Primitives';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';
import { uploadPickedImageForPublishing, type MobileImageUploadState } from '@/uploads/mobile-image-upload';

export default function Home() {
  const theme = useTheme();
  const feed = useApiResource(() => listFeed(), []);
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<MobileImageUploadState>('idle');
  const [busy, setBusy] = useState(false);

  const attachPhoto = async () => {
    setBusy(true);
    try {
      const uploaded = await uploadPickedImageForPublishing(setUploadState);
      if (uploaded?.status === 'approved') setMediaId(uploaded.mediaId);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!body.trim() && !mediaId) return;
    setBusy(true);
    try {
      await createPost({ body: body.trim() || undefined, visibility: 'followers', mediaIds: mediaId ? [mediaId] : [] });
      setBody('');
      setMediaId(null);
      setUploadState('idle');
      await feed.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (feed.loading && !feed.data) return <LoadingState label="Loading feed..." />;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Home</Text>
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 10, backgroundColor: theme.surface }}>
        <Input label="Post" value={body} onChangeText={setBody} placeholder="Share an update" multiline maxLength={2000} />
        <Text style={{ color: theme.muted }}>{mediaId ? 'Photo ready' : uploadState === 'idle' ? 'Optional photo' : uploadState.replaceAll('_', ' ')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label={mediaId ? 'Replace photo' : 'Add photo'} onPress={() => void attachPhoto()} disabled={busy} />
          <Button label="Publish" onPress={() => void publish()} disabled={busy || (!body.trim() && !mediaId)} />
        </View>
      </View>
      {feed.error ? <ErrorState message={feed.error} /> : null}
      {feed.data?.posts?.length ? feed.data.posts.map((post) => (
        <PostCard
          key={post.id || post._id}
          post={post}
          onReact={(item) => void setPostReaction(item.id || item._id).then(feed.refresh)}
          onComment={(item) => comment.trim() ? void createPostComment(item.id || item._id, comment.trim()).then(() => { setComment(''); return feed.refresh(); }) : undefined}
          onReport={(item) => void reportPost(item.id || item._id)}
        />
      )) : <EmptyState title="No posts yet" body="Follow people to fill your mobile feed." />}
      <Input label="Quick comment" value={comment} onChangeText={setComment} placeholder="Type before tapping Comment" maxLength={1000} />
    </Screen>
  );
}
