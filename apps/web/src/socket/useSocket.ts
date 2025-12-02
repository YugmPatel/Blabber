import { useSocketContext } from './SocketProvider';

/**
 * Hook to access the Socket.io client instance
 *
 * @returns {Object} Socket instance and connection status
 * @returns {Socket | null} socket - The Socket.io client instance
 * @returns {boolean} isConnected - Whether the socket is currently connected
 *
 * @example
 * const { socket, isConnected } = useSocket();
 *
 * if (socket && isConnected) {
 *   socket.emit('message:send', { chatId, body, tempId });
 * }
 */
export const useSocket = () => {
  return useSocketContext();
};
