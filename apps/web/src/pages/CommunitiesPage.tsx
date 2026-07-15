import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Compass, Globe, Loader2, Lock, Menu, Plus, Search, UsersRound, X } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import { createCommunity, fetchCommunities, normalizeMediaUrl } from '@/api/client';
import type { Community } from '@/api/client';

// Deterministic teal-forward fallback tile colors — decorative only, derived
// from the community's own name (like Avatar.tsx's palette), never implying
// a real category. Kept within the mint/teal/green direction for this page.
const FALLBACK_TILES: [string, string][] = [
  ['#0bae9a', '#0d766e'], // teal
  ['#2ac8bd', '#0bae9a'], // aqua
  ['#10b981', '#059669'], // emerald
  ['#84cc16', '#65a30d'], // lime
  ['#0d9488', '#115e59'], // deep teal
];

function pickFallbackTile(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return FALLBACK_TILES[Math.abs(hash) % FALLBACK_TILES.length];
}

export default function CommunitiesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    membershipMode: 'open' as 'open' | 'approval_required' | 'private',
    postingPolicy: 'everyone' as 'everyone' | 'mods_admins' | 'admins_only',
  });
  const query = useQuery({ queryKey: ['communities'], queryFn: fetchCommunities });
  const create = useMutation({
    mutationFn: () => createCommunity(form),
    onSuccess: (community) => {
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setShowCreateModal(false);
      navigate(`/c/${community.handle}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  const allCommunities = useMemo(
    () => [...(query.data?.communities || []), ...(query.data?.pending || [])],
    [query.data]
  );

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const visibleCommunities = trimmedQuery
    ? allCommunities.filter(
        (community) => community.name.toLowerCase().includes(trimmedQuery) || community.handle.toLowerCase().includes(trimmedQuery)
      )
    : allCommunities;

  return (
    <div className="flex h-dvh overflow-hidden bg-[color:var(--bl-bg)] text-[color:var(--bl-text)]">
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${showSidebar ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setShowSidebar(false)}
        aria-hidden="true"
      />
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${showSidebar ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
          onNewConversation={() => navigate('/chats')}
          onChatFilterChange={() => navigate('/chats')}
          onNavigateMobile={() => setShowSidebar(false)}
          taskCount={0}
        />
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto bg-[color:var(--bl-bg)]">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
          <button
            onClick={() => setShowSidebar(true)}
            className="rounded-lg border border-[color:var(--bl-border)] p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] md:hidden"
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>

          {/* ── Header ───────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-[color:var(--bl-text)]">Communities</h1>
              <p className="mt-2 max-w-xl text-[15px] leading-6 text-[color:var(--bl-text-secondary)]">
                Connect, collaborate, and grow together in communities that matter to you.
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bl-focus-ring inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 hover:shadow dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
            >
              <Plus size={16} strokeWidth={2.5} />
              Create Community
            </button>
          </div>

          {/* ── Search ───────────────────────────────────────────────────── */}
          <div className="relative max-w-xl">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--bl-text-muted)]" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              type="text"
              placeholder="Search communities..."
              className="w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] py-2.5 pl-10 pr-4 text-sm text-[color:var(--bl-text)] outline-none transition placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-500/20"
            />
          </div>

          {/* ── My Communities ───────────────────────────────────────────── */}
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--bl-text)]">My Communities</h2>
            <div className="mt-4">
              {query.isLoading ? (
                <div className="flex h-40 items-center justify-center gap-2 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] text-sm text-[color:var(--bl-text-muted)]">
                  <Loader2 size={16} className="animate-spin" /> Loading communities&hellip;
                </div>
              ) : query.isError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                  Could not load your communities. Try again.
                </div>
              ) : allCommunities.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-6 py-14 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                    <UsersRound size={22} />
                  </div>
                  <p className="mt-3 text-sm text-[color:var(--bl-text-muted)]">Create or join a Community to start participating.</p>
                </div>
              ) : visibleCommunities.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-6 py-14 text-center">
                  <p className="text-sm text-[color:var(--bl-text-muted)]">No communities match &ldquo;{searchQuery.trim()}&rdquo;.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {visibleCommunities.map((community) => (
                    <CommunityCard key={community.id} community={community} onOpen={() => navigate(`/c/${community.handle}`)} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Discover more communities — real /discover route, no fake browse ── */}
          <section className="flex flex-col items-center gap-5 rounded-3xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)]/60 px-6 py-10 text-center sm:flex-row sm:text-left">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
              <Compass size={28} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-[color:var(--bl-text)]">Discover more communities</h3>
              <p className="mt-1 text-sm text-[color:var(--bl-text-muted)]">Join communities to connect with people who share your interests.</p>
            </div>
            <button
              onClick={() => navigate('/discover')}
              className="bl-focus-ring flex-shrink-0 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
            >
              Explore Communities
            </button>
          </section>
        </div>
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]">
          <div
            className="max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)]"
            style={{ boxShadow: 'var(--bl-glow-md), 0 24px 60px -12px rgba(2, 20, 18, 0.45)' }}
          >
            <div className="flex items-center justify-between border-b border-[color:var(--bl-border)] px-5 py-4">
              <h2 className="text-base font-semibold text-[color:var(--bl-text)]">Create Community</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--bl-border)] text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] hover:text-[color:var(--bl-text)]"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Intro */}
            <div className="flex flex-col items-center px-5 pt-6 text-center">
              <span
                className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300"
                style={{ boxShadow: 'var(--bl-glow-sm)' }}
                aria-hidden="true"
              >
                <UsersRound size={24} />
              </span>
              <h3 className="mt-3 text-lg font-semibold text-teal-600 dark:text-teal-300">Create a new community</h3>
              <p className="mt-1 text-sm text-[color:var(--bl-text-muted)]">Bring people together around shared interests.</p>
            </div>

            <form onSubmit={submit} className="space-y-4 p-5">
              <div>
                <label htmlFor="community-name" className="mb-1.5 block text-sm font-medium text-[color:var(--bl-text)]">
                  Community name
                </label>
                <input
                  id="community-name"
                  className="w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] px-3.5 py-2.5 text-sm text-[color:var(--bl-text)] outline-none transition placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400 focus:bg-[color:var(--bl-panel)] focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-500/20"
                  placeholder="Enter community name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="community-description" className="mb-1.5 block text-sm font-medium text-[color:var(--bl-text)]">
                  Description <span className="font-normal text-[color:var(--bl-text-muted)]">(optional)</span>
                </label>
                <textarea
                  id="community-description"
                  className="min-h-28 w-full resize-none rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] px-3.5 py-2.5 text-sm text-[color:var(--bl-text)] outline-none transition placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400 focus:bg-[color:var(--bl-panel)] focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-500/20"
                  placeholder="Tell others what this community is about..."
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="community-privacy" className="mb-1.5 block text-sm font-medium text-[color:var(--bl-text)]">
                    Privacy
                  </label>
                  <div className="relative">
                    <Globe size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--bl-text-muted)]" aria-hidden="true" />
                    <select
                      id="community-privacy"
                      className="w-full appearance-none rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] py-2.5 pl-10 pr-9 text-sm text-[color:var(--bl-text)] outline-none transition focus:border-teal-400"
                      value={form.membershipMode}
                      onChange={(event) => setForm({ ...form, membershipMode: event.target.value as Community['membershipMode'] })}
                    >
                      <option value="open">Open</option>
                      <option value="approval_required">Approval required</option>
                      <option value="private">Private</option>
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--bl-text-muted)]" aria-hidden="true" />
                  </div>
                </div>
                <div>
                  <label htmlFor="community-posting" className="mb-1.5 block text-sm font-medium text-[color:var(--bl-text)]">
                    Who can post?
                  </label>
                  <div className="relative">
                    <UsersRound size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--bl-text-muted)]" aria-hidden="true" />
                    <select
                      id="community-posting"
                      className="w-full appearance-none rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] py-2.5 pl-10 pr-9 text-sm text-[color:var(--bl-text)] outline-none transition focus:border-teal-400"
                      value={form.postingPolicy}
                      onChange={(event) => setForm({ ...form, postingPolicy: event.target.value as NonNullable<Community['postingPolicy']> })}
                    >
                      <option value="everyone">Everyone can post</option>
                      <option value="mods_admins">Moderators and admins</option>
                      <option value="admins_only">Admins only</option>
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--bl-text-muted)]" aria-hidden="true" />
                  </div>
                </div>
              </div>
              {create.error && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                  {(create.error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not create Community'}
                </p>
              )}
              <button
                disabled={create.isPending || !form.name.trim()}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-teal-600 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 dark:disabled:hover:bg-teal-500"
                style={create.isPending || !form.name.trim() ? undefined : { boxShadow: 'var(--bl-glow-sm)' }}
              >
                {create.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create Community
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function CommunityCard({ community, onOpen }: { community: Community; onOpen: () => void }) {
  const isRestricted = community.membershipMode !== 'open';
  const [tileFrom, tileTo] = pickFallbackTile(community.name || community.handle);

  return (
    <button
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 text-left shadow-sm transition hover:shadow-md hover:[box-shadow:var(--bl-glow-sm)]"
    >
      <div className="flex items-start justify-between gap-2">
        {community.avatarUrl ? (
          <img src={normalizeMediaUrl(community.avatarUrl)} alt="" className="h-12 w-12 rounded-2xl object-cover" />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl text-white"
            style={{ background: `linear-gradient(135deg, ${tileFrom}, ${tileTo})` }}
          >
            <UsersRound size={20} />
          </div>
        )}
        {community.joinRequest && (
          <span className="flex-shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            Pending
          </span>
        )}
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-1.5">
        <p className="truncate text-[15px] font-semibold text-[color:var(--bl-text)]">{community.name}</p>
        {isRestricted && <Lock size={12} className="flex-shrink-0 text-[color:var(--bl-text-muted)]" aria-label="Restricted membership" />}
      </div>
      {community.description && (
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-[color:var(--bl-text-secondary)]">{community.description}</p>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-xs text-[color:var(--bl-text-muted)]">
        <span>{community.memberCount === 1 ? '1 member' : `${community.memberCount} members`}</span>
        {community.membership && (
          <>
            <span aria-hidden="true">&middot;</span>
            <span className="capitalize text-teal-600 dark:text-teal-300">{community.membership.role}</span>
          </>
        )}
      </div>
    </button>
  );
}
