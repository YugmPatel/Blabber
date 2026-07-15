import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  Clapperboard,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  MessageSquare,
  Search,
  Trash2,
  Video,
  Volume2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAuthorizedObjectUrl, fetchSavedPosts, fetchSavedReels, reelPosterUrl, unsavePost, unsaveReel } from '@/api/client';
import { useSavedMessages, useUnsaveMessage } from '@/hooks/useMessages';
import { sourceJumpPath } from '@/lib/source-jump';
import type { FeedPost, SavedMessageItem } from '@/api/client';

type SavedTab = 'messages' | 'posts' | 'reels';

const JUMP_BTN =
  'inline-flex items-center gap-1.5 rounded-lg border border-teal-300 px-2.5 py-1.5 text-xs font-semibold text-teal-700 transition hover:bg-teal-50 dark:border-teal-500/50 dark:text-teal-300 dark:hover:bg-teal-500/10';
const REMOVE_BTN =
  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30';

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function SenderBadge({ name }: { name: string }) {
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 text-sm font-semibold text-white">
      {initial}
    </div>
  );
}

function SavedEmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Bookmark;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-center dark:border-slate-700 dark:bg-slate-800">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
        <Icon size={20} />
      </span>
      <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
    </div>
  );
}

function EndMarker({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-6 text-center">
      <Bookmark size={18} className="text-slate-300 dark:text-slate-600" />
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500">You've reached the end.</p>
    </div>
  );
}

function AuthorizedPreviewImage({
  src,
  alt,
  className,
  fallback,
}: {
  src?: string | null;
  alt: string;
  className: string;
  fallback: ReactNode;
}) {
  const [objectUrl, setObjectUrl] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) {
      setObjectUrl(undefined);
      setFailed(false);
      return undefined;
    }
    let active = true;
    let resolvedUrl: string | undefined;
    setFailed(false);
    fetchAuthorizedObjectUrl(src)
      .then((url) => {
        if (!active) {
          if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        resolvedUrl = url;
        setObjectUrl(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (resolvedUrl?.startsWith('blob:')) URL.revokeObjectURL(resolvedUrl);
    };
  }, [src]);

  if (!src || failed) return <>{fallback}</>;
  return objectUrl ? <img src={objectUrl} alt={alt} className={className} /> : <>{fallback}</>;
}

function SavedPostPreview({ post }: { post: FeedPost }) {
  const first = post.media[0];
  return (
    <div className="flex items-start gap-3">
      {first ? (
        <AuthorizedPreviewImage
          src={first.url}
          alt=""
          className="h-16 w-16 rounded-xl bg-slate-100 object-cover dark:bg-slate-700"
          fallback={(
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-700">
              <ImageIcon size={18} />
            </div>
          )}
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-700">
          <Bookmark size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{post.author.name}</p>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{post.body || 'Saved post'}</p>
      </div>
    </div>
  );
}

function SavedMessageMediaPreview({ media }: { media?: NonNullable<NonNullable<SavedMessageItem['preview']>['media']> }) {
  if (!media) return null;
  const mediaUrl = media.thumbnailUrl || media.url;
  if (media.type === 'image' && mediaUrl) {
    return (
      <AuthorizedPreviewImage
        src={mediaUrl}
        alt=""
        className="mt-2 h-20 w-28 rounded-xl bg-slate-100 object-cover dark:bg-slate-700"
        fallback={<MediaChip icon={ImageIcon} label="Image attachment" />}
      />
    );
  }
  const Icon = media.type === 'video' ? Video : media.type === 'audio' ? Volume2 : FileText;
  const label = media.fileName || (media.type === 'video' ? 'Video attachment' : media.type === 'audio' ? 'Audio attachment' : 'Document attachment');
  return <MediaChip icon={Icon} label={label} />;
}

function MediaChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      <Icon size={15} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
      <span className="truncate">{label}</span>
    </div>
  );
}

export function SavedContentSection({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SavedTab>('messages');
  const [searchQuery, setSearchQuery] = useState('');
  const [chatFilter, setChatFilter] = useState('all');
  const [editingMessages, setEditingMessages] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(() => new Set());
  const messagesQuery = useSavedMessages();
  const postsQuery = useQuery({ queryKey: ['saved-posts'], queryFn: () => fetchSavedPosts() });
  const reelsQuery = useInfiniteQuery({
    queryKey: ['saved-reels'],
    queryFn: ({ pageParam }) => fetchSavedReels(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const unsaveMessage = useUnsaveMessage();
  const removePost = useMutation({
    mutationFn: unsavePost,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-posts'] }),
  });
  const removeReel = useMutation({
    mutationFn: unsaveReel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-reels'] }),
  });

  const savedMessages = useMemo(() => messagesQuery.data?.savedMessages || [], [messagesQuery.data?.savedMessages]);
  const chatTitles = useMemo(
    () => Array.from(new Set(savedMessages.map((item) => item.chatTitle || 'Conversation'))),
    [savedMessages]
  );
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredMessages = savedMessages.filter((item) => {
    const title = item.chatTitle || 'Conversation';
    if (chatFilter !== 'all' && title !== chatFilter) return false;
    if (!normalizedSearch) return true;
    return [title, item.preview?.senderDisplayName, item.preview?.snippet, item.preview?.attachmentLabel]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedSearch));
  });
  const savedReels = (reelsQuery.data?.pages || []).flatMap((page) => page.reels);
  const savedPosts = postsQuery.data?.savedPosts || [];

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

  const tabs: Array<{ key: SavedTab; label: string }> = [
    { key: 'messages', label: 'Saved messages' },
    { key: 'posts', label: 'Saved posts' },
    { key: 'reels', label: 'Saved reels' },
  ];

  return (
    <div
      className={
        embedded ? 'space-y-5' : 'flex h-dvh flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white'
      }
    >
      <header className={embedded ? '' : 'border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900'}>
        {!embedded && (
          <button
            type="button"
            onClick={() => navigate('/settings?s=saved')}
            className="mb-2 inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ArrowLeft size={15} /> Back to Settings
          </button>
        )}
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Saved</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Review messages, posts, and content you saved.
        </p>
      </header>
      <main className={embedded ? 'space-y-4' : 'mx-auto w-full max-w-4xl flex-1 space-y-4 overflow-y-auto p-4'}>
        <div className="flex gap-6 border-b border-slate-200 dark:border-slate-700">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`relative pb-2.5 text-sm font-semibold transition ${
                tab === item.key
                  ? 'text-teal-700 dark:text-teal-300'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
              {tab === item.key && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-500" />}
            </button>
          ))}
        </div>

        {tab === 'messages' && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search saved messages"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
                />
              </div>
              <div className="relative">
                <select
                  value={chatFilter}
                  aria-label="Filter by chat"
                  onChange={(e) => setChatFilter(e.target.value)}
                  className="appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-8 text-[13px] font-medium text-slate-800 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="all">All chats</option>
                  {chatTitles.map((title) => (
                    <option key={title} value={title}>
                      {title}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
              </div>
              {savedMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingMessages((value) => !value);
                    setSelectedMessages(new Set());
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/60"
                >
                  {editingMessages ? 'Cancel' : 'Edit'}
                </button>
              )}
            </div>
            {editingMessages && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800">
                <span className="text-slate-600 dark:text-slate-300">{selectedMessages.size} selected</span>
                <button
                  type="button"
                  onClick={() => void removeSelectedMessages()}
                  disabled={selectedMessages.size === 0 || unsaveMessage.isPending}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
                >
                  Remove from saved
                </button>
              </div>
            )}
            {messagesQuery.isLoading ? (
              <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading saved messages…</p>
            ) : savedMessages.length === 0 ? (
              <SavedEmptyState
                icon={MessageSquare}
                title="No saved messages yet"
                subtitle="Messages you save from chats will appear here."
              />
            ) : filteredMessages.length === 0 ? (
              <SavedEmptyState
                icon={Search}
                title="No matches"
                subtitle="Try another search term or chat filter."
              />
            ) : (
              <>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  {filteredMessages.map((item, index) => (
                    <article
                      key={item.id || item.messageId}
                      className={`flex items-start gap-3 px-4 py-3.5 ${
                        index < filteredMessages.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
                      }`}
                    >
                      {editingMessages && (
                        <input
                          type="checkbox"
                          checked={selectedMessages.has(item.messageId)}
                          onChange={() => toggleMessage(item.messageId)}
                          className="mt-3 h-4 w-4 accent-teal-600"
                          aria-label="Select saved message"
                        />
                      )}
                      <SenderBadge name={item.preview?.senderDisplayName || item.chatTitle || 'M'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                          {item.chatTitle || 'Conversation'}
                        </p>
	                        <p className="mt-0.5 line-clamp-2 text-[13px] text-slate-600 dark:text-slate-300">
                          {item.available
                            ? `${item.preview?.senderDisplayName || 'Message'}: ${
                                item.preview?.snippet || item.preview?.attachmentLabel || 'Message'
                              }`
	                            : 'This saved message is no longer available.'}
	                        </p>
	                        {item.available && <SavedMessageMediaPreview media={item.preview?.media} />}
	                        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{formatDate(item.savedAt)}</p>
                      </div>
                      {!editingMessages && (
                        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                          {item.available && (
                            <button
                              type="button"
                              onClick={() => navigate(sourceJumpPath({ chatId: item.chatId, messageId: item.messageId }))}
                              className={JUMP_BTN}
                            >
                              <ExternalLink size={13} /> Jump to original
                            </button>
                          )}
                          <button type="button" onClick={() => unsaveMessage.mutate(item.messageId)} className={REMOVE_BTN}>
                            <Trash2 size={13} /> Remove
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
                <EndMarker label="No more saved messages" />
              </>
            )}
          </section>
        )}

        {tab === 'posts' && (
          <section className="space-y-3">
            {postsQuery.isLoading ? (
              <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading saved posts…</p>
            ) : savedPosts.length === 0 ? (
              <SavedEmptyState
                icon={Bookmark}
                title="No saved posts yet"
                subtitle="Posts you save from the feed will appear here."
              />
            ) : (
              <div className="grid gap-3">
                {savedPosts.map(({ savedAt, post }) => (
                  <article
                    key={post.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <SavedPostPreview post={post} />
                      <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{formatDate(savedAt)}</span>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
	                      <button onClick={() => navigate(`/posts/${post.id}`)} className={JUMP_BTN}>
	                        <ExternalLink size={13} /> Jump to original
                      </button>
                      <button onClick={() => removePost.mutate(post.id)} className={REMOVE_BTN}>
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'reels' && (
          <section className="space-y-3">
            {reelsQuery.isLoading ? (
              <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading saved reels…</p>
            ) : savedReels.length === 0 ? (
              <SavedEmptyState
                icon={Clapperboard}
                title="No saved reels yet"
                subtitle="Reels you save will appear here."
              />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {savedReels.map((reel) => (
                    <article
                      key={reel.id}
                      className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
                    >
	                      <AuthorizedPreviewImage
	                        src={reel.thumbnailUrl || reel.posterUrl || reelPosterUrl(reel.id)}
	                        alt=""
	                        className="aspect-video w-full bg-slate-100 object-cover dark:bg-slate-900"
	                        fallback={(
	                          <div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 dark:from-teal-500/10 dark:to-slate-900">
	                            <Film size={24} className="text-teal-600/60 dark:text-teal-300/50" />
	                          </div>
	                        )}
	                      />
                      <div className="flex flex-1 flex-col gap-1 p-3.5">
                        <p className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-white">
                          {reel.caption || 'Reel'}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {reel.author?.name || 'Unknown creator'}
                          {reel.publishedAt || reel.createdAt
                            ? ` · ${formatDate(reel.publishedAt || reel.createdAt)}`
                            : ''}
                        </p>
                        <div className="mt-2 flex justify-end gap-2">
                          <button onClick={() => navigate(`/reels/${reel.id}`)} className={JUMP_BTN}>
                            <ExternalLink size={13} /> Jump to original
                          </button>
                          <button
                            onClick={() => removeReel.mutate(reel.id)}
                            disabled={removeReel.isPending}
                            className={REMOVE_BTN}
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                {reelsQuery.hasNextPage && (
                  <button
                    onClick={() => reelsQuery.fetchNextPage()}
                    disabled={reelsQuery.isFetchingNextPage}
                    className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/60"
                  >
                    {reelsQuery.isFetchingNextPage ? 'Loading…' : 'Show more reels'}
                  </button>
                )}
              </>
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
