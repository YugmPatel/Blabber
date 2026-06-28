import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: null,
    accessToken: null,
    isLoading: false,
    isAuthenticated: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

vi.mock('./socket', () => ({
  SocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    // Basic smoke test - just ensure the app renders
    expect(document.body).toBeTruthy();
  });
});
