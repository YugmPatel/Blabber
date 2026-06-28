import axios, { AxiosError } from 'axios';
import type {
  ChatActionExtractionResult,
  ChatActionItem,
  CreateChatActionDTO,
  UpdateChatActionDTO,
  GroupBrainAnswer,
  ChatDecision,
  ChatDecisionStatus,
  ChatIntelligenceSummary,
  ExtractChatActionsDTO,
  ExtractChatDecisionsDTO,
  GroupBrain,
  UpdateChatDecisionDTO,
  UpdateWaitingOnDTO,
  SummarizeChatDTO,
  WaitingOnExtractionResult,
  WaitingOnItem,
  WaitingOnStatus,
  Message,
  UpdateEventDTO,
} from '@repo/types';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Important for httpOnly cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

export const normalizeMediaUrl = (url?: string | null): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  const apiOrigin = new URL(API_URL, window.location.origin).origin;

  try {
    const parsed = new URL(url, apiOrigin);

    if (parsed.pathname.startsWith('/api/media/')) {
      return `${apiOrigin}${parsed.pathname}${parsed.search}`;
    }

    if (parsed.pathname.startsWith('/local/')) {
      return `${apiOrigin}/api/media${parsed.pathname}${parsed.search}`;
    }

    if (parsed.hostname === 'localhost' && parsed.port === '3005') {
      return `${apiOrigin}/api/media${parsed.pathname}${parsed.search}`;
    }

    return parsed.toString();
  } catch {
    return url;
  }
};

export interface MessageSearchResult {
  messageId: string;
  chatId: string;
  senderId: string;
  senderDisplayName: string;
  createdAt: string;
  snippet: string;
  type: Message['type'];
  attachmentLabel?: string;
  chatKind?: 'direct' | 'group';
}

export interface MessageSearchResponse {
  results: MessageSearchResult[];
  nextCursor: string | null;
}

export async function searchChatMessages(params: {
  chatId: string;
  q: string;
  cursor?: string | null;
  limit?: number;
}): Promise<MessageSearchResponse> {
  const { data } = await apiClient.get<MessageSearchResponse>('/api/messages/search', {
    params: {
      chatId: params.chatId,
      q: params.q,
      cursor: params.cursor || undefined,
      limit: params.limit,
    },
  });
  return data;
}

export async function searchGlobalMessages(params: {
  q: string;
  type?: Message['type'] | 'all';
  chatKind?: 'direct' | 'group' | 'all';
  cursor?: string | null;
  limit?: number;
}): Promise<MessageSearchResponse> {
  const { data } = await apiClient.get<MessageSearchResponse>('/api/messages/search/global', {
    params: {
      q: params.q,
      type: params.type && params.type !== 'all' ? params.type : undefined,
      chatKind: params.chatKind && params.chatKind !== 'all' ? params.chatKind : undefined,
      cursor: params.cursor || undefined,
      limit: params.limit,
    },
  });
  return data;
}

export async function forwardMessage(
  messageId: string,
  destinationChatIds: string[]
): Promise<{ messages: Message[] }> {
  const { data } = await apiClient.post<{ messages: Message[] }>(
    `/api/messages/${messageId}/forward`,
    { destinationChatIds }
  );
  return data;
}

export async function closePoll(messageId: string): Promise<Message> {
  const { data } = await apiClient.post<Message>(`/api/messages/${messageId}/poll/close`);
  return data;
}

export async function rsvpEvent(messageId: string, status: 'going' | 'maybe' | 'declined'): Promise<Message> {
  const { data } = await apiClient.post<Message>(`/api/messages/${messageId}/event/rsvp`, { status });
  return data;
}

export async function cancelEvent(messageId: string): Promise<Message> {
  const { data } = await apiClient.post<Message>(`/api/messages/${messageId}/event/cancel`);
  return data;
}

export async function updateEvent(messageId: string, patch: UpdateEventDTO): Promise<Message> {
  const { data } = await apiClient.patch<Message>(`/api/messages/${messageId}/event`, patch);
  return data;
}

export async function downloadEventIcs(messageId: string, filename = 'blabber-event.ics') {
  const { data, headers } = await apiClient.get<Blob>(`/api/messages/${messageId}/event.ics`, {
    responseType: 'blob',
  });
  const disposition = String(headers['content-disposition'] || '');
  const match = disposition.match(/filename="([^"]+)"/);
  const resolvedFilename = match?.[1] || filename;
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = resolvedFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface MessagePin {
  id: string;
  chatId: string;
  messageId: string;
  pinnedBy: string;
  pinnedAt: string;
  preview: {
    senderId: string;
    senderDisplayName: string;
    type?: string;
    snippet: string;
    attachmentLabel?: string;
    createdAt: string;
  };
}

export interface SavedMessageItem {
  id: string;
  chatId: string;
  messageId: string;
  savedAt: string;
  available: boolean;
  unavailableReason?: string;
  chatTitle?: string;
  preview?: MessagePin['preview'];
}

export type SharedContentType = 'media' | 'documents' | 'links';

export interface SharedContentItem {
  id: string;
  kind: 'media' | 'document' | 'link';
  messageId: string;
  chatId: string;
  senderDisplayName: string;
  createdAt: string;
  messageType?: Message['type'];
  snippet: string;
  source: { chatId: string; messageId: string };
  attachment?: {
    type?: string;
    url?: string;
    thumbnailUrl?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    label?: string;
    available?: boolean;
  };
  link?: {
    url: string;
    hostname: string;
  };
}

export interface SharedContentResponse {
  items: SharedContentItem[];
  nextCursor: string | null;
}

export async function fetchSharedContent(params: {
  chatId: string;
  type: SharedContentType;
  cursor?: string | null;
  limit?: number;
}): Promise<SharedContentResponse> {
  const { data } = await apiClient.get<SharedContentResponse>('/api/messages/shared', {
    params: {
      chatId: params.chatId,
      type: params.type,
      cursor: params.cursor || undefined,
      limit: params.limit,
    },
  });
  return data;
}

export async function fetchMessagePins(chatId: string): Promise<{ pins: MessagePin[]; canManagePins: boolean }> {
  const { data } = await apiClient.get<{ pins: MessagePin[]; canManagePins: boolean }>(`/api/messages/pins/${chatId}`);
  return data;
}

export async function pinMessage(messageId: string) {
  const { data } = await apiClient.post<{ pin: MessagePin }>(`/api/messages/${messageId}/pin`);
  return data.pin;
}

export async function unpinMessage(messageId: string) {
  await apiClient.delete(`/api/messages/${messageId}/pin`);
}

export interface BlockedUserItem {
  userId: string;
  blockedAt: string;
  user?: {
    _id: string;
    name?: string;
    username?: string;
    avatarUrl?: string;
  };
}

export async function fetchBlockedUsers(): Promise<{ blockedUsers: BlockedUserItem[] }> {
  const { data } = await apiClient.get<{ blockedUsers: BlockedUserItem[] }>('/api/users/blocked');
  return data;
}

export async function blockUser(userId: string) {
  await apiClient.post(`/api/users/${userId}/block`);
}

export async function unblockUser(userId: string) {
  await apiClient.delete(`/api/users/${userId}/block`);
}

export interface SocialProfile {
  name: string;
  handle: string | null;
  displayHandle: string | null;
  avatarUrl: string | null;
  bio?: string;
  website?: string | null;
  visibility?: 'private' | 'public';
  relationship: 'self' | 'none' | 'following' | 'requested_outgoing' | 'requested_incoming';
  locked?: boolean;
  message?: string;
  counts?: {
    followers: number;
    following: number;
    pendingRequests?: number;
  };
  profileUpdatedAt?: string;
  handleChangedAt?: string | null;
}

export interface ProfileListItem {
  name: string;
  handle: string | null;
  displayHandle: string | null;
  avatarUrl: string | null;
}

export async function fetchMyProfile(): Promise<SocialProfile> {
  const { data } = await apiClient.get<{ profile: SocialProfile }>('/api/profiles/me');
  return data.profile;
}

export async function updateSocialProfile(payload: {
  name?: string;
  bio?: string;
  website?: string;
  visibility?: 'private' | 'public';
}): Promise<SocialProfile> {
  const { data } = await apiClient.patch<{ profile: SocialProfile }>('/api/profiles/me', payload);
  return data.profile;
}

export async function updateProfileHandle(handle: string): Promise<SocialProfile> {
  const { data } = await apiClient.patch<{ profile: SocialProfile }>('/api/profiles/me/handle', { handle });
  return data.profile;
}

export async function fetchProfileByHandle(handle: string): Promise<SocialProfile> {
  const { data } = await apiClient.get<{ profile: SocialProfile }>(`/api/profiles/${encodeURIComponent(handle)}`);
  return data.profile;
}

export async function followProfile(handle: string): Promise<SocialProfile> {
  const { data } = await apiClient.post<{ profile: SocialProfile }>(`/api/profiles/${encodeURIComponent(handle)}/follow`);
  return data.profile;
}

export async function unfollowProfile(handle: string): Promise<SocialProfile> {
  const { data } = await apiClient.delete<{ profile: SocialProfile }>(`/api/profiles/${encodeURIComponent(handle)}/follow`);
  return data.profile;
}

export async function cancelFollowRequest(handle: string): Promise<SocialProfile> {
  const { data } = await apiClient.post<{ profile: SocialProfile }>(`/api/profiles/${encodeURIComponent(handle)}/cancel`);
  return data.profile;
}

export async function fetchIncomingFollowRequests(): Promise<{ requests: Array<{ requester: ProfileListItem; requestedAt: string }>; nextCursor: string | null }> {
  const { data } = await apiClient.get<{ requests: Array<{ requester: ProfileListItem; requestedAt: string }>; nextCursor: string | null }>('/api/profiles/requests/incoming');
  return data;
}

export async function approveFollowRequest(handle: string) {
  await apiClient.post(`/api/profiles/requests/${encodeURIComponent(handle)}/approve`);
}

export async function declineFollowRequest(handle: string) {
  await apiClient.post(`/api/profiles/requests/${encodeURIComponent(handle)}/decline`);
}

export async function removeFollower(handle: string) {
  await apiClient.delete(`/api/profiles/${encodeURIComponent(handle)}/follower`);
}

export interface TrustReport {
  id: string;
  targetType: 'user' | 'message' | 'group';
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export async function createReport(payload: {
  targetType: 'user' | 'message' | 'group';
  targetId: string;
  reason: string;
  details?: string;
}) {
  const { data } = await apiClient.post<{ report: TrustReport; duplicate?: boolean }>('/api/reports', payload);
  return data;
}

export async function fetchMyReports(): Promise<{ reports: TrustReport[] }> {
  const { data } = await apiClient.get<{ reports: TrustReport[] }>('/api/reports/mine');
  return data;
}

export interface GroupModerationActivityItem {
  id: string;
  action: string;
  actor: { _id: string; name?: string; username?: string; avatarUrl?: string };
  target?: { _id: string; name?: string; username?: string; avatarUrl?: string };
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export async function updateGroupModerationSettings(chatId: string, sendMode: 'everyone' | 'admins_only') {
  const { data } = await apiClient.patch<{ sendMode: 'everyone' | 'admins_only' }>(
    `/api/chats/${chatId}/moderation/settings`,
    { sendMode }
  );
  return data;
}

export async function updateGroupIntelligenceSettings(chatId: string, aiEnabled: boolean) {
  const { data } = await apiClient.patch<{ chat: { aiEnabled: boolean }; purge?: Record<string, number> | null }>(
    `/api/chats/${chatId}/intelligence/settings`,
    { aiEnabled }
  );
  return data;
}

export async function restrictGroupMember(chatId: string, userId: string) {
  const { data } = await apiClient.post<{ restricted: boolean }>(
    `/api/chats/${chatId}/moderation/members/${userId}/restrict`
  );
  return data;
}

export async function unrestrictGroupMember(chatId: string, userId: string) {
  const { data } = await apiClient.delete<{ restricted: boolean }>(
    `/api/chats/${chatId}/moderation/members/${userId}/restrict`
  );
  return data;
}

export async function moderationRemoveGroupMember(chatId: string, userId: string) {
  const { data } = await apiClient.delete<{ removed: boolean }>(
    `/api/chats/${chatId}/moderation/members/${userId}`
  );
  return data;
}

export async function fetchGroupModerationActivity(chatId: string) {
  const { data } = await apiClient.get<{ activity: GroupModerationActivityItem[] }>(
    `/api/chats/${chatId}/moderation/activity`
  );
  return data;
}

export async function fetchSavedMessages(): Promise<{ savedMessages: SavedMessageItem[] }> {
  const { data } = await apiClient.get<{ savedMessages: SavedMessageItem[] }>('/api/messages/saved');
  return data;
}

export async function saveMessage(messageId: string) {
  await apiClient.post(`/api/messages/${messageId}/save`);
}

export async function unsaveMessage(messageId: string) {
  await apiClient.delete(`/api/messages/${messageId}/save`);
}

export type InviteExpiry = 'never' | '1d' | '7d' | '30d';
export type InviteMaxUses = 'unlimited' | 10 | 50 | 100;

export interface InviteLinkSettings {
  id: string;
  chatId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  active: boolean;
}

export interface InviteSettingsPayload {
  expiresIn?: InviteExpiry;
  maxUses?: InviteMaxUses;
}

export interface InvitePreview {
  groupName: string;
  groupAvatarUrl?: string;
  alreadyMember: boolean;
  chatId?: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
}

export async function fetchInviteLinkSettings(chatId: string): Promise<{ invite: InviteLinkSettings | null }> {
  const { data } = await apiClient.get<{ invite: InviteLinkSettings | null }>(`/api/chats/${chatId}/invite-link`);
  return data;
}

export async function createInviteLink(chatId: string, payload: InviteSettingsPayload) {
  const { data } = await apiClient.post<{ invite: InviteLinkSettings; token: string }>(`/api/chats/${chatId}/invite-link`, payload);
  return data;
}

export async function regenerateInviteLink(chatId: string, payload: InviteSettingsPayload) {
  const { data } = await apiClient.post<{ invite: InviteLinkSettings; token: string }>(`/api/chats/${chatId}/invite-link/regenerate`, payload);
  return data;
}

export async function revokeInviteLink(chatId: string) {
  const { data } = await apiClient.post<{ invite: null }>(`/api/chats/${chatId}/invite-link/revoke`);
  return data;
}

export async function previewInvite(token: string): Promise<{ invite: InvitePreview }> {
  const { data } = await apiClient.get<{ invite: InvitePreview }>(`/api/invites/${encodeURIComponent(token)}/preview`);
  return data;
}

export async function joinInvite(token: string): Promise<{ chat: import('@repo/types').Chat; alreadyMember: boolean }> {
  const { data } = await apiClient.post<{ chat: import('@repo/types').Chat; alreadyMember: boolean }>(`/api/invites/${encodeURIComponent(token)}/join`);
  return data;
}

export interface PasswordActionResponse {
  success: boolean;
  message: string;
}

export async function requestPasswordReset(email: string): Promise<PasswordActionResponse> {
  const { data } = await apiClient.post<PasswordActionResponse>('/api/auth/password/forgot', {
    email,
  });
  return data;
}

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<PasswordActionResponse> {
  const { data } = await apiClient.post<PasswordActionResponse>('/api/auth/password/reset', {
    token,
    newPassword,
  });
  return data;
}

export interface AccountStatus {
  user: {
    _id: string;
    username: string;
    email: string;
    name: string;
    emailVerified: boolean;
    authProvider?: 'password' | 'google' | 'both';
    deletionScheduledAt?: string;
  };
  deletion: { status: string; scheduledFor: string } | null;
  export: AccountExport | null;
}

export interface DeviceSession {
  id: string;
  label: string;
  createdAt: string;
  lastActiveAt?: string;
  expiresAt: string;
  current: boolean;
}

export interface AccountExport {
  id: string;
  status: 'preparing' | 'ready' | 'failed' | 'expired';
  requestedAt: string;
  readyAt?: string;
  expiresAt?: string;
}

export async function fetchAccountStatus(): Promise<AccountStatus> {
  const { data } = await apiClient.get<AccountStatus>('/api/auth/account/status');
  return data;
}

export async function resendEmailVerification(): Promise<{ success: boolean; emailVerified?: boolean }> {
  const { data } = await apiClient.post<{ success: boolean; emailVerified?: boolean }>(
    '/api/auth/account/email/verification/resend'
  );
  return data;
}

export async function requestEmailChange(payload: { newEmail: string; currentPassword: string }) {
  const { data } = await apiClient.post<{ success: boolean; message: string }>(
    '/api/auth/account/email/change/request',
    payload
  );
  return data;
}

export async function fetchDeviceSessions(): Promise<{ sessions: DeviceSession[] }> {
  const { data } = await apiClient.get<{ sessions: DeviceSession[] }>('/api/auth/account/sessions');
  return data;
}

export async function revokeDeviceSession(sessionId: string): Promise<{ success: boolean; currentRevoked?: boolean }> {
  const { data } = await apiClient.delete<{ success: boolean; currentRevoked?: boolean }>(
    `/api/auth/account/sessions/${sessionId}`
  );
  return data;
}

export async function logoutOtherDeviceSessions(): Promise<{ success: boolean; revoked: number }> {
  const { data } = await apiClient.post<{ success: boolean; revoked: number }>(
    '/api/auth/account/sessions/logout-others'
  );
  return data;
}

export async function requestDataExport(currentPassword: string): Promise<{ export: AccountExport }> {
  const { data } = await apiClient.post<{ export: AccountExport }>('/api/auth/account/export', {
    currentPassword,
  });
  return data;
}

export async function fetchDataExports(): Promise<{ exports: AccountExport[] }> {
  const { data } = await apiClient.get<{ exports: AccountExport[] }>('/api/auth/account/export');
  return data;
}

export async function downloadDataExport(exportId: string) {
  const { data, headers } = await apiClient.get<Blob>(`/api/auth/account/export/${exportId}/download`, {
    responseType: 'blob',
  });
  const disposition = String(headers['content-disposition'] || '');
  const match = disposition.match(/filename="([^"]+)"/);
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] || 'blabber-data-export.zip';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function requestAccountDeletion(payload: { currentPassword: string; confirmation: 'DELETE' }) {
  const { data } = await apiClient.post<{ deletion: { id: string; status: string; scheduledFor: string } }>(
    '/api/auth/account/deletion',
    payload
  );
  return data;
}

export interface ChatSummaryResponse {
  summary: ChatIntelligenceSummary | null;
}

export async function fetchLatestChatSummary(chatId: string): Promise<ChatSummaryResponse> {
  const { data } = await apiClient.get<ChatSummaryResponse>(`/api/intelligence/chats/${chatId}/summary`);
  return data;
}

export async function generateChatSummary(
  chatId: string,
  payload?: SummarizeChatDTO
): Promise<{ summary: ChatIntelligenceSummary }> {
  const { data } = await apiClient.post<{ summary: ChatIntelligenceSummary }>(
    `/api/intelligence/chats/${chatId}/summarize`,
    payload ?? {}
  );
  return data;
}

export interface ChatActionsResponse {
  actions: ChatActionItem[];
}

export async function fetchChatActions(chatId: string): Promise<ChatActionsResponse> {
  const { data } = await apiClient.get<ChatActionsResponse>(
    `/api/intelligence/chats/${chatId}/actions`
  );
  return data;
}

export async function fetchMyActions(): Promise<ChatActionsResponse> {
  const { data } = await apiClient.get<ChatActionsResponse>('/api/intelligence/actions/mine');
  return data;
}

export async function extractChatActions(
  chatId: string,
  payload?: ExtractChatActionsDTO
): Promise<ChatActionExtractionResult> {
  const { data } = await apiClient.post<ChatActionExtractionResult>(
    `/api/intelligence/chats/${chatId}/actions/extract`,
    payload ?? {}
  );
  return data;
}

export async function updateChatAction(
  actionId: string,
  patch: UpdateChatActionDTO
): Promise<{ action: ChatActionItem }> {
  const { data } = await apiClient.patch<{ action: ChatActionItem }>(
    `/api/intelligence/actions/${actionId}`,
    patch
  );
  return data;
}

export async function deleteChatAction(
  actionId: string,
  reason?: string
): Promise<{ action: ChatActionItem }> {
  const { data } = await apiClient.delete<{ action: ChatActionItem }>(
    `/api/intelligence/actions/${actionId}`,
    { data: { reason } }
  );
  return data;
}

export async function addChatActionUpdate(
  actionId: string,
  body: string
): Promise<{ action: ChatActionItem }> {
  const { data } = await apiClient.post<{ action: ChatActionItem }>(
    `/api/intelligence/actions/${actionId}/updates`,
    { body }
  );
  return data;
}

export async function createChatAction(
  chatId: string,
  payload: CreateChatActionDTO
): Promise<{ action: ChatActionItem; duplicate?: boolean }> {
  const { data } = await apiClient.post<{ action: ChatActionItem; duplicate?: boolean }>(
    `/api/intelligence/chats/${chatId}/actions`,
    payload
  );
  return data;
}

export interface ChatDecisionsResponse {
  decisions: ChatDecision[];
}

export async function fetchChatDecisions(chatId: string): Promise<ChatDecisionsResponse> {
  const { data } = await apiClient.get<ChatDecisionsResponse>(
    `/api/intelligence/chats/${chatId}/decisions`
  );
  return data;
}

export async function extractChatDecisions(
  chatId: string,
  payload?: ExtractChatDecisionsDTO
): Promise<{ decisions: ChatDecision[]; generatedAt: string; sourceMessageIds: string[]; summary?: string }> {
  const { data } = await apiClient.post<{
    decisions: ChatDecision[];
    generatedAt: string;
    sourceMessageIds: string[];
    summary?: string;
  }>(`/api/intelligence/chats/${chatId}/decisions/extract`, payload ?? {});
  return data;
}

export async function updateChatDecision(
  decisionId: string,
  patch: UpdateChatDecisionDTO & { status?: ChatDecisionStatus }
): Promise<{ decision: ChatDecision }> {
  const { data } = await apiClient.patch<{ decision: ChatDecision }>(
    `/api/intelligence/decisions/${decisionId}`,
    patch
  );
  return data;
}

export async function deleteChatDecision(decisionId: string): Promise<void> {
  await apiClient.delete(`/api/intelligence/decisions/${decisionId}`);
}

export interface WaitingOnResponse {
  waitingOn: WaitingOnItem[];
}

export async function fetchWaitingOnItems(chatId: string): Promise<WaitingOnResponse> {
  const { data } = await apiClient.get<WaitingOnResponse>(
    `/api/intelligence/chats/${chatId}/waiting-on`
  );
  return data;
}

export async function extractWaitingOnItems(
  chatId: string,
  payload?: { messageLimit?: number }
): Promise<WaitingOnExtractionResult> {
  const { data } = await apiClient.post<WaitingOnExtractionResult>(
    `/api/intelligence/chats/${chatId}/waiting-on/extract`,
    payload ?? {}
  );
  return data;
}

export async function updateWaitingOnItem(
  itemId: string,
  patch: UpdateWaitingOnDTO & { status?: WaitingOnStatus }
): Promise<{ item: WaitingOnItem }> {
  const { data } = await apiClient.patch<{ item: WaitingOnItem }>(
    `/api/intelligence/waiting-on/${itemId}`,
    patch
  );
  return data;
}

export async function deleteWaitingOnItem(itemId: string): Promise<void> {
  await apiClient.delete(`/api/intelligence/waiting-on/${itemId}`);
}

export interface GroupBrainResponse {
  brain: GroupBrain;
}

export async function fetchGroupBrain(chatId: string): Promise<GroupBrainResponse> {
  const { data } = await apiClient.get<GroupBrainResponse>(
    `/api/intelligence/chats/${chatId}/brain`
  );
  return data;
}

export async function askGroupBrain(
  chatId: string,
  question: string
): Promise<GroupBrainAnswer> {
  const { data } = await apiClient.post<GroupBrainAnswer>(
    `/api/intelligence/chats/${chatId}/brain/ask`,
    { question }
  );
  return data;
}

export async function fetchMessageWindow(
  chatId: string,
  messageId: string
): Promise<{ messages: Message[]; targetMessageId: string }> {
  const { data } = await apiClient.get<{ messages: Message[]; targetMessageId: string }>(
    `/api/messages/source/${messageId}/window`,
    { params: { chatId, before: 20, after: 20 } }
  );
  return data;
}

export interface CallHistoryItem {
  id: string;
  callId: string;
  chatId: string;
  chatTitle?: string;
  chatType: 'direct' | 'group';
  callType: 'audio' | 'video';
  callerId: string;
  participantIds: string[];
  participantProfiles: { _id: string; name: string; avatarUrl?: string }[];
  outcome: 'ringing' | 'answered' | 'missed' | 'declined' | 'cancelled' | 'ended';
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  note?: string;
}

export async function fetchCallHistory(): Promise<{ calls: CallHistoryItem[] }> {
  const { data } = await apiClient.get<{ calls: CallHistoryItem[] }>('/api/calls');
  return data;
}

// Request interceptor to add Bearer token
apiClient.interceptors.request.use(
  (config: any) => {
    if (accessToken && config.headers) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for 401 handling and silent token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any & {
      _retry?: boolean;
    };

    const requestUrl = originalRequest.url || '';
    const isPasswordResetRequest = requestUrl.startsWith('/api/auth/password/');

    // If 401 and we haven't retried yet, attempt token refresh
    if (error.response?.status === 401 && !originalRequest._retry && !isPasswordResetRequest) {
      originalRequest._retry = true;

      try {
        // Call refresh endpoint (uses httpOnly cookie)
        const response = await axios.post(
          `${API_URL}/api/auth/refresh`,
          {},
          { withCredentials: true }
        );

        const { accessToken: newAccessToken } = response.data;
        setAccessToken(newAccessToken);

        // Retry the original request with new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh failed, clear token
        setAccessToken(null);
        // Don't redirect here - let the app handle it
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
