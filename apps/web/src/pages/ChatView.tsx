import { useParams } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useChat } from '@/hooks/useChats';
import { useMessages, useDeleteMessage, useAddReaction, messageKeys } from '@/hooks/useMessages';
import { useUser, useUserPresence } from '@/hooks/useUsers';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore } from '@/store/app-store';
import ChatHeader from '@/components/ChatHeader';
import MessageList from '@/components/MessageList';
import TypingDots from '@/components/TypingDots';
import { Composer } from '@/components/Composer';
import type { Chat, Message } from '@repo/types';

export default function ChatView() {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useAuth();
  const { getTypingUsers, socket } = useAppStore();
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const queryClient = useQueryClient();

  // Fetch chat details
  const { data: chat, isLoading: chatLoading } = useChat(id);

  // Fetch messages with infinite scroll
  const {
    data: messagesData,
    isLoading: messagesLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useMessages(id);

  // Get all messages from pages
  const messages = messagesData?.pages.flatMap((page) => page.messages) || [];

  // Determine if this is a group chat
  const isGroupChat = chat?.type === 'group';

  // For direct chats, get the other user's ID
  const otherUserId =
    !isGroupChat && chat ? chat.participants.find((p) => p !== currentUser?._id) : undefined;

  // Fetch other user's details for direct chats
  const { data: otherUser } = useUser(otherUserId);
  const { data: otherUserPresence } = useUserPresence(otherUserId);

  // Mutations for message actions
  const deleteMessageMutation = useDeleteMessage(id || '');
  const addReactionMutation = useAddReaction(id || '');

  // Get typing users
  const typingUserIds = id ? getTypingUsers(id) : [];
  const typingUserNames = typingUserIds
    .filter((userId) => userId !== currentUser?._id)
    .map((userId) => getUserName(userId));

  // Message action handlers
  const handleReply = useCallback((message: Message) => {
    setReplyToMessage(message);
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyToMessage(null);
  }, []);

  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      addReactionMutation.mutate({ messageId, data: { emoji } });
    },
    [addReactionMutation]
  );

  const handleDelete = useCallback(
    (messageId: string) => {
      if (window.confirm('Delete this message?')) {
        deleteMessageMutation.mutate(messageId);
      }
    },
    [deleteMessageMutation]
  );

  // Join chat room when component mounts
  useEffect(() => {
    if (!socket || !id) return;

    // Join the chat room
    socket.emit('chat:join', { chatId: id });

    // Leave the chat room when component unmounts
    return () => {
      socket.emit('chat:leave', { chatId: id });
    };
  }, [socket, id]);

  // Helper functions
  function getChatTitle(chat: Chat): string {
    if (chat.type === 'group') {
      return chat.title || 'Group Chat';
    }
    return otherUser?.name || 'User';
  }

  function getChatAvatar(chat: Chat): string | undefined {
    if (chat.type === 'group') {
      return chat.avatarUrl;
    }
    return otherUser?.avatarUrl;
  }

  function getUserName(userId: string): string {
    if (userId === currentUser?._id) {
      return 'You';
    }
    if (userId === otherUserId) {
      return otherUser?.name || 'User';
    }
    // For group chats, we would need to fetch user details
    // For now, return a placeholder
    return 'User';
  }

  function getUserAvatar(userId: string): string | undefined {
    if (userId === otherUserId) {
      return otherUser?.avatarUrl;
    }
    // For group chats, we would need to fetch user details
    return undefined;
  }

  // Loading state
  if (chatLoading || messagesLoading) {
    return (
      <div className="flex flex-col h-full bg-gray-50">
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
        </div>
      </div>
    );
  }

  // Error state
  if (!chat) {
    return (
      <div className="flex flex-col h-full bg-gray-50">
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-600">Chat not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Chat Header */}
      <ChatHeader
        chat={chat}
        getChatTitle={getChatTitle}
        getChatAvatar={getChatAvatar}
        onlineStatus={!isGroupChat ? otherUserPresence : null}
        isGroupChat={isGroupChat}
      />

      {/* Message List */}
      <MessageList
        messages={messages}
        currentUserId={currentUser?._id || ''}
        hasNextPage={hasNextPage || false}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        getUserName={getUserName}
        getUserAvatar={getUserAvatar}
        isGroupChat={isGroupChat}
        onReply={handleReply}
        onReact={handleReact}
        onDelete={handleDelete}
      />

      {/* Typing Indicator */}
      {typingUserNames.length > 0 && <TypingDots userNames={typingUserNames} />}

      {/* Message Composer */}
      <Composer chatId={id!} replyToMessage={replyToMessage} onCancelReply={handleCancelReply} />
    </div>
  );
}
