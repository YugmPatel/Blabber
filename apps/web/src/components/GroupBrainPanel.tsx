import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Brain, Database, Loader2, Lock, RotateCcw, Send, Sparkles } from 'lucide-react';
import type { GroupBrainAnswer, SourceReference } from '@repo/types';
import SourceEvidence from './SourceEvidence';

export type AskMode = 'group' | 'direct';

interface GroupBrainPanelProps {
  mode?: AskMode;
  isAsking: boolean;
  errorMessage?: string;
  onAsk: (question: string) => Promise<GroupBrainAnswer>;
  onJumpToSource?: (source: SourceReference) => void;
}

interface TranscriptItem {
  id: number;
  question: string;
  answer?: GroupBrainAnswer;
  isLoading?: boolean;
  error?: string;
}

const COPY: Record<AskMode, {
  heroTitle: string;
  heroSubtitle: string;
  suggestions: string[];
  placeholder: string;
  askLabel: string;
  loadingLabel: string;
  errorFallback: string;
}> = {
  group: {
    heroTitle: "Your team's collective knowledge",
    heroSubtitle: "Ask about this group's past conversations, decisions, plans, and open questions.",
    suggestions: [
      'What did we decide this week?',
      'What is still pending?',
      'Who owns the current tasks?',
      'What changed since last week?',
      'What are the important links?',
      'Show me all files related to pricing.',
    ],
    placeholder: 'Ask Group Brain anything...',
    askLabel: 'Ask Group Brain',
    loadingLabel: 'Looking for relevant group evidence...',
    errorFallback: 'Group Brain could not answer that right now. Try again.',
  },
  direct: {
    heroTitle: 'Ask about this conversation',
    heroSubtitle: 'Find answers, decisions, links, and tasks from this chat.',
    suggestions: [
      'What did we decide?',
      'What is still pending?',
      'What links were shared?',
      'What tasks came from this chat?',
      'Summarize this conversation.',
    ],
    placeholder: 'Ask about this chat...',
    askLabel: 'Ask Chat',
    loadingLabel: 'Looking for relevant messages...',
    errorFallback: 'That could not be answered right now. Try again.',
  },
};

const TRUST_POINTS = [
  {
    icon: Database,
    title: 'Grounded in this chat',
    description: 'Answers come from messages, files, and links.',
  },
  {
    icon: Lock,
    title: 'Private and secure',
    description: 'Only group members can use it.',
  },
  {
    icon: Sparkles,
    title: 'Keeps getting smarter',
    description: 'Improves as your team shares more.',
  },
];

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export default function GroupBrainPanel({
  mode = 'group',
  isAsking,
  errorMessage,
  onAsk,
  onJumpToSource,
}: GroupBrainPanelProps) {
  const [question, setQuestion] = useState('');
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const requestIdRef = useRef(0);
  const copy = COPY[mode];
  const isGroup = mode === 'group';

  const ask = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setQuestion('');
    setTranscript((items) => [
      ...items,
      { id: requestId, question: trimmed, isLoading: true },
    ]);

    try {
      const answer = await onAsk(trimmed);
      setTranscript((items) =>
        items.map((item) =>
          item.id === requestId
            ? { ...item, answer, isLoading: false }
            : item
        )
      );
    } catch {
      setTranscript((items) =>
        items.map((item) =>
          item.id === requestId
            ? {
                ...item,
                isLoading: false,
                error: copy.errorFallback,
              }
            : item
        )
      );
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void ask(question);
  };

  return (
    <section className="flex min-h-[calc(100vh-8rem)] flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
            <Brain size={17} />
          </span>
          <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">{isGroup ? 'Group Brain' : 'Ask Chat'}</h3>
        </div>
        {transcript.length > 0 && (
          <button
            type="button"
            onClick={() => setTranscript([])}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60"
          >
            <RotateCcw size={12} />
            Clear
          </button>
        )}
      </div>
      {errorMessage && (
        <p className="px-4 pt-2 text-xs text-rose-500">{isGroup ? 'Group Brain' : 'Ask Chat'} is unavailable right now.</p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {transcript.length === 0 ? (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
              <Brain size={22} />
            </span>
            <div>
              <p className="text-base font-semibold text-slate-900 dark:text-white">{copy.heroTitle}</p>
              <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {copy.heroSubtitle}
              </p>
            </div>

            {isGroup && (
              <div className="space-y-2.5 text-left">
                {TRUST_POINTS.map((point) => (
                  <div key={point.title} className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/50">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-teal-600 dark:bg-slate-800 dark:text-teal-300">
                      <point.icon size={14} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{point.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{point.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-left dark:border-slate-700 dark:bg-slate-900/40">
              <div className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-teal-600 dark:text-teal-300" />
                <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{copy.askLabel}</p>
                <span className="ml-auto rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
                  AI
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Get answers, find context, and surface decisions from {isGroup ? "this group's conversations." : 'this conversation.'}
              </p>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
                Try asking
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {copy.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void ask(suggestion)}
                    className="rounded-full border border-teal-500/30 bg-teal-50/60 px-3 py-1.5 text-left text-xs font-medium text-teal-800 transition hover:border-teal-400 hover:bg-teal-50 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-200 dark:hover:bg-teal-500/20"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          transcript.map((item) => {
            const sources = safeArray(item.answer?.sources);
            return (
              <div key={item.id} className="space-y-2">
                <div className="ml-auto max-w-[88%] rounded-lg bg-teal-600 px-3 py-2 text-sm text-white">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-teal-100">You</p>
                  <p className="mt-1 whitespace-pre-wrap">{item.question}</p>
                </div>
                <div className="max-w-[92%] rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/60">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Blabber</p>
                  {item.isLoading ? (
                    <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <Loader2 size={14} className="animate-spin" />
                      {copy.loadingLabel}
                    </p>
                  ) : item.error ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-sm text-rose-500">{item.error}</p>
                      <button
                        type="button"
                        onClick={() => void ask(item.question)}
                        className="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                        {item.answer?.answer}
                      </p>
                      {sources.length > 0 ? (
                        <SourceEvidence sources={sources} collapsedInitially onJump={onJumpToSource} />
                      ) : (
                        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                          No supporting messages found.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={submit} className="border-t border-slate-100 p-3 dark:border-slate-700">
        <div className="flex gap-2">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={copy.placeholder}
            className="min-w-0 flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-900/60 dark:text-white"
          />
          <button
            type="submit"
            disabled={!question.trim() || isAsking}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white transition hover:bg-teal-700 disabled:opacity-50"
            aria-label={copy.askLabel}
          >
            {isAsking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          AI responses may be inaccurate. Check important info.
        </p>
      </form>
    </section>
  );
}
