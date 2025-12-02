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
          className="flex items-center gap-2 p-2 bg-gray-100 rounded-lg mb-1 hover:bg-gray-200"
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
      <div className="bg-gray-100 border-l-4 border-gray-400 pl-2 py-1 mb-2 rounded">
        <p className="text-xs text-gray-600 font-semibold">Replying to</p>
        <p className="text-sm text-gray-700 truncate">{message.replyTo.body}</p>
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
      <div className="flex flex-wrap gap-1 mt-1">
        {Object.entries(reactionGroups).map(([emoji, count]) => (
          <div
            key={emoji}
            className="bg-gray-100 border border-gray-300 rounded-full px-2 py-0.5 text-xs flex items-center gap-1"
          >
            <span>{emoji}</span>
            {count > 1 && <span className="text-gray-600">{count}</span>}
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
      <div className={`flex flex-col ${isSentByMe ? 'items-end' : 'items-start'} max-w-[70%]`}>
        {/* Sender name for group chats */}
        {!isSentByMe && senderName && (
          <span className="text-xs text-gray-600 mb-1 px-1">{senderName}</span>
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
              className="p-1.5 rounded-full bg-white shadow-md hover:bg-gray-100 text-gray-600"
              title="React"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-4-8c.79 0 1.5-.71 1.5-1.5S8.79 9 8 9s-1.5.71-1.5 1.5S7.21 12 8 12zm8 0c.79 0 1.5-.71 1.5-1.5S16.79 9 16 9s-1.5.71-1.5 1.5.71 1.5 1.5 1.5zm-4 5.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
              </svg>
            </button>

            {/* Reply button */}
            {onReply && (
              <button
                onClick={() => onReply(message)}
                className="p-1.5 rounded-full bg-white shadow-md hover:bg-gray-100 text-gray-600"
                title="Reply"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
                </svg>
              </button>
            )}

            {/* More options */}
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 rounded-full bg-white shadow-md hover:bg-gray-100 text-gray-600"
              title="More"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
              </svg>
            </button>
          </div>

          {/* Quick reactions popup */}
          {showReactions && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowReactions(false)} />
              <div
                className={`absolute bottom-full mb-2 ${isSentByMe ? 'right-0' : 'left-0'} z-20 bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1 flex gap-1`}
              >
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      onReact?.(message._id, emoji);
                      setShowReactions(false);
                    }}
                    className="text-xl hover:scale-125 transition-transform p-1"
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
                className={`absolute top-full mt-1 ${isSentByMe ? 'right-0' : 'left-0'} z-20 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px]`}
              >
                {onReply && (
                  <button
                    onClick={() => {
                      onReply(message);
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
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
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
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
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                    Delete
                  </button>
                )}
              </div>
            </>
          )}

          <div
            className={`rounded-lg px-3 py-2 ${
              isSentByMe ? 'bg-[#dcf8c6]' : 'bg-white border border-gray-200'
            } text-gray-900`}
          >
            {renderReplyPreview()}
            {renderMedia()}
            {message.body && (
              <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
            )}

            {/* Time and status */}
            <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
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
