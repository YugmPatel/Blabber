import { useState } from 'react';
import { Users, Phone, Video, Search, MoreVertical } from 'lucide-react';
import type { Chat } from '@repo/types';
import Avatar from './Avatar';
import VideoCallModal from './VideoCallModal';

interface ChatHeaderProps {
  chat: Chat;
  getChatTitle: (chat: Chat) => string;
  getChatAvatar: (chat: Chat) => string | undefined;
  onlineStatus?: { online: boolean; lastSeen: Date } | null;
  isGroupChat: boolean;
}

export default function ChatHeader({
  chat,
  getChatTitle,
  getChatAvatar,
  onlineStatus,
  isGroupChat,
}: ChatHeaderProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false);

  const formatLastSeen = (lastSeen: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(lastSeen).getTime();
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
    if (isGroupChat) {
      return `${chat.participants.length} participants`;
    }
    if (onlineStatus?.online) {
      return 'online';
    }
    if (onlineStatus?.lastSeen) {
      return `last seen ${formatLastSeen(onlineStatus.lastSeen)}`;
    }
    return '';
  };

  const isOnline = !isGroupChat && onlineStatus?.online;

  return (
    <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Avatar */}
        {isGroupChat ? (
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

        {/* Chat info */}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">{getChatTitle(chat)}</h2>
          <p className={`truncate text-xs ${isOnline ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {getStatusText()}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
        <button
          className="rounded-full p-2 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          aria-label="Search in chat"
        >
          <Search size={18} />
        </button>
        <button
          onClick={() => setShowVideoCall(true)}
          className="rounded-full p-2 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          aria-label="Video call"
        >
          <Video size={18} />
        </button>
        <button
          onClick={() => setShowVoiceCall(true)}
          className="rounded-full p-2 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          aria-label="Voice call"
        >
          <Phone size={18} />
        </button>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="rounded-full p-2 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          aria-label="Chat options"
        >
          <MoreVertical size={18} />
        </button>

        {/* Dropdown menu */}
        {showMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
            <div className="absolute right-0 z-20 mt-2 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
              <button
                className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                onClick={() => {
                  setShowMenu(false);
                  // TODO: Implement view profile
                }}
              >
                View Profile
              </button>
              <button
                className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                onClick={() => setShowMenu(false)}
              >
                Search in Chat
              </button>
              <button
                className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                onClick={() => setShowMenu(false)}
              >
                Mute Notifications
              </button>
              {isGroupChat && (
                <>
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    onClick={() => setShowMenu(false)}
                  >
                    Group Info
                  </button>
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                    onClick={() => setShowMenu(false)}
                  >
                    Leave Group
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      </div>

      {/* Video Call Modal */}
      <VideoCallModal
        isOpen={showVideoCall}
        onClose={() => setShowVideoCall(false)}
        chatId={chat._id}
        chatName={getChatTitle(chat)}
        isVideoCall={true}
      />

      {/* Voice Call Modal */}
      <VideoCallModal
        isOpen={showVoiceCall}
        onClose={() => setShowVoiceCall(false)}
        chatId={chat._id}
        chatName={getChatTitle(chat)}
        isVideoCall={false}
      />
    </div>
  );
}
