import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { mobileLogin, mobileLogout, mobileRegister, restoreMobileSession, type MobileUser } from '@/api/client';

type AuthState = {
  status: 'restoring' | 'authenticated' | 'anonymous';
  user: MobileUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { username: string; email: string; password: string; name: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('restoring');
  const [user, setUser] = useState<MobileUser | null>(null);

  useEffect(() => {
    let mounted = true;
    restoreMobileSession()
      .then((restored) => {
        if (!mounted) return;
        setUser(restored);
        setStatus(restored ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (!mounted) return;
        setUser(null);
        setStatus('anonymous');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<AuthState>(() => ({
    status,
    user,
    signIn: async (email, password) => {
      const nextUser = await mobileLogin(email, password);
      setUser(nextUser);
      setStatus('authenticated');
    },
    signUp: async (input) => {
      const nextUser = await mobileRegister(input);
      setUser(nextUser);
      setStatus('authenticated');
    },
    signOut: async () => {
      await mobileLogout();
      setUser(null);
      setStatus('anonymous');
    },
  }), [status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
