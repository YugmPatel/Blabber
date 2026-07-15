import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bookmark, CalendarClock, ChevronDown, Globe, ImagePlus, Loader2, Menu, MessageCircle, Repeat2, Send, Share2, Trash2, UserPlus, Users, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Sidebar from '@/components/Sidebar';
import PlanThisDialog from '@/components/PlanThisDialog';
import { ShareToChatPanel } from '@/components/ShareToChat';
import {
  createPost,
  fetchAuthorizedObjectUrl,
  createPostComment,
  deletePost,
  fetchFeed,
  fetchDiscoveryTopics,
  fetchMyProfile,
  fetchPostComments,
  followProfile,
  normalizeMediaUrl,
  removePostReaction,
  repostPost,
  savePost,
  setPostReaction,
  undoRepostPost,
  unfollowProfile,
  unsavePost,
  updatePostDiscovery,
} from '@/api/client';
import type { FeedPost } from '@/api/client';
import { useFileUpload } from '@/hooks/useFileUpload';

const REACTIONS = ['❤️', '😂', '😮', '😢', '🙌'];

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function updateFeedPost(queryClient: ReturnType<typeof useQueryClient>, postId: string, update: (post: FeedPost) => FeedPost) {
  queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) =>
    old?.posts
      ? {
          ...old,
          posts: old.posts.map((item: FeedPost) => item.id === postId ? update(item) : item),
        }
      : old
  );
}

function FeedImage({ src, wide }: { src?: string; wide?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | undefined>();
  const shapeClass = wide ? 'max-h-[440px] w-full' : 'aspect-square w-full';

  useEffect(() => {
    let alive = true;
    let createdUrl: string | undefined;
    setFailed(false);
    setObjectUrl(undefined);
    fetchAuthorizedObjectUrl(src)
      .then((value) => {
        if (!alive) {
          if (value?.startsWith('blob:')) URL.revokeObjectURL(value);
          return;
        }
        createdUrl = value;
        setObjectUrl(value);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (createdUrl?.startsWith('blob:')) URL.revokeObjectURL(createdUrl);
    };
  }, [src]);

  if (!src || failed) {
    return (
      <div className={`flex ${shapeClass} items-center justify-center rounded-xl bg-[color:var(--bl-hover)] text-xs text-[color:var(--bl-text-muted)]`}>
        Image unavailable
      </div>
    );
  }
  if (!objectUrl) {
    return <div className={`${shapeClass} animate-pulse rounded-xl bg-[color:var(--bl-hover)]`} />;
  }
  return (
    <img
      src={objectUrl}
      alt=""
      className={`${shapeClass} rounded-xl bg-[color:var(--bl-hover)] object-cover`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function PostCard({ post }: { post: FeedPost }) {
  const queryClient = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
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
      updateFeedPost(queryClient, post.id, (item) => ({ ...item, reactionCounts: result.reactionCounts, myReaction: result.myReaction }));
    },
  });

  const comment = useMutation({
    mutationFn: () => createPostComment(post.id, commentBody),
    onSuccess: (result) => {
      setCommentBody('');
      queryClient.setQueryData(['post-comments', post.id], (old: any) =>
        old ? { ...old, comments: [...old.comments, result.comment] } : old
      );
      updateFeedPost(queryClient, post.id, (item) => ({ ...item, commentCount: result.commentCount }));
    },
  });

  const remove = useMutation({
    mutationFn: () => deletePost(post.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });
  const follow = useMutation({
    mutationFn: () => post.author.handle ? followProfile(post.author.handle) : Promise.reject(new Error('missing_handle')),
    onSuccess: (profile) => updateFeedPost(queryClient, post.id, (item) => ({
      ...item,
      author: { ...item.author, relationship: profile.relationship },
    })),
  });
  const unfollow = useMutation({
    mutationFn: () => post.author.handle ? unfollowProfile(post.author.handle) : Promise.reject(new Error('missing_handle')),
    onSuccess: (profile) => updateFeedPost(queryClient, post.id, (item) => ({
      ...item,
      author: { ...item.author, relationship: profile.relationship },
    })),
  });
  const save = useMutation({
    mutationFn: () => post.saved ? unsavePost(post.id) : savePost(post.id),
    onSuccess: (result) => updateFeedPost(queryClient, post.id, (item) => ({ ...item, saved: result.saved })),
  });
  const repost = useMutation({
    mutationFn: () => post.reposted ? undoRepostPost(post.id) : repostPost(post.id),
    onSuccess: (result) => {
      updateFeedPost(queryClient, post.id, (item) => ({ ...item, reposted: result.reposted }));
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
  const discovery = useMutation({
    mutationFn: (discoverable: boolean) => updatePostDiscovery(post.id, { discoverable, discoveryTopicIds: discoverable ? topicIds : topicIds.slice(0, 3) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });
  const toggleTopic = (id: string) => {
    setTopicIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 3 ? current : [...current, id]);
  };

  const VisibilityIcon = post.visibility === 'public' ? Globe : Users;

  return (
    <article className="rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-4 py-5 shadow-sm transition hover:[box-shadow:var(--bl-glow-sm)] sm:px-6">
      {post.repost && (
        <p className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-[color:var(--bl-text-muted)]">
          <Repeat2 size={14} className="text-teal-600 dark:text-teal-300" /> Reposted by {post.repost.repostedBy.name}
        </p>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={normalizeMediaUrl(post.author.avatarUrl)} alt={post.author.name} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[color:var(--bl-text)]">{post.author.name}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 truncate text-xs text-[color:var(--bl-text-muted)]">
              <span>{post.repost ? 'Original post by ' : ''}{post.author.displayHandle || post.author.handle || 'Profile'} · {formatTime(post.createdAt)}{post.editedAt ? ' · Edited' : ''}</span>
              <span className="inline-flex items-center gap-1" title={post.visibility === 'public' ? 'Public' : 'Followers only'}>
                <span aria-hidden="true">·</span>
                <VisibilityIcon size={11} />
                {post.visibility === 'public' ? 'Public' : 'Followers'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        {!post.canDelete && post.author.handle && post.author.relationship !== 'self' && (
          <button
            onClick={() => post.author.relationship === 'following' ? unfollow.mutate() : post.author.relationship === 'none' ? follow.mutate() : undefined}
            disabled={follow.isPending || unfollow.isPending || post.author.relationship === 'requested_outgoing'}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--bl-border)] px-3 text-xs font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-teal-50 hover:text-teal-700 disabled:cursor-default disabled:opacity-70 dark:hover:bg-teal-500/10 dark:hover:text-teal-300"
          >
            {(follow.isPending || unfollow.isPending) ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            {post.author.relationship === 'following' ? 'Following' : post.author.relationship === 'requested_outgoing' ? 'Requested' : post.author.profileVisibility === 'private' ? 'Request to follow' : 'Follow'}
          </button>
        )}
        {post.canDelete && (
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="rounded-lg p-2 text-[color:var(--bl-text-muted)] transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/30"
            aria-label="Delete post"
          >
            {remove.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        )}
        </div>
      </div>

      {post.body && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[color:var(--bl-text)]">{post.body}</p>}

      {post.sourceAttribution && (
        <p className="mt-2 text-xs text-[color:var(--bl-text-muted)]">
          {post.sourceAttribution.label}
          {post.sourceAttribution.creatorName ? ` · ${post.sourceAttribution.creatorName}` : ''}
        </p>
      )}

      {post.canDelete && post.visibility === 'public' && (
        <div className="mt-4 rounded-xl border border-[color:var(--bl-border)] p-3">
          <label className="flex items-center justify-between gap-3 text-sm font-medium text-[color:var(--bl-text)]">
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
          <p className="mt-1 text-xs text-[color:var(--bl-text-muted)]">Discover can show this public post to signed-in Blabber users outside your followers.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(topicsQuery.data || []).slice(0, 8).map((topic) => (
              <button
                key={topic.id}
                onClick={() => toggleTopic(topic.id)}
                className={`rounded-md border px-2 py-1 text-xs transition ${topicIds.includes(topic.id) ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200' : 'border-[color:var(--bl-border)] text-[color:var(--bl-text-muted)] hover:bg-[color:var(--bl-hover)]'}`}
              >
                {topic.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {post.media.length > 0 && (
        <div className={post.media.length === 1 ? 'mt-4' : 'mt-4 grid grid-cols-2 gap-2'}>
          {post.media.length === 1 ? (
            <FeedImage src={normalizeMediaUrl(post.media[0].url)} wide />
          ) : (
            post.media.map((media) => <FeedImage key={media.mediaId} src={normalizeMediaUrl(media.url)} />)
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => reaction.mutate(emoji)}
            disabled={reaction.isPending}
            className={`inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-sm transition ${
              post.myReaction === emoji
                ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200'
                : 'border-[color:var(--bl-border)] text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'
            }`}
          >
            <span>{emoji}</span>
            <span className="text-xs">{post.reactionCounts[emoji] || 0}</span>
          </button>
        ))}
        <button
          onClick={() => setCommentsOpen((value) => !value)}
          className="inline-flex h-8 items-center gap-2 rounded-full border border-[color:var(--bl-border)] px-3 text-sm text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
        >
          <MessageCircle size={15} />
          {post.commentCount}
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !post.canSave}
          className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition ${post.saved ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200' : 'border-[color:var(--bl-border)] text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'}`}
        >
          <Bookmark size={15} /> {post.saved ? 'Remove from saved' : 'Save'}
        </button>
        {post.canRepost && (
          <button
            onClick={() => repost.mutate()}
            disabled={repost.isPending}
            className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition ${post.reposted ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200' : 'border-[color:var(--bl-border)] text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'}`}
          >
            <Repeat2 size={15} /> {post.reposted ? 'Undo repost' : 'Repost'}
          </button>
        )}
        {post.visibility === 'public' && (
          <button
            onClick={() => setPlanOpen(true)}
            className="inline-flex h-8 items-center gap-2 rounded-full border border-emerald-200 px-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
          >
            <CalendarClock size={15} /> Plan this
          </button>
        )}
        {post.canShare && (
          <button
            onClick={() => setShareOpen((value) => !value)}
            className="ml-auto inline-flex h-8 items-center gap-2 rounded-full border border-[color:var(--bl-border)] px-3 text-sm text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
          >
            <Share2 size={15} /> Share
          </button>
        )}
      </div>

      <PlanThisDialog source={{ type: 'post', id: post.id }} open={planOpen} onClose={() => setPlanOpen(false)} />

      {shareOpen && (
        <div className="mt-3">
          <ShareToChatPanel item={{ type: 'post', id: post.id }} onClose={() => setShareOpen(false)} />
        </div>
      )}

      {commentsOpen && (
        <div className="mt-4 space-y-3">
          {commentsQuery.data?.comments.map((item) => (
            <div key={item.id} className="flex gap-2">
              <Avatar src={normalizeMediaUrl(item.author.avatarUrl)} alt={item.author.name} size="sm" />
              <div className="min-w-0 flex-1 rounded-xl bg-[color:var(--bl-hover)] px-3 py-2">
                <p className="truncate text-xs font-semibold text-[color:var(--bl-text-secondary)]">{item.author.name}</p>
                <p className="whitespace-pre-wrap text-sm text-[color:var(--bl-text)]">{item.body}</p>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              maxLength={1000}
              className="min-w-0 flex-1 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm text-[color:var(--bl-text)] outline-none focus:border-teal-400"
              placeholder="Write a comment"
            />
            <button
              onClick={() => comment.mutate()}
              disabled={!commentBody.trim() || comment.isPending}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'followers'>('followers');
  const [feedTab, setFeedTab] = useState<'featured' | 'following'>('featured');
  const [photos, setPhotos] = useState<Array<{ mediaId: string; url?: string }>>([]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const upload = useFileUpload();
  const profileQuery = useQuery({ queryKey: ['my-profile'], queryFn: fetchMyProfile });
  const feedQuery = useQuery({ queryKey: ['feed', feedTab], queryFn: () => fetchFeed(null, feedTab) });
  const loadMore = useMutation({
    mutationFn: () => fetchFeed(feedQuery.data?.nextCursor, feedTab),
    onSuccess: (page) => {
      queryClient.setQueryData(['feed', feedTab], (old: any) => {
        if (!old) return page;
        const seen = new Set(old.posts.map((post: FeedPost) => post.id));
        return { ...page, posts: [...old.posts, ...page.posts.filter((post) => !seen.has(post.id))] };
      });
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

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && feedQuery.data?.nextCursor && !loadMore.isPending) {
        loadMore.mutate();
      }
    }, { rootMargin: '600px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [feedQuery.data?.nextCursor, loadMore.isPending, feedTab]);

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
    <main className="flex h-screen overflow-hidden bg-[color:var(--bl-bg)] text-[color:var(--bl-text)]">
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
          onNewConversation={() => navigate('/chats')}
          onChatFilterChange={() => navigate('/chats')}
          onNavigateMobile={() => setSidebarOpen(false)}
        />
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto bg-[color:var(--bl-bg)]">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg border border-[color:var(--bl-border)] p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] md:hidden"
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>

          {/* ── Header ───────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-[color:var(--bl-text)]">Feed</h1>
              <p className="mt-2 text-[15px] leading-6 text-[color:var(--bl-text-secondary)]">
                Stay updated with what&apos;s happening in your network.
              </p>
            </div>
            <div className="inline-flex flex-shrink-0 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-1">
              <button
                onClick={() => setFeedTab('featured')}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${feedTab === 'featured' ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950' : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'}`}
              >
                Featured
              </button>
              <button
                onClick={() => setFeedTab('following')}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${feedTab === 'following' ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950' : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'}`}
              >
                Following
              </button>
            </div>
          </div>

          {/* ── Composer ─────────────────────────────────────────────────── */}
          <section className="rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 shadow-sm sm:p-5">
            <div className="flex gap-3">
              <Avatar src={normalizeMediaUrl(profileQuery.data?.avatarUrl)} alt={profileQuery.data?.name || 'You'} size="md" className="flex-shrink-0" />
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="What's on your mind?"
                className="min-w-0 flex-1 resize-none rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] px-3 py-2.5 text-sm text-[color:var(--bl-text)] outline-none transition placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400 focus:bg-[color:var(--bl-panel)] focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-500/20"
              />
            </div>
            {photos.length > 0 && (
              <div className="mt-3 grid grid-cols-5 gap-2">
                {photos.map((photo) => (
                  <div key={photo.mediaId} className="relative">
                    <img src={normalizeMediaUrl(photo.url)} alt="" className="aspect-square rounded-xl object-cover" />
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
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[color:var(--bl-border)] px-3.5 py-1.5 text-sm font-medium text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10">
                {upload.isUploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
                Photo
                <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void pickPhotos(event.target.files)} />
              </label>
              {canUsePublic ? (
                <label className="relative inline-flex h-9 cursor-pointer items-center rounded-full border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] text-sm font-medium text-[color:var(--bl-text-secondary)]">
                  <span className="pointer-events-none inline-flex items-center gap-1.5 pl-3.5 pr-8">
                    {effectiveVisibility === 'public' ? <Globe size={13} aria-hidden="true" /> : <Users size={13} aria-hidden="true" />}
                    {effectiveVisibility === 'public' ? 'Public' : 'Followers'}
                  </span>
                  <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-[color:var(--bl-text-muted)]" />
                  <select
                    value={effectiveVisibility}
                    onChange={(event) => setVisibility(event.target.value as 'public' | 'followers')}
                    aria-label="Post audience"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  >
                    <option value="followers">Followers</option>
                    <option value="public">Public</option>
                  </select>
                </label>
              ) : (
                // Visibility is fixed to followers for private profiles — show a
                // static, non-interactive pill instead of a dropdown that can't open.
                <span
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-teal-50 px-3.5 text-sm font-medium text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
                  title="Your profile is private, so posts are visible to followers only."
                >
                  <Users size={13} aria-hidden="true" />
                  Visible to followers
                </span>
              )}
              <button
                onClick={() => submit.mutate()}
                disabled={!canSubmit || submit.isPending || upload.isUploading}
                aria-label="Post"
                title="Post"
                className="bl-focus-ring ml-auto flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-sm transition hover:bg-teal-700 hover:shadow disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
                style={canSubmit ? { boxShadow: 'var(--bl-mascot-glow)' } : undefined}
              >
                {submit.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </section>

          {/* ── Posts ────────────────────────────────────────────────────── */}
          <div className="space-y-4">
            {feedQuery.isLoading && (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] py-10 text-sm text-[color:var(--bl-text-muted)]">
                <Loader2 size={16} className="animate-spin" /> Loading feed&hellip;
              </div>
            )}
            {feedQuery.data?.posts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-6 py-14 text-center text-sm text-[color:var(--bl-text-muted)]">
                <p>{feedTab === 'featured' ? 'No featured posts are available right now.' : 'Follow people or explore Discover to see posts here.'}</p>
                <button
                  type="button"
                  onClick={() => navigate('/discover')}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-700"
                >
                  Explore Discover
                </button>
              </div>
            )}
            {feedQuery.data?.posts.map((post) => <PostCard key={post.id} post={post} />)}
            <div ref={loadMoreRef} className="py-5 text-center text-sm text-[color:var(--bl-text-muted)]">
              {loadMore.isPending ? 'Loading more...' : feedQuery.data && !feedQuery.data.nextCursor ? "You're caught up for now." : ''}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
