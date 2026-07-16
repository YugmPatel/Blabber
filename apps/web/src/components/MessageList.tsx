import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Message } from '@repo/types';
import MessageBubble from './MessageBubble';
import DateDivider from './DateDivider';

interface MessageListProps {
  messages: Message[];
  currentUserId: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  getUserName: (userId: string) => string;
  getUserAvatar: (userId: string) => string | undefined;
  isGroupChat: boolean;
  onReply?: (message: Message) => void;
  onForward?: (message: Message) => void;
  onPin?: (message: Message) => void;
  onUnpin?: (message: Message) => void;
  onSave?: (message: Message) => void;
  onUnsave?: (message: Message) => void;
  onJumpToMessage?: (messageId: string, chatId?: string) => void;
  onOpenMoment?: (momentId: string, snapshot?: Message['momentReply']) => void;
  onEdit?: (message: Message, body: string) => Promise<void> | void;
  onReact?: (messageId: string, emoji: string) => void;
  onDelete?: (messageId: string) => void;
  onPollVote?: (messageId: string, optionIds: string[]) => void;
  onClosePoll?: (messageId: string) => void;
  onEventRsvp?: (messageId: string, status: 'going' | 'maybe' | 'declined') => void;
  onEventCancel?: (messageId: string) => void;
  onEventIcs?: (messageId: string) => void;
  highlightedMessageId?: string | null;
  onUserScrollInteraction?: () => void;
  outgoingBubbleStyle?: CSSProperties;
  scrollAreaStyle?: CSSProperties;
  onOpenUserAvatar?: (user: { userId: string; name: string; avatarUrl?: string }) => void;
}

export default function MessageList({
  messages,
  currentUserId,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  getUserName,
  getUserAvatar,
  isGroupChat,
  onReply,
  onForward,
  onPin,
  onUnpin,
  onSave,
  onUnsave,
  onJumpToMessage,
  onOpenMoment,
  onEdit,
  onReact,
  onDelete,
  onPollVote,
  onClosePoll,
  onEventRsvp,
  onEventCancel,
  onEventIcs,
  highlightedMessageId,
  onUserScrollInteraction,
  outgoingBubbleStyle,
  scrollAreaStyle,
  onOpenUserAvatar,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const observerTarget = useRef<HTMLDivElement>(null);
  const previousScrollHeight = useRef<number>(0);
  const displayMessages = useMemo(() => {
    const seenPlanIds = new Set<string>();
    return messages.filter((message) => {
      const planId = message.planThis?.planId;
      if (!planId) return true;
      if (seenPlanIds.has(planId)) return false;
      seenPlanIds.add(planId);
      return true;
    });
  }, [messages]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          // Store current scroll height before fetching
          if (scrollRef.current) {
            previousScrollHeight.current = scrollRef.current.scrollHeight;
          }
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Maintain scroll position after loading more messages
  useEffect(() => {
    if (scrollRef.current && previousScrollHeight.current > 0) {
      const newScrollHeight = scrollRef.current.scrollHeight;
      const scrollDiff = newScrollHeight - previousScrollHeight.current;
      scrollRef.current.scrollTop = scrollDiff;
      previousScrollHeight.current = 0;
    }
  }, [displayMessages.length]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (scrollRef.current && displayMessages.length > 0 && !hasNextPage) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayMessages.length, hasNextPage]);

  // Group messages by date
  const groupMessagesByDate = useCallback(() => {
    const groups: { date: Date; messages: Message[] }[] = [];
    let currentDate: Date | null = null;
    let currentGroup: Message[] = [];

    // Messages are in reverse chronological order (newest first)
    // We need to reverse to process oldest first
    const sortedMessages = [...displayMessages].reverse();

    sortedMessages.forEach((message) => {
      const messageDate = new Date(message.createdAt);
      const messageDateOnly = new Date(
        messageDate.getFullYear(),
        messageDate.getMonth(),
        messageDate.getDate()
      );

      if (!currentDate || messageDateOnly.getTime() !== currentDate.getTime()) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate!, messages: currentGroup });
        }
        currentDate = messageDateOnly;
        currentGroup = [message];
      } else {
        currentGroup.push(message);
      }
    });

    if (currentGroup.length > 0 && currentDate) {
      groups.push({ date: currentDate, messages: currentGroup });
    }

    return groups;
  }, [displayMessages]);

  const messageGroups = groupMessagesByDate();

  // Determine if avatar should be shown (first message from user in sequence)
  const shouldShowAvatar = (message: Message, index: number, groupMessages: Message[]) => {
    if (index === 0) return true;
    const prevMessage = groupMessages[index - 1];
    return prevMessage.senderId !== message.senderId;
  };

  if (displayMessages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#f8faf9] text-slate-500 dark:bg-[#071315] dark:text-slate-400" style={scrollAreaStyle}>
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-center dark:border-[#1b393c] dark:bg-[#0b1d20]">
          <p className="font-medium text-slate-700 dark:text-slate-200">No messages yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Start the conversation to see insights appear.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      className="flex-1 overflow-y-auto bg-[#f8faf9] px-6 py-5 dark:bg-[#071315] dark:[&_.bg-gray-200]:bg-slate-800 dark:[&_.text-gray-600]:text-slate-300"
      style={{ display: 'flex', flexDirection: 'column-reverse', ...scrollAreaStyle }}
      onWheel={onUserScrollInteraction}
      onTouchMove={onUserScrollInteraction}
      onPointerDown={onUserScrollInteraction}
      onScroll={onUserScrollInteraction}
      onKeyDown={(event) => {
        if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) {
          onUserScrollInteraction?.();
        }
      }}
    >
      <div className="w-full">
        {/* Loading indicator at top */}
        <div ref={observerTarget} className="h-4">
          {isFetchingNextPage && (
            <div className="flex justify-center py-2">
              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-[#0f766e]" />
            </div>
          )}
        </div>

        {/* Message groups */}
        {messageGroups.map((group, groupIndex) => (
          <div key={groupIndex}>
            <DateDivider date={group.date} />
            {group.messages.map((message, messageIndex) => {
              const isSentByMe = message.senderId === currentUserId;
              const showAvatar = shouldShowAvatar(message, messageIndex, group.messages);

              return (
                <MessageBubble
                  key={message._id}
                  message={message}
                  isSentByMe={isSentByMe}
                  currentUserId={currentUserId}
                  showAvatar={showAvatar && isGroupChat}
                  senderName={!isSentByMe && isGroupChat ? getUserName(message.senderId) : undefined}
                  senderAvatarUrl={!isSentByMe ? getUserAvatar(message.senderId) : undefined}
                  getUserName={getUserName}
                  onReply={onReply}
                  onForward={onForward}
                  onPin={onPin}
                  onUnpin={onUnpin}
                  onSave={onSave}
                  onUnsave={onUnsave}
                  onJumpToMessage={onJumpToMessage}
                  onOpenMoment={onOpenMoment}
                  onEdit={onEdit}
                  onReact={onReact}
                  onDelete={onDelete}
                  onPollVote={onPollVote}
                  onClosePoll={onClosePoll}
                  onEventRsvp={onEventRsvp}
                  onEventCancel={onEventCancel}
                  onEventIcs={onEventIcs}
                  highlighted={message._id === highlightedMessageId}
                  outgoingBubbleStyle={outgoingBubbleStyle}
                  onAvatarClick={
                    !isSentByMe
                      ? () =>
                          onOpenUserAvatar?.({
                            userId: message.senderId,
                            name: getUserName(message.senderId),
                            avatarUrl: getUserAvatar(message.senderId),
                          })
                      : undefined
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
