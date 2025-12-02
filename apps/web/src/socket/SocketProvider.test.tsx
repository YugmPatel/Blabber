import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SocketProvider, useSocketContext } from './SocketProvider';
import { AuthProvider } from '@/contexts/AuthContext';
import { useAppStore } from '@/store/app-store';
import { io } from 'socket.io-client';

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

// Mock AuthContext
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useAuth: vi.fn(),
}));

// Mock API client
vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
  setAccessToken: vi.fn(),
  getAccessToken: vi.fn(),
}));

import { useAuth } from '@/contexts/AuthContext';

describe('SocketProvider', () => {
  let mockSocket: any;
  let queryClient: QueryClient;

  beforeEach(() => {
    // Create a fresh QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Reset store
    useAppStore.setState({
      socket: null,
      isConnected: false,
      setSocket: vi.fn(),
      setIsConnected: vi.fn(),
    });

    // Create mock socket
    mockSocket = {
      id: 'test-socket-id',
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      close: vi.fn(),
      connected: false,
    };

    // Mock io to return our mock socket
    vi.mocked(io).mockReturnValue(mockSocket as any);
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  const renderWithProviders = (children: React.ReactNode) => {
    return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  };

  it('should not create socket when not authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    renderWithProviders(
      <SocketProvider>
        <div>Test</div>
      </SocketProvider>
    );

    expect(io).not.toHaveBeenCalled();
  });

  it('should create socket when authenticated', async () => {
    const mockAccessToken = 'test-access-token';

    vi.mocked(useAuth).mockReturnValue({
      user: { _id: '1', username: 'test', email: 'test@test.com', name: 'Test' },
      accessToken: mockAccessToken,
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    renderWithProviders(
      <SocketProvider>
        <div>Test</div>
      </SocketProvider>
    );

    await waitFor(() => {
      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          auth: {
            token: mockAccessToken,
          },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: 5,
        })
      );
    });
  });

  it('should register connection event handlers', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { _id: '1', username: 'test', email: 'test@test.com', name: 'Test' },
      accessToken: 'test-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    renderWithProviders(
      <SocketProvider>
        <div>Test</div>
      </SocketProvider>
    );

    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });
  });

  it('should emit auth:hello on connection', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { _id: '1', username: 'test', email: 'test@test.com', name: 'Test' },
      accessToken: 'test-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    renderWithProviders(
      <SocketProvider>
        <div>Test</div>
      </SocketProvider>
    );

    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    // Simulate connection
    const connectHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'connect')?.[1];

    if (connectHandler) {
      connectHandler();
      expect(mockSocket.emit).toHaveBeenCalledWith('auth:hello');
    }
  });

  it('should update connection status on connect', async () => {
    const setIsConnected = vi.fn();
    useAppStore.setState({ setIsConnected });

    vi.mocked(useAuth).mockReturnValue({
      user: { _id: '1', username: 'test', email: 'test@test.com', name: 'Test' },
      accessToken: 'test-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    renderWithProviders(
      <SocketProvider>
        <div>Test</div>
      </SocketProvider>
    );

    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    // Simulate connection
    const connectHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'connect')?.[1];

    if (connectHandler) {
      connectHandler();
      expect(setIsConnected).toHaveBeenCalledWith(true);
    }
  });

  it('should update connection status on disconnect', async () => {
    const setIsConnected = vi.fn();
    useAppStore.setState({ setIsConnected });

    vi.mocked(useAuth).mockReturnValue({
      user: { _id: '1', username: 'test', email: 'test@test.com', name: 'Test' },
      accessToken: 'test-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    renderWithProviders(
      <SocketProvider>
        <div>Test</div>
      </SocketProvider>
    );

    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    // Simulate disconnection
    const disconnectHandler = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'disconnect'
    )?.[1];

    if (disconnectHandler) {
      disconnectHandler('transport close');
      expect(setIsConnected).toHaveBeenCalledWith(false);
    }
  });

  it('should close socket when authentication is lost', async () => {
    const { rerender } = renderWithProviders(
      <SocketProvider>
        <div>Test</div>
      </SocketProvider>
    );

    // First render with authentication
    vi.mocked(useAuth).mockReturnValue({
      user: { _id: '1', username: 'test', email: 'test@test.com', name: 'Test' },
      accessToken: 'test-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <SocketProvider>
          <div>Test</div>
        </SocketProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(io).toHaveBeenCalled();
    });

    // Store the socket in the store
    useAppStore.setState({ socket: mockSocket });

    // Lose authentication
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <SocketProvider>
          <div>Test</div>
        </SocketProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(mockSocket.close).toHaveBeenCalled();
    });
  });

  it('should provide socket context to children', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { _id: '1', username: 'test', email: 'test@test.com', name: 'Test' },
      accessToken: 'test-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    const TestComponent = () => {
      const { socket, isConnected } = useSocketContext();
      return (
        <div>
          <div data-testid="socket-status">{socket ? 'connected' : 'disconnected'}</div>
          <div data-testid="is-connected">{isConnected ? 'true' : 'false'}</div>
        </div>
      );
    };

    renderWithProviders(
      <SocketProvider>
        <TestComponent />
      </SocketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('socket-status')).toHaveTextContent('connected');
    });
  });

  it('should throw error when useSocketContext is used outside provider', () => {
    const TestComponent = () => {
      useSocketContext();
      return <div>Test</div>;
    };

    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<TestComponent />)).toThrow(
      'useSocketContext must be used within a SocketProvider'
    );

    consoleSpy.mockRestore();
  });

  it('should use VITE_SOCKET_URL from environment', async () => {
    const customUrl = 'http://custom-socket-url:4000';
    vi.stubEnv('VITE_SOCKET_URL', customUrl);

    vi.mocked(useAuth).mockReturnValue({
      user: { _id: '1', username: 'test', email: 'test@test.com', name: 'Test' },
      accessToken: 'test-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    renderWithProviders(
      <SocketProvider>
        <div>Test</div>
      </SocketProvider>
    );

    await waitFor(() => {
      expect(io).toHaveBeenCalledWith(customUrl, expect.any(Object));
    });

    vi.unstubAllEnvs();
  });
});
