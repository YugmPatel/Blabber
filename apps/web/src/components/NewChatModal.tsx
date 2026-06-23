import { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2, Users, ArrowLeft, ChevronRight } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { chatKeys } from '@/hooks/useChats';
import { useAuth } from '@/contexts/AuthContext';
import type { User } from '@repo/types';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenNewGroup?: () => void;
}

function UserAvatar({ user }: { user: User }) {
  const initial = (user.name?.[0] || user.username?.[0] || user.email[0]).toUpperCase();
  const colors = [
    'bg-teal-600',
    'bg-violet-500',
    'bg-rose-500',
    'bg-amber-500',
    'bg-sky-500',
    'bg-emerald-600',
  ];
  const color = colors[(initial.charCodeAt(0) - 65) % colors.length];
  return (
    <div
      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${color}`}
    >
      {initial}
    </div>
  );
}

export default function NewChatModal({ isOpen, onClose, onOpenNewGroup }: NewChatModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Search results
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['users', 'search', searchQuery],
    queryFn: async () => {
      const response = await apiClient.get(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
      return response.data;
    },
    enabled: isOpen && searchQuery.trim().length > 0,
  });

  const displayedUsers: User[] = searchQuery.trim() ? (searchResults?.users ?? []) : [];

  const isLoading = searchQuery.trim() ? isSearching : false;

  // Filter out current user from list
  const filteredUsers = displayedUsers.filter((u) => u._id !== currentUser?._id);

  // Create / open direct chat
  const createChatMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!currentUser?._id) throw new Error('Not authenticated');

      // Check if a direct chat with this user already exists
      const chatsRes = await apiClient.get('/api/chats');
      const chats = chatsRes.data.chats ?? [];
      const existing = chats.find(
        (c: any) =>
          c.type === 'direct' &&
          c.participants.length === 2 &&
          c.participants.includes(currentUser._id) &&
          c.participants.includes(userId)
      );

      if (existing) return { chat: existing };

      const res = await apiClient.post('/api/chats', {
        type: 'direct',
        participantIds: [currentUser._id, userId],
      });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
      onClose();
      if (data?.chat?._id) {
        navigate(`/chats/${data.chat._id}`);
      }
    },
  });

  if (!isOpen) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel — slides in from the right on mobile, centered modal on desktop */}
      <div className="flex h-full w-full max-w-sm flex-col bg-white shadow-2xl dark:bg-slate-900 md:relative md:my-8 md:h-auto md:max-h-[80vh] md:rounded-2xl md:border md:border-slate-200 md:dark:border-slate-700">
        {/* Header */}
        <div className="flex h-14 items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-700">
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="flex-1 text-[15px] font-semibold text-slate-900 dark:text-white">
            New chat
          </h2>
          {/* X only on desktop */}
          <button
            onClick={onClose}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800 md:flex"
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name or email"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
            />
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto">
          {/* New Group row */}
          <button
            onClick={() => {
              onClose();
              onOpenNewGroup?.();
            }}
            className="flex w-full items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40">
              <Users size={18} className="text-teal-700 dark:text-teal-400" />
            </div>
            <span className="flex-1 text-left text-[14px] font-medium text-slate-900 dark:text-white">
              New Group
            </span>
            <ChevronRight size={16} className="text-slate-400" />
          </button>

          <div className="mx-4 h-px bg-slate-100 dark:bg-slate-800" />

          {/* User list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={22} className="animate-spin text-slate-400" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search size={32} className="mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {searchQuery.trim() ? 'No users found' : 'Search for a teammate'}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {searchQuery.trim()
                  ? 'Try a different name or email'
                  : 'Type a name, username, or email to start a chat'}
              </p>
            </div>
          ) : (
            <ul>
              {filteredUsers.map((user) => (
                <li key={user._id}>
                  <button
                    onClick={() => createChatMutation.mutate(user._id)}
                    disabled={createChatMutation.isPending}
                    className="flex w-full items-center gap-3 px-4 py-3 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-slate-800/60"
                  >
                    <UserAvatar user={user} />
                    <div className="min-w-0 flex-1 text-left">
                      <p className="truncate text-[14px] font-medium text-slate-900 dark:text-white">
                        {user.name || user.username}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {user.username ? `@${user.username}` : user.email}
                      </p>
                    </div>
                    {createChatMutation.isPending && (
                      <Loader2 size={16} className="animate-spin text-slate-400" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Error banner */}
        {createChatMutation.isError && (
          <div className="border-t border-slate-200 p-4 dark:border-slate-700">
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
              Failed to start chat. Please try again.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
