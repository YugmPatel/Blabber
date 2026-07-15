import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Component, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ExternalLink, FileText, Image as ImageIcon, Link as LinkIcon, Loader2, Search, Send, Sparkles, X } from 'lucide-react';
import { chatKeys, useChat, useChats } from '@/hooks/useChats';
import { messageKeys, useMessages, useDeleteMessage, useAddReaction, useVotePoll, useMarkMessagesRead, useForwardMessage, useMessagePins, usePinMessage, useSaveMessage, useUnpinMessage, useUnsaveMessage, useSharedContent, useClosePoll, useRsvpEvent, useCancelEvent, useDownloadEventIcs } from '@/hooks/useMessages';
import { useChatActions } from '@/hooks/useChatActions';
import { useGroupBrain } from '@/hooks/useGroupBrain';
import { useChatSummary } from '@/hooks/useChatSummary';
import { useUser, useUserPresence } from '@/hooks/useUsers';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient, fetchMessageWindow, normalizeMediaUrl } from '@/api/client';
import type { SharedContentItem, SharedContentType } from '@/api/client';
import { useAppStore } from '@/store/app-store';
import ChatHeader from '@/components/ChatHeader';
import ChatActionsPanel, { ActionForm, type ActionOwnerOption } from '@/components/ChatActionsPanel';
import GroupBrainPanel from '@/components/GroupBrainPanel';
import CatchMeUpCard from '@/components/CatchMeUpCard';
import SourceEvidence from '@/components/SourceEvidence';
import MessageList from '@/components/MessageList';
import TypingDots from '@/components/TypingDots';
import { Composer } from '@/components/Composer';
import { canJumpToSource, sourceJumpPath } from '@/lib/source-jump';
import { canSendToChat, isChatEnded, isGroupAdmin } from '@/utils/chat-permissions';
import type { Chat, ChatSummaryTask, Message, SourceReference } from '@repo/types';

interface MessagesPage {
  messages: Message[];
  nextCursor: string | null;
}

interface MessagesData {
  pages: MessagesPage[];
  pageParams: unknown[];
}

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
  { children: ReactNode; title: string; panel: 'Summary' | 'Actions' | 'Group Brain' | 'Ask Chat'; chatId: string; chatType: string },
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const { getTypingUsers, socket, setActiveChat } = useAppStore();
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [isPinsOpen, setIsPinsOpen] = useState(false);
  const [isSharedOpen, setIsSharedOpen] = useState(false);
  const [isIntelligenceOpen, setIsIntelligenceOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [sourceMessageError, setSourceMessageError] = useState<string | null>(null);
  const handledJumpKeyRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const suppressScrollClearUntilRef = useRef(0);
  const [isViewingChat, setIsViewingChat] = useState(() =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible' && document.hasFocus()
  );

  // Fetch chat details
  const { data: chat, isLoading: chatLoading } = useChat(id);
  const { data: allChats = [] } = useChats();
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
  const messages = useMemo(
    () => messagesData?.pages.flatMap((page) => page.messages) || [],
    [messagesData]
  );
  const targetMessageId = searchParams.get('message');

  const clearHighlightTimer = useCallback(() => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }, []);

  const clearSourceHighlight = useCallback(() => {
    clearHighlightTimer();
    setHighlightedMessageId(null);
  }, [clearHighlightTimer]);

  const cleanupSourceMessageParam = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('message');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Determine if this is a group chat
  const isGroupChat = chat?.type === 'group';
  const isEndedTemporaryGroup = Boolean(chat && isChatEnded(chat));
  // Direct chats only — canMessage/blockedState are omitted for group chats,
  // which aren't subject to 1:1 block rules. blockedState never reveals that
  // the other participant specifically blocked us; only our own block choice
  // is distinguished ('blocked_by_me') so the copy can stay non-scary.
  const isBlockedDirectChat = Boolean(
    chat?.type === 'direct' && chat.blockedState && chat.blockedState !== 'none'
  );
  const blockedBannerText =
    chat?.blockedState === 'blocked_by_me'
      ? 'You blocked this user. Unblock to message again.'
      : "You can't message this user.";
  // Composer stays mounted for admins-only (unlike the ended/blocked cases,
  // which unmount it entirely) so it can show itself disabled with a reason,
  // matching the requirement that a non-admin sees why they can't send
  // rather than the input just disappearing.
  const isAdminOnlyBlocked = Boolean(
    chat &&
    isGroupChat &&
    !isEndedTemporaryGroup &&
    chat.sendMode === 'admins_only' &&
    !isGroupAdmin(chat, currentUser?._id)
  );
  const composerCanSend = chat ? canSendToChat(chat, currentUser?._id) : false;
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
  const closePollMutation = useClosePoll(id || '');
  const rsvpEventMutation = useRsvpEvent(id || '');
  const cancelEventMutation = useCancelEvent(id || '');
  const downloadEventIcsMutation = useDownloadEventIcs();
  const markReadMutation = useMarkMessagesRead(id || '');
  const forwardMessageMutation = useForwardMessage();
  const { data: pinData } = useMessagePins(id);
  const pinMessageMutation = usePinMessage(id || '');
  const unpinMessageMutation = useUnpinMessage(id || '');
  const saveMessageMutation = useSaveMessage();
  const unsaveMessageMutation = useUnsaveMessage();
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
      deleteMessageMutation.mutate(messageId);
    },
    [deleteMessageMutation]
  );

  const handlePollVote = useCallback(
    (messageId: string, optionIds: string[]) => {
      if (optionIds.length === 0) return;
      votePollMutation.mutate({ messageId, data: { optionIds } });
    },
    [votePollMutation]
  );

  const handleEventRsvp = useCallback(
    (messageId: string, status: 'going' | 'maybe' | 'declined') => {
      rsvpEventMutation.mutate({ messageId, status });
    },
    [rsvpEventMutation]
  );

  const handleEventCancel = useCallback(
    (messageId: string) => {
      if (window.confirm('Cancel this event?')) {
        cancelEventMutation.mutate(messageId);
      }
    },
    [cancelEventMutation]
  );

  const jumpToMessage = useCallback(
    (messageId: string, chatId?: string) => {
      const targetChatId = chatId || id;
      if (!targetChatId) return;
      setSourceMessageError(null);
      if (targetChatId === id) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set('message', messageId);
          return next;
        });
        return;
      }
      navigate(sourceJumpPath({ chatId: targetChatId, messageId }));
    },
    [id, navigate, setSearchParams]
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

  useEffect(() => {
    if (!targetMessageId) {
      handledJumpKeyRef.current = null;
      return;
    }
  }, [targetMessageId]);

  useEffect(() => {
    clearSourceHighlight();
    setSourceMessageError(null);
    handledJumpKeyRef.current = null;
  }, [clearSourceHighlight, id]);

  useEffect(() => {
    return () => {
      clearHighlightTimer();
    };
  }, [clearHighlightTimer]);

  useEffect(() => {
    if (!id || !targetMessageId) return;
    const jumpKey = `${id}:${targetMessageId}`;
    if (handledJumpKeyRef.current === jumpKey) return;
    handledJumpKeyRef.current = jumpKey;
    let cancelled = false;

    const existing = messages.some((message) => message._id === targetMessageId);
    const reveal = () => {
      let attempts = 0;
      const maxAttempts = 60;

      const tryReveal = () => {
        if (cancelled) return;
        const element = document.querySelector(`[data-message-id="${targetMessageId}"]`);
        if (!element) {
          attempts += 1;
          if (attempts >= maxAttempts) {
            setSourceMessageError('This source message could not be shown. Try opening the chat again.');
            return;
          }
          window.requestAnimationFrame(tryReveal);
          return;
        }

        suppressScrollClearUntilRef.current = Date.now() + 600;
        element.scrollIntoView({ block: 'center' });
        setHighlightedMessageId(targetMessageId);
        setSourceMessageError(null);
        cleanupSourceMessageParam();
        clearHighlightTimer();
        highlightTimerRef.current = window.setTimeout(() => {
          if (!cancelled) setHighlightedMessageId((current) => (current === targetMessageId ? null : current));
          highlightTimerRef.current = null;
        }, 8000);
      };

      window.requestAnimationFrame(tryReveal);
    };

    if (existing) {
      reveal();
      return () => {
        cancelled = true;
      };
    }

    fetchMessageWindow(id, targetMessageId)
      .then((windowData) => {
        if (cancelled) return;
        setSourceMessageError(null);
        queryClient.setQueryData<MessagesData>(messageKeys.list(id), (old) => {
          const page = {
            messages: windowData.messages,
            nextCursor: null,
          };
          if (!old?.pages?.length) {
            return { pages: [page], pageParams: [undefined] };
          }
          const seen = new Set<string>();
          const pages = old.pages.map((existingPage, index) => {
            const mergedMessages = index === 0
              ? [...windowData.messages, ...(existingPage.messages || [])]
              : existingPage.messages || [];
            return {
              ...existingPage,
              messages: mergedMessages.filter((message) => {
                if (seen.has(message._id)) return false;
                seen.add(message._id);
                return true;
              }),
            };
          });
          return { ...old, pages };
        });
        reveal();
      })
      .catch(() => {
        if (!cancelled) {
          handledJumpKeyRef.current = null;
          clearSourceHighlight();
          setSourceMessageError('This source message is no longer available.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cleanupSourceMessageParam, clearHighlightTimer, clearSourceHighlight, id, targetMessageId, messages, queryClient]);

  const handleMessageListInteraction = useCallback(() => {
    if (!highlightedMessageId) return;
    if (Date.now() < suppressScrollClearUntilRef.current) return;
    clearSourceHighlight();
  }, [clearSourceHighlight, highlightedMessageId]);

  const jumpToSource = useCallback(
    (source: SourceReference) => {
      if (!canJumpToSource(source)) return;
      setIsIntelligenceOpen(false);
      setSourceMessageError(null);
      if (source.chatId === id) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set('message', source.messageId);
          return next;
        });
        return;
      }
      navigate(sourceJumpPath(source));
    },
    [id, navigate, setSearchParams]
  );

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
      const userWithLegacyAvatar = currentUser as typeof currentUser & { avatar?: string };
      return userWithLegacyAvatar?.avatarUrl || userWithLegacyAvatar?.avatar;
    }
    if (userId === otherUserId) {
      return otherUser?.avatarUrl;
    }
    return participantProfiles.get(userId)?.avatarUrl;
  }

  // Loading state
  if (chatLoading || messagesLoading) {
    return (
      <div className="flex h-full flex-col bg-white dark:bg-slate-900">
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-teal-600 dark:border-teal-400" />
        </div>
      </div>
    );
  }

  // Error state
  if (!chat) {
    return (
      <div className="flex h-full flex-col bg-white dark:bg-slate-900">
        <div className="flex h-full items-center justify-center px-6">
          <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-base font-semibold text-slate-900 dark:text-white">Chat not available</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              This chat may have been deleted, ended, or you may no longer have access.
            </p>
            <button
              type="button"
              onClick={() => navigate('/chats')}
              className="bl-focus-ring mt-4 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
            >
              Back to Convo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 md:hidden">
        <button
          type="button"
          onClick={() => navigate('/chats')}
          className="bl-focus-ring inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowLeft size={16} />
          Convos
        </button>
      </div>
      <ChatHeader
        chat={chat}
        getChatTitle={getChatTitle}
        getChatAvatar={getChatAvatar}
        onlineStatus={!isGroupChat ? otherUserPresence : null}
        isGroupChat={isGroupChat}
        intelligenceEnabled={chatIntelligenceEnabled}
        intelligenceOpen={isIntelligenceOpen}
        onOpenIntelligence={() => setIsIntelligenceOpen(true)}
        onJumpToMessage={(messageId) => jumpToMessage(messageId, chat._id)}
        pinnedCount={pinData?.pins.length || 0}
        onOpenPins={() => setIsPinsOpen(true)}
        onOpenShared={() => setIsSharedOpen(true)}
      />

      {isEndedTemporaryGroup && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          This temporary group has ended.
        </div>
      )}

      {isBlockedDirectChat && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {blockedBannerText}
        </div>
      )}

      {isAdminOnlyBlocked && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          Only admins can send messages in this group.
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
        onReply={isBlockedDirectChat ? undefined : handleReply}
        onForward={setForwardingMessage}
        onPin={(message) => pinMessageMutation.mutate(message._id)}
        onUnpin={(message) => unpinMessageMutation.mutate(message._id)}
        onSave={(message) => saveMessageMutation.mutate(message._id)}
        onUnsave={(message) => unsaveMessageMutation.mutate(message._id)}
        onJumpToMessage={jumpToMessage}
        onReact={isBlockedDirectChat ? undefined : handleReact}
        onDelete={handleDelete}
        onPollVote={isBlockedDirectChat ? undefined : handlePollVote}
        onClosePoll={isBlockedDirectChat ? undefined : (messageId) => closePollMutation.mutate(messageId)}
        onEventRsvp={isBlockedDirectChat ? undefined : handleEventRsvp}
        onEventCancel={isBlockedDirectChat ? undefined : handleEventCancel}
        onEventIcs={(messageId) => downloadEventIcsMutation.mutate(messageId)}
        highlightedMessageId={highlightedMessageId}
        onUserScrollInteraction={handleMessageListInteraction}
      />

      {sourceMessageError && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {sourceMessageError}
        </div>
      )}

      {typingUserNames.length > 0 && (
        <div className="border-t border-slate-100 bg-white px-4 py-1 dark:border-slate-800 dark:bg-slate-900">
          <TypingDots userNames={typingUserNames} />
        </div>
      )}

      {!isEndedTemporaryGroup && !isBlockedDirectChat && (
        <Composer
          chatId={id!}
          replyToMessage={replyToMessage}
          onCancelReply={handleCancelReply}
          chat={chat}
          currentUserId={currentUser?._id}
          canSend={composerCanSend}
          mentionsEnabled={chat.type === 'group' && !isEndedTemporaryGroup}
        />
      )}

      {isPinsOpen && (
        <PinnedMessagesPanel
          pins={pinData?.pins || []}
          canManagePins={Boolean(pinData?.canManagePins)}
          onClose={() => setIsPinsOpen(false)}
          onJump={(messageId) => {
            setIsPinsOpen(false);
            jumpToMessage(messageId, chat._id);
          }}
          onUnpin={(messageId) => unpinMessageMutation.mutate(messageId)}
        />
      )}

      {isSharedOpen && (
        <SharedContentPanel
          chatTitle={getChatTitle(chat)}
          chatId={chat._id}
          onClose={() => setIsSharedOpen(false)}
          onJump={(messageId) => {
            setIsSharedOpen(false);
            jumpToMessage(messageId, chat._id);
          }}
        />
      )}

      <ForwardMessageModal
        message={forwardingMessage}
        chats={allChats.filter(
          (candidate) =>
            candidate._id !== id &&
            // Forwarding FROM a chat you can't currently send into is fine
            // (it's just old content), but forwarding INTO one is a new
            // message — exclude blocked direct chats, ended temporary
            // groups, admins-only groups you're not an admin of, and groups
            // you've been individually restricted in, same policy the
            // backend enforces for the send itself.
            canSendToChat(candidate, currentUser?._id)
        )}
        currentUserId={currentUser?._id}
        onClose={() => setForwardingMessage(null)}
        onForward={async (destinationChatIds) => {
          if (!forwardingMessage) return;
          await forwardMessageMutation.mutateAsync({
            messageId: forwardingMessage._id,
            destinationChatIds,
          });
          setForwardingMessage(null);
        }}
        isForwarding={forwardMessageMutation.isPending}
        errorMessage={
          forwardMessageMutation.error instanceof Error
            ? forwardMessageMutation.error.message
            : null
        }
      />

      {isIntelligenceOpen && chatIntelligenceEnabled && (
        <ChatIntelligenceErrorBoundary onClose={() => setIsIntelligenceOpen(false)} chatId={id} chatType={chat.type}>
          <ChatIntelligenceDrawer
            chatId={id!}
            chat={chat}
            onClose={() => setIsIntelligenceOpen(false)}
            onJumpToSource={jumpToSource}
          />
        </ChatIntelligenceErrorBoundary>
      )}
    </div>
  );
}

function ForwardMessageModal({
  message,
  chats,
  currentUserId,
  onClose,
  onForward,
  isForwarding,
  errorMessage,
}: {
  message: Message | null;
  chats: Chat[];
  currentUserId?: string;
  onClose: () => void;
  onForward: (destinationChatIds: string[]) => Promise<void>;
  isForwarding: boolean;
  errorMessage: string | null;
}) {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!message) {
      setQuery('');
      setSelectedIds([]);
    }
  }, [message]);

  if (!message) return null;

  const messageLabel = message.body || message.media?.fileName || message.poll?.question || message.event?.title || message.sticker?.label || 'Message';
  const filteredChats = chats.filter((chat) => {
    const title = chat.type === 'group'
      ? chat.title || 'Group chat'
      : chat.participantProfiles?.find((profile) => profile._id !== currentUserId)?.name || 'Direct chat';
    return title.toLowerCase().includes(query.trim().toLowerCase());
  });

  const toggleChat = (chatId: string) => {
    setSelectedIds((current) =>
      current.includes(chatId)
        ? current.filter((id) => id !== chatId)
        : current.length >= 10
          ? current
          : [...current, chatId]
    );
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[82vh] w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Forward message</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{messageLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="border-b border-slate-100 p-3 dark:border-slate-800">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filteredChats.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No chats found</p>
          ) : (
            filteredChats.map((chat) => {
              const title = chat.type === 'group'
                ? chat.title || 'Group chat'
                : chat.participantProfiles?.find((profile) => profile._id !== currentUserId)?.name || 'Direct chat';
              const selected = selectedIds.includes(chat._id);
              return (
                <button
                  key={chat._id}
                  type="button"
                  onClick={() => toggleChat(chat._id)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{title}</span>
                    <span className="text-xs capitalize text-slate-500 dark:text-slate-400">{chat.type}</span>
                  </span>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                    selected ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 dark:border-slate-600'
                  }`}>
                    {selected && <Check size={13} />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {errorMessage && (
          <p className="border-t border-rose-100 px-4 py-2 text-xs font-medium text-rose-600 dark:border-rose-900/50 dark:text-rose-300">
            {errorMessage}
          </p>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0 || isForwarding}
            onClick={() => onForward(selectedIds)}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isForwarding ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Forward
          </button>
        </footer>
      </div>
    </div>
  );
}

function SharedContentPanel({
  chatTitle,
  chatId,
  onClose,
  onJump,
}: {
  chatTitle: string;
  chatId: string;
  onClose: () => void;
  onJump: (messageId: string) => void;
}) {
  const [tab, setTab] = useState<SharedContentType>('media');
  const query = useSharedContent(chatId, tab);
  const items = query.data?.pages.flatMap((page) => page.items) || [];
  const tabs: Array<{ id: SharedContentType; label: string; icon: typeof ImageIcon }> = [
    { id: 'media', label: 'Media', icon: ImageIcon },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'links', label: 'Links', icon: LinkIcon },
  ];

  const emptyText =
    tab === 'documents'
      ? 'No documents shared in this chat yet.'
      : tab === 'links'
        ? 'No links shared in this chat yet.'
        : 'No media shared in this chat yet.';

  return (
    <div className="fixed inset-0 z-[115] flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Shared</h2>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{chatTitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="Close shared content"
            >
              <X size={18} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {tabs.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                    tab === entry.id
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon size={14} />
                  {entry.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {query.isLoading ? (
            <div className="flex h-40 items-center justify-center text-slate-500">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>
          ) : tab === 'media' ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((item) => (
                <SharedMediaItem key={item.id} item={item} onJump={onJump} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <SharedListItem key={item.id} item={item} onJump={onJump} />
              ))}
            </div>
          )}
          {query.hasNextPage && (
            <button
              type="button"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="mt-4 w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {query.isFetchingNextPage ? 'Loading...' : 'Load more'}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function SharedMediaItem({ item, onJump }: { item: SharedContentItem; onJump: (messageId: string) => void }) {
  const url = normalizeMediaUrl(item.attachment?.thumbnailUrl || item.attachment?.url);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <button type="button" onClick={() => onJump(item.messageId)} className="block aspect-square w-full bg-slate-100 dark:bg-slate-800">
        {url ? (
          <img src={url} alt={item.attachment?.fileName || item.snippet || 'Shared media'} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-slate-400">
            <ImageIcon size={24} />
          </span>
        )}
      </button>
      <div className="p-2">
        <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">{item.senderDisplayName}</p>
        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{new Date(item.createdAt).toLocaleDateString()}</p>
      </div>
    </div>
  );
}

function SharedListItem({ item, onJump }: { item: SharedContentItem; onJump: (messageId: string) => void }) {
  const isLink = item.kind === 'link';
  const href = isLink ? item.link?.url : normalizeMediaUrl(item.attachment?.url);
  const title = isLink ? item.link?.hostname || item.link?.url : item.attachment?.fileName || item.attachment?.label || 'File unavailable.';
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          {isLink ? <LinkIcon size={16} /> : <FileText size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
          {isLink && item.link?.url && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.link.url}</p>}
          {!isLink && (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {[item.attachment?.mimeType, item.attachment?.size ? `${Math.round(item.attachment.size / 1024)} KB` : ''].filter(Boolean).join(' • ') || 'File unavailable.'}
            </p>
          )}
          <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{item.snippet}</p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {item.senderDisplayName} · {new Date(item.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30"
          >
            <ExternalLink size={13} />
            Open
          </a>
        )}
        <button
          type="button"
          onClick={() => onJump(item.messageId)}
          className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-950"
        >
          Jump
        </button>
      </div>
    </div>
  );
}

function PinnedMessagesPanel({
  pins,
  canManagePins,
  onClose,
  onJump,
  onUnpin,
}: {
  pins: Array<{
    messageId: string;
    pinnedAt: string;
    preview: {
      senderDisplayName: string;
      snippet: string;
      type?: string;
      attachmentLabel?: string;
      createdAt: string;
    };
  }>;
  canManagePins: boolean;
  onClose: () => void;
  onJump: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-[115] flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-sm flex-col bg-white shadow-2xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Pinned Messages</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close pinned messages"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-3">
          {pins.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">No pinned messages</p>
          ) : (
            <div className="space-y-2">
              {pins.map((pin) => (
                <div key={pin.messageId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {pin.preview.senderDisplayName}
                    </p>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                      {new Date(pin.preview.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                    {pin.preview.snippet || pin.preview.attachmentLabel || 'Pinned message unavailable.'}
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    {canManagePins && (
                      <button
                        type="button"
                        onClick={() => onUnpin(pin.messageId)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
                      >
                        Unpin
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onJump(pin.messageId)}
                      className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-950"
                    >
                      Jump
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ChatIntelligenceDrawer({
  chatId,
  chat,
  onClose,
  onJumpToSource,
}: {
  chatId: string;
  chat: Chat;
  onClose: () => void;
  onJumpToSource: (source: SourceReference) => void;
}) {
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
    updateAction,
    addActionUpdate,
    deleteAction,
    refetchActions,
    createAction,
    isCreatingAction,
    createError,
  } = useChatActions(chatId);
  const {
    brainError,
    askBrain,
    isAskingBrain,
  } = useGroupBrain(chatId);

  const { user: currentUser } = useAuth();
  const [pendingTask, setPendingTask] = useState<ChatSummaryTask | null>(null);
  const [activeIntelligenceTab, setActiveIntelligenceTab] = useState<'catch-up' | 'actions' | 'brain'>('catch-up');
  const askTabLabel = isGroupChat ? 'Group Brain' : 'Ask Chat';
  const participantProfiles = new Map((chat.participantProfiles || []).map((profile) => [profile._id, profile]));
  const currentUserCanManageActions = Boolean(
    currentUser?._id &&
    ((chat.ownerId || chat.admins?.[0]) === currentUser._id || chat.admins?.includes(currentUser._id))
  );
  const ownerOptions: ActionOwnerOption[] = chat.participants.map((participantId) => {
    const profile = participantProfiles.get(participantId);
    return {
      userId: participantId,
      name: profile?.name || profile?.username || (participantId === currentUser?._id ? currentUser.name || currentUser.username || 'You' : participantId),
    };
  });
  const actionOwnerOptions = currentUserCanManageActions
    ? ownerOptions
    : ownerOptions.filter((option) => option.userId === currentUser?._id);

  const handleAddTaskToActions = (task: ChatSummaryTask) => {
    if (isGroupChat && !currentUserCanManageActions && task.assignedToUserId && task.assignedToUserId !== currentUser?._id) {
      return;
    }
    if (!isGroupChat && task.assignedToUserId && task.assignedToUserId !== currentUser?._id) {
      return;
    }
    setPendingTask(task);
  };

  const handleOpenAction = (action: { id?: string }) => {
    if (!action.id) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`action-${action.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col bg-slate-50 shadow-2xl dark:bg-slate-950"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
              <Sparkles size={17} />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Chat Intelligence</h2>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {isGroupChat
                  ? 'Summaries, actions, and answers from this group chat'
                  : 'Summaries, actions, and answers from this conversation'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close intelligence drawer"
          >
            <X size={18} />
          </button>
        </header>

        <div className="border-b border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-950">
            {([
              ['catch-up', 'Catch Me Up'],
              ['actions', 'Actions'],
              ['brain', askTabLabel],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveIntelligenceTab(value)}
                aria-pressed={activeIntelligenceTab === value}
                className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                  activeIntelligenceTab === value
                    ? 'bg-white text-teal-700 shadow-sm ring-1 ring-teal-500/20 dark:bg-slate-800 dark:text-teal-300 dark:ring-teal-400/20'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeIntelligenceTab === 'catch-up' && (
            <IntelligencePanelBoundary title="Summary" panel="Summary" chatId={chatId} chatType={chat.type}>
              <CatchMeUpCard
                summary={summary}
                actions={actions}
                isGroupChat={isGroupChat}
                isLoading={isLoadingSummary}
                isGenerating={isGeneratingSummary}
                isCreatingAction={isCreatingAction}
                currentUserId={currentUser?._id}
                currentUserCanManageActions={currentUserCanManageActions}
                errorMessage={summaryError?.message || generateError?.message || createError?.message}
                onRetry={() => refetchSummary()}
                onCatchMeUp={() => generateSummary({ messageLimit: 200 })}
                onAddTaskToActions={handleAddTaskToActions}
                onOpenAction={handleOpenAction}
                onJumpToSource={onJumpToSource}
              />
            </IntelligencePanelBoundary>
          )}

          {activeIntelligenceTab === 'actions' && (
            <IntelligencePanelBoundary title="Actions" panel="Actions" chatId={chatId} chatType={chat.type}>
              <ChatActionsPanel
                actions={actions}
                isLoading={isLoadingActions}
                isUpdating={isUpdatingAction}
                isCreating={isCreatingAction}
                ownerOptions={actionOwnerOptions}
                defaultOwnerUserId={currentUser?._id}
                currentUserCanManageActions={currentUserCanManageActions}
                errorMessage={actionsError?.message || extractError?.message || updateError?.message}
                onRetry={() => refetchActions()}
                onCreateAction={(payload) => createAction(payload)}
                onUpdateAction={(actionId, patch) => updateAction({ actionId, patch })}
                onUpdateStatus={(actionId, status) => updateActionStatus({ actionId, status })}
                onAddUpdate={(actionId, body) => addActionUpdate({ actionId, body })}
                onDeleteAction={(actionId, reason) => deleteAction({ actionId, reason })}
                onJumpToSource={onJumpToSource}
              />
            </IntelligencePanelBoundary>
          )}

          {activeIntelligenceTab === 'brain' && (
            <IntelligencePanelBoundary title={askTabLabel} panel={askTabLabel} chatId={chatId} chatType={chat.type}>
              <GroupBrainPanel
                mode={isGroupChat ? 'group' : 'direct'}
                isAsking={isAskingBrain}
                errorMessage={brainError?.message}
                onAsk={(question) => askBrain(question)}
                onJumpToSource={onJumpToSource}
              />
            </IntelligencePanelBoundary>
          )}
        </div>
        {pendingTask && (
          <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Confirm action</p>
            <ActionForm
              action={{
                id: 'pending-summary-task',
                chatId,
                type: 'task',
                title: pendingTask.title,
                assignedTo: currentUserCanManageActions
                  ? { userId: pendingTask.assignedToUserId ?? currentUser?._id, name: pendingTask.assignedTo ?? currentUser?.name ?? currentUser?.username ?? undefined }
                  : { userId: currentUser?._id, name: currentUser?.name ?? currentUser?.username ?? 'You' },
                dueDate: pendingTask.dueDate ?? undefined,
                status: 'open',
                sourceMessageIds: [pendingTask.sourceMessageId],
              }}
              ownerOptions={actionOwnerOptions}
              isSaving={isCreatingAction}
                defaultOwnerUserId={currentUserCanManageActions ? pendingTask.assignedToUserId ?? currentUser?._id : currentUser?._id}
                existingActions={actions}
              ownerLocked={!isGroupChat || !currentUserCanManageActions}
              onCancel={() => setPendingTask(null)}
              onUpdate={(_actionId, patch) => {
                createAction({
                  title: patch.title || pendingTask.title,
                  description: patch.description,
                  ownerUserId: patch.ownerUserId,
                  ownerName: patch.ownerName || pendingTask.assignedTo || undefined,
                  dueDate: patch.dueDate || pendingTask.dueDate || undefined,
                  dueAt: patch.dueAt || patch.dueDate || pendingTask.dueDate || undefined,
                  sourceMessageIds: [pendingTask.sourceMessageId],
                });
                setPendingTask(null);
              }}
            >
              <SourceEvidence sources={pendingTask.sources} compact onJump={onJumpToSource} />
            </ActionForm>
          </div>
        )}
      </aside>
    </div>
  );
}
