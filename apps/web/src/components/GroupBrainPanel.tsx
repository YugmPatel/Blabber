import { useState } from 'react';
import {
  Brain,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  FileText,
  Link as LinkIcon,
  RefreshCw,
  Users,
} from 'lucide-react';
import type { ChatActionItem, ChatDecision, GroupBrain, WaitingOnItem } from '@repo/types';

interface GroupBrainPanelProps {
  brain: GroupBrain | null;
  isLoading: boolean;
  isFetching: boolean;
  errorMessage?: string;
  onRefresh: () => void;
}

function actionTime(action: ChatActionItem): string | undefined {
  return action.dueDate || action.eventStart || action.eventEnd;
}

function hasBrainContent(brain: GroupBrain | null): boolean {
  if (!brain) return false;
  return Boolean(
    brain.overview ||
      brain.decisions.length ||
      brain.actions.length ||
      brain.waitingOn.length ||
      brain.importantLinks.length ||
      brain.importantFiles.length ||
      brain.openQuestions.length ||
      brain.plans.length ||
      brain.deadlines.length
  );
}

function SmallDecision({ decision }: { decision: ChatDecision }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-300">
          {decision.status}
        </span>
        {decision.category && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{decision.category}</span>
        )}
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-900 dark:text-white">{decision.title}</p>
    </div>
  );
}

function SmallAction({ action }: { action: ChatActionItem }) {
  const time = actionTime(action);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300">
          {action.type}
        </span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">{action.status}</span>
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-900 dark:text-white">{action.title}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        {action.assignedTo?.name && <span>{action.assignedTo.name}</span>}
        {time && <span>{time}</span>}
      </div>
    </div>
  );
}

function SmallWaitingOn({ item }: { item: WaitingOnItem }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
          {item.direction === 'waiting_on_me' ? 'Waiting on me' : 'Waiting on them'}
        </span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">{item.status}</span>
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-900 dark:text-white">{item.title}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        {item.person?.name && <span>{item.person.name}</span>}
        {item.dueDate && <span>{item.dueDate}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-sm font-semibold text-slate-900 dark:text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

export default function GroupBrainPanel({
  brain,
  isLoading,
  isFetching,
  errorMessage,
  onRefresh,
}: GroupBrainPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const hasContent = hasBrainContent(brain);

  return (
    <section className="border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30"
          aria-label={isOpen ? 'Collapse Group Brain' : 'Expand Group Brain'}
        >
          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <Brain size={15} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-teal-700 dark:text-teal-300">
            Group Brain
          </span>
          {isLoading && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">Loading...</span>}
          {!isLoading && !hasContent && !errorMessage && (
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">No memory yet.</span>
          )}
          {brain?.stats && hasContent && (
            <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
              {brain.stats.pendingActions} actions · {brain.stats.openLoops} open loops
            </span>
          )}
          {errorMessage && <span className="ml-2 text-xs text-rose-500">{errorMessage}</span>}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {isOpen && (
        <div className="space-y-3 border-t border-slate-100 px-4 pb-3 pt-3 dark:border-slate-800">
          {!hasContent && !isLoading && (
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              This chat brain will build itself as your group makes decisions, creates tasks, and shares important details.
            </p>
          )}

          {brain?.overview && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                Overview
              </h3>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{brain.overview}</p>
            </div>
          )}

          {brain?.stats && hasContent && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Actions" value={brain.stats.pendingActions} />
              <Stat label="Decisions" value={brain.stats.finalDecisions} />
              <Stat label="Open Loops" value={brain.stats.openLoops} />
              <Stat label="Questions" value={brain.stats.openQuestions} />
              <Stat label="Links" value={brain.stats.links} />
            </div>
          )}

          {Boolean(brain?.decisions.length) && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                Decisions
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {brain!.decisions.slice(0, 4).map((decision) => (
                  <SmallDecision key={decision.id || decision.title} decision={decision} />
                ))}
              </div>
            </div>
          )}

          {Boolean(brain?.waitingOn.length) && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                Waiting-On
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {brain!.waitingOn.slice(0, 4).map((item) => (
                  <SmallWaitingOn key={item.id || item.title} item={item} />
                ))}
              </div>
            </div>
          )}

          {Boolean(brain?.actions.length) && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                Action Items
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {brain!.actions.slice(0, 4).map((action) => (
                  <SmallAction key={action.id || action.title} action={action} />
                ))}
              </div>
            </div>
          )}

          {Boolean(brain?.importantLinks.length) && (
            <div>
              <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                <LinkIcon size={12} />
                Important Links
              </h3>
              <div className="space-y-1">
                {brain!.importantLinks.slice(0, 5).map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs font-medium text-teal-700 hover:underline dark:text-teal-300"
                  >
                    {link.title || link.url}
                  </a>
                ))}
              </div>
            </div>
          )}

          {Boolean(brain?.importantFiles.length) && (
            <div>
              <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                <FileText size={12} />
                Important Files
              </h3>
              <div className="space-y-1">
                {brain!.importantFiles.slice(0, 5).map((file) => (
                  <div key={file.id || `${file.sourceMessageId}-${file.url}`} className="truncate text-xs text-slate-600 dark:text-slate-300">
                    {file.name || file.type || 'Shared file'}
                  </div>
                ))}
              </div>
            </div>
          )}

          {Boolean(brain?.openQuestions.length) && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                Open Questions
              </h3>
              <div className="space-y-1">
                {brain!.openQuestions.slice(0, 5).map((question) => (
                  <p key={`${question.sourceMessageId}-${question.text}`} className="text-xs text-slate-600 dark:text-slate-300">
                    {question.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          {Boolean(brain?.plans.length || brain?.deadlines.length) && (
            <div>
              <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                <CalendarClock size={12} />
                Plans & Deadlines
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {brain!.plans.slice(0, 3).map((plan) => (
                  <div key={`${plan.title}-${plan.date}`} className="rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                    <p className="font-semibold text-slate-900 dark:text-white">{plan.title}</p>
                    {plan.date && <p className="mt-1 text-slate-500 dark:text-slate-400">{plan.date}</p>}
                  </div>
                ))}
                {brain!.deadlines.slice(0, 3).map((deadline) => (
                  <div key={`${deadline.relatedActionId}-${deadline.title}`} className="rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                    <p className="font-semibold text-slate-900 dark:text-white">{deadline.title}</p>
                    {deadline.dueDate && <p className="mt-1 text-slate-500 dark:text-slate-400">{deadline.dueDate}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {Boolean(brain?.participants?.length) && (
            <div>
              <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                <Users size={12} />
                Participants
              </h3>
              <div className="flex flex-wrap gap-2">
                {brain!.participants!.map((participant) => (
                  <div key={participant.userId} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-[10px] font-semibold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                      {(participant.name || participant.username || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span>{participant.name || participant.username || 'Member'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
