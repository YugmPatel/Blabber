// Socket.io Event Types

// Client to Server Events
export interface ClientToServerEvents {
  'auth:hello': () => void;
  'message:send': (data: {
    chatId: string;
    body: string;
    mediaId?: string;
    replyToId?: string;
    tempId?: string;
  }) => void;
  'message:read': (data: { messageIds: string[] }) => void;
  'typing:start': (data: { chatId: string }) => void;
  'typing:stop': (data: { chatId: string }) => void;
  'reaction:set': (data: { messageId: string; emoji: string }) => void;
  'chat:create': (data: {
    type: 'direct' | 'group';
    participantIds: string[];
    title?: string;
  }) => void;
  'chat:join': (data: { chatId: string }) => void;
  'chat:leave': (data: { chatId: string }) => void;
}

// Server to Client Events
export interface ServerToClientEvents {
  'message:ack': (data: { tempId?: string; messageId: string; message: any }) => void;
  'message:new': (data: { message: any; tempId?: string }) => void;
  'message:edit': (data: { message: any }) => void;
  'message:delete': (data: { messageId: string; chatId: string }) => void;
  'receipt:delivered': (data: { messageId: string; userId: string }) => void;
  'receipt:read': (data: { messageIds: string[]; userId: string }) => void;
  'typing:update': (data: { chatId: string; userId: string; isTyping: boolean }) => void;
  'chat:updated': (data: { chat: any }) => void;
  'presence:update': (data: { userId: string; online: boolean; lastSeen: Date }) => void;
  error: (data: { message: string; code?: string }) => void;
}

// Socket Data (attached to socket instance)
export interface SocketData {
  userId: string;
  username: string;
  email: string;
}
