import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { listDiscoverCommunities, listDiscoverPosts, listForYou } from '@/api/blabber';
import { PostCard } from '@/components/Cards';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';

export default function Discover() {
  const theme = useTheme();
  const forYou = useApiResource(() => listForYou(), []);
  const browse = useApiResource(async () => ({ posts: (await listDiscoverPosts()).posts || [], communities: (await listDiscoverCommunities()).communities || [] }), []);
  if ((forYou.loading || browse.loading) && !forYou.data) return <LoadingState label="Loading Discover..." />;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Discover</Text>
      {forYou.error || browse.error ? <ErrorState message={forYou.error || browse.error || undefined} /> : null}
      <Text style={{ color: theme.text, fontWeight: '700' }}>For You</Text>
      {forYou.data?.posts?.length ? forYou.data.posts.map((post) => <PostCard key={post.id || post._id} post={post} />) : <EmptyState title="No recommendations" body="For You remains server-authorized and read-only on mobile." />}
      <Text style={{ color: theme.text, fontWeight: '700' }}>Browse</Text>
      {browse.data?.posts?.map((post) => <PostCard key={post.id || post._id} post={post} />)}
      {browse.data?.communities?.map((community) => (
        <View key={community.handle} style={{ padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }}>
          <Link href={`/c/${community.handle}`} style={{ color: theme.primary }}>{community.name || community.handle}</Link>
        </View>
      ))}
    </Screen>
  );
}
