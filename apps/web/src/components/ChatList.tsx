import { useParams } from 'react-router-dom';
import ChatItem from './ChatItem';
import type { Chat } from '@repo/types';

interface ChatListProps {
  chats: Chat[];
  pinnedChatIds?: string[];
  archivedChatIds?: string[];
  unreadCounts?: Record<string, number>;
  showArchived?: boolean;
}

export default function ChatList({
  chats,
  pinnedChatIds = [],
  archivedChatIds = [],
  unreadCounts = {},
  showArchived = false,
}: ChatListProps) {
  const { chatId } = useParams<{ chatId: string }>();

  // Filter chats based on archived status
  const filteredChats = chats.filter((chat) => {
    const isArchived = archivedChatIds.includes(chat._id);
    return showArchived ? isArchived : !isArchived;
  });

  // Separate pinned and unpinned chats
  const pinnedChats = filteredChats.filter((chat) => pinnedChatIds.includes(chat._id));
  const unpinnedChats = filteredChats.filter((chat) => !pinnedChatIds.includes(chat._id));

  // Sort by last message time (most recent first)
  const sortByLastMessage = (a: Chat, b: Chat) => {
    const aTime = a.lastMessageRef?.createdAt ? new Date(a.lastMessageRef.createdAt).getTime() : 0;
    const bTime = b.lastMessageRef?.createdAt ? new Date(b.lastMessageRef.createdAt).getTime() : 0;
    return bTime - aTime;
  };

  const sortedPinnedChats = [...pinnedChats].sort(sortByLastMessage);
  const sortedUnpinnedChats = [...unpinnedChats].sort(sortByLastMessage);

  if (filteredChats.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500">
        {showArchived ? 'No archived chats' : 'No chats yet'}
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-200">
      {sortedPinnedChats.length > 0 && (
        <div>
          {sortedPinnedChats.map((chat) => (
            <ChatItem
              key={chat._id}
              chat={chat}
              isActive={chat._id === chatId}
              isPinned={true}
              unreadCount={unreadCounts[chat._id]}
            />
          ))}
        </div>
      )}
      {sortedUnpinnedChats.length > 0 && (
        <div>
          {sortedUnpinnedChats.map((chat) => (
            <ChatItem
              key={chat._id}
              chat={chat}
              isActive={chat._id === chatId}
              isPinned={false}
              unreadCount={unreadCounts[chat._id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
