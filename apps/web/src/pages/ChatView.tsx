import { useNavigate, useParams } from 'react-router-dom';
import { Component, useEffect, useState, useCallback } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Sparkles, X } from 'lucide-react';
import { chatKeys, useChat } from '@/hooks/useChats';
import { useMessages, useDeleteMessage, useAddReaction, useVotePoll, useMarkMessagesRead } from '@/hooks/useMessages';
import { useChatActions } from '@/hooks/useChatActions';
import { useGroupBrain } from '@/hooks/useGroupBrain';
import { useChatSummary } from '@/hooks/useChatSummary';
import { useUser, useUserPresence } from '@/hooks/useUsers';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/api/client';
import { useAppStore } from '@/store/app-store';
import ChatHeader from '@/components/ChatHeader';
import ChatActionsPanel from '@/components/ChatActionsPanel';
import GroupBrainPanel from '@/components/GroupBrainPanel';
import CatchMeUpCard from '@/components/CatchMeUpCard';
import MessageList from '@/components/MessageList';
import TypingDots from '@/components/TypingDots';
import { Composer } from '@/components/Composer';
import type { Chat, ChatSummaryTask, Message } from '@repo/types';

class ChatIntelligenceErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void; chatId?: string; chatType?: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('Chat Intelligence render failed', {
        name: error.name,
        message: error.message,
        componentStack: errorInfo.componentStack,
        chatId: this.props.chatId,
        chatType: this.props.chatType,
        panel: 'Drawer shell',
      });
    }
  }

  retry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={this.props.onClose}>
        <aside
          className="flex h-full w-full max-w-md flex-col bg-slate-50 shadow-2xl dark:bg-slate-950"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Chat Intelligence</h2>
            <button
              type="button"
              onClick={this.props.onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="Close intelligence drawer"
            >
              <X size={18} />
            </button>
          </header>
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 text-center dark:border-slate-800 dark:bg-slate-900">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Chat Intelligence couldn't load right now.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Your chat is still available. Try reopening the drawer or continue messaging.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={this.retry}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-950"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={this.props.onClose}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    );
  }
}

class IntelligencePanelBoundary extends Component<
  { children: ReactNode; title: string; panel: 'Summary' | 'Actions' | 'Group Brain'; chatId: string; chatType: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('Chat Intelligence panel render failed', {
        name: error.name,
        message: error.message,
        componentStack: errorInfo.componentStack,
        chatId: this.props.chatId,
        chatType: this.props.chatType,
        panel: this.props.panel,
      });
    }
  }

  retry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <section className="rounded-lg border border-rose-200 bg-white p-4 dark:border-rose-900/50 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-rose-500" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{this.props.title}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              This part of Chat Intelligence couldn't load right now.
            </p>
            {import.meta.env.DEV && (
              <p className="mt-1 text-[11px] font-mono text-rose-500">AI_RENDER_{this.props.panel.replace(' ', '_').toUpperCase()}_INVALID</p>
            )}
            <button
              type="button"
              onClick={this.retry}
              className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-950"
            >
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }
}

export default function ChatView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const { getTypingUsers, socket, setActiveChat } = useAppStore();
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [isIntelligenceOpen, setIsIntelligenceOpen] = useState(false);
  const [isViewingChat, setIsViewingChat] = useState(() =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible' && document.hasFocus()
  );

  // Fetch chat details
  const { data: chat, isLoading: chatLoading } = useChat(id);
  const { data: userSettings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ settings: { chatIntelligenceEnabled: boolean } }>(
        '/api/users/settings/me'
      );
      return data.settings;
    },
  });
  const chatIntelligenceEnabled = userSettings?.chatIntelligenceEnabled !== false;

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
  const isEndedTemporaryGroup =
    chat?.type === 'group' &&
    (Boolean(chat.endedAt) || Boolean(chat.expiresAt && new Date(chat.expiresAt).getTime() <= Date.now()));
  const participantProfiles = new Map(
    (chat?.participantProfiles || []).map((profile) => [profile._id, profile])
  );

  // For direct chats, get the other user's ID
  const otherUserId =
    !isGroupChat && chat ? chat.participants.find((p) => p !== currentUser?._id) : undefined;

  // Fetch other user's details for direct chats
  const { data: otherUser } = useUser(otherUserId);
  const { data: otherUserPresence } = useUserPresence(otherUserId);

  // Mutations for message actions
  const deleteMessageMutation = useDeleteMessage(id || '');
  const addReactionMutation = useAddReaction(id || '');
  const votePollMutation = useVotePoll(id || '');
  const markReadMutation = useMarkMessagesRead(id || '');
  const { mutate: markMessagesRead, isPending: isMarkingRead } = markReadMutation;

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

  const handlePollVote = useCallback(
    (messageId: string, optionId: string) => {
      votePollMutation.mutate({ messageId, data: { optionId } });
    },
    [votePollMutation]
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

  useEffect(() => {
    setActiveChat(id ?? null);
    return () => setActiveChat(null);
  }, [id, setActiveChat]);

  useEffect(() => {
    const updateViewingState = () => {
      setIsViewingChat(document.visibilityState === 'visible' && document.hasFocus());
    };

    updateViewingState();
    document.addEventListener('visibilitychange', updateViewingState);
    window.addEventListener('focus', updateViewingState);
    window.addEventListener('blur', updateViewingState);

    return () => {
      document.removeEventListener('visibilitychange', updateViewingState);
      window.removeEventListener('focus', updateViewingState);
      window.removeEventListener('blur', updateViewingState);
    };
  }, []);

  useEffect(() => {
    if (!id || !currentUser?._id || !isViewingChat || isMarkingRead) return;

    const unreadMessageIds = messages
      .filter((message) => message.chatId === id)
      .filter((message) => message.senderId !== currentUser._id)
      .filter((message) => message.status !== 'read')
      .map((message) => message._id);

    if (unreadMessageIds.length === 0) {
      queryClient.getQueryCache().findAll({ queryKey: chatKeys.lists() }).forEach((query) => {
        queryClient.setQueryData(query.queryKey, (old: unknown) => {
          if (!Array.isArray(old)) return old;
          return old.map((chat) =>
            chat && typeof chat === 'object' && '_id' in chat && chat._id === id
              ? { ...chat, unreadCount: 0 }
              : chat
          );
        });
      });
      return;
    }

    markMessagesRead(unreadMessageIds);
  }, [currentUser?._id, id, isViewingChat, isMarkingRead, markMessagesRead, messages, queryClient]);

  // Helper functions
  function getChatTitle(chat: Chat): string {
    if (chat.type === 'group') {
      return chat.title || 'Group Chat';
    }
    return otherUser?.name || otherUser?.username || otherUser?.email || 'User';
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
      return otherUser?.name || otherUser?.username || otherUser?.email || 'Unknown user';
    }
    const profile = participantProfiles.get(userId);
    return profile?.name || profile?.username || profile?.email || 'Unknown member';
  }

  function getUserAvatar(userId: string): string | undefined {
    if (userId === currentUser?._id) {
      return (currentUser as any)?.avatarUrl || currentUser?.avatar;
    }
    if (userId === otherUserId) {
      return otherUser?.avatarUrl;
    }
    return participantProfiles.get(userId)?.avatarUrl;
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
      <div className="flex h-full flex-col bg-gray-50 dark:bg-slate-950">
        <div className="flex h-full items-center justify-center px-6">
          <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-base font-semibold text-slate-900 dark:text-white">Chat not available</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              This chat may have been deleted, ended, or you may no longer have access.
            </p>
            <button
              type="button"
              onClick={() => navigate('/chats')}
              className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-950"
            >
              Back to All Chats
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900">
      <ChatHeader
        chat={chat}
        getChatTitle={getChatTitle}
        getChatAvatar={getChatAvatar}
        onlineStatus={!isGroupChat ? otherUserPresence : null}
        isGroupChat={isGroupChat}
        intelligenceEnabled={chatIntelligenceEnabled}
        onOpenIntelligence={() => setIsIntelligenceOpen(true)}
      />

      {isEndedTemporaryGroup && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          This temporary group has ended.
        </div>
      )}

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
        onPollVote={handlePollVote}
      />

      {typingUserNames.length > 0 && (
        <div className="border-t border-slate-100 bg-white px-4 py-1 dark:border-slate-800 dark:bg-slate-900">
          <TypingDots userNames={typingUserNames} />
        </div>
      )}

      {!isEndedTemporaryGroup && (
        <Composer chatId={id!} replyToMessage={replyToMessage} onCancelReply={handleCancelReply} />
      )}

      {isIntelligenceOpen && chatIntelligenceEnabled && (
        <ChatIntelligenceErrorBoundary onClose={() => setIsIntelligenceOpen(false)} chatId={id} chatType={chat.type}>
          <ChatIntelligenceDrawer chatId={id!} chat={chat} onClose={() => setIsIntelligenceOpen(false)} />
        </ChatIntelligenceErrorBoundary>
      )}
    </div>
  );
}

function ChatIntelligenceDrawer({ chatId, chat, onClose }: { chatId: string; chat: Chat; onClose: () => void }) {
  const isGroupChat = chat.type === 'group';
  const {
    summary,
    isLoadingSummary,
    isGeneratingSummary,
    summaryError,
    generateError,
    generateSummary,
    refetchSummary,
  } = useChatSummary(chatId);
  const {
    actions,
    isLoadingActions,
    isUpdatingAction,
    actionsError,
    extractError,
    updateError,
    updateActionStatus,
    refetchActions,
    createAction,
    isCreatingAction,
    createError,
  } = useChatActions(isGroupChat ? chatId : undefined);
  const {
    brain,
    isLoadingBrain,
    isFetchingBrain,
    brainError,
    refetchBrain,
    askBrain,
    brainAnswer,
    isAskingBrain,
    askBrainError,
  } = useGroupBrain(isGroupChat ? chatId : undefined);

  const handleAddTaskToActions = (task: ChatSummaryTask) => {
    createAction({
      title: task.title,
      ownerName: task.assignedTo ?? undefined,
      dueDate: task.dueDate ?? undefined,
      sourceMessageIds: [task.sourceMessageId],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col bg-slate-50 shadow-2xl dark:bg-slate-950"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-teal-600" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Chat Intelligence</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close intelligence drawer"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          <IntelligencePanelBoundary title="Summary" panel="Summary" chatId={chatId} chatType={chat.type}>
            <CatchMeUpCard
              summary={summary}
              actions={actions}
              isGroupChat={isGroupChat}
              isLoading={isLoadingSummary}
              isGenerating={isGeneratingSummary}
              isCreatingAction={isCreatingAction}
              errorMessage={summaryError?.message || generateError?.message || createError?.message}
              onRetry={() => refetchSummary()}
              onCatchMeUp={() => generateSummary({ messageLimit: 200 })}
              onAddTaskToActions={handleAddTaskToActions}
            />
          </IntelligencePanelBoundary>
          {isGroupChat && (
            <>
              <IntelligencePanelBoundary title="Actions" panel="Actions" chatId={chatId} chatType={chat.type}>
                <ChatActionsPanel
                  actions={actions}
                  isLoading={isLoadingActions}
                  isUpdating={isUpdatingAction}
                  errorMessage={actionsError?.message || extractError?.message || updateError?.message}
                  onRetry={() => refetchActions()}
                  onUpdateStatus={(actionId, status) => updateActionStatus({ actionId, status })}
                />
              </IntelligencePanelBoundary>
              <IntelligencePanelBoundary title="Group Brain" panel="Group Brain" chatId={chatId} chatType={chat.type}>
                <GroupBrainPanel
                  brain={brain}
                  answer={brainAnswer}
                  isLoading={isLoadingBrain}
                  isFetching={isFetchingBrain}
                  isAsking={isAskingBrain}
                  errorMessage={brainError?.message}
                  askErrorMessage={askBrainError?.message}
                  onRefresh={() => refetchBrain()}
                  onAsk={(question) => askBrain(question)}
                />
              </IntelligencePanelBoundary>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
