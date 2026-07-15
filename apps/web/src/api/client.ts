import axios, { AxiosError } from 'axios';
import type {
  Chat,
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

function resolveApiUrl() {
  const configured = String(import.meta.env.VITE_API_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const allowLocalFallback =
    import.meta.env.DEV || String(import.meta.env.VITE_ALLOW_LOCAL_API_FALLBACK || '').toLowerCase() === 'true';
  if (allowLocalFallback) return 'http://localhost:3000';

  throw new Error('VITE_API_URL is required for non-local web builds');
}

export const API_URL = resolveApiUrl();

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

let refreshAccessTokenRequest: Promise<string> | null = null;

export function refreshAccessToken(): Promise<string> {
  if (!refreshAccessTokenRequest) {
    const request = axios
      .post<{ accessToken: string }>(`${API_URL}/api/auth/refresh`, {}, { withCredentials: true })
      .then((response) => {
        setAccessToken(response.data.accessToken);
        return response.data.accessToken;
      });

    refreshAccessTokenRequest = request;
    void request.then(
      () => {
        if (refreshAccessTokenRequest === request) refreshAccessTokenRequest = null;
      },
      () => {
        if (refreshAccessTokenRequest === request) refreshAccessTokenRequest = null;
      }
    );
  }

  return refreshAccessTokenRequest;
}

export const normalizeMediaUrl = (url?: string | null): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  const apiOrigin = new URL(API_URL, window.location.origin).origin;

  try {
    const parsed = new URL(url, apiOrigin);

    if (parsed.pathname.startsWith('/api/')) {
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

export function apiErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!axios.isAxiosError(error)) return fallback;
  const data = error.response?.data as any;
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  if (Array.isArray(data?.details) && data.details[0]?.message) return data.details[0].message;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return error.message || fallback;
}

export async function fetchAuthorizedObjectUrl(url?: string | null): Promise<string | undefined> {
  const normalizedUrl = normalizeMediaUrl(url);
  if (!normalizedUrl) return undefined;
  if (normalizedUrl.startsWith('blob:') || normalizedUrl.startsWith('data:')) return normalizedUrl;
  const request = (token: string | null) => axios.get<Blob>(normalizedUrl, {
    responseType: 'blob',
    withCredentials: true,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  let response;
  try {
    response = await request(accessToken);
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) throw error;
    const token = await refreshAccessToken();
    response = await request(token);
  }
  return URL.createObjectURL(response.data);
}

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

export async function muteUser(userId: string) {
  await apiClient.post(`/api/users/${userId}/mute`);
}

export async function unmuteUser(userId: string) {
  await apiClient.delete(`/api/users/${userId}/mute`);
}

// ── Safe user discovery / New Convo ─────────────────────────────────────────

export type RelationshipStatus = 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'blocked';

export interface UserSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  bioPreview?: string;
  isVerified: boolean;
  relationshipStatus: RelationshipStatus;
  canMessage: boolean;
  requiresMessageRequest: boolean;
}

export async function searchUsers(query: string, cursor?: string | null): Promise<{ users: UserSearchResult[]; nextCursor: string | null }> {
  const { data } = await apiClient.get<{ users: UserSearchResult[]; nextCursor: string | null }>('/api/users/search', {
    params: { q: query, cursor: cursor || undefined },
  });
  return data;
}

export async function fetchUserProfileByUsername(username: string) {
  const { data } = await apiClient.get(`/api/users/profile/${encodeURIComponent(username)}`);
  return data;
}

export interface MyDiscoveryInfo {
  username: string;
  profileUrl: string | null;
  inviteUrl: string | null;
  qrPayload: string | null;
  discoverabilitySettings: {
    profileVisibility: 'public' | 'private';
    searchVisibility: 'everyone' | 'followers' | 'contacts' | 'no_one';
    emailDiscoverability: 'exact_match' | 'nobody';
  };
}

export async function fetchMyDiscoveryInfo(): Promise<MyDiscoveryInfo> {
  const { data } = await apiClient.get<MyDiscoveryInfo>('/api/users/me/discovery');
  return data;
}

export async function createProfileInvite(): Promise<{ token: string; url: string; expiresAt: string }> {
  const { data } = await apiClient.post('/api/users/invites');
  return data;
}

export interface PrivacySettings {
  profileVisibility: 'public' | 'private';
  searchVisibility: 'everyone' | 'followers' | 'contacts' | 'no_one';
  emailDiscoverability: 'exact_match' | 'nobody';
  messagePermission: 'everyone' | 'followers' | 'no_one';
  groupAddPermission: 'everyone' | 'followers' | 'contacts' | 'no_one';
  callPermission: 'everyone' | 'no_one';
  updatedAt?: string;
}

export async function fetchMyPrivacySettings(): Promise<{ privacy: PrivacySettings }> {
  const { data } = await apiClient.get<{ privacy: PrivacySettings }>('/api/users/me/privacy');
  return data;
}

export async function updateMyPrivacySettings(patch: Partial<PrivacySettings>): Promise<{ privacy: PrivacySettings }> {
  const { data } = await apiClient.patch<{ privacy: PrivacySettings }>('/api/users/me/privacy', patch);
  return data;
}

// ── Message requests ─────────────────────────────────────────────────────────

export type MessageRequestStatus = 'pending' | 'accepted' | 'declined';

export interface MessageRequestSummary {
  id: string;
  senderId: string;
  recipientId: string;
  status: MessageRequestStatus;
  introMessage?: string;
  chatId?: string;
  createdAt: string;
  updatedAt: string;
  respondedAt?: string;
}

export interface MessageRequestWithSender extends MessageRequestSummary {
  sender: { id: string; username?: string; displayName?: string; avatarUrl?: string };
}

export interface MessageRequestWithRecipient extends MessageRequestSummary {
  recipient: { id: string; username?: string; displayName?: string; avatarUrl?: string };
}

export async function sendMessageRequest(recipientId: string, introMessage?: string) {
  const { data } = await apiClient.post<{ status: 'accepted' | 'pending'; chat?: Chat; request?: MessageRequestSummary }>(
    '/api/chats/message-requests',
    { recipientId, introMessage: introMessage || undefined }
  );
  return data;
}

export async function fetchMessageRequestInbox(): Promise<{ requests: MessageRequestWithSender[] }> {
  const { data } = await apiClient.get<{ requests: MessageRequestWithSender[] }>('/api/chats/message-requests/inbox');
  return data;
}

export async function fetchSentMessageRequests(): Promise<{ requests: MessageRequestWithRecipient[] }> {
  const { data } = await apiClient.get<{ requests: MessageRequestWithRecipient[] }>('/api/chats/message-requests/sent');
  return data;
}

export async function acceptMessageRequest(requestId: string): Promise<{ status: 'accepted'; chat: Chat }> {
  const { data } = await apiClient.post(`/api/chats/message-requests/${requestId}/accept`);
  return data;
}

export async function declineMessageRequest(requestId: string): Promise<{ status: 'declined' }> {
  const { data } = await apiClient.post(`/api/chats/message-requests/${requestId}/decline`);
  return data;
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
  creatorDiscovery?: {
    enabled: boolean;
    topicIds: string[];
    enabledAt?: string | null;
    updatedAt?: string | null;
    showPostsInDiscover?: boolean;
    showReelsInDiscover?: boolean;
    suggestMeToOthers?: boolean;
    usernameFindability?: 'everyone' | 'followers' | 'contacts' | 'no_one';
    hideBlockedUsers?: boolean;
  };
}

export interface FeedPost {
  id: string;
  author: ProfileListItem & {
    id: string;
    profileVisibility?: 'private' | 'public';
    relationship?: 'self' | 'none' | 'following' | 'requested_outgoing' | 'requested_incoming';
  };
  body: string;
  visibility?: 'public' | 'followers';
  media: Array<{ mediaId: string; type: 'image'; url: string }>;
  sourceAttribution?: { label: string; creatorName: string | null };
  commentCount: number;
  reactionCounts: Record<string, number>;
  myReaction: string | null;
  saved?: boolean;
  reposted?: boolean;
  canSave?: boolean;
  canRepost?: boolean;
  canShare?: boolean;
  repost?: {
    id: string;
    createdAt: string;
    repostedBy: ProfileListItem & { id: string };
  } | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  discovery?: {
    discoverable: boolean;
    topicIds: string[];
    updatedAt?: string | null;
  };
}

export interface FeedComment {
  id: string;
  author: ProfileListItem & { id: string };
  body: string;
  createdAt: string;
}

export interface ProfileListItem {
  id: string;
  username?: string | null;
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

export async function fetchFeed(cursor?: string | null, mode: 'following' | 'featured' = 'following'): Promise<{ posts: FeedPost[]; nextCursor: string | null; mode?: string }> {
  const { data } = await apiClient.get<{ posts: FeedPost[]; nextCursor: string | null }>('/api/feed', {
    params: { cursor: cursor || undefined, mode },
  });
  return data;
}

export async function fetchProfilePosts(handle: string, cursor?: string | null): Promise<{ posts: FeedPost[]; nextCursor: string | null }> {
  const { data } = await apiClient.get<{ posts: FeedPost[]; nextCursor: string | null }>(
    `/api/profiles/${encodeURIComponent(handle)}/posts`,
    { params: { cursor: cursor || undefined } }
  );
  return data;
}

export async function createPost(payload: {
  body?: string;
  visibility: 'public' | 'followers';
  mediaIds?: string[];
}): Promise<FeedPost> {
  const { data } = await apiClient.post<{ post: FeedPost }>('/api/posts', payload);
  return data.post;
}

export async function deletePost(postId: string) {
  await apiClient.delete(`/api/posts/${postId}`);
}

export async function fetchPost(postId: string): Promise<FeedPost> {
  const { data } = await apiClient.get<{ post: FeedPost }>(`/api/posts/${postId}`);
  return data.post;
}

export async function savePost(postId: string) {
  const { data } = await apiClient.post<{ saved: boolean }>(`/api/posts/${postId}/save`);
  return data;
}

export async function unsavePost(postId: string) {
  const { data } = await apiClient.delete<{ saved: boolean }>(`/api/posts/${postId}/save`);
  return data;
}

export async function fetchSavedPosts(cursor?: string | null): Promise<{ savedPosts: Array<{ savedAt: string; post: FeedPost }>; nextCursor: string | null }> {
  const { data } = await apiClient.get<{ savedPosts: Array<{ savedAt: string; post: FeedPost }>; nextCursor: string | null }>('/api/posts/saved', {
    params: { cursor: cursor || undefined },
  });
  return data;
}

export async function repostPost(postId: string) {
  const { data } = await apiClient.post<{ reposted: boolean }>(`/api/posts/${postId}/repost`);
  return data;
}

export async function undoRepostPost(postId: string) {
  const { data } = await apiClient.delete<{ reposted: boolean }>(`/api/posts/${postId}/repost`);
  return data;
}

export async function updatePostDiscovery(postId: string, payload: { discoverable: boolean; discoveryTopicIds: string[] }): Promise<FeedPost> {
  const { data } = await apiClient.patch<{ post: FeedPost }>(`/api/posts/${postId}/discovery`, payload);
  return data.post;
}

export async function setPostReaction(postId: string, emoji: string): Promise<{ reactionCounts: Record<string, number>; myReaction: string }> {
  const { data } = await apiClient.post<{ reactionCounts: Record<string, number>; myReaction: string }>(
    `/api/posts/${postId}/reaction`,
    { emoji }
  );
  return data;
}

export async function removePostReaction(postId: string): Promise<{ reactionCounts: Record<string, number>; myReaction: null }> {
  const { data } = await apiClient.delete<{ reactionCounts: Record<string, number>; myReaction: null }>(
    `/api/posts/${postId}/reaction`
  );
  return data;
}

export async function fetchPostComments(postId: string, cursor?: string | null): Promise<{ comments: FeedComment[]; nextCursor: string | null }> {
  const { data } = await apiClient.get<{ comments: FeedComment[]; nextCursor: string | null }>(
    `/api/posts/${postId}/comments`,
    { params: { cursor: cursor || undefined } }
  );
  return data;
}

export async function createPostComment(postId: string, body: string): Promise<{ comment: FeedComment; commentCount: number }> {
  const { data } = await apiClient.post<{ comment: FeedComment; commentCount: number }>(
    `/api/posts/${postId}/comments`,
    { body }
  );
  return data;
}

export async function deletePostComment(postId: string, commentId: string): Promise<{ commentCount: number }> {
  const { data } = await apiClient.delete<{ commentCount: number }>(`/api/posts/${postId}/comments/${commentId}`);
  return data;
}

export type PlanThisSourceType = 'post' | 'reel';
export type PlanThisVoteStatus = 'going' | 'maybe' | 'not_joining';
export type PlanThisTaskStatus = 'unassigned' | 'pending_response' | 'accepted' | 'declined' | 'cancelled' | 'completed';

export interface PlanThisPlan {
  id: string;
  chatId: string;
  creatorUserId: string;
  source: {
    type: PlanThisSourceType;
    available: boolean;
    sourceId?: string;
    previewLabel?: string;
    creatorLabel?: string;
    topics?: string[];
  };
  state: 'draft' | 'proposed' | 'voting' | 'ready_to_finalize' | 'finalized' | 'cancelled' | 'expired';
  title: string;
  description: string;
  suggestedAt: string | null;
  suggestedLocation: string;
  budgetNotes: string;
  checklist: string[];
  participants: Array<{ userId: string; displayName?: string }>;
  votes: Array<{ userId: string; status: PlanThisVoteStatus; planVersion?: number; current?: boolean; updatedAt: string }>;
  myVote: PlanThisVoteStatus | null;
  assignments: Array<{
    id: string;
    title: string;
    details?: string;
    dueAt?: string;
    assigneeUserId?: string;
    status: 'requested' | 'accepted' | 'declined';
    taskStatus?: PlanThisTaskStatus;
    acceptedBy?: string;
    acceptedAt?: string;
    declinedAt?: string;
    actionId?: string;
  }>;
  proposalMessageId?: string;
  eventMessageId?: string;
  eventReminderOffsetMinutes?: number;
  updateCount: number;
  planVersion?: number;
  lastMaterialChangeAt?: string;
  finalizedAt?: string;
  createdAt: string;
  updatedAt: string;
  permissions: { canEdit: boolean; canCancel?: boolean; canFinalize: boolean; canVote: boolean };
}

export interface PlanThisDestination {
  id: string;
  type: 'direct' | 'group';
  name: string;
  avatarUrl?: string | null;
  memberCount?: number;
  participants: Array<{ userId: string; displayName: string }>;
}

export interface PlanThisEligibilitySource {
  type: PlanThisSourceType;
  previewLabel: string;
  creatorLabel?: string;
  topics: string[];
}

export async function checkPlanThisEligibility(source: { type: PlanThisSourceType; id: string }) {
  const { data } = await apiClient.get<{ eligible: boolean; source: PlanThisEligibilitySource | null }>('/api/plan-this/eligibility', { params: source });
  return data;
}

export async function fetchPlanThisDestinations(): Promise<PlanThisDestination[]> {
  const { data } = await apiClient.get<{ destinations: PlanThisDestination[] }>('/api/plan-this/destinations');
  return data.destinations;
}

export async function generatePlanThisDraft(payload: { source: { type: PlanThisSourceType; id: string }; note?: string }) {
  const { data } = await apiClient.post<{
    draft: {
      title: string;
      description: string;
      suggestedLocation: string;
      budgetNotes: string;
      checklist: string[];
      aiContextUsed: {
        sourceType: PlanThisSourceType;
        captionOrTitle: string;
        controlledTopics: string[];
        safeCreatorDisplayLabel: string;
        userEnteredNoteIncluded: boolean;
      };
    };
  }>('/api/plan-this/draft', payload);
  return data.draft;
}

export async function createPlanThisProposal(payload: {
  source: { type: PlanThisSourceType; id: string };
  chatId: string;
  participantUserIds: string[];
  title: string;
  description: string;
  suggestedAt?: string;
  suggestedLocation?: string;
  budgetNotes?: string;
  checklist: string[];
  clientRequestId: string;
}): Promise<PlanThisPlan> {
  const { data } = await apiClient.post<{ plan: PlanThisPlan }>('/api/plan-this/plans', payload);
  return data.plan;
}

export async function fetchPlanThisPlan(planId: string): Promise<PlanThisPlan> {
  const { data } = await apiClient.get<{ plan: PlanThisPlan }>(`/api/plan-this/plans/${planId}`);
  return data.plan;
}

export async function votePlanThis(planId: string, status: PlanThisVoteStatus): Promise<PlanThisPlan> {
  const { data } = await apiClient.post<{ plan: PlanThisPlan }>(`/api/plan-this/plans/${planId}/vote`, { status });
  return data.plan;
}

export async function updatePlanThis(planId: string, payload: Partial<{
  title: string;
  description: string;
  suggestedAt: string | null;
  suggestedLocation: string | null;
  budgetNotes: string | null;
  checklist: string[];
  participantUserIds: string[];
}>): Promise<PlanThisPlan> {
  const { data } = await apiClient.patch<{ plan: PlanThisPlan }>(`/api/plan-this/plans/${planId}`, payload);
  return data.plan;
}

export async function finalizePlanThis(planId: string, payload: {
  createEvent: boolean;
  finalDateTime?: string;
  reminderEnabled: boolean;
  reminderOffsetMinutes?: number;
  assignments: Array<{ title: string; details?: string; assigneeUserId?: string; dueAt?: string }>;
}): Promise<PlanThisPlan> {
  const { data } = await apiClient.post<{ plan: PlanThisPlan }>(`/api/plan-this/plans/${planId}/finalize`, payload);
  return data.plan;
}

export async function cancelPlanThis(planId: string): Promise<PlanThisPlan> {
  const { data } = await apiClient.post<{ plan: PlanThisPlan }>(`/api/plan-this/plans/${planId}/cancel`);
  return data.plan;
}

export async function respondPlanThisAssignment(planId: string, assignmentId: string, status: 'accepted' | 'declined'): Promise<PlanThisPlan> {
  const { data } = await apiClient.post<{ plan: PlanThisPlan }>(`/api/plan-this/plans/${planId}/assignments/${assignmentId}/respond`, { status });
  return data.plan;
}

export interface VeyraSettings {
  enabled: boolean;
  voiceRepliesEnabled: boolean;
  scopes: Array<{ id: string; type: 'general' | 'my_actions' | 'chat' | 'community'; targetId?: string; label?: string; grantedAt: string }>;
  updatedAt: string;
}

export async function fetchVeyraSettings() {
  const { data } = await apiClient.get<{ settings: VeyraSettings; globalAiEnabled: boolean }>('/api/veyra/settings');
  return data;
}

export async function updateVeyraSettings(payload: Partial<Pick<VeyraSettings, 'enabled' | 'voiceRepliesEnabled'>>) {
  const { data } = await apiClient.patch<{ settings: VeyraSettings }>('/api/veyra/settings', payload);
  return data.settings;
}

export async function fetchVeyraScopeCandidates() {
  const { data } = await apiClient.get<{ candidates: Array<{ type: VeyraSettings['scopes'][number]['type']; targetId?: string; label: string }> }>('/api/veyra/scopes/candidates');
  return data.candidates;
}

export async function grantVeyraScope(payload: { type: VeyraSettings['scopes'][number]['type']; targetId?: string }) {
  const { data } = await apiClient.post<{ settings: VeyraSettings }>('/api/veyra/scopes', payload);
  return data.settings;
}

export async function revokeVeyraScope(scopeId: string) {
  const { data } = await apiClient.delete<{ settings: VeyraSettings }>(`/api/veyra/scopes/${encodeURIComponent(scopeId)}`);
  return data.settings;
}

export type VeyraResultType = 'chat' | 'message' | 'link' | 'attachment' | 'plan' | 'event' | 'task' | 'empty';

export interface VeyraResultCard {
  resultType: Exclude<VeyraResultType, 'empty'>;
  id: string;
  title: string;
  subtitle?: string;
  senderName?: string;
  chatId?: string;
  chatLabel?: string;
  createdAt?: string;
  sourceLabel?: string;
  deepLink?: { kind: 'chat_message'; chatId: string; messageId: string } | { kind: 'action'; actionId: string };
}

export interface VeyraConversationContext {
  activeSpaceId?: string;
  activeSpaceName?: string;
  activePlanId?: string;
  activePlanTitle?: string;
  activeEventId?: string;
  lastResultKind?: VeyraResultType;
}

export interface VeyraAskResponse {
  answer: string;
  intent: string;
  scope: { id: string; type: string; label: string } | null;
  resultType: VeyraResultType;
  results: VeyraResultCard[];
  ambiguous?: boolean;
  candidates?: Array<{ scopeId: string; label: string }>;
  actionDeferred?: boolean;
  context?: VeyraConversationContext;
  suggestManageAiPrivacy?: boolean;
}

export async function askVeyra(payload: { prompt: string; scopeId?: string; context?: VeyraConversationContext }) {
  const { data } = await apiClient.post<VeyraAskResponse>('/api/veyra/ask', payload);
  return data;
}

export async function approveFollowRequest(identifier: string) {
  await apiClient.post(`/api/profiles/requests/${encodeURIComponent(identifier)}/approve`);
}

export async function declineFollowRequest(identifier: string) {
  await apiClient.post(`/api/profiles/requests/${encodeURIComponent(identifier)}/decline`);
}

export async function removeFollower(handle: string) {
  await apiClient.delete(`/api/profiles/${encodeURIComponent(handle)}/follower`);
}

export interface TrustReport {
  id: string;
  targetType: 'user' | 'message' | 'group' | 'post' | 'post_comment' | 'community' | 'community_post' | 'community_comment';
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityUser {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

export interface Community {
  id: string;
  name: string;
  handle: string;
  description: string;
  avatarUrl: string | null;
  membershipMode: 'open' | 'approval_required' | 'private';
  postingPolicy?: 'everyone' | 'mods_admins' | 'admins_only';
  memberCount: number;
  membership: null | { role: 'owner' | 'admin' | 'moderator' | 'member'; postingRestricted: boolean; joinedAt: string };
  joinRequest: null | { status: 'pending'; requestedAt: string };
  canManage: boolean;
  canModerate: boolean;
  canPost: boolean;
  discovery?: {
    communityDiscoverable: boolean;
    topicIds: string[];
    updatedAt?: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CommunityPost {
  id: string;
  communityId: string;
  author: CommunityUser;
  body: string;
  media: Array<{ mediaId: string; type: 'image'; url: string }>;
  commentCount: number;
  reactionCounts: Record<string, number>;
  myReaction: string | null;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
}

export interface CommunityComment {
  id: string;
  author: CommunityUser;
  body: string;
  canDelete: boolean;
  createdAt: string;
}

export async function fetchCommunities(): Promise<{ communities: Community[]; pending: Community[] }> {
  const { data } = await apiClient.get<{ communities: Community[]; pending: Community[] }>('/api/communities');
  return data;
}

export async function createCommunity(payload: {
  name: string;
  handle?: string;
  description?: string;
  membershipMode: 'open' | 'approval_required' | 'private';
  postingPolicy: 'everyone' | 'mods_admins' | 'admins_only';
  avatarMediaId?: string;
}): Promise<Community> {
  const { data } = await apiClient.post<{ community: Community }>('/api/communities', payload);
  return data.community;
}

export async function fetchCommunity(handle: string): Promise<Community> {
  const { data } = await apiClient.get<{ community: Community }>(`/api/communities/${encodeURIComponent(handle)}`);
  return data.community;
}

export async function updateCommunity(handle: string, payload: Partial<Pick<Community, 'name' | 'description' | 'membershipMode' | 'postingPolicy'>>): Promise<Community> {
  const { data } = await apiClient.patch<{ community: Community }>(`/api/communities/${encodeURIComponent(handle)}`, payload);
  return data.community;
}

export async function updateCommunityDiscovery(handle: string, payload: { communityDiscoverable: boolean; communityTopicIds: string[] }) {
  const { data } = await apiClient.patch<{ discovery: { communityDiscoverable: boolean; topics: DiscoveryTopic[] } }>(
    `/api/communities/${encodeURIComponent(handle)}/discovery`,
    payload
  );
  return data.discovery;
}

export async function joinCommunity(handle: string): Promise<Community> {
  const { data } = await apiClient.post<{ community: Community }>(`/api/communities/${encodeURIComponent(handle)}/join`);
  return data.community;
}

export async function requestCommunityJoin(handle: string): Promise<Community> {
  const { data } = await apiClient.post<{ community: Community }>(`/api/communities/${encodeURIComponent(handle)}/request`);
  return data.community;
}

export async function cancelCommunityJoinRequest(handle: string) {
  await apiClient.delete(`/api/communities/${encodeURIComponent(handle)}/request`);
}

export async function fetchCommunityMembers(handle: string): Promise<{ members: Array<{ user: CommunityUser; role: string; postingRestricted: boolean; joinedAt: string }> }> {
  const { data } = await apiClient.get<{ members: Array<{ user: CommunityUser; role: string; postingRestricted: boolean; joinedAt: string }> }>(
    `/api/communities/${encodeURIComponent(handle)}/members`
  );
  return data;
}

export async function fetchCommunityRequests(handle: string): Promise<{ requests: Array<{ id: string; requester: CommunityUser; requestedAt: string }> }> {
  const { data } = await apiClient.get<{ requests: Array<{ id: string; requester: CommunityUser; requestedAt: string }> }>(
    `/api/communities/${encodeURIComponent(handle)}/requests`
  );
  return data;
}

export async function decideCommunityRequest(handle: string, requesterId: string, decision: 'approve' | 'decline') {
  await apiClient.post(`/api/communities/${encodeURIComponent(handle)}/requests/${requesterId}/${decision}`);
}

export async function updateCommunityMemberRole(handle: string, memberUserId: string, role: 'admin' | 'moderator' | 'member') {
  await apiClient.patch(`/api/communities/${encodeURIComponent(handle)}/members/${memberUserId}/role`, { role });
}

export async function updateCommunityMemberRestriction(handle: string, memberUserId: string, restricted: boolean) {
  await apiClient.patch(`/api/communities/${encodeURIComponent(handle)}/members/${memberUserId}/restriction`, { restricted });
}

export async function removeCommunityMember(handle: string, memberUserId: string) {
  await apiClient.delete(`/api/communities/${encodeURIComponent(handle)}/members/${memberUserId}`);
}

export async function createCommunityInvite(handle: string, payload: { expiresIn: 'never' | '1d' | '7d' | '30d'; maxUses: 'unlimited' | 10 | 50 | 100 }) {
  const { data } = await apiClient.post<{ invite: unknown; token: string }>(`/api/communities/${encodeURIComponent(handle)}/invite`, payload);
  return data;
}

export async function previewCommunityInvite(token: string): Promise<Community> {
  const { data } = await apiClient.get<{ community: Community }>(`/api/communities/invite/${encodeURIComponent(token)}`);
  return data.community;
}

export async function acceptCommunityInvite(token: string): Promise<{ community: Community; pending?: boolean }> {
  const { data } = await apiClient.post<{ community: Community; pending?: boolean }>(`/api/communities/invite/${encodeURIComponent(token)}/accept`);
  return data;
}

export async function fetchCommunityPosts(handle: string): Promise<{ posts: CommunityPost[]; nextCursor: string | null }> {
  const { data } = await apiClient.get<{ posts: CommunityPost[]; nextCursor: string | null }>(`/api/communities/${encodeURIComponent(handle)}/posts`);
  return data;
}

export async function createCommunityPost(handle: string, payload: { body?: string; mediaIds?: string[] }): Promise<CommunityPost> {
  const { data } = await apiClient.post<{ post: CommunityPost }>(`/api/communities/${encodeURIComponent(handle)}/posts`, payload);
  return data.post;
}

export async function deleteCommunityPost(postId: string) {
  await apiClient.delete(`/api/community-posts/${postId}`);
}

export async function setCommunityPostReaction(postId: string, emoji: string): Promise<{ reactionCounts: Record<string, number>; myReaction: string | null }> {
  const { data } = await apiClient.post<{ reactionCounts: Record<string, number>; myReaction: string | null }>(`/api/community-posts/${postId}/reaction`, { emoji });
  return data;
}

export async function removeCommunityPostReaction(postId: string): Promise<{ reactionCounts: Record<string, number>; myReaction: null }> {
  const { data } = await apiClient.delete<{ reactionCounts: Record<string, number>; myReaction: null }>(`/api/community-posts/${postId}/reaction`);
  return data;
}

export async function fetchCommunityPostComments(postId: string): Promise<{ comments: CommunityComment[] }> {
  const { data } = await apiClient.get<{ comments: CommunityComment[] }>(`/api/community-posts/${postId}/comments`);
  return data;
}

export async function createCommunityPostComment(postId: string, body: string): Promise<{ comment: CommunityComment }> {
  const { data } = await apiClient.post<{ comment: CommunityComment }>(`/api/community-posts/${postId}/comments`, { body });
  return data;
}

export async function deleteCommunityPostComment(postId: string, commentId: string) {
  await apiClient.delete(`/api/community-posts/${postId}/comments/${commentId}`);
}

export async function createReport(payload: {
  targetType: 'user' | 'message' | 'group' | 'post' | 'post_comment';
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

export interface DiscoveryTopic {
  id: string;
  label: string;
}

export interface DiscoveryCreator {
  name: string;
  handle: string | null;
  displayHandle: string | null;
  avatarUrl: string | null;
  topics: DiscoveryTopic[];
  following: boolean;
  candidateToken: string;
}

export interface DiscoveryPost {
  id: string;
  author: ProfileListItem & { id: string; topics: DiscoveryTopic[] };
  body: string;
  media: Array<{ type: 'image'; url: string }>;
  sourceAttribution?: { label: string; creatorName: string | null };
  topics: DiscoveryTopic[];
  commentCount: number;
  reactionCounts: Record<string, number>;
  myReaction: string | null;
  createdAt: string;
  candidateToken: string;
}

export interface ForYouExplanation {
  code: string;
  text: string;
  topicId: string | null;
  topicLabel: string | null;
  creatorHandle: string | null;
}

export interface ForYouPost extends DiscoveryPost {
  explanation: ForYouExplanation;
}

export interface DiscoveryCommunity {
  name: string;
  handle: string;
  description: string;
  avatarUrl: string | null;
  topics: DiscoveryTopic[];
  memberCount: number;
  membership: null | { role: string; joinedAt: string };
  candidateToken: string;
}

export interface DiscoveryPreferences {
  personalizedDiscoveryEnabled: boolean;
  followedTopics: DiscoveryTopic[];
  mutedTopics: DiscoveryTopic[];
  mutedCreatorCount: number;
  mutedCommunityCount: number;
  hiddenPostCount: number;
}

export async function fetchDiscoveryTopics(): Promise<DiscoveryTopic[]> {
  const { data } = await apiClient.get<{ topics: DiscoveryTopic[] }>('/api/discovery/topics');
  return data.topics;
}

export async function fetchDiscoveryPreferences(): Promise<DiscoveryPreferences> {
  const { data } = await apiClient.get<{ preferences: DiscoveryPreferences }>('/api/discovery/preferences');
  return data.preferences;
}

export async function updateDiscoveryPreferences(payload: { personalizedDiscoveryEnabled: boolean }) {
  const { data } = await apiClient.patch('/api/discovery/preferences', payload);
  return data;
}

export async function updateCreatorDiscovery(payload: {
  creatorDiscoveryEnabled: boolean;
  creatorTopicIds: string[];
  showPostsInDiscover?: boolean;
  showReelsInDiscover?: boolean;
  suggestMeToOthers?: boolean;
  usernameFindability?: 'everyone' | 'followers' | 'contacts' | 'no_one';
  hideBlockedUsers?: boolean;
}) {
  const { data } = await apiClient.patch('/api/profiles/me/discovery', payload);
  return data.discovery;
}

export async function fetchDiscoveryCreators(topic?: string, cursor?: string | null) {
  const { data } = await apiClient.get<{ creators: DiscoveryCreator[]; nextCursor: string | null }>('/api/discovery/creators', {
    params: { topic: topic || undefined, cursor: cursor || undefined },
  });
  return data;
}

export async function fetchDiscoveryPosts(topic?: string, cursor?: string | null, q?: string | null) {
  const { data } = await apiClient.get<{ posts: DiscoveryPost[]; nextCursor: string | null }>('/api/discovery/posts', {
    params: { topic: topic || undefined, cursor: cursor || undefined, q: q || undefined },
  });
  return data;
}

export async function fetchDiscoveryCommunities(topic?: string, cursor?: string | null) {
  const { data } = await apiClient.get<{ communities: DiscoveryCommunity[]; nextCursor: string | null }>('/api/discovery/communities', {
    params: { topic: topic || undefined, cursor: cursor || undefined },
  });
  return data;
}

export async function fetchForYou(cursor?: string | null) {
  const { data } = await apiClient.get<{
    posts: ForYouPost[];
    nextCursor: string | null;
    personalized: boolean;
    rankingModelVersion: string;
    message: string | null;
  }>('/api/discovery/for-you', {
    params: { cursor: cursor || undefined },
  });
  return data;
}

export async function refreshForYou() {
  const { data } = await apiClient.post<{ cursor: string; rankingModelVersion: string }>('/api/discovery/for-you/refresh');
  return data;
}

export async function fetchForYouExplanation(postId: string) {
  const { data } = await apiClient.get<{ explanation: ForYouExplanation }>(`/api/discovery/for-you/explanations/${postId}`);
  return data.explanation;
}

export async function followDiscoveryTopic(topicId: string) {
  await apiClient.post(`/api/discovery/topics/${encodeURIComponent(topicId)}/follow`);
}

export async function unfollowDiscoveryTopic(topicId: string) {
  await apiClient.delete(`/api/discovery/topics/${encodeURIComponent(topicId)}/follow`);
}

export async function muteDiscoveryTopic(topicId: string) {
  await apiClient.post(`/api/discovery/topics/${encodeURIComponent(topicId)}/mute`);
}

export async function unmuteDiscoveryTopic(topicId: string) {
  await apiClient.delete(`/api/discovery/topics/${encodeURIComponent(topicId)}/mute`);
}

export async function notInterestedDiscoveryPost(postId: string) {
  await apiClient.post(`/api/discovery/posts/${postId}/not-interested`);
}

export async function muteDiscoveryCreator(handle: string) {
  await apiClient.post(`/api/discovery/creators/${encodeURIComponent(handle)}/mute`);
}

export async function muteDiscoveryCommunity(handle: string) {
  await apiClient.post(`/api/discovery/communities/${encodeURIComponent(handle)}/mute`);
}

export async function recordDiscoveryEvent(payload: { eventType: string; candidateToken: string; dwellBucket?: string }) {
  const { data } = await apiClient.post<{ recorded: boolean }>('/api/discovery/events', payload);
  return data;
}

export async function recordForYouEvent(payload: { eventType: string; candidateToken: string; dwellBucket?: string }) {
  const { data } = await apiClient.post<{ recorded: boolean }>('/api/discovery/for-you/events', payload);
  return data;
}

export async function clearDiscoveryPersonalization() {
  const { data } = await apiClient.post<{
    success: boolean;
    deletedSignals: number;
    deletedAffinities?: number;
    deletedSessions?: number;
    deletedCandidateTokens?: number;
  }>('/api/discovery/personalization/clear');
  return data;
}

export interface ReelItem {
  id: string;
  caption: string;
  visibility: 'public' | 'followers';
  topics: string[];
  processingStatus?: string;
  publishState: 'draft' | 'published' | 'deleted';
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  author?: { name: string; handle: string | null; displayHandle: string | null; avatarUrl?: string | null } | null;
  sourceAttribution?: { label: string; creatorName: string | null };
  reelDiscoverable?: boolean;
  reelTopics?: DiscoveryTopic[];
  reactionCounts?: Record<string, number>;
  myReaction?: string | null;
  commentCount?: number;
  saved?: boolean;
  eventToken?: string;
  explanation?: { code: string; text: string; topicId?: string | null; topicLabel?: string | null; creatorHandle?: string | null };
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function initiateReelUpload(payload: { fileName: string; fileType: string; fileSize: number }) {
  const { data } = await apiClient.post<{ reelId: string; uploadUrl: string; uploadMethod: 'PUT'; status: string }>('/api/reels/upload-init', payload);
  return data;
}

export async function uploadReelSource(uploadUrl: string, file: File) {
  const { data } = await apiClient.put<{ reelId: string; status: string }>(uploadUrl, file, {
    headers: { 'Content-Type': file.type || 'video/mp4' },
  });
  return data;
}

export async function fetchReelStatus(reelId: string) {
  const { data } = await apiClient.get<{ reel: ReelItem; message: string | null }>(`/api/reels/${reelId}/status`);
  return data;
}

export interface MomentVideoStatus {
  id: string;
  processingStatus: 'upload_initiated' | 'uploaded' | 'validating' | 'processing' | 'ready' | 'rejected' | 'failed' | 'deleted';
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
}

export async function initiateMomentVideoUpload(payload: { fileName: string; fileType: string; fileSize: number }) {
  const { data } = await apiClient.post<{ videoId: string; uploadUrl: string; uploadMethod: 'PUT'; status: string }>('/api/media/moment-videos/upload-init', payload);
  return data;
}

export async function uploadMomentVideoSource(uploadUrl: string, file: File) {
  const { data } = await apiClient.put<{ videoId: string; status: string }>(uploadUrl, file, {
    headers: { 'Content-Type': file.type || 'video/mp4' },
  });
  return data;
}

export async function fetchMomentVideoStatus(videoId: string) {
  const { data } = await apiClient.get<{ video: MomentVideoStatus; message: string | null }>(`/api/media/moment-videos/${videoId}/status`);
  return data;
}

export async function createMomentVideoPlaybackSession(momentId: string) {
  const { data } = await apiClient.post<{ playback: { expiresAt: string } }>(`/api/moments/${momentId}/video/playback-session`);
  return data.playback;
}

export async function publishReel(payload: { reelId: string; caption: string; visibility?: 'public' | 'followers'; topicIds?: string[] }) {
  const { data } = await apiClient.post<{ reel: ReelItem }>('/api/reels', payload);
  return data.reel;
}

export async function fetchReel(reelId: string) {
  const { data } = await apiClient.get<{ reel: ReelItem }>(`/api/reels/${reelId}`);
  return data.reel;
}

export async function fetchReelsBrowse(params: { cursor?: string | null; topic?: string | null; q?: string | null } = {}) {
  const { data } = await apiClient.get<{ reels: ReelItem[]; nextCursor: string | null }>('/api/reels/browse', {
    params: { cursor: params.cursor || undefined, topic: params.topic || undefined, q: params.q || undefined },
  });
  return data;
}

export async function fetchReelsForYou(params: { cursor?: string | null } = {}) {
  const { data } = await apiClient.get<{ reels: ReelItem[]; nextCursor: string | null; personalized: boolean; message: string | null }>('/api/reels/for-you', {
    params: { cursor: params.cursor || undefined },
  });
  return data;
}

export async function refreshReelsForYou() {
  const { data } = await apiClient.post<{ cursor: string }>('/api/reels/for-you/refresh');
  return data;
}

export async function fetchReelsForYouExplanation(reelId: string) {
  const { data } = await apiClient.get<{ explanation: NonNullable<ReelItem['explanation']> }>(`/api/reels/for-you/explanations/${reelId}`);
  return data.explanation;
}

export async function updateReelDiscovery(reelId: string, payload: { reelDiscoverable: boolean; reelTopicIds: string[] }) {
  const { data } = await apiClient.patch<{ reel: ReelItem }>(`/api/reels/${reelId}/discovery`, payload);
  return data.reel;
}

export async function updateReel(reelId: string, payload: { caption: string }) {
  const { data } = await apiClient.patch<{ reel: ReelItem }>(`/api/reels/${reelId}`, payload);
  return data.reel;
}

export async function deleteReel(reelId: string) {
  const { data } = await apiClient.delete<{ success: boolean }>(`/api/reels/${reelId}`);
  return data;
}

export async function fetchProfileReels(handle: string) {
  const { data } = await apiClient.get<{ reels: ReelItem[]; nextCursor: string | null; locked: boolean }>(`/api/profiles/${encodeURIComponent(handle)}/reels`);
  return data;
}

export async function createReelPlaybackSession(reelId: string) {
  const { data } = await apiClient.post<{ playback: { manifestUrl: string; fallbackUrl: string; posterUrl: string; expiresAt: string } }>(`/api/reels/${reelId}/playback-session`);
  return data.playback;
}

export function reelPosterUrl(reelId: string) {
  return `/api/reels/${reelId}/poster`;
}

export async function createReelEventToken(reelId: string) {
  const { data } = await apiClient.post<{ eventToken: string; expiresInSeconds: number }>(`/api/reels/${reelId}/event-token`);
  return data;
}

export async function recordReelEvent(reelId: string, payload: {
  eventType: 'reel_open' | 'reel_watch_bucket' | 'reel_completion_bucket' | 'reel_quick_skip';
  eventToken: string;
  watchBucket?: string;
  completionBucket?: string;
  skipReason?: 'user_next_reel';
}) {
  const { data } = await apiClient.post<{ recorded: boolean }>(`/api/reels/${reelId}/events`, payload);
  return data;
}

export async function setReelReaction(reelId: string, emoji: string) {
  const { data } = await apiClient.post<{ myReaction: string | null; reactionCounts: Record<string, number> }>(`/api/reels/${reelId}/reaction`, { emoji });
  return data;
}

export async function removeReelReaction(reelId: string) {
  const { data } = await apiClient.delete<{ myReaction: null; reactionCounts: Record<string, number> }>(`/api/reels/${reelId}/reaction`);
  return data;
}

export async function fetchReelComments(reelId: string, cursor?: string | null) {
  const { data } = await apiClient.get<{ comments: Array<{ id: string; author: any; body: string; createdAt: string }>; nextCursor: string | null }>(`/api/reels/${reelId}/comments`, {
    params: { cursor: cursor || undefined },
  });
  return data;
}

export async function createReelComment(reelId: string, body: string) {
  const { data } = await apiClient.post<{ comment: { id: string; author: any; body: string; createdAt: string }; commentCount: number }>(`/api/reels/${reelId}/comments`, { body });
  return data;
}

export async function deleteReelComment(reelId: string, commentId: string) {
  const { data } = await apiClient.delete<{ success: boolean; commentCount: number }>(`/api/reels/${reelId}/comments/${commentId}`);
  return data;
}

export async function saveReel(reelId: string) {
  const { data } = await apiClient.post<{ saved: boolean }>(`/api/reels/${reelId}/save`);
  return data;
}

export async function unsaveReel(reelId: string) {
  const { data } = await apiClient.delete<{ saved: boolean }>(`/api/reels/${reelId}/save`);
  return data;
}

export async function fetchSavedReels(cursor?: string | null) {
  const { data } = await apiClient.get<{ reels: ReelItem[]; nextCursor: string | null }>('/api/reels/saved', {
    params: { cursor: cursor || undefined },
  });
  return data;
}

export async function notInterestedReel(reelId: string) {
  await apiClient.post(`/api/reels/${reelId}/not-interested`);
}

export async function muteReelCreator(reelId: string) {
  await apiClient.post(`/api/reels/${reelId}/mute-creator`);
}

export async function reportReelComment(reelId: string, commentId: string, payload: { reason: string; details?: string }) {
  const { data } = await apiClient.post(`/api/reels/${reelId}/comments/${commentId}/report`, payload);
  return data;
}

export async function reportReel(reelId: string, payload: { reason: string; details?: string }) {
  const { data } = await apiClient.post(`/api/reels/${reelId}/report`, payload);
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
  browser?: string;
  operatingSystem?: string;
  deviceType?: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  userAgent?: string;
  createdAt: string;
  lastActiveAt?: string;
  expiresAt: string;
  current: boolean;
  status?: 'active' | 'expired' | 'revoked';
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
        const newAccessToken = await refreshAccessToken();

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
