import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Filter, Loader2, Search } from 'lucide-react';
import type { Chat, Message } from '@repo/types';
import { searchGlobalMessages } from '@/api/client';
import { useChats } from '@/hooks/useChats';
import { useAuth } from '@/contexts/AuthContext';
import { sourceJumpPath } from '@/lib/source-jump';

type MessageType = NonNullable<Message['type']>;
const MESSAGE_TYPES: Array<MessageType | 'all'> = ['all', 'text', 'image', 'audio', 'document', 'poll', 'sticker', 'event'];

function chatTitle(chat: Chat | undefined, currentUserId?: string) {
  if (!chat) return 'Chat';
  if (chat.type === 'group') return chat.title || 'Group chat';
  return chat.participantProfiles?.find((profile) => profile._id !== currentUserId)?.name || 'Direct chat';
}

export default function MessageSearchPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { data: chats = [] } = useChats();
  const [query, setQuery] = useState(params.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [messageType, setMessageType] = useState<MessageType | 'all'>('all');
  const [chatKind, setChatKind] = useState<'all' | 'direct' | 'group'>('all');

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = query.trim();
      setDebouncedQuery(nextQuery);
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (nextQuery) next.set('q', nextQuery);
        else next.delete('q');
        return next;
      }, { replace: true });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query, setParams]);

  const search = useQuery({
    queryKey: ['messages', 'search', 'global', debouncedQuery, messageType, chatKind],
    queryFn: () => searchGlobalMessages({
      q: debouncedQuery,
      type: messageType,
      chatKind,
      limit: 40,
    }),
    enabled: debouncedQuery.length >= 2,
    staleTime: 20_000,
  });

  const chatsById = useMemo(() => new Map(chats.map((chat) => [chat._id, chat])), [chats]);
  const results = search.data?.results || [];

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/chats')}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Back
          </button>
          <div className="relative min-w-0 flex-1">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Filter size={15} className="text-slate-400" />
          <select
            value={messageType}
            onChange={(event) => setMessageType(event.target.value as MessageType | 'all')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            {MESSAGE_TYPES.map((type) => (
              <option key={type} value={type}>{type === 'all' ? 'All types' : type}</option>
            ))}
          </select>
          <select
            value={chatKind}
            onChange={(event) => setChatKind(event.target.value as 'all' | 'direct' | 'group')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="all">All chats</option>
            <option value="direct">Direct chats</option>
            <option value="group">Groups</option>
          </select>
        </div>

        <section className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {debouncedQuery.length < 2 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Type at least two characters.</p>
          ) : search.isFetching ? (
            <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 size={16} className="animate-spin" />
              Searching messages
            </div>
          ) : results.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No messages found.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {results.map((result) => {
                const chat = chatsById.get(result.chatId);
                return (
                  <button
                    key={result.messageId}
                    type="button"
                    onClick={() => navigate(sourceJumpPath({ chatId: result.chatId, messageId: result.messageId }))}
                    className="block w-full px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/70"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {chatTitle(chat, user?._id)}
                      </p>
                      <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                        {new Date(result.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {result.senderDisplayName} · {result.type}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">
                      {result.snippet}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
