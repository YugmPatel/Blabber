import { useState } from 'react';
import { Users, Phone, Video } from 'lucide-react';
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
    <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Avatar */}
        {isGroupChat ? (
          <div className="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center flex-shrink-0">
            <Users size={24} className="text-white" />
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
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{getChatTitle(chat)}</h2>
          <p className={`text-sm truncate ${isOnline ? 'text-[#00a884]' : 'text-gray-500'}`}>
            {getStatusText()}
          </p>
        </div>
      </div>

      {/* Call buttons and Actions menu */}
      <div className="flex items-center gap-1">
        {/* Video call button */}
        <button
          onClick={() => setShowVideoCall(true)}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600 hover:text-[#00a884]"
          aria-label="Video call"
        >
          <Video size={22} />
        </button>

        {/* Voice call button */}
        <button
          onClick={() => setShowVoiceCall(true)}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600 hover:text-[#00a884]"
          aria-label="Voice call"
        >
          <Phone size={22} />
        </button>

        {/* Menu button */}
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          aria-label="Chat options"
        >
          <svg
            className="w-6 h-6 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
            />
          </svg>
        </button>

        {/* Dropdown menu */}
        {showMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
              <button
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => {
                  setShowMenu(false);
                  // TODO: Implement view profile
                }}
              >
                View Profile
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => {
                  setShowMenu(false);
                  // TODO: Implement search in chat
                }}
              >
                Search in Chat
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => {
                  setShowMenu(false);
                  // TODO: Implement mute
                }}
              >
                Mute Notifications
              </button>
              {isGroupChat && (
                <>
                  <button
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => {
                      setShowMenu(false);
                      // TODO: Implement group info
                    }}
                  >
                    Group Info
                  </button>
                  <button
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                    onClick={() => {
                      setShowMenu(false);
                      // TODO: Implement leave group
                    }}
                  >
                    Leave Group
                  </button>
                </>
              )}
            </div>
          </>
        )}
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
