import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { cancelCommunityJoinRequest, createCommunityPost, createCommunityPostComment, getCommunity, joinCommunity, listCommunityPosts, reportCommunityPost, requestCommunityJoin, setCommunityPostReaction } from '@/api/blabber';
import { PostCard } from '@/components/Cards';
import { Button, Input } from '@/components/Primitives';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';

export default function Community() {
  const { handle = '' } = useLocalSearchParams<{ handle: string }>();
  const theme = useTheme();
  const community = useApiResource(() => getCommunity(handle), [handle]);
  const posts = useApiResource(() => listCommunityPosts(handle), [handle]);
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const membershipState = community.data?.community?.membershipState || community.data?.community?.viewerState || (community.data?.community?.membership ? 'member' : community.data?.community?.joinRequest ? 'requested' : 'none');

  const joinOrRequest = async () => {
    setBusy(true);
    try {
      const access = community.data?.community?.access || community.data?.community?.visibility || 'open';
      if (membershipState === 'requested') await cancelCommunityJoinRequest(handle);
      else if (access === 'open' || access === 'public') await joinCommunity(handle);
      else await requestCommunityJoin(handle);
      await community.refresh();
      await posts.refresh();
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await createCommunityPost(handle, body.trim());
      setBody('');
      await posts.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (community.loading && !community.data) return <LoadingState label="Loading Community..." />;
  const item = community.data?.community;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>{item?.name || handle}</Text>
      {community.error ? <ErrorState message="This content is unavailable." /> : null}
      <Text style={{ color: theme.muted }}>{item?.description || item?.membershipState || 'Community access is server-authorized.'}</Text>
      {membershipState !== 'member' && membershipState !== 'owner' && membershipState !== 'moderator' ? <Button label={membershipState === 'requested' ? 'Cancel request' : 'Join'} onPress={() => void joinOrRequest()} disabled={busy} /> : null}
      {membershipState === 'member' || membershipState === 'owner' || membershipState === 'moderator' ? (
        <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 10, backgroundColor: theme.surface }}>
          <Input label="Community post" value={body} onChangeText={setBody} maxLength={2000} multiline />
          <Button label="Publish" onPress={() => void publish()} disabled={busy || !body.trim()} />
        </View>
      ) : null}
      {posts.data?.posts?.length ? posts.data.posts.map((post) => (
        <PostCard
          key={post.id || post._id}
          post={post}
          onReact={(item) => void setCommunityPostReaction(item.id || item._id).then(posts.refresh)}
          onComment={(item) => comment.trim() ? void createCommunityPostComment(item.id || item._id, comment.trim()).then(() => { setComment(''); return posts.refresh(); }) : undefined}
          onReport={(item) => void reportCommunityPost(item.id || item._id)}
        />
      )) : <EmptyState title="No visible posts" body="Private or invite-only content stays unavailable unless the server authorizes it." />}
      <Input label="Community comment" value={comment} onChangeText={setComment} placeholder="Type before tapping Comment" maxLength={1000} />
    </Screen>
  );
}
