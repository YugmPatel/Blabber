// Event types for Redis Pub/Sub
export enum EventType {
  // Message events
  MESSAGE_SENT = 'message:sent',
  MESSAGE_EDITED = 'message:edited',
  MESSAGE_DELETED = 'message:deleted',
  MESSAGE_REACTION = 'message:reaction',
  MESSAGE_READ = 'message:read',

  // Chat events
  CHAT_CREATED = 'chat:created',
  CHAT_UPDATED = 'chat:updated',
  CHAT_MEMBER_ADDED = 'chat:member:added',
  CHAT_MEMBER_REMOVED = 'chat:member:removed',
  CHAT_PINNED = 'chat:pinned',
  CHAT_ARCHIVED = 'chat:archived',

  // User events
  USER_ONLINE = 'user:online',
  USER_OFFLINE = 'user:offline',
  USER_TYPING = 'user:typing',
  USER_STOP_TYPING = 'user:stop_typing',
  USER_UPDATED = 'user:updated',
}

// Base event structure
export interface BaseEvent {
  type: EventType;
  timestamp: string;
}

// Message events
export interface MessageSentEvent extends BaseEvent {
  type: EventType.MESSAGE_SENT;
  data: {
    messageId: string;
    chatId: string;
    senderId: string;
    content: string;
    mediaUrl?: string;
    replyTo?: string;
    createdAt: string;
  };
}

export interface MessageEditedEvent extends BaseEvent {
  type: EventType.MESSAGE_EDITED;
  data: {
    messageId: string;
    chatId: string;
    content: string;
    editedAt: string;
  };
}

export interface MessageDeletedEvent extends BaseEvent {
  type: EventType.MESSAGE_DELETED;
  data: {
    messageId: string;
    chatId: string;
    deletedBy: string;
  };
}

export interface MessageReactionEvent extends BaseEvent {
  type: EventType.MESSAGE_REACTION;
  data: {
    messageId: string;
    chatId: string;
    userId: string;
    emoji: string;
  };
}

export interface MessageReadEvent extends BaseEvent {
  type: EventType.MESSAGE_READ;
  data: {
    chatId: string;
    userId: string;
    messageIds: string[];
  };
}

// Chat events
export interface ChatCreatedEvent extends BaseEvent {
  type: EventType.CHAT_CREATED;
  data: {
    chatId: string;
    name?: string;
    isGroup: boolean;
    participants: string[];
    createdBy: string;
  };
}

export interface ChatUpdatedEvent extends BaseEvent {
  type: EventType.CHAT_UPDATED;
  data: {
    chatId: string;
    name?: string;
    avatar?: string;
    updatedBy: string;
  };
}

export interface ChatMemberAddedEvent extends BaseEvent {
  type: EventType.CHAT_MEMBER_ADDED;
  data: {
    chatId: string;
    userId: string;
    addedBy: string;
  };
}

export interface ChatMemberRemovedEvent extends BaseEvent {
  type: EventType.CHAT_MEMBER_REMOVED;
  data: {
    chatId: string;
    userId: string;
    removedBy: string;
  };
}

// User events
export interface UserOnlineEvent extends BaseEvent {
  type: EventType.USER_ONLINE;
  data: {
    userId: string;
  };
}

export interface UserOfflineEvent extends BaseEvent {
  type: EventType.USER_OFFLINE;
  data: {
    userId: string;
    lastSeen: string;
  };
}

export interface UserTypingEvent extends BaseEvent {
  type: EventType.USER_TYPING;
  data: {
    userId: string;
    chatId: string;
  };
}

export interface UserStopTypingEvent extends BaseEvent {
  type: EventType.USER_STOP_TYPING;
  data: {
    userId: string;
    chatId: string;
  };
}

// Union type of all events
export type AppEvent =
  | MessageSentEvent
  | MessageEditedEvent
  | MessageDeletedEvent
  | MessageReactionEvent
  | MessageReadEvent
  | ChatCreatedEvent
  | ChatUpdatedEvent
  | ChatMemberAddedEvent
  | ChatMemberRemovedEvent
  | UserOnlineEvent
  | UserOfflineEvent
  | UserTypingEvent
  | UserStopTypingEvent;
