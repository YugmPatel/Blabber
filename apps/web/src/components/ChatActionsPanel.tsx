import { CalendarClock, CheckCircle2, Circle, Clock3 } from 'lucide-react';
import type { ChatActionItem, ChatActionStatus } from '@repo/types';

interface ChatActionsPanelProps {
  actions: ChatActionItem[];
  isLoading: boolean;
  isUpdating: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  onUpdateStatus: (actionId: string, status: ChatActionStatus) => void;
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

function safeActions(actions: ChatActionItem[] | null | undefined) {
  return Array.isArray(actions) ? actions : [];
}

function sourceIds(action: ChatActionItem) {
  return Array.isArray(action.sourceMessageIds) ? action.sourceMessageIds : [];
}

function statusClasses(status: string): string {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300';
  if (status === 'in_progress') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300';
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300';
}

function ActionRow({
  action,
  isUpdating,
  onUpdateStatus,
}: {
  action: ChatActionItem;
  isUpdating: boolean;
  onUpdateStatus: (actionId: string, status: ChatActionStatus) => void;
}) {
  const status = normalizedStatus(action.status);
  const actionId = action.id;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(status)}`}>
              {statusLabels[status]}
            </span>
            {action.dueDate && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <CalendarClock size={11} />
                {action.dueDate}
              </span>
            )}
          </div>
          <h4 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{action.title}</h4>
          {action.description && (
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{action.description}</p>
          )}
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Owner: {action.assignedTo?.name || 'Unassigned'} · {sourceIds(action).length} source
          </p>
        </div>
      </div>

      {actionId && status !== 'completed' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onUpdateStatus(actionId, 'open')}
            disabled={isUpdating || status === 'open'}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
          >
            <Circle size={12} />
            Open
          </button>
          <button
            type="button"
            onClick={() => onUpdateStatus(actionId, 'in_progress')}
            disabled={isUpdating || status === 'in_progress'}
            className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300"
          >
            <Clock3 size={12} />
            In Progress
          </button>
          <button
            type="button"
            onClick={() => onUpdateStatus(actionId, 'completed')}
            disabled={isUpdating}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300"
          >
            <CheckCircle2 size={12} />
            Completed
          </button>
        </div>
      )}
    </article>
  );
}

export default function ChatActionsPanel({
  actions,
  isLoading,
  isUpdating,
  errorMessage,
  onRetry,
  onUpdateStatus,
}: ChatActionsPanelProps) {
  const items = safeActions(actions);
  const active = items.filter((action) => normalizedStatus(action.status) !== 'completed');
  const completed = items.filter((action) => normalizedStatus(action.status) === 'completed');
  const openCount = active.filter((action) => normalizedStatus(action.status) === 'open').length;
  const progressCount = active.filter((action) => normalizedStatus(action.status) === 'in_progress').length;

  return (
    <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Actions</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isLoading ? 'Loading actions...' : `${openCount} open · ${progressCount} in progress`}
        </p>
        {errorMessage && (
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xs text-rose-500">{errorMessage}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-100 p-3 dark:border-slate-800">
        {active.length ? (
          active.map((action) => (
            <ActionRow
              key={action.id || `${action.title}-${sourceIds(action).join('-')}`}
              action={action}
              isUpdating={isUpdating}
              onUpdateStatus={onUpdateStatus}
            />
          ))
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">No active actions yet.</p>
        )}

        {completed.length > 0 && (
          <details className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-950">
            <summary className="cursor-pointer font-semibold text-slate-600 dark:text-slate-300">
              Completed ({completed.length})
            </summary>
            <div className="mt-2 space-y-1">
              {completed.slice(0, 8).map((action) => (
                <p key={action.id || action.title} className="truncate text-slate-500 dark:text-slate-400">
                  {action.title}
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
