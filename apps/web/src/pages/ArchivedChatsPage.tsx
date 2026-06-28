import { useNavigate } from 'react-router-dom';
import { ArchiveRestore, MessageSquare } from 'lucide-react';
import { useChats, useUnarchiveChat } from '@/hooks/useChats';

export default function ArchivedChatsPage() {
  const navigate = useNavigate();
  const { data: chats = [], isLoading } = useChats({ archived: true });
  const unarchive = useUnarchiveChat();

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <header className="border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold">Archived</h1>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading archived chats...</p>
        ) : chats.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center text-slate-500 dark:text-slate-400">
            <MessageSquare size={28} />
            <p className="mt-3 text-sm font-medium">No archived chats</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {chats.map((chat) => (
              <div key={chat._id} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => navigate(`/chats/${chat._id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold">{chat.title || (chat.type === 'group' ? 'Group chat' : 'Direct chat')}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {chat.lastMessageRef?.body || 'No messages yet'}
                  </p>
                </button>
                {chat.unreadCount ? (
                  <span className="rounded-full bg-teal-500 px-2 py-0.5 text-xs font-bold text-white">{chat.unreadCount}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => unarchive.mutate(chat._id)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  aria-label="Unarchive chat"
                >
                  <ArchiveRestore size={17} />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
