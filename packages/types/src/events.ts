// Event types for Redis Pub/Sub
export enum EventType {
  // Message events
  MESSAGE_SENT = 'message:sent',
  MESSAGE_EDITED = 'message:edited',
  MESSAGE_DELETED = 'message:deleted',
  MESSAGE_REACTION = 'message:reaction',
  MESSAGE_READ = 'message:read',

  // Moment events
  MOMENT_REACTION_UPDATED = 'moment:reaction:updated',
  MOMENT_INTERACTIONS_UPDATED = 'moment:interactions:updated',

  // Profile events
  PROFILE_UPDATED = 'profile:updated',
  FOLLOW_UPDATED = 'follow:updated',
  FOLLOW_REQUEST_UPDATED = 'follow:request-updated',

  // Chat events
  CHAT_CREATED = 'chat:created',
  CHAT_UPDATED = 'chat:updated',
  CHAT_MEMBER_ADDED = 'chat:member:added',
  CHAT_MEMBER_REMOVED = 'chat:member:removed',
  CHAT_PINNED = 'chat:pinned',
  CHAT_ARCHIVED = 'chat:archived',
  CHAT_UNARCHIVED = 'chat:unarchived',
  MESSAGE_PINNED = 'message:pinned',
  MESSAGE_UNPINNED = 'message:unpinned',

  // Intelligence events
  ACTION_CREATED = 'action:created',
  ACTION_UPDATED = 'action:updated',

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
    senderName?: string;
    clientMessageId?: string;
    content: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'audio' | 'document';
    chatType?: 'direct' | 'group';
    chatTitle?: string;
    participants?: string[];
    message?: any;
    replyTo?: string;
    mentions?: Array<{ userId: string; start: number; length: number; displayName: string }>;
    createdAt: string;
  };
}

export interface MessageEditedEvent extends BaseEvent {
  type: EventType.MESSAGE_EDITED;
  data: {
    messageId: string;
    chatId: string;
    senderId?: string;
    senderName?: string;
    chatType?: 'direct' | 'group';
    chatTitle?: string;
    participants?: string[];
    content: string;
    message?: any;
    mentions?: Array<{ userId: string; start: number; length: number; displayName: string }>;
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
    operation?: 'set' | 'remove';
    reactions?: Array<{
      userId: string;
      emoji: string;
      createdAt: string | Date;
    }>;
    message?: any;
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

export interface MomentReactionUpdatedEvent extends BaseEvent {
  type: EventType.MOMENT_REACTION_UPDATED;
  data: {
    momentId: string;
    viewerUserId: string;
    authorUserId: string;
    emoji: string | null;
    operation: 'set' | 'remove';
  };
}

export interface MomentInteractionsUpdatedEvent extends BaseEvent {
  type: EventType.MOMENT_INTERACTIONS_UPDATED;
  data: {
    momentId: string;
    authorUserId: string;
  };
}

export interface ProfileUpdatedEvent extends BaseEvent {
  type: EventType.PROFILE_UPDATED;
  data: {
    userId: string;
  };
}

export interface FollowUpdatedEvent extends BaseEvent {
  type: EventType.FOLLOW_UPDATED;
  data: {
    userIds: string[];
  };
}

export interface FollowRequestUpdatedEvent extends BaseEvent {
  type: EventType.FOLLOW_REQUEST_UPDATED;
  data: {
    userIds: string[];
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

export interface ChatArchiveEvent extends BaseEvent {
  type: EventType.CHAT_ARCHIVED | EventType.CHAT_UNARCHIVED;
  data: {
    chatId: string;
    userId: string;
    archived: boolean;
    archivedAt?: string;
    chat?: any;
  };
}

export interface MessagePinEvent extends BaseEvent {
  type: EventType.MESSAGE_PINNED | EventType.MESSAGE_UNPINNED;
  data: {
    chatId: string;
    messageId: string;
    pinnedBy: string;
    participants: string[];
    pin?: any;
  };
}

export interface ActionCreatedEvent extends BaseEvent {
  type: EventType.ACTION_CREATED;
  data: {
    chatId: string;
    participants: string[];
    action: any;
  };
}

export interface ActionUpdatedEvent extends BaseEvent {
  type: EventType.ACTION_UPDATED;
  data: {
    chatId: string;
    participants: string[];
    action: any;
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
  | MomentReactionUpdatedEvent
  | MomentInteractionsUpdatedEvent
  | ProfileUpdatedEvent
  | FollowUpdatedEvent
  | FollowRequestUpdatedEvent
  | ChatCreatedEvent
  | ChatUpdatedEvent
  | ChatMemberAddedEvent
  | ChatMemberRemovedEvent
  | ChatArchiveEvent
  | MessagePinEvent
  | ActionCreatedEvent
  | ActionUpdatedEvent
  | UserOnlineEvent
  | UserOfflineEvent
  | UserTypingEvent
  | UserStopTypingEvent;
