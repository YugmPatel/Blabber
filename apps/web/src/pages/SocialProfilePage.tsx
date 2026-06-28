import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Loader2, Lock, UserMinus, UserPlus, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import {
  cancelFollowRequest,
  fetchProfileByHandle,
  followProfile,
  normalizeMediaUrl,
  unfollowProfile,
} from '@/api/client';

export default function SocialProfilePage() {
  const { handle = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cleanHandle = handle.replace(/^@/, '').toLowerCase();
  const queryKey = ['profiles', cleanHandle] as const;

  const profileQuery = useQuery({
    queryKey,
    queryFn: () => fetchProfileByHandle(cleanHandle),
    enabled: Boolean(cleanHandle),
  });

  const updateProfileCache = (profile: Awaited<ReturnType<typeof fetchProfileByHandle>>) => {
    queryClient.setQueryData(queryKey, profile);
  };

  const follow = useMutation({ mutationFn: followProfile, onSuccess: updateProfileCache });
  const unfollow = useMutation({ mutationFn: unfollowProfile, onSuccess: updateProfileCache });
  const cancel = useMutation({ mutationFn: cancelFollowRequest, onSuccess: updateProfileCache });
  const profile = profileQuery.data;
  const busy = follow.isPending || unfollow.isPending || cancel.isPending;

  const action = () => {
    if (!profile?.handle || profile.relationship === 'self') return null;
    if (profile.relationship === 'following') {
      return (
        <button
          onClick={() => unfollow.mutate(profile.handle!)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <UserMinus size={15} />}
          Following
        </button>
      );
    }
    if (profile.relationship === 'requested_outgoing') {
      return (
        <button
          onClick={() => cancel.mutate(profile.handle!)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
          Requested
        </button>
      );
    }
    return (
      <button
        onClick={() => follow.mutate(profile.handle!)}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-slate-950"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
        Follow
      </button>
    );
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <button
          onClick={() => navigate(-1)}
          className="mb-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        {profileQuery.isLoading && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            Loading profile...
          </div>
        )}

        {profileQuery.isError && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
            <h1 className="text-xl font-semibold">Profile unavailable</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">This profile could not be opened.</p>
          </div>
        )}

        {profile && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <Avatar src={normalizeMediaUrl(profile.avatarUrl)} alt={profile.name} size="xl" />
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold">{profile.name}</h1>
                  <p className="truncate text-sm text-slate-500 dark:text-slate-400">{profile.displayHandle}</p>
                </div>
              </div>
              {action()}
            </div>

            {profile.locked ? (
              <div className="mt-6 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                <Lock size={16} />
                {profile.message || 'This profile is private.'}
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {profile.bio && <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{profile.bio}</p>}
                {profile.website && (
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-2 truncate text-sm font-semibold text-teal-700 dark:text-teal-300"
                  >
                    <ExternalLink size={15} />
                    <span className="truncate">{profile.website}</span>
                  </a>
                )}
                <div className="flex gap-4 text-sm text-slate-500 dark:text-slate-400">
                  <span>{profile.counts?.followers ?? 0} followers</span>
                  <span>{profile.counts?.following ?? 0} following</span>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
