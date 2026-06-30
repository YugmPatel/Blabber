import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { cancelFollowRequest, followProfile, getProfile, listProfilePosts, listProfileReels, unfollowProfile } from '@/api/blabber';
import { PostCard, ReelCard } from '@/components/Cards';
import { Button } from '@/components/Primitives';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';

export default function PublicProfile() {
  const { handle = '' } = useLocalSearchParams<{ handle: string }>();
  const theme = useTheme();
  const profile = useApiResource(() => getProfile(handle), [handle]);
  const posts = useApiResource(() => listProfilePosts(handle), [handle]);
  const reels = useApiResource(() => listProfileReels(handle), [handle]);
  if (profile.loading && !profile.data) return <LoadingState label="Loading profile..." />;
  const item = profile.data?.profile;
  const locked = item?.locked;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>{item?.name || 'Profile'}</Text>
      {profile.error ? <ErrorState message="This content is unavailable." /> : null}
      <Text style={{ color: theme.muted }}>{item?.displayHandle || handle}</Text>
      {!locked && item?.relationship !== 'self' ? (
        <Button label={item?.relationship === 'following' ? 'Unfollow' : item?.relationship === 'requested_outgoing' ? 'Cancel request' : 'Follow'} onPress={async () => {
          if (item?.relationship === 'following') await unfollowProfile(handle);
          else if (item?.relationship === 'requested_outgoing') await cancelFollowRequest(handle);
          else await followProfile(handle);
          await profile.refresh();
        }} />
      ) : null}
      {locked ? <EmptyState title="This profile is private." /> : null}
      {!locked ? posts.data?.posts?.map((post) => <PostCard key={post.id || post._id} post={post} />) : null}
      {!locked ? reels.data?.reels?.map((reel) => <ReelCard key={reel.id} reel={reel} />) : null}
    </Screen>
  );
}
