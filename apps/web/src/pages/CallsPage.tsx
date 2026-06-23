import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import Avatar from '@/components/Avatar';
import { fetchCallHistory, type CallHistoryItem } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';

type Filter = 'all' | 'missed' | 'audio' | 'video';

function duration(seconds?: number) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function outcomeLabel(call: CallHistoryItem) {
  if (call.outcome === 'ended') return 'Answered';
  return call.outcome.charAt(0).toUpperCase() + call.outcome.slice(1);
}

export default function CallsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, error } = useQuery({
    queryKey: ['calls'],
    queryFn: fetchCallHistory,
  });

  const calls = useMemo(() => {
    const all = data?.calls || [];
    return all.filter((call) => {
      if (filter === 'missed') return call.outcome === 'missed' || call.outcome === 'declined';
      if (filter === 'audio') return call.callType === 'audio';
      if (filter === 'video') return call.callType === 'video';
      return true;
    });
  }, [data?.calls, filter]);

  return (
    <div className="flex h-screen bg-[#f4f5f7] text-slate-900 dark:bg-slate-950 dark:text-white">
      <Sidebar onNewConversation={() => navigate('/chats')} onChatFilterChange={() => navigate('/chats')} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold">Calls</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Audio and video call history. Notes and transcripts are not generated automatically.
            </p>
          </div>

          <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {(['all', 'missed', 'audio', 'video'] as Filter[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize transition ${
                  filter === item
                    ? 'bg-teal-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-500">Loading calls...</p>
          ) : error ? (
            <p className="text-sm text-rose-500">Unable to load call history.</p>
          ) : calls.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
              <Phone className="mx-auto text-slate-400" />
              <p className="mt-3 font-semibold">No calls yet</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Calls will appear here after audio or video conversations.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {calls.map((call) => {
                const outgoing = call.callerId === user?._id;
                const peers = call.participantProfiles.filter((profile) => profile._id !== user?._id);
                const primary = call.chatType === 'group' ? call.chatTitle || 'Group call' : peers[0]?.name || 'Call';
                const missed = call.outcome === 'missed' || call.outcome === 'declined';
                return (
                  <button
                    key={call.id}
                    type="button"
                    onClick={() => navigate(`/chats/${call.chatId}`)}
                    className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-teal-200 hover:bg-teal-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-900 dark:hover:bg-teal-950/20"
                  >
                    <Avatar src={peers[0]?.avatarUrl} alt={primary} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`truncate text-sm font-semibold ${missed ? 'text-rose-600 dark:text-rose-300' : ''}`}>
                          {primary}
                        </p>
                        {call.callType === 'video' ? <Video size={14} /> : <Phone size={14} />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {outgoing ? <PhoneOutgoing size={13} /> : missed ? <PhoneMissed size={13} /> : <PhoneIncoming size={13} />}
                        <span>{outgoing ? 'Outgoing' : 'Incoming'}</span>
                        <span>{outcomeLabel(call)}</span>
                        {duration(call.durationSeconds) && <span>{duration(call.durationSeconds)}</span>}
                      </div>
                    </div>
                    <time className="flex-shrink-0 text-xs text-slate-400">
                      {new Date(call.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </time>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
