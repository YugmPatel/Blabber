import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { AuthProvider } from '@/contexts/AuthContext';
import * as apiClient from '@/api/client';

// Mock the API client
vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
  refreshAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
  getAccessToken: vi.fn(),
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const renderLoginPage = () => {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </BrowserRouter>
  );
};

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/login');
  });

  it('renders login form', async () => {
    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
  });

  it('shows link to register page', async () => {
    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByText(/Sign Up/i)).toBeInTheDocument();
    });
  });

  it('validates email field', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
    });

    const submitButton = screen.getByRole('button', { name: /^Sign In$/i });
    const passwordInput = screen.getByLabelText(/^password$/i);

    // Fill password but leave email empty
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });
  });

  it('validates email format', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const submitButton = screen.getByRole('button', { name: /^Sign In$/i });

    await user.type(emailInput, 'invalid-email');
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
    });
  });

  it('validates password field', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText(/^email$/i);
    const submitButton = screen.getByRole('button', { name: /^Sign In$/i });

    await user.type(emailInput, 'test@example.com');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
  });

  it('validates password length', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const submitButton = screen.getByRole('button', { name: /^Sign In$/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, '12345');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password must be at least 6 characters/i)).toBeInTheDocument();
    });
  });

  it('submits form with valid credentials', async () => {
    const user = userEvent.setup();
    const mockUser = {
      _id: '123',
      username: 'testuser',
      email: 'test@example.com',
      name: 'Test User',
    };

    vi.mocked(apiClient.apiClient.post)
      .mockResolvedValueOnce({
        data: {
          accessToken: 'mock-token',
          user: mockUser,
        },
      });

    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const submitButton = screen.getByRole('button', { name: /^Sign In$/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    await waitFor(() => {
      expect(apiClient.apiClient.post).toHaveBeenCalledWith('/api/auth/login', {
        email: 'test@example.com',
        password: 'password123',
      });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/chats', { replace: true });
    });
  });

  it('displays error message on login failure', async () => {
    const user = userEvent.setup();

    vi.mocked(apiClient.apiClient.post)
      .mockRejectedValueOnce({
        response: {
          data: {
            message: 'Invalid credentials',
          },
        },
      });

    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const submitButton = screen.getByRole('button', { name: /^Sign In$/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'wrongpassword');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid credentials/i);
    });
  });

  it('disables form during submission', async () => {
    const user = userEvent.setup();

    // Mock a delayed response after the initial auth check
    vi.mocked(apiClient.apiClient.post)
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: { accessToken: 'token', user: {} } }), 200)
          )
      );

    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const submitButton = screen.getByRole('button', { name: /^Sign In$/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    // Check that button shows loading state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Signing In…$/i })).toBeInTheDocument();
    });

    // Check that inputs are disabled
    expect(emailInput).toBeDisabled();
    expect(passwordInput).toBeDisabled();
    expect(submitButton).toBeDisabled();
  });
});
