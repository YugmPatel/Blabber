import { apiRequest } from './client';

export const listFeed = (cursor?: string | null) =>
  apiRequest<{ posts: any[]; nextCursor: string | null }>(`/api/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);

export const presignImageMedia = (input: { fileName: string; contentType: string; fileSize?: number }) =>
  apiRequest<{ uploadUrl: string; mediaId: string }>('/api/media/presign', {
    method: 'POST',
    body: JSON.stringify({ fileName: input.fileName, fileType: input.contentType, fileSize: input.fileSize || 1 }),
  });

export const createPost = (input: { body?: string; visibility: 'public' | 'followers'; mediaIds?: string[] }) =>
  apiRequest<{ post: any }>('/api/posts', { method: 'POST', body: JSON.stringify(input) });
export const setPostReaction = (postId: string, emoji = 'like') =>
  apiRequest<{ post: any }>(`/api/posts/${postId}/reaction`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const removePostReaction = (postId: string) => apiRequest(`/api/posts/${postId}/reaction`, { method: 'DELETE' });
export const listPostComments = (postId: string) => apiRequest<{ comments: any[] }>(`/api/posts/${postId}/comments`);
export const createPostComment = (postId: string, body: string) =>
  apiRequest<{ comment: any }>(`/api/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
export const reportPost = (postId: string, reason = 'mobile report') =>
  apiRequest(`/api/posts/${postId}/report`, { method: 'POST', body: JSON.stringify({ reason }) });

export const listForYou = () => apiRequest<{ posts: any[] }>('/api/discovery/for-you');
export const listDiscoverPosts = () => apiRequest<{ posts: any[] }>('/api/discovery/posts');
export const listDiscoverCommunities = () => apiRequest<{ communities: any[] }>('/api/discovery/communities');
export const listChats = () => apiRequest<{ chats: any[] }>('/api/chats');
export const listMessages = (chatId: string, cursor?: string | null) =>
  apiRequest<{ messages: any[]; nextCursor?: string | null }>(`/api/messages/${chatId}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const sendTextMessage = (chatId: string, body: string) =>
  apiRequest<{ message: any }>(`/api/messages/${chatId}`, { method: 'POST', body: JSON.stringify({ body, type: 'text' }) });
export const getMyProfile = () => apiRequest<{ profile: any }>('/api/profiles/me');
export const updateMyProfile = (input: { name?: string; bio?: string; website?: string; visibility?: 'private' | 'public'; avatarMediaId?: string }) =>
  apiRequest<{ profile: any }>('/api/profiles/me', { method: 'PATCH', body: JSON.stringify(input) });
export const getProfile = (handle: string) => apiRequest<{ profile: any }>(`/api/profiles/${encodeURIComponent(handle)}`);
export const followProfile = (handle: string) => apiRequest<{ profile: any }>(`/api/profiles/${encodeURIComponent(handle)}/follow`, { method: 'POST' });
export const unfollowProfile = (handle: string) => apiRequest<{ profile: any }>(`/api/profiles/${encodeURIComponent(handle)}/follow`, { method: 'DELETE' });
export const cancelFollowRequest = (handle: string) => apiRequest<{ profile: any }>(`/api/profiles/${encodeURIComponent(handle)}/cancel`, { method: 'POST' });
export const listIncomingFollowRequests = () => apiRequest<{ requests: any[] }>('/api/profiles/requests/incoming');
export const approveFollowRequest = (handle: string) => apiRequest(`/api/profiles/requests/${encodeURIComponent(handle)}/approve`, { method: 'POST' });
export const declineFollowRequest = (handle: string) => apiRequest(`/api/profiles/requests/${encodeURIComponent(handle)}/decline`, { method: 'POST' });
export const listFollowers = (handle: string) => apiRequest<{ followers: any[] }>(`/api/profiles/${encodeURIComponent(handle)}/followers`);
export const listFollowing = (handle: string) => apiRequest<{ following: any[] }>(`/api/profiles/${encodeURIComponent(handle)}/following`);
export const removeFollower = (handle: string) => apiRequest(`/api/profiles/${encodeURIComponent(handle)}/follower`, { method: 'DELETE' });
export const listProfilePosts = (handle: string) => apiRequest<{ posts: any[] }>(`/api/profiles/${encodeURIComponent(handle)}/posts`);
export const listProfileReels = (handle: string) => apiRequest<{ reels: any[] }>(`/api/profiles/${encodeURIComponent(handle)}/reels`);
export const getCommunity = (handle: string) => apiRequest<{ community: any }>(`/api/communities/${encodeURIComponent(handle)}`);
export const listCommunityPosts = (handle: string) => apiRequest<{ posts: any[] }>(`/api/communities/${encodeURIComponent(handle)}/posts`);
export const joinCommunity = (handle: string) => apiRequest<{ community: any }>(`/api/communities/${encodeURIComponent(handle)}/join`, { method: 'POST' });
export const requestCommunityJoin = (handle: string) => apiRequest<{ community: any }>(`/api/communities/${encodeURIComponent(handle)}/request`, { method: 'POST' });
export const cancelCommunityJoinRequest = (handle: string) => apiRequest<{ community: any }>(`/api/communities/${encodeURIComponent(handle)}/request`, { method: 'DELETE' });
export const createCommunityPost = (handle: string, body: string) =>
  apiRequest<{ post: any }>(`/api/communities/${encodeURIComponent(handle)}/posts`, { method: 'POST', body: JSON.stringify({ body }) });
export const setCommunityPostReaction = (postId: string, emoji = 'like') =>
  apiRequest(`/api/community-posts/${postId}/reaction`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const removeCommunityPostReaction = (postId: string) => apiRequest(`/api/community-posts/${postId}/reaction`, { method: 'DELETE' });
export const listCommunityPostComments = (postId: string) => apiRequest<{ comments: any[] }>(`/api/community-posts/${postId}/comments`);
export const createCommunityPostComment = (postId: string, body: string) =>
  apiRequest<{ comment: any }>(`/api/community-posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
export const reportCommunityPost = (postId: string, reason = 'mobile report') =>
  apiRequest(`/api/community-posts/${postId}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
export const listMoments = () => apiRequest<{ myMoments: any[]; recentMoments: any[]; viewedMoments: any[] }>('/api/moments');
export const createMoment = (input: { textBody?: string; caption?: string; mediaId?: string; audienceType: 'contacts' | 'close_friends' }) =>
  apiRequest<{ moment: any }>('/api/moments', {
    method: 'POST',
    body: JSON.stringify({
      type: input.mediaId ? 'image' : 'text',
      textBody: input.textBody,
      caption: input.caption,
      mediaId: input.mediaId,
      audienceType: input.audienceType,
      selectedUserIds: [],
    }),
  });
export const markMomentViewed = (momentId: string) => apiRequest(`/api/moments/${momentId}/view`, { method: 'POST' });
export const setMomentReaction = (momentId: string, emoji = 'heart') =>
  apiRequest(`/api/moments/${momentId}/reaction`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const removeMomentReaction = (momentId: string) => apiRequest(`/api/moments/${momentId}/reaction`, { method: 'DELETE' });
export const replyToMoment = (momentId: string, body: string) =>
  apiRequest(`/api/moments/${momentId}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
export const archiveMoment = (momentId: string) => apiRequest(`/api/moments/${momentId}/archive`, { method: 'POST' });
export const listMomentContacts = () => apiRequest<{ contacts: any[] }>('/api/moments/contacts');
export const getReel = (reelId: string) => apiRequest<{ reel: any }>(`/api/reels/${reelId}`);
export const initiateReelUpload = (input: { fileName: string; fileType: string; fileSize: number }) =>
  apiRequest<{ reelId: string; uploadUrl: string; expiresAt: string; status: 'upload_initiated' }>('/api/reels/upload-init', {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const getReelStatus = (reelId: string) =>
  apiRequest<{ reel: any; message?: string | null }>(`/api/reels/${reelId}/status`);
export const publishReel = (input: { reelId: string; caption?: string; visibility: 'public' | 'followers'; topicIds?: string[] }) =>
  apiRequest<{ reel: any }>('/api/reels', {
    method: 'POST',
    body: JSON.stringify({ reelId: input.reelId, caption: input.caption || '', visibility: input.visibility, topicIds: input.topicIds || [] }),
  });
export const updateReelDiscovery = (reelId: string, input: { reelDiscoverable: boolean; reelTopicIds: string[] }) =>
  apiRequest<{ reel: any }>(`/api/reels/${reelId}/discovery`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteReel = (reelId: string) => apiRequest<{ success: boolean }>(`/api/reels/${reelId}`, { method: 'DELETE' });
export const listReelsBrowse = (cursor?: string | null) =>
  apiRequest<{ reels: any[]; nextCursor: string | null }>(`/api/reels/browse${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const listReelsForYou = (cursor?: string | null) =>
  apiRequest<{ reels: any[]; nextCursor: string | null; personalized: boolean; message: string | null }>(`/api/reels/for-you${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const refreshReelsForYou = () =>
  apiRequest<{ cursor: string }>('/api/reels/for-you/refresh', { method: 'POST' });
export const getReelsForYouExplanation = (reelId: string) =>
  apiRequest<{ explanation: { code: string; text: string; topicId?: string | null; topicLabel?: string | null; creatorHandle?: string | null } }>(`/api/reels/for-you/explanations/${reelId}`);
export const createReelPlaybackSession = (reelId: string) =>
  apiRequest<{ playback: { manifestUrl: string; fallbackUrl: string; posterUrl: string; expiresAt: string } }>(`/api/reels/${reelId}/playback-session`, { method: 'POST' });
export const createReelEventToken = (reelId: string) =>
  apiRequest<{ eventToken: string; expiresInSeconds: number }>(`/api/reels/${reelId}/event-token`, { method: 'POST' });
export const recordReelEvent = (reelId: string, payload: {
  eventType: 'reel_open' | 'reel_watch_bucket' | 'reel_completion_bucket' | 'reel_quick_skip';
  eventToken: string;
  watchBucket?: string;
  completionBucket?: string;
  skipReason?: 'user_next_reel';
}) => apiRequest<{ recorded: boolean }>(`/api/reels/${reelId}/events`, { method: 'POST', body: JSON.stringify(payload) });
export const setReelReaction = (reelId: string, emoji: string) =>
  apiRequest<{ myReaction: string; reactionCounts: Record<string, number> }>(`/api/reels/${reelId}/reaction`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const removeReelReaction = (reelId: string) =>
  apiRequest<{ myReaction: null; reactionCounts: Record<string, number> }>(`/api/reels/${reelId}/reaction`, { method: 'DELETE' });
export const listReelComments = (reelId: string, cursor?: string | null) =>
  apiRequest<{ comments: any[]; nextCursor: string | null }>(`/api/reels/${reelId}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const createReelComment = (reelId: string, body: string) =>
  apiRequest<{ comment: any; commentCount: number }>(`/api/reels/${reelId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
export const saveReel = (reelId: string) => apiRequest<{ saved: true }>(`/api/reels/${reelId}/save`, { method: 'POST' });
export const unsaveReel = (reelId: string) => apiRequest<{ saved: false }>(`/api/reels/${reelId}/save`, { method: 'DELETE' });
export const notInterestedReel = (reelId: string) => apiRequest(`/api/reels/${reelId}/not-interested`, { method: 'POST' });
export const muteReelCreator = (reelId: string) => apiRequest(`/api/reels/${reelId}/mute-creator`, { method: 'POST' });
export const reportReel = (reelId: string) => apiRequest(`/api/reels/${reelId}/report`, { method: 'POST', body: JSON.stringify({ reason: 'Inappropriate Reel' }) });

export const listNotifications = () => apiRequest<{ notifications?: any[]; items?: any[] }>('/api/notifications');
export const markNotificationRead = (id: string) => apiRequest(`/api/notifications/${id}/read`, { method: 'POST' });
export const getMobilePushStatus = (installationId?: string) =>
  apiRequest<{ device: { state: 'not_enabled' | 'verifying_device' | 'enabled'; verifiedAt?: string } }>(`/api/notifications/mobile-push/status${installationId ? `?installationId=${encodeURIComponent(installationId)}` : ''}`);
export const registerMobilePushDevice = (input: { token: string; platform: 'ios' | 'android'; installationId: string; appVersion?: string }) =>
  apiRequest<{ device: { state: 'not_enabled' | 'verifying_device' | 'enabled'; verifiedAt?: string } }>('/api/notifications/mobile-push/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const verifyMobilePushDevice = (input: { installationId: string; challenge: string }) =>
  apiRequest<{ device: { state: 'not_enabled' | 'verifying_device' | 'enabled'; verifiedAt?: string } }>('/api/notifications/mobile-push/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const deregisterMobilePushDevice = (installationId: string) =>
  apiRequest('/api/notifications/mobile-push/deregister', { method: 'POST', body: JSON.stringify({ installationId }) });
export const getNotificationPreferences = (userId: string) => apiRequest<{ preferences: any }>(`/api/notifications/preferences/${userId}`);
export const updateNotificationPreferences = (userId: string, input: Record<string, boolean>) =>
  apiRequest<{ preferences: any }>(`/api/notifications/preferences/${userId}`, { method: 'PATCH', body: JSON.stringify(input) });
export const getDiscoveryPreferences = () => apiRequest<{ preferences: any }>('/api/discovery/preferences');
export const updateDiscoveryPreferences = (input: Record<string, unknown>) =>
  apiRequest<{ preferences: any }>('/api/discovery/preferences', { method: 'PATCH', body: JSON.stringify(input) });
