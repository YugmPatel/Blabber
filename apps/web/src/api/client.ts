import axios, { AxiosError } from 'axios';
import type {
  ChatActionExtractionResult,
  ChatActionItem,
  ChatActionStatus,
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
} from '@repo/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
  patch: { status: ChatActionStatus }
): Promise<{ action: ChatActionItem }> {
  const { data } = await apiClient.patch<{ action: ChatActionItem }>(
    `/api/intelligence/actions/${actionId}`,
    patch
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

    // If 401 and we haven't retried yet, attempt token refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
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
