import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CircleDashed,
  Image as ImageIcon,
  Loader2,
  Menu,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiClient, normalizeMediaUrl } from '@/api/client';
import Avatar from '@/components/Avatar';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/useTheme';

interface Status {
  _id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  type: 'text' | 'image';
  content: string;
  backgroundColor?: string;
  mediaUrl?: string;
  createdAt: string;
  expiresAt: string;
}

const statusColors = ['#0f766e', '#2563eb', '#7c3aed', '#be123c', '#b45309', '#334155'];
const MAX_STATUS_LENGTH = 500;

function isExpired(status: Status, now: number) {
  return new Date(status.expiresAt).getTime() <= now;
}

function isTomorrow(date: Date, now: Date) {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  );
}

function formatCreatedAt(value: string, nowMs: number) {
  const date = new Date(value);
  const diffMs = Math.max(0, nowMs - date.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatRemaining(value: string, nowMs: number) {
  const expires = new Date(value);
  const diffMs = expires.getTime() - nowMs;
  if (diffMs <= 0) return 'Expired';

  const minutes = Math.ceil(diffMs / 60_000);
  const hours = Math.ceil(diffMs / 3_600_000);
  const now = new Date(nowMs);

  if (minutes <= 1) return 'Expires in 1m';
  if (minutes < 60) return `Expires in ${minutes}m`;
  if (hours < 12) return `Expires in ${hours}h`;
  if (isTomorrow(expires, now)) return 'Expires tomorrow';
  if (hours < 24) return `Expires in ${hours}h`;
  return `Expires ${expires.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function getAuthorName(status: Status) {
  return status.userName || 'User';
}

export default function StatusPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newStatusText, setNewStatusText] = useState('');
  const [selectedColor, setSelectedColor] = useState(statusColors[0]);
  const [now, setNow] = useState(() => Date.now());

  useTheme();

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['statuses'],
    queryFn: async () => {
      const response = await apiClient.get<{ statuses: Status[] }>('/api/users/statuses');
      return response.data.statuses;
    },
    refetchInterval: 60_000,
  });

  const activeStatuses = useMemo(() => {
    return (data ?? [])
      .filter((status) => !isExpired(status, now))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [data, now]);

  useEffect(() => {
    if (activeStatuses.length === 0) return;

    const nextExpiry = Math.min(...activeStatuses.map((status) => new Date(status.expiresAt).getTime()));
    const delay = Math.max(250, nextExpiry - Date.now() + 250);
    const timeout = window.setTimeout(() => {
      setNow(Date.now());
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [activeStatuses, queryClient]);

  const createStatus = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<{ status: Status }>('/api/users/statuses', {
        type: 'text',
        content: newStatusText.trim(),
        backgroundColor: selectedColor,
      });
      return response.data.status;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
      setShowCreateModal(false);
      setNewStatusText('');
      setSelectedColor(statusColors[0]);
    },
  });

  const deleteStatus = useMutation({
    mutationFn: async (statusId: string) => {
      await apiClient.delete(`/api/users/statuses/${statusId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
    },
  });

  const openCreateStatus = () => {
    setShowCreateModal(true);
    setShowSidebar(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f5f7] text-slate-900 dark:bg-slate-950 dark:text-white">
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
          showSidebar ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setShowSidebar(false)}
        aria-hidden="true"
      />

      <div
        className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${
          showSidebar ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ height: '100%' }}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
          onNewConversation={() => navigate('/chats')}
          onChatFilterChange={() => navigate('/chats')}
          onNavigateMobile={() => setShowSidebar(false)}
          taskCount={0}
        />
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto bg-white dark:bg-slate-900">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setShowSidebar(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden"
                aria-label="Open navigation"
              >
                <Menu size={16} />
              </button>
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                <CircleDashed size={20} />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-slate-950 dark:text-white">Status</h1>
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                  Short-lived updates from your workspace
                </p>
              </div>
            </div>

            <button
              onClick={openCreateStatus}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-300 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Create Status</span>
              <span className="sm:hidden">Create</span>
            </button>
          </div>
        </header>

        <div className="mx-auto grid max-w-5xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Avatar
                    src={(user as any)?.avatarUrl || user?.avatar}
                    alt={user?.name || user?.username || 'You'}
                    size="lg"
                  />
                  <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-slate-50 bg-teal-600 text-white dark:border-slate-800">
                    <Plus size={13} strokeWidth={2.5} />
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">My Status</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Share an update for 24 hours</p>
                </div>
              </div>
              <button
                onClick={openCreateStatus}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:bg-slate-300"
              >
                <Send size={15} />
                Create text status
              </button>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-sm font-semibold text-slate-950 dark:text-white">How Status Works</p>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                Status updates are visible to signed-in workspace members, expire after 24 hours, and
                disappear automatically when their time is up.
              </p>
            </section>
          </aside>

          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">Active statuses</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {activeStatuses.length === 1
                    ? '1 update is live'
                    : `${activeStatuses.length} updates are live`}
                </p>
              </div>
              <button
                onClick={() => refetch()}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Refresh statuses"
              >
                <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>

            {isLoading ? (
              <LoadingState />
            ) : isError ? (
              <ErrorState onRetry={() => refetch()} />
            ) : activeStatuses.length === 0 ? (
              <EmptyState onCreate={openCreateStatus} />
            ) : (
              <ul className="space-y-3">
                {activeStatuses.map((status) => (
                  <StatusItem
                    key={status._id}
                    status={status}
                    now={now}
                    isOwner={status.userId === user?._id}
                    isDeleting={deleteStatus.isPending && deleteStatus.variables === status._id}
                    onDelete={() => deleteStatus.mutate(status._id)}
                  />
                ))}
              </ul>
            )}

            {deleteStatus.isError && (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                Unable to delete that status. Only the owner can remove it.
              </p>
            )}
          </section>
        </div>
      </main>

      {showCreateModal && (
        <CreateStatusModal
          text={newStatusText}
          selectedColor={selectedColor}
          isPending={createStatus.isPending}
          isError={createStatus.isError}
          onTextChange={setNewStatusText}
          onColorChange={setSelectedColor}
          onClose={() => setShowCreateModal(false)}
          onSubmit={() => createStatus.mutate()}
        />
      )}
    </div>
  );
}

function StatusItem({
  status,
  now,
  isOwner,
  isDeleting,
  onDelete,
}: {
  status: Status;
  now: number;
  isOwner: boolean;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const author = getAuthorName(status);
  const mediaUrl = normalizeMediaUrl(status.mediaUrl);

  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-3 p-4">
        <Avatar src={status.userAvatar} alt={author} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{author}</p>
            {isOwner && (
              <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                You
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>{formatCreatedAt(status.createdAt, now)}</span>
            <span aria-hidden="true">-</span>
            <span>{formatRemaining(status.expiresAt, now)}</span>
          </div>
        </div>

        {isOwner && (
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-rose-950/30"
            aria-label="Delete status"
            title="Delete status"
          >
            {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        )}
      </div>

      {status.type === 'image' && mediaUrl ? (
        <div className="border-t border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
          <img src={mediaUrl} alt={status.content || 'Status image'} className="max-h-[460px] w-full object-cover" />
          {status.content && (
            <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
              {status.content}
            </p>
          )}
        </div>
      ) : (
        <div className="px-4 pb-4">
          <div
            className="flex min-h-[150px] items-center justify-center rounded-lg px-5 py-8 text-center"
            style={{ backgroundColor: status.backgroundColor || '#0f766e' }}
          >
            <p className="max-w-xl whitespace-pre-wrap break-words text-xl font-semibold leading-8 text-white">
              {status.content}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

function LoadingState() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <Loader2 className="mx-auto animate-spin text-teal-600 dark:text-teal-300" size={28} />
      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">Loading statuses...</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 dark:border-rose-900/60 dark:bg-rose-950/30">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 flex-shrink-0 text-rose-600 dark:text-rose-300" size={20} />
        <div>
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">Unable to load statuses</p>
          <p className="mt-1 text-sm text-rose-700 dark:text-rose-200">
            Check your connection and try again.
          </p>
          <button
            onClick={onRetry}
            className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-800"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
        <CircleDashed size={26} />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">No active statuses yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
        Status updates are short-lived workspace notes. Share what you are working on, where a
        decision stands, or what people should know for the next 24 hours.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
      >
        <Plus size={16} />
        Create Status
      </button>
    </div>
  );
}

function CreateStatusModal({
  text,
  selectedColor,
  isPending,
  isError,
  onTextChange,
  onColorChange,
  onClose,
  onSubmit,
}: {
  text: string;
  selectedColor: string;
  isPending: boolean;
  isError: boolean;
  onTextChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const remaining = MAX_STATUS_LENGTH - text.length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Create Status</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Text updates stay live for 24 hours.</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Background</p>
            <div className="flex flex-wrap gap-2">
              {statusColors.map((color) => (
                <button
                  key={color}
                  onClick={() => onColorChange(color)}
                  className={`h-8 w-8 rounded-full border border-white shadow-sm transition ${
                    selectedColor === color ? 'ring-2 ring-teal-500 ring-offset-2 dark:ring-offset-slate-900' : ''
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={`Use background ${color}`}
                />
              ))}
            </div>
          </div>

          <div
            className="flex min-h-[220px] flex-col rounded-lg p-4"
            style={{ backgroundColor: selectedColor }}
          >
            <textarea
              value={text}
              onChange={(event) => onTextChange(event.target.value.slice(0, MAX_STATUS_LENGTH))}
              placeholder="What should the workspace know?"
              className="min-h-[165px] flex-1 resize-none bg-transparent text-center text-2xl font-semibold leading-9 text-white outline-none placeholder:text-white/70"
              maxLength={MAX_STATUS_LENGTH}
            />
            <div className="flex items-center justify-between text-xs font-medium text-white/75">
              <span className="inline-flex items-center gap-1">
                <ImageIcon size={13} />
                Text status
              </span>
              <span>{remaining} characters left</span>
            </div>
          </div>

          {isError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              Could not create the status. Please try again.
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={!text.trim() || isPending}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Post Status
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
