import { Check, RefreshCw, Scale, X } from 'lucide-react';
import type { ChatDecision, ChatDecisionStatus } from '@repo/types';

interface ChatDecisionsPanelProps {
  decisions: ChatDecision[];
  isLoading: boolean;
  isExtracting: boolean;
  isUpdating: boolean;
  errorMessage?: string;
  onFindDecisions: () => void;
  onUpdateDecision: (decisionId: string, status: ChatDecisionStatus) => void;
  onDeleteDecision: (decisionId: string) => void;
}

const groupOrder: ChatDecisionStatus[] = ['final', 'proposed', 'changed', 'dismissed'];

const groupLabels: Record<ChatDecisionStatus, string> = {
  final: 'Final',
  proposed: 'Proposed',
  changed: 'Changed',
  dismissed: 'Dismissed',
};

function statusClasses(status: ChatDecisionStatus): string {
  switch (status) {
    case 'final':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300';
    case 'changed':
      return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300';
    case 'dismissed':
      return 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300';
  }
}

function formatPeople(decision: ChatDecision): string | undefined {
  const names = (decision.decidedBy || []).map((person) => person.name).filter(Boolean);
  return names.length > 0 ? names.join(', ') : undefined;
}

function DecisionCard({
  decision,
  isUpdating,
  onUpdateDecision,
  onDeleteDecision,
}: {
  decision: ChatDecision;
  isUpdating: boolean;
  onUpdateDecision: (decisionId: string, status: ChatDecisionStatus) => void;
  onDeleteDecision: (decisionId: string) => void;
}) {
  const decisionId = decision.id;
  const people = formatPeople(decision);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusClasses(decision.status)}`}>
          {decision.status}
        </span>
        {decision.category && (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {decision.category}
          </span>
        )}
        {typeof decision.confidence === 'number' && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {Math.round(decision.confidence * 100)}%
          </span>
        )}
      </div>

      <h4 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{decision.title}</h4>
      {decision.description && (
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {decision.description}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        {people && <span>Decided by {people}</span>}
        {decision.decidedAt && <span>{decision.decidedAt}</span>}
        <span>{decision.sourceMessageIds.length} source</span>
      </div>

      {decisionId && (
        <div className="mt-3 flex flex-wrap gap-2">
          {decision.status !== 'final' && decision.status !== 'dismissed' && (
            <button
              type="button"
              onClick={() => onUpdateDecision(decisionId, 'final')}
              disabled={isUpdating}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            >
              <Check size={12} />
              Mark Final
            </button>
          )}
          {decision.status !== 'changed' && decision.status !== 'dismissed' && (
            <button
              type="button"
              onClick={() => onUpdateDecision(decisionId, 'changed')}
              disabled={isUpdating}
              className="inline-flex items-center gap-1 rounded-md border border-violet-200 px-2 py-1 text-xs font-semibold text-violet-700 transition hover:bg-violet-50 disabled:opacity-60 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/30"
            >
              <RefreshCw size={12} />
              Mark Changed
            </button>
          )}
          {decision.status !== 'dismissed' ? (
            <button
              type="button"
              onClick={() => onUpdateDecision(decisionId, 'dismissed')}
              disabled={isUpdating}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X size={12} />
              Dismiss
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onDeleteDecision(decisionId)}
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

export default function ChatDecisionsPanel({
  decisions,
  isLoading,
  isExtracting,
  isUpdating,
  errorMessage,
  onFindDecisions,
  onUpdateDecision,
  onDeleteDecision,
}: ChatDecisionsPanelProps) {
  const grouped = groupOrder
    .map((status) => ({
      status,
      decisions: decisions.filter((decision) => decision.status === status),
    }))
    .filter((group) => group.decisions.length > 0);

  return (
    <section className="border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Scale size={14} className="flex-shrink-0 text-cyan-600 dark:text-cyan-300" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-700 dark:text-cyan-300">
            Decisions
          </span>
          {!isLoading && decisions.length === 0 && !errorMessage && (
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">No decisions found yet.</span>
          )}
          {decisions.length > 0 && (
            <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
              {decisions.length} tracked
            </span>
          )}
          {isLoading && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">Loading...</span>}
          {errorMessage && <span className="ml-2 text-xs text-rose-500">{errorMessage}</span>}
        </div>
        <button
          type="button"
          onClick={onFindDecisions}
          disabled={isExtracting}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          <RefreshCw size={12} className={isExtracting ? 'animate-spin' : ''} />
          {isExtracting ? 'Finding...' : 'Find Decisions'}
        </button>
      </div>

      {isExtracting && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Finding decisions...
        </div>
      )}

      {grouped.length > 0 && (
        <div className="space-y-3 border-t border-slate-100 px-4 pb-3 pt-3 dark:border-slate-800">
          {grouped.map((group) => (
            <div key={group.status}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                {groupLabels[group.status]}
              </h3>
              <div className="space-y-2">
                {group.decisions.map((decision) => (
                  <DecisionCard
                    key={decision.id || `${decision.status}-${decision.title}-${decision.sourceMessageIds.join('-')}`}
                    decision={decision}
                    isUpdating={isUpdating}
                    onUpdateDecision={onUpdateDecision}
                    onDeleteDecision={onDeleteDecision}
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
