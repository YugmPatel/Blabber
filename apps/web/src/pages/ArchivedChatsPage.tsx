import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ArchiveRestore, Loader2, Menu, Users } from 'lucide-react';
import type { Chat } from '@repo/types';
import Avatar from '@/components/Avatar';
import Sidebar from '@/components/Sidebar';
import BlabberMark from '@/components/brand/BlabberMark';
import { useAuth } from '@/contexts/AuthContext';
import { useUser } from '@/hooks/useUsers';
import { useChats, useUnarchiveChat } from '@/hooks/useChats';

function ArchivedChatCard({
  chat,
  onOpen,
  selectable,
  selected,
  onToggleSelect,
  onUnarchive,
  isUnarchivePending,
}: {
  chat: Chat;
  onOpen: () => void;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onUnarchive: () => void;
  isUnarchivePending: boolean;
}) {
  const { user: currentUser } = useAuth();
  const isDirectChat = chat.type === 'direct';
  const otherUserId = isDirectChat ? chat.participants.find((id) => id !== currentUser?._id) : undefined;
  const { data: otherUser } = useUser(otherUserId);

  const title = chat.type === 'group' ? chat.title || 'Unnamed Group' : otherUser?.name || 'User';
  const avatarUrl = chat.type === 'group' ? chat.avatarUrl : otherUser?.avatarUrl;
  const profileById = new Map((chat.participantProfiles || []).map((profile) => [profile._id, profile]));

  const latestPreview = () => {
    if (!chat.lastMessageRef) return 'No messages yet';
    const body = chat.lastMessageRef.body || 'Message';
    if (chat.type !== 'group') return body;
    const sender = profileById.get(chat.lastMessageRef.senderId);
    const senderName = sender?.name || sender?.username || sender?.email;
    return senderName ? `${senderName}: ${body}` : body;
  };

  const archivedLabel = (() => {
    if (!chat.archivedAt) return null;
    try {
      return formatDistanceToNow(new Date(chat.archivedAt), { addSuffix: true });
    } catch {
      return null;
    }
  })();

  return (
    <div className="group flex items-center gap-3 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-3 shadow-sm transition hover:[box-shadow:var(--bl-glow-sm)]">
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 flex-shrink-0 accent-teal-600"
          aria-label={`Select ${title}`}
        />
      )}
      <button
        type="button"
        onClick={selectable ? onToggleSelect : onOpen}
        className="bl-focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
      >
        {chat.type === 'group' && !avatarUrl ? (
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-teal-600 text-white">
            <Users size={18} />
          </div>
        ) : (
          <Avatar src={avatarUrl} alt={title} size="md" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-[color:var(--bl-text)]">{title}</p>
            <span className="flex-shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
              {chat.type === 'group' ? 'Group' : 'Direct'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-[color:var(--bl-text-muted)]">{latestPreview()}</p>
        </div>
      </button>
      <div className="flex flex-shrink-0 flex-col items-end gap-1 text-right">
        {archivedLabel && <span className="text-xs text-[color:var(--bl-text-muted)]">Archived {archivedLabel}</span>}
        {Boolean(chat.unreadCount) && (
          <span className="rounded-full bg-teal-500 px-2 py-0.5 text-[10px] font-bold text-white">{chat.unreadCount}</span>
        )}
      </div>
      {!selectable && (
        <button
          type="button"
          onClick={onUnarchive}
          disabled={isUnarchivePending}
          aria-label={`Unarchive ${title}`}
          title="Unarchive"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[color:var(--bl-text-muted)] transition hover:bg-teal-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-teal-500/15 dark:hover:text-teal-300"
        >
          {isUnarchivePending ? <Loader2 size={16} className="animate-spin" /> : <ArchiveRestore size={16} />}
        </button>
      )}
    </div>
  );
}

export default function ArchivedChatsPage() {
  const navigate = useNavigate();
  const { data: chats = [], isLoading } = useChats({ archived: true });
  const unarchive = useUnarchiveChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = (chatId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };
  const unarchiveSelected = async () => {
    for (const chatId of selected) {
      await unarchive.mutateAsync(chatId);
    }
    setSelected(new Set());
    setEditing(false);
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-[color:var(--bl-bg)] text-[color:var(--bl-text)]">
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

      <main className="min-w-0 flex-1 overflow-y-auto bg-[color:var(--bl-bg)]">
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
              <h1 className="text-4xl font-bold tracking-tight text-[color:var(--bl-text)]">Archived</h1>
              <p className="mt-2 text-[15px] leading-6 text-[color:var(--bl-text-secondary)]">View and manage your archived conversations.</p>
            </div>
            {chats.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setEditing((value) => !value);
                  setSelected(new Set());
                }}
                className="bl-focus-ring flex-shrink-0 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3.5 py-2 text-sm font-medium text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
              >
                {editing ? 'Cancel' : 'Select'}
              </button>
            )}
          </div>

          {chats.length > 0 && (
            <p className="-mt-3 text-sm text-[color:var(--bl-text-muted)]">
              {chats.length === 1 ? '1 archived conversation' : `${chats.length} archived conversations`}
            </p>
          )}

          {editing && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-4 py-3 text-sm">
              <span className="text-[color:var(--bl-text-secondary)]">{selected.size} selected</span>
              <button
                type="button"
                onClick={() => void unarchiveSelected()}
                disabled={selected.size === 0 || unarchive.isPending}
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
              >
                Unarchive selected
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] py-10 text-sm text-[color:var(--bl-text-muted)]">
              <Loader2 size={16} className="animate-spin" /> Loading archived conversations&hellip;
            </div>
          ) : chats.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-6 py-16 text-center">
              <BlabberMark size={64} variant="icon" />
              <h2 className="mt-4 text-lg font-semibold text-[color:var(--bl-text)]">Nothing archived yet</h2>
              <p className="mt-1 max-w-sm text-sm text-[color:var(--bl-text-muted)]">Archived conversations will show up here.</p>
              <button
                onClick={() => navigate('/chats')}
                className="bl-focus-ring mt-5 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
              >
                Back to conversations
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {chats.map((chat) => (
                <ArchivedChatCard
                  key={chat._id}
                  chat={chat}
                  onOpen={() => navigate(`/chats/${chat._id}`)}
                  selectable={editing}
                  selected={selected.has(chat._id)}
                  onToggleSelect={() => toggle(chat._id)}
                  onUnarchive={() => unarchive.mutate(chat._id)}
                  isUnarchivePending={unarchive.isPending && unarchive.variables === chat._id}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
