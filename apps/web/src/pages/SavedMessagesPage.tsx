import { useNavigate } from 'react-router-dom';
import { Bookmark, ExternalLink, Trash2 } from 'lucide-react';
import { useSavedMessages, useUnsaveMessage } from '@/hooks/useMessages';
import { sourceJumpPath } from '@/lib/source-jump';

export default function SavedMessagesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useSavedMessages();
  const unsave = useUnsaveMessage();
  const savedMessages = data?.savedMessages || [];

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <header className="border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold">Saved Messages</h1>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading saved messages...</p>
        ) : savedMessages.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center text-slate-500 dark:text-slate-400">
            <Bookmark size={28} />
            <p className="mt-3 text-sm font-medium">No saved messages</p>
          </div>
        ) : (
          <div className="space-y-2">
            {savedMessages.map((item) => (
              <article key={item.id || item.messageId} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{item.chatTitle || 'Chat'}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {item.preview?.senderDisplayName || 'Original message unavailable'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(item.savedAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-slate-700 dark:text-slate-200">
                  {item.available ? item.preview?.snippet || item.preview?.attachmentLabel || 'Message' : 'Original message unavailable'}
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  {item.available && (
                    <>
                      <button
                        type="button"
                        onClick={() => navigate(`/chats/${item.chatId}`)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Open chat
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(sourceJumpPath({ chatId: item.chatId, messageId: item.messageId }))}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-950"
                      >
                        <ExternalLink size={13} /> Jump
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => unsave.mutate(item.messageId)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
