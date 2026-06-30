import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, UsersRound } from 'lucide-react';
import { acceptCommunityInvite, previewCommunityInvite } from '@/api/client';

export default function CommunityInvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const preview = useQuery({ queryKey: ['community-invite', token], queryFn: () => previewCommunityInvite(token), retry: false });
  const accept = useMutation({ mutationFn: () => acceptCommunityInvite(token), onSuccess: (community) => navigate(`/c/${community.handle}`, { replace: true }) });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        {preview.isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading</div>
        ) : preview.isError ? (
          <p className="text-sm text-slate-500">Invite unavailable</p>
        ) : preview.data && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-900"><UsersRound /></div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">{preview.data.name}</h1>
                <p className="text-sm text-slate-500">@{preview.data.handle} · {preview.data.memberCount} members</p>
              </div>
            </div>
            {preview.data.description && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{preview.data.description}</p>}
            <button onClick={() => accept.mutate()} disabled={accept.isPending} className="mt-5 flex h-10 w-full items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">
              {accept.isPending ? <Loader2 size={16} className="animate-spin" /> : 'Join Community'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
