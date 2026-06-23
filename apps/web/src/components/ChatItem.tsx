import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar';
import type { Chat } from '@repo/types';
import { formatDistanceToNow } from 'date-fns';
import { Pin, Timer, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUser, useUserPresence } from '@/hooks/useUsers';

interface ChatItemProps {
  chat: Chat;
  isActive?: boolean;
  isPinned?: boolean;
  unreadCount?: number;
}

export default function ChatItem({ chat, isActive, isPinned, unreadCount = 0 }: ChatItemProps) {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  const isDirectChat = chat.type === 'direct';
  const otherUserId = isDirectChat
    ? chat.participants.find((p) => p !== currentUser?._id)
    : undefined;

  const { data: otherUser } = useUser(otherUserId);
  const { data: presence } = useUserPresence(otherUserId);

  const handleClick = () => navigate(`/chats/${chat._id}`);

  const getChatInfo = () => {
    if (chat.type === 'group') {
      return { title: chat.title || 'Unnamed Group', avatarUrl: chat.avatarUrl, online: undefined };
    }
    return { title: otherUser?.name || 'User', avatarUrl: otherUser?.avatarUrl, online: presence?.online };
  };

  const { title, avatarUrl, online } = getChatInfo();
  const isTemporary = chat.type === 'group' && chat.groupKind === 'temporary';
  const isEnded = Boolean(chat.endedAt) || Boolean(chat.expiresAt && new Date(chat.expiresAt).getTime() <= Date.now());
  const profileById = new Map((chat.participantProfiles || []).map((profile) => [profile._id, profile]));

  const latestPreview = () => {
    if (!chat.lastMessageRef) return 'No messages yet';
    const body = chat.lastMessageRef.body || 'Message';
    if (chat.type !== 'group') return body;
    const sender = profileById.get(chat.lastMessageRef.senderId);
    const senderName = sender?.name || sender?.username || sender?.email;
    return senderName ? `${senderName}: ${body}` : body;
  };

  const temporaryLabel = () => {
    if (!isTemporary || !chat.expiresAt) return null;
    if (isEnded) return 'Ended';
    const diff = new Date(chat.expiresAt).getTime() - Date.now();
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.ceil(diff / 60000))}m`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.ceil(diff / 3600000)}h`;
    return `${Math.ceil(diff / 86400000)}d`;
  };

  const formatTime = (date: Date) => {
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true });
    } catch {
      return '';
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors ${
        isActive
          ? 'bg-teal-50 dark:bg-teal-900/20'
          : unreadCount > 0
            ? 'bg-teal-50/45 hover:bg-teal-50 dark:bg-teal-950/20 dark:hover:bg-teal-950/30'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
      }`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {chat.type === 'group' && avatarUrl ? (
        <Avatar src={avatarUrl} alt={title} size="md" />
      ) : chat.type === 'group' ? (
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-600">
          <Users size={18} className="text-white" />
        </div>
      ) : (
        <Avatar src={avatarUrl} alt={title} size="md" online={online} />
      )}

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className={`truncate text-[14px] ${
              isActive ? 'text-teal-700 dark:text-teal-300' : 'text-slate-900 dark:text-white'
            } ${unreadCount > 0 ? 'font-bold' : 'font-semibold'}`}>
              {title}
            </h3>
            {isPinned && <Pin size={12} className="flex-shrink-0 text-slate-400" />}
            {isTemporary && (
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                <Timer size={10} />
                {temporaryLabel()}
              </span>
            )}
          </div>
          {chat.lastMessageRef && (
            <span className="ml-2 flex-shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
              {formatTime(chat.lastMessageRef.createdAt)}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className={`truncate text-[13px] ${
            unreadCount > 0
              ? 'font-semibold text-slate-700 dark:text-slate-200'
              : 'text-slate-500 dark:text-slate-400'
          }`}>
            {latestPreview()}
          </p>
          {unreadCount > 0 && (
            <span className="ml-2 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-teal-500 text-[10px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
