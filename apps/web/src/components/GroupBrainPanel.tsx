import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Brain, Loader2, RotateCcw, Send } from 'lucide-react';
import type { GroupBrainAnswer, SourceReference } from '@repo/types';
import SourceEvidence from './SourceEvidence';

interface GroupBrainPanelProps {
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

const SUGGESTIONS = [
  'What did we decide this week?',
  'What is still pending?',
  'Who owns the current tasks?',
  'What changed since last week?',
  'What are the important links?',
  'What did we decide about the group topic?',
];

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export default function GroupBrainPanel({
  isAsking,
  errorMessage,
  onAsk,
  onJumpToSource,
}: GroupBrainPanelProps) {
  const [question, setQuestion] = useState('');
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const requestIdRef = useRef(0);

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
                error: 'Group Brain could not answer that right now. Try again.',
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
    <section className="flex min-h-[calc(100vh-8rem)] flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Brain size={16} className="shrink-0 text-teal-600 dark:text-teal-300" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Group Brain</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ask about this group&apos;s past conversations, decisions, plans, and open questions.
              </p>
            </div>
          </div>
          {transcript.length > 0 && (
            <button
              type="button"
              onClick={() => setTranscript([])}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RotateCcw size={12} />
              Clear
            </button>
          )}
        </div>
        {errorMessage && (
          <p className="mt-2 text-xs text-rose-500">Group Brain is unavailable right now.</p>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {transcript.length === 0 ? (
          <div className="space-y-3 rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Ask Group Brain</p>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Answers are private to you and grounded in this group&apos;s actual conversation history.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void ask(suggestion)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {suggestion}
                </button>
              ))}
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
                <div className="max-w-[92%] rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-950">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Blabber</p>
                  {item.isLoading ? (
                    <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <Loader2 size={14} className="animate-spin" />
                      Looking for relevant group evidence...
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

      <form onSubmit={submit} className="border-t border-slate-100 p-3 dark:border-slate-800">
        <div className="flex gap-2">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Ask Group Brain about this group..."
            className="min-w-0 flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <button
            type="submit"
            disabled={!question.trim() || isAsking}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-950"
            aria-label="Ask Group Brain"
          >
            {isAsking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
          Enter to send, Shift+Enter for a new line.
        </p>
      </form>
    </section>
  );
}
