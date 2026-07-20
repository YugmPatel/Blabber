import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarClock, CheckCircle2, Circle, Clock3, ListChecks, MessageSquarePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ChatActionItem, ChatActionStatus, CreateChatActionDTO, SourceReference, UpdateChatActionDTO } from '@repo/types';
import SourceEvidence from './SourceEvidence';

export interface ActionOwnerOption {
  userId: string;
  name: string;
}

interface ChatActionsPanelProps {
  actions: ChatActionItem[];
  isLoading: boolean;
  isUpdating: boolean;
  isCreating?: boolean;
  errorMessage?: string;
  ownerOptions?: ActionOwnerOption[];
  defaultOwnerUserId?: string;
  currentUserCanManageActions?: boolean;
  existingActions?: ChatActionItem[];
  onRetry?: () => void;
  onCreateAction?: (payload: CreateChatActionDTO) => void;
  onUpdateAction?: (actionId: string, patch: UpdateChatActionDTO) => void;
  onUpdateStatus: (actionId: string, status: ChatActionStatus) => void;
  onAddUpdate?: (actionId: string, body: string) => void;
  onDeleteAction?: (actionId: string, reason?: string) => void;
  onJumpToSource?: (source: SourceReference) => void;
}

const statusLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Completed',
  pending: 'Open',
  accepted: 'Open',
  dismissed: 'Completed',
};

function normalizedStatus(status: ChatActionStatus) {
  if (status === 'completed' || status === 'dismissed') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'open';
}

function sourceIds(action: ChatActionItem) {
  return Array.isArray(action.sourceMessageIds) ? action.sourceMessageIds : [];
}

function statusClasses(status: string): string {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300';
  if (status === 'in_progress') return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300';
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300';
}

function StatusDot({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-500" />;
  if (status === 'in_progress') return <Clock3 size={16} className="mt-0.5 flex-shrink-0 text-sky-500" />;
  return <Circle size={16} className="mt-0.5 flex-shrink-0 text-amber-500" />;
}

function sourceFallback(action: ChatActionItem) {
  if ((action.metadata as any)?.origin === 'manual') return 'Created manually';
  return sourceIds(action).length === 0 ? 'Source unavailable' : 'Source unavailable';
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function dateInputValue(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function ActionForm({
  action,
  ownerOptions,
  isSaving,
  onCancel,
  onCreate,
  onUpdate,
  defaultOwnerUserId,
  existingActions = [],
  ownerRequiredMessage = 'Choose an owner before creating this Action.',
  ownerLocked = false,
  ownerOptional = false,
  children,
}: {
  action?: ChatActionItem;
  ownerOptions: ActionOwnerOption[];
  isSaving: boolean;
  onCancel: () => void;
  onCreate?: (payload: CreateChatActionDTO) => void;
  onUpdate?: (actionId: string, patch: UpdateChatActionDTO) => void;
  defaultOwnerUserId?: string;
  existingActions?: ChatActionItem[];
  ownerRequiredMessage?: string;
  ownerLocked?: boolean;
  ownerOptional?: boolean;
  children?: ReactNode;
}) {
  const [title, setTitle] = useState(action?.title || '');
  const [description, setDescription] = useState(action?.description || '');
  const [ownerUserId, setOwnerUserId] = useState(action?.assignedTo?.userId || defaultOwnerUserId || '');
  const [dueDate, setDueDate] = useState(dateInputValue(action?.dueAt || action?.dueDate));
  const selectedOwner = ownerOptions.find((option) => option.userId === ownerUserId);
  const isEditing = Boolean(action?.id);
  const activeDuplicate = existingActions.find((existing) => {
    if (existing.id && action?.id && existing.id === action.id) return false;
    const status = existing.status === 'completed' || existing.status === 'dismissed' ? 'completed' : existing.status;
    if (status === 'completed') return false;
    const sameTitle = existing.title.trim().toLowerCase() === title.trim().toLowerCase();
    const sameOwner = ownerUserId && existing.assignedTo?.userId === ownerUserId;
    const sameSource = (existing.sourceMessageIds || []).some((sourceId) => (action?.sourceMessageIds || []).includes(sourceId));
    return Boolean(title.trim() && (sameSource || sameTitle || (sameOwner && sameTitle)));
  });

  const submit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || (!ownerOptional && !ownerUserId)) return;
    const payload = {
      title: trimmedTitle,
      description: description.trim() || undefined,
      ownerUserId: ownerUserId || undefined,
      ownerName: selectedOwner?.name,
      dueDate: dueDate || undefined,
      dueAt: dueDate || undefined,
    };
    if (isEditing && action?.id) {
      onUpdate?.(action.id, payload);
    } else {
      onCreate?.({ ...payload, sourceMessageIds: [] });
    }
    onCancel();
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
      <div className="space-y-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Action title"
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-900"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Add details"
          rows={2}
          className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-900"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={ownerUserId}
            onChange={(event) => setOwnerUserId(event.target.value)}
            disabled={ownerLocked}
            className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="">{ownerOptional ? 'Unassigned' : 'Choose owner'}</option>
            {ownerOptions.map((option) => (
              <option key={option.userId} value={option.userId}>
                {option.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        {!ownerOptional && !ownerUserId && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{ownerRequiredMessage}</p>
        )}
      </div>
      {activeDuplicate && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">A similar Action is already active in this group.</p>
          <p className="mt-1">{activeDuplicate.title} · {activeDuplicate.status === 'in_progress' ? 'In Progress' : 'Open'}</p>
        </div>
      )}
      {children}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isSaving || !title.trim() || (!ownerOptional && !ownerUserId)}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
        >
          {isEditing ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  );
}

function ActionRow({
  action,
  isUpdating,
  ownerOptions,
  onUpdateAction,
  onUpdateStatus,
  onAddUpdate,
  onDeleteAction,
  onJumpToSource,
  existingActions,
}: {
  action: ChatActionItem;
  isUpdating: boolean;
  ownerOptions: ActionOwnerOption[];
  existingActions: ChatActionItem[];
  onUpdateAction?: (actionId: string, patch: UpdateChatActionDTO) => void;
  onUpdateStatus: (actionId: string, status: ChatActionStatus) => void;
  onAddUpdate?: (actionId: string, body: string) => void;
  onDeleteAction?: (actionId: string, reason?: string) => void;
  onJumpToSource?: (source: SourceReference) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [comment, setComment] = useState('');
  const status = normalizedStatus(action.status);
  const actionId = action.id;
  const latestUpdates = [...(action.updates || [])].slice(-2).reverse();
  const canEdit = Boolean(action.permissions?.canEdit);
  const canDelete = Boolean(action.permissions?.canDelete);
  const canUpdateStatus = Boolean(action.permissions?.canUpdateStatus);

  return (
    <article id={actionId ? `action-${actionId}` : undefined} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
      {isEditing ? (
        <ActionForm
          action={action}
          ownerOptions={ownerOptions}
          isSaving={isUpdating}
          existingActions={existingActions}
          onCancel={() => setIsEditing(false)}
          onUpdate={onUpdateAction}
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <StatusDot status={status} />
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{action.title}</h4>
                {action.description && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{action.description}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(status)}`}>
                    {statusLabels[status]}
                  </span>
                  {(action.dueAt || action.dueDate) && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <CalendarClock size={11} />
                      Due {formatDate(action.dueAt || action.dueDate)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Owner: {action.assignedTo?.name || 'Unassigned'}
                  {sourceIds(action).length > 0 ? ` · ${sourceIds(action).length} source` : ''}
                </p>
                <SourceEvidence sources={action.sources} compact fallbackText={sourceFallback(action)} onJump={onJumpToSource} />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {actionId && onUpdateAction && canEdit && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  aria-label="Edit action"
                  title="Edit action"
                >
                  <Pencil size={14} />
                </button>
              )}
              {actionId && onDeleteAction && canDelete && (
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm('Delete this Action? It will be removed from normal Action lists, but its source message will remain.')) return;
                    onDeleteAction(actionId, 'Deleted from Group Actions');
                  }}
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-300"
                  aria-label="Delete action"
                  title="Delete action"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {actionId && canUpdateStatus && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => onUpdateStatus(actionId, 'open')} disabled={isUpdating || status === 'open'} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
                <Circle size={12} />
                Open
              </button>
              <button type="button" onClick={() => onUpdateStatus(actionId, 'in_progress')} disabled={isUpdating || status === 'in_progress'} className="inline-flex items-center gap-1 rounded-md border border-sky-200 px-2 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:text-sky-300">
                <Clock3 size={12} />
                In Progress
              </button>
              <button type="button" onClick={() => onUpdateStatus(actionId, 'completed')} disabled={isUpdating || status === 'completed'} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300">
                <CheckCircle2 size={12} />
                Completed
              </button>
            </div>
          )}

          {latestUpdates.length > 0 && (
            <div className="mt-3 space-y-2 rounded-md bg-slate-50 p-2 dark:bg-slate-900">
              {latestUpdates.map((update) => (
                <div key={update.id} className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-semibold">{update.author.name || 'Someone'}:</span> {update.body}
                </div>
              ))}
            </div>
          )}

          {actionId && onAddUpdate && (
            <div className="mt-3 flex gap-2">
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Add an update"
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-900"
              />
              <button
                type="button"
                onClick={() => {
                  const body = comment.trim();
                  if (!body) return;
                  onAddUpdate(actionId, body);
                  setComment('');
                }}
                disabled={isUpdating || !comment.trim()}
                className="inline-flex items-center justify-center rounded-md border border-teal-200 px-2 text-teal-700 transition hover:bg-teal-50 disabled:opacity-50 dark:border-teal-800 dark:text-teal-300"
                aria-label="Add update"
                title="Add update"
              >
                <MessageSquarePlus size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

export default function ChatActionsPanel({
  actions,
  isLoading,
  isUpdating,
  isCreating = false,
  errorMessage,
  ownerOptions = [],
  defaultOwnerUserId,
  currentUserCanManageActions = false,
  onRetry,
  onCreateAction,
  onUpdateAction,
  onUpdateStatus,
  onAddUpdate,
  onDeleteAction,
  onJumpToSource,
}: ChatActionsPanelProps) {
  const [isCreatingManual, setIsCreatingManual] = useState(false);
  const items = Array.isArray(actions) ? actions : [];
  const active = items.filter((action) => normalizedStatus(action.status) !== 'completed');
  const completed = items.filter((action) => normalizedStatus(action.status) === 'completed');
  const openCount = active.filter((action) => normalizedStatus(action.status) === 'open').length;
  const progressCount = active.filter((action) => normalizedStatus(action.status) === 'in_progress').length;
  const safeOwnerOptions = useMemo(() => {
    const options = ownerOptions.filter((option) => option.userId);
    if (currentUserCanManageActions) return options;
    return options.filter((option) => option.userId === defaultOwnerUserId);
  }, [currentUserCanManageActions, defaultOwnerUserId, ownerOptions]);

  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
            <ListChecks size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">
              {isLoading ? 'Loading actions...' : `${openCount} open · ${progressCount} in progress`}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Track and manage action items from this conversation.
            </p>
          </div>
          {onCreateAction && safeOwnerOptions.length > 0 && (
            <button
              type="button"
              onClick={() => setIsCreatingManual(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/40 px-3 py-1.5 text-xs font-semibold text-teal-700 transition hover:bg-teal-50 dark:border-teal-500/40 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              <Plus size={13} />
              New
            </button>
          )}
        </div>
        {errorMessage && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900/40 dark:bg-rose-950/20">
            <p className="text-xs text-rose-600 dark:text-rose-300">{errorMessage}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="ml-auto flex-shrink-0 rounded-md border border-rose-300 px-2 py-0.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        {isCreatingManual && (
          <ActionForm
            ownerOptions={safeOwnerOptions}
            isSaving={isCreating}
            defaultOwnerUserId={defaultOwnerUserId}
            existingActions={items}
            ownerLocked={!currentUserCanManageActions}
            onCancel={() => setIsCreatingManual(false)}
            onCreate={onCreateAction}
          />
        )}
        {active.length ? (
          active.map((action) => (
            <ActionRow
              key={action.id || `${action.title}-${sourceIds(action).join('-')}`}
              action={action}
              isUpdating={isUpdating}
              ownerOptions={safeOwnerOptions}
              existingActions={items}
              onUpdateAction={onUpdateAction}
              onUpdateStatus={onUpdateStatus}
              onAddUpdate={onAddUpdate}
              onDeleteAction={onDeleteAction}
              onJumpToSource={onJumpToSource}
            />
          ))
        ) : (
          !isCreatingManual && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 text-center dark:border-slate-700 dark:bg-slate-800/60">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No actions yet</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Action items from this conversation will appear here.
              </p>
            </div>
          )
        )}

        {completed.length > 0 && (
          <details className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800/60">
            <summary className="cursor-pointer font-semibold text-slate-600 dark:text-slate-300">
              Completed ({completed.length})
            </summary>
            <div className="mt-2.5 space-y-2.5">
              {completed.slice(0, 8).map((action) => (
                <ActionRow
                  key={action.id || action.title}
                  action={action}
                  isUpdating={isUpdating}
                  ownerOptions={safeOwnerOptions}
                  existingActions={items}
                  onUpdateAction={onUpdateAction}
                  onUpdateStatus={onUpdateStatus}
                  onAddUpdate={onAddUpdate}
                  onDeleteAction={onDeleteAction}
                  onJumpToSource={onJumpToSource}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
