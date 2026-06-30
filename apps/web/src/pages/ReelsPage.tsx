import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Flag, Menu, MessageCircle, Plus, Volume2, VolumeX, XCircle } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import {
  apiClient,
  createReelComment,
  createReelEventToken,
  createReelPlaybackSession,
  fetchReelsForYou,
  fetchReelComments,
  fetchReelsBrowse,
  muteReelCreator,
  notInterestedReel,
  recordReelEvent,
  removeReelReaction,
  reportReel,
  refreshReelsForYou,
  saveReel,
  setReelReaction,
  unsaveReel,
} from '@/api/client';
import type { ReelItem } from '@/api/client';

const reactions = ['❤️', '😂', '😮', '😢', '🙌'];

function ReelCard({ reel, onHidden, queryKey, allowSignals }: { reel: ReelItem; onHidden: () => void; queryKey: readonly unknown[]; allowSignals: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [playback, setPlayback] = useState<{ fallbackUrl: string; posterUrl: string } | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [posterUrl, setPosterUrl] = useState<string | undefined>();
  const [muted, setMuted] = useState(true);
  const [commentBody, setCommentBody] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [eventToken, setEventToken] = useState(reel.eventToken || '');
  const [whyOpen, setWhyOpen] = useState(false);

  const comments = useQuery({
    queryKey: ['reel-comments', reel.id],
    queryFn: () => fetchReelComments(reel.id),
    enabled: commentsOpen,
  });

  useEffect(() => {
    let alive = true;
    setEventToken(reel.eventToken || '');
    createReelPlaybackSession(reel.id)
      .then((value) => {
        if (alive) setPlayback(value);
      })
      .catch(() => undefined);
    if (!reel.eventToken && allowSignals) {
      createReelEventToken(reel.id)
        .then((value) => {
          if (alive) setEventToken(value.eventToken);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [allowSignals, reel.eventToken, reel.id]);

  useEffect(() => {
    if (!eventToken || !allowSignals) return;
    void recordReelEvent(reel.id, { eventType: 'reel_open', eventToken });
  }, [allowSignals, eventToken, reel.id]);

  useEffect(() => {
    if (!playback) return undefined;
    let alive = true;
    const objectUrls: string[] = [];
    const load = async () => {
      const [video, poster] = await Promise.all([
        apiClient.get<Blob>(playback.fallbackUrl, { responseType: 'blob' }),
        apiClient.get<Blob>(playback.posterUrl, { responseType: 'blob' }),
      ]);
      if (!alive) return;
      const nextVideoUrl = URL.createObjectURL(video.data);
      const nextPosterUrl = URL.createObjectURL(poster.data);
      objectUrls.push(nextVideoUrl, nextPosterUrl);
      setVideoUrl(nextVideoUrl);
      setPosterUrl(nextPosterUrl);
    };
    void load();
    return () => {
      alive = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [playback]);

  const updateBrowseReel = (patch: Partial<ReelItem>) => {
    queryClient.setQueryData<{ reels: ReelItem[]; nextCursor: string | null }>(queryKey, (old) => old ? {
      ...old,
      reels: old.reels.map((item) => item.id === reel.id ? { ...item, ...patch } : item),
    } : old);
  };

  const react = useMutation({
    mutationFn: (emoji: string) => reel.myReaction === emoji ? removeReelReaction(reel.id) : setReelReaction(reel.id, emoji),
    onSuccess: (value) => updateBrowseReel({ myReaction: value.myReaction, reactionCounts: value.reactionCounts }),
  });
  const save = useMutation({
    mutationFn: () => reel.saved ? unsaveReel(reel.id) : saveReel(reel.id),
    onSuccess: (value) => updateBrowseReel({ saved: value.saved }),
  });
  const comment = useMutation({
    mutationFn: () => createReelComment(reel.id, commentBody),
    onSuccess: (value) => {
      setCommentBody('');
      updateBrowseReel({ commentCount: value.commentCount });
      void comments.refetch();
    },
  });
  const hide = useMutation({ mutationFn: () => notInterestedReel(reel.id), onSuccess: onHidden });
  const muteCreator = useMutation({ mutationFn: () => muteReelCreator(reel.id), onSuccess: onHidden });
  const report = useMutation({ mutationFn: () => reportReel(reel.id, { reason: 'Inappropriate Reel' }) });

  return (
    <article className="grid gap-4 border-b border-slate-200 py-5 dark:border-slate-800 md:grid-cols-[minmax(260px,380px)_1fr]">
      <div className="relative overflow-hidden rounded-lg bg-black">
        {videoUrl ? (
          <video
            className="aspect-[9/16] w-full bg-black object-contain"
            controls
            muted={muted}
            playsInline
            preload="metadata"
            poster={posterUrl}
            src={videoUrl}
            onTimeUpdate={(event) => {
              if (!eventToken || !allowSignals) return;
              const video = event.currentTarget;
              if (video.duration && video.currentTime / video.duration > 0.75) {
                void recordReelEvent(reel.id, { eventType: 'reel_completion_bucket', eventToken, completionBucket: '75_to_95_percent' });
              }
            }}
          />
        ) : (
          <div className="flex aspect-[9/16] items-center justify-center text-sm text-slate-300">Loading video...</div>
        )}
        <button
          onClick={() => setMuted((value) => !value)}
          className="absolute right-3 top-3 rounded-full bg-black/70 p-2 text-white"
          aria-label={muted ? 'Unmute Reel' : 'Mute Reel'}
          title={muted ? 'Unmute Reel' : 'Mute Reel'}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      </div>
      <div className="min-w-0">
        <button onClick={() => navigate(`/reels/${reel.id}`)} className="text-left text-sm font-semibold text-slate-950 hover:underline dark:text-white">
          {reel.author?.name || reel.author?.handle || 'Creator'}
        </button>
        {reel.caption && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{reel.caption}</p>}
        {reel.explanation && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setWhyOpen((value) => !value)}
              className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              Why am I seeing this?
            </button>
            {whyOpen && (
              <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                {reel.explanation.text}
              </p>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {reactions.map((emoji) => (
            <button
              key={emoji}
              onClick={() => react.mutate(emoji)}
              className={`rounded-md border px-2.5 py-1.5 text-sm ${reel.myReaction === emoji ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/30' : 'border-slate-200 dark:border-slate-700'}`}
              aria-label={`React ${emoji}`}
            >
              {emoji} {reel.reactionCounts?.[emoji] || 0}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => save.mutate()} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <Bookmark size={15} /> {reel.saved ? 'Saved' : 'Save'}
          </button>
          <button onClick={() => setCommentsOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <MessageCircle size={15} /> {reel.commentCount || 0}
          </button>
          <button onClick={() => hide.mutate()} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <XCircle size={15} /> Not interested
          </button>
          <button onClick={() => muteCreator.mutate()} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">Mute creator</button>
          <button onClick={() => report.mutate()} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <Flag size={15} /> Report
          </button>
        </div>
        {commentsOpen && (
          <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (commentBody.trim()) comment.mutate();
              }}
            >
              <input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} maxLength={500} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Add a comment" />
              <button disabled={!commentBody.trim() || comment.isPending} className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">Post</button>
            </form>
            <div className="mt-3 space-y-2">
              {(comments.data?.comments || []).map((item) => (
                <div key={item.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
                  <p className="font-medium">{item.author?.name || item.author?.handle || 'Member'}</p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-200">{item.body}</p>
                </div>
              ))}
              {!comments.isLoading && comments.data?.comments.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export default function ReelsPage() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab] = useState<'for-you' | 'browse'>('for-you');
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const browse = useQuery({ queryKey: ['reels-browse'], queryFn: () => fetchReelsBrowse() });
  const forYou = useQuery({ queryKey: ['reels-for-you'], queryFn: () => fetchReelsForYou() });
  const active = tab === 'for-you' ? forYou : browse;
  const refresh = useMutation({
    mutationFn: refreshReelsForYou,
    onSuccess: () => forYou.refetch(),
  });
  const visibleReels = useMemo(() => (active.data?.reels || []).filter((reel) => !hidden.has(reel.id)), [active.data?.reels, hidden]);
  const activeQueryKey = tab === 'for-you' ? ['reels-for-you'] as const : ['reels-browse'] as const;
  const allowSignals = tab === 'browse' || (tab === 'for-you' && Boolean(forYou.data?.personalized));

  return (
    <main className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="hidden md:block"><Sidebar /></div>
      {sidebarOpen && <div className="fixed inset-0 z-40 flex md:hidden"><div className="absolute inset-0 bg-slate-950/40" onClick={() => setSidebarOpen(false)} /><Sidebar onNavigateMobile={() => setSidebarOpen(false)} /></div>}
      <section className="min-w-0 flex-1 px-4 py-5">
        <div className="mx-auto max-w-5xl">
          <header className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-900" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
              <div>
                <h1 className="text-xl font-semibold">Reels</h1>
                <p className="text-sm text-slate-500">{tab === 'for-you' ? 'Personalized public Reels with safe explanations.' : 'Newest public Reels from opted-in creators.'}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {tab === 'for-you' && <button onClick={() => refresh.mutate()} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">Refresh</button>}
              <button onClick={() => navigate('/reels/new')} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                <Plus size={16} /> Create
              </button>
            </div>
          </header>
          <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            <button onClick={() => setTab('for-you')} className={`rounded-md px-3 py-1.5 text-sm ${tab === 'for-you' ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 dark:text-slate-300'}`}>For You</button>
            <button onClick={() => setTab('browse')} className={`rounded-md px-3 py-1.5 text-sm ${tab === 'browse' ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 dark:text-slate-300'}`}>Browse</button>
          </div>
          {tab === 'for-you' && forYou.data?.personalized === false && (
            <p className="mb-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              Personalized discovery is off. You are seeing the latest public Reels.
            </p>
          )}
          <div className="rounded-lg border border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
            {active.isLoading && <p className="py-8 text-sm text-slate-500">Loading Reels...</p>}
            {active.isError && <p className="py-8 text-sm text-rose-600">Unable to load Reels.</p>}
            {!active.isLoading && visibleReels.length === 0 && <p className="py-8 text-sm text-slate-500">No Reels are available right now.</p>}
            {visibleReels.map((reel) => (
              <ReelCard key={reel.id} reel={reel} queryKey={activeQueryKey} allowSignals={allowSignals} onHidden={() => setHidden((old) => new Set(old).add(reel.id))} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
