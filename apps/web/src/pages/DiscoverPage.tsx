import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Compass, EyeOff, HelpCircle, Menu, MessageCircle, RefreshCw, UserMinus, UsersRound } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Sidebar from '@/components/Sidebar';
import {
  fetchDiscoveryCommunities,
  fetchDiscoveryCreators,
  fetchDiscoveryPosts,
  fetchDiscoveryPreferences,
  fetchDiscoveryTopics,
  fetchForYou,
  fetchForYouExplanation,
  followDiscoveryTopic,
  muteDiscoveryCommunity,
  muteDiscoveryCreator,
  muteDiscoveryTopic,
  normalizeMediaUrl,
  notInterestedDiscoveryPost,
  recordForYouEvent,
  recordDiscoveryEvent,
  refreshForYou,
  unfollowDiscoveryTopic,
  unmuteDiscoveryTopic,
} from '@/api/client';
import type { DiscoveryCommunity, DiscoveryCreator, DiscoveryPost, DiscoveryTopic, ForYouExplanation, ForYouPost } from '@/api/client';

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

function TopicChips({ selectedTopic, onSelect }: { selectedTopic: string | null; onSelect: (topicId: string | null) => void }) {
  const queryClient = useQueryClient();
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

  return (
    <section className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Browse topics</h2>
        {selectedTopic && (
          <button onClick={() => onSelect(null)} className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">
            Clear
          </button>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(topics.data || []).map((topic: DiscoveryTopic) => (
          <div key={topic.id} className={`min-w-[180px] rounded-lg border p-3 ${selectedTopic === topic.id ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40' : 'border-slate-200 dark:border-slate-800'}`}>
            <button onClick={() => onSelect(topic.id)} className="block truncate text-left text-sm font-semibold text-slate-900 dark:text-white">
              {topic.label}
            </button>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => (followed.has(topic.id) ? unfollow.mutate(topic.id) : follow.mutate(topic.id))}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
              >
                {followed.has(topic.id) ? 'Following' : 'Follow'}
              </button>
              <button
                onClick={() => (muted.has(topic.id) ? unmute.mutate(topic.id) : mute.mutate(topic.id))}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
              >
                {muted.has(topic.id) ? 'Muted' : 'Mute'}
              </button>
            </div>
          </div>
        ))}
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
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <button
        onClick={() => {
          if (creator.handle) navigate(`/p/${creator.handle}`);
          recordDiscoveryEvent({ eventType: 'discover_creator_open', candidateToken: creator.candidateToken }).catch(() => undefined);
        }}
        className="flex w-full items-center gap-3 text-left"
      >
        <Avatar src={normalizeMediaUrl(creator.avatarUrl)} alt={creator.name} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{creator.name}</p>
          <p className="truncate text-xs text-slate-500">{creator.displayHandle || creator.handle}</p>
        </div>
      </button>
      <div className="mt-3 flex flex-wrap gap-1">
        {creator.topics.map((topic) => <span key={topic.id} className="rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-900">{topic.label}</span>)}
      </div>
      <button onClick={() => creator.handle && mute.mutate()} className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">
        <UserMinus size={13} /> Don&apos;t recommend this creator
      </button>
    </div>
  );
}

function PostCard({ post, source = 'browse' }: { post: DiscoveryPost | ForYouPost; source?: 'browse' | 'for-you' }) {
  const queryClient = useQueryClient();
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
    <article className="border-b border-slate-200 px-4 py-5 dark:border-slate-800 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={normalizeMediaUrl(post.author.avatarUrl)} alt={post.author.name} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{post.author.name}</p>
            <p className="truncate text-xs text-slate-500">{post.author.displayHandle || post.author.handle} · {formatTime(post.createdAt)}</p>
          </div>
        </div>
        <button onClick={() => hide.mutate()} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-900" aria-label="Hide this post">
          <EyeOff size={16} />
        </button>
      </div>
      {post.body && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">{post.body}</p>}
      {post.media.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {post.media.map((media, index) => <img key={`${post.id}-${index}`} src={normalizeMediaUrl(media.url)} alt="" className="aspect-square rounded-lg object-cover" />)}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {post.topics.map((topic) => <span key={topic.id} className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-900">{topic.label}</span>)}
        {source === 'for-you' && (
          <button
            onClick={() => (explanation ? setShowWhy(true) : loadWhy.mutate())}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:text-slate-900 dark:border-slate-800 dark:hover:text-white"
          >
            <HelpCircle size={13} /> Why
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1"><MessageCircle size={13} /> {post.commentCount}</span>
      </div>
      {showWhy && explanation && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">Why this post</p>
              <p className="mt-1 text-slate-600 dark:text-slate-300">{explanation.text}</p>
              {explanation.topicLabel && <p className="mt-2 text-xs text-slate-500">Topic: {explanation.topicLabel}</p>}
            </div>
            <button onClick={() => setShowWhy(false)} className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">Close</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => hide.mutate()} className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">Hide post</button>
            {post.author.handle && <button onClick={() => muteDiscoveryCreator(post.author.handle!)} className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">Mute creator</button>}
            {explanation.topicId && <button onClick={() => muteDiscoveryTopic(explanation.topicId!)} className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">Mute topic</button>}
          </div>
        </div>
      )}
    </article>
  );
}

function CommunityCard({ community }: { community: DiscoveryCommunity }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mute = useMutation({
    mutationFn: () => muteDiscoveryCommunity(community.handle),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discovery'] }),
  });
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <button
        onClick={() => {
          navigate(`/c/${community.handle}`);
          recordDiscoveryEvent({ eventType: 'discover_community_open', candidateToken: community.candidateToken }).catch(() => undefined);
        }}
        className="flex w-full items-center gap-3 text-left"
      >
        {community.avatarUrl ? <img src={normalizeMediaUrl(community.avatarUrl)} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950"><UsersRound size={18} /></div>}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{community.name}</p>
          <p className="truncate text-xs text-slate-500">@{community.handle} · {community.memberCount} members</p>
        </div>
      </button>
      {community.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{community.description}</p>}
      <button onClick={() => mute.mutate()} className="mt-3 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">Don&apos;t recommend this Community</button>
    </div>
  );
}

export default function DiscoverPage() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [view, setView] = useState<'for-you' | 'browse'>('for-you');
  const [forYouCursor, setForYouCursor] = useState<string | null>(null);
  const creators = useQuery({ queryKey: ['discovery', 'creators', selectedTopic], queryFn: () => fetchDiscoveryCreators(selectedTopic || undefined) });
  const posts = useQuery({ queryKey: ['discovery', 'posts', selectedTopic], queryFn: () => fetchDiscoveryPosts(selectedTopic || undefined) });
  const communities = useQuery({ queryKey: ['discovery', 'communities', selectedTopic], queryFn: () => fetchDiscoveryCommunities(selectedTopic || undefined) });
  const prefs = useQuery({ queryKey: ['discovery-preferences'], queryFn: fetchDiscoveryPreferences });
  const forYou = useQuery({ queryKey: ['for-you', forYouCursor], queryFn: () => fetchForYou(forYouCursor) });
  const refreshFeed = useMutation({
    mutationFn: refreshForYou,
    onSuccess: (result) => {
      setForYouCursor(result.cursor);
      forYou.refetch();
    },
  });

  return (
    <main className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar onNewConversation={() => navigate('/chats')} onChatFilterChange={() => navigate('/chats')} onNavigateMobile={() => setSidebarOpen(false)} />
      </div>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:px-6">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="rounded-lg border border-slate-200 p-2 text-slate-600 dark:border-slate-800 md:hidden" aria-label="Open navigation">
              <Menu size={18} />
            </button>
            <Compass size={20} />
            <h1 className="text-xl font-semibold">Discover</h1>
            <div className="ml-auto flex rounded-lg border border-slate-200 p-1 text-sm dark:border-slate-800">
              <button
                onClick={() => setView('for-you')}
                className={`rounded-md px-3 py-1.5 ${view === 'for-you' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'}`}
              >
                For You
              </button>
              <button
                onClick={() => setView('browse')}
                className={`rounded-md px-3 py-1.5 ${view === 'browse' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'}`}
              >
                Browse
              </button>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-5xl bg-white dark:bg-slate-950">
          {view === 'for-you' ? (
            <section className="px-4 py-5 sm:px-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">For You</h2>
                  {forYou.data?.message && <p className="mt-1 text-xs text-slate-500">{forYou.data.message}</p>}
                </div>
                <button
                  onClick={() => refreshFeed.mutate()}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                >
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>
              {(forYou.data?.posts || []).length ? (
                <>
                  {forYou.data!.posts.map((post) => <PostCard key={post.id} post={post} source="for-you" />)}
                  {forYou.data?.nextCursor && (
                    <button onClick={() => setForYouCursor(forYou.data?.nextCursor || null)} className="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-800">
                      Load more
                    </button>
                  )}
                </>
              ) : (
                <p className="rounded-lg border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800">No recommendations are available yet.</p>
              )}
            </section>
          ) : (
            <>
              <TopicChips selectedTopic={selectedTopic} onSelect={setSelectedTopic} />
              <section className="grid gap-5 px-4 py-5 lg:grid-cols-[1fr_320px] sm:px-6">
                <div>
                  <h2 className="mb-3 text-sm font-semibold">Public posts</h2>
                  {(posts.data?.posts || []).length ? posts.data!.posts.map((post) => <PostCard key={post.id} post={post} />) : <p className="rounded-lg border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800">No discoverable content is available for this topic yet.</p>}
                </div>
                <aside className="space-y-5">
                  <section>
                    <h2 className="mb-3 text-sm font-semibold">Discover creators</h2>
                    <div className="space-y-3">{(creators.data?.creators || []).map((creator) => <CreatorCard key={creator.handle || creator.name} creator={creator} />)}</div>
                  </section>
                  <section>
                    <h2 className="mb-3 text-sm font-semibold">Open Communities</h2>
                    <div className="space-y-3">{(communities.data?.communities || []).map((community) => <CommunityCard key={community.handle} community={community} />)}</div>
                  </section>
                  <section className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                    <h2 className="font-semibold">Your interests</h2>
                    <p className="mt-2 text-xs text-slate-500">Topics you follow help improve future recommendations.</p>
                    <p className="mt-2 text-xs text-slate-500">Muted creators, Communities, and topics will not appear in Discover.</p>
                    <div className="mt-3 text-xs text-slate-500">
                      {prefs.data?.followedTopics.length || 0} followed · {prefs.data?.mutedTopics.length || 0} muted
                    </div>
                    <button onClick={() => navigate('/settings?s=discovery')} className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium dark:border-slate-700">
                      Discovery settings
                    </button>
                  </section>
                </aside>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
