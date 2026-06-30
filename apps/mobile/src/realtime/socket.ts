import { AppState, type AppStateStatus } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/config/api-base';
import { getAccessTokenForSocket, onAuthTokenChange } from '@/api/client';

let socket: Socket | null = null;
let foreground = true;

export function getSocket() {
  return socket;
}

export function connectSocket() {
  const token = getAccessTokenForSocket();
  if (!token || socket) return socket;
  socket = io(API_BASE_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
  });
  return socket;
}

export function disconnectSocket() {
  socket?.close();
  socket = null;
}

export function setupSocketLifecycle() {
  const tokenUnsubscribe = onAuthTokenChange(() => {
    disconnectSocket();
    if (foreground) connectSocket();
  });
  const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    foreground = state === 'active';
    if (!foreground) {
      disconnectSocket();
      return;
    }
    connectSocket();
  });
  return () => {
    tokenUnsubscribe();
    appStateSub.remove();
    disconnectSocket();
  };
}
