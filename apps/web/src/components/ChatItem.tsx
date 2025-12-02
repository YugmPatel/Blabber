import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar';
import type { Chat } from '@repo/types';
import { formatDistanceToNow } from 'date-fns';
import { Pin, Users } from 'lucide-react';
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

  // For direct chats, get the other user's ID
  const isDirectChat = chat.type === 'direct';
  const otherUserId = isDirectChat
    ? chat.participants.find((p) => p !== currentUser?._id)
    : undefined;

  // Fetch other user's details and presence for direct chats
  const { data: otherUser } = useUser(otherUserId);
  const { data: presence } = useUserPresence(otherUserId);

  const handleClick = () => {
    navigate(`/chats/${chat._id}`);
  };

  // Get chat display info
  const getChatInfo = () => {
    if (chat.type === 'group') {
      return {
        title: chat.title || 'Unnamed Group',
        avatarUrl: chat.avatarUrl,
        online: undefined,
      };
    }
    // For direct chats, use the other user's info
    return {
      title: otherUser?.name || 'User',
      avatarUrl: otherUser?.avatarUrl,
      online: presence?.online,
    };
  };

  const { title, avatarUrl, online } = getChatInfo();

  // Format last message time
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
      className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-100 transition-colors ${
        isActive ? 'bg-gray-200' : ''
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
      {chat.type === 'group' ? (
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center">
            <Users size={24} className="text-white" />
          </div>
        </div>
      ) : (
        <Avatar src={avatarUrl} alt={title} size="md" online={online} />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{title}</h3>
            {isPinned && <Pin size={14} className="text-gray-500 flex-shrink-0" />}
          </div>
          {chat.lastMessageRef && (
            <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
              {formatTime(chat.lastMessageRef.createdAt)}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600 truncate">
            {chat.lastMessageRef?.body || 'No messages yet'}
          </p>
          {unreadCount > 0 && (
            <span className="flex-shrink-0 ml-2 bg-green-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
