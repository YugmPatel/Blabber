import { useState, useRef, type KeyboardEvent, type ChangeEvent } from 'react';
import { Mic, Sparkles, Clock, MessageSquare } from 'lucide-react';
import { useSendMessage } from '@/hooks/useSendMessage';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useAppStore } from '@/store/app-store';
import CameraModal from './CameraModal';
import VoiceRecorder from './VoiceRecorder';
import PollModal from './PollModal';
import ContactShareModal from './ContactShareModal';
import MetaAIChat from './MetaAIChat';
import ScheduleMessageModal from './ScheduleMessageModal';
import QuickRepliesModal from './QuickRepliesModal';

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

export const Composer = ({ chatId, replyToMessage, onCancelReply }: ComposerProps) => {
  const [message, setMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showContactShare, setShowContactShare] = useState(false);
  const [showMetaAI, setShowMetaAI] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const socket = useAppStore((state) => state.socket);

  const { sendMessage } = useSendMessage();
  const { uploadFile, isUploading, uploadProgress } = useFileUpload();

  // Typing indicator debounce
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);

    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }

    // Typing indicator logic
    if (socket && value.trim()) {
      if (!isTypingRef.current) {
        socket.emit('typing:start', { chatId });
        isTypingRef.current = true;
      }

      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Set new timeout to stop typing
      typingTimeoutRef.current = setTimeout(() => {
        if (socket && isTypingRef.current) {
          socket.emit('typing:stop', { chatId });
          isTypingRef.current = false;
        }
      }, 3000);
    } else if (socket && isTypingRef.current) {
      socket.emit('typing:stop', { chatId });
      isTypingRef.current = false;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    }
  };

  const handleSend = () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    // Stop typing indicator
    if (socket && isTypingRef.current) {
      socket.emit('typing:stop', { chatId });
      isTypingRef.current = false;
    }

    // Send message
    sendMessage({
      chatId,
      body: trimmedMessage,
      replyToId: replyToMessage?._id,
    });

    // Clear input
    setMessage('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Clear reply if exists
    if (onCancelReply) {
      onCancelReply();
    }
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

    // Set cursor position after emoji
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  };

  const handleFileSelect = async (
    e: ChangeEvent<HTMLInputElement>,
    fileType: 'image' | 'document' | 'any'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setShowAttachMenu(false);

    // Upload file
    const mediaId = await uploadFile(file);

    if (mediaId) {
      // Determine message body based on file type
      let body = message.trim();
      if (!body) {
        if (fileType === 'image') {
          body = '📷 Photo';
        } else if (fileType === 'document') {
          body = `📄 ${file.name}`;
        } else {
          body = '📎 Attachment';
        }
      }

      // Send message with media
      sendMessage({
        chatId,
        body,
        mediaId,
        replyToId: replyToMessage?._id,
      });

      // Clear input
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      // Clear reply if exists
      if (onCancelReply) {
        onCancelReply();
      }
    }

    // Reset file inputs
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (documentInputRef.current) documentInputRef.current.value = '';
  };

  const handleCameraCapture = async (file: File) => {
    const mediaId = await uploadFile(file);
    if (mediaId) {
      sendMessage({
        chatId,
        body: '📷 Photo',
        mediaId,
        replyToId: replyToMessage?._id,
      });
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
    // Format poll as a message
    const pollText = `📊 Poll: ${question}\n\n${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}`;
    sendMessage({
      chatId,
      body: pollText,
      replyToId: replyToMessage?._id,
    });
    if (onCancelReply) onCancelReply();
  };

  const handleShareContacts = (
    contacts: { _id: string; displayName: string; phone?: string; email?: string }[]
  ) => {
    // Format contacts as a message
    const contactsText = contacts
      .map((c) => {
        let text = `👤 ${c.displayName}`;
        if (c.phone) text += `\n📱 ${c.phone}`;
        if (c.email) text += `\n📧 ${c.email}`;
        return text;
      })
      .join('\n\n');

    sendMessage({
      chatId,
      body: contactsText,
      replyToId: replyToMessage?._id,
    });
    if (onCancelReply) onCancelReply();
  };

  const handleInsertFromAI = (text: string) => {
    setMessage(text);
    setShowMetaAI(false);
    textareaRef.current?.focus();
  };

  const handleScheduleMessage = (scheduledMessage: string, scheduledTime: Date) => {
    // Store scheduled message in localStorage (in production, this would go to backend)
    const scheduled = JSON.parse(localStorage.getItem('scheduledMessages') || '[]');
    scheduled.push({
      id: Date.now().toString(),
      chatId,
      message: scheduledMessage,
      scheduledTime: scheduledTime.toISOString(),
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem('scheduledMessages', JSON.stringify(scheduled));

    // Show confirmation
    alert(`Message scheduled for ${scheduledTime.toLocaleString()}`);
  };

  const handleQuickReplySelect = (replyMessage: string) => {
    setMessage(replyMessage);
    setShowQuickReplies(false);
    textareaRef.current?.focus();
  };

  // Show voice recorder instead of normal composer
  if (showVoiceRecorder) {
    return <VoiceRecorder onSend={handleVoiceSend} onCancel={() => setShowVoiceRecorder(false)} />;
  }

  return (
    <div className="border-t border-gray-100 bg-[#f0f2f5] px-4 py-3">
      {/* Reply preview */}
      {replyToMessage && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-white border-l-4 border-[#00a884] p-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[#00a884]">Reply</p>
            <p className="text-sm text-gray-700 truncate">{replyToMessage.body}</p>
          </div>
          <button
            onClick={onCancelReply}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
            aria-label="Cancel reply"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      )}

      {/* Upload progress */}
      {isUploading && uploadProgress && (
        <div className="mb-2 rounded-lg bg-blue-50 p-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-700">Uploading...</span>
            <span className="text-blue-700">{uploadProgress.percentage}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-blue-200">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${uploadProgress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Emoji picker */}
      {showEmojiPicker && (
        <div className="absolute bottom-20 left-4 z-10 max-h-64 w-80 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          {Object.entries(EMOJI_CATEGORIES).map(([category, emojis]) => (
            <div key={category} className="mb-3">
              <p className="mb-1 text-xs font-semibold text-gray-600">{category}</p>
              <div className="grid grid-cols-8 gap-1">
                {emojis.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleEmojiSelect(emoji)}
                    className="rounded p-1 text-2xl hover:bg-gray-100"
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        {/* Emoji button - WhatsApp style */}
        <button
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-[#00a884]"
          type="button"
          aria-label="Add emoji"
          disabled={isUploading}
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-4-8c.79 0 1.5-.71 1.5-1.5S8.79 9 8 9s-1.5.71-1.5 1.5S7.21 12 8 12zm8 0c.79 0 1.5-.71 1.5-1.5S16.79 9 16 9s-1.5.71-1.5 1.5.71 1.5 1.5 1.5zm-4 5.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
          </svg>
        </button>

        {/* Attachment button with menu - WhatsApp style */}
        <div className="relative">
          <button
            onClick={() => setShowAttachMenu(!showAttachMenu)}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-[#00a884]"
            type="button"
            aria-label="Attach file"
            disabled={isUploading}
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" />
            </svg>
          </button>

          {/* Attachment menu */}
          {showAttachMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowAttachMenu(false)} />
              <div className="absolute bottom-12 left-0 z-20 rounded-lg bg-white p-2 shadow-lg border border-gray-200">
                <div className="flex gap-2">
                  {/* Photos & Videos */}
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="flex flex-col items-center gap-1 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                    type="button"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500">
                      <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                      </svg>
                    </div>
                    <span className="text-xs text-gray-600">Photos</span>
                  </button>

                  {/* Documents */}
                  <button
                    onClick={() => documentInputRef.current?.click()}
                    className="flex flex-col items-center gap-1 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                    type="button"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500">
                      <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                      </svg>
                    </div>
                    <span className="text-xs text-gray-600">Document</span>
                  </button>

                  {/* Camera */}
                  <button
                    onClick={() => {
                      setShowAttachMenu(false);
                      setShowCamera(true);
                    }}
                    className="flex flex-col items-center gap-1 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                    type="button"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pink-500">
                      <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="12" r="3.2" />
                        <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
                      </svg>
                    </div>
                    <span className="text-xs text-gray-600">Camera</span>
                  </button>

                  {/* Poll */}
                  <button
                    onClick={() => {
                      setShowAttachMenu(false);
                      setShowPollModal(true);
                    }}
                    className="flex flex-col items-center gap-1 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                    type="button"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-500">
                      <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
                      </svg>
                    </div>
                    <span className="text-xs text-gray-600">Poll</span>
                  </button>

                  {/* Contact */}
                  <button
                    onClick={() => {
                      setShowAttachMenu(false);
                      setShowContactShare(true);
                    }}
                    className="flex flex-col items-center gap-1 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                    type="button"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-500">
                      <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                      </svg>
                    </div>
                    <span className="text-xs text-gray-600">Contact</span>
                  </button>

                  {/* Schedule Message */}
                  <button
                    onClick={() => {
                      setShowAttachMenu(false);
                      setShowScheduleModal(true);
                    }}
                    className="flex flex-col items-center gap-1 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                    type="button"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500">
                      <Clock size={24} className="text-white" />
                    </div>
                    <span className="text-xs text-gray-600">Schedule</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Quick Replies button */}
        <button
          onClick={() => setShowQuickReplies(true)}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-[#00a884]"
          type="button"
          aria-label="Quick Replies"
          disabled={isUploading}
        >
          <MessageSquare size={22} />
        </button>

        {/* Meta AI button */}
        <button
          onClick={() => setShowMetaAI(true)}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600"
          type="button"
          aria-label="Meta AI"
          disabled={isUploading}
        >
          <Sparkles size={22} />
        </button>

        {/* Voice message button */}
        <button
          onClick={() => setShowVoiceRecorder(true)}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-[#00a884]"
          type="button"
          aria-label="Voice message"
          disabled={isUploading}
        >
          <Mic size={22} />
        </button>
        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => handleFileSelect(e, 'any')}
          accept="image/*,audio/*,.pdf,.doc,.docx"
        />
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

        {/* Text input - WhatsApp style */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-2xl border-0 bg-gray-100 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#00a884]/20"
          rows={1}
          disabled={isUploading}
        />

        {/* Send button - WhatsApp style */}
        <button
          onClick={handleSend}
          disabled={!message.trim() || isUploading}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white transition-all hover:bg-[#008f72] disabled:cursor-not-allowed disabled:bg-gray-300"
          type="button"
          aria-label="Send message"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>

      {/* Camera Modal */}
      <CameraModal
        isOpen={showCamera}
        onClose={() => setShowCamera(false)}
        onCapture={handleCameraCapture}
      />

      {/* Poll Modal */}
      <PollModal
        isOpen={showPollModal}
        onClose={() => setShowPollModal(false)}
        onCreatePoll={handleCreatePoll}
      />

      {/* Contact Share Modal */}
      <ContactShareModal
        isOpen={showContactShare}
        onClose={() => setShowContactShare(false)}
        onShareContacts={handleShareContacts}
      />

      {/* Meta AI Chat */}
      <MetaAIChat
        isOpen={showMetaAI}
        onClose={() => setShowMetaAI(false)}
        onInsertToChat={handleInsertFromAI}
      />

      {/* Schedule Message Modal */}
      <ScheduleMessageModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSchedule={handleScheduleMessage}
        initialMessage={message}
      />

      {/* Quick Replies Modal */}
      <QuickRepliesModal
        isOpen={showQuickReplies}
        onClose={() => setShowQuickReplies(false)}
        onSelectReply={handleQuickReplySelect}
      />
    </div>
  );
};
