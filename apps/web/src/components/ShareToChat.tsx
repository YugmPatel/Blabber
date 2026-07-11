import { useState } from 'react';
import { Loader2, Send, Share2, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { useChats } from '@/hooks/useChats';
import type { Chat } from '@repo/types';

type ChatListItem = Chat & { name?: string; displayName?: string };

export interface ShareableItem {
  type: 'post' | 'reel';
  id: string;
}

const FALLBACK_BODY: Record<ShareableItem['type'], string> = {
  post: 'Shared a post',
  reel: 'Shared a reel',
};

/**
 * Share button + inline conversation picker. Sends only `{ type, id }` —
 * the server resolves and verifies the real caption/author/thumbnail from
 * the source post/reel and stores it as rich `sharedItem` metadata, the same
 * way `mediaId` is resolved into `media` for attachments. The plain-text
 * body is a fallback only (chat-list previews, notifications, and clients
 * that don't recognize `sharedItem`).
 */
export function ShareToChatPanel({
  item,
  onClose,
  successLabel = 'Shared',
}: {
  item: ShareableItem;
  onClose: () => void;
  successLabel?: string;
}) {
  const [sharedChatId, setSharedChatId] = useState<string | null>(null);
  const chats = useChats({ archived: false, limit: 50 });

  const share = useMutation({
    mutationFn: async (chatId: string) => {
      await apiClient.post(`/api/messages/${chatId}`, {
        body: FALLBACK_BODY[item.type],
        type: 'text',
        sharedItem: item,
      });
      return chatId;
    },
    onSuccess: (chatId) => {
      setSharedChatId(chatId);
      window.setTimeout(() => {
        setSharedChatId(null);
        onClose();
      }, 1200);
    },
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/95">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">Share to conversation</p>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-200/60 dark:hover:bg-slate-700"
          aria-label="Close share"
        >
          <X size={15} />
        </button>
      </div>
      <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto">
        {((chats.data || []) as ChatListItem[]).slice(0, 12).map((chat) => {
          const chatId = chat._id;
          const isShared = sharedChatId === chatId;
          return (
            <button
              key={chatId}
              onClick={() => share.mutate(chatId)}
              disabled={share.isPending || Boolean(sharedChatId)}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 transition hover:border-teal-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              <span className="truncate">{chat.name || chat.displayName || chat.title || 'Conversation'}</span>
              {isShared ? (
                <span className="text-xs font-semibold text-teal-600 dark:text-teal-300">{successLabel}</span>
              ) : share.isPending ? (
                <Loader2 size={14} className="animate-spin text-slate-400" />
              ) : (
                <Send size={14} className="text-teal-600 dark:text-teal-300" />
              )}
            </button>
          );
        })}
        {!chats.isLoading && (chats.data || []).length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No conversations available.</p>
        )}
      </div>
      {share.isError && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
          {(share.error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
            'Unable to share. Please try again.'}
        </p>
      )}
    </div>
  );
}

export default function ShareToChat({ item, successLabel }: { item: ShareableItem; successLabel?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-teal-500/60 dark:hover:text-teal-300"
      >
        <Share2 size={15} /> Share
      </button>
      {open && (
        <div className="mt-3">
          <ShareToChatPanel item={item} onClose={() => setOpen(false)} successLabel={successLabel} />
        </div>
      )}
    </div>
  );
}
