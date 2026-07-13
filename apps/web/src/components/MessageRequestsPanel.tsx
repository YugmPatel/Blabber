import { useState } from 'react';
import { X, Loader2, Check, ShieldOff, Flag } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptMessageRequest,
  blockUser,
  createReport,
  declineMessageRequest,
  fetchMessageRequestInbox,
  fetchSentMessageRequests,
  type MessageRequestWithRecipient,
  type MessageRequestWithSender,
} from '@/api/client';

type Tab = 'inbox' | 'sent';

const AVATAR_COLORS = ['bg-teal-600', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500', 'bg-emerald-600'];

function Avatar({ name, avatarUrl }: { name?: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="h-10 w-10 flex-shrink-0 rounded-full object-cover" />;
  }
  const initial = (name?.trim()[0] || '?').toUpperCase();
  const color = AVATAR_COLORS[initial.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${color}`}>
      {initial}
    </div>
  );
}

function InboxRow({ request, onOpenChat }: { request: MessageRequestWithSender; onOpenChat: (chatId: string) => void }) {
  const queryClient = useQueryClient();
  const [actionTaken, setActionTaken] = useState<'accepted' | 'declined' | 'blocked' | 'reported' | null>(null);

  const accept = useMutation({
    mutationFn: () => acceptMessageRequest(request.id),
    onSuccess: (data) => {
      setActionTaken('accepted');
      queryClient.invalidateQueries({ queryKey: ['message-requests', 'inbox'] });
      onOpenChat(data.chat._id);
    },
  });
  const decline = useMutation({
    mutationFn: () => declineMessageRequest(request.id),
    onSuccess: () => {
      setActionTaken('declined');
      queryClient.invalidateQueries({ queryKey: ['message-requests', 'inbox'] });
    },
  });
  const block = useMutation({
    mutationFn: () => blockUser(request.sender.id),
    onSuccess: () => {
      setActionTaken('blocked');
      queryClient.invalidateQueries({ queryKey: ['message-requests', 'inbox'] });
    },
  });
  const report = useMutation({
    mutationFn: () => createReport({ targetType: 'user', targetId: request.sender.id, reason: 'Reported from message request inbox' }),
    onSuccess: () => setActionTaken('reported'),
  });

  if (actionTaken === 'declined' || actionTaken === 'blocked') {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <div className="flex items-start gap-3">
        <Avatar name={request.sender.displayName} avatarUrl={request.sender.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-slate-900 dark:text-white">{request.sender.displayName}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">@{request.sender.username}</p>
          {request.introMessage && (
            <p className="mt-1 line-clamp-2 text-[13px] text-slate-600 dark:text-slate-300">{request.introMessage}</p>
          )}
        </div>
      </div>
      {actionTaken === 'reported' ? (
        <p className="text-xs font-medium text-teal-600 dark:text-teal-300">Report submitted.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => accept.mutate()}
            disabled={accept.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {accept.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Accept
          </button>
          <button
            onClick={() => decline.mutate()}
            disabled={decline.isPending}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Decline
          </button>
          <button
            onClick={() => block.mutate()}
            disabled={block.isPending}
            title="Block"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ShieldOff size={12} />
          </button>
          <button
            onClick={() => report.mutate()}
            disabled={report.isPending}
            title="Report"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Flag size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function SentRow({ request }: { request: MessageRequestWithRecipient }) {
  const statusLabel = request.status === 'pending' ? 'Pending' : request.status === 'accepted' ? 'Accepted' : 'Declined';
  const statusClasses =
    request.status === 'pending'
      ? 'text-amber-600 dark:text-amber-400'
      : request.status === 'accepted'
        ? 'text-teal-600 dark:text-teal-300'
        : 'text-slate-400 dark:text-slate-500';
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <Avatar name={request.recipient.displayName} avatarUrl={request.recipient.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-slate-900 dark:text-white">{request.recipient.displayName}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">@{request.recipient.username}</p>
      </div>
      <span className={`flex-shrink-0 text-xs font-semibold ${statusClasses}`}>{statusLabel}</span>
    </div>
  );
}

export default function MessageRequestsPanel({ onClose, onOpenChat }: { onClose: () => void; onOpenChat: (chatId: string) => void }) {
  const [tab, setTab] = useState<Tab>('inbox');
  const inbox = useQuery({ queryKey: ['message-requests', 'inbox'], queryFn: fetchMessageRequestInbox, enabled: tab === 'inbox' });
  const sent = useQuery({ queryKey: ['message-requests', 'sent'], queryFn: fetchSentMessageRequests, enabled: tab === 'sent' });

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-sm flex-col bg-white shadow-2xl dark:bg-slate-900 md:relative md:my-8 md:h-auto md:max-h-[80vh] md:rounded-2xl md:border md:border-slate-200 md:dark:border-slate-700"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-14 items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-700">
          <h2 className="flex-1 text-[15px] font-semibold text-slate-900 dark:text-white">Message requests</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-200 px-4 pt-2 dark:border-slate-700">
          {(['inbox', 'sent'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-t-lg px-3 py-2 text-sm font-semibold transition ${
                tab === value
                  ? 'border-b-2 border-teal-500 text-teal-700 dark:text-teal-300'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {value === 'inbox' ? 'Received' : 'Sent'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'inbox' ? (
            inbox.isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={22} className="animate-spin text-slate-400" />
              </div>
            ) : (inbox.data?.requests.length || 0) === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No requests</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">New message requests will appear here.</p>
              </div>
            ) : (
              inbox.data!.requests.map((request) => (
                <InboxRow key={request.id} request={request} onOpenChat={onOpenChat} />
              ))
            )
          ) : sent.isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={22} className="animate-spin text-slate-400" />
            </div>
          ) : (sent.data?.requests.length || 0) === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No sent requests</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Requests you send will appear here.</p>
            </div>
          ) : (
            sent.data!.requests.map((request) => <SentRow key={request.id} request={request} />)
          )}
        </div>
      </div>
    </div>
  );
}
