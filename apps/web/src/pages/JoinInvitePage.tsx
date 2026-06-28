import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useInvitePreview, useJoinInvite } from '@/hooks/useChats';

export default function JoinInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const preview = useInvitePreview(isAuthenticated ? token : undefined);
  const join = useJoinInvite();

  useEffect(() => {
    if (isLoading || isAuthenticated || !token) return;
    navigate(`/login?returnTo=${encodeURIComponent(`/join/${token}`)}`, { replace: true });
  }, [isLoading, isAuthenticated, navigate, token]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="animate-spin text-slate-500" />
      </div>
    );
  }

  const invite = preview.data?.invite;
  const errorMessage =
    preview.error instanceof Error
      ? 'This invite link is unavailable.'
      : join.error instanceof Error
        ? 'You cannot join this group.'
        : null;

  const joinGroup = async () => {
    if (!token) return;
    const result = await join.mutateAsync(token);
    navigate(`/chats/${result.chat._id}`, { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <main className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
        {preview.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-slate-500" />
          </div>
        ) : errorMessage || !invite ? (
          <>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Invite unavailable</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {errorMessage || 'This invite link is unavailable.'}
            </p>
            <button
              type="button"
              onClick={() => navigate('/chats')}
              className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-950"
            >
              Go to chats
            </button>
          </>
        ) : (
          <>
            <Avatar src={invite.groupAvatarUrl} alt={invite.groupName} size="xl" />
            <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">{invite.groupName}</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {invite.alreadyMember ? 'You are already in this group.' : 'You have been invited to join this group.'}
            </p>
            {invite.expiresAt && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Expires {new Date(invite.expiresAt).toLocaleString()}
              </p>
            )}
            <button
              type="button"
              onClick={invite.alreadyMember && invite.chatId ? () => navigate(`/chats/${invite.chatId}`, { replace: true }) : joinGroup}
              disabled={join.isPending}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              {join.isPending && <Loader2 size={16} className="animate-spin" />}
              {invite.alreadyMember ? 'Open group' : 'Join group'}
            </button>
          </>
        )}
      </main>
    </div>
  );
}
