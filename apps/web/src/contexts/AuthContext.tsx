import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiClient, setAccessToken, getAccessToken } from '@/api/client';

interface User {
  _id: string;
  username: string;
  email: string;
  name: string;
  avatar?: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      // Check if we're already on login/register page
      const isAuthPage =
        window.location.pathname === '/login' || window.location.pathname === '/register';

      if (isAuthPage) {
        // Skip refresh on auth pages
        setIsLoading(false);
        return;
      }

      try {
        // Try to refresh token on app load
        const response = await apiClient.post('/api/auth/refresh');
        const { accessToken: newAccessToken } = response.data;

        setAccessToken(newAccessToken);
        setAccessTokenState(newAccessToken);

        // Fetch current user
        const userResponse = await apiClient.get('/api/auth/me');
        setUser(userResponse.data.user);
      } catch (error) {
        // No valid session, user needs to login
        setAccessToken(null);
        setAccessTokenState(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await apiClient.post('/api/auth/login', {
      email,
      password,
    });

    const { accessToken: newAccessToken, user: userData } = response.data;
    setAccessToken(newAccessToken);
    setAccessTokenState(newAccessToken);
    setUser(userData);
  };

  const register = async (username: string, email: string, password: string, name: string) => {
    const response = await apiClient.post('/api/auth/register', {
      username,
      email,
      password,
      name,
    });

    const { accessToken: newAccessToken, user: userData } = response.data;
    setAccessToken(newAccessToken);
    setAccessTokenState(newAccessToken);
    setUser(userData);
  };

  const logout = async () => {
    try {
      await apiClient.post('/api/auth/logout');
    } catch (error) {
      // Logout anyway even if request fails
      console.error('Logout error:', error);
    } finally {
      setAccessToken(null);
      setAccessTokenState(null);
      setUser(null);
    }
  };

  const refreshUser = async () => {
    const response = await apiClient.get('/api/auth/me');
    setUser(response.data.user);
  };

  const value: AuthContextType = {
    user,
    accessToken,
    isLoading,
    isAuthenticated: !!user && !!accessToken,
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
