import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bookmark, CalendarClock, ChevronDown, EyeOff, Film, HelpCircle, Menu, MessageCircle, RefreshCw, Repeat2, Search, Share2, Sparkles, Target, TrendingUp, UserMinus, UserPlus, UsersRound, VolumeX, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Sidebar from '@/components/Sidebar';
import PlanThisDialog from '@/components/PlanThisDialog';
import { ShareToChatPanel } from '@/components/ShareToChat';
import {
  fetchDiscoveryCommunities,
  fetchDiscoveryCreators,
  fetchDiscoveryPosts,
  fetchDiscoveryPreferences,
  fetchDiscoveryTopics,
  fetchAuthorizedObjectUrl,
  fetchForYou,
  fetchForYouExplanation,
  fetchPost,
  fetchReel,
  fetchReelsBrowse,
  createReelPlaybackSession,
  reelPosterUrl,
  createReelComment,
  fetchReelComments,
  followDiscoveryTopic,
  followProfile,
  muteDiscoveryCommunity,
  muteDiscoveryCreator,
  muteDiscoveryTopic,
  normalizeMediaUrl,
  notInterestedDiscoveryPost,
  recordForYouEvent,
  recordDiscoveryEvent,
  removePostReaction,
  removeReelReaction,
  repostPost,
  saveReel,
  refreshForYou,
  savePost,
  setPostReaction,
  setReelReaction,
  undoRepostPost,
  unfollowDiscoveryTopic,
  unfollowProfile,
  unmuteDiscoveryTopic,
  unsavePost,
  unsaveReel,
  notInterestedReel,
  muteReelCreator,
  reportReel,
} from '@/api/client';
import type { DiscoveryCommunity, DiscoveryCreator, DiscoveryPost, DiscoveryTopic, FeedPost, ForYouExplanation, ForYouPost, ReelItem } from '@/api/client';

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

function appendUnique(old: any, page: any, key: string, idKey: string) {
  if (!old) return page;
  const seen = new Set((old[key] || []).map((item: any) => item[idKey] || item.name));
  return { ...old, ...page, [key]: [...old[key], ...page[key].filter((item: any) => !seen.has(item[idKey] || item.name))] };
}

function DiscoveryImage({ src, className = '' }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | undefined>();

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
      <div className={`flex items-center justify-center bg-[color:var(--bl-hover)] text-xs text-[color:var(--bl-text-muted)] ${className}`}>
        Media unavailable
      </div>
    );
  }
  if (!objectUrl) {
    return <div className={`animate-pulse bg-[color:var(--bl-hover)] ${className}`} />;
  }
  return <img src={objectUrl} alt="" loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}

// Deterministic teal-forward decorative treatment for topic cards — derived
// from the topic's own id, not implying any real trending metric.
const TOPIC_ICONS = [TrendingUp, Sparkles, Target, Film, UsersRound];
const TOPIC_TILES: [string, string][] = [
  ['#0bae9a', '#0d766e'],
  ['#2ac8bd', '#0bae9a'],
  ['#10b981', '#059669'],
  ['#0d9488', '#115e59'],
  ['#84cc16', '#65a30d'],
];
function pickTopicStyle(seed: string): { Icon: typeof TrendingUp; from: string; to: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const index = Math.abs(hash) % TOPIC_ICONS.length;
  const [from, to] = TOPIC_TILES[Math.abs(hash) % TOPIC_TILES.length];
  return { Icon: TOPIC_ICONS[index], from, to };
}

const TOPIC_PREVIEW_COUNT = 10;

/** Section heading row with an optional real expand/collapse action — "View
    all" reveals the already-loaded remainder in place (there is no separate
    "all topics/people/…" route to link to). */
function ViewAllToggle({ show, expanded, onToggle }: { show: boolean; expanded: boolean; onToggle: () => void }) {
  if (!show) return null;
  return (
    <button onClick={onToggle} className="text-sm font-medium text-teal-600 transition hover:text-teal-700 dark:text-teal-300 dark:hover:text-teal-200">
      {expanded ? 'Show less' : 'View all'}
    </button>
  );
}

function TrendingTopics({ selectedTopic, onSelect }: { selectedTopic: string | null; onSelect: (topicId: string | null) => void }) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const topics = useQuery({ queryKey: ['discovery-topics'], queryFn: fetchDiscoveryTopics });
  const prefs = useQuery({ queryKey: ['discovery-preferences'], queryFn: fetchDiscoveryPreferences });
  const followed = new Set((prefs.data?.followedTopics || []).map((topic) => topic.id));
  const muted = new Set((prefs.data?.mutedTopics || []).map((topic) => topic.id));
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['discovery-preferences'] });
    queryClient.invalidateQueries({ queryKey: ['discovery'] });
  };
  const follow = useMutation({ mutationFn: followDiscoveryTopic, onSuccess: refresh });
  const unfollow = useMutation({ mutationFn: unfollowDiscoveryTopic, onSuccess: refresh });
  const mute = useMutation({ mutationFn: muteDiscoveryTopic, onSuccess: refresh });
  const unmute = useMutation({ mutationFn: unmuteDiscoveryTopic, onSuccess: refresh });

  if (!topics.data?.length) return null;

  const visibleTopics = showAll ? topics.data : topics.data.slice(0, TOPIC_PREVIEW_COUNT);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[color:var(--bl-text)]">Trending Topics</h2>
        <div className="flex items-center gap-3">
          {selectedTopic && (
            <button onClick={() => onSelect(null)} className="text-sm font-medium text-teal-600 hover:text-teal-700 dark:text-teal-300 dark:hover:text-teal-200">
              Clear filter
            </button>
          )}
          <ViewAllToggle show={topics.data.length > TOPIC_PREVIEW_COUNT} expanded={showAll} onToggle={() => setShowAll((value) => !value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {visibleTopics.map((topic: DiscoveryTopic) => {
          const { Icon, from, to } = pickTopicStyle(topic.id);
          const isFollowed = followed.has(topic.id);
          const isMuted = muted.has(topic.id);
          const isSelected = selectedTopic === topic.id;
          return (
            <div
              key={topic.id}
              className={`group relative rounded-2xl border p-3 transition ${isSelected ? 'border-teal-500 bg-teal-50 dark:border-teal-400/60 dark:bg-teal-500/10' : 'border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] hover:[box-shadow:var(--bl-glow-sm)]'}`}
            >
              <button onClick={() => onSelect(isSelected ? null : topic.id)} className="block w-full text-left">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                  style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                >
                  <Icon size={16} />
                </span>
                <p className="mt-2 truncate text-sm font-semibold text-[color:var(--bl-text)]">#{topic.label}</p>
              </button>
              <div className="mt-2 flex items-center gap-1">
                <button
                  onClick={() => (isFollowed ? unfollow.mutate(topic.id) : follow.mutate(topic.id))}
                  aria-label={isFollowed ? `Unfollow #${topic.label}` : `Follow #${topic.label}`}
                  title={isFollowed ? 'Following' : 'Follow'}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition ${isFollowed ? 'text-teal-600 dark:text-teal-300' : 'text-[color:var(--bl-text-muted)] hover:bg-[color:var(--bl-hover)]'}`}
                >
                  <UserPlus size={12} />
                </button>
                <button
                  onClick={() => (isMuted ? unmute.mutate(topic.id) : mute.mutate(topic.id))}
                  aria-label={isMuted ? `Unmute #${topic.label}` : `Mute #${topic.label}`}
                  title={isMuted ? 'Muted' : 'Mute'}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition ${isMuted ? 'text-rose-500' : 'text-[color:var(--bl-text-muted)] hover:bg-[color:var(--bl-hover)]'}`}
                >
                  <VolumeX size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CreatorCard({ creator }: { creator: DiscoveryCreator }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mute = useMutation({
    mutationFn: () => muteDiscoveryCreator(creator.handle || ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discovery'] }),
  });
  const follow = useMutation({
    mutationFn: () => (creator.following ? unfollowProfile(creator.handle || '') : followProfile(creator.handle || '')),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discovery'] }),
  });
  return (
    <div className="flex flex-col rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 text-center transition hover:[box-shadow:var(--bl-glow-sm)]">
      <button
        onClick={() => {
          if (creator.handle) navigate(`/p/${creator.handle}`);
          recordDiscoveryEvent({ eventType: 'discover_creator_open', candidateToken: creator.candidateToken }).catch(() => undefined);
        }}
        className="flex flex-col items-center gap-2.5 text-center"
      >
        <Avatar src={normalizeMediaUrl(creator.avatarUrl)} alt={creator.name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[color:var(--bl-text)]">{creator.name}</p>
          <p className="truncate text-xs text-teal-600 dark:text-teal-300">{creator.displayHandle || creator.handle}</p>
        </div>
      </button>
      {creator.topics.length > 0 && (
        <div className="mt-2.5 flex flex-wrap justify-center gap-1">
          {creator.topics.slice(0, 2).map((topic) => (
            <span key={topic.id} className="rounded-md bg-[color:var(--bl-hover)] px-2 py-0.5 text-[11px] text-[color:var(--bl-text-secondary)]">
              {topic.label}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto pt-3">
        {creator.handle && (
          <button
            onClick={() => follow.mutate()}
            disabled={follow.isPending}
            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${creator.following ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'bg-teal-600 text-white shadow-sm hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400'}`}
          >
            <UserPlus size={13} />
            {creator.following ? 'Following' : 'Follow'}
          </button>
        )}
        <button
          onClick={() => creator.handle && mute.mutate()}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-[color:var(--bl-text-muted)] transition hover:text-[color:var(--bl-text)]"
        >
          <UserMinus size={12} /> Don&apos;t recommend
        </button>
      </div>
    </div>
  );
}

function PostCard({ post, source = 'browse', onOpen }: { post: DiscoveryPost | ForYouPost; source?: 'browse' | 'for-you'; onOpen?: () => void }) {
  const queryClient = useQueryClient();
  const [planOpen, setPlanOpen] = useState(false);
  const [explanation, setExplanation] = useState<ForYouExplanation | null>('explanation' in post ? post.explanation : null);
  const [showWhy, setShowWhy] = useState(false);
  const hide = useMutation({
    mutationFn: () => notInterestedDiscoveryPost(post.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
      queryClient.invalidateQueries({ queryKey: ['for-you'] });
    },
  });
  const loadWhy = useMutation({
    mutationFn: () => fetchForYouExplanation(post.id),
    onSuccess: (value) => {
      setExplanation(value);
      setShowWhy(true);
    },
  });
  useEffect(() => {
    const recorder = source === 'for-you' ? recordForYouEvent : recordDiscoveryEvent;
    recorder({ eventType: 'discover_post_open', candidateToken: post.candidateToken }).catch(() => undefined);
    const timer = window.setTimeout(() => {
      recorder({ eventType: 'discover_post_dwell', candidateToken: post.candidateToken, dwellBucket: '10_to_30_seconds' }).catch(() => undefined);
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [post.candidateToken, source]);

  return (
    <article className="overflow-hidden rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-sm transition hover:[box-shadow:var(--bl-glow-sm)]">
      <div className="relative">
        {post.media.length > 0 ? (
          <DiscoveryImage src={normalizeMediaUrl(post.media[0]?.url)} className="aspect-[4/5] w-full" />
        ) : (
          <div className="flex aspect-[4/5] w-full items-center justify-center bg-[color:var(--bl-hover)] px-5 text-center text-sm text-[color:var(--bl-text-muted)]">
            {post.body || 'Discoverable post'}
          </div>
        )}
        <button onClick={(event) => { event.stopPropagation(); hide.mutate(); }} className="absolute right-2 top-2 z-10 rounded-full bg-black/55 p-2 text-white transition hover:bg-black/70" aria-label="Hide this post">
          <EyeOff size={15} />
        </button>
        <button onClick={onOpen} className="absolute inset-0" aria-label="Open post detail" />
      </div>
      <div className="p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={normalizeMediaUrl(post.author.avatarUrl)} alt={post.author.name} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[color:var(--bl-text)]">{post.author.name}</p>
            <p className="truncate text-xs text-[color:var(--bl-text-muted)]">{post.author.displayHandle || post.author.handle} · {formatTime(post.createdAt)}</p>
          </div>
        </div>
      </div>
      {post.body && <p className="mt-3 line-clamp-3 text-sm leading-6 text-[color:var(--bl-text)]">{post.body}</p>}
      {post.sourceAttribution && (
        <p className="mt-2 text-xs text-[color:var(--bl-text-muted)]">
          {post.sourceAttribution.label}
          {post.sourceAttribution.creatorName ? ` · ${post.sourceAttribution.creatorName}` : ''}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[color:var(--bl-text-muted)]">
        {post.topics.slice(0, 2).map((topic) => <span key={topic.id} className="rounded-md bg-[color:var(--bl-hover)] px-2 py-1 text-[color:var(--bl-text-secondary)]">{topic.label}</span>)}
        {source === 'for-you' && (
          <button
            onClick={() => (explanation ? setShowWhy(true) : loadWhy.mutate())}
            className="inline-flex items-center gap-1 rounded-md border border-[color:var(--bl-border)] px-2 py-1 text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
          >
            <HelpCircle size={13} /> Why
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1"><MessageCircle size={13} /> {post.commentCount}</span>
      </div>
      {showWhy && explanation && (
        <div className="mt-4 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[color:var(--bl-text)]">Why this post</p>
              <p className="mt-1 text-[color:var(--bl-text-secondary)]">{explanation.text}</p>
              {explanation.topicLabel && <p className="mt-2 text-xs text-[color:var(--bl-text-muted)]">Topic: {explanation.topicLabel}</p>}
            </div>
            <button onClick={() => setShowWhy(false)} className="text-xs font-medium text-[color:var(--bl-text-muted)] transition hover:text-[color:var(--bl-text)]">Close</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => hide.mutate()} className="rounded-md border border-[color:var(--bl-border)] px-2 py-1 text-xs text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-panel)]">Hide post</button>
            {post.author.handle && <button onClick={() => muteDiscoveryCreator(post.author.handle!)} className="rounded-md border border-[color:var(--bl-border)] px-2 py-1 text-xs text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-panel)]">Mute creator</button>}
            {explanation.topicId && <button onClick={() => muteDiscoveryTopic(explanation.topicId!)} className="rounded-md border border-[color:var(--bl-border)] px-2 py-1 text-xs text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-panel)]">Mute topic</button>}
          </div>
        </div>
      )}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
        >
          <CalendarClock size={13} /> Plan this
        </button>
      </div>
      </div>
      <PlanThisDialog source={{ type: 'post', id: post.id }} open={planOpen} onClose={() => setPlanOpen(false)} />
    </article>
  );
}

function ReelPoster({ reel }: { reel: ReelItem }) {
  const [posterUrl, setPosterUrl] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let createdUrl: string | undefined;
    setPosterUrl(undefined);
    setFailed(false);
    fetchAuthorizedObjectUrl(reelPosterUrl(reel.id))
      .then((value) => {
        if (!alive) {
          if (value?.startsWith('blob:')) URL.revokeObjectURL(value);
          return;
        }
        createdUrl = value;
        setPosterUrl(value);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (createdUrl?.startsWith('blob:')) URL.revokeObjectURL(createdUrl);
    };
  }, [reel.id]);
  if (!posterUrl || failed) {
    return <div className="flex aspect-[9/12] w-full items-center justify-center bg-[color:var(--bl-hover)] text-xs text-[color:var(--bl-text-muted)]">Reel</div>;
  }
  return <img src={posterUrl} alt="" className="aspect-[9/12] w-full object-cover" />;
}

function formatReelDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function ReelGridCard({ reel, onOpen }: { reel: ReelItem; onOpen: () => void }) {
  const [planOpen, setPlanOpen] = useState(false);
  const duration = formatReelDuration(reel.durationSeconds);
  return (
    <article className="overflow-hidden rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-sm transition hover:[box-shadow:var(--bl-glow-sm)]">
      <button onClick={onOpen} className="relative block w-full text-left">
        <ReelPoster reel={reel} />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-xs font-semibold text-white">
          <Film size={13} /> Reel
        </span>
        {duration && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">{duration}</span>
        )}
      </button>
      <div className="p-3">
        <p className="truncate text-sm font-semibold text-[color:var(--bl-text)]">{reel.author?.name || reel.author?.handle || 'Creator'}</p>
        {reel.caption && <p className="mt-2 line-clamp-2 text-sm text-[color:var(--bl-text-secondary)]">{reel.caption}</p>}
        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
        >
          <CalendarClock size={13} /> Plan this
        </button>
      </div>
      <PlanThisDialog source={{ type: 'reel', id: reel.id }} open={planOpen} onClose={() => setPlanOpen(false)} />
    </article>
  );
}

function PostDetailDialog({ postId, onClose }: { postId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [planOpen, setPlanOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const post = useQuery({ queryKey: ['post-detail', postId], queryFn: () => fetchPost(postId) });
  const item = post.data as FeedPost | undefined;
  const react = useMutation<{ reactionCounts: Record<string, number>; myReaction: string | null }, Error, string>({
    mutationFn: (emoji: string) => item?.myReaction === emoji ? removePostReaction(postId) : setPostReaction(postId, emoji),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['post-detail', postId] });
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
    },
  });
  const save = useMutation({
    mutationFn: () => item?.saved ? unsavePost(postId) : savePost(postId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['post-detail', postId] }),
  });
  const repost = useMutation({
    mutationFn: () => item?.reposted ? undoRepostPost(postId) : repostPost(postId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['post-detail', postId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-4 py-3">
          <p className="text-sm font-semibold text-[color:var(--bl-text)]">Post</p>
          <button onClick={onClose} className="rounded-md p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)]" aria-label="Close post detail"><X size={17} /></button>
        </div>
        {!item && <p className="p-5 text-sm text-[color:var(--bl-text-muted)]">{post.isError ? 'Post unavailable.' : 'Loading post...'}</p>}
        {item && (
          <div className="p-4">
            <div className="flex items-center gap-3">
              <Avatar src={normalizeMediaUrl(item.author.avatarUrl)} alt={item.author.name} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[color:var(--bl-text)]">{item.author.name}</p>
                <p className="truncate text-xs text-[color:var(--bl-text-muted)]">{item.author.displayHandle || item.author.handle} · {formatTime(item.createdAt)}</p>
              </div>
            </div>
            {item.media.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{item.media.map((media) => <DiscoveryImage key={media.mediaId} src={normalizeMediaUrl(media.url)} className="aspect-square w-full rounded-xl" />)}</div>}
            {item.body && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[color:var(--bl-text)]">{item.body}</p>}
            {item.sourceAttribution && <p className="mt-2 text-xs text-[color:var(--bl-text-muted)]">{item.sourceAttribution.label}{item.sourceAttribution.creatorName ? ` · ${item.sourceAttribution.creatorName}` : ''}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {['❤️', '😂', '😮', '😢', '🙌'].map((emoji) => <button key={emoji} onClick={() => react.mutate(emoji)} className={`rounded-full border px-3 py-1.5 text-sm transition ${item.myReaction === emoji ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200' : 'border-[color:var(--bl-border)] text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'}`}>{emoji} {item.reactionCounts[emoji] || 0}</button>)}
              <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--bl-border)] px-3 py-1.5 text-sm text-[color:var(--bl-text-secondary)]"><MessageCircle size={15} /> {item.commentCount}</span>
              <button onClick={() => save.mutate()} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--bl-border)] px-3 py-1.5 text-sm text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"><Bookmark size={15} /> {item.saved ? 'Remove from saved' : 'Save'}</button>
              {item.canRepost && <button onClick={() => repost.mutate()} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--bl-border)] px-3 py-1.5 text-sm text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"><Repeat2 size={15} /> {item.reposted ? 'Undo repost' : 'Repost'}</button>}
              <button onClick={() => setPlanOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 px-3 py-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/30"><CalendarClock size={15} /> Plan this</button>
              {item.canShare && (
                <button
                  onClick={() => setShareOpen((value) => !value)}
                  className="inline-flex items-center gap-1 rounded-full border border-[color:var(--bl-border)] px-3 py-1.5 text-sm text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                >
                  <Share2 size={15} /> Share
                </button>
              )}
            </div>
            {shareOpen && item.canShare && (
              <div className="mt-3">
                <ShareToChatPanel
                  item={{ type: 'post', id: item.id }}
                  onClose={() => setShareOpen(false)}
                />
              </div>
            )}
            <PlanThisDialog source={{ type: 'post', id: item.id }} open={planOpen} onClose={() => setPlanOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

function ReelDetailDialog({ reelId, onClose }: { reelId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [planOpen, setPlanOpen] = useState(false);
  const reel = useQuery({ queryKey: ['reel-detail', reelId], queryFn: () => fetchReel(reelId) });
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [posterUrl, setPosterUrl] = useState<string | undefined>();
  const [muted, setMuted] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const comments = useQuery({ queryKey: ['reel-comments', reelId], queryFn: () => fetchReelComments(reelId), enabled: commentsOpen });
  useEffect(() => {
    let alive = true;
    let videoObjectUrl: string | undefined;
    let posterObjectUrl: string | undefined;
    setVideoUrl(undefined);
    setPosterUrl(undefined);
    createReelPlaybackSession(reelId)
      .then((value) => {
        return Promise.all([fetchAuthorizedObjectUrl(value.fallbackUrl), fetchAuthorizedObjectUrl(value.posterUrl)]);
      })
      .then(([nextVideoUrl, nextPosterUrl]) => {
        if (!alive) {
          if (nextVideoUrl?.startsWith('blob:')) URL.revokeObjectURL(nextVideoUrl);
          if (nextPosterUrl?.startsWith('blob:')) URL.revokeObjectURL(nextPosterUrl);
          return;
        }
        videoObjectUrl = nextVideoUrl;
        posterObjectUrl = nextPosterUrl;
        setVideoUrl(nextVideoUrl);
        setPosterUrl(nextPosterUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      videoRef.current?.pause();
      if (videoObjectUrl?.startsWith('blob:')) URL.revokeObjectURL(videoObjectUrl);
      if (posterObjectUrl?.startsWith('blob:')) URL.revokeObjectURL(posterObjectUrl);
    };
  }, [reelId]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || reducedMotion) return;
    video.muted = true;
    setMuted(true);
    video.play().catch(() => undefined);
  }, [reducedMotion, videoUrl]);
  useEffect(() => {
    const pause = () => {
      if (document.visibilityState === 'hidden') videoRef.current?.pause();
    };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  const react = useMutation({
    mutationFn: (emoji: string) => reel.data?.myReaction === emoji ? removeReelReaction(reelId) : setReelReaction(reelId, emoji),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reel-detail', reelId] }),
  });
  const save = useMutation({
    mutationFn: () => reel.data?.saved ? unsaveReel(reelId) : saveReel(reelId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reel-detail', reelId] }),
  });
  const comment = useMutation({
    mutationFn: () => createReelComment(reelId, commentBody),
    onSuccess: () => {
      setCommentBody('');
      queryClient.invalidateQueries({ queryKey: ['reel-detail', reelId] });
      comments.refetch();
    },
  });
  const hide = useMutation({ mutationFn: () => notInterestedReel(reelId), onSuccess: onClose });
  const muteCreator = useMutation({ mutationFn: () => muteReelCreator(reelId), onSuccess: onClose });
  const report = useMutation({ mutationFn: () => reportReel(reelId, { reason: 'Inappropriate Reel' }) });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl gap-4 overflow-hidden rounded-lg bg-black p-3 text-white shadow-xl">
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-2" aria-label="Close Reel detail"><X size={17} /></button>
        <div className="relative aspect-[9/16] max-h-[88vh] flex-1 overflow-hidden rounded-lg bg-black">
          {videoUrl ? (
            <video ref={videoRef} src={videoUrl} poster={posterUrl} muted={muted} playsInline controls className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-300">{reel.isError ? 'Reel unavailable.' : 'Loading Reel...'}</div>
          )}
          <button onClick={() => setMuted((value) => !value)} className="absolute left-3 top-3 rounded-full bg-black/65 px-3 py-2 text-xs font-semibold">
            {muted ? 'Muted' : 'Sound on'}
          </button>
        </div>
        <aside className="hidden w-80 flex-col overflow-y-auto rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 text-[color:var(--bl-text)] md:flex">
          <p className="text-sm font-semibold">{reel.data?.author?.name || reel.data?.author?.handle || 'Creator'}</p>
          {reel.data?.caption && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[color:var(--bl-text-secondary)]">{reel.data.caption}</p>}
          {reel.data?.sourceAttribution && <p className="mt-2 text-xs text-[color:var(--bl-text-muted)]">{reel.data.sourceAttribution.label}{reel.data.sourceAttribution.creatorName ? ` · ${reel.data.sourceAttribution.creatorName}` : ''}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {['❤️', '😂', '😮', '😢', '🙌'].map((emoji) => <button key={emoji} onClick={() => react.mutate(emoji)} className={`rounded-full border px-2.5 py-1.5 text-sm transition ${reel.data?.myReaction === emoji ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200' : 'border-[color:var(--bl-border)] hover:bg-[color:var(--bl-hover)]'}`}>{emoji} {reel.data?.reactionCounts?.[emoji] || 0}</button>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => save.mutate()} className="rounded-lg border border-[color:var(--bl-border)] px-3 py-2 text-sm transition hover:bg-[color:var(--bl-hover)]">{reel.data?.saved ? 'Remove saved' : 'Save'}</button>
            <button onClick={() => setCommentsOpen((value) => !value)} className="rounded-lg border border-[color:var(--bl-border)] px-3 py-2 text-sm transition hover:bg-[color:var(--bl-hover)]">Comments {reel.data?.commentCount || 0}</button>
            <button onClick={() => setPlanOpen(true)} className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/30">Plan this</button>
            <button onClick={() => setMoreOpen((value) => !value)} className="rounded-lg border border-[color:var(--bl-border)] px-3 py-2 text-sm transition hover:bg-[color:var(--bl-hover)]">More</button>
          </div>
          {moreOpen && (
            <div className="mt-3 grid gap-2 text-sm">
              <button onClick={() => hide.mutate()} className="rounded-lg border border-[color:var(--bl-border)] px-3 py-2 text-left transition hover:bg-[color:var(--bl-hover)]">Not interested</button>
              <button onClick={() => muteCreator.mutate()} className="rounded-lg border border-[color:var(--bl-border)] px-3 py-2 text-left transition hover:bg-[color:var(--bl-hover)]">Mute creator</button>
              <button onClick={() => report.mutate()} className="rounded-lg border border-[color:var(--bl-border)] px-3 py-2 text-left transition hover:bg-[color:var(--bl-hover)]">Report</button>
            </div>
          )}
          {commentsOpen && (
            <div className="mt-4">
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (commentBody.trim()) comment.mutate(); }}>
                <input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm outline-none focus:border-teal-400" placeholder="Add a comment" />
                <button className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400">Post</button>
              </form>
              <div className="mt-3 space-y-2">
                {(comments.data?.comments || []).map((item) => (
                  <div key={item.id} className="rounded-lg bg-[color:var(--bl-hover)] px-3 py-2 text-sm">
                    <p className="font-semibold">{item.author?.name || item.author?.handle || 'Member'}</p>
                    <p>{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
        <PlanThisDialog source={{ type: 'reel', id: reelId }} open={planOpen} onClose={() => setPlanOpen(false)} />
      </div>
    </div>
  );
}

function CommunityCard({ community }: { community: DiscoveryCommunity }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { from, to } = pickTopicStyle(community.handle);
  const mute = useMutation({
    mutationFn: () => muteDiscoveryCommunity(community.handle),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discovery'] }),
  });
  const open = () => {
    navigate(`/c/${community.handle}`);
    recordDiscoveryEvent({ eventType: 'discover_community_open', candidateToken: community.candidateToken }).catch(() => undefined);
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] transition hover:[box-shadow:var(--bl-glow-sm)]">
      <button onClick={open} className="block w-full text-left">
        {community.avatarUrl ? (
          <img src={normalizeMediaUrl(community.avatarUrl)} alt="" className="aspect-video w-full object-cover" />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center text-white" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
            <UsersRound size={28} />
          </div>
        )}
      </button>
      <div className="p-3">
        <button onClick={open} className="block w-full text-left">
          <p className="truncate text-sm font-semibold text-[color:var(--bl-text)]">{community.name}</p>
          <p className="truncate text-xs text-[color:var(--bl-text-muted)]">{community.memberCount === 1 ? '1 member' : `${community.memberCount} members`}</p>
        </button>
        {community.description && <p className="mt-2 line-clamp-2 text-sm text-[color:var(--bl-text-secondary)]">{community.description}</p>}
        <div className="mt-3 flex items-center gap-2">
          {community.membership ? (
            <span className="flex-1 rounded-lg bg-teal-50 px-3 py-1.5 text-center text-xs font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">Joined</span>
          ) : (
            <button onClick={open} className="flex-1 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400">
              View
            </button>
          )}
        </div>
        <button onClick={() => mute.mutate()} className="mt-2 text-xs text-[color:var(--bl-text-muted)] transition hover:text-[color:var(--bl-text)]">Don&apos;t recommend this Community</button>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [view, setView] = useState<'for-you' | 'browse'>('for-you');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [openItem, setOpenItem] = useState<{ type: 'post' | 'reel'; id: string } | null>(null);
  const forYouMoreRef = useRef<HTMLDivElement | null>(null);
  const browseMoreRef = useRef<HTMLDivElement | null>(null);
  const creators = useQuery({ queryKey: ['discovery', 'creators', selectedTopic], queryFn: () => fetchDiscoveryCreators(selectedTopic || undefined) });
  const posts = useQuery({ queryKey: ['discovery', 'posts', selectedTopic, debouncedSearch], queryFn: () => fetchDiscoveryPosts(selectedTopic || undefined, null, debouncedSearch || undefined) });
  const reels = useQuery({ queryKey: ['discovery', 'reels', selectedTopic, debouncedSearch], queryFn: () => fetchReelsBrowse({ topic: selectedTopic || undefined, q: debouncedSearch || undefined }) });
  const communities = useQuery({ queryKey: ['discovery', 'communities', selectedTopic], queryFn: () => fetchDiscoveryCommunities(selectedTopic || undefined) });
  const prefs = useQuery({ queryKey: ['discovery-preferences'], queryFn: fetchDiscoveryPreferences });
  const forYou = useQuery({ queryKey: ['for-you'], queryFn: () => fetchForYou() });
  const refreshFeed = useMutation({
    mutationFn: refreshForYou,
    onSuccess: (result) => fetchForYou(result.cursor).then((page) => queryClient.setQueryData(['for-you'], page)),
  });
  const loadMoreForYou = useMutation({
    mutationFn: () => fetchForYou(forYou.data?.nextCursor),
    onSuccess: (page) => queryClient.setQueryData(['for-you'], (old: any) => {
      if (!old) return page;
      const seen = new Set(old.posts.map((post: ForYouPost) => post.id));
      return { ...old, ...page, posts: [...old.posts, ...page.posts.filter((post) => !seen.has(post.id))] };
    }),
  });
  const loadMoreBrowse = useMutation({
    mutationFn: async () => Promise.all([
      posts.data?.nextCursor ? fetchDiscoveryPosts(selectedTopic || undefined, posts.data.nextCursor, debouncedSearch || undefined) : null,
      reels.data?.nextCursor ? fetchReelsBrowse({ topic: selectedTopic || undefined, cursor: reels.data.nextCursor, q: debouncedSearch || undefined }) : null,
      creators.data?.nextCursor ? fetchDiscoveryCreators(selectedTopic || undefined, creators.data.nextCursor) : null,
      communities.data?.nextCursor ? fetchDiscoveryCommunities(selectedTopic || undefined, communities.data.nextCursor) : null,
    ]),
    onSuccess: ([postPage, reelPage, creatorPage, communityPage]) => {
      if (postPage) queryClient.setQueryData(['discovery', 'posts', selectedTopic, debouncedSearch], (old: any) => appendUnique(old, postPage, 'posts', 'id'));
      if (reelPage) queryClient.setQueryData(['discovery', 'reels', selectedTopic, debouncedSearch], (old: any) => appendUnique(old, reelPage, 'reels', 'id'));
      if (creatorPage) queryClient.setQueryData(['discovery', 'creators', selectedTopic], (old: any) => appendUnique(old, creatorPage, 'creators', 'handle'));
      if (communityPage) queryClient.setQueryData(['discovery', 'communities', selectedTopic], (old: any) => appendUnique(old, communityPage, 'communities', 'handle'));
    },
  });
  const loading = creators.isLoading || posts.isLoading || reels.isLoading || communities.isLoading || prefs.isLoading || forYou.isLoading;
  const error = creators.isError || posts.isError || reels.isError || communities.isError || prefs.isError || forYou.isError;
  const hasBrowseMore = Boolean(posts.data?.nextCursor || reels.data?.nextCursor || creators.data?.nextCursor || communities.data?.nextCursor);
  const hasAnyBrowseContent = Boolean(
    (posts.data?.posts.length) || (reels.data?.reels.length) || (creators.data?.creators.length) || (communities.data?.communities.length)
  );

  // Curated previews: each browse section shows a capped slice by default,
  // expandable in place via View all. Active search bypasses the post/reel
  // caps so results are never hidden. Everything rendered is real data
  // already loaded by the queries above.
  const [showAllCommunities, setShowAllCommunities] = useState(false);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [showAllReels, setShowAllReels] = useState(false);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const isSearching = Boolean(debouncedSearch);
  const allCommunities = communities.data?.communities || [];
  const allCreators = creators.data?.creators || [];
  const allReels = reels.data?.reels || [];
  const allPosts = posts.data?.posts || [];
  const visibleCommunities = showAllCommunities ? allCommunities : allCommunities.slice(0, 4);
  const visibleCreators = showAllPeople ? allCreators : allCreators.slice(0, 6);
  const visibleReels = showAllReels || isSearching ? allReels : allReels.slice(0, 5);
  const visiblePosts = showAllPosts || isSearching ? allPosts : allPosts.slice(0, 8);
  // Deep pagination only makes sense once a capped section has been expanded
  // (or during search) — otherwise pages would load into hidden slices and
  // the bottom sentinel would keep firing forever.
  const paginationActive = showAllPosts || showAllReels || showAllPeople || showAllCommunities || isSearching;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const node = forYouMoreRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (view === 'for-you' && entries.some((entry) => entry.isIntersecting) && forYou.data?.nextCursor && !loadMoreForYou.isPending) loadMoreForYou.mutate();
    }, { rootMargin: '700px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [view, forYou.data?.nextCursor, loadMoreForYou.isPending]);

  useEffect(() => {
    const node = browseMoreRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (view === 'browse' && paginationActive && entries.some((entry) => entry.isIntersecting) && hasBrowseMore && !loadMoreBrowse.isPending) loadMoreBrowse.mutate();
    }, { rootMargin: '700px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [view, hasBrowseMore, loadMoreBrowse.isPending, selectedTopic, paginationActive]);

  const topicsForFilter = useQuery({ queryKey: ['discovery-topics'], queryFn: fetchDiscoveryTopics });

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
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
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
              <h1 className="text-4xl font-bold tracking-tight text-[color:var(--bl-text)]">Discover</h1>
              <p className="mt-2 max-w-xl text-[15px] leading-6 text-[color:var(--bl-text-secondary)]">
                Explore new people, communities, reels, posts and trending topics.
              </p>
            </div>
            <div className="inline-flex flex-shrink-0 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-1">
              <button
                onClick={() => setView('for-you')}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${view === 'for-you' ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950' : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'}`}
              >
                For You
              </button>
              <button
                onClick={() => setView('browse')}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${view === 'browse' ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950' : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'}`}
              >
                Browse
              </button>
            </div>
          </div>

          {/* ── Search + category filter ─────────────────────────────────── */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative block flex-1">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--bl-text-muted)]" />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search posts and Reels"
                className="h-11 w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] pl-10 pr-10 text-sm text-[color:var(--bl-text)] outline-none transition placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-500/20"
              />
              {searchText && (
                <button onClick={() => setSearchText('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)]" aria-label="Clear search">
                  <X size={15} />
                </button>
              )}
            </label>
            {view === 'browse' && (
              <label className="relative inline-flex h-11 flex-shrink-0 items-center rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] text-sm font-medium text-[color:var(--bl-text-secondary)]">
                <span className="pointer-events-none px-3.5 pr-8">{selectedTopic ? topicsForFilter.data?.find((topic) => topic.id === selectedTopic)?.label || 'Category' : 'All Categories'}</span>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-[color:var(--bl-text-muted)]" />
                <select
                  value={selectedTopic || ''}
                  onChange={(event) => setSelectedTopic(event.target.value || null)}
                  aria-label="Filter by category"
                  className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
                >
                  <option value="">All Categories</option>
                  {(topicsForFilter.data || []).map((topic) => (
                    <option key={topic.id} value={topic.id}>{topic.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {loading && <p className="text-sm text-[color:var(--bl-text-muted)]" role="status">Loading discovery surfaces...</p>}
          {error && <p className="text-sm text-rose-600 dark:text-rose-300" role="alert">Discovery is temporarily unavailable.</p>}

          {view === 'for-you' ? (
            <section>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-[color:var(--bl-text)]">For You</h2>
                  {forYou.data?.message && <p className="mt-1 text-xs text-[color:var(--bl-text-muted)]">{forYou.data.message}</p>}
                </div>
                <button
                  onClick={() => refreshFeed.mutate()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                >
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>
              {(forYou.data?.posts || []).length ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {forYou.data!.posts.map((post) => <PostCard key={post.id} post={post} source="for-you" onOpen={() => setOpenItem({ type: 'post', id: post.id })} />)}
                  </div>
                  <div ref={forYouMoreRef} className="py-5 text-center text-sm text-[color:var(--bl-text-muted)]">
                    {loadMoreForYou.isPending ? 'Loading more...' : !forYou.data?.nextCursor ? "You're caught up for now." : ''}
                  </div>
                </>
              ) : (
                <p className="rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-6 text-sm text-[color:var(--bl-text-muted)]">No recommendations are available yet.</p>
              )}
            </section>
          ) : (
            <div className="space-y-8">
              <TrendingTopics selectedTopic={selectedTopic} onSelect={setSelectedTopic} />

              {allCommunities.length ? (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-[color:var(--bl-text)]">Popular Communities</h2>
                    <ViewAllToggle show={allCommunities.length > 4} expanded={showAllCommunities} onToggle={() => setShowAllCommunities((value) => !value)} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {visibleCommunities.map((community) => <CommunityCard key={community.handle} community={community} />)}
                  </div>
                </section>
              ) : null}

              {allCreators.length ? (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-[color:var(--bl-text)]">Suggested People</h2>
                    <ViewAllToggle show={allCreators.length > 6} expanded={showAllPeople} onToggle={() => setShowAllPeople((value) => !value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                    {visibleCreators.map((creator) => <CreatorCard key={creator.handle || creator.name} creator={creator} />)}
                  </div>
                </section>
              ) : null}

              {allReels.length ? (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-[color:var(--bl-text)]">Suggested Reels</h2>
                    <ViewAllToggle show={!isSearching && allReels.length > 5} expanded={showAllReels} onToggle={() => setShowAllReels((value) => !value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {visibleReels.map((reel) => <ReelGridCard key={reel.id} reel={reel} onOpen={() => setOpenItem({ type: 'reel', id: reel.id })} />)}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-[color:var(--bl-text)]">{debouncedSearch ? 'Search results' : 'Top Posts'}</h2>
                  <ViewAllToggle show={!isSearching && allPosts.length > 8} expanded={showAllPosts} onToggle={() => setShowAllPosts((value) => !value)} />
                </div>
                {allPosts.length ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {visiblePosts.map((post) => <PostCard key={post.id} post={post} onOpen={() => setOpenItem({ type: 'post', id: post.id })} />)}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-6 text-sm text-[color:var(--bl-text-muted)]">
                    No discoverable content is available for this topic yet.
                  </p>
                )}
              </section>

              <div ref={browseMoreRef} className="py-2 text-center text-sm text-[color:var(--bl-text-muted)]">
                {loadMoreBrowse.isPending ? 'Loading more...' : !hasBrowseMore && hasAnyBrowseContent ? "You're caught up for now." : ''}
              </div>

              <section className="rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 text-sm">
                <h2 className="font-semibold text-[color:var(--bl-text)]">Your interests</h2>
                <p className="mt-2 text-xs text-[color:var(--bl-text-muted)]">Topics you follow help improve future recommendations.</p>
                <p className="mt-2 text-xs text-[color:var(--bl-text-muted)]">Muted creators, Communities, and topics will not appear in Discover.</p>
                <div className="mt-3 text-xs text-[color:var(--bl-text-secondary)]">
                  {prefs.data?.followedTopics.length || 0} followed · {prefs.data?.mutedTopics.length || 0} muted
                </div>
                <button
                  onClick={() => navigate('/settings?s=discovery')}
                  className="mt-3 rounded-lg border border-[color:var(--bl-border)] px-3 py-2 text-xs font-medium text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                >
                  Discovery settings
                </button>
              </section>
            </div>
          )}
        </div>
      </div>
      {openItem?.type === 'post' && <PostDetailDialog postId={openItem.id} onClose={() => setOpenItem(null)} />}
      {openItem?.type === 'reel' && <ReelDetailDialog reelId={openItem.id} onClose={() => setOpenItem(null)} />}
    </main>
  );
}
