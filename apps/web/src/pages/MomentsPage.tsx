import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Camera,
  ChevronDown,
  CircleDashed,
  Eye,
  Heart,
  Image as ImageIcon,
  Loader2,
  Lock,
  Menu,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Type,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import {
  apiClient,
  createMomentVideoPlaybackSession,
  fetchMomentVideoStatus,
  initiateMomentVideoUpload,
  normalizeMediaUrl,
  uploadMomentVideoSource,
} from '@/api/client';
import Avatar from '@/components/Avatar';
import CameraModal from '@/components/CameraModal';
import Sidebar from '@/components/Sidebar';
import BlabberMark from '@/components/brand/BlabberMark';
import { useAuth } from '@/contexts/AuthContext';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useTheme } from '@/hooks/useTheme';

interface MomentUser { _id: string; name: string; avatarUrl?: string | null }
interface Moment {
  _id: string;
  author: MomentUser;
  type: 'text' | 'image' | 'audio' | 'video';
  textBody?: string;
  caption?: string;
  mediaUrl?: string | null;
  videoPlaybackUrl?: string | null;
  style?: { backgroundKey?: string; textStyleKey?: string };
  createdAt: string;
  expiresAt: string;
  archiveState: 'active' | 'archived' | 'deleted';
  viewed?: boolean;
  audienceType?: string;
  myReaction?: string;
}

interface MomentInteraction {
  viewer: MomentUser;
  viewedAt: string | null;
  reaction: { emoji: string; reactedAt: string } | null;
}

const backgroundStyles: Record<string, string> = {
  teal: '#0f766e',
  sky: '#2563eb',
  violet: '#7c3aed',
  rose: '#be123c',
  amber: '#b45309',
  slate: '#334155',
};

const MAX_LENGTH = 500;
const REPLY_MAX_LENGTH = 1000;
const VIDEO_PROCESSING_TIMEOUT_MS = 120_000;
const MOMENT_REACTIONS = ['❤️', '😂', '😮', '😢', '🙌'];

function formatCreatedAt(value: string, nowMs: number) {
  const diffMs = Math.max(0, nowMs - new Date(value).getTime());
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatRemaining(value: string, nowMs: number) {
  const diffMs = new Date(value).getTime() - nowMs;
  if (diffMs <= 0) return 'This Moment is no longer available.';
  const minutes = Math.ceil(diffMs / 60_000);
  const hours = Math.ceil(diffMs / 3_600_000);
  if (minutes <= 1) return 'Expires in 1m';
  if (minutes < 60) return `Expires in ${minutes}m`;
  return `Expires in ${Math.min(hours, 24)}h`;
}

export default function MomentsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showArchive, setShowArchive] = useState(location.pathname.endsWith('/archive'));
  const [viewerMoment, setViewerMoment] = useState<Moment | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useTheme();

  useEffect(() => {
    setShowArchive(location.pathname.endsWith('/archive'));
  }, [location.pathname]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const feed = useQuery({
    queryKey: ['moments-feed'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ myMoments: Moment[]; recentMoments: Moment[]; viewedMoments: Moment[] }>('/api/moments/feed');
      return data;
    },
    refetchInterval: 60_000,
  });

  const archive = useQuery({
    queryKey: ['moments-archive'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ moments: Moment[] }>('/api/moments/archive');
      return data.moments;
    },
    enabled: showArchive,
  });

  const interactions = useQuery({
    queryKey: ['moment-interactions', viewerMoment?._id],
    queryFn: async () => {
      const { data } = await apiClient.get<{ interactions: MomentInteraction[] }>(`/api/moments/${viewerMoment!._id}/interactions`);
      return data.interactions;
    },
    enabled: Boolean(viewerMoment),
  });

  const deleteMoment = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/api/moments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moments-feed'] });
      queryClient.invalidateQueries({ queryKey: ['moments-archive'] });
    },
  });

  const allFeedMoments = useMemo(
    () => [...(feed.data?.myMoments ?? []), ...(feed.data?.recentMoments ?? []), ...(feed.data?.viewedMoments ?? [])],
    [feed.data]
  );
  const visibleMoments = showArchive ? archive.data ?? [] : allFeedMoments;

  const [createMode, setCreateMode] = useState<'text' | 'image' | 'video' | 'audio'>('text');
  const [composerMode, setComposerMode] = useState<'text' | 'image' | 'video' | 'audio'>('text');
  const openCreateMoment = (mode: 'text' | 'image' | 'video' | 'audio' = 'text') => {
    setCreateMode(mode);
    setShowCreateModal(true);
    setShowSidebar(false);
  };

  const composerActions: Array<{ id: 'text' | 'image' | 'video' | 'audio'; label: string; icon: typeof ImageIcon }> = [
    { id: 'text', label: 'Text', icon: Type },
    { id: 'image', label: 'Photo', icon: ImageIcon },
    { id: 'video', label: 'Video', icon: Video },
    { id: 'audio', label: 'Audio', icon: Volume2 },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[color:var(--bl-bg)] text-[color:var(--bl-text)]">
      <div className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${showSidebar ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`} onClick={() => setShowSidebar(false)} aria-hidden="true" />
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${showSidebar ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} onNewConversation={() => navigate('/chats')} onChatFilterChange={() => navigate('/chats')} onNavigateMobile={() => setShowSidebar(false)} taskCount={0} />
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto bg-[color:var(--bl-bg)]">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
          {/* Mobile-only sidebar toggle — no standalone header bar on desktop */}
          <button
            onClick={() => setShowSidebar(true)}
            className="rounded-lg border border-[color:var(--bl-border)] p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] md:hidden"
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>

          {/* ── Hero ─────────────────────────────────────────────────────── */}
          <section className="relative overflow-hidden rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-6 py-8 sm:px-10 sm:py-10">
            <div
              className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-teal-400/20 blur-3xl dark:bg-teal-400/10"
              aria-hidden="true"
            />
            <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-md">
                <h1 className="text-4xl font-bold tracking-tight text-[color:var(--bl-text)] sm:text-5xl">Moments</h1>
                <p className="mt-2 text-xl font-semibold text-teal-600 dark:text-teal-300">Capture. Create. Connect.</p>
                <p className="mt-3 text-[15px] leading-6 text-[color:var(--bl-text-secondary)]">
                  Share text, photos, videos, or audio with the people you choose.
                </p>
                <p className="mt-1.5 text-xs text-[color:var(--bl-text-muted)]">Moments automatically expire after 24 hours.</p>
              </div>

              <MomentsHeroMascot />

              <div className="w-full flex-shrink-0 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] p-4 sm:w-64">
                <button
                  onClick={() => openCreateMoment('text')}
                  className="bl-focus-ring flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 hover:shadow dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
                >
                  <Plus size={16} strokeWidth={2.5} />
                  Create Moment
                </button>
                <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[color:var(--bl-text-muted)]">
                  <Lock size={13} className="mt-0.5 flex-shrink-0" />
                  Your moments are private until you share them.
                </p>
              </div>
            </div>
          </section>

          {/* ── Composer ─────────────────────────────────────────────────── */}
          <section className="rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold text-[color:var(--bl-text)]">What&apos;s on your mind?</h2>
            <button
              onClick={() => openCreateMoment(composerMode)}
              className="mt-1.5 block w-full text-left text-sm text-[color:var(--bl-text-muted)] transition hover:text-[color:var(--bl-text-secondary)]"
            >
              Share a thought, update, or life moment&hellip;
            </button>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {composerActions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => setComposerMode(action.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                      composerMode === action.id
                        ? 'border-teal-500 bg-teal-50 text-teal-800 dark:border-teal-400/50 dark:bg-teal-500/15 dark:text-teal-100'
                        : 'border-[color:var(--bl-border)] text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'
                    }`}
                  >
                    <action.icon size={14} />
                    {action.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => openCreateMoment(composerMode)}
                aria-label="Create Moment"
                title="Create Moment"
                className="bl-focus-ring flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-sm transition hover:bg-teal-700 hover:shadow dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
                style={{ boxShadow: 'var(--bl-mascot-glow)' }}
              >
                <Send size={17} />
              </button>
            </div>
          </section>

          {/* ── Recent / Archive ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[color:var(--bl-text)]">{showArchive ? 'Moment archive' : 'Recent Moments'}</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate(showArchive ? '/moments' : '/moments/archive')}
                  className="text-sm font-medium text-teal-600 transition hover:text-teal-700 dark:text-teal-300 dark:hover:text-teal-200"
                  title={showArchive ? 'Back to recent Moments' : 'View archived Moments'}
                >
                  {showArchive ? 'Back to recent' : 'View all'}
                </button>
                <button
                  onClick={() => (showArchive ? archive.refetch() : feed.refetch())}
                  className="bl-focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 text-sm font-medium text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                  aria-label="Refresh Moments"
                >
                  <RefreshCw size={15} className={(feed.isFetching || archive.isFetching) ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>
            <p className="mt-1 text-sm text-[color:var(--bl-text-muted)]">
              {visibleMoments.length === 1 ? '1 Moment' : `${visibleMoments.length} Moments`}
            </p>

            <div className="mt-4">
              {(feed.isLoading || (showArchive && archive.isLoading)) ? <LoadingState /> : feed.isError || archive.isError ? <ErrorState onRetry={() => (showArchive ? archive.refetch() : feed.refetch())} /> : visibleMoments.length === 0 ? <EmptyState showArchive={showArchive} /> : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleMoments.map((moment) => (
                    <MomentItem key={moment._id} moment={moment} now={now} isOwner={moment.author._id === user?._id} isDeleting={deleteMoment.isPending && deleteMoment.variables === moment._id} onDelete={() => deleteMoment.mutate(moment._id)} onViewers={() => setViewerMoment(moment)} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Persistent "keep creating" callout — real empty-state, not shown when Moments already exist ── */}
          {visibleMoments.length > 0 && !feed.isLoading && !archive.isLoading && (
            <section className="rounded-3xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)]/60 px-6 py-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                <CircleDashed size={22} />
              </div>
              <h3 className="mt-3 text-base font-semibold text-[color:var(--bl-text)]">Your moments will live here</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-[color:var(--bl-text-muted)]">Create your next Moment to capture what matters.</p>
              <button
                onClick={() => openCreateMoment('text')}
                className="bl-focus-ring mt-4 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
              >
                <Plus size={15} strokeWidth={2.5} />
                Create Moment
              </button>
            </section>
          )}
        </div>
      </main>

      {showCreateModal && <CreateMomentModal initialMode={createMode} onClose={() => setShowCreateModal(false)} onCreated={() => { setShowCreateModal(false); queryClient.invalidateQueries({ queryKey: ['moments-feed'] }); }} />}
      {viewerMoment && (
        <ViewerModal moment={viewerMoment} interactions={interactions.data ?? []} isLoading={interactions.isLoading} onClose={() => setViewerMoment(null)} />
      )}
    </div>
  );
}

/** Purely decorative hero illustration — the Blabber mascot with small
    floating badges hinting at the four Moment content types. */
function MomentsHeroMascot() {
  const badgeClass =
    'absolute flex h-8 w-8 items-center justify-center rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] text-teal-600 shadow-sm dark:text-teal-300';
  return (
    <div className="relative mx-auto flex h-40 w-40 flex-shrink-0 items-center justify-center sm:h-48 sm:w-48" aria-hidden="true">
      <BlabberMark size={132} variant="icon" className="relative" />
      <span className={`${badgeClass} left-1 top-4`}>
        <ImageIcon size={15} />
      </span>
      <span className={`${badgeClass} right-0 top-9`}>
        <Video size={15} />
      </span>
      <span className={`${badgeClass} -left-1 bottom-8`}>
        <MessageCircle size={15} />
      </span>
      <span className={`${badgeClass} right-2 bottom-1`}>
        <Volume2 size={15} />
      </span>
    </div>
  );
}

function MomentItem({ moment, now, isOwner, isDeleting, onDelete, onViewers }: { moment: Moment; now: number; isOwner: boolean; isDeleting: boolean; onDelete: () => void; onViewers: () => void }) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState('');
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const background = backgroundStyles[moment.style?.backgroundKey || 'teal'] || backgroundStyles.teal;

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const setReaction = useMutation({
    mutationFn: async (emoji: string) => {
      if (moment.myReaction === emoji) {
        await apiClient.delete(`/api/moments/${moment._id}/reaction`);
        return null;
      }
      await apiClient.post(`/api/moments/${moment._id}/reaction`, { emoji });
      return emoji;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moments-feed'] });
      queryClient.invalidateQueries({ queryKey: ['moment-interactions', moment._id] });
      setShowReactionPicker(false);
    },
  });
  const sendReply = useMutation({
    mutationFn: async () => apiClient.post(`/api/moments/${moment._id}/reply`, { body: replyText.trim() }),
    onSuccess: () => {
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['moments-feed'] });
    },
  });
  const canReply = Boolean(replyText.trim()) && !sendReply.isPending;
  const hasReacted = Boolean(moment.myReaction);
  const canInteract = !isOwner && moment.archiveState === 'active';

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-sm transition hover:shadow-md hover:[box-shadow:var(--bl-glow-sm)]">
      <div className="flex items-start gap-3 p-3.5">
        <Avatar src={moment.author.avatarUrl || undefined} alt={moment.author.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-[color:var(--bl-text)]">{moment.author.name}</p>
            <Lock size={11} className="flex-shrink-0 text-[color:var(--bl-text-muted)]" aria-label="Private Moment" />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[color:var(--bl-text-muted)]">
            <span>{formatCreatedAt(moment.createdAt, now)}</span>
            <span aria-hidden="true">&middot;</span>
            <span className={moment.archiveState === 'archived' ? '' : 'text-teal-600 dark:text-teal-300'}>
              {moment.archiveState === 'archived' ? 'Archived' : formatRemaining(moment.expiresAt, now)}
            </span>
          </div>
        </div>
        {isOwner && (
          <div ref={menuRef} className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)]"
              aria-label="Moment options"
              aria-expanded={menuOpen}
              title="Moment options"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] py-1 shadow-lg">
                <button
                  onClick={() => { setMenuOpen(false); onViewers(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                >
                  <Eye size={14} /> Viewers
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  disabled={isDeleting}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:text-rose-300 dark:hover:bg-rose-950/30"
                >
                  {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {moment.type !== 'text' && (moment.mediaUrl || moment.videoPlaybackUrl) ? (
        <div className="border-t border-[color:var(--bl-border)] bg-[color:var(--bl-hover)]">
          <MomentMedia moment={moment} />
          {moment.caption && <p className="border-t border-[color:var(--bl-border)] px-4 py-3 text-sm text-[color:var(--bl-text-secondary)]">{moment.caption}</p>}
        </div>
      ) : (
        <div className="px-3.5 pb-3.5">
          <div className="flex min-h-[140px] items-center justify-center rounded-xl px-5 py-8 text-center" style={{ backgroundColor: background }}>
            <p className="max-w-xl whitespace-pre-wrap break-words text-lg font-semibold leading-7 text-white">{moment.textBody}</p>
          </div>
        </div>
      )}
      {canInteract && (
        <div className="border-t border-[color:var(--bl-border)] px-3.5 py-2.5">
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                onClick={() => setShowReactionPicker((open) => !open)}
                aria-label={hasReacted ? 'Change reaction' : 'React to Moment'}
                aria-expanded={showReactionPicker}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                  hasReacted ? 'text-rose-500' : 'text-[color:var(--bl-text-muted)] hover:bg-[color:var(--bl-hover)]'
                }`}
              >
                <Heart size={16} fill={hasReacted ? 'currentColor' : 'none'} />
              </button>
              {showReactionPicker && (
                <div className="absolute bottom-full left-0 z-10 mb-1.5 flex gap-1 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-1.5 shadow-lg">
                  {MOMENT_REACTIONS.map((emoji) => {
                    const selected = moment.myReaction === emoji;
                    return (
                      <button
                        key={emoji}
                        onClick={() => setReaction.mutate(emoji)}
                        disabled={setReaction.isPending}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg text-base transition ${
                          selected ? 'bg-teal-50 dark:bg-teal-500/15' : 'hover:bg-[color:var(--bl-hover)]'
                        } disabled:opacity-60`}
                        aria-label={`React ${emoji}`}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowReplyBox((open) => !open)}
              aria-label="Reply privately"
              aria-expanded={showReplyBox}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)]"
            >
              <MessageCircle size={16} />
            </button>
          </div>
          {showReplyBox && (
            <div className="mt-2.5 flex gap-2">
              <input
                autoFocus
                value={replyText}
                onChange={(event) => setReplyText(event.target.value.slice(0, REPLY_MAX_LENGTH))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && canReply) {
                    event.preventDefault();
                    sendReply.mutate();
                  }
                }}
                placeholder="Reply privately"
                className="min-w-0 flex-1 rounded-lg border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm text-[color:var(--bl-text)] outline-none placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400"
              />
              <button
                onClick={() => sendReply.mutate()}
                disabled={!canReply}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
                aria-label="Send reply"
              >
                {sendReply.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
          )}
          {(setReaction.isError || sendReply.isError) && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">This Moment interaction is unavailable.</p>}
        </div>
      )}
    </div>
  );
}

function MomentMedia({ moment }: { moment: Moment }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const mediaUrl = normalizeMediaUrl(moment.mediaUrl);

  useEffect(() => {
    let cancelled = false;
    let nextUrl: string | null = null;
    let nextPosterUrl: string | null = null;
    setObjectUrl(null);
    setPosterUrl(null);
    setUnavailable(false);

    if (moment.type === 'video') {
      createMomentVideoPlaybackSession(moment._id)
        .then(() => Promise.all([
          apiClient.get<Blob>(`/api/moments/${moment._id}/video/fallback`, { responseType: 'blob' }),
          apiClient.get<Blob>(`/api/moments/${moment._id}/video/poster`, { responseType: 'blob' }),
        ]))
        .then(([videoResponse, posterResponse]) => {
          if (cancelled) return;
          nextUrl = URL.createObjectURL(videoResponse.data);
          nextPosterUrl = URL.createObjectURL(posterResponse.data);
          setObjectUrl(nextUrl);
          setPosterUrl(nextPosterUrl);
        })
        .catch(() => {
          if (!cancelled) setUnavailable(true);
        });

      return () => {
        cancelled = true;
        if (nextUrl) URL.revokeObjectURL(nextUrl);
        if (nextPosterUrl) URL.revokeObjectURL(nextPosterUrl);
      };
    }

    if (!mediaUrl) {
      setUnavailable(true);
      return undefined;
    }

    apiClient.get<Blob>(mediaUrl, { responseType: 'blob' })
      .then((response) => {
        if (cancelled) return;
        nextUrl = URL.createObjectURL(response.data);
        setObjectUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });

    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      if (nextPosterUrl) URL.revokeObjectURL(nextPosterUrl);
    };
  }, [mediaUrl, moment._id, moment.type]);

  if (unavailable) {
    return (
      <div className="flex min-h-[180px] items-center justify-center px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        This Moment media is unavailable.
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="flex min-h-[180px] items-center justify-center text-slate-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (moment.type === 'audio') {
    return (
      <div className="px-4 py-5">
        <audio src={objectUrl} controls preload="metadata" className="w-full" aria-label="Play or pause audio Moment" />
      </div>
    );
  }

  if (moment.type === 'video') {
    return (
      <video src={objectUrl} controls preload="metadata" poster={posterUrl || undefined} className="max-h-[460px] w-full bg-black object-contain" aria-label="Play or pause video Moment" />
    );
  }

  return <img src={objectUrl} alt={moment.caption || 'Moment photo'} className="max-h-[460px] w-full object-cover" />;
}

function CreateMomentModal({ onClose, onCreated, initialMode = 'text' }: { onClose: () => void; onCreated: () => void; initialMode?: 'text' | 'image' | 'video' | 'audio' }) {
  const [mode, setMode] = useState<'text' | 'image' | 'video' | 'audio'>(initialMode);
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [backgroundKey, setBackgroundKey] = useState('teal');
  const [audienceType, setAudienceType] = useState('contacts');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<'idle' | 'uploading' | 'processing' | 'ready' | 'failed'>('idle');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioTimerRef = useRef<number | null>(null);
  const upload = useFileUpload();

  const contacts = useQuery({
    queryKey: ['moment-contacts'],
    queryFn: async () => (await apiClient.get<{ contacts: MomentUser[] }>('/api/moments/contacts')).data.contacts,
  });

  const prepareVideoMoment = async (file: File) => {
    if ((file.type || 'video/mp4') !== 'video/mp4' || !file.name.toLowerCase().endsWith('.mp4')) {
      throw new Error('Choose a supported MP4 video.');
    }
    setVideoError(null);
    setVideoState('uploading');
    const init = await initiateMomentVideoUpload({
      fileName: file.name,
      fileType: file.type || 'video/mp4',
      fileSize: file.size,
    });
    await uploadMomentVideoSource(init.uploadUrl, file);
    setVideoState('processing');
    const startedAt = Date.now();
    while (Date.now() - startedAt < VIDEO_PROCESSING_TIMEOUT_MS) {
      const status = await fetchMomentVideoStatus(init.videoId);
      if (status.video.processingStatus === 'ready') {
        setVideoState('ready');
        return init.videoId;
      }
      if (status.video.processingStatus === 'failed' || status.video.processingStatus === 'rejected' || status.video.processingStatus === 'deleted') {
        throw new Error('This video could not be posted. Try another video.');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    throw new Error('This video could not be posted. Try another video.');
  };

  const createMoment = useMutation({
    mutationFn: async () => {
      let mediaId: string | undefined;
      let videoId: string | undefined;
      if (mode === 'image') {
        if (!photo) throw new Error('Choose a photo.');
        const result = await upload.uploadMedia?.(photo);
        if (!result?.mediaId) throw new Error('Photo upload failed.');
        mediaId = result.mediaId;
      } else if (mode === 'audio') {
        if (!audioBlob) throw new Error('Record audio.');
        const audioType = audioBlob.type && audioBlob.type.startsWith('audio/') ? audioBlob.type : 'audio/webm';
        const extension = audioType.includes('mp4') || audioType.includes('m4a')
          ? 'm4a'
          : audioType.includes('ogg')
            ? 'ogg'
            : audioType.includes('wav')
              ? 'wav'
              : 'webm';
        const audioFile = new File([audioBlob], `moment-audio-${Date.now()}.${extension}`, { type: audioType });
        const result = await upload.uploadMedia?.(audioFile);
        if (!result?.mediaId) throw new Error('Audio upload failed.');
        mediaId = result.mediaId;
      } else if (mode === 'video') {
        if (!videoFile) throw new Error('Choose a video.');
        videoId = await prepareVideoMoment(videoFile);
      }
      await apiClient.post('/api/moments', {
        type: mode,
        textBody: mode === 'text' ? text.trim() : undefined,
        caption: mode === 'image' || mode === 'audio' || mode === 'video' ? caption.trim() : undefined,
        mediaId,
        videoId,
        style: { backgroundKey, textStyleKey: 'classic' },
        audienceType,
        selectedUserIds,
      });
    },
    onSuccess: onCreated,
    onError: (error) => {
      if (mode === 'video') {
        setVideoState('failed');
        setVideoError(error instanceof Error ? error.message : 'This video could not be posted. Try another video.');
      }
    },
  });

  const toggleSelected = (id: string) => setSelectedUserIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const needsSelection = audienceType === 'contacts_except' || audienceType === 'only_share_with';
  const canSubmit = mode === 'text' ? Boolean(text.trim()) : mode === 'image' ? Boolean(photo) : mode === 'audio' ? Boolean(audioBlob) : Boolean(videoFile);

  const clearPhoto = () => {
    setPhoto(null);
    setPhotoPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const setPhotoFile = (file: File | null) => {
    clearPhoto();
    if (!file) return;
    setPhoto(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const clearVideo = () => {
    setVideoFile(null);
    setVideoState('idle');
    setVideoError(null);
    setVideoPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (videoFileRef.current) videoFileRef.current.value = '';
  };

  const setMomentVideoFile = (file: File | null) => {
    clearVideo();
    if (!file) return;
    if ((file.type || 'video/mp4') !== 'video/mp4' || !file.name.toLowerCase().endsWith('.mp4')) {
      setVideoState('failed');
      setVideoError('This video could not be posted. Try another video.');
      return;
    }
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
  };

  const stopAudioTracks = () => {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
  };

  const clearAudioTimer = () => {
    if (audioTimerRef.current !== null) {
      window.clearInterval(audioTimerRef.current);
      audioTimerRef.current = null;
    }
  };

  const clearAudio = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    stopAudioTracks();
    clearAudioTimer();
    setIsRecordingAudio(false);
    setAudioBlob(null);
    setAudioDuration(0);
    setAudioUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  };

  useEffect(() => {
    return () => {
      clearPhoto();
      clearVideo();
      clearAudio();
    };
  }, []);

  const closeModal = () => {
    clearPhoto();
    clearVideo();
    clearAudio();
    onClose();
  };

  const startAudioRecording = async () => {
    setAudioError(null);
    clearAudio();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setAudioError('Audio recording is unavailable in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
      const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(blob);
        });
        setIsRecordingAudio(false);
        stopAudioTracks();
        clearAudioTimer();
      };
      mediaRecorderRef.current = recorder;
      setAudioDuration(0);
      setIsRecordingAudio(true);
      audioTimerRef.current = window.setInterval(() => setAudioDuration((value) => value + 1), 1000);
      recorder.start();
    } catch {
      stopAudioTracks();
      clearAudioTimer();
      setIsRecordingAudio(false);
      setAudioError('Audio recording is unavailable in this browser.');
    }
  };

  const stopAudioRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  };

  const formatAudioDuration = (value: number) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;

  const privacyHelp: Record<string, string> = {
    contacts: 'Only your contacts can view this Moment.',
    contacts_except: 'Your contacts can view this Moment, except the people you exclude.',
    only_share_with: 'Only the people you select can view this Moment.',
    close_friends: 'Only your Close Friends can view this Moment.',
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        className="max-h-[90vh] w-full max-w-[540px] overflow-y-auto rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)]"
        style={{ boxShadow: 'var(--bl-glow-md), 0 24px 60px -12px rgba(2, 20, 18, 0.45)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[color:var(--bl-border)] p-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex-shrink-0">
              <BlabberMark size={44} variant="icon" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-[color:var(--bl-text)]">Create Moment</h2>
              <p className="text-sm text-[color:var(--bl-text-muted)]">Moments expire after 24 hours.</p>
            </div>
          </div>
          <button
            onClick={closeModal}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[color:var(--bl-border)] text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] hover:text-[color:var(--bl-text)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Type selector — segmented control */}
          <div className="grid grid-cols-4 gap-1 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] p-1">
            {[
              { id: 'text', label: 'Text', icon: Type },
              { id: 'image', label: 'Photo', icon: ImageIcon },
              { id: 'video', label: 'Video', icon: Video },
              { id: 'audio', label: 'Audio', icon: Volume2 },
            ].map((item) => {
              const Icon = item.icon;
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setMode(item.id as typeof mode)}
                  aria-pressed={active}
                  className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition ${
                    active
                      ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950'
                      : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-panel)]'
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {mode === 'text' ? (
            <>
              <div>
                <p className="mb-2 text-sm font-medium text-[color:var(--bl-text-secondary)]">Choose a color</p>
                <div className="flex flex-wrap gap-2.5">
                  {Object.entries(backgroundStyles).map(([key, value]) => (
                    <button
                      key={key}
                      onClick={() => setBackgroundKey(key)}
                      className={`h-8 w-8 rounded-full border border-white/70 transition ${
                        backgroundKey === key
                          ? 'scale-110 ring-2 ring-teal-500 ring-offset-2 ring-offset-[color:var(--bl-panel)] shadow-[0_0_12px_rgba(45,212,191,0.4)]'
                          : 'shadow-sm hover:scale-105'
                      }`}
                      style={{ backgroundColor: value }}
                      aria-label={`${key} Moment background`}
                      aria-pressed={backgroundKey === key}
                    />
                  ))}
                </div>
              </div>
              <div className="relative">
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value.slice(0, MAX_LENGTH))}
                  placeholder="What should your contacts know?"
                  className="min-h-[200px] w-full resize-none rounded-2xl border border-teal-500/40 bg-[color:var(--bl-hover)] p-5 pb-10 text-center text-xl font-semibold text-[color:var(--bl-text)] outline-none transition placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400 focus:[box-shadow:var(--bl-glow-sm)]"
                  maxLength={MAX_LENGTH}
                />
                <span className="pointer-events-none absolute bottom-3.5 right-4 text-xs text-[color:var(--bl-text-muted)]" aria-live="polite">
                  {text.length} / {MAX_LENGTH}
                </span>
              </div>
            </>
          ) : mode === 'image' ? (
            <>
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.jpe,.jfif,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={(event) => setPhotoFile(event.target.files?.[0] || null)} />
              <div className="grid gap-2 sm:grid-cols-2">
                <button onClick={() => fileRef.current?.click()} className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-[color:var(--bl-border)] px-4 py-6 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:border-teal-400 hover:bg-[color:var(--bl-hover)] hover:text-teal-700 dark:hover:text-teal-300"><ImageIcon size={18} />Choose photo</button>
                <button onClick={() => setShowCamera(true)} className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-[color:var(--bl-border)] px-4 py-6 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:border-teal-400 hover:bg-[color:var(--bl-hover)] hover:text-teal-700 dark:hover:text-teal-300"><Camera size={18} />Use camera</button>
              </div>
              {photoPreviewUrl && (
                <div className="overflow-hidden rounded-2xl border border-[color:var(--bl-border)]">
                  <img src={photoPreviewUrl} alt="Moment photo preview" className="max-h-72 w-full object-contain bg-slate-950" />
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-[color:var(--bl-text-muted)]">
                    <span className="min-w-0 truncate">{photo?.name}</span>
                    <button type="button" onClick={clearPhoto} className="font-semibold text-rose-600 dark:text-rose-300">Remove</button>
                  </div>
                </div>
              )}
              <textarea value={caption} onChange={(event) => setCaption(event.target.value.slice(0, MAX_LENGTH))} placeholder="Add a caption" className="min-h-[90px] w-full resize-none rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] p-3 text-sm text-[color:var(--bl-text)] outline-none placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400" maxLength={MAX_LENGTH} />
            </>
          ) : mode === 'audio' ? (
            <>
              <div className="rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[color:var(--bl-text)]">Record audio</p>
                    <p className="text-xs text-[color:var(--bl-text-muted)]">{isRecordingAudio ? `Recording ${formatAudioDuration(audioDuration)}` : audioBlob ? `Preview ${formatAudioDuration(audioDuration)}` : 'Start when you are ready.'}</p>
                  </div>
                  {isRecordingAudio ? (
                    <button type="button" onClick={stopAudioRecording} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"><Square size={14} />Stop</button>
                  ) : (
                    <button type="button" onClick={startAudioRecording} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"><Mic size={15} />Record</button>
                  )}
                </div>
                {audioUrl && <audio src={audioUrl} controls preload="metadata" className="mt-4 w-full" aria-label="Play or pause audio Moment preview" />}
                {(audioBlob || isRecordingAudio) && <button type="button" onClick={clearAudio} className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-300">Cancel audio</button>}
                {audioError && <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{audioError}</p>}
              </div>
              <textarea value={caption} onChange={(event) => setCaption(event.target.value.slice(0, MAX_LENGTH))} placeholder="Add a caption" className="min-h-[90px] w-full resize-none rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] p-3 text-sm text-[color:var(--bl-text)] outline-none placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400" maxLength={MAX_LENGTH} />
            </>
          ) : (
            <>
              <input ref={videoFileRef} type="file" accept="video/mp4,.mp4" className="hidden" onChange={(event) => setMomentVideoFile(event.target.files?.[0] || null)} />
              <button type="button" onClick={() => videoFileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[color:var(--bl-border)] px-4 py-6 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:border-teal-400 hover:bg-[color:var(--bl-hover)] hover:text-teal-700 dark:hover:text-teal-300"><Video size={18} />Choose video</button>
              {videoPreviewUrl && (
                <div className="overflow-hidden rounded-2xl border border-[color:var(--bl-border)]">
                  <video src={videoPreviewUrl} controls preload="metadata" className="max-h-72 w-full bg-black object-contain" aria-label="Play or pause video Moment preview" />
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-[color:var(--bl-text-muted)]">
                    <span className="min-w-0 truncate">{videoFile?.name}</span>
                    <button type="button" onClick={clearVideo} className="font-semibold text-rose-600 dark:text-rose-300">Remove</button>
                  </div>
                </div>
              )}
              {(videoState === 'uploading' || videoState === 'processing') && (
                <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-200">
                  <Loader2 size={16} className="animate-spin" />
                  Preparing your video Moment...
                </div>
              )}
              {videoError && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">This video could not be posted. Try another video.</p>}
              <textarea value={caption} onChange={(event) => setCaption(event.target.value.slice(0, MAX_LENGTH))} placeholder="Add a caption" className="min-h-[90px] w-full resize-none rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] p-3 text-sm text-[color:var(--bl-text)] outline-none placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400" maxLength={MAX_LENGTH} />
            </>
          )}

          {/* Privacy */}
          <div>
            <label htmlFor="moment-privacy" className="mb-1.5 block text-sm font-medium text-[color:var(--bl-text)]">Moment privacy</label>
            <div className="relative">
              <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--bl-text-muted)]" aria-hidden="true" />
              <select
                id="moment-privacy"
                value={audienceType}
                onChange={(event) => { setAudienceType(event.target.value); setSelectedUserIds([]); }}
                className="w-full appearance-none rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] py-2.5 pl-10 pr-10 text-sm text-[color:var(--bl-text)] outline-none transition focus:border-teal-400"
              >
                <option value="contacts">Contacts</option>
                <option value="contacts_except">Contacts except...</option>
                <option value="only_share_with">Only share with...</option>
                <option value="close_friends">Close Friends Moments</option>
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[color:var(--bl-text-muted)]" aria-hidden="true" />
            </div>
            <p className="mt-1.5 text-xs text-[color:var(--bl-text-muted)]">{privacyHelp[audienceType] || privacyHelp.contacts}</p>
          </div>
          {needsSelection && (
            <div className="max-h-36 overflow-y-auto rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] p-2">
              {contacts.data?.map((contact) => (
                <label key={contact._id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-[color:var(--bl-text)] transition hover:bg-[color:var(--bl-panel)]">
                  <input type="checkbox" checked={selectedUserIds.includes(contact._id)} onChange={() => toggleSelected(contact._id)} className="h-4 w-4 rounded accent-teal-600" />
                  {contact.name}
                </label>
              ))}
            </div>
          )}
          {createMoment.isError && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">Could not create the Moment.</p>}
          {upload.error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{upload.error}</p>}

          {/* Footer */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button
              onClick={closeModal}
              className="flex-1 rounded-xl border border-[color:var(--bl-border)] px-4 py-2.5 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
            >
              Cancel
            </button>
            <button
              onClick={() => createMoment.mutate()}
              disabled={!canSubmit || createMoment.isPending || upload.isUploading}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-teal-600 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 dark:disabled:hover:bg-teal-500"
              style={!canSubmit || createMoment.isPending || upload.isUploading ? undefined : { boxShadow: 'var(--bl-glow-sm)' }}
            >
              {createMoment.isPending || upload.isUploading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Post Moment
            </button>
          </div>
        </div>
      </div>
      <CameraModal
        isOpen={showCamera}
        confirmLabel="Use Photo"
        onClose={() => setShowCamera(false)}
        onCapture={(file) => {
          setPhotoFile(file);
          setShowCamera(false);
        }}
      />
    </div>
  );
}

function ViewerModal({ moment, interactions, isLoading, onClose }: { moment: Moment; interactions: MomentInteraction[]; isLoading: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[color:var(--bl-border)] p-4">
          <h2 className="text-lg font-semibold text-[color:var(--bl-text)]">Moment interactions</h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)]" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-4">
          {isLoading ? <Loader2 className="animate-spin text-teal-600 dark:text-teal-300" size={20} /> : interactions.length === 0 ? <p className="text-sm text-[color:var(--bl-text-muted)]">No interactions yet.</p> : interactions.map((item) => (
            <div key={`${moment._id}-${item.viewer._id}`} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar src={item.viewer.avatarUrl || undefined} alt={item.viewer.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[color:var(--bl-text)]">{item.viewer.name}</p>
                  <p className="text-xs text-[color:var(--bl-text-muted)]">{item.viewedAt ? new Date(item.viewedAt).toLocaleString() : 'Reacted'}</p>
                </div>
              </div>
              {item.reaction && <span className="text-lg" aria-label="Reaction">{item.reaction.emoji}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return <div className="rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-8 text-center"><Loader2 className="mx-auto animate-spin text-teal-600 dark:text-teal-300" size={28} /><p className="mt-3 text-sm font-medium text-[color:var(--bl-text-secondary)]">Loading Moments...</p></div>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-900/60 dark:bg-rose-950/30"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 flex-shrink-0 text-rose-600 dark:text-rose-300" size={20} /><div><p className="text-sm font-semibold text-rose-900 dark:text-rose-100">Unable to load Moments</p><p className="mt-1 text-sm text-rose-700 dark:text-rose-200">Check your connection and try again.</p><button onClick={onRetry} className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-800">Try again</button></div></div></div>;
}

function EmptyState({ showArchive }: { showArchive: boolean }) {
  return <div className="rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-6 py-12 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"><CircleDashed size={26} /></div><h3 className="mt-4 text-lg font-semibold text-[color:var(--bl-text)]">{showArchive ? 'No archived Moments' : 'No Recent Moments'}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--bl-text-muted)]">{showArchive ? 'Expired Moments appear here when Moment archive is enabled.' : 'Share text, a photo, a video, or audio with the people you choose.'}</p></div>;
}
