import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import {
  Plus,
  Mic,
  FileText,
  Image,
  Camera,
  UserCircle,
  BarChart2,
  Calendar,
  Smile as SmileIcon,
} from 'lucide-react';
import { useSendMessage } from '@/hooks/useSendMessage';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useAppStore } from '@/store/app-store';
import CameraModal from './CameraModal';
import VoiceRecorder from './VoiceRecorder';
import PollModal from './PollModal';
import ContactShareModal from './ContactShareModal';
import ScheduleMessageModal from './ScheduleMessageModal';

interface ReplyMessage {
  _id: string;
  body: string;
  senderId: string;
}

interface ComposerProps {
  chatId: string;
  replyToMessage?: ReplyMessage | null;
  onCancelReply?: () => void;
}

// Simple emoji picker data
const EMOJI_CATEGORIES = {
  Smileys: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘'],
  Gestures: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👏', '🙌', '👐', '🤲', '🤝', '🙏'],
  Hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖'],
  Objects: ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱'],
};

export const Composer = ({ chatId, replyToMessage, onCancelReply }: ComposerProps) => {
  const [message, setMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showContactShare, setShowContactShare] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const socket = useAppStore((state) => state.socket);
  const { sendMessage } = useSendMessage();
  const { uploadFile, isUploading, uploadProgress } = useFileUpload();
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

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

  // ── Input / typing ────────────────────────────────────────────────────

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);

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

  const handleSend = () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    if (socket && isTypingRef.current) {
      socket.emit('typing:stop', { chatId });
      isTypingRef.current = false;
    }

    sendMessage({ chatId, body: trimmedMessage, replyToId: replyToMessage?._id });
    setMessage('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (onCancelReply) onCancelReply();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

  const handleFileSelect = async (
    e: ChangeEvent<HTMLInputElement>,
    fileType: 'image' | 'document'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowActionMenu(false);

    const mediaId = await uploadFile(file);
    if (mediaId) {
      const body = message.trim() || (fileType === 'image' ? '📷 Photo' : `📄 ${file.name}`);
      sendMessage({ chatId, body, mediaId, replyToId: replyToMessage?._id });
      setMessage('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      if (onCancelReply) onCancelReply();
    }

    if (imageInputRef.current) imageInputRef.current.value = '';
    if (documentInputRef.current) documentInputRef.current.value = '';
  };

  const handleCameraCapture = async (file: File) => {
    const mediaId = await uploadFile(file);
    if (mediaId) {
      sendMessage({ chatId, body: '📷 Photo', mediaId, replyToId: replyToMessage?._id });
      if (onCancelReply) onCancelReply();
    }
  };

  const handleVoiceSend = async (audioBlob: Blob, duration: number) => {
    const file = new File([audioBlob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
    const mediaId = await uploadFile(file);
    if (mediaId) {
      sendMessage({
        chatId,
        body: `🎤 Voice message (${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')})`,
        mediaId,
        replyToId: replyToMessage?._id,
      });
      if (onCancelReply) onCancelReply();
    }
    setShowVoiceRecorder(false);
  };

  const handleCreatePoll = (question: string, options: string[]) => {
    const pollText = `📊 Poll: ${question}\n\n${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}`;
    sendMessage({ chatId, body: pollText, replyToId: replyToMessage?._id });
    if (onCancelReply) onCancelReply();
  };

  const handleShareContacts = (
    contacts: { _id: string; displayName: string; phone?: string; email?: string }[]
  ) => {
    const contactsText = contacts
      .map((c) => {
        let text = `👤 ${c.displayName}`;
        if (c.phone) text += `\n📱 ${c.phone}`;
        if (c.email) text += `\n📧 ${c.email}`;
        return text;
      })
      .join('\n\n');
    sendMessage({ chatId, body: contactsText, replyToId: replyToMessage?._id });
    if (onCancelReply) onCancelReply();
  };

  const handleScheduleMessage = (scheduledMessage: string, scheduledTime: Date) => {
    const scheduled = JSON.parse(localStorage.getItem('scheduledMessages') || '[]');
    scheduled.push({
      id: Date.now().toString(),
      chatId,
      message: scheduledMessage,
      scheduledTime: scheduledTime.toISOString(),
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem('scheduledMessages', JSON.stringify(scheduled));
    alert(`Message scheduled for ${scheduledTime.toLocaleString()}`);
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
      iconBg: 'bg-violet-600',
      action: () => documentInputRef.current?.click(),
    },
    {
      label: 'Photos & videos',
      icon: Image,
      iconBg: 'bg-blue-500',
      action: () => imageInputRef.current?.click(),
    },
    {
      label: 'Camera',
      icon: Camera,
      iconBg: 'bg-rose-500',
      action: () => setShowCamera(true),
    },
    {
      label: 'Audio',
      icon: Mic,
      iconBg: 'bg-orange-500',
      action: () => setShowVoiceRecorder(true),
    },
    {
      label: 'Contact',
      icon: UserCircle,
      iconBg: 'bg-cyan-500',
      action: () => setShowContactShare(true),
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
      action: () => setShowScheduleModal(true),
    },
    {
      label: 'New sticker',
      icon: SmileIcon,
      iconBg: 'bg-teal-500',
      action: () => {},
      disabled: true,
    },
  ];

  // ── Voice recorder replaces composer ─────────────────────────────────

  if (showVoiceRecorder) {
    return <VoiceRecorder onSend={handleVoiceSend} onCancel={() => setShowVoiceRecorder(false)} />;
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
      {/* Reply preview */}
      {replyToMessage && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-teal-600">Reply</p>
            <p className="truncate text-sm text-slate-700 dark:text-slate-300">{replyToMessage.body}</p>
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

      {/* Upload progress */}
      {isUploading && uploadProgress && (
        <div className="mb-2 rounded-lg bg-blue-50 p-2 dark:bg-blue-900/20">
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-700 dark:text-blue-300">Uploading…</span>
            <span className="text-blue-700 dark:text-blue-300">{uploadProgress.percentage}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-800">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
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
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
              showActionMenu
                ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white'
            }`}
          >
            <Plus
              size={20}
              strokeWidth={2.5}
              className={`transition-transform duration-200 ${showActionMenu ? 'rotate-45' : ''}`}
            />
          </button>

          {/* Floating dark action menu */}
          {showActionMenu && (
            <div
              role="menu"
              aria-label="Composer actions"
              className="absolute bottom-full left-0 z-50 mb-2 w-52 overflow-hidden rounded-[20px] py-1.5 shadow-2xl"
              style={{ background: '#111' }}
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
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm text-white transition-colors focus:outline-none focus-visible:bg-white/15 ${
                    item.disabled
                      ? 'cursor-not-allowed opacity-40'
                      : 'hover:bg-white/10 active:bg-white/15'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${item.iconBg}`}
                  >
                    <item.icon size={16} className="text-white" />
                  </span>
                  <span className="flex-1 text-left leading-none">{item.label}</span>
                  {item.disabled && (
                    <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/60">
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
          className="hidden"
          onChange={(e) => handleFileSelect(e, 'image')}
          accept="image/*,video/*"
        />
        <input
          ref={documentInputRef}
          type="file"
          className="hidden"
          onChange={(e) => handleFileSelect(e, 'document')}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
        />

        {/* ── Text input ── */}
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            disabled={isUploading}
            className="block max-h-32 min-h-[2.5rem] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-teal-500 dark:focus:bg-slate-800"
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
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-700 dark:hover:text-slate-200"
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
        {message.trim() ? (
          <button
            type="button"
            onClick={handleSend}
            disabled={isUploading}
            aria-label="Send message"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center self-end rounded-full bg-slate-950 text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
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
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center self-end rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-700 dark:hover:text-slate-200"
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
      <ContactShareModal
        isOpen={showContactShare}
        onClose={() => setShowContactShare(false)}
        onShareContacts={handleShareContacts}
      />
      <ScheduleMessageModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSchedule={handleScheduleMessage}
        initialMessage={message}
      />
    </div>
  );
};
