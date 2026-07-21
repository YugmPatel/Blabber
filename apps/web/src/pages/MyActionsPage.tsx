import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Circle, Clock3, Mail, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import Avatar from '@/components/Avatar';
import AppShell from '@/components/ui/AppShell';
import PageHeader from '@/components/ui/PageHeader';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import BrandBadge from '@/components/ui/BrandBadge';
import SourceEvidence from '@/components/SourceEvidence';
import { ActionForm, type ActionOwnerOption } from '@/components/ChatActionsPanel';
import { apiErrorMessage, emailMyActionsDigest, respondPlanThisAssignment } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { chatActionKeys, useMyActions } from '@/hooks/useChatActions';
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

function planAssignmentLabel(action: ChatActionItem) {
  const actionState = action.metadata?.actionState;
  if (typeof actionState === 'string') return actionState;
  const taskStatus = action.metadata?.taskStatus;
  if (taskStatus === 'pending_response') return 'Assignment requested';
  if (taskStatus === 'accepted') return 'Accepted';
  if (taskStatus === 'declined') return 'Declined';
  if (taskStatus === 'unassigned') return 'Unassigned';
  const status = action.metadata?.assignmentStatus;
  if (status === 'accepted') return 'Accepted';
  if (status === 'declined') return 'Declined';
  if (status === 'requested') return 'Requested';
  return null;
}

function latestSnippet(action: ChatActionItem) {
  const update = action.updates?.[action.updates.length - 1];
  if (update) return `${update.author.name || 'Someone'}: ${update.body}`;
  const activity = action.activity?.[action.activity.length - 1];
  return activity?.message;
}

function sourceFallback(action: ChatActionItem) {
  if (action.metadata?.origin === 'plan_this') return 'From: Plan This';
  if (action.visibility === 'personal') return 'Created manually';
  if (action.metadata?.origin === 'manual') return 'Created manually';
  return 'Source unavailable';
}

function isPrivatePersonalAction(action: ChatActionItem) {
  return action.visibility === 'personal';
}

function isStandaloneMyAction(action: ChatActionItem) {
  return action.visibility === 'personal' && action.metadata?.origin === 'manual_my_actions';
}

export default function MyActionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [ownership, setOwnership] = useState<OwnershipFilter>('mine');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [dueFilter, setDueFilter] = useState<DueFilter>('any');
  const [groupFilter, setGroupFilter] = useState('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isCreatingActionForm, setIsCreatingActionForm] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [highlightedActionId, setHighlightedActionId] = useState<string | null>(null);
  const [actionUnavailable, setActionUnavailable] = useState(false);
  const [digestMessage, setDigestMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const pendingRevealActionIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const { actions, isLoading, error, createAction, updateAction, updateActionStatus, deleteAction, isCreatingAction, isUpdating, updateError } = useMyActions();
  const respondAssignment = useMutation({
    mutationFn: ({ planId, assignmentId, status }: { planId: string; assignmentId: string; status: 'accepted' | 'declined' }) =>
      respondPlanThisAssignment(planId, assignmentId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatActionKeys.mine() }),
  });
  const emailDigest = useMutation({
    mutationFn: emailMyActionsDigest,
    onMutate: () => setDigestMessage(null),
    onSuccess: (data) => {
      setDigestMessage({
        type: data.sent ? 'success' : 'info',
        text: data.message || (data.sent ? 'Actions digest sent to your email.' : 'No open Actions to email.'),
      });
    },
    onError: (mutationError) => {
      setDigestMessage({
        type: 'error',
        text: apiErrorMessage(mutationError, 'Could not send digest. Please try again.'),
      });
    },
  });
  const targetActionId = searchParams.get('actionId');

  const myActionOwnerOptions = useMemo<ActionOwnerOption[]>(() => {
    if (!user?._id) return [];
    return [{ userId: user._id, name: user.name || user.username || user.email || 'You' }];
  }, [user?._id, user?.email, user?.name, user?.username]);

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
      // A truthy chatEndedAt means the source group ended (see
      // services/chats's getMyChatActions) — keep it out of the default
      // "active" view since it's no longer something to act on, but don't
      // drop it from other filters so it stays visible/clearly marked
      // (below) for history.
      if (statusFilter === 'active' && (status === 'completed' || action.chatEndedAt)) return false;
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
    <AppShell onNewConversation={() => navigate('/chats')} onChatFilterChange={() => navigate('/chats')} ambient>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <PageHeader title="My Actions" subtitle="What you need to do, and what you created for others." />
          <button
            type="button"
            disabled={emailDigest.isPending}
            onClick={() => emailDigest.mutate()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm font-semibold text-[color:var(--bl-text)] transition hover:bg-[color:var(--bl-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            <Mail size={16} />
            {emailDigest.isPending ? 'Sending...' : 'Email me my Actions'}
          </button>
        </div>

        {actionUnavailable && (
          <div className="rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-4 py-3 text-sm text-[color:var(--bl-text-secondary)]">
            This Action is no longer available.
          </div>
        )}

        {digestMessage && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              digestMessage.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                : digestMessage.type === 'info'
                  ? 'border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] text-[color:var(--bl-text-secondary)]'
                  : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200'
            }`}
          >
            {digestMessage.text}
          </div>
        )}

        {updateError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
            {updateError.message || 'Unable to save this Action right now.'}
          </div>
        )}

        <SegmentedTabs
          aria-label="Action ownership"
          value={ownership}
          onChange={setOwnership}
          options={[
            { value: 'mine', label: 'Mine' },
            { value: 'created', label: 'Created by Me' },
          ]}
        />

        <div className="rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[color:var(--bl-text)]">Quick add</h2>
              <p className="mt-1 text-xs text-[color:var(--bl-text-muted)]">Create a private Action that stays in My Actions.</p>
            </div>
            <button
              type="button"
              disabled={isCreatingAction || isUpdating}
              onClick={() => setIsCreatingActionForm((current) => !current)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} />
              New Action
            </button>
          </div>
          {isCreatingActionForm && (
            <div className="mt-3">
              <ActionForm
                ownerOptions={myActionOwnerOptions}
                defaultOwnerUserId={user?._id}
                ownerLocked
                existingActions={actions}
                isSaving={isCreatingAction || isUpdating}
                onCancel={() => setIsCreatingActionForm(false)}
                onCreate={(payload) => {
                  createAction(payload);
                  setStatusFilter('active');
                  setOwnership('mine');
                }}
                ownerRequiredMessage="Sign in again before creating a private Action."
              />
            </div>
          )}
        </div>

          <div className="grid gap-4 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 shadow-sm sm:grid-cols-3">
            <label className="text-xs font-semibold text-[color:var(--bl-text-muted)]">
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="mt-1.5 w-full rounded-lg border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] px-3 py-2 text-sm text-[color:var(--bl-text)] outline-none focus:border-teal-400">
                {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-[color:var(--bl-text-muted)]">
              Due date
              <select value={dueFilter} onChange={(event) => setDueFilter(event.target.value as DueFilter)} className="mt-1.5 w-full rounded-lg border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] px-3 py-2 text-sm text-[color:var(--bl-text)] outline-none focus:border-teal-400">
                {dueOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-[color:var(--bl-text-muted)]">
              Chat
              <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] px-3 py-2 text-sm text-[color:var(--bl-text)] outline-none focus:border-teal-400">
                <option value="all">All Chats</option>
                {groupOptions.map((group) => <option key={group.chatId} value={group.chatId}>{group.title}</option>)}
              </select>
            </label>
          </div>

          {isLoading ? (
            <p className="text-sm text-[color:var(--bl-text-muted)]">Loading actions...</p>
          ) : error ? (
            <p className="text-sm text-rose-600 dark:text-rose-300">Unable to load your actions.</p>
          ) : filteredActions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-8 text-center">
              <p className="font-semibold text-[color:var(--bl-text)]">No actions in this view</p>
              <p className="mt-1 text-sm text-[color:var(--bl-text-muted)]">
                Try another status, due date, or chat filter.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredActions.map((action) => {
                const due = dueDateFor(action);
                const snippet = latestSnippet(action);
                const isPersonal = isPrivatePersonalAction(action);
                const standalone = isStandaloneMyAction(action);
                const chatLabel = action.chatTitle || (action.chatType === 'direct' ? 'Direct chat' : 'Group chat');
                const assignmentLabel = planAssignmentLabel(action);
                const planId = typeof action.metadata?.planId === 'string' ? action.metadata.planId : '';
                const assignmentId = typeof action.metadata?.assignmentId === 'string' ? action.metadata.assignmentId : '';
                return (
                  <article
                    key={action.id}
                    id={action.id ? `my-action-${action.id}` : undefined}
                    className={`rounded-2xl border bg-[color:var(--bl-panel)] p-4 shadow-sm transition ${
                      highlightedActionId === action.id
                        ? 'border-amber-300 bg-amber-50 dark:border-amber-400/50 dark:bg-amber-400/10'
                        : 'border-[color:var(--bl-border)] hover:[box-shadow:var(--bl-glow-sm)]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {!isPersonal && <Avatar src={action.chatAvatarUrl} alt={chatLabel} size="md" className="flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-teal-700 dark:text-teal-300">{chatLabel}</span>
                          {action.metadata?.origin === 'plan_this' && <BrandBadge tone="accent">From: Plan This</BrandBadge>}
                          {isPersonal && <BrandBadge>Private personal Action</BrandBadge>}
                          {assignmentLabel && <BrandBadge>{assignmentLabel}</BrandBadge>}
                          <BrandBadge tone={normalizeStatus(action.status) === 'completed' ? 'success' : normalizeStatus(action.status) === 'in_progress' ? 'accent' : 'success'}>
                            {statusLabel(action.status)}
                          </BrandBadge>
                          {isOverdue(action) && <BrandBadge tone="danger">Overdue</BrandBadge>}
                          {action.chatEndedAt && <BrandBadge tone="warning">Group ended</BrandBadge>}
                        </div>
                        <h2 className="mt-1 text-base font-semibold text-[color:var(--bl-text)]">{action.title}</h2>
                        {action.description && <p className="mt-1 text-sm text-[color:var(--bl-text-secondary)]">{action.description}</p>}
                        {editingActionId === action.id && (
                          <div className="mt-3">
                            <ActionForm
                              action={action}
                              ownerOptions={standalone ? myActionOwnerOptions : []}
                              defaultOwnerUserId={standalone ? user?._id : action.assignedTo?.userId}
                              ownerLocked={standalone}
                              existingActions={actions}
                              isSaving={isUpdating}
                              onCancel={() => setEditingActionId(null)}
                              onUpdate={(actionId, patch) => {
                                updateAction({ actionId, patch });
                                setEditingActionId(null);
                              }}
                              ownerRequiredMessage="This Action needs an owner before it can be saved."
                            />
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[color:var(--bl-text-muted)]">
                          <span>Owner: {action.assignedTo?.name || 'Unassigned'}</span>
                          {due && <span>Due {due.toLocaleDateString()}</span>}
                          {snippet && <span className="max-w-full truncate">Latest: {snippet}</span>}
                          {!standalone && (
                            <button type="button" onClick={() => navigate(`/chats/${action.chatId}`)} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">{action.metadata?.origin === 'plan_this' ? 'Open plan' : 'Open chat'}</button>
                          )}
                        </div>
                        {(assignmentLabel === 'Assignment requested' || assignmentLabel === 'Requested') && planId && assignmentId && action.assignedTo?.userId === user?._id && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => respondAssignment.mutate({ planId, assignmentId, status: 'accepted' })}
                              className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
                            >
                              Accept request
                            </button>
                            <button
                              type="button"
                              onClick={() => respondAssignment.mutate({ planId, assignmentId, status: 'declined' })}
                              className="rounded-lg border border-[color:var(--bl-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                            >
                              Decline
                            </button>
                          </div>
                        )}
                        <SourceEvidence sources={action.sources} compact fallbackText={sourceFallback(action)} onJump={jumpToSource} />
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        {action.permissions?.canUpdateStatus && (['open', 'in_progress', 'completed'] as ChatActionStatus[]).map((status) => (
                          <button
                            key={status}
                            type="button"
                            disabled={isUpdating}
                            onClick={() => markStatus(action, status)}
                            className={`rounded-lg p-2 transition ${normalizeStatus(action.status) === status ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-[color:var(--bl-text-muted)] hover:bg-[color:var(--bl-hover)]'}`}
                            aria-label={`Mark ${status === 'in_progress' ? 'In Progress' : status}`}
                            title={`Mark ${status === 'in_progress' ? 'In Progress' : status}`}
                          >
                            {status === 'open' ? <Circle size={16} /> : status === 'in_progress' ? <Clock3 size={16} /> : <CheckCircle2 size={16} />}
                          </button>
                        ))}
                        {(action.permissions?.canEdit || action.permissions?.canDelete) && (
                          <div className="relative">
                            <button type="button" onClick={() => setOpenMenuId(openMenuId === action.id ? null : action.id || null)} className="rounded-lg p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)]" aria-label="Action menu">
                              <MoreHorizontal size={16} />
                            </button>
                            {openMenuId === action.id && (
                              <div className="absolute right-0 z-10 mt-1 w-40 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-1 shadow-lg">
                                {action.permissions?.canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (standalone) {
                                        setEditingActionId(action.id || null);
                                      } else {
                                        navigate(`/chats/${action.chatId}`);
                                      }
                                      setOpenMenuId(null);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                                  >
                                    <Pencil size={13} /> {standalone ? 'Edit Action' : 'Edit / Reassign'}
                                  </button>
                                )}
                                {action.permissions?.canDelete && (
                                  <button type="button" disabled={isUpdating} onClick={() => deleteSelectedAction(action)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/30">
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
    </AppShell>
  );
}
