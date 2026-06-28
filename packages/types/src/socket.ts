// Socket.io Event Types
export type CallType = 'audio' | 'video';

export interface CallInvitePayload {
  callId: string;
  chatId: string;
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  callType: CallType;
}

export interface CallControlPayload {
  callId: string;
  chatId: string;
  fromUserId: string;
  toUserId: string;
}

export interface CallSessionDescription {
  type: string;
  sdp?: string;
}

export interface CallIceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface CallOfferPayload {
  callId: string;
  chatId: string;
  fromUserId: string;
  toUserId: string;
  offer: CallSessionDescription;
}

export interface CallAnswerPayload {
  callId: string;
  chatId: string;
  fromUserId: string;
  toUserId: string;
  answer: CallSessionDescription;
}

export interface CallIceCandidatePayload {
  callId: string;
  chatId: string;
  fromUserId: string;
  toUserId: string;
  candidate: CallIceCandidate;
}

export interface CallErrorPayload {
  callId?: string;
  message: string;
}

export interface GroupCallStartPayload {
  callId: string;
  chatId: string;
  chatTitle?: string;
  chatAvatarUrl?: string;
  fromUserId: string;
  fromUserName?: string;
  callType: CallType;
  startedAt?: string;
}

export interface GroupCallDeclinePayload {
  callId: string;
  chatId: string;
  fromUserId: string;
  toUserId: string;
}

export interface GroupCallLeavePayload {
  callId: string;
  chatId: string;
  fromUserId?: string;
  clientSessionId?: string;
}

// Client to Server Events
export interface ClientToServerEvents {
  'auth:hello': () => void;
  'message:send': (data: {
    chatId: string;
    body: string;
    type?: 'text' | 'poll' | 'sticker' | 'event';
    mediaId?: string;
    mediaDuration?: number;
    poll?: {
      question: string;
      options: string[];
      allowMultiple?: boolean;
    };
    sticker?: {
      emoji: string;
      label?: string;
    };
    event?: {
      title: string;
      startsAt: string;
      location?: string;
      description?: string;
    };
    replyToId?: string;
    mentions?: Array<{ userId: string; start: number; length: number }>;
    clientMessageId?: string;
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
    description?: string;
    groupContext?: string;
    avatarUrl?: string;
    groupKind?: 'standard' | 'temporary';
    expiresAt?: string;
  }) => void;
  'chat:join': (data: { chatId: string }) => void;
  'chat:leave': (data: { chatId: string }) => void;
  'client:activity': (data: {
    activeChatId?: string | null;
    visible: boolean;
    focused: boolean;
  }) => void;
  'call:invite': (data: CallInvitePayload) => void;
  'call:accept': (data: CallControlPayload) => void;
  'call:decline': (data: CallControlPayload) => void;
  'call:cancel': (data: CallControlPayload) => void;
  'call:end': (data: CallControlPayload) => void;
  'call:offer': (data: CallOfferPayload) => void;
  'call:answer': (data: CallAnswerPayload) => void;
  'call:ice-candidate': (data: CallIceCandidatePayload) => void;
  'group-call:start': (data: GroupCallStartPayload) => void;
  'group-call:decline': (data: GroupCallDeclinePayload) => void;
  'group-call:leave': (data: GroupCallLeavePayload) => void;
}

// Server to Client Events
export interface ServerToClientEvents {
  'message:ack': (data: { tempId?: string; clientMessageId?: string; messageId: string; message: any }) => void;
  'message:new': (data: { message: any; tempId?: string }) => void;
  'message:edit': (data: { message: any }) => void;
  'message:deleted': (data: { messageId: string; chatId: string; deletedBy?: string }) => void;
  'message:reaction': (data: {
    messageId: string;
    chatId: string;
    userId: string;
    emoji: string;
    operation?: 'set' | 'remove';
    reactions?: any[];
    message?: any;
  }) => void;
  'message:pin': (data: { chatId: string; messageId: string; pinnedBy: string; pin?: any }) => void;
  'message:unpin': (data: { chatId: string; messageId: string; pinnedBy: string }) => void;
  'message:read': (data: { messageIds: string[]; userId: string; chatId?: string }) => void;
  'receipt:delivered': (data: { messageId: string; userId: string }) => void;
  'receipt:read': (data: { messageIds: string[]; userId: string }) => void;
  'typing:update': (data: { chatId: string; userId: string; isTyping: boolean }) => void;
  'chat:updated': (data: { chat: any }) => void;
  'chat:archived': (data: { chatId: string; userId: string; archived: true; archivedAt?: string }) => void;
  'chat:unarchived': (data: { chatId: string; userId: string; archived: false }) => void;
  'action:created': (data: { chatId: string; action: any }) => void;
  'action:updated': (data: { chatId: string; action: any }) => void;
  'presence:update': (data: { userId: string; online: boolean; lastSeen: Date | string | null }) => void;
  'call:incoming': (data: CallInvitePayload) => void;
  'call:accept': (data: CallControlPayload) => void;
  'call:decline': (data: CallControlPayload) => void;
  'call:cancel': (data: CallControlPayload) => void;
  'call:end': (data: CallControlPayload) => void;
  'call:offer': (data: CallOfferPayload) => void;
  'call:answer': (data: CallAnswerPayload) => void;
  'call:ice-candidate': (data: CallIceCandidatePayload) => void;
  'call:error': (data: CallErrorPayload) => void;
  'group-call:incoming': (data: GroupCallStartPayload) => void;
  'group-call:started': (data: {
    callId: string;
    chatId: string;
    deliveredCount: number;
    startedAt: string;
  }) => void;
  'group-call:decline': (data: GroupCallDeclinePayload) => void;
  'group-call:participants': (data: {
    callId: string;
    chatId: string;
    activeParticipantIds: string[];
  }) => void;
  'group-call:ended': (data: {
    callId: string;
    chatId: string;
    endedAt: string;
  }) => void;
  error: (data: { message: string; code?: string }) => void;
}

// Socket Data (attached to socket instance)
export interface SocketData {
  userId: string;
  username: string;
  email: string;
}
