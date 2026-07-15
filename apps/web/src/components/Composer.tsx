import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent, type ClipboardEvent } from 'react';
import {
  Plus,
  Mic,
  FileText,
  Image,
  Camera,
  BarChart2,
  Calendar,
  Smile as SmileIcon,
  Video as VideoIcon,
  X,
} from 'lucide-react';
import { useSendMessage } from '@/hooks/useSendMessage';
import { useFileUpload, type UploadResult } from '@/hooks/useFileUpload';
import { useAppStore } from '@/store/app-store';
import CameraModal from './CameraModal';
import VoiceRecorder from './VoiceRecorder';
import PollModal from './PollModal';
import Avatar from './Avatar';
import type { Chat } from '@repo/types';

interface ReplyMessage {
  _id: string;
  body: string;
  senderId: string;
}

interface ComposerProps {
  chatId: string;
  replyToMessage?: ReplyMessage | null;
  replyToId?: string;
  onCancelReply?: () => void;
  chat?: Chat;
  currentUserId?: string;
  mentionsEnabled?: boolean;
}

// Simple emoji picker data
const EMOJI_CATEGORIES = {
  Smileys: [
    '😀',
    '😃',
    '😄',
    '😁',
    '😅',
    '😂',
    '🤣',
    '😊',
    '😇',
    '🙂',
    '🙃',
    '😉',
    '😌',
    '😍',
    '🥰',
    '😘',
  ],
  Gestures: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👏', '🙌', '👐', '🤲', '🤝', '🙏'],
  Hearts: [
    '❤️',
    '🧡',
    '💛',
    '💚',
    '💙',
    '💜',
    '🖤',
    '🤍',
    '🤎',
    '💔',
    '❣️',
    '💕',
    '💞',
    '💓',
    '💗',
    '💖',
  ],
  Objects: [
    '🎉',
    '🎊',
    '🎈',
    '🎁',
    '🏆',
    '🥇',
    '🥈',
    '🥉',
    '⚽',
    '🏀',
    '🏈',
    '⚾',
    '🎾',
    '🏐',
    '🏉',
    '🎱',
  ],
};

const STICKERS = [
  { emoji: '😀', label: 'Smile' },
  { emoji: '😂', label: 'Laugh' },
  { emoji: '😍', label: 'Love it' },
  { emoji: '👍', label: 'Thumbs up' },
  { emoji: '🎉', label: 'Celebrate' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '💯', label: 'Hundred' },
  { emoji: '🙏', label: 'Thanks' },
  { emoji: '😮', label: 'Wow' },
  { emoji: '🤝', label: 'Deal' },
  { emoji: '✅', label: 'Done' },
  { emoji: '🚀', label: 'Launch' },
];

// Kept in sync with services/media/src/media-policy.ts's DOCUMENT_TYPES —
// RTF is deliberately NOT included: the backend has no RTF support, so
// "accepting" it client-side would just fail server-side with a confusing
// mismatch instead of a clear "unsupported type" message.
const SUPPORTED_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

const SUPPORTED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

// iOS Safari and various share-sheet apps frequently report a generic/blank
// type instead of the real one — most often for HEIC photos and Office
// documents. Treat these the same way the backend does: as "unknown," not
// "wrong," so a real file with a trustworthy extension isn't rejected
// client-side before it even reaches the upload that would have accepted it.
const UNKNOWN_DECLARED_TYPES = new Set(['application/octet-stream', 'binary/octet-stream', '']);

export const Composer = ({
  chatId,
  replyToMessage,
  replyToId,
  onCancelReply,
  chat,
  currentUserId,
  mentionsEnabled = false,
}: ComposerProps) => {
  const [message, setMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showEventComposer, setShowEventComposer] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDateTime, setEventDateTime] = useState('');
  const [eventEndDateTime, setEventEndDateTime] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventMeetingUrl, setEventMeetingUrl] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventReminderEnabled, setEventReminderEnabled] = useState(true);
  const [attachmentNotice, setAttachmentNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [pastedImage, setPastedImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [mentions, setMentions] = useState<Array<{ userId: string; start: number; length: number; displayName: string }>>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const socket = useAppStore((state) => state.socket);
  const { sendMessage } = useSendMessage();
  const {
    uploadMedia,
    uploadFile,
    isUploading,
    uploadProgress,
    error: uploadError,
  } = useFileUpload();
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const activeReplyToId = replyToMessage?._id || replyToId;

  const clearPastedImage = () => {
    setPastedImage((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  };

  const uploadAttachment = async (file: File): Promise<UploadResult | null> => {
    if (uploadMedia) {
      return uploadMedia(file);
    }

    const mediaId = await uploadFile(file);
    return mediaId
      ? {
          mediaId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
        }
      : null;
  };

  // Close action menu on outside click or Escape
  useEffect(() => {
    if (!showActionMenu) return;
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setShowActionMenu(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setShowActionMenu(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [showActionMenu]);

  // Close emoji picker on outside click or Escape
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setShowEmojiPicker(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [showEmojiPicker]);

  useEffect(() => {
    clearPastedImage();
    return () => clearPastedImage();
  }, [chatId, currentUserId]);

  // ── Input / typing ────────────────────────────────────────────────────

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);
    const cursor = e.target.selectionStart;
    setMentions((current) =>
      current.filter((mention) => value.slice(mention.start, mention.start + mention.length) === `@${mention.displayName}`)
    );
    if (mentionsEnabled) {
      const prefix = value.slice(0, cursor);
      const match = prefix.match(/(^|\s)@([^\s@]*)$/);
      if (match) {
        const atIndex = cursor - match[2].length - 1;
        setMentionStart(atIndex);
        setMentionQuery(match[2].toLowerCase());
        setActiveMentionIndex(0);
      } else {
        setMentionStart(null);
        setMentionQuery(null);
      }
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }

    if (socket && value.trim()) {
      if (!isTypingRef.current) {
        socket.emit('typing:start', { chatId });
        isTypingRef.current = true;
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        if (socket && isTypingRef.current) {
          socket.emit('typing:stop', { chatId });
          isTypingRef.current = false;
        }
      }, 3000);
    } else if (socket && isTypingRef.current) {
      socket.emit('typing:stop', { chatId });
      isTypingRef.current = false;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }
  };

  const handleSend = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !pastedImage) return;

    if (socket && isTypingRef.current) {
      socket.emit('typing:stop', { chatId });
      isTypingRef.current = false;
    }

    const leadingTrim = message.length - message.trimStart().length;
    const outboundMentions = mentions
      .map((mention) => ({ ...mention, start: mention.start - leadingTrim }))
      .filter(
        (mention) =>
          mention.start >= 0 &&
          mention.start + mention.length <= trimmedMessage.length &&
          trimmedMessage.slice(mention.start, mention.start + mention.length) ===
            `@${mention.displayName}`
      )
      .map(({ userId, start, length }) => ({ userId, start, length }));

    if (pastedImage) {
      const media = await uploadAttachment(pastedImage.file);
      if (!media) {
        setAttachmentNotice({
          title: 'Photo upload failed',
          message: uploadError || 'This photo could not be uploaded. Try another image.',
        });
        return;
      }
      sendMessage({
        chatId,
        body: trimmedMessage || 'Photo',
        mediaId: media.mediaId,
        mediaKind: 'image',
        mediaUrl: media.mediaUrl || media.publicUrl,
        mediaFileName: media.fileName || pastedImage.file.name,
        mediaMimeType: media.mimeType || pastedImage.file.type,
        mediaSize: media.size || pastedImage.file.size,
        replyToId: activeReplyToId,
        mentions: outboundMentions,
      });
      clearPastedImage();
    } else {
      sendMessage({
        chatId,
        body: trimmedMessage,
        replyToId: activeReplyToId,
        mentions: outboundMentions,
      });
    }
    setMessage('');
    setMentions([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (onCancelReply) onCancelReply();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveMentionIndex((index) => (index + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveMentionIndex((index) => (index - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        setMentionStart(null);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        insertMention(mentionSuggestions[activeMentionIndex]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files || []);
    const image = files.find((file) => SUPPORTED_IMAGE_TYPES.has(file.type.split(';')[0].toLowerCase()));
    if (!image) return;
    event.preventDefault();
    clearPastedImage();
    const extension = image.type.includes('png')
      ? 'png'
      : image.type.includes('webp')
        ? 'webp'
        : image.type.includes('heic')
          ? 'heic'
          : image.type.includes('heif')
            ? 'heif'
            : 'jpg';
    const file = new File([image], image.name || `pasted-photo-${Date.now()}.${extension}`, { type: image.type });
    setPastedImage({ file, previewUrl: URL.createObjectURL(file) });
    setAttachmentNotice(null);
  };

  const mentionSuggestions = (chat?.participantProfiles || [])
    .filter((profile) => profile._id !== currentUserId)
    .filter((profile) => profile.name.toLowerCase().includes(mentionQuery || ''))
    .slice(0, 6);

  const insertMention = (profile: { _id: string; name: string; avatarUrl?: string }) => {
    const textarea = textareaRef.current;
    if (!textarea || mentionStart === null) return;
    const end = textarea.selectionStart;
    const label = `@${profile.name}`;
    const suffix = message.slice(end).startsWith(' ') ? '' : ' ';
    const next = `${message.slice(0, mentionStart)}${label}${suffix}${message.slice(end)}`;
    setMessage(next);
    setMentions((current) => [
      ...current.filter((mention) => mention.userId !== profile._id),
      { userId: profile._id, start: mentionStart, length: label.length, displayName: profile.name },
    ]);
    setMentionQuery(null);
    setMentionStart(null);
    setTimeout(() => {
      const pos = mentionStart + label.length + suffix.length;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    }, 0);
  };

  const handleEmojiSelect = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newMessage = message.slice(0, start) + emoji + message.slice(end);
    setMessage(newMessage);
    setShowEmojiPicker(false);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  };

  // ── File / media handlers ─────────────────────────────────────────────

  const fileTypeLabels: Record<'image' | 'document' | 'video', string> = {
    image: 'Photo',
    document: 'Document',
    video: 'Video',
  };

  const supportedSetFor = (fileType: 'image' | 'document' | 'video') =>
    fileType === 'image' ? SUPPORTED_IMAGE_TYPES : fileType === 'video' ? SUPPORTED_VIDEO_TYPES : SUPPORTED_DOCUMENT_TYPES;

  const unsupportedTypeMessage: Record<'image' | 'document' | 'video', string> = {
    image: 'This image type is not supported. JPG, PNG, GIF, WebP, and HEIC/HEIF photos can be sent.',
    document: 'This document type is not supported. PDF, Word, Excel, PowerPoint, CSV, and TXT files can be sent.',
    video: 'This video format is not supported. MP4, MOV, and WebM videos can be sent.',
  };

  const handleFileSelect = async (
    e: ChangeEvent<HTMLInputElement>,
    fileType: 'image' | 'document' | 'video'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowActionMenu(false);

    // A declared type the browser/OS couldn't determine (common for HEIC
    // photos and Office documents, especially on iOS Safari) carries no
    // signal — defer to the upload itself, which sniffs the actual file
    // content, rather than rejecting a possibly-valid file on our own
    // client-side guess.
    const declaredType = (file.type || '').toLowerCase();
    const hasTrustworthyDeclaredType = Boolean(declaredType) && !UNKNOWN_DECLARED_TYPES.has(declaredType);
    if (hasTrustworthyDeclaredType && !supportedSetFor(fileType).has(declaredType)) {
      setAttachmentNotice({
        title: `${fileTypeLabels[fileType]} not supported`,
        message: unsupportedTypeMessage[fileType],
      });
      e.target.value = '';
      return;
    }

    const media = await uploadAttachment(file);
    if (!media) {
      setAttachmentNotice({
        title: `${fileTypeLabels[fileType]} upload failed`,
        message: uploadError || `This ${fileType} could not be uploaded. Try again.`,
      });
    } else {
      const body = message.trim() || (fileType === 'document' ? file.name : fileTypeLabels[fileType]);
      sendMessage({
        chatId,
        body,
        mediaId: media.mediaId,
        mediaKind: fileType,
        mediaUrl: media.mediaUrl || media.publicUrl,
        mediaFileName: media.fileName || file.name,
        mediaMimeType: media.mimeType || file.type,
        mediaSize: media.size || file.size,
        replyToId: activeReplyToId,
      });
      setMessage('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      if (onCancelReply) onCancelReply();
    }

    if (imageInputRef.current) imageInputRef.current.value = '';
    if (documentInputRef.current) documentInputRef.current.value = '';
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const handleCameraCapture = async (file: File) => {
    const media = await uploadAttachment(file);
    if (!media) {
      setAttachmentNotice({
        title: 'Camera upload failed',
        message: uploadError || 'This photo could not be uploaded. Try another image.',
      });
    } else {
      sendMessage({
        chatId,
        body: 'Photo',
        mediaId: media.mediaId,
        mediaKind: 'image',
        mediaUrl: media.mediaUrl || media.publicUrl,
        mediaFileName: media.fileName || file.name,
        mediaMimeType: media.mimeType || file.type,
        mediaSize: media.size || file.size,
        replyToId: activeReplyToId,
      });
      if (onCancelReply) onCancelReply();
    }
  };

  const handleVoiceSend = async (audioBlob: Blob, duration: number) => {
    const audioType =
      audioBlob.type && audioBlob.type.startsWith('audio/') ? audioBlob.type : 'audio/webm';
    const audioExtension =
      audioType.includes('mp4') || audioType.includes('m4a')
        ? 'm4a'
        : audioType.includes('ogg')
          ? 'ogg'
          : audioType.includes('wav')
            ? 'wav'
            : 'webm';
    const file = new File([audioBlob], `voice-${Date.now()}.${audioExtension}`, { type: audioType });
    const media = await uploadAttachment(file);
    if (!media) {
      setAttachmentNotice({
        title: 'Audio upload failed',
        message: uploadError || 'We could not upload this voice note. Try again.',
      });
    } else {
      sendMessage({
        chatId,
        body: `Voice message (${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')})`,
        mediaId: media.mediaId,
        mediaKind: 'audio',
        mediaUrl: media.mediaUrl || media.publicUrl,
        mediaFileName: media.fileName || file.name,
        mediaMimeType: media.mimeType || file.type,
        mediaSize: media.size || file.size,
        mediaDuration: duration > 0 ? duration : undefined,
        replyToId: activeReplyToId,
      });
      if (onCancelReply) onCancelReply();
    }
    setShowVoiceRecorder(false);
  };

  const handleCreatePoll = (
    question: string,
    options: string[],
    settings: {
      allowMultiple: boolean;
      allowVoteChanges: boolean;
      showVoters: boolean;
      closesAt?: string;
    }
  ) => {
    sendMessage({
      chatId,
      body: question,
      type: 'poll',
      poll: { question, options, ...settings },
      replyToId: activeReplyToId,
    });
    if (onCancelReply) onCancelReply();
  };

  const handleStickerSelect = (sticker: { emoji: string; label: string }) => {
    sendMessage({
      chatId,
      body: sticker.emoji,
      type: 'sticker',
      sticker,
      replyToId: activeReplyToId,
    });
    setShowStickerPicker(false);
    if (onCancelReply) onCancelReply();
  };

  const resetEventComposer = () => {
    setEventTitle('');
    setEventDateTime('');
    setEventEndDateTime('');
    setEventLocation('');
    setEventMeetingUrl('');
    setEventDescription('');
    setEventReminderEnabled(true);
  };

  const handleCreateEvent = () => {
    const title = eventTitle.trim();
    if (!title || !eventDateTime) return;

    sendMessage({
      chatId,
      body: title,
      type: 'event',
      event: {
        title,
        startsAt: new Date(eventDateTime).toISOString(),
        startAt: new Date(eventDateTime).toISOString(),
        endAt: eventEndDateTime ? new Date(eventEndDateTime).toISOString() : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        location: eventLocation.trim() || undefined,
        meetingUrl: eventMeetingUrl.trim() || undefined,
        description: eventDescription.trim() || undefined,
        reminderEnabled: eventReminderEnabled,
      },
      replyToId: activeReplyToId,
    });
    setShowEventComposer(false);
    resetEventComposer();
    if (onCancelReply) onCancelReply();
  };

  // ── Action menu items ─────────────────────────────────────────────────

  type ActionItem = {
    label: string;
    icon: typeof FileText;
    iconBg: string;
    action: () => void;
    disabled?: boolean;
  };

  const actionItems: ActionItem[] = [
    {
      label: 'Document',
      icon: FileText,
      iconBg: 'bg-teal-700',
      action: () => documentInputRef.current?.click(),
    },
    {
      label: 'Photos',
      icon: Image,
      iconBg: 'bg-blue-500',
      action: () => imageInputRef.current?.click(),
    },
    {
      label: 'Video',
      icon: VideoIcon,
      iconBg: 'bg-indigo-500',
      action: () => videoInputRef.current?.click(),
    },
    {
      label: 'Camera',
      icon: Camera,
      iconBg: 'bg-rose-500',
      action: () => setShowCamera(true),
    },
    {
      label: 'Poll',
      icon: BarChart2,
      iconBg: 'bg-amber-500',
      action: () => setShowPollModal(true),
    },
    {
      label: 'Event',
      icon: Calendar,
      iconBg: 'bg-pink-500',
      action: () => setShowEventComposer(true),
    },
    {
      label: 'New sticker',
      icon: SmileIcon,
      iconBg: 'bg-teal-500',
      action: () => setShowStickerPicker(true),
    },
  ];

  // ── Voice recorder replaces composer ─────────────────────────────────

  if (showVoiceRecorder) {
    return <VoiceRecorder onSend={handleVoiceSend} onCancel={() => setShowVoiceRecorder(false)} />;
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="border-t border-teal-100 bg-white px-4 py-3.5 shadow-[0_-1px_8px_rgba(15,23,42,0.03)] dark:border-teal-900/40 dark:bg-slate-900">
      {/* Reply preview */}
          {activeReplyToId && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-teal-600">Reply</p>
            <p className="truncate text-sm text-slate-700 dark:text-slate-300">
              {replyToMessage?.body || 'Replying to message'}
            </p>
          </div>
          <button
            onClick={onCancelReply}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
            aria-label="Cancel reply"
            type="button"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      )}

      {pastedImage && (
        <div className="mb-2 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
          <img src={pastedImage.previewUrl} alt="Pasted photo preview" className="h-16 w-16 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-teal-600">Photo ready to send</p>
            <p className="truncate text-sm text-slate-700 dark:text-slate-300">{pastedImage.file.name}</p>
          </div>
          <button
            type="button"
            onClick={clearPastedImage}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
            aria-label="Remove pasted photo"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Upload progress */}
      {isUploading && uploadProgress && (
        <div className="mb-2 rounded-lg bg-teal-50 p-2 dark:bg-teal-500/10">
          <div className="flex items-center justify-between text-sm">
            <span className="text-teal-700 dark:text-teal-300">Uploading…</span>
            <span className="text-teal-700 dark:text-teal-300">{uploadProgress.percentage}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-teal-200 dark:bg-teal-900">
            <div
              className="h-full bg-teal-600 transition-all duration-300"
              style={{ width: `${uploadProgress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* ── + action button & floating menu ── */}
        <div ref={actionMenuRef} className="relative flex-shrink-0 self-end pb-0.5">
          <button
            type="button"
            onClick={() => setShowActionMenu((v) => !v)}
            aria-label="Open composer actions"
            aria-expanded={showActionMenu}
            aria-haspopup="menu"
            disabled={isUploading}
            className={`bl-focus-ring flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
              showActionMenu
                ? 'bg-teal-100 text-teal-800 dark:bg-teal-500/25 dark:text-teal-100'
                : 'text-teal-600 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-300 dark:hover:bg-teal-500/15 dark:hover:text-teal-100'
            }`}
          >
            <Plus
              size={20}
              strokeWidth={2.5}
              className={`transition-transform duration-200 ${showActionMenu ? 'rotate-45' : ''}`}
            />
          </button>

          {/* Floating action menu */}
          {showActionMenu && (
            <div
              role="menu"
              aria-label="Composer actions"
              className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            >
              {actionItems.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    if (!item.disabled) {
                      item.action();
                      setShowActionMenu(false);
                    }
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm text-slate-800 transition-colors focus:outline-none focus-visible:bg-teal-50 dark:text-slate-100 dark:focus-visible:bg-slate-800 ${
                    item.disabled
                      ? 'cursor-not-allowed opacity-40'
                      : 'hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-700'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${item.iconBg}`}
                  >
                    <item.icon size={16} className="text-white" />
                  </span>
                  <span className="flex-1 text-left leading-none">{item.label}</span>
                  {item.disabled && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      soon
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Hidden file inputs */}
        <input
          ref={imageInputRef}
          type="file"
          data-testid="image-file-input"
          className="hidden"
          onChange={(e) => handleFileSelect(e, 'image')}
          accept=".jpg,.jpeg,.jpe,.jfif,.png,.webp,.gif,.heic,.heif,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
        />
        <input
          ref={documentInputRef}
          type="file"
          data-testid="document-file-input"
          className="hidden"
          onChange={(e) => handleFileSelect(e, 'document')}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv"
        />
        <input
          ref={videoInputRef}
          type="file"
          data-testid="video-file-input"
          className="hidden"
          onChange={(e) => handleFileSelect(e, 'video')}
          accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
        />

        {/* ── Text input ── */}
        <div className="relative flex-1">
          {mentionQuery !== null && mentionSuggestions.length > 0 && (
            <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-full max-w-xs overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              {mentionSuggestions.map((profile, index) => (
                <button
                  key={profile._id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertMention(profile);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    index === activeMentionIndex
                      ? 'bg-teal-50 text-teal-900 dark:bg-teal-900/30 dark:text-teal-100'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <Avatar src={profile.avatarUrl} alt={profile.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                  {chat?.ownerId === profile._id ? (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">Owner</span>
                  ) : chat?.admins?.includes(profile._id) ? (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Admin</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            disabled={isUploading}
            className="block max-h-32 min-h-[2.5rem] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-teal-400 dark:focus:bg-slate-800"
          />
        </div>

        {/* ── Emoji button with picker ── */}
        <div ref={emojiPickerRef} className="relative flex-shrink-0 self-end pb-0.5">
          <button
            type="button"
            onClick={() => setShowEmojiPicker((v) => !v)}
            disabled={isUploading}
            aria-label="Add emoji"
            aria-expanded={showEmojiPicker}
            className="bl-focus-ring flex h-9 w-9 items-center justify-center rounded-full text-teal-600 transition-colors hover:bg-teal-50 hover:text-teal-800 disabled:opacity-40 dark:text-teal-300 dark:hover:bg-teal-500/15 dark:hover:text-teal-100"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-4-8c.79 0 1.5-.71 1.5-1.5S8.79 9 8 9s-1.5.71-1.5 1.5S7.21 12 8 12zm8 0c.79 0 1.5-.71 1.5-1.5S16.79 9 16 9s-1.5.71-1.5 1.5.71 1.5 1.5 1.5zm-4 5.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
            </svg>
          </button>

          {/* Emoji picker */}
          {showEmojiPicker && (
            <div className="absolute bottom-full right-0 z-50 mb-2 max-h-64 w-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800">
              {Object.entries(EMOJI_CATEGORIES).map(([category, emojis]) => (
                <div key={category} className="mb-3">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {category}
                  </p>
                  <div className="grid grid-cols-8 gap-0.5">
                    {emojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleEmojiSelect(emoji)}
                        className="rounded-lg p-1 text-xl leading-none hover:bg-slate-100 dark:hover:bg-slate-700"
                        type="button"
                        aria-label={emoji}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Send / Mic button ── */}
        {message.trim() || pastedImage ? (
          <button
            type="button"
            onClick={handleSend}
            disabled={isUploading}
            aria-label="Send message"
            className="bl-focus-ring flex h-9 w-9 flex-shrink-0 items-center justify-center self-end rounded-full bg-teal-600 text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowVoiceRecorder(true)}
            disabled={isUploading}
            aria-label="Voice message"
            className="bl-focus-ring flex h-9 w-9 flex-shrink-0 items-center justify-center self-end rounded-full text-teal-600 transition-colors hover:bg-teal-50 hover:text-teal-800 disabled:opacity-40 dark:text-teal-300 dark:hover:bg-teal-500/15 dark:hover:text-teal-100"
          >
            <Mic size={19} />
          </button>
        )}
      </div>

      {/* Modals */}
      <CameraModal
        isOpen={showCamera}
        onClose={() => setShowCamera(false)}
        onCapture={handleCameraCapture}
      />
      <PollModal
        isOpen={showPollModal}
        onClose={() => setShowPollModal(false)}
        onCreatePoll={handleCreatePoll}
      />
      {showStickerPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sticker-picker-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h2
                id="sticker-picker-title"
                className="text-lg font-semibold text-slate-950 dark:text-white"
              >
                New sticker
              </h2>
              <button
                type="button"
                onClick={() => setShowStickerPicker(false)}
                aria-label="Close"
                className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {STICKERS.map((sticker) => (
                <button
                  key={sticker.label}
                  type="button"
                  onClick={() => handleStickerSelect(sticker)}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center transition hover:border-teal-300 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-teal-500/60 dark:hover:bg-teal-500/10"
                  aria-label={sticker.label}
                >
                  <span className="block text-3xl leading-none">{sticker.emoji}</span>
                  <span className="mt-1 block truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {sticker.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {showEventComposer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-composer-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h2
                id="event-composer-title"
                className="text-lg font-semibold text-slate-950 dark:text-white"
              >
                Event
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowEventComposer(false);
                  resetEventComposer();
                }}
                aria-label="Close"
                className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Title
                </span>
                <input
                  type="text"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500"
                  placeholder="Coffee chat"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Date and time
                </span>
                <input
                  type="datetime-local"
                  value={eventDateTime}
                  onChange={(e) => setEventDateTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  End time
                </span>
                <input
                  type="datetime-local"
                  value={eventEndDateTime}
                  onChange={(e) => setEventEndDateTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Location
                </span>
                <input
                  type="text"
                  value={eventLocation}
                  onChange={(e) => setEventLocation(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500"
                  placeholder="Optional"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Meeting link
                </span>
                <input
                  type="url"
                  value={eventMeetingUrl}
                  onChange={(e) => setEventMeetingUrl(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500"
                  placeholder="https://..."
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Description
                </span>
                <textarea
                  value={eventDescription}
                  onChange={(e) => setEventDescription(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500"
                  placeholder="Optional"
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <span>Event reminders</span>
                <input
                  type="checkbox"
                  checked={eventReminderEnabled}
                  onChange={(e) => setEventReminderEnabled(e.target.checked)}
                  className="h-4 w-4 accent-teal-600"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowEventComposer(false);
                  resetEventComposer();
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateEvent}
                disabled={!eventTitle.trim() || !eventDateTime}
                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
              >
                Send event
              </button>
            </div>
          </div>
        </div>
      )}
      {attachmentNotice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="attachment-notice-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="attachment-notice-title"
                  className="text-lg font-semibold text-slate-950 dark:text-white"
                >
                  {attachmentNotice.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {attachmentNotice.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAttachmentNotice(null)}
                aria-label="Close"
                className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAttachmentNotice(null)}
              className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
