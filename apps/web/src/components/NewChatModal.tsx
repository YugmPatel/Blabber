import { useEffect, useRef, useState } from 'react';
import {
  X,
  Search,
  Loader2,
  Users,
  ArrowLeft,
  ChevronRight,
  Check,
  Copy,
  Inbox,
  Link2,
  ShieldOff,
  Flag,
  BadgeCheck,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  apiClient,
  blockUser,
  createProfileInvite,
  createReport,
  fetchMessageRequestInbox,
  fetchMyDiscoveryInfo,
  searchUsers,
  sendMessageRequest,
  type UserSearchResult,
} from '@/api/client';
import { chatKeys, useChats } from '@/hooks/useChats';
import { useAuth } from '@/contexts/AuthContext';
import MessageRequestsPanel from './MessageRequestsPanel';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenNewGroup?: () => void;
}

const SEARCH_MIN_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

function initialFor(name?: string) {
  return (name?.trim()[0] || '?').toUpperCase();
}

const AVATAR_COLORS = ['bg-teal-600', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500', 'bg-emerald-600'];

function InitialAvatar({ name, avatarUrl, size = 40 }: { name: string; avatarUrl?: string; size?: number }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="flex-shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = initialFor(name);
  const color = AVATAR_COLORS[initial.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${color}`}
      style={{ width: size, height: size }}
    >
      {initial}
    </div>
  );
}

function CopyRow({ icon: Icon, label, value, onCreateIfMissing }: {
  icon: typeof Link2;
  label: string;
  value: string | null | undefined;
  onCreateIfMissing?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    if (!value) {
      onCreateIfMissing?.();
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied — nothing more we can safely do here.
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1 text-[13px] font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {copied ? (
        <span className="flex-shrink-0 text-xs font-semibold text-teal-600 dark:text-teal-300">Copied</span>
      ) : (
        <Copy size={14} className="flex-shrink-0 text-slate-400" />
      )}
    </button>
  );
}

function UserPreviewModal({ user, onClose, onMessage, onRequest, isRequesting }: {
  user: UserSearchResult;
  onClose: () => void;
  onMessage: (userId: string) => void;
  onRequest: (userId: string, intro: string) => void;
  isRequesting: boolean;
}) {
  const [intro, setIntro] = useState('');
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const block = useMutation({
    mutationFn: () => blockUser(user.id),
    onSuccess: () => {
      setNotice('User blocked.');
      setShowBlockConfirm(false);
    },
  });
  const report = useMutation({
    mutationFn: () => createReport({ targetType: 'user', targetId: user.id, reason: 'Reported from New Convo search' }),
    onSuccess: () => setNotice('Report submitted.'),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <InitialAvatar name={user.displayName} avatarUrl={user.avatarUrl} size={56} />
            <div className="min-w-0">
              <p className="flex items-center gap-1 truncate text-[15px] font-semibold text-slate-900 dark:text-white">
                {user.displayName}
                {user.isVerified && <BadgeCheck size={14} className="flex-shrink-0 text-teal-500" />}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">@{user.username}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {user.bioPreview && (
          <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{user.bioPreview}</p>
        )}

        {notice && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {notice}
          </p>
        )}

        <div className="mt-4 space-y-2">
          {user.canMessage && (
            <button
              onClick={() => onMessage(user.id)}
              className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700"
            >
              Message
            </button>
          )}
          {!user.canMessage && user.requiresMessageRequest && (
            <div className="space-y-2">
              <textarea
                value={intro}
                onChange={(event) => setIntro(event.target.value)}
                placeholder="Add a short intro message (optional)"
                maxLength={300}
                rows={2}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <button
                onClick={() => onRequest(user.id, intro)}
                disabled={isRequesting}
                className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
              >
                {isRequesting ? 'Sending request...' : 'Send message request'}
              </button>
            </div>
          )}
          {user.relationshipStatus === 'pending_sent' && (
            <div className="rounded-xl border border-slate-200 py-2.5 text-center text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Request pending
            </div>
          )}
          {!user.canMessage && !user.requiresMessageRequest && user.relationshipStatus !== 'pending_sent' && (
            <div className="rounded-xl border border-slate-200 py-2.5 text-center text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Not accepting messages
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {showBlockConfirm ? (
              <>
                <button
                  onClick={() => block.mutate()}
                  disabled={block.isPending}
                  className="flex-1 rounded-xl bg-rose-600 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  Confirm block
                </button>
                <button
                  onClick={() => setShowBlockConfirm(false)}
                  className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowBlockConfirm(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60"
                >
                  <ShieldOff size={13} /> Block
                </button>
                <button
                  onClick={() => report.mutate()}
                  disabled={report.isPending}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60"
                >
                  <Flag size={13} /> Report
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultActionButton({
  user,
  onMessage,
  onOpenRequestComposer,
  isPending,
}: {
  user: UserSearchResult;
  onMessage: (userId: string) => void;
  onOpenRequestComposer: (user: UserSearchResult) => void;
  isPending: boolean;
}) {
  if (user.canMessage) {
    return (
      <button
        onClick={(event) => {
          event.stopPropagation();
          onMessage(user.id);
        }}
        disabled={isPending}
        className="flex-shrink-0 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
      >
        {isPending ? <Loader2 size={13} className="animate-spin" /> : 'Message'}
      </button>
    );
  }
  if (user.relationshipStatus === 'pending_sent') {
    return (
      <span className="flex-shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
        Pending
      </span>
    );
  }
  if (user.requiresMessageRequest) {
    return (
      <button
        onClick={(event) => {
          event.stopPropagation();
          onOpenRequestComposer(user);
        }}
        className="flex-shrink-0 rounded-lg border border-teal-500/40 px-3 py-1.5 text-xs font-semibold text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
      >
        Request
      </button>
    );
  }
  return (
    <span className="flex-shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400 dark:border-slate-700 dark:text-slate-500">
      Blocked
    </span>
  );
}

export default function NewChatModal({ isOpen, onClose, onOpenNewGroup }: NewChatModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [previewUser, setPreviewUser] = useState<UserSearchResult | null>(null);
  const [requestComposerFor, setRequestComposerFor] = useState<string | null>(null);
  const [introDraft, setIntroDraft] = useState('');
  const [showRequests, setShowRequests] = useState(false);
  const [requestNotice, setRequestNotice] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: chats = [] } = useChats();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setSearchQuery('');
      setDebouncedQuery('');
      setPreviewUser(null);
      setRequestComposerFor(null);
      setShowRequests(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const searchEnabled = isOpen && debouncedQuery.length >= SEARCH_MIN_LENGTH;
  const searchResults = useQuery({
    queryKey: ['user-search', debouncedQuery],
    queryFn: () => searchUsers(debouncedQuery),
    enabled: searchEnabled,
  });

  const discoveryInfo = useQuery({
    queryKey: ['my-discovery-info'],
    queryFn: fetchMyDiscoveryInfo,
    enabled: isOpen,
    staleTime: 60_000,
  });

  const createInvite = useMutation({
    mutationFn: createProfileInvite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-discovery-info'] }),
  });

  const inboxCount = useQuery({
    queryKey: ['message-requests', 'inbox'],
    queryFn: fetchMessageRequestInbox,
    enabled: isOpen,
    staleTime: 30_000,
  });
  const pendingInboxCount = inboxCount.data?.requests.length || 0;

  const directChats = chats.filter((chat) => chat.type === 'direct');
  const recentContacts = directChats
    .flatMap((chat) => {
      const other = chat.participantProfiles?.find((profile) => profile._id !== currentUser?._id);
      return other ? [{ chatId: chat._id, id: other._id, name: other.name, username: other.username, avatarUrl: other.avatarUrl }] : [];
    })
    .slice(0, 8);

  const createChatMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!currentUser?._id) throw new Error('Not authenticated');
      const existing = chats.find(
        (c) => c.type === 'direct' && c.participants.length === 2 && c.participants.includes(currentUser._id) && c.participants.includes(userId)
      );
      if (existing) return { chat: existing };
      const res = await apiClient.post('/api/chats', { type: 'direct', participantIds: [currentUser._id, userId] });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
      onClose();
      if (data?.chat?._id) navigate(`/chats/${data.chat._id}`);
    },
  });

  const requestMutation = useMutation({
    mutationFn: ({ userId, intro }: { userId: string; intro: string }) => sendMessageRequest(userId, intro),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user-search', debouncedQuery] });
      queryClient.invalidateQueries({ queryKey: ['message-requests', 'sent'] });
      setRequestComposerFor(null);
      setIntroDraft('');
      setPreviewUser(null);
      if (data.status === 'accepted' && data.chat) {
        onClose();
        navigate(`/chats/${data.chat._id}`);
        return;
      }
      setRequestNotice('Message request sent.');
      window.setTimeout(() => setRequestNotice(''), 2500);
      void variables;
    },
    onError: (error) => {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setRequestNotice(message || 'Unable to send request.');
      window.setTimeout(() => setRequestNotice(''), 3000);
    },
  });

  if (!isOpen) return null;

  const results = searchResults.data?.users || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-sm flex-col bg-white shadow-2xl dark:bg-slate-900 md:relative md:my-8 md:h-auto md:max-h-[85vh] md:rounded-2xl md:border md:border-slate-200 md:dark:border-slate-700">
        <div className="flex h-14 items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-700">
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="flex-1 text-[15px] font-semibold text-slate-900 dark:text-white">New Convo</h2>
          <button
            onClick={() => setShowRequests(true)}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Message requests"
            title="Message requests"
          >
            <Inbox size={17} />
            {pendingInboxCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {pendingInboxCount > 9 ? '9+' : pendingInboxCount}
              </span>
            )}
          </button>
          <button
            onClick={onClose}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800 md:flex"
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by username or name"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
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
            <span className="flex-1 text-left text-[14px] font-medium text-slate-900 dark:text-white">Create a group</span>
            <ChevronRight size={16} className="text-slate-400" />
          </button>

          <div className="mx-4 h-px bg-slate-100 dark:bg-slate-800" />

          {requestNotice && (
            <div className="mx-4 mt-3 rounded-xl bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
              {requestNotice}
            </div>
          )}

          {!debouncedQuery && (
            <div className="space-y-2 px-4 pb-2 pt-3">
              <CopyRow icon={Link2} label="Copy profile link" value={discoveryInfo.data?.profileUrl} />
              <CopyRow
                icon={Copy}
                label={createInvite.isPending ? 'Creating invite link...' : 'Copy invite link'}
                value={discoveryInfo.data?.inviteUrl}
                onCreateIfMissing={() => createInvite.mutate()}
              />
            </div>
          )}

          {!debouncedQuery && searchQuery.trim().length > 0 && searchQuery.trim().length < SEARCH_MIN_LENGTH && (
            <p className="px-4 pb-1 pt-2 text-xs text-slate-400">Keep typing to search (at least {SEARCH_MIN_LENGTH} characters).</p>
          )}

          {!debouncedQuery ? (
            <>
              {recentContacts.length > 0 && (
                <div className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">Recent</div>
              )}
              <ul>
                {recentContacts.map((contact) => (
                  <li key={contact.chatId}>
                    <button
                      onClick={() => {
                        onClose();
                        navigate(`/chats/${contact.chatId}`);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <InitialAvatar name={contact.name} avatarUrl={contact.avatarUrl} />
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-[14px] font-medium text-slate-900 dark:text-white">{contact.name}</p>
                        {contact.username && <p className="truncate text-xs text-slate-500 dark:text-slate-400">@{contact.username}</p>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="pt-1">
              {searchResults.isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={22} className="animate-spin text-slate-400" />
                </div>
              ) : searchResults.isError ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Search failed</p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Please try again in a moment.</p>
                </div>
              ) : results.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Search size={32} className="mb-3 text-slate-300 dark:text-slate-600" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No people found</p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Try a different username or name.</p>
                </div>
              ) : (
                <ul>
                  {results.map((user) => (
                    <li key={user.id}>
                      <div
                        onClick={() => setPreviewUser(user)}
                        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      >
                        <InitialAvatar name={user.displayName} avatarUrl={user.avatarUrl} />
                        <div className="min-w-0 flex-1 text-left">
                          <p className="flex items-center gap-1 truncate text-[14px] font-medium text-slate-900 dark:text-white">
                            {user.displayName}
                            {user.isVerified && <BadgeCheck size={13} className="flex-shrink-0 text-teal-500" />}
                          </p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">@{user.username}</p>
                        </div>
                        <ResultActionButton
                          user={user}
                          onMessage={(userId) => createChatMutation.mutate(userId)}
                          onOpenRequestComposer={(u) => setRequestComposerFor(u.id)}
                          isPending={createChatMutation.isPending}
                        />
                      </div>
                      {requestComposerFor === user.id && (
                        <div className="mx-4 mb-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                          <textarea
                            value={introDraft}
                            onChange={(event) => setIntroDraft(event.target.value)}
                            placeholder="Add a short intro message (optional)"
                            maxLength={300}
                            rows={2}
                            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setRequestComposerFor(null);
                                setIntroDraft('');
                              }}
                              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => requestMutation.mutate({ userId: user.id, intro: introDraft })}
                              disabled={requestMutation.isPending}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
                            >
                              {requestMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                              Send request
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {createChatMutation.isError && (
          <div className="border-t border-slate-200 p-4 dark:border-slate-700">
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
              {(createChatMutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
                'Failed to start chat. Please try again.'}
            </p>
          </div>
        )}
      </div>

      {previewUser && (
        <UserPreviewModal
          user={previewUser}
          onClose={() => setPreviewUser(null)}
          onMessage={(userId) => createChatMutation.mutate(userId)}
          onRequest={(userId, intro) => requestMutation.mutate({ userId, intro })}
          isRequesting={requestMutation.isPending}
        />
      )}

      {showRequests && <MessageRequestsPanel onClose={() => setShowRequests(false)} onOpenChat={(chatId) => {
        onClose();
        navigate(`/chats/${chatId}`);
      }} />}
    </div>
  );
}
