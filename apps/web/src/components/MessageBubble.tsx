import { useState } from 'react';
import type { Message } from '@repo/types';
import Avatar from './Avatar';
import ReadReceipts from './ReadReceipts';

interface MessageBubbleProps {
  message: Message;
  isSentByMe: boolean;
  showAvatar?: boolean;
  senderName?: string;
  senderAvatarUrl?: string;
  onReply?: (message: Message) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onDelete?: (messageId: string) => void;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function MessageBubble({
  message,
  isSentByMe,
  showAvatar = true,
  senderName,
  senderAvatarUrl,
  onReply,
  onReact,
  onDelete,
}: MessageBubbleProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const renderMedia = () => {
    if (!message.media) return null;

    const { type, url, thumbnailUrl, duration } = message.media;

    if (type === 'image') {
      return (
        <img
          src={thumbnailUrl || url}
          alt="Shared image"
          className="max-w-xs rounded-lg mb-1 cursor-pointer hover:opacity-90"
          onClick={() => window.open(url, '_blank')}
        />
      );
    }

    if (type === 'audio') {
      return (
        <div className="flex items-center gap-2 mb-1">
          <audio controls className="max-w-xs">
            <source src={url} />
            Your browser does not support the audio element.
          </audio>
          {duration && <span className="text-xs text-gray-500">{Math.floor(duration)}s</span>}
        </div>
      );
    }

    if (type === 'document') {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-1 flex items-center gap-2 rounded-lg bg-gray-100 p-2 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600"
        >
          <svg
            className="h-6 w-6 text-gray-600 dark:text-slate-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          <span className="text-sm">Document</span>
        </a>
      );
    }

    return null;
  };

  const renderReplyPreview = () => {
    if (!message.replyTo) return null;

    return (
      <div className="mb-2 rounded border-l-4 border-gray-400 bg-gray-100 py-1 pl-2 dark:border-slate-500 dark:bg-slate-700/70">
        <p className="text-xs font-semibold text-gray-600 dark:text-slate-300">Replying to</p>
        <p className="truncate text-sm text-gray-700 dark:text-slate-200">{message.replyTo.body}</p>
      </div>
    );
  };

  const renderReactions = () => {
    if (!message.reactions || message.reactions.length === 0) return null;

    // Group reactions by emoji
    const reactionGroups = message.reactions.reduce(
      (acc, reaction) => {
        if (!acc[reaction.emoji]) {
          acc[reaction.emoji] = 0;
        }
        acc[reaction.emoji]++;
        return acc;
      },
      {} as Record<string, number>
    );

    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {Object.entries(reactionGroups).map(([emoji, count]) => (
          <div
            key={emoji}
            className="flex items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
          >
            <span>{emoji}</span>
            {count > 1 && <span className="text-gray-600 dark:text-slate-300">{count}</span>}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={`flex gap-2 mb-4 ${isSentByMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      {showAvatar && !isSentByMe && (
        <div className="flex-shrink-0">
          <Avatar src={senderAvatarUrl} alt={senderName || 'User'} size="sm" />
        </div>
      )}
      {showAvatar && isSentByMe && <div className="w-8" />}

      {/* Message content */}
      <div className={`flex max-w-[72%] flex-col ${isSentByMe ? 'items-end' : 'items-start'}`}>
        {/* Sender name for group chats */}
        {!isSentByMe && senderName && (
          <span className="mb-1 px-1 text-xs text-gray-600 dark:text-slate-400">{senderName}</span>
        )}

        {/* Message bubble with hover menu */}
        <div className="relative group">
          {/* Hover actions */}
          <div
            className={`absolute top-0 ${isSentByMe ? 'left-0 -translate-x-full pr-2' : 'right-0 translate-x-full pl-2'} opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1`}
          >
            {/* Reaction button */}
            <button
              onClick={() => setShowReactions(!showReactions)}
              className="rounded-full bg-white p-1.5 text-gray-600 shadow-md hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              title="React"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-4-8c.79 0 1.5-.71 1.5-1.5S8.79 9 8 9s-1.5.71-1.5 1.5S7.21 12 8 12zm8 0c.79 0 1.5-.71 1.5-1.5S16.79 9 16 9s-1.5.71-1.5 1.5.71 1.5 1.5 1.5zm-4 5.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
              </svg>
            </button>

            {/* Reply button */}
            {onReply && (
              <button
                onClick={() => onReply(message)}
                className="rounded-full bg-white p-1.5 text-gray-600 shadow-md hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                title="Reply"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
                </svg>
              </button>
            )}

            {/* More options */}
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="rounded-full bg-white p-1.5 text-gray-600 shadow-md hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              title="More"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
              </svg>
            </button>
          </div>

          {/* Quick reactions popup */}
          {showReactions && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowReactions(false)} />
              <div
                className={`absolute bottom-full mb-2 ${isSentByMe ? 'right-0' : 'left-0'} z-20 flex gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800`}
              >
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      onReact?.(message._id, emoji);
                      setShowReactions(false);
                    }}
                    className="p-1 text-xl transition-transform hover:scale-125"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* More options menu */}
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div
                className={`absolute top-full mt-1 ${isSentByMe ? 'right-0' : 'left-0'} z-20 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800`}
              >
                {onReply && (
                  <button
                    onClick={() => {
                      onReply(message);
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
                    </svg>
                    Reply
                  </button>
                )}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(message.body);
                    setShowMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                  </svg>
                  Copy
                </button>
                {isSentByMe && onDelete && (
                  <button
                    onClick={() => {
                      onDelete(message._id);
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 dark:text-rose-400 dark:hover:bg-slate-700"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                    Delete
                  </button>
                )}
              </div>
            </>
          )}

          <div
            className={`rounded-2xl px-3.5 py-2.5 shadow-sm ${
              isSentByMe
                ? 'bg-slate-900 text-slate-100 dark:bg-teal-600 dark:text-white'
                : 'border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
            }`}
          >
            {renderReplyPreview()}
            {renderMedia()}
            {message.body && (
              <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
            )}

            {/* Time and status */}
            <div
              className={`mt-1 flex items-center gap-1 text-xs ${
                isSentByMe ? 'text-slate-300 dark:text-teal-50/80' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span>{formatTime(message.createdAt)}</span>
              {message.editedAt && <span>(edited)</span>}
              <ReadReceipts status={message.status} isSentByMe={isSentByMe} />
            </div>
          </div>
        </div>

        {/* Reactions */}
        {renderReactions()}
      </div>
    </div>
  );
}
