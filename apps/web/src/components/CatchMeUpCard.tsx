import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, FileText, Plus, RefreshCw } from 'lucide-react';
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

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-900/80">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600 dark:text-slate-300">
          {title}
        </span>
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  );
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
    <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-4 py-3">
        <FileText size={16} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Summary</h3>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {isLoading ? 'Loading summary...' : scopeLabel}
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
        <button
          type="button"
          onClick={onCatchMeUp}
          disabled={isGenerating}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-950"
        >
          <RefreshCw size={13} className={isGenerating ? 'animate-spin' : ''} />
          {isGenerating ? 'Generating...' : generated ? 'Refresh Summary' : 'Catch Me Up'}
        </button>
      </div>

      {summary && (
        <div className="space-y-2 border-t border-slate-100 p-3 dark:border-slate-800">
          <Section title="Overview" defaultOpen>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              {summary.overview || summary.summary || 'No overview generated for this range.'}
            </p>
          </Section>

          <Section title="Decisions Captured" defaultOpen={decisions.length > 0}>
            {decisions.length ? (
              decisions.map((decision) => (
                <div key={`${decision.title}-${safeArray(decision.sourceMessageIds).join('-')}`} className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  <p>{decision.title}</p>
                  <SourceEvidence sources={decision.sources} compact onJump={onJumpToSource} />
                </div>
              ))
            ) : (
              <EmptyLine text="No decisions captured in this range." />
            )}
          </Section>

          <Section title="Questions for Me" defaultOpen={questionsForMe.length > 0}>
            {questionsForMe.length ? (
              questionsForMe.map((question) => (
                <div key={`${question.question}-${question.sourceMessageId}`} className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  <p>{question.question}</p>
                  <SourceEvidence sources={question.sources} compact onJump={onJumpToSource} />
                </div>
              ))
            ) : (
              <EmptyLine text="No questions for you in this range." />
            )}
          </Section>

          <Section title="Important Links" defaultOpen={importantLinks.length > 0}>
            {importantLinks.length ? (
              importantLinks.map((link) => (
                <div key={`${link.url}-${link.sourceMessageId}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs font-medium text-teal-700 hover:underline dark:text-teal-300"
                  >
                    {linkLabel(link.url, link.label)}
                  </a>
                  <SourceEvidence sources={link.sources} compact onJump={onJumpToSource} />
                </div>
              ))
            ) : (
              <EmptyLine text="No important links found in this range." />
            )}
          </Section>

          <Section title="Tasks Captured" defaultOpen={tasks.length > 0}>
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
                  <div key={`${task.title}-${task.sourceMessageId}`} className="rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950">
                    <span className="mb-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      {existing ? (isGroupChat ? 'Added to Actions' : 'Added to My Actions') : directState?.badge || 'Suggested task'}
                    </span>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-100">{task.title}</p>
                    {!existing && (
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {directState?.helper || 'Add this to Actions to assign and track it.'}
                      </p>
                    )}
                    <SourceEvidence sources={task.sources} compact onJump={onJumpToSource} />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {directState?.ownerText || (task.assignedTo ? `Owner: ${task.assignedTo}` : 'Owner unclear')}
                        {task.dueDate ? ` · Due ${task.dueDate}` : ''}
                      </span>
                      {existing ? (
                        <button
                          type="button"
                          onClick={() => onOpenAction?.(existing)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
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
                          className="inline-flex items-center gap-1 rounded-md border border-teal-200 px-2 py-1 text-[11px] font-semibold text-teal-700 transition hover:bg-teal-50 disabled:opacity-50 dark:border-teal-800 dark:text-teal-300"
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

          <Section title="Waiting On" defaultOpen={waitingOn.length > 0}>
            {waitingOn.length ? (
              waitingOn.map((item) => (
                <div key={`${item.title}-${item.sourceMessageId}`} className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  <p>{item.title}</p>
                  <SourceEvidence sources={item.sources} compact onJump={onJumpToSource} />
                </div>
              ))
            ) : (
              <EmptyLine text="Nothing is clearly waiting on someone in this range." />
            )}
          </Section>

          <Section title="Safe to Skip">
            {noise.length ? (
              noise.map((item) => (
                <p key={`${item.text}-${item.sourceMessageId}`} className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {item.text}
                </p>
              ))
            ) : (
              <EmptyLine text="No low-priority material called out." />
            )}
          </Section>
        </div>
      )}
    </section>
  );
}
