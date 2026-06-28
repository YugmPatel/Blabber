import { useState } from 'react';
import { CheckCircle, ChevronDown, ChevronRight, Clock3, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { SourceReference, WaitingOnDirection, WaitingOnItem, WaitingOnStatus } from '@repo/types';
import SourceEvidence from './SourceEvidence';

interface WaitingOnPanelProps {
  waitingOn: WaitingOnItem[];
  isLoading: boolean;
  isExtracting: boolean;
  isUpdating: boolean;
  errorMessage?: string;
  onFindWaitingOn: () => void;
  onUpdateWaitingOn: (itemId: string, status: WaitingOnStatus) => void;
  onDeleteWaitingOn: (itemId: string) => void;
  onJumpToSource?: (source: SourceReference) => void;
}

const directionLabels: Record<WaitingOnDirection, string> = {
  waiting_on_them: 'Waiting on them',
  waiting_on_me: 'Waiting on me',
};

function directionClasses(direction: WaitingOnDirection): string {
  return direction === 'waiting_on_me'
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300'
    : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300';
}

function statusClasses(status: WaitingOnStatus): string {
  switch (status) {
    case 'resolved':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300';
    case 'dismissed':
      return 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300';
  }
}

function WaitingOnCard({
  item,
  isUpdating,
  onUpdateWaitingOn,
  onDeleteWaitingOn,
  onJumpToSource,
}: {
  item: WaitingOnItem;
  isUpdating: boolean;
  onUpdateWaitingOn: (itemId: string, status: WaitingOnStatus) => void;
  onDeleteWaitingOn: (itemId: string) => void;
  onJumpToSource?: (source: SourceReference) => void;
}) {
  const itemId = item.id;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${directionClasses(item.direction)}`}>
          {directionLabels[item.direction]}
        </span>
        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusClasses(item.status)}`}>
          {item.status}
        </span>
        {item.priority && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{item.priority}</span>
        )}
        {typeof item.confidence === 'number' && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {Math.round(item.confidence * 100)}%
          </span>
        )}
      </div>

      <h4 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{item.title}</h4>
      {item.description && (
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {item.description}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        {item.person?.name && <span>Person: {item.person.name}</span>}
        {item.requester?.name && <span>Requester: {item.requester.name}</span>}
        {item.owner?.name && <span>Owner: {item.owner.name}</span>}
        {item.dueDate && <span>Due {item.dueDate}</span>}
        <span>{item.sourceMessageIds.length} source</span>
      </div>
      <SourceEvidence sources={item.sources} compact onJump={onJumpToSource} />

      {itemId && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.status === 'open' && (
            <>
              <button
                type="button"
                onClick={() => onUpdateWaitingOn(itemId, 'resolved')}
                disabled={isUpdating}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
              >
                <CheckCircle size={12} />
                Mark Resolved
              </button>
              <button
                type="button"
                onClick={() => onUpdateWaitingOn(itemId, 'dismissed')}
                disabled={isUpdating}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <X size={12} />
                Dismiss
              </button>
            </>
          )}
          {item.status !== 'open' && (
            <button
              type="button"
              onClick={() => onUpdateWaitingOn(itemId, 'open')}
              disabled={isUpdating}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 px-2 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-60 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
            >
              <RotateCcw size={12} />
              Reopen
            </button>
          )}
          {item.status === 'dismissed' && (
            <button
              type="button"
              onClick={() => onDeleteWaitingOn(itemId)}
              disabled={isUpdating}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X size={12} />
              Delete
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default function WaitingOnPanel({
  waitingOn,
  isLoading,
  isExtracting,
  isUpdating,
  errorMessage,
  onFindWaitingOn,
  onUpdateWaitingOn,
  onDeleteWaitingOn,
  onJumpToSource,
}: WaitingOnPanelProps) {
  const [showClosed, setShowClosed] = useState(false);
  const activeItems = waitingOn.filter((item) => item.status === 'open');
  const closedItems = waitingOn.filter((item) => item.status !== 'open');
  const grouped = (['waiting_on_them', 'waiting_on_me'] as WaitingOnDirection[])
    .map((direction) => ({
      direction,
      items: activeItems.filter((item) => item.direction === direction),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <section className="border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Clock3 size={14} className="flex-shrink-0 text-rose-600 dark:text-rose-300" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-rose-700 dark:text-rose-300">
            Waiting-On
          </span>
          {!isLoading && waitingOn.length === 0 && !errorMessage && (
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">No open loops found yet.</span>
          )}
          {activeItems.length > 0 && (
            <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
              {activeItems.length} open
            </span>
          )}
          {isLoading && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">Loading...</span>}
          {errorMessage && <span className="ml-2 text-xs text-rose-500">{errorMessage}</span>}
        </div>
        {closedItems.length > 0 && (
          <button
            type="button"
            onClick={() => setShowClosed((value) => !value)}
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {showClosed ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Closed
          </button>
        )}
        <button
          type="button"
          onClick={onFindWaitingOn}
          disabled={isExtracting}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          <RefreshCw size={12} className={isExtracting ? 'animate-spin' : ''} />
          {isExtracting ? 'Finding...' : 'Find Waiting-On'}
        </button>
      </div>

      {isExtracting && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Finding open loops...
        </div>
      )}

      {grouped.length > 0 && (
        <div className="space-y-3 border-t border-slate-100 px-4 pb-3 pt-3 dark:border-slate-800">
          {grouped.map((group) => (
            <div key={group.direction}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                {directionLabels[group.direction]}
              </h3>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <WaitingOnCard
                    key={item.id || `${item.direction}-${item.title}-${item.sourceMessageIds.join('-')}`}
                    item={item}
                    isUpdating={isUpdating}
                    onUpdateWaitingOn={onUpdateWaitingOn}
                    onDeleteWaitingOn={onDeleteWaitingOn}
                    onJumpToSource={onJumpToSource}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showClosed && closedItems.length > 0 && (
        <div className="space-y-2 border-t border-slate-100 px-4 pb-3 pt-3 dark:border-slate-800">
          {closedItems.map((item) => (
            <WaitingOnCard
              key={item.id || `${item.direction}-${item.title}-${item.sourceMessageIds.join('-')}`}
              item={item}
              isUpdating={isUpdating}
              onUpdateWaitingOn={onUpdateWaitingOn}
              onDeleteWaitingOn={onDeleteWaitingOn}
              onJumpToSource={onJumpToSource}
            />
          ))}
        </div>
      )}
    </section>
  );
}
