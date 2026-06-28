import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Circle, Clock3, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import SourceEvidence from '@/components/SourceEvidence';
import { useAuth } from '@/contexts/AuthContext';
import { useMyActions } from '@/hooks/useChatActions';
import { canJumpToSource, navigateToSource } from '@/lib/source-jump';
import type { ChatActionItem, ChatActionStatus, SourceReference } from '@repo/types';

type OwnershipFilter = 'mine' | 'created';
type StatusFilter = 'active' | 'open' | 'in_progress' | 'completed';
type DueFilter = 'any' | 'due_soon' | 'overdue' | 'none';

type MyAction = ChatActionItem & {
  chatTitle?: string;
  chatAvatarUrl?: string;
  chatType?: 'direct' | 'group';
};

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
];

const dueOptions: { value: DueFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'due_soon', label: 'Due Soon' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'none', label: 'No Due Date' },
];

function normalizeStatus(status: string): 'open' | 'in_progress' | 'completed' {
  if (status === 'completed' || status === 'dismissed') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'open';
}

function dueDateFor(action: ChatActionItem) {
  const raw = action.dueAt || action.dueDate;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOverdue(action: ChatActionItem) {
  const due = dueDateFor(action);
  return normalizeStatus(action.status) !== 'completed' && Boolean(due && due < new Date());
}

function isDueSoon(action: ChatActionItem) {
  const due = dueDateFor(action);
  if (!due || normalizeStatus(action.status) === 'completed') return false;
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return due >= new Date() && due <= soon;
}

function statusLabel(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === 'in_progress') return 'In Progress';
  if (normalized === 'completed') return 'Completed';
  return 'Open';
}

function statusClasses(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300';
  if (normalized === 'in_progress') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300';
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300';
}

function latestSnippet(action: ChatActionItem) {
  const update = action.updates?.[action.updates.length - 1];
  if (update) return `${update.author.name || 'Someone'}: ${update.body}`;
  const activity = action.activity?.[action.activity.length - 1];
  return activity?.message;
}

function sourceFallback(action: ChatActionItem) {
  if (action.visibility === 'personal') return 'Created manually';
  if (action.metadata?.origin === 'manual') return 'Created manually';
  return 'Source unavailable';
}

function isPrivatePersonalAction(action: ChatActionItem) {
  return action.visibility === 'personal';
}

export default function MyActionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [ownership, setOwnership] = useState<OwnershipFilter>('mine');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [dueFilter, setDueFilter] = useState<DueFilter>('any');
  const [groupFilter, setGroupFilter] = useState('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [highlightedActionId, setHighlightedActionId] = useState<string | null>(null);
  const [actionUnavailable, setActionUnavailable] = useState(false);
  const pendingRevealActionIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const { actions, isLoading, error, updateActionStatus, deleteAction, isUpdating } = useMyActions();
  const targetActionId = searchParams.get('actionId');

  const groupOptions = useMemo(() => {
    const map = new Map<string, string>();
    (actions as MyAction[]).forEach((action) => {
      map.set(action.chatId, action.chatTitle || (action.chatType === 'direct' ? 'Direct chat' : 'Group chat'));
    });
    return Array.from(map.entries()).map(([chatId, title]) => ({ chatId, title }));
  }, [actions]);

  const filteredActions = useMemo(() => {
    return (actions as MyAction[]).filter((action) => {
      const status = normalizeStatus(action.status);
      const belongs =
        ownership === 'mine'
          ? action.assignedTo?.userId === user?._id
          : action.createdBy?.userId === user?._id;
      if (!belongs) return false;
      if (groupFilter !== 'all' && action.chatId !== groupFilter) return false;
      if (statusFilter === 'active' && status === 'completed') return false;
      if (statusFilter !== 'active' && status !== statusFilter) return false;
      if (dueFilter === 'overdue' && !isOverdue(action)) return false;
      if (dueFilter === 'due_soon' && !isDueSoon(action)) return false;
      if (dueFilter === 'none' && dueDateFor(action)) return false;
      return true;
    });
  }, [actions, dueFilter, groupFilter, ownership, statusFilter, user?._id]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!targetActionId || isLoading) return;
    const action = (actions as MyAction[]).find((item) => item.id === targetActionId);
    if (!action) {
      setActionUnavailable(true);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('actionId');
        return next;
      }, { replace: true });
      return;
    }

    setActionUnavailable(false);
    pendingRevealActionIdRef.current = targetActionId;
    if (action.assignedTo?.userId === user?._id) {
      setOwnership('mine');
    } else if (action.createdBy?.userId === user?._id) {
      setOwnership('created');
    }
    const status = normalizeStatus(action.status);
    setStatusFilter(status === 'completed' ? 'completed' : 'active');
    setDueFilter('any');
    setGroupFilter(action.chatId);
  }, [actions, isLoading, setSearchParams, targetActionId, user?._id]);

  useEffect(() => {
    const actionId = pendingRevealActionIdRef.current;
    if (!actionId || !filteredActions.some((action) => action.id === actionId)) return;

    let attempts = 0;
    const reveal = () => {
      const element = document.getElementById(`my-action-${actionId}`);
      if (!element) {
        attempts += 1;
        if (attempts < 60) window.requestAnimationFrame(reveal);
        return;
      }
      element.scrollIntoView({ block: 'center' });
      setHighlightedActionId(actionId);
      pendingRevealActionIdRef.current = null;
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('actionId');
        return next;
      }, { replace: true });
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => {
        setHighlightedActionId((current) => (current === actionId ? null : current));
        highlightTimerRef.current = null;
      }, 8000);
    };

    window.requestAnimationFrame(reveal);
  }, [filteredActions, setSearchParams]);

  const jumpToSource = (source: SourceReference) => {
    if (!canJumpToSource(source)) return;
    navigateToSource(navigate, source);
  };

  const markStatus = (action: MyAction, status: ChatActionStatus) => {
    if (!action.id || !action.permissions?.canUpdateStatus) return;
    updateActionStatus({ actionId: action.id, status });
  };

  const deleteSelectedAction = (action: MyAction) => {
    if (!action.id || !action.permissions?.canDelete) return;
    if (!window.confirm('Delete this Action? It will be removed from normal Action lists, but its source message will remain.')) return;
    deleteAction({ actionId: action.id, reason: 'Deleted from My Actions' });
    setOpenMenuId(null);
  };

  return (
    <div className="flex h-screen bg-[#f4f5f7] text-slate-900 dark:bg-slate-950 dark:text-white">
      <Sidebar onNewConversation={() => navigate('/chats')} onChatFilterChange={() => navigate('/chats')} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold">My Actions</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">What you need to do, and what you created for others.</p>
          </div>

          {actionUnavailable && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              This Action is no longer available.
            </div>
          )}

          <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {([
              ['mine', 'Mine'],
              ['created', 'Created by Me'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setOwnership(value)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  ownership === value ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mb-5 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-3">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Due date
              <select value={dueFilter} onChange={(event) => setDueFilter(event.target.value as DueFilter)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                {dueOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Chat
              <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                <option value="all">All Chats</option>
                {groupOptions.map((group) => <option key={group.chatId} value={group.chatId}>{group.title}</option>)}
              </select>
            </label>
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-500">Loading actions...</p>
          ) : error ? (
            <p className="text-sm text-rose-500">Unable to load your actions.</p>
          ) : filteredActions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
              <p className="font-semibold">No actions in this view</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Try another status, due date, or chat filter.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredActions.map((action) => {
                const due = dueDateFor(action);
                const snippet = latestSnippet(action);
                const isPersonal = isPrivatePersonalAction(action);
                const chatLabel = action.chatTitle || (action.chatType === 'direct' ? 'Direct chat' : 'Group chat');
                return (
                  <article
                    key={action.id}
                    id={action.id ? `my-action-${action.id}` : undefined}
                    className={`rounded-lg border bg-white p-4 transition-colors dark:bg-slate-900 ${
                      highlightedActionId === action.id
                        ? 'border-amber-300 bg-amber-50 dark:border-amber-400/50 dark:bg-amber-400/10'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {!isPersonal && (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm font-semibold text-teal-700 dark:bg-teal-900/50 dark:text-teal-200">
                          {action.chatAvatarUrl ? <img src={action.chatAvatarUrl} alt="" className="h-full w-full rounded-full object-cover" /> : chatLabel.slice(0, 1)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-teal-700 dark:text-teal-300">{chatLabel}</span>
                          {isPersonal && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">Private personal Action</span>}
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(action.status)}`}>{statusLabel(action.status)}</span>
                          {isOverdue(action) && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">Overdue</span>}
                        </div>
                        <h2 className="mt-1 text-base font-semibold">{action.title}</h2>
                        {action.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{action.description}</p>}
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span>Owner: {action.assignedTo?.name || 'Unassigned'}</span>
                          {due && <span>Due {due.toLocaleDateString()}</span>}
                          {snippet && <span className="max-w-full truncate">Latest: {snippet}</span>}
                          <button type="button" onClick={() => navigate(`/chats/${action.chatId}`)} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">Open chat</button>
                        </div>
                        <SourceEvidence sources={action.sources} compact fallbackText={sourceFallback(action)} onJump={jumpToSource} />
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        {action.permissions?.canUpdateStatus && (['open', 'in_progress', 'completed'] as ChatActionStatus[]).map((status) => (
                          <button
                            key={status}
                            type="button"
                            disabled={isUpdating}
                            onClick={() => markStatus(action, status)}
                            className={`rounded-lg p-2 transition ${normalizeStatus(action.status) === status ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                            aria-label={`Mark ${status === 'in_progress' ? 'In Progress' : status}`}
                            title={`Mark ${status === 'in_progress' ? 'In Progress' : status}`}
                          >
                            {status === 'open' ? <Circle size={16} /> : status === 'in_progress' ? <Clock3 size={16} /> : <CheckCircle2 size={16} />}
                          </button>
                        ))}
                        {(!isPersonal && (action.permissions?.canEdit || action.permissions?.canDelete)) && (
                          <div className="relative">
                            <button type="button" onClick={() => setOpenMenuId(openMenuId === action.id ? null : action.id || null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Action menu">
                              <MoreHorizontal size={16} />
                            </button>
                            {openMenuId === action.id && (
                              <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-950">
                                <button type="button" onClick={() => navigate(`/chats/${action.chatId}`)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
                                  <Pencil size={13} /> Edit / Reassign
                                </button>
                                {action.permissions?.canDelete && (
                                  <button type="button" onClick={() => deleteSelectedAction(action)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30">
                                    <Trash2 size={13} /> Delete Action
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
