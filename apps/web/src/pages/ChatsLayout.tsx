import { useMemo, useState, useEffect } from 'react';
import { Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Loader2, Menu, Plus, Search, X } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import BlabberMark from '../components/brand/BlabberMark';
import BrandButton from '../components/ui/BrandButton';
import ChatList from '../components/ChatList';
import NewChatModal from '../components/NewChatModal';
import NewGroupModal from '../components/NewGroupModal';
import { useChats } from '../hooks/useChats';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../contexts/AuthContext';
import { apiClient, searchGlobalMessages } from '../api/client';
import type { MessageSearchResult } from '../api/client';
import type { Chat, User } from '@repo/types';

type SearchSelection =
  | { kind: 'conversation'; id: string; chat: Chat }
  | { kind: 'message'; id: string; result: MessageSearchResult };

export default function ChatsLayout() {
  const [showSidebar, setShowSidebar] = useState(false); // mobile overlay
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false); // desktop collapse
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  // The sidebar hands the Groups intent over via ?filter=groups because other
  // pages navigate here from outside this layout — local state alone made the
  // first click land on the default Convo view. The param seeds and syncs the
  // filter; absence of the param leaves in-layout state untouched (so opening
  // a chat while in Groups view keeps the Groups list).
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const [chatFilter, setChatFilter] = useState<'all' | 'groups'>(
    filterParam === 'groups' ? 'groups' : 'all'
  );
  useEffect(() => {
    if (filterParam === 'groups') setChatFilter('groups');
    else if (filterParam === 'all') setChatFilter('all');
  }, [filterParam]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { data: chats = [], isLoading, error, refetch, isFetching } = useChats();

  // Bootstrap theme class on mount so the stored preference applies immediately
  useTheme();

  // Close mobile sidebar on resize to desktop
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setShowSidebar(false);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const participantIds = useMemo(() => {
    const ids = new Set<string>();
    chats.forEach((chat) => {
      chat.participants.forEach((participantId) => {
        if (participantId !== currentUser?._id) ids.add(participantId);
      });
    });
    return Array.from(ids);
  }, [chats, currentUser?._id]);

  const participantQueries = useQueries({
    queries: participantIds.map((participantId) => ({
      queryKey: ['users', participantId] as const,
      queryFn: async () => {
        const { data } = await apiClient.get<{ user: User }>(`/api/users/${participantId}`);
        return data.user;
      },
      staleTime: 60_000,
    })),
  });

  const participantSearchText = useMemo(() => {
    const byId = new Map<string, string>();
    participantQueries.forEach((query, index) => {
      const participant = query.data;
      if (!participant) return;
      byId.set(
        participantIds[index],
        [participant.name, participant.username, participant.email].filter(Boolean).join(' ')
      );
    });
    return byId;
  }, [participantIds, participantQueries]);

  const trimmedSearchQuery = searchQuery.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchQuery(trimmedSearchQuery), 250);
    return () => window.clearTimeout(timer);
  }, [trimmedSearchQuery]);

  const filteredChats = useMemo(() => {
    if (!trimmedSearchQuery) return chats;
    const q = trimmedSearchQuery.toLowerCase();
    return chats.filter((chat) => {
      const participantText = chat.participants
        .map((participantId) => participantSearchText.get(participantId) || '')
        .join(' ');
      return [chat.title, chat.lastMessageRef?.body, participantText]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(q));
    });
  }, [chats, participantSearchText, trimmedSearchQuery]);

  const visibleChats = useMemo(() => {
    if (chatFilter === 'groups') {
      return filteredChats.filter((chat) => chat.type === 'group');
    }
    return filteredChats;
  }, [chatFilter, filteredChats]);

  const hasGroups = useMemo(() => chats.some((chat) => chat.type === 'group'), [chats]);
  const messageSearchQuery = debouncedSearchQuery.length >= 2 ? debouncedSearchQuery : '';
  const messageSearch = useQuery({
    queryKey: ['chat-dashboard', 'message-search', messageSearchQuery],
    queryFn: () => searchGlobalMessages({ q: messageSearchQuery, limit: 8 }),
    enabled: Boolean(messageSearchQuery),
    staleTime: 15_000,
  });

  const searchSelections = useMemo<SearchSelection[]>(() => {
    if (!trimmedSearchQuery) return [];
    return [
      ...visibleChats.map((chat) => ({
        kind: 'conversation' as const,
        id: `chat:${chat._id}`,
        chat,
      })),
      ...(messageSearch.data?.results ?? []).map((result) => ({
        kind: 'message' as const,
        id: `message:${result.messageId}`,
        result,
      })),
    ];
  }, [messageSearch.data?.results, trimmedSearchQuery, visibleChats]);

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [trimmedSearchQuery, messageSearch.data?.results]);

  const openSearchSelection = (selection: SearchSelection | undefined) => {
    if (!selection) return;
    if (selection.kind === 'conversation') {
      navigate(`/chats/${selection.chat._id}`);
    } else {
      navigate(`/chats/${selection.result.chatId}?message=${encodeURIComponent(selection.result.messageId)}`);
    }
    setShowSidebar(false);
  };

  return (
    <ErrorBoundary>
      <div className="flex h-dvh overflow-hidden bg-[#f6faf8] text-slate-900 dark:bg-[#071315] dark:text-white">
        {/* Mobile backdrop */}
        <div
          className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
            showSidebar ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={() => setShowSidebar(false)}
          aria-hidden="true"
        />

        {/* Sidebar — mobile: fixed overlay, desktop: flex item */}
        <div
          className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${
            showSidebar ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ height: '100%' }}
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((c) => !c)}
            onNewConversation={() => setIsNewChatModalOpen(true)}
            onNewGroup={() => setIsNewGroupModalOpen(true)}
            activeChatFilter={chatFilter}
            onChatFilterChange={setChatFilter}
            onNavigateMobile={() => setShowSidebar(false)}
            taskCount={0}
          />
        </div>

        {/* Main content column */}
        <div className="flex min-h-0 min-w-0 w-full flex-1 basis-0 gap-0 p-0 md:gap-3 md:p-3">
          {/* Chat list panel */}
          <section className={`${id ? 'hidden md:flex' : 'flex'} w-full flex-col overflow-hidden border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-sm md:w-[340px] md:flex-[0_0_340px] md:rounded-2xl`}>
            <div className="space-y-3 border-b border-[color:var(--bl-border)] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Mobile hamburger */}
                  <button
                    onClick={() => setShowSidebar(true)}
                    className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden"
                    aria-label="Open navigation"
                  >
                    <Menu size={16} />
                  </button>
                  <h2 className="text-[22px] font-semibold tracking-tight text-slate-900 dark:text-white">
                    Conversations
                  </h2>
                </div>
              </div>
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSearchQuery('');
                      return;
                    }
                    if (!trimmedSearchQuery) return;
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setActiveSearchIndex((index) =>
                        Math.min(index + 1, Math.max(searchSelections.length - 1, 0))
                      );
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setActiveSearchIndex((index) => Math.max(index - 1, 0));
                    } else if (event.key === 'Enter') {
                      event.preventDefault();
                      openSearchSelection(searchSelections[activeSearchIndex]);
                    }
                  }}
                  className="w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] py-2.5 pl-9 pr-11 text-sm text-[color:var(--bl-text)] outline-none transition placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400 focus:bg-[color:var(--bl-panel)] focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-500/20"
                  placeholder="Search convos and messages"
                />
                {trimmedSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-white"
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading conversations...</p>
              ) : error ? (
                <div className="p-4">
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/30">
                    <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                      Could not load conversations
                    </p>
                    <p className="mt-1 text-sm text-rose-600/80 dark:text-rose-200/80">
                      Check your connection and try again.
                    </p>
                    <button
                      type="button"
                      onClick={() => refetch()}
                      disabled={isFetching}
                      className="mt-3 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
                    >
                      {isFetching ? 'Retrying...' : 'Retry'}
                    </button>
                  </div>
                </div>
              ) : trimmedSearchQuery ? (
                <CombinedSearchResults
                  query={trimmedSearchQuery}
                  conversations={visibleChats}
                  messages={messageSearch.data?.results ?? []}
                  isLoadingMessages={messageSearch.isFetching}
                  isMessageSearchEnabled={trimmedSearchQuery.length >= 2}
                  isError={messageSearch.isError}
                  activeIndex={activeSearchIndex}
                  onOpen={openSearchSelection}
                  participantSearchText={participantSearchText}
                />
              ) : chatFilter === 'groups' && !hasGroups ? (
                <div className="flex h-56 flex-col items-center justify-center px-6 text-center">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">No groups yet</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Use New Convo to create a group with people you can message.
                  </p>
                </div>
              ) : (
                <ChatList chats={visibleChats} />
              )}
            </div>
          </section>

          {/* Chat view / empty state */}
          <section className={`${id ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 w-full flex-1 basis-0 overflow-hidden border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-sm md:rounded-2xl`}>
            {id ? (
              <div className="flex min-h-0 min-w-0 w-full flex-1">
                <Outlet />
              </div>
            ) : (
              <EmptyState onStartConversation={() => setIsNewChatModalOpen(true)} />
            )}
          </section>
        </div>

        <NewChatModal
          isOpen={isNewChatModalOpen}
          onClose={() => setIsNewChatModalOpen(false)}
          onOpenNewGroup={() => {
            setIsNewChatModalOpen(false);
            setIsNewGroupModalOpen(true);
          }}
        />
        <NewGroupModal isOpen={isNewGroupModalOpen} onClose={() => setIsNewGroupModalOpen(false)} />
      </div>
    </ErrorBoundary>
  );
}

// ── Empty / no-chat-selected state ──────────────────────────────────────────

function CombinedSearchResults({
  query,
  conversations,
  messages,
  isLoadingMessages,
  isMessageSearchEnabled,
  isError,
  activeIndex,
  onOpen,
  participantSearchText,
}: {
  query: string;
  conversations: Chat[];
  messages: MessageSearchResult[];
  isLoadingMessages: boolean;
  isMessageSearchEnabled: boolean;
  isError: boolean;
  activeIndex: number;
  onOpen: (selection: SearchSelection) => void;
  participantSearchText: Map<string, string>;
}) {
  const selections: SearchSelection[] = [
    ...conversations.map((chat) => ({ kind: 'conversation' as const, id: `chat:${chat._id}`, chat })),
    ...messages.map((result) => ({ kind: 'message' as const, id: `message:${result.messageId}`, result })),
  ];
  const hasResults = conversations.length > 0 || messages.length > 0;

  const conversationTitle = (chat: Chat) => {
    if (chat.title) return chat.title;
    const participantNames = chat.participants
      .map((participantId) => participantSearchText.get(participantId))
      .filter(Boolean);
    return participantNames.join(', ') || (chat.type === 'group' ? 'Group chat' : 'Direct chat');
  };

  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      <section className="py-2">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
          Conversations
        </div>
        {conversations.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
            No conversations found
          </p>
        ) : (
          conversations.map((chat) => {
            const index = selections.findIndex((selection) => selection.id === `chat:${chat._id}`);
            return (
              <button
                key={chat._id}
                type="button"
                aria-selected={index === activeIndex}
                onClick={() => onOpen({ kind: 'conversation', id: `chat:${chat._id}`, chat })}
                className={`w-full px-4 py-3 text-left transition ${
                  index === activeIndex
                    ? 'bg-teal-50 dark:bg-teal-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {conversationTitle(chat)}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  {chat.lastMessageRef?.body || (chat.type === 'group' ? 'Group conversation' : 'Direct conversation')}
                </p>
              </button>
            );
          })
        )}
      </section>

      <section className="py-2">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
            Messages
          </span>
          {isLoadingMessages && <Loader2 size={14} className="animate-spin text-slate-400" />}
        </div>
        {!isMessageSearchEnabled ? (
          <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
            Type at least 2 characters to search messages.
          </p>
        ) : isError ? (
          <p className="px-4 py-3 text-sm text-rose-600 dark:text-rose-300">
            Message search is unavailable. Try again.
          </p>
        ) : messages.length === 0 && !isLoadingMessages ? (
          <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
            No messages found
          </p>
        ) : (
          messages.map((result) => {
            const index = selections.findIndex(
              (selection) => selection.id === `message:${result.messageId}`
            );
            return (
              <button
                key={result.messageId}
                type="button"
                aria-selected={index === activeIndex}
                onClick={() => onOpen({ kind: 'message', id: `message:${result.messageId}`, result })}
                className={`w-full px-4 py-3 text-left transition ${
                  index === activeIndex
                    ? 'bg-teal-50 dark:bg-teal-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {result.senderDisplayName || 'Message'}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                  {result.snippet || result.attachmentLabel || `Result for ${query}`}
                </p>
              </button>
            );
          })
        )}
      </section>

      {!hasResults && !isLoadingMessages && isMessageSearchEnabled && (
        <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          No results found
        </p>
      )}
    </div>
  );
}

function EmptyState({ onStartConversation }: { onStartConversation: () => void }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto bg-white px-6 py-12 dark:bg-slate-900">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 hidden h-80 dark:block"
        style={{ background: 'radial-gradient(55% 100% at 50% 0%, rgba(47,92,214,0.16) 0%, rgba(47,92,214,0) 70%)' }}
      />
      <div className="relative mx-auto w-full max-w-lg text-center">
        <BlabberMark size={80} variant="icon" className="mx-auto mb-8" alive />

        <h3 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Discover, share, make it happen.
        </h3>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">
          AI-first social conversations that help you find ideas, share them with your people, and turn them into real
          plans.
        </p>
        <BrandButton variant="primary" onClick={onStartConversation} className="mx-auto mt-6">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Start a conversation
        </BrandButton>
      </div>
    </div>
  );
}
