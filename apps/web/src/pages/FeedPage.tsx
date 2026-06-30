import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Loader2, Menu, MessageCircle, Send, Trash2, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Sidebar from '@/components/Sidebar';
import {
  createPost,
  createPostComment,
  deletePost,
  fetchFeed,
  fetchDiscoveryTopics,
  fetchMyProfile,
  fetchPostComments,
  normalizeMediaUrl,
  removePostReaction,
  setPostReaction,
  updatePostDiscovery,
} from '@/api/client';
import type { FeedPost } from '@/api/client';
import { useFileUpload } from '@/hooks/useFileUpload';

const REACTIONS = ['❤️', '😂', '😮', '😢', '🙌'];

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function PostCard({ post }: { post: FeedPost }) {
  const queryClient = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>(post.discovery?.topicIds || []);
  const topicsQuery = useQuery({ queryKey: ['discovery-topics'], queryFn: fetchDiscoveryTopics, enabled: post.canDelete && post.visibility === 'public' });
  const commentsQuery = useQuery({
    queryKey: ['post-comments', post.id],
    queryFn: () => fetchPostComments(post.id),
    enabled: commentsOpen,
  });

  const reaction = useMutation<{ reactionCounts: Record<string, number>; myReaction: string | null }, Error, string>({
    mutationFn: (emoji: string) => (post.myReaction === emoji ? removePostReaction(post.id) : setPostReaction(post.id, emoji)),
    onSuccess: (result) => {
      queryClient.setQueryData(['feed'], (old: any) =>
        old
          ? {
              ...old,
              posts: old.posts.map((item: FeedPost) =>
                item.id === post.id ? { ...item, reactionCounts: result.reactionCounts, myReaction: result.myReaction } : item
              ),
            }
          : old
      );
    },
  });

  const comment = useMutation({
    mutationFn: () => createPostComment(post.id, commentBody),
    onSuccess: (result) => {
      setCommentBody('');
      queryClient.setQueryData(['post-comments', post.id], (old: any) =>
        old ? { ...old, comments: [...old.comments, result.comment] } : old
      );
      queryClient.setQueryData(['feed'], (old: any) =>
        old
          ? {
              ...old,
              posts: old.posts.map((item: FeedPost) =>
                item.id === post.id ? { ...item, commentCount: result.commentCount } : item
              ),
            }
          : old
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => deletePost(post.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });
  const discovery = useMutation({
    mutationFn: (discoverable: boolean) => updatePostDiscovery(post.id, { discoverable, discoveryTopicIds: discoverable ? topicIds : topicIds.slice(0, 3) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });
  const toggleTopic = (id: string) => {
    setTopicIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 3 ? current : [...current, id]);
  };

  return (
    <article className="border-b border-slate-200 bg-white px-4 py-5 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={normalizeMediaUrl(post.author.avatarUrl)} alt={post.author.name} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{post.author.name}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {post.author.displayHandle || post.author.handle || 'Profile'} · {formatTime(post.createdAt)}
              {post.editedAt ? ' · Edited' : ''}
            </p>
          </div>
        </div>
        {post.canDelete && (
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-slate-900"
            aria-label="Delete post"
          >
            {remove.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        )}
      </div>

      {post.body && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">{post.body}</p>}

      {post.canDelete && post.visibility === 'public' && (
        <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <label className="flex items-center justify-between gap-3 text-sm font-medium">
            <span>Include in Discover</span>
            <input
              type="checkbox"
              checked={Boolean(post.discovery?.discoverable)}
              onChange={(event) => discovery.mutate(event.target.checked)}
              disabled={discovery.isPending || (topicIds.length === 0 && !post.discovery?.discoverable)}
              className="h-4 w-4 accent-teal-600"
              aria-label="Include in Discover"
            />
          </label>
          <p className="mt-1 text-xs text-slate-500">Discover can show this public post to signed-in Blabber users outside your followers.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(topicsQuery.data || []).slice(0, 8).map((topic) => (
              <button
                key={topic.id}
                onClick={() => toggleTopic(topic.id)}
                className={`rounded-md border px-2 py-1 text-xs ${topicIds.includes(topic.id) ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-200' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}
              >
                {topic.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {post.media.length > 0 && (
        <div className={`mt-4 grid gap-2 ${post.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {post.media.map((media) => (
            <img
              key={media.mediaId}
              src={normalizeMediaUrl(media.url)}
              alt=""
              className="aspect-square w-full rounded-lg bg-slate-100 object-cover dark:bg-slate-900"
              loading="lazy"
            />
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => reaction.mutate(emoji)}
            disabled={reaction.isPending}
            className={`inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-sm ${
              post.myReaction === emoji
                ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-200'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            <span>{emoji}</span>
            <span className="text-xs">{post.reactionCounts[emoji] || 0}</span>
          </button>
        ))}
        <button
          onClick={() => setCommentsOpen((value) => !value)}
          className="ml-auto inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          <MessageCircle size={15} />
          {post.commentCount}
        </button>
      </div>

      {commentsOpen && (
        <div className="mt-4 space-y-3">
          {commentsQuery.data?.comments.map((item) => (
            <div key={item.id} className="flex gap-2">
              <Avatar src={normalizeMediaUrl(item.author.avatarUrl)} alt={item.author.name} size="sm" />
              <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
                <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{item.author.name}</p>
                <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">{item.body}</p>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              maxLength={1000}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 dark:border-slate-800 dark:bg-slate-950"
              placeholder="Write a comment"
            />
            <button
              onClick={() => comment.mutate()}
              disabled={!commentBody.trim() || comment.isPending}
              className="rounded-lg bg-slate-950 px-3 text-white disabled:bg-slate-300 dark:bg-white dark:text-slate-950"
              aria-label="Post comment"
            >
              {comment.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function FeedPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'followers'>('followers');
  const [photos, setPhotos] = useState<Array<{ mediaId: string; url?: string }>>([]);
  const upload = useFileUpload();
  const profileQuery = useQuery({ queryKey: ['my-profile'], queryFn: fetchMyProfile });
  const feedQuery = useQuery({ queryKey: ['feed'], queryFn: () => fetchFeed() });
  const loadMore = useMutation({
    mutationFn: () => fetchFeed(feedQuery.data?.nextCursor),
    onSuccess: (page) => {
      queryClient.setQueryData(['feed'], (old: any) =>
        old ? { posts: [...old.posts, ...page.posts], nextCursor: page.nextCursor } : page
      );
    },
  });
  const canUsePublic = profileQuery.data?.visibility === 'public';
  const effectiveVisibility = canUsePublic ? visibility : 'followers';

  const canSubmit = useMemo(() => body.trim().length > 0 || photos.length > 0, [body, photos.length]);

  const submit = useMutation({
    mutationFn: () => createPost({ body, visibility: effectiveVisibility, mediaIds: photos.map((photo) => photo.mediaId) }),
    onSuccess: () => {
      setBody('');
      setPhotos([]);
      setVisibility('followers');
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const pickPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, 10 - photos.length);
    const uploaded: Array<{ mediaId: string; url?: string }> = [];
    for (const file of selected) {
      const result = await upload.uploadMedia?.(file);
      if (result?.mediaId) uploaded.push({ mediaId: result.mediaId, url: result.mediaUrl || result.publicUrl });
    }
    if (uploaded.length) setPhotos((current) => [...current, ...uploaded].slice(0, 10));
  };

  return (
    <main className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar onNewConversation={() => navigate('/chats')} onChatFilterChange={() => navigate('/chats')} onNavigateMobile={() => setSidebarOpen(false)} />
      </div>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="rounded-lg border border-slate-200 p-2 text-slate-600 dark:border-slate-800 md:hidden" aria-label="Open navigation">
              <Menu size={18} />
            </button>
            <h1 className="text-xl font-semibold">Feed</h1>
          </div>
        </header>

        <div className="mx-auto max-w-3xl">
          <section className="border-b border-slate-200 bg-white px-4 py-5 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Share an update"
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-teal-500 dark:border-slate-800 dark:bg-slate-950"
            />
            {photos.length > 0 && (
              <div className="mt-3 grid grid-cols-5 gap-2">
                {photos.map((photo) => (
                  <div key={photo.mediaId} className="relative">
                    <img src={normalizeMediaUrl(photo.url)} alt="" className="aspect-square rounded-lg object-cover" />
                    <button
                      onClick={() => setPhotos((current) => current.filter((item) => item.mediaId !== photo.mediaId))}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                      aria-label="Remove photo"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {upload.error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{upload.error}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">
                {upload.isUploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                Photos
                <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void pickPhotos(event.target.files)} />
              </label>
              <select
                value={effectiveVisibility}
                onChange={(event) => setVisibility(event.target.value as 'public' | 'followers')}
                disabled={!canUsePublic}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              >
                <option value="followers">Followers</option>
                {canUsePublic && <option value="public">Public</option>}
              </select>
              <button
                onClick={() => submit.mutate()}
                disabled={!canSubmit || submit.isPending || upload.isUploading}
                className="ml-auto inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300 dark:bg-white dark:text-slate-950"
              >
                {submit.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Post
              </button>
            </div>
          </section>

          {feedQuery.isLoading && <p className="px-6 py-8 text-sm text-slate-500">Loading feed...</p>}
          {feedQuery.data?.posts.length === 0 && <p className="px-6 py-8 text-sm text-slate-500">Your feed is quiet right now.</p>}
          {feedQuery.data?.posts.map((post) => <PostCard key={post.id} post={post} />)}
          {feedQuery.data?.nextCursor && (
            <div className="px-6 py-5">
              <button
                onClick={() => loadMore.mutate()}
                disabled={loadMore.isPending}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              >
                {loadMore.isPending ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
