import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bookmark, CalendarClock, Flag, Menu, MessageCircle, Play, Share2, Upload, Volume2, VolumeX, XCircle } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Sidebar from '@/components/Sidebar';
import PlanThisDialog from '@/components/PlanThisDialog';
import { ShareToChatPanel } from '@/components/ShareToChat';
import {
  createReelComment,
  createReelEventToken,
  createReelPlaybackSession,
  fetchAuthorizedObjectUrl,
  fetchReelsForYou,
  fetchReelComments,
  fetchReelsBrowse,
  muteReelCreator,
  normalizeMediaUrl,
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

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const reactions = ['❤️', '😂', '😮', '😢', '🙌'];

function ReelCard({
  reel,
  onHidden,
  queryKey,
  allowSignals,
  active,
  onActive,
}: {
  reel: ReelItem;
  onHidden: () => void;
  queryKey: readonly unknown[];
  allowSignals: boolean;
  active: boolean;
  onActive: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const stageRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playback, setPlayback] = useState<{ fallbackUrl: string; posterUrl: string } | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [posterUrl, setPosterUrl] = useState<string | undefined>();
  const [playbackState, setPlaybackState] = useState<'loading' | 'ready' | 'playing' | 'paused' | 'failed'>('loading');
  const [muted, setMuted] = useState(true);
  const [commentBody, setCommentBody] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [eventToken, setEventToken] = useState(reel.eventToken || '');
  const [whyOpen, setWhyOpen] = useState(false);
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const comments = useQuery({
    queryKey: ['reel-comments', reel.id],
    queryFn: () => fetchReelComments(reel.id),
    enabled: commentsOpen,
  });

  useEffect(() => {
    let alive = true;
    setEventToken(reel.eventToken || '');
    setPlayback(null);
    setVideoUrl(undefined);
    setPosterUrl(undefined);
    setPlaybackState('loading');
    createReelPlaybackSession(reel.id)
      .then((value) => {
        if (alive) setPlayback(value);
      })
      .catch(() => {
        if (alive) setPlaybackState('failed');
      });
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
      try {
        const [nextVideoUrl, nextPosterUrl] = await Promise.all([
          fetchAuthorizedObjectUrl(playback.fallbackUrl),
          fetchAuthorizedObjectUrl(playback.posterUrl),
        ]);
        if (!alive) return;
        if (!nextVideoUrl || !nextPosterUrl) throw new Error('playback_unavailable');
        objectUrls.push(nextVideoUrl, nextPosterUrl);
        setVideoUrl(nextVideoUrl);
        setPosterUrl(nextPosterUrl);
        setPlaybackState('ready');
      } catch {
        if (alive) setPlaybackState('failed');
      }
    };
    void load();
    return () => {
      alive = false;
      objectUrls.forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
    };
  }, [playback]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.intersectionRatio >= 0.65)) onActive();
    }, { threshold: [0, 0.35, 0.65, 0.9] });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onActive]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active || document.visibilityState === 'hidden') {
      video.pause();
      setPlaybackState((state) => state === 'failed' ? state : 'paused');
      return;
    }
    if (reducedMotion) return;
    video.muted = true;
    setMuted(true);
    const play = video.play();
    if (play && typeof play.catch === 'function') {
      play.catch(() => setPlaybackState((state) => state === 'failed' ? state : 'ready'));
    }
  }, [active, reducedMotion, videoUrl]);

  useEffect(() => {
    const pauseOnHidden = () => {
      if (document.visibilityState === 'hidden') videoRef.current?.pause();
    };
    document.addEventListener('visibilitychange', pauseOnHidden);
    return () => document.removeEventListener('visibilitychange', pauseOnHidden);
  }, []);

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
    <article ref={stageRef} className="mx-auto flex min-h-[calc(100vh-140px)] w-full max-w-4xl snap-start items-center justify-center py-6">
      <div
        className="relative aspect-[9/16] max-h-[calc(100vh-180px)] w-full max-w-[430px] overflow-hidden rounded-2xl border border-[color:var(--bl-border)] bg-black shadow-2xl"
        style={{ boxShadow: 'var(--bl-glow-md), 0 25px 50px -12px rgba(0,0,0,0.5)' }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            className="h-full w-full bg-black object-contain"
            controls
            muted={muted}
            playsInline
            preload="metadata"
            poster={posterUrl}
            src={videoUrl}
            onCanPlay={() => setPlaybackState((state) => state === 'failed' ? state : 'ready')}
            onPlaying={() => setPlaybackState('playing')}
            onPause={() => setPlaybackState((state) => state === 'failed' ? state : 'paused')}
            onError={() => setPlaybackState('failed')}
            onTimeUpdate={(event) => {
              if (!eventToken || !allowSignals) return;
              const video = event.currentTarget;
              if (video.duration && video.currentTime / video.duration > 0.75) {
                void recordReelEvent(reel.id, { eventType: 'reel_completion_bucket', eventToken, completionBucket: '75_to_95_percent' });
              }
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-5 text-center text-sm text-slate-300">
            {playbackState === 'failed' ? 'This Reel is unavailable.' : 'Loading video...'}
          </div>
        )}
        <button
          onClick={() => setMuted((value) => !value)}
          className="absolute right-3 top-3 rounded-full bg-black/70 p-2 text-white backdrop-blur transition hover:bg-black/80"
          aria-label={muted ? 'Unmute Reel' : 'Mute Reel'}
          title={muted ? 'Unmute Reel' : 'Mute Reel'}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} className="text-teal-300" />}
        </button>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-4 pt-20 text-white">
          <button onClick={() => navigate(`/reels/${reel.id}`)} className="flex items-center gap-2 text-left text-sm font-semibold hover:underline">
            <Avatar src={normalizeMediaUrl(reel.author?.avatarUrl)} alt={reel.author?.name || 'Creator'} size="xs" className="ring-2 ring-teal-400/60" />
            {reel.author?.name || reel.author?.handle || 'Creator'}
          </button>
          {reel.caption && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-100">{reel.caption}</p>}
          {reel.sourceAttribution && (
            <p className="mt-2 text-xs text-slate-300">
              {reel.sourceAttribution.label}
              {reel.sourceAttribution.creatorName ? ` · ${reel.sourceAttribution.creatorName}` : ''}
            </p>
          )}
          {reel.explanation && (
            <div className="mt-2">
            <button
              type="button"
              onClick={() => setWhyOpen((value) => !value)}
              className="rounded-md bg-white/15 px-2 py-1 text-xs text-white"
            >
              Why am I seeing this?
            </button>
            {whyOpen && (
              <p className="mt-2 text-xs leading-5 text-slate-200">
                {reel.explanation.text}
              </p>
            )}
            </div>
          )}
        </div>
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2">
          <button
            onClick={() => save.mutate()}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition ${reel.saved ? 'bg-teal-500 text-white' : 'bg-black/65 text-white hover:bg-black/75'}`}
            aria-label={reel.saved ? 'Remove saved Reel' : 'Save Reel'}
          >
            <Bookmark size={18} className={reel.saved ? 'fill-white' : ''} />
          </button>
          <button onClick={() => setCommentsOpen((value) => !value)} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition hover:bg-black/75" aria-label="Open Reel comments">
            <MessageCircle size={18} />
          </button>
          {reel.visibility === 'public' && (
            <button
              onClick={() => setShareOpen((value) => !value)}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition ${shareOpen ? 'bg-teal-500 text-white' : 'bg-black/65 text-white hover:bg-black/75'}`}
              aria-label="Share Reel"
            >
              <Share2 size={18} />
            </button>
          )}
          <button onClick={() => setPlanOpen(true)} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600/85 text-white backdrop-blur transition hover:bg-emerald-600" aria-label="Plan this Reel" title="Plan this">
            <CalendarClock size={18} />
          </button>
          <button onClick={() => hide.mutate()} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition hover:bg-black/75" aria-label="Not interested">
            <XCircle size={18} />
          </button>
          <button onClick={() => report.mutate()} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition hover:bg-black/75" aria-label="Report Reel">
            <Flag size={18} />
          </button>
          <button onClick={() => muteCreator.mutate()} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition hover:bg-black/75" aria-label="Mute Reel creator">
            <VolumeX size={18} />
          </button>
        </div>
        <div className="absolute left-3 top-3 flex gap-2">
          {reactions.map((emoji) => (
            <button
              key={emoji}
              onClick={() => react.mutate(emoji)}
              className={`rounded-full px-2.5 py-1.5 text-sm backdrop-blur transition ${reel.myReaction === emoji ? 'bg-teal-500 text-white' : 'bg-black/55 text-white hover:bg-black/65'}`}
              aria-label={`React ${emoji}`}
            >
              {emoji} {reel.reactionCounts?.[emoji] || 0}
            </button>
          ))}
        </div>
        {shareOpen && (
          <div className="absolute inset-x-3 bottom-3 max-h-[55%] overflow-auto">
            <ShareToChatPanel
              item={{ type: 'reel', id: reel.id }}
              onClose={() => setShareOpen(false)}
            />
          </div>
        )}
        {commentsOpen && (
          <div className="absolute inset-x-3 bottom-3 max-h-[45%] overflow-auto rounded-xl border border-white/10 bg-black/85 p-3 text-white backdrop-blur">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (commentBody.trim()) comment.mutate();
              }}
            >
              <input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} maxLength={500} className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/50 focus:border-teal-400" placeholder="Add a comment" />
              <button disabled={!commentBody.trim() || comment.isPending} className="rounded-md bg-teal-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-400 disabled:opacity-50">Post</button>
            </form>
            <div className="mt-3 space-y-2">
              {(comments.data?.comments || []).map((item) => (
                <div key={item.id} className="rounded-md bg-white/10 px-3 py-2 text-sm">
                  <p className="font-medium">{item.author?.name || item.author?.handle || 'Member'}</p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-100">{item.body}</p>
                </div>
              ))}
              {!comments.isLoading && comments.data?.comments.length === 0 && <p className="text-sm text-slate-300">No comments yet.</p>}
            </div>
          </div>
        )}
      </div>
      <PlanThisDialog source={{ type: 'reel', id: reel.id }} open={planOpen} onClose={() => setPlanOpen(false)} />
    </article>
  );
}

/** Small suggested-Reel tile — reuses the same authorized playback-session
    flow as the main player, resolving only the poster (not the video) to a
    blob URL. No fake thumbnails, no invented view counts: everything shown
    here is a real field already present on the loaded ReelItem. */
function SuggestedReelThumb({ reel, onSelect }: { reel: ReelItem; onSelect: () => void }) {
  const [posterUrl, setPosterUrl] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  const duration = formatDuration(reel.durationSeconds);

  useEffect(() => {
    let alive = true;
    let createdUrl: string | undefined;
    setPosterUrl(undefined);
    setFailed(false);
    createReelPlaybackSession(reel.id)
      .then((session) => fetchAuthorizedObjectUrl(session.posterUrl))
      .then((url) => {
        if (!alive) {
          if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        if (!url) throw new Error('poster_unavailable');
        createdUrl = url;
        setPosterUrl(url);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (createdUrl?.startsWith('blob:')) URL.revokeObjectURL(createdUrl);
    };
  }, [reel.id]);

  return (
    <button
      onClick={onSelect}
      className="group flex w-full items-center gap-3 rounded-xl border border-transparent p-2 text-left transition hover:border-[color:var(--bl-border)] hover:bg-[color:var(--bl-hover)]"
    >
      <div className="relative h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-[color:var(--bl-hover)]">
        {posterUrl && !failed ? (
          <img src={posterUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-teal-600 dark:text-teal-300">
            <Play size={16} />
          </div>
        )}
        {duration && (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 py-0.5 text-[9px] font-medium text-white">{duration}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-medium leading-4 text-[color:var(--bl-text)]">{reel.caption || 'Reel'}</p>
        <p className="mt-1 truncate text-xs text-[color:var(--bl-text-muted)]">{reel.author?.name || reel.author?.handle || 'Creator'}</p>
      </div>
    </button>
  );
}

export default function ReelsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tab, setTab] = useState<'for-you' | 'browse'>('for-you');
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [activeReelId, setActiveReelId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
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
  const loadMore = useMutation({
    mutationFn: () => tab === 'for-you' ? fetchReelsForYou({ cursor: forYou.data?.nextCursor }) : fetchReelsBrowse({ cursor: browse.data?.nextCursor }),
    onSuccess: (page) => {
      const key = tab === 'for-you' ? ['reels-for-you'] : ['reels-browse'];
      queryClient.setQueryData(key, (old: any) => {
        if (!old) return page;
        const seen = new Set(old.reels.map((reel: ReelItem) => reel.id));
        return { ...old, ...page, reels: [...old.reels, ...page.reels.filter((reel) => !seen.has(reel.id))] };
      });
    },
  });

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && active.data?.nextCursor && !loadMore.isPending) {
        loadMore.mutate();
      }
    }, { rootMargin: '700px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active.data?.nextCursor, loadMore.isPending, tab]);

  const currentReelId = activeReelId || visibleReels[0]?.id;
  // Derived entirely from the already-loaded, authorized Reels response —
  // no new endpoint, no fake entries. Hidden if fewer than 2 real Reels are
  // available to suggest, per the "no empty fake panel" requirement.
  const suggestedReels = useMemo(
    () => visibleReels.filter((reel) => reel.id !== currentReelId).slice(0, 5),
    [visibleReels, currentReelId]
  );

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
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <section className="min-w-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto max-w-3xl">
            <header className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  className="rounded-lg p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] md:hidden"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open menu"
                >
                  <Menu size={18} />
                </button>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-[color:var(--bl-text)]">Reels</h1>
                  <p className="mt-1 text-sm text-[color:var(--bl-text-secondary)]">Short stories. Big impact.</p>
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                {tab === 'for-you' && (
                  <button
                    onClick={() => refresh.mutate()}
                    className="rounded-xl border border-[color:var(--bl-border)] px-3 py-2 text-sm text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                  >
                    Refresh
                  </button>
                )}
                <button
                  onClick={() => navigate('/reels/new')}
                  className="bl-focus-ring inline-flex items-center gap-2 rounded-xl bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 hover:shadow dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
                >
                  <Upload size={16} /> Upload Reel
                </button>
              </div>
            </header>
            <div className="mb-3 inline-flex rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-1">
              <button
                onClick={() => setTab('for-you')}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${tab === 'for-you' ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950' : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'}`}
              >
                For You
              </button>
              <button
                onClick={() => setTab('browse')}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${tab === 'browse' ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950' : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'}`}
              >
                Browse
              </button>
            </div>
            {tab === 'for-you' && forYou.data?.personalized === false && (
              <p className="mb-3 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-4 py-3 text-sm text-[color:var(--bl-text-secondary)]">
                Personalized discovery is off. You are seeing the latest public Reels.
              </p>
            )}
            <div
              className="h-[calc(100vh-200px)] snap-y snap-mandatory overflow-y-auto rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-4"
              style={{ boxShadow: 'var(--bl-glow-sm)' }}
            >
              {active.isLoading && (
                <p className="py-8 text-center text-sm text-[color:var(--bl-text-muted)]">Loading Reels...</p>
              )}
              {active.isError && <p className="py-8 text-center text-sm text-rose-600 dark:text-rose-300">Unable to load Reels.</p>}
              {!active.isLoading && visibleReels.length === 0 && (
                <p className="py-8 text-center text-sm text-[color:var(--bl-text-muted)]">No Reels are available right now.</p>
              )}
              {visibleReels.map((reel) => (
                <ReelCard
                  key={reel.id}
                  reel={reel}
                  queryKey={activeQueryKey}
                  allowSignals={allowSignals}
                  active={currentReelId === reel.id}
                  onActive={() => setActiveReelId(reel.id)}
                  onHidden={() => setHidden((old) => new Set(old).add(reel.id))}
                />
              ))}
              <div ref={loadMoreRef} className="py-5 text-center text-sm text-[color:var(--bl-text-muted)]">
                {loadMore.isPending ? 'Loading more...' : active.data && !active.data.nextCursor && visibleReels.length > 0 ? "You're caught up for now." : ''}
              </div>
            </div>
          </div>
        </section>

        {suggestedReels.length > 0 && (
          <aside className="hidden w-[300px] flex-shrink-0 overflow-y-auto border-l border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-4 py-5 xl:block">
            <h2 className="px-2 text-sm font-semibold text-[color:var(--bl-text)]">Suggested Reels</h2>
            <div className="mt-2 space-y-1">
              {suggestedReels.map((reel) => (
                <SuggestedReelThumb key={reel.id} reel={reel} onSelect={() => navigate(`/reels/${reel.id}`)} />
              ))}
            </div>
            <button
              onClick={() => setTab('browse')}
              className="bl-focus-ring mt-3 w-full rounded-xl border border-[color:var(--bl-border)] py-2 text-sm font-medium text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              View all
            </button>
          </aside>
        )}
      </div>
    </main>
  );
}
