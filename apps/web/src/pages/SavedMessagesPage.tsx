import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bookmark, ExternalLink, MessageSquare, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSavedPosts, normalizeMediaUrl, unsavePost } from '@/api/client';
import { useSavedMessages, useUnsaveMessage } from '@/hooks/useMessages';
import { sourceJumpPath } from '@/lib/source-jump';
import type { FeedPost } from '@/api/client';

type SavedTab = 'messages' | 'posts';

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function SavedPostPreview({ post }: { post: FeedPost }) {
  const first = post.media[0];
  return (
    <div className="flex items-start gap-3">
      {first ? (
        <img src={normalizeMediaUrl(first.url)} alt="" className="h-16 w-16 rounded-lg bg-slate-100 object-cover dark:bg-slate-800" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800">
          <Bookmark size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{post.author.name}</p>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{post.body || 'Saved post'}</p>
      </div>
    </div>
  );
}

export function SavedContentSection({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SavedTab>('messages');
  const [editingMessages, setEditingMessages] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(() => new Set());
  const messagesQuery = useSavedMessages();
  const postsQuery = useQuery({ queryKey: ['saved-posts'], queryFn: () => fetchSavedPosts() });
  const unsaveMessage = useUnsaveMessage();
  const removePost = useMutation({
    mutationFn: unsavePost,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-posts'] }),
  });
  const savedMessages = messagesQuery.data?.savedMessages || [];
  const groupedMessages = useMemo(() => {
    const groups = new Map<string, typeof savedMessages>();
    for (const item of savedMessages) {
      const key = item.chatTitle || 'Conversation';
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return Array.from(groups.entries());
  }, [savedMessages]);
  const toggleMessage = (messageId: string) => {
    setSelectedMessages((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };
  const removeSelectedMessages = async () => {
    for (const messageId of selectedMessages) {
      await unsaveMessage.mutateAsync(messageId);
    }
    setSelectedMessages(new Set());
    setEditingMessages(false);
  };

  return (
    <div className={embedded ? 'space-y-5' : 'flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white'}>
      <header className={embedded ? '' : 'border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900'}>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate('/settings?s=profile')}
            className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ArrowLeft size={15} /> Back to Profile
          </button>
          <h1 className="text-xl font-semibold">Saved</h1>
          {tab === 'messages' ? (
            <button
              type="button"
              onClick={() => {
                setEditingMessages((value) => !value);
                setSelectedMessages(new Set());
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700"
            >
              {editingMessages ? 'Cancel' : 'Edit'}
            </button>
          ) : <span className="w-16" />}
        </div>
      </header>
      <main className={embedded ? 'space-y-4' : 'mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-4'}>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm dark:border-slate-800 dark:bg-slate-900">
          <button onClick={() => setTab('messages')} className={`rounded-md px-3 py-1.5 ${tab === 'messages' ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 dark:text-slate-300'}`}>Saved messages</button>
          <button onClick={() => setTab('posts')} className={`rounded-md px-3 py-1.5 ${tab === 'posts' ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 dark:text-slate-300'}`}>Saved posts</button>
        </div>

        {tab === 'messages' && (
          <section className="space-y-3">
            {editingMessages && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
                <span>{selectedMessages.size} selected</span>
                <button
                  type="button"
                  onClick={() => void removeSelectedMessages()}
                  disabled={selectedMessages.size === 0 || unsaveMessage.isPending}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Remove from saved
                </button>
              </div>
            )}
            {messagesQuery.isLoading ? (
              <p className="py-10 text-center text-sm text-slate-500">Loading saved messages...</p>
            ) : savedMessages.length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                <MessageSquare size={28} />
                <p className="mt-3 text-sm font-medium">No saved messages.</p>
              </div>
            ) : groupedMessages.map(([title, items]) => (
              <div key={title} className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold dark:border-slate-800">{title}</h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((item) => (
                    <article key={item.id || item.messageId} className="flex items-start gap-3 px-4 py-3">
                      {editingMessages && (
                        <input
                          type="checkbox"
                          checked={selectedMessages.has(item.messageId)}
                          onChange={() => toggleMessage(item.messageId)}
                          className="mt-1 h-4 w-4 accent-teal-600"
                          aria-label="Select saved message"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold">{item.preview?.senderDisplayName || 'Message'}</p>
                          <span className="shrink-0 text-xs text-slate-500">{formatDate(item.savedAt)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                          {item.available ? item.preview?.snippet || item.preview?.attachmentLabel || 'Message' : 'This saved message is no longer available.'}
                        </p>
                        {!editingMessages && (
                          <div className="mt-3 flex justify-end gap-2">
                            {item.available && (
                              <button
                                type="button"
                                onClick={() => navigate(sourceJumpPath({ chatId: item.chatId, messageId: item.messageId }))}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-950"
                              >
                                <ExternalLink size={13} /> Jump to message
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => unsaveMessage.mutate(item.messageId)}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
                            >
                              <Trash2 size={13} /> Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {tab === 'posts' && (
          <section className="space-y-3">
            {postsQuery.isLoading ? (
              <p className="py-10 text-center text-sm text-slate-500">Loading saved posts...</p>
            ) : (postsQuery.data?.savedPosts || []).length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                <Bookmark size={28} />
                <p className="mt-3 text-sm font-medium">No saved posts.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {postsQuery.data!.savedPosts.map(({ savedAt, post }) => (
                  <article key={post.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-start justify-between gap-3">
                      <SavedPostPreview post={post} />
                      <span className="shrink-0 text-xs text-slate-500">{formatDate(savedAt)}</span>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <button onClick={() => navigate(`/feed?post=${post.id}`)} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-slate-950">Open post</button>
                      <button onClick={() => removePost.mutate(post.id)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30">Remove saved</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default function SavedMessagesPage() {
  return <SavedContentSection />;
}
