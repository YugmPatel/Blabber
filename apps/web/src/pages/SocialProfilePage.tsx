import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  AtSign,
  Bookmark,
  CalendarDays,
  Clapperboard,
  ExternalLink,
  Eye,
  Film,
  Globe,
  Heart,
  Landmark,
  Loader2,
  Lock,
  Menu,
  MessageCircle,
  Newspaper,
  Pencil,
  Play,
  Plus,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import Avatar from '@/components/Avatar';
import {
  cancelFollowRequest,
  fetchAuthorizedObjectUrl,
  fetchCommunities,
  fetchProfileByHandle,
  fetchProfilePosts,
  fetchProfileReels,
  fetchSavedPosts,
  followProfile,
  normalizeMediaUrl,
  unfollowProfile,
} from '@/api/client';
import type { Community, FeedPost, ReelItem } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';

type ProfileTab = 'posts' | 'reels' | 'communities' | 'saved' | 'about';

function totalReactions(counts?: Record<string, number>) {
  return Object.values(counts || {}).reduce((sum, n) => sum + n, 0);
}

function formatCount(loaded: number, hasMore: boolean) {
  return hasMore ? `${loaded}+` : String(loaded);
}

/** Cover hero — no cover-image field exists in the product yet, so this is
 *  always the brand gradient (deep navy/teal in dark, mint/sky in light). */
function ProfileCover() {
  return (
    <div className="relative h-40 w-full overflow-hidden sm:h-48">
      {/* Light-mode gradient */}
      <div
        aria-hidden="true"
        className="absolute inset-0 dark:hidden"
        style={{ background: 'linear-gradient(120deg, #d8fbf1 0%, #b5f2e3 32%, #c2ecfb 68%, #e8fbff 100%)' }}
      />
      {/* Dark-mode gradient */}
      <div
        aria-hidden="true"
        className="absolute inset-0 hidden dark:block"
        style={{ background: 'linear-gradient(120deg, #052e27 0%, #0a3f38 32%, #07304a 68%, #041420 100%)' }}
      />
      {/* Soft radial accents shared by both modes */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(circle at 18% 30%, rgba(45,212,191,0.35) 0%, transparent 45%), radial-gradient(circle at 80% 75%, rgba(94,234,212,0.25) 0%, transparent 40%)',
        }}
      />
    </div>
  );
}

function StatCard({ icon: Icon, value, label }: { icon: typeof Users; value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] px-2 py-3 text-center">
      <Icon size={15} className="text-teal-600 dark:text-teal-300" />
      <span className="text-sm font-bold leading-none text-[color:var(--bl-text)]">{value}</span>
      <span className="text-[11px] text-[color:var(--bl-text-muted)]">{label}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: typeof Users; title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
        <Icon size={22} />
      </span>
      <p className="mt-3 font-semibold text-[color:var(--bl-text)]">{title}</p>
      <p className="mt-1 text-sm text-[color:var(--bl-text-muted)]">{hint}</p>
    </div>
  );
}

function ProfilePostCard({ post, onOpen }: { post: FeedPost; onOpen: () => void }) {
  const cover = post.media[0];
  const reactions = totalReactions(post.reactionCounts);
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedCoverUrl = normalizeMediaUrl(cover?.url);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    setImageUrl(undefined);
    setImageFailed(false);
    if (!normalizedCoverUrl) return undefined;
    fetchAuthorizedObjectUrl(normalizedCoverUrl)
      .then((url) => {
        if (!alive) return;
        if (!url) {
          setImageFailed(true);
          return;
        }
        objectUrl = url;
        setImageUrl(url);
      })
      .catch(() => {
        if (alive) setImageFailed(true);
      });
    return () => {
      alive = false;
      if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [normalizedCoverUrl]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="bl-focus-ring group flex flex-col overflow-hidden rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] text-left shadow-sm transition hover:[box-shadow:var(--bl-glow-sm)]"
    >
      {cover && !imageFailed ? (
        imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="aspect-[4/3] w-full bg-[color:var(--bl-hover)] object-cover"
          loading="lazy"
        />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-[color:var(--bl-hover)] text-xs text-[color:var(--bl-text-muted)]">
            Loading image...
          </div>
        )
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center bg-[color:var(--bl-hover)] px-4">
          <p className="line-clamp-4 text-sm leading-6 text-[color:var(--bl-text-secondary)]">
            {cover && imageFailed ? 'Image unavailable' : post.body || 'Post'}
          </p>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {post.body && cover && (
          <p className="line-clamp-2 text-[13px] font-medium leading-5 text-[color:var(--bl-text)]">{post.body}</p>
        )}
        <div className="mt-auto flex items-center gap-3 text-xs text-[color:var(--bl-text-muted)]">
          <span className="inline-flex items-center gap-1">
            <Heart size={12} className="text-rose-500" /> {reactions}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle size={12} /> {post.commentCount}
          </span>
          <time className="ml-auto">
            {new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </time>
        </div>
      </div>
    </button>
  );
}

function ProfileReelCard({ reel, onOpen }: { reel: ReelItem; onOpen: () => void }) {
  const ready = reel.processingStatus === 'ready' || !reel.processingStatus;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!ready}
      className="bl-focus-ring group flex flex-col overflow-hidden rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] text-left shadow-sm transition hover:[box-shadow:var(--bl-glow-sm)] disabled:cursor-default"
    >
      <div className="relative flex aspect-video w-full items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 dark:from-teal-500/10 dark:to-slate-900">
        <Film size={26} className="text-teal-600/60 dark:text-teal-300/50" />
        {ready && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition group-hover:bg-teal-600/80">
              <Play size={16} fill="currentColor" />
            </span>
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-2 text-[13px] font-medium leading-5 text-[color:var(--bl-text)]">
          {reel.caption || 'Reel'}
        </p>
        <div className="mt-auto flex items-center gap-3 text-xs text-[color:var(--bl-text-muted)]">
          {!ready ? (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <Loader2 size={11} className="animate-spin" /> {reel.processingStatus}
            </span>
          ) : (
            <>
              {reel.durationSeconds != null && <span>{Math.round(reel.durationSeconds)}s</span>}
              <span className="inline-flex items-center gap-1">
                <Heart size={12} className="text-rose-500" /> {totalReactions(reel.reactionCounts)}
              </span>
              {reel.commentCount !== undefined && (
                <span className="inline-flex items-center gap-1">
                  <MessageCircle size={12} /> {reel.commentCount}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function CommunityCard({ community, onOpen }: { community: Community; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="bl-focus-ring flex items-center gap-3 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 text-left shadow-sm transition hover:[box-shadow:var(--bl-glow-sm)]"
    >
      <Avatar src={community.avatarUrl} alt={community.name} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[color:var(--bl-text)]">{community.name}</p>
        <p className="truncate text-xs text-[color:var(--bl-text-muted)]">
          @{community.handle} · {community.memberCount} {community.memberCount === 1 ? 'member' : 'members'}
        </p>
      </div>
      {community.membership?.role && community.membership.role !== 'member' && (
        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
          {community.membership.role}
        </span>
      )}
    </button>
  );
}

export default function SocialProfilePage() {
  const { handle = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('posts');
  const cleanHandle = handle.replace(/^@/, '').toLowerCase();
  const queryKey = ['profiles', cleanHandle] as const;

  const profileQuery = useQuery({
    queryKey,
    queryFn: () => fetchProfileByHandle(cleanHandle),
    enabled: Boolean(cleanHandle),
  });
  const profile = profileQuery.data;
  const isSelf = profile?.relationship === 'self';
  const unlocked = Boolean(profile && !profile.locked);

  const postsQuery = useQuery({
    queryKey: ['profile-posts', cleanHandle],
    queryFn: () => fetchProfilePosts(cleanHandle),
    enabled: Boolean(cleanHandle) && unlocked,
  });
  const reelsQuery = useQuery({
    queryKey: ['profile-reels', cleanHandle],
    queryFn: () => fetchProfileReels(cleanHandle),
    enabled: Boolean(cleanHandle) && unlocked,
  });
  // Own communities only — there is no per-user communities API for other people.
  const communitiesQuery = useQuery({
    queryKey: ['communities'],
    queryFn: fetchCommunities,
    enabled: Boolean(isSelf),
  });
  // Saved content is strictly private to the current user.
  const savedQuery = useQuery({
    queryKey: ['profile-saved-posts'],
    queryFn: () => fetchSavedPosts(),
    enabled: Boolean(isSelf) && tab === 'saved',
  });

  const updateProfileCache = (updated: Awaited<ReturnType<typeof fetchProfileByHandle>>) => {
    queryClient.setQueryData(queryKey, updated);
  };
  const follow = useMutation({ mutationFn: followProfile, onSuccess: updateProfileCache });
  const unfollow = useMutation({ mutationFn: unfollowProfile, onSuccess: updateProfileCache });
  const cancel = useMutation({ mutationFn: cancelFollowRequest, onSuccess: updateProfileCache });
  const busy = follow.isPending || unfollow.isPending || cancel.isPending;

  const posts = postsQuery.data?.posts || [];
  const reels = reelsQuery.data?.reels || [];
  const communities = communitiesQuery.data?.communities || [];
  const savedPosts = savedQuery.data?.savedPosts || [];

  // Self-only extras that come from the authenticated account (never exposed
  // for other users because the profile API deliberately omits them).
  const selfUser = currentUser as (typeof currentUser & { role?: string; createdAt?: string | Date }) | null;
  const rolePill = isSelf ? selfUser?.role : undefined;
  const joinedLabel = useMemo(() => {
    if (!isSelf || !selfUser?.createdAt) return null;
    const date = new Date(selfUser.createdAt);
    if (Number.isNaN(date.getTime())) return null;
    return `Joined ${date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
  }, [isSelf, selfUser?.createdAt]);

  const tabs = useMemo(() => {
    const list: Array<{ key: ProfileTab; label: string }> = [
      { key: 'posts', label: 'Posts' },
      { key: 'reels', label: 'Reels' },
    ];
    if (isSelf) {
      list.push({ key: 'communities', label: 'Communities' });
      list.push({ key: 'saved', label: 'Saved' });
    }
    list.push({ key: 'about', label: 'About' });
    return list;
  }, [isSelf]);

  const goToConversations = () => navigate('/chats');

  const followAction = () => {
    if (!profile?.handle || profile.relationship === 'self') return null;
    if (profile.relationship === 'following') {
      return (
        <button
          onClick={() => unfollow.mutate(profile.handle!)}
          disabled={busy}
          className="bl-focus-ring inline-flex items-center gap-2 rounded-xl border border-teal-500/40 px-4 py-2.5 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 disabled:opacity-60 dark:text-teal-300 dark:hover:bg-teal-500/10"
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
          className="bl-focus-ring inline-flex items-center gap-2 rounded-xl border border-[color:var(--bl-border)] px-4 py-2.5 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] disabled:opacity-60"
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
        className="bl-focus-ring inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
        Follow
      </button>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[color:var(--bl-bg)] text-[color:var(--bl-text)]">
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
          onNewConversation={goToConversations}
          onChatFilterChange={goToConversations}
          onNavigateMobile={() => setSidebarOpen(false)}
        />
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg border border-[color:var(--bl-border)] p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] md:hidden"
              aria-label="Open navigation"
            >
              <Menu size={16} />
            </button>
            <button
              onClick={() => navigate(-1)}
              className="bl-focus-ring inline-flex items-center gap-2 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
            >
              <ArrowLeft size={15} />
              Back
            </button>
          </div>

          {profileQuery.isLoading && (
            <div className="rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-10 text-center text-sm text-[color:var(--bl-text-muted)]">
              <Loader2 size={18} className="mx-auto mb-2 animate-spin text-teal-600 dark:text-teal-300" />
              Loading profile...
            </div>
          )}

          {profileQuery.isError && (
            <div className="rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-10 text-center">
              <h1 className="text-lg font-semibold text-[color:var(--bl-text)]">Profile unavailable</h1>
              <p className="mt-2 text-sm text-[color:var(--bl-text-muted)]">This profile could not be opened.</p>
            </div>
          )}

          {profile && (
            <>
              {/* ── Hero card: cover + identity + stats + bio ─────────────── */}
              <section
                className="overflow-hidden rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-sm"
                style={{ boxShadow: 'var(--bl-glow-sm)' }}
              >
                <ProfileCover />

                <div className="px-5 pb-5 sm:px-6">
                  {/* Avatar + identity + actions */}
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="flex min-w-0 items-end gap-4">
                      <div className="-mt-10 flex-shrink-0 rounded-full bg-[color:var(--bl-panel)] p-1.5 shadow-md">
                        <Avatar src={normalizeMediaUrl(profile.avatarUrl)} alt={profile.name} size="xl" />
                      </div>
                      <div className="min-w-0 pb-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h1 className="truncate text-2xl font-bold tracking-tight text-[color:var(--bl-text)]">{profile.name}</h1>
                          {rolePill && (
                            <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                              {rolePill}
                            </span>
                          )}
                        </div>
                        {profile.displayHandle && (
                          <p className="truncate text-sm font-medium text-teal-600 dark:text-teal-300">{profile.displayHandle}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-2 pb-1">
                      {isSelf ? (
                        <button
                          onClick={() => navigate('/settings?s=profile')}
                          className="bl-focus-ring inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
                        >
                          <Pencil size={14} />
                          Edit profile
                        </button>
                      ) : (
                        followAction()
                      )}
                    </div>
                  </div>

                  {profile.locked ? (
                    <div className="mt-5 flex items-center gap-3 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] px-4 py-3.5 text-sm text-[color:var(--bl-text-secondary)]">
                      <Lock size={16} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
                      {profile.message || 'This profile is private.'}
                    </div>
                  ) : (
                    <>
                      {/* Stats — real counts only (loaded counts get a “+” when more pages exist) */}
                      <div className="mt-5 grid grid-cols-4 gap-2 sm:gap-3">
                        <StatCard
                          icon={Newspaper}
                          value={postsQuery.isLoading ? '…' : formatCount(posts.length, Boolean(postsQuery.data?.nextCursor))}
                          label="Posts"
                        />
                        <StatCard
                          icon={Clapperboard}
                          value={reelsQuery.isLoading ? '…' : formatCount(reels.length, Boolean(reelsQuery.data?.nextCursor))}
                          label="Reels"
                        />
                        <StatCard icon={Users} value={String(profile.counts?.followers ?? 0)} label="Followers" />
                        <StatCard icon={UserCheck} value={String(profile.counts?.following ?? 0)} label="Following" />
                      </div>

                      {/* Bio + metadata */}
                      {(profile.bio || profile.website || joinedLabel) && (
                        <div className="mt-4 space-y-2.5">
                          {profile.bio && (
                            <p className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--bl-text-secondary)]">{profile.bio}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[color:var(--bl-text-muted)]">
                            {profile.website && (
                              <a
                                href={profile.website}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full items-center gap-1.5 truncate font-semibold text-teal-700 hover:underline dark:text-teal-300"
                              >
                                <ExternalLink size={12} />
                                <span className="truncate">{profile.website.replace(/^https:\/\//, '')}</span>
                              </a>
                            )}
                            {joinedLabel && (
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarDays size={12} />
                                {joinedLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>

              {/* ── Tabs + content ────────────────────────────────────────── */}
              {!profile.locked && (
                <>
                  <div className="flex gap-1 overflow-x-auto border-b border-[color:var(--bl-border)]">
                    {tabs.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setTab(item.key)}
                        aria-pressed={tab === item.key}
                        className={`bl-focus-ring relative whitespace-nowrap px-4 py-2.5 text-sm font-semibold transition ${
                          tab === item.key
                            ? 'text-teal-700 dark:text-teal-300'
                            : 'text-[color:var(--bl-text-muted)] hover:text-[color:var(--bl-text)]'
                        }`}
                      >
                        {item.label}
                        {tab === item.key && (
                          <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-teal-600 dark:bg-teal-400" />
                        )}
                      </button>
                    ))}
                  </div>

                  {tab === 'posts' && (
                    postsQuery.isLoading ? (
                      <p className="py-8 text-center text-sm text-[color:var(--bl-text-muted)]">Loading posts...</p>
                    ) : posts.length === 0 ? (
                      <EmptyState icon={Newspaper} title="No posts yet" hint={isSelf ? 'Share your first post from the Feed.' : 'Posts will appear here.'} />
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {posts.map((post) => (
                          <ProfilePostCard key={post.id} post={post} onOpen={() => navigate(`/posts/${post.id}`)} />
                        ))}
                      </div>
                    )
                  )}

                  {tab === 'reels' && (
                    <>
                      {isSelf && (
                        <div className="flex justify-end">
                          <button
                            onClick={() => navigate('/reels/new')}
                            className="bl-focus-ring inline-flex items-center gap-2 rounded-xl border border-teal-500/40 px-3.5 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
                          >
                            <Plus size={14} /> Create Reel
                          </button>
                        </div>
                      )}
                      {reelsQuery.isLoading ? (
                        <p className="py-8 text-center text-sm text-[color:var(--bl-text-muted)]">Loading Reels...</p>
                      ) : reels.length === 0 ? (
                        <EmptyState icon={Clapperboard} title="No Reels yet" hint={isSelf ? 'Create your first Reel to share it here.' : 'Reels will appear here.'} />
                      ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {reels.map((reel) => (
                            <ProfileReelCard key={reel.id} reel={reel} onOpen={() => navigate(`/reels/${reel.id}`)} />
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {tab === 'communities' && isSelf && (
                    communitiesQuery.isLoading ? (
                      <p className="py-8 text-center text-sm text-[color:var(--bl-text-muted)]">Loading communities...</p>
                    ) : communities.length === 0 ? (
                      <EmptyState icon={Landmark} title="No communities yet" hint="Communities you join will appear here." />
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {communities.map((community) => (
                          <CommunityCard key={community.id} community={community} onOpen={() => navigate(`/c/${community.handle}`)} />
                        ))}
                      </div>
                    )
                  )}

                  {tab === 'saved' && isSelf && (
                    <>
                      <div className="flex justify-end">
                        <button
                          onClick={() => navigate('/settings?s=saved')}
                          className="bl-focus-ring inline-flex items-center gap-2 rounded-xl border border-[color:var(--bl-border)] px-3.5 py-2 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                        >
                          <Bookmark size={14} /> Saved messages
                        </button>
                      </div>
                      {savedQuery.isLoading ? (
                        <p className="py-8 text-center text-sm text-[color:var(--bl-text-muted)]">Loading saved posts...</p>
                      ) : savedPosts.length === 0 ? (
                        <EmptyState icon={Bookmark} title="Nothing saved yet" hint="Posts you save will appear here. Only you can see them." />
                      ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {savedPosts.map((item) => (
                            <ProfilePostCard key={item.post.id} post={item.post} onOpen={() => navigate(`/posts/${item.post.id}`)} />
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {tab === 'about' && (
                    <section className="space-y-4 rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-5 sm:p-6">
                      {profile.bio ? (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--bl-text-muted)]">Bio</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[color:var(--bl-text-secondary)]">{profile.bio}</p>
                        </div>
                      ) : (
                        <p className="text-sm text-[color:var(--bl-text-muted)]">No bio yet.</p>
                      )}
                      <div className="space-y-2.5 border-t border-[color:var(--bl-border)] pt-4 text-sm text-[color:var(--bl-text-secondary)]">
                        {profile.displayHandle && (
                          <p className="flex items-center gap-2.5">
                            <AtSign size={14} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
                            {profile.displayHandle}
                          </p>
                        )}
                        {profile.website && (
                          <p className="flex items-center gap-2.5">
                            <Globe size={14} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
                            <a href={profile.website} target="_blank" rel="noreferrer" className="truncate font-semibold text-teal-700 hover:underline dark:text-teal-300">
                              {profile.website.replace(/^https:\/\//, '')}
                            </a>
                          </p>
                        )}
                        {rolePill && (
                          <p className="flex items-center gap-2.5">
                            <UserCheck size={14} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
                            {rolePill}
                          </p>
                        )}
                        {joinedLabel && (
                          <p className="flex items-center gap-2.5">
                            <CalendarDays size={14} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
                            {joinedLabel}
                          </p>
                        )}
                        {isSelf && profile.visibility && (
                          <p className="flex items-center gap-2.5">
                            <Eye size={14} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
                            {profile.visibility === 'public' ? 'Public profile' : 'Private profile'}
                            <span className="text-xs text-[color:var(--bl-text-muted)]">(only you can see this)</span>
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
