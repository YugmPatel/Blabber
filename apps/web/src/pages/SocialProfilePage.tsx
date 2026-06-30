import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Film, Loader2, Lock, Plus, UserMinus, UserPlus, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import {
  cancelFollowRequest,
  fetchProfileByHandle,
  fetchProfilePosts,
  fetchProfileReels,
  followProfile,
  normalizeMediaUrl,
  unfollowProfile,
} from '@/api/client';
import type { FeedPost, ReelItem } from '@/api/client';

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
  const profile = profileQuery.data;
  const postsQuery = useQuery({
    queryKey: ['profile-posts', cleanHandle],
    queryFn: () => fetchProfilePosts(cleanHandle),
    enabled: Boolean(cleanHandle && profileQuery.data && !profileQuery.data.locked),
  });
  const reelsQuery = useQuery({
    queryKey: ['profile-reels', cleanHandle],
    queryFn: () => fetchProfileReels(cleanHandle),
    enabled: Boolean(cleanHandle && profile && !profile.locked),
  });

  const updateProfileCache = (profile: Awaited<ReturnType<typeof fetchProfileByHandle>>) => {
    queryClient.setQueryData(queryKey, profile);
  };

  const follow = useMutation({ mutationFn: followProfile, onSuccess: updateProfileCache });
  const unfollow = useMutation({ mutationFn: unfollowProfile, onSuccess: updateProfileCache });
  const cancel = useMutation({ mutationFn: cancelFollowRequest, onSuccess: updateProfileCache });
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
          <>
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
          {!profile.locked && (
            <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <h2 className="text-base font-semibold">Posts</h2>
              </div>
              {postsQuery.isLoading && <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">Loading posts...</p>}
              {postsQuery.data?.posts.length === 0 && <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">No posts yet.</p>}
              {postsQuery.data?.posts.map((post: FeedPost) => (
                <article key={post.id} className="border-b border-slate-100 px-5 py-4 last:border-b-0 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>{new Date(post.createdAt).toLocaleString()}</span>
                    {post.editedAt && <span>Edited</span>}
                  </div>
                  {post.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">{post.body}</p>}
                  {post.media.length > 0 && (
                    <div className={`mt-3 grid gap-2 ${post.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                      {post.media.map((media) => (
                        <img
                          key={media.mediaId}
                          src={normalizeMediaUrl(media.url)}
                          alt=""
                          className="aspect-square rounded-lg bg-slate-100 object-cover dark:bg-slate-950"
                        />
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    {post.commentCount} comments
                  </p>
                </article>
              ))}
            </section>
          )}
          {!profile.locked && (
            <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <h2 className="text-base font-semibold">Reels</h2>
                {profile.relationship === 'self' && (
                  <button onClick={() => navigate('/reels/new')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                    <Plus size={14} /> Create Reel
                  </button>
                )}
              </div>
              {reelsQuery.isLoading && <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">Loading Reels...</p>}
              {reelsQuery.data?.reels.length === 0 && <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">No Reels yet.</p>}
              <div className="grid gap-3 p-5 sm:grid-cols-2">
                {reelsQuery.data?.reels.map((reel: ReelItem) => (
                  <button key={reel.id} onClick={() => reel.processingStatus === 'ready' && navigate(`/reels/${reel.id}`)} className="rounded-lg border border-slate-200 p-4 text-left dark:border-slate-800">
                    <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-950">
                      <Film size={24} />
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm">{reel.caption || 'Reel'}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {reel.processingStatus && reel.processingStatus !== 'ready' ? reel.processingStatus : reel.durationSeconds ? `${Math.round(reel.durationSeconds)}s` : 'Ready'}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}
          </>
        )}
      </div>
    </main>
  );
}
