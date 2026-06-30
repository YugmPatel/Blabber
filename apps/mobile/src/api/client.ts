import { API_BASE_URL } from '@/config/api-base';
import { getRefreshCredential, setRefreshCredential, clearRefreshCredential } from '@/storage/secure-store';
import { clearPrivateMemoryCache } from '@/storage/memory-cache';
import { clearActiveUploadReferences } from '@/uploads/upload-session';

export type MobileUser = {
  _id: string;
  username: string;
  email: string;
  name: string;
  avatarUrl?: string;
  emailVerified: boolean;
};

export type ApiErrorCode = 'network' | 'session_expired' | 'unavailable' | 'forbidden' | 'unknown';

export class MobileApiError extends Error {
  code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

let accessToken: string | null = null;
let refreshFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export function getAccessTokenForSocket() {
  return accessToken;
}

export function setMemoryAccessToken(token: string | null) {
  accessToken = token;
  listeners.forEach((listener) => listener());
}

export function onAuthTokenChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return text ? JSON.parse(text) as T : ({} as T);
}

function safeMessage(status: number) {
  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status === 403) return 'You do not have access to this content.';
  if (status === 404) return 'This content is unavailable.';
  return 'Something went wrong. Try again.';
}

async function refreshOnce() {
  if (refreshFlight) return refreshFlight;
  refreshFlight = (async () => {
    const refreshToken = await getRefreshCredential();
    if (!refreshToken) return false;
    const response = await fetch(`${API_BASE_URL}/api/auth/mobile/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      await clearLocalSession();
      return false;
    }
    const data = await readJson<{ accessToken: string; refreshToken: string }>(response);
    setMemoryAccessToken(data.accessToken);
    await setRefreshCredential(data.refreshToken);
    return true;
  })().finally(() => {
    refreshFlight = null;
  });
  return refreshFlight;
}

export async function clearLocalSession() {
  setMemoryAccessToken(null);
  await clearRefreshCredential();
  clearActiveUploadReferences();
  clearPrivateMemoryCache();
}

export async function apiRequest<T>(path: string, init: RequestInit & { retryOnUnauthorized?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new MobileApiError('network', 'Check your connection and try again.');
  }

  if (response.status === 401 && init.retryOnUnauthorized !== false) {
    const refreshed = await refreshOnce();
    if (refreshed) return apiRequest<T>(path, { ...init, retryOnUnauthorized: false });
    throw new MobileApiError('session_expired', 'Your session has expired. Sign in again.');
  }

  if (!response.ok) {
    const code: ApiErrorCode = response.status === 404 ? 'unavailable' : response.status === 403 ? 'forbidden' : 'unknown';
    throw new MobileApiError(code, safeMessage(response.status));
  }

  return readJson<T>(response);
}

export function authenticatedMediaHeaders() {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
}

export function resolveApiUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE_URL}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

export async function uploadBinaryToUrl(url: string, body: Blob, contentType: string, signal?: AbortSignal) {
  const headers = new Headers({ 'content-type': contentType });
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(url), { method: 'PUT', headers, body, signal });
  } catch {
    throw new MobileApiError('network', 'Check your connection and try again.');
  }
  if (!response.ok) throw new MobileApiError('unknown', safeMessage(response.status));
  return readJson<{ mediaId: string; status: 'approved' | 'pending' | 'rejected'; media: unknown }>(response);
}

export async function mobileLogin(email: string, password: string) {
  const response = await apiRequest<{ user: MobileUser; accessToken: string; refreshToken: string }>('/api/auth/mobile/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    retryOnUnauthorized: false,
  });
  setMemoryAccessToken(response.accessToken);
  await setRefreshCredential(response.refreshToken);
  return response.user;
}

export async function mobileRegister(input: { username: string; email: string; password: string; name: string }) {
  const response = await apiRequest<{ user: MobileUser; accessToken: string; refreshToken: string }>('/api/auth/mobile/register', {
    method: 'POST',
    body: JSON.stringify(input),
    retryOnUnauthorized: false,
  });
  setMemoryAccessToken(response.accessToken);
  await setRefreshCredential(response.refreshToken);
  return response.user;
}

export async function restoreMobileSession() {
  const refreshed = await refreshOnce();
  if (!refreshed) return null;
  const response = await apiRequest<{ user: MobileUser }>('/api/auth/mobile/session');
  return response.user;
}

export async function mobileLogout() {
  const refreshToken = await getRefreshCredential();
  if (refreshToken) {
    await apiRequest('/api/auth/mobile/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      retryOnUnauthorized: false,
    }).catch(() => undefined);
  }
  await clearLocalSession();
}
