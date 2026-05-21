import { useState, useRef, useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Users, Phone, Video, Search, MoreVertical, X, Sparkles } from 'lucide-react';
import type { Chat, User } from '@repo/types';
import Avatar from './Avatar';
import { useMessages } from '@/hooks/useMessages';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/api/client';
import { useAppStore } from '@/store/app-store';

interface ChatHeaderProps {
  chat: Chat;
  getChatTitle: (chat: Chat) => string;
  getChatAvatar: (chat: Chat) => string | undefined;
  onlineStatus?: { online: boolean; lastSeen: Date } | null;
  isGroupChat: boolean;
}

type DisplayUser = Partial<User> & { _id: string };

function getUserTitle(user: DisplayUser | undefined, fallback = 'User') {
  return user?.name || user?.username || user?.email || fallback;
}

function getUserMeta(user: DisplayUser | undefined) {
  return [user?.email, user?.username ? `@${user.username}` : ''].filter(Boolean).join(' • ');
}

function UserProfileModal({
  user,
  onClose,
}: {
  user: DisplayUser | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!user) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [user, onClose]);

  if (!user) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          <Avatar src={user.avatarUrl} alt={getUserTitle(user)} size="xl" />
          <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
            {getUserTitle(user)}
          </h3>
          {getUserMeta(user) && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{getUserMeta(user)}</p>
          )}
          {user.about && (
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {user.about}
            </p>
          )}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            Message
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupInfoModal({
  isOpen,
  onClose,
  title,
  avatarUrl,
  members,
  onSelectMember,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  avatarUrl?: string;
  members: DisplayUser[];
  onSelectMember: (user: DisplayUser) => void;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Group info</h3>
          <button
            onClick={onClose}
            aria-label="Close group info"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5 text-center">
          {avatarUrl ? (
            <Avatar src={avatarUrl} alt={title} size="xl" />
          ) : (
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-teal-600">
              <Users size={30} className="text-white" />
            </div>
          )}
          <h4 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">{title}</h4>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto border-t border-slate-200 p-2 dark:border-slate-700">
          {members.map((member) => (
            <button
              key={member._id}
              onClick={() => onSelectMember(member)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Avatar src={member.avatarUrl} alt={getUserTitle(member)} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                  {getUserTitle(member, 'Unknown member')}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {getUserMeta(member) || member._id}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── "Coming Soon" call placeholder ───────────────────────────────────────────

function ComingSoonModal({
  isOpen,
  onClose,
  title,
  message,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50 dark:bg-teal-900/30">
          {title.toLowerCase().includes('video') ? (
            <Video size={28} className="text-teal-600 dark:text-teal-400" />
          ) : (
            <Phone size={28} className="text-teal-600 dark:text-teal-400" />
          )}
        </div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ── Chat AI panel ─────────────────────────────────────────────────────────────

function ChatAIPanel({ onClose, chatId: _chatId }: { onClose: () => void; chatId: string }) {
  const suggestions = [
    { label: 'Summarize this chat', icon: '📋' },
    { label: 'What did we decide?', icon: '✅' },
    { label: 'Extract action items', icon: '📌' },
    { label: 'Who is waiting on me?', icon: '⏳' },
    { label: 'Find a link or file', icon: '🔗' },
  ];

  return (
    <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-teal-50/30 px-4 py-3 dark:border-slate-800 dark:from-slate-900 dark:to-teal-900/10">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-teal-500" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-teal-600 dark:text-teal-400">
            Chat AI
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close AI panel"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <X size={14} />
        </button>
      </div>
      <p className="mb-2.5 text-[11px] text-slate-500 dark:text-slate-400">
        Ask about this conversation or pick a suggestion:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s.label}
            className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-teal-600 dark:hover:bg-teal-900/20 dark:hover:text-teal-300"
            title="Coming soon — AI query"
          >
            <span>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main ChatHeader ───────────────────────────────────────────────────────────

export default function ChatHeader({
  chat,
  getChatTitle,
  getChatAvatar,
  onlineStatus,
  isGroupChat,
}: ChatHeaderProps) {
  const { user: currentUser } = useAuth();
  const setActiveCall = useAppStore((state) => state.setActiveCall);
  const [showMenu, setShowMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [profileUser, setProfileUser] = useState<DisplayUser | null>(null);
  const [callNotice, setCallNotice] = useState<{ title: string; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const { data: messagesData } = useMessages(chat._id);
  const participantQueries = useQueries({
    queries: chat.participants.map((participantId) => ({
      queryKey: ['users', participantId] as const,
      queryFn: async () => {
        const { data } = await apiClient.get<{ user: User }>(`/api/users/${participantId}`);
        return data.user;
      },
      staleTime: 60_000,
      enabled: Boolean(participantId),
    })),
  });

  const members = useMemo(() => {
    const byId = new Map<string, DisplayUser>();
    participantQueries.forEach((query, index) => {
      const participantId = chat.participants[index];
      if (participantId) {
        byId.set(participantId, query.data ? { ...query.data, _id: participantId } : { _id: participantId });
      }
    });
    if (currentUser?._id) {
      byId.set(currentUser._id, {
        ...(currentUser as DisplayUser),
        _id: currentUser._id,
        name: currentUser.name || currentUser.username || 'You',
      });
    }
    return chat.participants.map((participantId) => byId.get(participantId) || { _id: participantId });
  }, [chat.participants, currentUser, participantQueries]);

  const directProfileUser = useMemo(
    () => members.find((member) => member._id !== currentUser?._id) || null,
    [currentUser?._id, members]
  );

  const visibleMessages = useMemo(
    () => messagesData?.pages.flatMap((page) => page.messages) || [],
    [messagesData]
  );

  const trimmedSearch = searchQuery.trim();
  const searchMatchCount = useMemo(() => {
    if (!trimmedSearch) return 0;
    const q = trimmedSearch.toLowerCase();
    return visibleMessages.filter((message) => message.body?.toLowerCase().includes(q)).length;
  }, [trimmedSearch, visibleMessages]);

  const positionMenu = () => {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 208;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
    setMenuPosition({
      top: rect.bottom + 6,
      left: Math.min(maxLeft, Math.max(margin, rect.right - menuWidth)),
    });
  };

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!showMenu) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMenu(false); };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    const handleReposition = () => positionMenu();
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [showMenu]);

  // Focus search input when opened
  useEffect(() => {
    if (showSearch) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
    }
  }, [showSearch]);

  const formatLastSeen = (lastSeen: Date) => {
    const diff = Date.now() - new Date(lastSeen).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(lastSeen).toLocaleDateString();
  };

  const getStatusText = () => {
    if (isGroupChat) return `${members.length} ${members.length === 1 ? 'member' : 'members'}`;
    if (onlineStatus?.online) return 'online';
    if (onlineStatus?.lastSeen) return `last seen ${formatLastSeen(onlineStatus.lastSeen)}`;
    return '';
  };

  const isOnline = !isGroupChat && onlineStatus?.online;
  const openProfileOrGroupInfo = () => {
    if (isGroupChat) {
      setShowGroupInfo(true);
    } else if (directProfileUser) {
      setProfileUser(directProfileUser);
    }
  };

  const btnBase =
    'rounded-full p-2 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white';

  const createCallId = () =>
    globalThis.crypto?.randomUUID?.() || `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const startCall = (callType: 'audio' | 'video') => {
    const title = callType === 'video' ? 'Video call' : 'Audio call';

    if (isGroupChat || chat.participants.length !== 2) {
      setCallNotice({ title, message: 'Group calls are coming soon.' });
      return;
    }

    if (!currentUser?._id || !directProfileUser?._id) {
      setCallNotice({ title, message: 'Could not find a direct chat participant to call.' });
      return;
    }

    setShowAI(false);
    setShowSearch(false);
    setActiveCall({
      callId: createCallId(),
      chatId: chat._id,
      callType,
      direction: 'outgoing',
      status: 'outgoing',
      fromUserId: currentUser._id,
      fromUserName: getUserTitle(currentUser as DisplayUser, 'You'),
      toUserId: directProfileUser._id,
      peerUserId: directProfileUser._id,
      peerName: getUserTitle(directProfileUser),
      peerAvatarUrl: directProfileUser.avatarUrl,
    });
  };

  return (
    <>
      {/* ── Main header bar ── */}
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left: avatar + info */}
          <button
            onClick={openProfileOrGroupInfo}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 dark:hover:bg-slate-800/70"
            aria-label={isGroupChat ? 'Open group info' : 'Open user profile'}
          >
            {isGroupChat && getChatAvatar(chat) ? (
              <Avatar src={getChatAvatar(chat)} alt={getChatTitle(chat)} size="md" />
            ) : isGroupChat ? (
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-600">
                <Users size={18} className="text-white" />
              </div>
            ) : (
              <Avatar
                src={getChatAvatar(chat)}
                alt={getChatTitle(chat)}
                size="md"
                online={onlineStatus?.online}
              />
            )}
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">
                {getChatTitle(chat)}
              </h2>
              <p className={`truncate text-xs ${isOnline ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {getStatusText()}
              </p>
            </div>
          </button>

          {/* Right: action buttons */}
          <div className="flex items-center gap-0.5 text-slate-500 dark:text-slate-400">
            {/* AI button */}
            <button
              onClick={() => { setShowAI((v) => !v); setShowSearch(false); }}
              aria-label="Open Chat AI"
              aria-pressed={showAI}
              className={`${btnBase} ${showAI ? 'bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400' : ''}`}
            >
              <Sparkles size={18} />
            </button>

            {/* Search */}
            <button
              onClick={() => { setShowSearch((v) => !v); setShowAI(false); }}
              aria-label="Search in chat"
              aria-pressed={showSearch}
              className={`${btnBase} ${showSearch ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : ''}`}
            >
              <Search size={18} />
            </button>

            {/* Video call */}
            <button
              onClick={() => startCall('video')}
              aria-label="Video call"
              className={btnBase}
            >
              <Video size={18} />
            </button>

            {/* Voice call */}
            <button
              onClick={() => startCall('audio')}
              aria-label="Audio call"
              className={btnBase}
            >
              <Phone size={18} />
            </button>

            {/* Three-dot menu — anchored with relative wrapper */}
            <div ref={menuRef} className="relative">
              <button
                ref={menuButtonRef}
                onClick={() => {
                  if (!showMenu) positionMenu();
                  setShowMenu((v) => !v);
                }}
                aria-label="More options"
                aria-expanded={showMenu}
                aria-haspopup="menu"
                className={`${btnBase} ${showMenu ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : ''}`}
              >
                <MoreVertical size={18} />
              </button>

              {showMenu && (
                <div
                  role="menu"
                  className="fixed z-[100] w-52 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
                  style={{ top: menuPosition.top, left: menuPosition.left }}
                >
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    onClick={() => { setShowMenu(false); openProfileOrGroupInfo(); }}
                  >
                    View profile
                  </button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    onClick={() => { setShowMenu(false); setShowSearch(true); setShowAI(false); }}
                  >
                    Search in chat
                  </button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    onClick={() => setShowMenu(false)}
                  >
                    Mute notifications
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Inline search bar ── */}
        {showSearch && (
          <div className="border-t border-slate-100 px-4 py-2 dark:border-slate-800">
            <div className="relative flex items-center gap-2">
              <Search size={14} className="absolute left-3 text-slate-400" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setShowSearch(false); }}
                placeholder="Search in this chat…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-24 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-teal-500"
              />
              {trimmedSearch && (
                <span className="absolute right-9 text-[11px] text-slate-500 dark:text-slate-400">
                  {searchMatchCount} {searchMatchCount === 1 ? 'match' : 'matches'}
                </span>
              )}
              <button
                onClick={() => setShowSearch(false)}
                aria-label="Close search"
                className="absolute right-2 rounded-lg p-1 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── AI panel (below header) ── */}
      {showAI && <ChatAIPanel onClose={() => setShowAI(false)} chatId={chat._id} />}

      {/* ── Modals ── */}
      <ComingSoonModal
        isOpen={Boolean(callNotice)}
        onClose={() => setCallNotice(null)}
        title={callNotice?.title || 'Call'}
        message={callNotice?.message || ''}
      />

      <GroupInfoModal
        isOpen={showGroupInfo}
        onClose={() => setShowGroupInfo(false)}
        title={getChatTitle(chat)}
        avatarUrl={getChatAvatar(chat)}
        members={members}
        onSelectMember={(member) => setProfileUser(member)}
      />

      <UserProfileModal
        user={profileUser}
        onClose={() => setProfileUser(null)}
      />
    </>
  );
}
