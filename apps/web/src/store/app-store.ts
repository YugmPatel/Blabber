import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import type { Message } from '@repo/types';

interface AppStore {
  // Auth
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;

  // Socket
  socket: Socket | null;
  isConnected: boolean;
  setSocket: (socket: Socket | null) => void;
  setIsConnected: (isConnected: boolean) => void;

  // UI
  activeChat: string | null;
  setActiveChat: (chatId: string | null) => void;

  // Optimistic messages
  pendingMessages: Map<string, Message>;
  addPendingMessage: (tempId: string, message: Message) => void;
  resolvePendingMessage: (tempId: string, messageId: string) => void;
  removePendingMessage: (tempId: string) => void;

  // Typing indicators
  typingUsers: Map<string, Set<string>>; // chatId -> Set<userId>
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void;
  getTypingUsers: (chatId: string) => string[];
  clearTypingForChat: (chatId: string) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Auth state
  accessToken: null,
  setAccessToken: (token) => set({ accessToken: token }),

  // Socket state
  socket: null,
  isConnected: false,
  setSocket: (socket) => set({ socket }),
  setIsConnected: (isConnected) => set({ isConnected }),

  // UI state
  activeChat: null,
  setActiveChat: (chatId) => set({ activeChat: chatId }),

  // Optimistic messages state
  pendingMessages: new Map(),
  addPendingMessage: (tempId, message) =>
    set((state) => {
      const newPendingMessages = new Map(state.pendingMessages);
      newPendingMessages.set(tempId, message);
      return { pendingMessages: newPendingMessages };
    }),
  resolvePendingMessage: (tempId, messageId) =>
    set((state) => {
      const newPendingMessages = new Map(state.pendingMessages);
      const message = newPendingMessages.get(tempId);
      if (message) {
        // Update the message with the real ID
        message._id = messageId;
        message.status = 'sent';
      }
      newPendingMessages.delete(tempId);
      return { pendingMessages: newPendingMessages };
    }),
  removePendingMessage: (tempId) =>
    set((state) => {
      const newPendingMessages = new Map(state.pendingMessages);
      newPendingMessages.delete(tempId);
      return { pendingMessages: newPendingMessages };
    }),

  // Typing indicators state
  typingUsers: new Map(),
  setTyping: (chatId, userId, isTyping) =>
    set((state) => {
      const newTypingUsers = new Map(state.typingUsers);
      const chatTypingUsers = newTypingUsers.get(chatId) || new Set();

      if (isTyping) {
        chatTypingUsers.add(userId);
      } else {
        chatTypingUsers.delete(userId);
      }

      if (chatTypingUsers.size === 0) {
        newTypingUsers.delete(chatId);
      } else {
        newTypingUsers.set(chatId, chatTypingUsers);
      }

      return { typingUsers: newTypingUsers };
    }),
  getTypingUsers: (chatId) => {
    const chatTypingUsers = get().typingUsers.get(chatId);
    return chatTypingUsers ? Array.from(chatTypingUsers) : [];
  },
  clearTypingForChat: (chatId) =>
    set((state) => {
      const newTypingUsers = new Map(state.typingUsers);
      newTypingUsers.delete(chatId);
      return { typingUsers: newTypingUsers };
    }),
}));
