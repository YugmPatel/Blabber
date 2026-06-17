import { CalendarClock, Check, CircleCheck, ClipboardList, RefreshCw, X } from 'lucide-react';
import type { ChatActionItem, ChatActionStatus, ChatActionType } from '@repo/types';

interface ChatActionsPanelProps {
  actions: ChatActionItem[];
  isLoading: boolean;
  isExtracting: boolean;
  isUpdating: boolean;
  errorMessage?: string;
  onFindActions: () => void;
  onUpdateStatus: (actionId: string, status: ChatActionStatus) => void;
}

const groupLabels: Record<ChatActionType, string> = {
  task: 'Tasks',
  event: 'Events',
  reminder: 'Reminders',
  request: 'Requests',
  follow_up: 'Follow-ups',
  promise: 'Promises',
};

const typeLabels: Record<ChatActionType, string> = {
  task: 'Task',
  event: 'Event',
  reminder: 'Reminder',
  request: 'Request',
  follow_up: 'Follow-up',
  promise: 'Promise',
};

const groupOrder: ChatActionType[] = ['task', 'event', 'reminder', 'request', 'follow_up', 'promise'];

function statusClasses(status: ChatActionStatus): string {
  switch (status) {
    case 'accepted':
      return 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300';
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300';
    case 'dismissed':
      return 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300';
  }
}

function actionTime(action: ChatActionItem): string | undefined {
  return action.eventStart || action.dueDate || action.eventEnd;
}

function ActionCard({
  action,
  isUpdating,
  onUpdateStatus,
}: {
  action: ChatActionItem;
  isUpdating: boolean;
  onUpdateStatus: (actionId: string, status: ChatActionStatus) => void;
}) {
  const time = actionTime(action);
  const actionId = action.id;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {typeLabels[action.type]}
            </span>
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusClasses(action.status)}`}>
              {action.status}
            </span>
            {typeof action.confidence === 'number' && (
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {Math.round(action.confidence * 100)}%
              </span>
            )}
          </div>
          <h4 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{action.title}</h4>
          {action.description && (
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {action.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            {action.assignedTo?.name && <span>Assigned to {action.assignedTo.name}</span>}
            {time && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock size={11} />
                {time}
              </span>
            )}
            <span>{action.sourceMessageIds.length} source</span>
          </div>
        </div>
      </div>

      {actionId && action.status !== 'dismissed' && action.status !== 'completed' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {action.status === 'pending' && (
            <button
              type="button"
              onClick={() => onUpdateStatus(actionId, 'accepted')}
              disabled={isUpdating}
              className="inline-flex items-center gap-1 rounded-md border border-teal-200 px-2 py-1 text-xs font-semibold text-teal-700 transition hover:bg-teal-50 disabled:opacity-60 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/30"
            >
              <Check size={12} />
              Accept
            </button>
          )}
          <button
            type="button"
            onClick={() => onUpdateStatus(actionId, 'completed')}
            disabled={isUpdating}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
          >
            <CircleCheck size={12} />
            Complete
          </button>
          <button
            type="button"
            onClick={() => onUpdateStatus(actionId, 'dismissed')}
            disabled={isUpdating}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X size={12} />
            Dismiss
          </button>
        </div>
      )}
    </article>
  );
}

export default function ChatActionsPanel({
  actions,
  isLoading,
  isExtracting,
  isUpdating,
  errorMessage,
  onFindActions,
  onUpdateStatus,
}: ChatActionsPanelProps) {
  const grouped = groupOrder
    .map((type) => ({
      type,
      actions: actions.filter((action) => action.type === type),
    }))
    .filter((group) => group.actions.length > 0);

  return (
    <section className="border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <ClipboardList size={14} className="flex-shrink-0 text-indigo-500" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo-600 dark:text-indigo-300">
            Actions
          </span>
          {!isLoading && actions.length === 0 && !errorMessage && (
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">No actions found yet.</span>
          )}
          {actions.length > 0 && (
            <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
              {actions.length} found
            </span>
          )}
          {isLoading && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">Loading...</span>}
          {errorMessage && <span className="ml-2 text-xs text-rose-500">{errorMessage}</span>}
        </div>
        <button
          type="button"
          onClick={onFindActions}
          disabled={isExtracting}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          <RefreshCw size={12} className={isExtracting ? 'animate-spin' : ''} />
          {isExtracting ? 'Finding...' : 'Find Actions'}
        </button>
      </div>

      {isExtracting && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Finding tasks, events, and follow-ups...
        </div>
      )}

      {grouped.length > 0 && (
        <div className="space-y-3 border-t border-slate-100 px-4 pb-3 pt-3 dark:border-slate-800">
          {grouped.map((group) => (
            <div key={group.type}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                {groupLabels[group.type]}
              </h3>
              <div className="space-y-2">
                {group.actions.map((action) => (
                  <ActionCard
                    key={action.id || `${action.type}-${action.title}-${action.sourceMessageIds.join('-')}`}
                    action={action}
                    isUpdating={isUpdating}
                    onUpdateStatus={onUpdateStatus}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
