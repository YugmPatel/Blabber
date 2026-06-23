import { useState } from 'react';
import type { FormEvent } from 'react';
import { Brain, Link as LinkIcon, RefreshCw, Send } from 'lucide-react';
import type { GroupBrain, GroupBrainAnswer } from '@repo/types';

interface GroupBrainPanelProps {
  brain: GroupBrain | null;
  answer: GroupBrainAnswer | null;
  isLoading: boolean;
  isFetching: boolean;
  isAsking: boolean;
  errorMessage?: string;
  askErrorMessage?: string;
  onRefresh: () => void;
  onAsk: (question: string) => void;
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export default function GroupBrainPanel({
  brain,
  answer,
  isLoading,
  isFetching,
  isAsking,
  errorMessage,
  askErrorMessage,
  onRefresh,
  onAsk,
}: GroupBrainPanelProps) {
  const [question, setQuestion] = useState('');
  const importantLinks = safeArray(brain?.importantLinks);
  const plans = safeArray(brain?.plans);
  const deadlines = safeArray(brain?.deadlines);
  const hasContent = Boolean(brain?.overview || importantLinks.length || plans.length || deadlines.length);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    onAsk(trimmed);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-4 py-3">
        <Brain size={16} className="text-teal-600 dark:text-teal-300" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Group Brain</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isLoading ? 'Loading memory...' : brain?.lastUpdatedAt ? `Updated ${new Date(brain.lastUpdatedAt).toLocaleString()}` : 'No memory yet'}
          </p>
          {errorMessage && <p className="mt-1 text-xs text-rose-500">{errorMessage}</p>}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="space-y-3 border-t border-slate-100 p-3 dark:border-slate-800">
        {!hasContent && !isLoading && (
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Group Brain keeps durable decisions, plans, links, and context your group should not lose.
          </p>
        )}

        {brain?.overview && (
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{brain.overview}</p>
        )}

        {plans.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Key Plans</h4>
            <div className="space-y-1">
              {plans.slice(0, 4).map((plan) => (
                <p key={plan.title} className="text-xs text-slate-600 dark:text-slate-300">{plan.title}</p>
              ))}
            </div>
          </div>
        )}

        {importantLinks.length > 0 && (
          <div>
            <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
              <LinkIcon size={12} />
              Important Links
            </h4>
            <div className="space-y-1">
              {importantLinks.slice(0, 5).map((link) => (
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

        <form onSubmit={submit} className="flex gap-2">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask Group Brain..."
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <button
            type="submit"
            disabled={isAsking || !question.trim()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-950"
            aria-label="Ask Group Brain"
          >
            <Send size={14} />
          </button>
        </form>

        {askErrorMessage && <p className="text-xs text-rose-500">{askErrorMessage}</p>}
        {answer && (
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{answer.answer}</p>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              {answer.confidence === 'grounded'
                ? `${safeArray(answer.sourceMessageIds).length} source message(s)`
                : 'Not clearly established'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
