import { Image, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { authenticatedMediaHeaders, resolveApiUrl } from '@/api/client';
import { Button } from '@/components/Primitives';
import { useTheme } from '@/theme/theme';

function mediaItems(post: any) {
  return post.media || post.mediaItems || post.attachments || [];
}

function mediaUri(item: any) {
  const raw = item?.url || item?.mediaUrl || item?.previewUrl || item?.path;
  return raw ? resolveApiUrl(raw) : null;
}

export function PostCard({
  post,
  onReact,
  onComment,
  onReport,
}: {
  post: any;
  onReact?: (post: any) => void;
  onComment?: (post: any) => void;
  onReport?: (post: any) => void;
}) {
  const theme = useTheme();
  const media = mediaItems(post);
  return (
    <View style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 8, padding: 12, gap: 8 }}>
      <Text style={{ color: theme.text, fontWeight: '700' }}>{post.author?.name || post.authorDisplayName || 'Blabber user'}</Text>
      <Text style={{ color: theme.muted }}>{post.author?.handle || post.authorHandle || ''}</Text>
      {post.body ? <Text style={{ color: theme.text, lineHeight: 20 }}>{post.body}</Text> : null}
      {media.map((item: any, index: number) => {
        const uri = mediaUri(item);
        return uri ? <Image key={item.id || item.mediaId || index} source={{ uri, headers: authenticatedMediaHeaders() }} style={{ width: '100%', aspectRatio: 1.25, borderRadius: 8, backgroundColor: theme.border }} resizeMode="cover" /> : null;
      })}
      <Text style={{ color: theme.muted }}>{post.reactionCount ?? post.reactionCounts?.total ?? 0} reactions · {post.commentCount ?? 0} comments</Text>
      {onReact || onComment || onReport ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {onReact ? <Button label="React" onPress={() => onReact(post)} /> : null}
          {onComment ? <Button label="Comment" onPress={() => onComment(post)} /> : null}
          {onReport ? <Button label="Report" onPress={() => onReport(post)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

export function ReelCard({ reel }: { reel: any }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Open Reel" onPress={() => router.push(`/reels/${reel.id}`)} style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 8, padding: 12 }}>
      <Text style={{ color: theme.text, fontWeight: '700' }}>{reel.caption || 'Reel'}</Text>
      <Text style={{ color: theme.muted }}>{reel.durationSeconds ? `${Math.round(reel.durationSeconds)}s` : 'Video'}</Text>
    </Pressable>
  );
}
