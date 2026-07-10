import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import BlabberMark from '@/components/brand/BlabberMark';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="text-center">
          <BlabberMark size={48} variant="icon" className="mx-auto" />
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};
