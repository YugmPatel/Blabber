import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CircleDashed, Eye, Image as ImageIcon, Loader2, Menu, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { apiClient } from '@/api/client';
import Avatar from '@/components/Avatar';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useTheme } from '@/hooks/useTheme';

interface MomentUser { _id: string; name: string; avatarUrl?: string | null }
interface Moment {
  _id: string;
  author: MomentUser;
  type: 'text' | 'image';
  textBody?: string;
  caption?: string;
  mediaUrl?: string | null;
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

  const openCreateMoment = () => {
    setShowCreateModal(true);
    setShowSidebar(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f5f7] text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${showSidebar ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`} onClick={() => setShowSidebar(false)} aria-hidden="true" />
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${showSidebar ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} onNewConversation={() => navigate('/chats')} onChatFilterChange={() => navigate('/chats')} onNavigateMobile={() => setShowSidebar(false)} taskCount={0} />
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto bg-white dark:bg-slate-900">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button onClick={() => setShowSidebar(true)} className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden" aria-label="Open navigation">
                <Menu size={16} />
              </button>
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                <CircleDashed size={20} />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-slate-950 dark:text-white">Moments</h1>
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">Moments expire after 24 hours.</p>
              </div>
            </div>
            <button onClick={openCreateMoment} className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100">
              <Plus size={16} />
              <span className="hidden sm:inline">Create Moment</span>
              <span className="sm:hidden">Create</span>
            </button>
          </div>
        </header>

        <div className="mx-auto grid max-w-5xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center gap-3">
                <Avatar src={(user as any)?.avatarUrl || user?.avatar} alt={user?.name || user?.username || 'You'} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">Your Moment</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Share text or a photo.</p>
                </div>
              </div>
              <button onClick={openCreateMoment} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800">
                <Send size={15} />
                Create Moment
              </button>
            </section>
            <section className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
              <button onClick={() => navigate('/moments')} className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium ${!showArchive ? 'bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200' : 'text-slate-600 dark:text-slate-300'}`}>Recent Moments</button>
              <button onClick={() => navigate('/moments/archive')} className={`mt-1 w-full rounded-md px-3 py-2 text-left text-sm font-medium ${showArchive ? 'bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200' : 'text-slate-600 dark:text-slate-300'}`}>Moment archive</button>
            </section>
          </aside>

          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">{showArchive ? 'Moment archive' : 'Recent Moments'}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{visibleMoments.length === 1 ? '1 Moment' : `${visibleMoments.length} Moments`}</p>
              </div>
              <button onClick={() => (showArchive ? archive.refetch() : feed.refetch())} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Refresh Moments">
                <RefreshCw size={15} className={(feed.isFetching || archive.isFetching) ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
            {(feed.isLoading || (showArchive && archive.isLoading)) ? <LoadingState /> : feed.isError || archive.isError ? <ErrorState onRetry={() => (showArchive ? archive.refetch() : feed.refetch())} /> : visibleMoments.length === 0 ? <EmptyState onCreate={openCreateMoment} showArchive={showArchive} /> : (
              <ul className="space-y-3">
                {visibleMoments.map((moment) => (
                  <MomentItem key={moment._id} moment={moment} now={now} isOwner={moment.author._id === user?._id} isDeleting={deleteMoment.isPending && deleteMoment.variables === moment._id} onDelete={() => deleteMoment.mutate(moment._id)} onViewers={() => setViewerMoment(moment)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      {showCreateModal && <CreateMomentModal onClose={() => setShowCreateModal(false)} onCreated={() => { setShowCreateModal(false); queryClient.invalidateQueries({ queryKey: ['moments-feed'] }); }} />}
      {viewerMoment && (
        <ViewerModal moment={viewerMoment} interactions={interactions.data ?? []} isLoading={interactions.isLoading} onClose={() => setViewerMoment(null)} />
      )}
    </div>
  );
}

function MomentItem({ moment, now, isOwner, isDeleting, onDelete, onViewers }: { moment: Moment; now: number; isOwner: boolean; isDeleting: boolean; onDelete: () => void; onViewers: () => void }) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState('');
  const background = backgroundStyles[moment.style?.backgroundKey || 'teal'] || backgroundStyles.teal;
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
  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-3 p-4">
        <Avatar src={moment.author.avatarUrl || undefined} alt={moment.author.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{moment.author.name}</p>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>{formatCreatedAt(moment.createdAt, now)}</span>
            <span aria-hidden="true">-</span>
            <span>{moment.archiveState === 'archived' ? 'Archived' : formatRemaining(moment.expiresAt, now)}</span>
          </div>
        </div>
        {isOwner && <button onClick={onViewers} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Moment viewers" title="Moment viewers"><Eye size={16} /></button>}
        {isOwner && <button onClick={onDelete} disabled={isDeleting} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60 dark:hover:bg-rose-950/30" aria-label="Delete Moment" title="Delete Moment">{isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}</button>}
      </div>
      {moment.type === 'image' && moment.mediaUrl ? (
        <div className="border-t border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
          <img src={moment.mediaUrl} alt={moment.caption || 'Moment photo'} className="max-h-[460px] w-full object-cover" />
          {moment.caption && <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">{moment.caption}</p>}
        </div>
      ) : (
        <div className="px-4 pb-4">
          <div className="flex min-h-[150px] items-center justify-center rounded-lg px-5 py-8 text-center" style={{ backgroundColor: background }}>
            <p className="max-w-xl whitespace-pre-wrap break-words text-xl font-semibold leading-8 text-white">{moment.textBody}</p>
          </div>
        </div>
      )}
      {!isOwner && moment.archiveState === 'active' && (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex flex-wrap gap-2">
            {MOMENT_REACTIONS.map((emoji) => {
              const selected = moment.myReaction === emoji;
              return (
                <button
                  key={emoji}
                  onClick={() => setReaction.mutate(emoji)}
                  disabled={setReaction.isPending}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition ${
                    selected
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/30'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                  } disabled:opacity-60`}
                  aria-label={`React ${emoji}`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={replyText}
              onChange={(event) => setReplyText(event.target.value.slice(0, REPLY_MAX_LENGTH))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && canReply) {
                  event.preventDefault();
                  sendReply.mutate();
                }
              }}
              placeholder="Reply privately"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              onClick={() => sendReply.mutate()}
              disabled={!canReply}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-white dark:text-slate-950"
              aria-label="Reply to Moment"
            >
              {sendReply.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          {(setReaction.isError || sendReply.isError) && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">This Moment interaction is unavailable.</p>}
        </div>
      )}
    </li>
  );
}

function CreateMomentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [backgroundKey, setBackgroundKey] = useState('teal');
  const [audienceType, setAudienceType] = useState('contacts');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useFileUpload();

  const contacts = useQuery({
    queryKey: ['moment-contacts'],
    queryFn: async () => (await apiClient.get<{ contacts: MomentUser[] }>('/api/moments/contacts')).data.contacts,
  });

  const createMoment = useMutation({
    mutationFn: async () => {
      let mediaId: string | undefined;
      if (mode === 'image') {
        if (!photo) throw new Error('Choose a photo.');
        const result = await upload.uploadMedia?.(photo);
        if (!result?.mediaId) throw new Error('Photo upload failed.');
        mediaId = result.mediaId;
      }
      await apiClient.post('/api/moments', {
        type: mode,
        textBody: mode === 'text' ? text.trim() : undefined,
        caption: mode === 'image' ? caption.trim() : undefined,
        mediaId,
        style: { backgroundKey, textStyleKey: 'classic' },
        audienceType,
        selectedUserIds,
      });
    },
    onSuccess: onCreated,
  });

  const toggleSelected = (id: string) => setSelectedUserIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const needsSelection = audienceType === 'contacts_except' || audienceType === 'only_share_with';
  const canSubmit = mode === 'text' ? Boolean(text.trim()) : Boolean(photo);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Create Moment</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Text and photo Moments expire after 24 hours.</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('text')} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === 'text' ? 'border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-100' : 'border-slate-200 dark:border-slate-700'}`}>Text</button>
            <button onClick={() => setMode('image')} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === 'image' ? 'border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-100' : 'border-slate-200 dark:border-slate-700'}`}>Photo</button>
          </div>
          {mode === 'text' ? (
            <>
              <div className="flex flex-wrap gap-2">{Object.entries(backgroundStyles).map(([key, value]) => <button key={key} onClick={() => setBackgroundKey(key)} className={`h-8 w-8 rounded-full border border-white shadow-sm ${backgroundKey === key ? 'ring-2 ring-teal-500 ring-offset-2 dark:ring-offset-slate-900' : ''}`} style={{ backgroundColor: value }} aria-label={`${key} Moment background`} />)}</div>
              <textarea value={text} onChange={(event) => setText(event.target.value.slice(0, MAX_LENGTH))} placeholder="What should your contacts know?" className="min-h-[180px] w-full resize-none rounded-lg border border-slate-200 p-4 text-center text-xl font-semibold outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-950" maxLength={MAX_LENGTH} />
              <p className="text-right text-xs text-slate-500">{MAX_LENGTH - text.length} characters left</p>
            </>
          ) : (
            <>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => setPhoto(event.target.files?.[0] || null)} />
              <button onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"><ImageIcon size={18} />{photo ? photo.name : 'Choose photo'}</button>
              <textarea value={caption} onChange={(event) => setCaption(event.target.value.slice(0, MAX_LENGTH))} placeholder="Add a caption" className="min-h-[90px] w-full resize-none rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-950" maxLength={MAX_LENGTH} />
            </>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Moment privacy</label>
            <select value={audienceType} onChange={(event) => { setAudienceType(event.target.value); setSelectedUserIds([]); }} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
              <option value="contacts">Contacts</option>
              <option value="contacts_except">Contacts except...</option>
              <option value="only_share_with">Only share with...</option>
              <option value="close_friends">Close Friends Moments</option>
            </select>
          </div>
          {needsSelection && <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">{contacts.data?.map((contact) => <label key={contact._id} className="flex items-center gap-2 px-2 py-1.5 text-sm"><input type="checkbox" checked={selectedUserIds.includes(contact._id)} onChange={() => toggleSelected(contact._id)} />{contact.name}</label>)}</div>}
          {createMoment.isError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">Could not create the Moment.</p>}
          {upload.error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{upload.error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
            <button onClick={() => createMoment.mutate()} disabled={!canSubmit || createMoment.isPending || upload.isUploading} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300">{createMoment.isPending || upload.isUploading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}Post Moment</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ViewerModal({ moment, interactions, isLoading, onClose }: { moment: Moment; interactions: MomentInteraction[]; isLoading: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Moment interactions</h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-4">
          {isLoading ? <Loader2 className="animate-spin text-teal-600" size={20} /> : interactions.length === 0 ? <p className="text-sm text-slate-500">No interactions yet.</p> : interactions.map((item) => (
            <div key={`${moment._id}-${item.viewer._id}`} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar src={item.viewer.avatarUrl || undefined} alt={item.viewer.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{item.viewer.name}</p>
                  <p className="text-xs text-slate-500">{item.viewedAt ? new Date(item.viewedAt).toLocaleString() : 'Reacted'}</p>
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
  return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900"><Loader2 className="mx-auto animate-spin text-teal-600 dark:text-teal-300" size={28} /><p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">Loading Moments...</p></div>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 dark:border-rose-900/60 dark:bg-rose-950/30"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 flex-shrink-0 text-rose-600 dark:text-rose-300" size={20} /><div><p className="text-sm font-semibold text-rose-900 dark:text-rose-100">Unable to load Moments</p><p className="mt-1 text-sm text-rose-700 dark:text-rose-200">Check your connection and try again.</p><button onClick={onRetry} className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-800">Try again</button></div></div></div>;
}

function EmptyState({ onCreate, showArchive }: { onCreate: () => void; showArchive: boolean }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"><CircleDashed size={26} /></div><h3 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">{showArchive ? 'No archived Moments' : 'No Recent Moments'}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{showArchive ? 'Expired Moments appear here when Moment archive is enabled.' : 'Share text or a photo with the people you choose.'}</p>{!showArchive && <button onClick={onCreate} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"><Plus size={16} />Create Moment</button>}</div>;
}
