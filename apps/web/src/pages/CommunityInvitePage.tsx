import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, UsersRound } from 'lucide-react';
import { acceptCommunityInvite, previewCommunityInvite } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';

export default function CommunityInvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const preview = useQuery({ queryKey: ['community-invite', token], queryFn: () => previewCommunityInvite(token), retry: false, enabled: isAuthenticated && Boolean(token) });
  const accept = useMutation({
    mutationFn: () => acceptCommunityInvite(token),
    onSuccess: ({ community, pending }) => {
      if (pending) return;
      navigate(`/c/${community.handle}`, { replace: true });
    },
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate(`/login?returnTo=${encodeURIComponent(`/communities/join/${token}`)}`, { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate, token]);

  if (!isLoading && !isAuthenticated) return null;

  const community = accept.data?.community || preview.data;
  const alreadyMember = Boolean(community?.membership);
  const actionLabel = alreadyMember
    ? 'Open Community'
    : community?.membershipMode === 'approval_required'
      ? 'Request to Join'
      : 'Join Community';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-4 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        {isLoading || preview.isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading</div>
        ) : preview.isError ? (
          <p className="text-sm text-slate-500">This invite is unavailable.</p>
        ) : community && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-900"><UsersRound /></div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">{community.name}</h1>
                <p className="text-sm text-slate-500">@{community.handle} · {community.memberCount} members</p>
              </div>
            </div>
            {community.description && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{community.description}</p>}
            {accept.data?.pending && <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">Your request is pending.</p>}
            {accept.isError && <p className="mt-5 text-sm text-slate-500">This invite is unavailable.</p>}
            <button onClick={() => alreadyMember ? navigate(`/c/${community.handle}`, { replace: true }) : accept.mutate()} disabled={accept.isPending || Boolean(accept.data?.pending)} className="mt-5 flex h-10 w-full items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">
              {accept.isPending ? <Loader2 size={16} className="animate-spin" /> : actionLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
