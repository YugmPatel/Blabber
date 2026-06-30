import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, Menu, Plus, UsersRound } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import { createCommunity, fetchCommunities, normalizeMediaUrl } from '@/api/client';

export default function CommunitiesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    handle: '',
    description: '',
    membershipMode: 'open' as 'open' | 'approval_required' | 'private',
    postingPolicy: 'everyone' as 'everyone' | 'mods_admins' | 'admins_only',
  });
  const query = useQuery({ queryKey: ['communities'], queryFn: fetchCommunities });
  const create = useMutation({
    mutationFn: () => createCommunity(form),
    onSuccess: (community) => {
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      navigate(`/c/${community.handle}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  const communities = query.data?.communities || [];
  const pending = query.data?.pending || [];

  return (
    <div className="flex h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-slate-950/40" onClick={() => setSidebarOpen(false)} />
          <Sidebar onNavigateMobile={() => setSidebarOpen(false)} />
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950">
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-900" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <UsersRound size={19} className="text-teal-600" />
          <h1 className="text-base font-semibold">Communities</h1>
        </header>

        <div className="grid flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 border-r border-slate-200 dark:border-slate-800">
            {query.isLoading ? (
              <div className="flex h-56 items-center justify-center text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading
              </div>
            ) : communities.length === 0 && pending.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-slate-500">Create or join a Community to start participating.</div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {[...communities, ...pending].map((community) => (
                  <button
                    key={community.id}
                    onClick={() => navigate(`/c/${community.handle}`)}
                    className="flex w-full items-center gap-3 bg-white px-5 py-4 text-left hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900"
                  >
                    {community.avatarUrl ? (
                      <img src={normalizeMediaUrl(community.avatarUrl)} alt="" className="h-11 w-11 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200">
                        <UsersRound size={19} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{community.name}</p>
                      <p className="truncate text-xs text-slate-500">@{community.handle} · {community.memberCount} members</p>
                    </div>
                    {community.joinRequest && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">Pending</span>}
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="bg-white p-5 dark:bg-slate-950">
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold">Create Community</h2>
              </div>
              <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm lowercase dark:border-slate-700 dark:bg-slate-900" placeholder="handle" value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value.toLowerCase() })} />
              <textarea className="min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" value={form.membershipMode} onChange={(event) => setForm({ ...form, membershipMode: event.target.value as any })}>
                <option value="open">Open</option>
                <option value="approval_required">Approval required</option>
                <option value="private">Private</option>
              </select>
              <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" value={form.postingPolicy} onChange={(event) => setForm({ ...form, postingPolicy: event.target.value as any })}>
                <option value="everyone">Everyone can post</option>
                <option value="mods_admins">Moderators and admins</option>
                <option value="admins_only">Admins only</option>
              </select>
              {create.error && <p className="text-sm text-rose-600">{(create.error as any)?.response?.data?.message || 'Could not create Community'}</p>}
              <button disabled={create.isPending} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">
                {create.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create
              </button>
            </form>
          </aside>
        </div>
      </main>
    </div>
  );
}
