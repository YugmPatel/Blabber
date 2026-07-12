import { useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, ChevronDown, Circle, FileText, Link2, Lock, Plus, RefreshCw, XCircle } from 'lucide-react';
import type { ChatActionItem, ChatIntelligenceSummary, ChatSummaryTask, SourceReference } from '@repo/types';
import SourceEvidence from './SourceEvidence';

interface CatchMeUpCardProps {
  summary: ChatIntelligenceSummary | null;
  actions?: ChatActionItem[];
  isGroupChat?: boolean;
  isLoading: boolean;
  isGenerating: boolean;
  isCreatingAction?: boolean;
  currentUserId?: string;
  currentUserCanManageActions?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  onCatchMeUp: () => void;
  onAddTaskToActions?: (task: ChatSummaryTask) => void;
  onOpenAction?: (action: ChatActionItem) => void;
  onJumpToSource?: (source: SourceReference) => void;
}

function sourceKey(task: ChatSummaryTask) {
  return `${(task.title || '').trim().toLowerCase()}::${task.sourceMessageId || ''}`;
}

function existingActionForTask(task: ChatSummaryTask, actions: ChatActionItem[]) {
  const key = sourceKey(task);
  return actions.find((action) => {
    const sourceMessageIds = Array.isArray(action.sourceMessageIds) ? action.sourceMessageIds : [];
    if (task.sourceMessageId && sourceMessageIds.includes(task.sourceMessageId)) {
      return true;
    }
    const actionKey = `${(action.title || '').trim().toLowerCase()}::${sourceMessageIds[0] || ''}`;
    return actionKey === key;
  });
}

function possessiveName(name?: string | null) {
  const fallback = name || 'Their';
  return fallback.endsWith('s') ? `${fallback}'` : `${fallback}'s`;
}

function primarySource(task: ChatSummaryTask): SourceReference | undefined {
  return task.sources?.find((source) => source.messageId === task.sourceMessageId) || task.sources?.[0];
}

function directTaskState(task: ChatSummaryTask, currentUserId?: string) {
  const assignedUserId = task.assignedToUserId || null;
  const sourceSenderId = primarySource(task)?.senderId;
  const assignedToCurrentUser = Boolean(assignedUserId && currentUserId && assignedUserId === currentUserId);
  const assignedToOtherParticipant = Boolean(assignedUserId && currentUserId && assignedUserId !== currentUserId);
  const ownerName = task.assignedTo || 'them';
  const isRequest = Boolean(sourceSenderId && assignedUserId && sourceSenderId !== assignedUserId);

  if (!assignedUserId) {
    return {
      canAdd: true,
      badge: 'Suggested personal task',
      helper: 'Add this to My Actions to track it privately.',
      ownerText: 'Owner unclear',
    };
  }

  if (assignedToCurrentUser) {
    return {
      canAdd: true,
      badge: 'Suggested personal task',
      helper: isRequest ? 'This request is for you.' : 'Add this to My Actions to track it privately.',
      ownerText: 'Owner: You',
    };
  }

  if (assignedToOtherParticipant) {
    return {
      canAdd: false,
      badge: isRequest ? `Waiting on ${ownerName}` : `${possessiveName(ownerName)} commitment`,
      helper: isRequest ? 'This request is directed to them.' : 'Tracked as a follow-up in this conversation.',
      ownerText: `Owner: ${ownerName}`,
    };
  }

  return {
    canAdd: true,
    badge: 'Suggested personal task',
    helper: 'Add this to My Actions to track it privately.',
    ownerText: task.assignedTo ? `Owner: ${task.assignedTo}` : 'Owner unclear',
  };
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function linkLabel(url: string, label?: string | null) {
  if (label) return label;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 dark:text-slate-500">{text}</p>;
}

function CountPill({ count }: { count: number }) {
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      {count}
    </span>
  );
}

function Section({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/40"
      >
        <ChevronDown size={14} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{title}</span>
        {typeof count === 'number' && count > 0 && <CountPill count={count} />}
      </button>
      {open && <div className="space-y-2.5 border-t border-slate-100 px-3.5 py-3 dark:border-slate-700">{children}</div>}
    </div>
  );
}

function decisionIcon(status?: string) {
  if (status === 'reverted') return <XCircle size={16} className="mt-0.5 flex-shrink-0 text-rose-500" />;
  if (status === 'proposed') return <Circle size={16} className="mt-0.5 flex-shrink-0 text-amber-500" />;
  return <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-500" />;
}

export default function CatchMeUpCard({
  summary,
  actions = [],
  isGroupChat = false,
  isLoading,
  isGenerating,
  isCreatingAction = false,
  currentUserId,
  currentUserCanManageActions = false,
  errorMessage,
  onRetry,
  onCatchMeUp,
  onAddTaskToActions,
  onOpenAction,
  onJumpToSource,
}: CatchMeUpCardProps) {
  const sourceMessageIds = safeArray(summary?.sourceMessageIds);
  const decisions = safeArray(summary?.decisions);
  const questionsForMe = safeArray(summary?.questionsForMe);
  const importantLinks = safeArray(summary?.importantLinks);
  const tasks = safeArray(summary?.tasks);
  const waitingOn = safeArray(summary?.waitingOn);
  const noise = safeArray(summary?.noise);
  const safeActions = safeArray(actions);
  const scopeLabel = summary?.scope?.label || (summary ? `${sourceMessageIds.length} messages` : 'No summary yet');
  const generated = Boolean(summary);

  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
            <FileText size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">Summary</h3>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {isLoading ? 'Loading summary...' : scopeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onCatchMeUp}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/40 px-3 py-1.5 text-xs font-semibold text-teal-700 transition hover:bg-teal-50 disabled:opacity-60 dark:border-teal-500/40 dark:text-teal-300 dark:hover:bg-teal-500/10"
          >
            <RefreshCw size={13} className={isGenerating ? 'animate-spin' : ''} />
            {isGenerating ? 'Generating...' : generated ? 'Refresh Summary' : 'Catch Me Up'}
          </button>
        </div>
        {errorMessage && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900/40 dark:bg-rose-950/20">
            <p className="text-xs text-rose-600 dark:text-rose-300">{errorMessage}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="ml-auto flex-shrink-0 rounded-md border border-rose-300 px-2 py-0.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {summary && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800/60">
            <p className="mb-1.5 text-[13px] font-semibold text-slate-700 dark:text-slate-200">Overview</p>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {summary.overview || summary.summary || 'No overview generated for this range.'}
            </p>
          </div>

          <Section title="Decisions Captured" count={decisions.length} defaultOpen={decisions.length > 0}>
            {decisions.length ? (
              decisions.map((decision) => (
                <div
                  key={`${decision.title}-${safeArray(decision.sourceMessageIds).join('-')}`}
                  className="flex items-start gap-2"
                >
                  {decisionIcon(decision.status)}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{decision.title}</p>
                    <SourceEvidence sources={decision.sources} compact onJump={onJumpToSource} />
                  </div>
                </div>
              ))
            ) : (
              <EmptyLine text="No decisions captured in this range." />
            )}
          </Section>

          <Section title="Questions For Me" count={questionsForMe.length} defaultOpen={questionsForMe.length > 0}>
            {questionsForMe.length ? (
              questionsForMe.map((question) => (
                <div key={`${question.question}-${question.sourceMessageId}`} className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  <p>{question.question}</p>
                  <SourceEvidence sources={question.sources} compact onJump={onJumpToSource} />
                </div>
              ))
            ) : (
              <EmptyLine text="No questions for you in this range." />
            )}
          </Section>

          <Section title="Important Links" count={importantLinks.length} defaultOpen={importantLinks.length > 0}>
            {importantLinks.length ? (
              importantLinks.map((link) => (
                <div key={`${link.url}-${link.sourceMessageId}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-teal-700 hover:underline dark:text-teal-300"
                  >
                    <Link2 size={12} className="flex-shrink-0" />
                    <span className="truncate">{linkLabel(link.url, link.label)}</span>
                  </a>
                  <SourceEvidence sources={link.sources} compact onJump={onJumpToSource} />
                </div>
              ))
            ) : (
              <EmptyLine text="No important links found in this range." />
            )}
          </Section>

          <Section title="Tasks Captured" count={tasks.length} defaultOpen={tasks.length > 0}>
            {tasks.length ? (
              tasks.map((task) => {
                const existing = existingActionForTask(task, safeActions);
                const directState = !isGroupChat ? directTaskState(task, currentUserId) : null;
                const assignedToAnotherMember = Boolean(
                  isGroupChat &&
                  task.assignedToUserId &&
                  currentUserId &&
                  task.assignedToUserId !== currentUserId &&
                  !currentUserCanManageActions
                );
                const canAddTask = isGroupChat ? !assignedToAnotherMember : Boolean(directState?.canAdd);
                const addLabel = isGroupChat
                  ? task.assignedToUserId || currentUserCanManageActions ? 'Add to Actions' : 'Create as my Action'
                  : 'Add to My Actions';
                return (
                  <div key={`${task.title}-${task.sourceMessageId}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                    <span className="mb-1.5 inline-flex rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      {existing ? (isGroupChat ? 'Added to Actions' : 'Added to My Actions') : directState?.badge || 'Suggested task'}
                    </span>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{task.title}</p>
                    {!existing && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {directState?.helper || 'Add this to Actions to assign and track it.'}
                      </p>
                    )}
                    <SourceEvidence sources={task.sources} compact onJump={onJumpToSource} />
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {directState?.ownerText || (task.assignedTo ? `Owner: ${task.assignedTo}` : 'Owner unclear')}
                        {task.dueDate ? ` · Due ${task.dueDate}` : ''}
                      </span>
                      {existing ? (
                        <button
                          type="button"
                          onClick={() => onOpenAction?.(existing)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          Open Action
                        </button>
                      ) : assignedToAnotherMember ? (
                        <span className="text-right text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          Assigned to {task.assignedTo || 'another member'}. A group admin can add this Action.
                        </span>
                      ) : directState && !directState.canAdd ? (
                        <span className="text-right text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {directState.helper}
                        </span>
                      ) : canAddTask && (
                        <button
                          type="button"
                          disabled={isCreatingAction}
                          onClick={() => onAddTaskToActions?.(task)}
                          className="inline-flex items-center gap-1 rounded-md border border-teal-300 bg-white px-2 py-1 text-[11px] font-semibold text-teal-700 transition hover:bg-teal-50 disabled:opacity-50 dark:border-teal-700 dark:bg-slate-800 dark:text-teal-300"
                        >
                          <Plus size={11} />
                          {addLabel}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyLine text="No tasks captured in this range." />
            )}
          </Section>

          <Section title="Waiting On" count={waitingOn.length} defaultOpen={waitingOn.length > 0}>
            {waitingOn.length ? (
              waitingOn.map((item) => (
                <div key={`${item.title}-${item.sourceMessageId}`} className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  <p>{item.title}</p>
                  <SourceEvidence sources={item.sources} compact onJump={onJumpToSource} />
                </div>
              ))
            ) : (
              <EmptyLine text="Nothing is clearly waiting on someone in this range." />
            )}
          </Section>

          <Section title="Safe to Skip" count={noise.length}>
            {noise.length ? (
              noise.map((item) => (
                <p key={`${item.text}-${item.sourceMessageId}`} className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  {item.text}
                </p>
              ))
            ) : (
              <EmptyLine text="No low-priority material called out." />
            )}
          </Section>

          <div className="flex items-center gap-2 px-1 pt-1">
            <Lock size={12} className="flex-shrink-0 text-slate-400" />
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {isGroupChat
                ? "Grounded in this group's message history."
                : "Grounded in this conversation's message history."}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
