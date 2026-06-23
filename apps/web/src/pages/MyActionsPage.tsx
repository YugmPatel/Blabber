import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Clock3 } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import { useMyActions } from '@/hooks/useChatActions';
import type { ChatActionStatus } from '@repo/types';

const filters: { value: ChatActionStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
];

function normalizeStatus(status: string): ChatActionStatus {
  if (status === 'accepted' || status === 'pending') return 'open';
  if (status === 'dismissed') return 'completed';
  return status as ChatActionStatus;
}

export default function MyActionsPage() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<ChatActionStatus>('open');
  const { actions, isLoading, error, updateActionStatus, isUpdating } = useMyActions();

  const filteredActions = useMemo(
    () => actions.filter((action) => normalizeStatus(action.status) === activeFilter),
    [actions, activeFilter]
  );

  return (
    <div className="flex h-screen bg-[#f4f5f7] text-slate-900 dark:bg-slate-950 dark:text-white">
      <Sidebar onNewConversation={() => navigate('/chats')} onChatFilterChange={() => navigate('/chats')} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold">My Actions</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Group commitments assigned to you.
            </p>
          </div>

          <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {filters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setActiveFilter(filter.value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  activeFilter === filter.value
                    ? 'bg-teal-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-500">Loading actions...</p>
          ) : error ? (
            <p className="text-sm text-rose-500">Unable to load your actions.</p>
          ) : filteredActions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
              <p className="font-semibold">No {filters.find((f) => f.value === activeFilter)?.label.toLowerCase()} actions</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Actions appear here when group summaries are turned into assigned work.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredActions.map((action) => (
                <article
                  key={action.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-600 dark:text-teal-300">
                        {(action as any).chatTitle || 'Group chat'}
                      </p>
                      <h2 className="mt-1 text-base font-semibold">{action.title}</h2>
                      {action.description && (
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{action.description}</p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        {action.dueDate && <span>Due {new Date(action.dueDate).toLocaleDateString()}</span>}
                        <button
                          type="button"
                          onClick={() => navigate(`/chats/${action.chatId}`)}
                          className="font-semibold text-teal-700 hover:underline dark:text-teal-300"
                        >
                          Open source group
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 gap-1">
                      {filters.map((filter) => (
                        <button
                          key={filter.value}
                          type="button"
                          disabled={isUpdating}
                          onClick={() => action.id && updateActionStatus({ actionId: action.id, status: filter.value })}
                          className={`rounded-lg p-2 transition ${
                            normalizeStatus(action.status) === filter.value
                              ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200'
                              : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                          aria-label={`Mark ${filter.label}`}
                          title={`Mark ${filter.label}`}
                        >
                          {filter.value === 'open' ? <Circle size={16} /> : filter.value === 'in_progress' ? <Clock3 size={16} /> : <CheckCircle2 size={16} />}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
