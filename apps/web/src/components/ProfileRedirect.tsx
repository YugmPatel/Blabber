import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { fetchMyProfile } from '@/api/client';

/**
 * /profile — resolves the viewer's own public profile. Lands on /p/<handle>
 * when a handle exists; otherwise on the settings profile editor with a hint
 * to create one. Rendered inside ProtectedRoute, so auth is already enforced.
 */
export default function ProfileRedirect() {
  const navigate = useNavigate();
  const { data, isError } = useQuery({
    queryKey: ['profiles', 'me'],
    queryFn: fetchMyProfile,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (isError) {
      navigate('/settings?s=profile', { replace: true });
      return;
    }
    if (!data) return;
    const cleanHandle = data.handle?.replace(/^@/, '') || '';
    navigate(cleanHandle ? `/p/${cleanHandle}` : '/settings?s=profile&hint=handle', { replace: true });
  }, [data, isError, navigate]);

  return (
    <div className="flex h-dvh items-center justify-center bg-[color:var(--bl-bg)]">
      <Loader2 size={22} className="animate-spin text-teal-600 dark:text-teal-300" />
    </div>
  );
}
