import { useMemo, useState, useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Menu, Plus, Search, Sparkles, CheckSquare2, Brain } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import ChatList from '../components/ChatList';
import NewChatModal from '../components/NewChatModal';
import NewGroupModal from '../components/NewGroupModal';
import { useChats } from '../hooks/useChats';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useTheme } from '../hooks/useTheme';

export default function ChatsLayout() {
  const [showSidebar, setShowSidebar] = useState(false); // mobile overlay
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false); // desktop collapse
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { id } = useParams();
  const { data: chats = [], isLoading, error } = useChats();

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

  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats;
    const q = searchQuery.toLowerCase();
    return chats.filter(
      (chat) =>
        chat.title?.toLowerCase().includes(q) ||
        chat.lastMessageRef?.body?.toLowerCase().includes(q) ||
        chat.type.toLowerCase().includes(q)
    );
  }, [chats, searchQuery]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden bg-[#f4f5f7] text-slate-900 dark:bg-slate-950 dark:text-white">
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
            onNavigateMobile={() => setShowSidebar(false)}
            taskCount={0}
          />
        </div>

        {/* Main content column */}
        <div className="flex min-w-0 flex-1">
          {/* Chat list panel */}
          <section className="flex w-full max-w-[340px] flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 md:w-[340px]">
            <div className="space-y-3 border-b border-slate-200 p-4 dark:border-slate-700">
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
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Messages</h2>
                </div>
                <button
                  onClick={() => setIsNewChatModalOpen(true)}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  aria-label="Start new chat"
                  title="New conversation"
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-teal-500 dark:focus:bg-slate-800"
                  placeholder="Search conversations..."
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading chats...</p>
              ) : error ? (
                <p className="p-4 text-sm text-rose-500">Failed to load chats</p>
              ) : (
                <ChatList chats={filteredChats} />
              )}
            </div>
          </section>

          {/* Chat view / empty state */}
          <section className="min-w-0 flex-1">
            {id ? (
              <Outlet />
            ) : (
              <EmptyState
                onNewChat={() => setIsNewChatModalOpen(true)}
                onNewGroup={() => setIsNewGroupModalOpen(true)}
              />
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

function EmptyState({
  onNewChat,
  onNewGroup,
}: {
  onNewChat: () => void;
  onNewGroup: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-white px-6 py-12 dark:bg-slate-900">
      <div className="mx-auto w-full max-w-lg text-center">
        {/* Illustration placeholder */}
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-100 to-teal-50 dark:from-teal-900/40 dark:to-teal-800/20">
          <Sparkles size={32} className="text-teal-600 dark:text-teal-400" />
        </div>

        <h3 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Ready to turn noise into signal?
        </h3>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">
          Blabber is your AI-powered companion for group chats. Start a new conversation to see the
          magic happen.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={onNewChat}
            className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            + Start New Chat
          </button>
          <button
            onClick={onNewGroup}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Create Group
          </button>
        </div>

        {/* How it works */}
        <div className="mt-12 border-t border-slate-100 pt-10 dark:border-slate-800">
          <h4 className="mb-5 text-base font-semibold text-slate-900 dark:text-white">
            How Blabber works
          </h4>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: Sparkles,
                title: 'Smart Summaries',
                desc: 'AI condenses long threads into what matters in seconds.',
              },
              {
                icon: CheckSquare2,
                title: 'Task Extraction',
                desc: 'Capture action items and keep follow-through visible.',
              },
              {
                icon: Brain,
                title: 'Shared Memory',
                desc: 'Keep decisions and context searchable for the whole team.',
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-xl border border-slate-200 p-4 text-left dark:border-slate-700"
              >
                <card.icon size={16} className="mb-2 text-teal-600 dark:text-teal-400" />
                <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{card.title}</p>
                <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
