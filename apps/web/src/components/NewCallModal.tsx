import { useEffect, useState } from 'react';
import { Phone, Search, Video, X } from 'lucide-react';
import type { Chat } from '@repo/types';
import Avatar from './Avatar';
import { useChats } from '@/hooks/useChats';
import { useUser } from '@/hooks/useUsers';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore } from '@/store/app-store';

export type CallMode = 'video' | 'audio';

const createCallId = () =>
  globalThis.crypto?.randomUUID?.() || `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function DirectChatRow({
  chat,
  peerId,
  mode,
  query,
  onStart,
}: {
  chat: Chat;
  peerId: string;
  mode: CallMode;
  query: string;
  onStart: (chat: Chat, peerId: string, peerName: string, peerAvatarUrl?: string) => void;
}) {
  const { data: peer } = useUser(peerId);
  const name = peer?.name || peer?.username || peer?.email || 'User';

  const trimmed = query.trim().toLowerCase();
  if (
    trimmed &&
    ![peer?.name, peer?.username, peer?.email]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(trimmed))
  ) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => onStart(chat, peerId, name, peer?.avatarUrl)}
      className="bl-focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-teal-50 dark:hover:bg-teal-500/10"
    >
      <Avatar src={peer?.avatarUrl} alt={name} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[color:var(--bl-text)]">{name}</span>
        {peer?.username && (
          <span className="block truncate text-xs text-[color:var(--bl-text-muted)]">@{peer.username}</span>
        )}
      </span>
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
        {mode === 'video' ? <Video size={15} /> : <Phone size={15} />}
      </span>
    </button>
  );
}

export default function NewCallModal({
  isOpen,
  initialMode,
  onClose,
}: {
  isOpen: boolean;
  initialMode: CallMode;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const setActiveCall = useAppStore((state) => state.setActiveCall);
  const { data: chats = [], isLoading } = useChats();
  const [mode, setMode] = useState<CallMode>(initialMode);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setQuery('');
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const directChats = chats.filter(
    (chat) => chat.type === 'direct' && chat.participants.length === 2 && !chat.archived
  );

  const startCall = (chat: Chat, peerId: string, peerName: string, peerAvatarUrl?: string) => {
    if (!user?._id) return;
    setActiveCall({
      callId: createCallId(),
      chatId: chat._id,
      callType: mode,
      direction: 'outgoing',
      status: 'outgoing',
      fromUserId: user._id,
      fromUserName: user.name || user.username || user.email,
      toUserId: peerId,
      peerUserId: peerId,
      peerName,
      peerAvatarUrl,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="relative flex max-h-[min(560px,90vh)] w-full max-w-md flex-col rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-5"
        style={{ boxShadow: 'var(--bl-glow-md), 0 24px 60px -12px rgba(2, 20, 18, 0.45)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close new call"
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--bl-border)] text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] hover:text-[color:var(--bl-text)]"
        >
          <X size={16} />
        </button>

        <div className="pr-10">
          <h2 className="text-lg font-bold tracking-tight text-[color:var(--bl-text)]">New call</h2>
          <p className="mt-0.5 text-xs text-[color:var(--bl-text-muted)]">Choose who to call.</p>
        </div>

        {/* Mode toggle */}
        <div className="mt-4 inline-flex self-start rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] p-1">
          {(
            [
              { value: 'video', label: 'Video', icon: Video },
              { value: 'audio', label: 'Voice', icon: Phone },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setMode(item.value)}
              aria-pressed={mode === item.value}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                mode === item.value
                  ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950'
                  : 'text-[color:var(--bl-text-secondary)] hover:text-[color:var(--bl-text)]'
              }`}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--bl-text-muted)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people..."
            className="bl-focus-ring w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-bg)] py-2.5 pl-10 pr-3 text-sm text-[color:var(--bl-text)] placeholder:text-[color:var(--bl-text-muted)]"
          />
        </div>

        {/* Contacts (real direct conversations only) */}
        <div className="mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-[color:var(--bl-text-muted)]">Loading conversations...</p>
          ) : directChats.length === 0 ? (
            <p className="py-8 text-center text-sm text-[color:var(--bl-text-muted)]">
              No direct conversations yet. Start a convo first to call someone.
            </p>
          ) : (
            directChats.map((chat) => {
              const peerId = chat.participants.find((participantId) => participantId !== user?._id);
              if (!peerId) return null;
              return (
                <DirectChatRow
                  key={chat._id}
                  chat={chat}
                  peerId={peerId}
                  mode={mode}
                  query={query}
                  onStart={startCall}
                />
              );
            })
          )}
        </div>

        <p className="mt-3 border-t border-[color:var(--bl-border)] pt-3 text-[11px] text-[color:var(--bl-text-muted)]">
          Group calls start from inside the group chat.
        </p>
      </div>
    </div>
  );
}
