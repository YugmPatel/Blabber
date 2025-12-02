import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore } from '@/store/app-store';
import { useSocketEvents } from '@/hooks/useSocketEvents';
import type { ClientToServerEvents, ServerToClientEvents } from '@repo/types';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SocketContextType {
  socket: TypedSocket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocketContext = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocketContext must be used within a SocketProvider');
  }
  return context;
};

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketProvider = ({ children }: SocketProviderProps) => {
  const { accessToken, isAuthenticated } = useAuth();
  const { socket, isConnected, setSocket, setIsConnected } = useAppStore();

  // Subscribe to socket events (with null check)
  useSocketEvents(socket && isConnected ? (socket as TypedSocket) : null);

  useEffect(() => {
    // Only connect if authenticated and not already connected
    if (!isAuthenticated || !accessToken) {
      // Disconnect if we lose authentication
      if (socket) {
        socket.close();
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    // Don't create a new socket if one already exists
    if (socket) {
      return;
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

    // Create new socket connection
    const newSocket: TypedSocket = io(socketUrl, {
      auth: {
        token: accessToken,
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling'],
    });

    // Connection event handlers
    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setIsConnected(true);

      // Send hello message after connection
      newSocket.emit('auth:hello');
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setIsConnected(false);
    });

    // Store socket in Zustand
    setSocket(newSocket as any);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (newSocket) {
        newSocket.close();
        setSocket(null);
        setIsConnected(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, accessToken]);

  const value: SocketContextType = {
    socket: socket as TypedSocket | null,
    isConnected,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};
