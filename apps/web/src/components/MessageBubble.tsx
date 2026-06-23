import { useEffect, useRef, useState } from 'react';
import type { Message } from '@repo/types';
import { normalizeMediaUrl } from '@/api/client';
import Avatar from './Avatar';
import ReadReceipts from './ReadReceipts';

interface MessageBubbleProps {
  message: Message;
  isSentByMe: boolean;
  currentUserId?: string;
  showAvatar?: boolean;
  senderName?: string;
  senderAvatarUrl?: string;
  onReply?: (message: Message) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onDelete?: (messageId: string) => void;
  onPollVote?: (messageId: string, optionId: string) => void;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const URL_REGEX = /(https?:\/\/[^\s<>"']+)/gi;
const TRAILING_URL_PUNCTUATION = /[),.!?:;]+$/;

function splitTrailingPunctuation(url: string) {
  const punctuation = url.match(TRAILING_URL_PUNCTUATION)?.[0] || '';
  if (!punctuation) return { href: url, trailing: '' };
  return {
    href: url.slice(0, -punctuation.length),
    trailing: punctuation,
  };
}

function LinkifiedText({ text, isSentByMe }: { text: string; isSentByMe: boolean }) {
  const parts = text.split(URL_REGEX);

  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {parts.map((part, index) => {
        if (!part.match(URL_REGEX)) return <span key={`${part}-${index}`}>{part}</span>;

        const { href, trailing } = splitTrailingPunctuation(part);
        let parsed: URL;
        try {
          parsed = new URL(href);
        } catch {
          return <span key={`${part}-${index}`}>{part}</span>;
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return <span key={`${part}-${index}`}>{part}</span>;
        }

        return (
          <span key={`${href}-${index}`}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`font-medium underline underline-offset-2 ${
                isSentByMe
                  ? 'text-white decoration-white/60 hover:decoration-white'
                  : 'text-teal-700 decoration-teal-500/50 hover:decoration-teal-700 dark:text-teal-300'
              }`}
            >
              {href}
            </a>
            {trailing}
          </span>
        );
      })}
    </p>
  );
}

export default function MessageBubble({
  message,
  isSentByMe,
  currentUserId = '',
  showAvatar = true,
  senderName,
  senderAvatarUrl,
  onReply,
  onReact,
  onDelete,
  onPollVote,
}: MessageBubbleProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showMenu) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowMenu(false);
      }
    };
    const closeMenu = () => setShowMenu(false);

    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [showMenu]);

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const openMenu = () => {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      setShowMenu((value) => !value);
      return;
    }

    const menuWidth = 160;
    const menuHeight = 132;
    const gutter = 8;
    const top =
      window.innerHeight - rect.bottom >= menuHeight + gutter
        ? rect.bottom + gutter
        : Math.max(gutter, rect.top - menuHeight - gutter);
    const left = Math.min(
      window.innerWidth - menuWidth - gutter,
      Math.max(gutter, isSentByMe ? rect.right - menuWidth : rect.left)
    );

    setMenuPosition({ top, left });
    setShowMenu((value) => !value);
  };

  const renderMedia = () => {
    if (!message.media) return null;

    const { type, url, thumbnailUrl, duration, fileName, mimeType } = message.media;
    const mediaUrl = normalizeMediaUrl(url);
    const previewUrl = normalizeMediaUrl(thumbnailUrl) || mediaUrl;

    if (!mediaUrl) return null;

    if (type === 'image') {
      return (
        <img
          src={previewUrl}
          alt={fileName || 'Shared image'}
          className="max-w-xs rounded-lg mb-1 cursor-pointer hover:opacity-90"
          onClick={() => window.open(mediaUrl, '_blank')}
        />
      );
    }

    if (type === 'audio') {
      return (
        <div className="mb-1 flex flex-col gap-1">
          <audio
            key={mediaUrl}
            controls
            preload="metadata"
            className="h-10 max-w-xs"
          >
            <source src={mediaUrl} type={mimeType || 'audio/webm'} />
            Your browser does not support the audio element.
          </audio>
          {duration && <span className="text-xs opacity-70">{Math.floor(duration)}s</span>}
        </div>
      );
    }

    if (type === 'document') {
      return (
        <a
          href={mediaUrl}
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
          <span className="text-sm">{fileName || 'Document'}</span>
        </a>
      );
    }

    return null;
  };

  const renderPoll = () => {
    if (!message.poll) return null;

    const totalVotes = message.poll.options.reduce(
      (total, option) => total + option.votes.length,
      0
    );

    return (
      <div className="mb-1 min-w-[220px] space-y-2">
        <p className="text-sm font-semibold">Poll: {message.poll.question}</p>
        <div className="space-y-1.5">
          {message.poll.options.map((option) => {
            const selected = option.votes.includes(currentUserId);
            const percent = totalVotes ? Math.round((option.votes.length / totalVotes) * 100) : 0;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onPollVote?.(message._id, option.id)}
                disabled={!onPollVote || message.poll?.closed}
                className={`relative w-full overflow-hidden rounded-xl border px-3 py-2 text-left text-sm transition ${
                  selected
                    ? 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-500/50 dark:bg-teal-500/20 dark:text-white'
                    : 'border-slate-200 bg-white/80 text-slate-800 hover:border-teal-300 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-100'
                }`}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-teal-200/40 dark:bg-teal-400/20"
                  style={{ width: `${percent}%` }}
                />
                <span className="relative flex items-center justify-between gap-3">
                  <span>{option.text}</span>
                  <span className="text-xs opacity-75">
                    {option.votes.length} vote{option.votes.length === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSticker = () => {
    if (!message.sticker) return null;

    return (
      <div className="mb-1 flex flex-col items-center gap-1">
        <span className="text-6xl leading-none" aria-label={message.sticker.label || 'Sticker'}>
          {message.sticker.emoji}
        </span>
        {message.sticker.label && (
          <span className="text-xs opacity-70">{message.sticker.label}</span>
        )}
      </div>
    );
  };

  const renderEvent = () => {
    if (!message.event) return null;

    const startsAt = new Date(message.event.startsAt);

    return (
      <div className="mb-1 min-w-[220px] rounded-xl border border-slate-200 bg-white/80 p-3 text-sm dark:border-slate-600 dark:bg-slate-900/50">
        <p className="font-semibold">{message.event.title}</p>
        <p className="mt-1 text-xs opacity-80">
          {Number.isNaN(startsAt.getTime())
            ? message.event.startsAt
            : startsAt.toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
        </p>
        {message.event.location && (
          <p className="mt-1 text-xs opacity-80">{message.event.location}</p>
        )}
        {message.event.description && (
          <p className="mt-2 whitespace-pre-wrap text-xs opacity-90">
            {message.event.description}
          </p>
        )}
      </div>
    );
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
              ref={menuButtonRef}
              onClick={openMenu}
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
                className="fixed z-20 min-w-[150px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
                style={{
                  top: menuPosition?.top ?? 0,
                  left: menuPosition?.left ?? 0,
                }}
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
            {renderPoll()}
            {renderSticker()}
            {renderEvent()}
            {message.body && !message.poll && !message.sticker && !message.event && (
              <LinkifiedText text={message.body} isSentByMe={isSentByMe} />
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
