import { useParams } from 'react-router-dom';
import ChatItem from './ChatItem';
import type { Chat } from '@repo/types';
import { useState } from 'react';
import { useArchiveChat, useUnarchiveChat } from '@/hooks/useChats';

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
  const { id } = useParams<{ id: string }>();
  const archiveChat = useArchiveChat();
  const unarchiveChat = useUnarchiveChat();
  const [undoChat, setUndoChat] = useState<Chat | null>(null);

  const archiveConversation = (chat: Chat) => {
    archiveChat.mutate(chat._id, { onSuccess: () => setUndoChat(chat) });
  };

  const unarchiveConversation = (chat: Chat) => {
    unarchiveChat.mutate(chat._id);
  };

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

  const undoToast = undoChat && !showArchived ? (
    <div className="sticky bottom-3 mx-3 mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
          Conversation archived.
        </span>
        <button
          type="button"
          onClick={() => {
            const chatToRestore = undoChat;
            setUndoChat(null);
            unarchiveChat.mutate(chatToRestore._id);
          }}
          className="flex-shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 dark:text-teal-300 dark:hover:bg-teal-950/30"
        >
          Undo
        </button>
      </div>
    </div>
  ) : null;

  if (filteredChats.length === 0) {
    return (
      <div className="divide-y divide-slate-100">
        <div className="flex h-32 items-center justify-center text-gray-500">
          {showArchived ? 'No archived conversations' : 'No conversations yet'}
        </div>
        {undoToast}
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      <div className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        Recent convos
      </div>
      {sortedPinnedChats.length > 0 && (
        <div>
          {sortedPinnedChats.map((chat) => (
            <ChatItem
              key={chat._id}
              chat={chat}
              isActive={chat._id === id}
              isPinned={true}
              unreadCount={unreadCounts[chat._id] ?? chat.unreadCount ?? 0}
              onArchive={archiveConversation}
              onUnarchive={unarchiveConversation}
              isArchivePending={
                (archiveChat.isPending && archiveChat.variables === chat._id) ||
                (unarchiveChat.isPending && unarchiveChat.variables === chat._id)
              }
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
              isActive={chat._id === id}
              isPinned={false}
              unreadCount={unreadCounts[chat._id] ?? chat.unreadCount ?? 0}
              onArchive={archiveConversation}
              onUnarchive={unarchiveConversation}
              isArchivePending={
                (archiveChat.isPending && archiveChat.variables === chat._id) ||
                (unarchiveChat.isPending && unarchiveChat.variables === chat._id)
              }
            />
          ))}
        </div>
      )}
      {undoToast}
    </div>
  );
}
